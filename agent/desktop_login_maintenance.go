package bee

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"time"
)

func (o *DesktopAuthorizer) beginLoginMaintenance(job *desktopAuthorization, detect DesktopAccountDetectRequest) error {
	a := o.accounts
	if a.device == nil {
		return nil
	}
	ctx, platform := job.ctx, job.request.Platform
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	state, err := a.verifiedSelectionDevice(ctx, session)
	if err != nil {
		release()
		return err
	}
	_, bindingRevision, err := session.readBinding()
	if err != nil {
		release()
		return err
	}
	scope, err := a.selectionScope(session, state, nil)
	if err != nil {
		release()
		return err
	}
	if _, pending := scope.PendingOperations[platform]; pending {
		release()
		return fmt.Errorf("official login blocked by unresolved account operation: platform=%s; reconcile the original account operation", platform)
	}
	record := &desktopLoginRecord{Hive: state.Hive, OwnerID: state.Identity.OwnerID, DeviceID: state.Identity.ID, BindingRevision: bindingRevision,
		Public: DesktopLoginMaintenance{Operation: copyDesktopOperation(job.operation), Phase: "pause_pending", Source: DesktopAccountSource{Directory: detect.Directory, Store: detect.Store}, StartedAt: a.now().UTC().Format(time.RFC3339Nano)}}
	session.mu.Lock()
	record.BindingDigest = hex.EncodeToString(session.bindingDigest[:])
	session.mu.Unlock()
	if selected, found := scope.Selections[platform]; found {
		record.Selection = &selected
		record.PauseRequired = true
	}
	if a.runtime != nil {
		a.runtime.mu.Lock()
		record.NetworkRevision = a.runtime.network.Revision
		if a.runtime.snapshot.RunID != nil {
			value := *a.runtime.snapshot.RunID
			record.RunID = &value
		}
		a.runtime.mu.Unlock()
	}
	account, err := selectionHiveAccount(ctx, state, platform)
	if err == nil {
		record.PauseRequired = record.PauseRequired || account.Status != "not_configured"
		if record.Selection != nil && (account.AccountFingerprint != record.Selection.Fingerprint || account.Generation != record.Selection.Generation || account.PendingFingerprint != "") {
			err = fmt.Errorf("official login account binding changed: fingerprint_match=%t generation=%d expected_generation=%d pending=%t", account.AccountFingerprint == record.Selection.Fingerprint, account.Generation, record.Selection.Generation, account.PendingFingerprint != "")
		}
	}
	if err == nil {
		err = saveDesktopLoginRecord(session, *record, true)
	}
	release()
	if err != nil {
		return err
	}
	job.maintenance = record
	if err := o.publishLoginMaintenance(ctx, record); err != nil {
		return err
	}
	if a.runtime != nil {
		if err := a.runtime.markLoginMaintenance(ctx, platform, record.Public.Operation.ID); err != nil {
			return err
		}
	}
	if record.PauseRequired {
		// Persisted pause_pending is the sole write boundary. Later recovery only
		// GETs this result, even when the response to this PUT is lost.
		supply, err := desktopSupplyCall(ctx, state, platform, nil)
		if err != nil {
			return err
		}
		if !supply.Paused {
			yes := true
			written, writeErr := desktopSupplyCall(ctx, state, platform, &yes)
			if writeErr == nil && !written.Paused {
				return fmt.Errorf("official login pause PUT returned paused=false; read-only reconciliation required")
			}
			supply, err = desktopSupplyCall(ctx, state, platform, nil)
			if err != nil {
				return fmt.Errorf("official login pause result unknown: write=%v; query: %w", writeErr, err)
			}
			if !supply.Paused {
				return fmt.Errorf("official login pause unconfirmed: write=%v; GET paused=false; original PUT is not replayed", writeErr)
			}
		}
	}
	record.PauseConfirmed = true
	record.Public.Phase = "paused"
	if err := o.saveLoginMaintenance(ctx, record); err != nil {
		return err
	}
	if a.runtime != nil {
		if err := a.runtime.isolateLoginMaintenance(ctx, platform, record.Public.Operation.ID); err != nil {
			return err
		}
	}
	record.Isolated = true
	record.Public.Phase = "isolated"
	if err := o.saveLoginMaintenance(ctx, record); err != nil {
		return err
	}
	record.LoginStarted = true
	record.Public.Phase = "authorizing"
	return o.saveLoginMaintenance(ctx, record)
}

func (o *DesktopAuthorizer) publishLoginMaintenance(ctx context.Context, record *desktopLoginRecord) error {
	platform := *record.Public.Operation.Platform
	p, release, err := o.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	p.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(record.Public)
	p.snapshot.Revision++
	release()
	return nil
}

func (o *DesktopAuthorizer) saveLoginMaintenance(ctx context.Context, record *desktopLoginRecord) error {
	session, release, err := o.accounts.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	state, revision, err := session.readBinding()
	if err == nil && !desktopLoginBindingMatches(session, state, record) {
		err = fmt.Errorf("login maintenance binding changed: identity_present=%t binding_revision=%d expected_revision=%d; original journal retained", state.Identity != nil, revision, record.BindingRevision)
	}
	if err == nil {
		err = saveDesktopLoginRecord(session, *record, false)
	}
	release()
	if err != nil {
		return err
	}
	if record.Public.Phase == "restored" && o.accounts.runtime != nil {
		if err := o.accounts.runtime.completeLoginMaintenance(ctx, record); err != nil {
			return err
		}
	}
	return o.publishLoginMaintenance(ctx, record)
}

func desktopAuthorizationResult(job *desktopAuthorization, err error) DesktopOperation {
	op := copyDesktopOperation(job.operation)
	op.State = "succeeded"
	if err == nil {
		return op
	}
	op.State = "failed"
	if errors.Is(err, context.Canceled) {
		op.State = "cancelled"
	}
	var failure *DesktopAccountError
	if errors.As(err, &failure) {
		op.Error = failure
	} else {
		op.Error = accountFailure(job.request.Platform, "authorization_unconfirmed", "official_login", err.Error())
	}
	return op
}

func (o *DesktopAuthorizer) reconcileAuthorization(job *desktopAuthorization, loginErr error) {
	var processFailure *desktopAuthorizationCleanupError
	if errors.As(loginErr, &processFailure) {
		job.processCleanupErr = processFailure
		job.cleanupErr = processFailure
	}
	if job.maintenance == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	record := job.maintenance
	record.Public.Operation = desktopAuthorizationResult(job, loginErr)
	if err := o.saveLoginMaintenance(ctx, record); err != nil {
		job.cleanupErr = errors.Join(job.processCleanupErr, err)
		o.blockLoginMaintenance(record, err)
		return
	}
	if job.processCleanupErr != nil {
		o.blockLoginMaintenance(record, job.processCleanupErr)
		job.cleanupErr = errors.Join(job.cleanupErr, o.saveLoginMaintenance(ctx, record))
		return
	}
	err := o.recoverLoginMaintenance(ctx, record)
	if err != nil {
		o.blockLoginMaintenance(record, err)
	}
	if err := o.saveLoginMaintenance(ctx, record); err != nil {
		job.cleanupErr = errors.Join(job.processCleanupErr, err)
		o.blockLoginMaintenance(record, err)
		o.publishLoginMaintenance(ctx, record)
	}
}

func (o *DesktopAuthorizer) blockLoginMaintenance(record *desktopLoginRecord, err error) {
	record.Public.Phase = "blocked"
	record.Public.CanRecheck = true
	var failure *DesktopAccountError
	if !errors.As(err, &failure) {
		failure = accountFailure(*record.Public.Operation.Platform, "login_maintenance_unconfirmed", "login_maintenance_recovery", err.Error())
	}
	record.Public.Error = failure
}

// This path never starts an official process and never writes pause/resume.
func (o *DesktopAuthorizer) recoverLoginMaintenance(ctx context.Context, record *desktopLoginRecord) error {
	a, platform := o.accounts, *record.Public.Operation.Platform
	lease, err := a.loginProcessLease(ctx, record.Public.Operation.ID, !record.LoginStarted)
	if err != nil {
		return err
	}
	defer lease.close()
	if err := confirmDesktopLoginProcessStopped(ctx, lease); err != nil {
		return err
	}
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, bindingRevision, err := session.readBinding()
	if err == nil && !desktopLoginBindingMatches(session, state, record) {
		err = fmt.Errorf("login recovery context changed: identity_present=%t binding_revision=%d expected_revision=%d; original scope retained", state.Identity != nil, bindingRevision, record.BindingRevision)
	}
	var scope desktopAccountScope
	if err == nil {
		state, err = a.verifiedSelectionDevice(ctx, session)
	}
	if err == nil {
		scope, err = a.selectionScope(session, state, nil)
	}
	if err != nil {
		return err
	}
	if err := a.verifyLoginRecoverySession(ctx, state, scope, record); err != nil {
		return err
	}
	observed, unlockObserved, err := a.acquire(ctx, platform)
	if err != nil {
		return err
	}
	conflictingSource := observed.source != nil && !sameDesktopLoginSource(*observed.source, record.Public.Source)
	unlockObserved()
	if conflictingSource {
		return fmt.Errorf("login recovery observed source differs from original namespace: platform=%s; newer explicit detection and original journal retained", platform)
	}
	if a.runtime != nil {
		if err := a.runtime.markLoginMaintenance(ctx, platform, record.Public.Operation.ID); err != nil {
			return err
		}
	}
	if record.PauseRequired {
		supply, err := desktopSupplyCall(ctx, state, platform, nil)
		if err != nil {
			return err
		}
		if !supply.Paused {
			return fmt.Errorf("login recovery pause unconfirmed: GET paused=false; no pause write or login is replayed")
		}
	}
	record.PauseConfirmed = true
	if a.runtime != nil {
		if err := a.runtime.isolateLoginMaintenance(ctx, platform, record.Public.Operation.ID); err != nil {
			return err
		}
		record.Isolated = true
	}
	record.Public.Phase = "reconciling"
	record.Public.CanRecheck, record.Public.Error = false, nil
	if err := o.saveLoginMaintenance(ctx, record); err != nil {
		return err
	}
	read, failure := a.readAccountSource(ctx, DesktopAccountDetectRequest{Platform: platform, Directory: record.Public.Source.Directory, Store: record.Public.Source.Store, Mode: "local"})
	revision, source := read.revision, read.source
	read.clear()
	if failure != nil {
		return failure
	}
	if !sameDesktopAuthorizationSource(source, record.Public.Source) {
		return fmt.Errorf("login recovery source namespace changed; original source retained")
	}
	fingerprint, err := a.selectionSource(ctx, platform, desktopPendingOperation{Source: source, CredentialRevision: revision})
	if err != nil {
		return err
	}
	p, unlock, err := a.acquire(ctx, platform)
	if err != nil {
		return err
	}
	err = a.loadSelection(p, session, state, platform)
	if err == nil {
		_, err = a.detectAccountLocked(ctx, p, DesktopAccountDetectRequest{Platform: platform, Directory: source.Directory, Store: source.Store, Mode: "local"})
	}
	if err == nil && (p.source == nil || p.credentialRevision != revision || !sameDesktopAuthorizationSource(*p.source, source) || p.snapshot.Candidate.Reference == nil) {
		err = fmt.Errorf("login recovery source changed during verification: candidate_state=%s revision_match=%t; recheck current source", p.snapshot.Candidate.State, p.credentialRevision == revision)
	}
	if err == nil && platform == "claude" {
		p.snapshot.Candidate.Fingerprint = accountString(fingerprint)
		p.snapshot.Candidate.IdentityVerified = true
	}
	unlock()
	if err != nil {
		return err
	}
	if record.Selection == nil {
		record.Public.Phase = "restored"
		record.Public.CanRecheck, record.Public.Error = false, nil
		return nil
	}
	selected, exists := scope.Selections[platform]
	if !exists || selected.Revision != record.Selection.Revision || selected.Fingerprint != record.Selection.Fingerprint || selected.Generation != record.Selection.Generation {
		return fmt.Errorf("login recovery original selection changed: selected=%t; explicit account reconciliation required", exists)
	}
	if _, pending := scope.PendingOperations[platform]; pending {
		return fmt.Errorf("login recovery blocked by unresolved account operation; original operation must be reconciled")
	}
	if !sameDesktopLoginSource(source, selected.Source) {
		return fmt.Errorf("login recovery selected source namespace changed; original selection and journal retained")
	}
	if fingerprint != selected.Fingerprint {
		record.Public.Phase = "confirmation_required"
		record.Public.CanRecheck, record.Public.Error = true, nil
		return nil
	}
	selected.CredentialRevision = revision
	if a.runtime != nil {
		if err := a.runtime.restoreLoginMaintenance(ctx, platform, record, selected); err != nil {
			return err
		}
	}
	record.Public.Phase = "restored"
	record.Public.CanRecheck, record.Public.Error = false, nil
	return nil
}

func sameDesktopLoginSource(a, b DesktopAccountSource) bool {
	if sameDesktopAuthorizationSource(a, b) {
		return true
	}
	if a.Store != "file" || b.Store != "file" || a.Directory == nil || b.Directory == nil {
		return false
	}
	left, leftErr := filepath.EvalSymlinks(*a.Directory)
	right, rightErr := filepath.EvalSymlinks(*b.Directory)
	return leftErr == nil && rightErr == nil && left == right
}

func (a *DesktopAccounts) completeLoginAccountChange(session *desktopDeviceSession, state localState, platform string, selection desktopAccountSelection) (*DesktopLoginMaintenance, error) {
	journal, err := readDesktopLoginJournal(session)
	if err != nil {
		return nil, err
	}
	key := desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID) + ":" + platform
	record, found := journal.Records[key]
	if !found || !record.Public.CanRecheck {
		return nil, nil
	}
	if record.Selection == nil || selection.Generation != record.Selection.Generation+1 || selection.Fingerprint == record.Selection.Fingerprint || !sameDesktopLoginSource(record.Public.Source, selection.Source) {
		return nil, fmt.Errorf("login account confirmation differs from original maintenance: original_selection=%t; original journal retained", record.Selection != nil)
	}
	record.Public.Phase, record.Public.CanRecheck, record.Public.Error = "restored", false, nil
	if err := saveDesktopLoginRecord(session, record, false); err != nil {
		return nil, err
	}
	return copyDesktopLoginMaintenance(record.Public), nil
}

// Snapshot refresh may settle the original journal. It owns only a read-only
// recovery worker, never a second login process or a replayed pause request.
func (a *DesktopAccounts) launchLoginMaintenanceRecheck(p *desktopAccountPlatform, platform string) error {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if a.closed || a.authorizer == nil || a.activeActions[platform] {
		return fmt.Errorf("login recheck admission blocked: closed=%t owner_present=%t platform_active=%t", a.closed, a.authorizer != nil, a.activeActions[platform])
	}
	o := a.authorizer
	id := p.snapshot.LoginMaintenance.Operation.ID
	ctx, cancel := context.WithTimeout(a.ctx, 12*time.Second)
	worker := &desktopAccountWorker{cancel: cancel, done: make(chan struct{})}
	p.working = true
	a.activeActions[platform] = true
	a.accountWorkers[platform] = worker
	a.workers.Add(1)
	go func() {
		defer a.workers.Done()
		defer close(worker.done)
		defer cancel()
		var record *desktopLoginRecord
		session, release, err := a.device.acquireSession(ctx)
		if err == nil {
			var journal desktopLoginJournal
			journal, err = readDesktopLoginJournal(session)
			if err == nil {
				for _, saved := range journal.Records {
					if saved.Public.Operation.ID == id && saved.Public.Operation.Platform != nil && *saved.Public.Operation.Platform == platform {
						copy := saved
						record = &copy
						break
					}
				}
				if record == nil {
					err = fmt.Errorf("login recheck original operation record absent; original result retained")
				}
			}
			release()
		}
		if err == nil {
			o.mu.Lock()
			if original := o.jobs[id]; original != nil {
				record.Public.Operation = copyDesktopOperation(original.operation)
				if original.processCleanupErr != nil {
					err = original.processCleanupErr
				}
			} else {
				markDesktopInterruptedLogin(record)
			}
			o.mu.Unlock()
		}
		if err == nil {
			err = o.recoverLoginMaintenance(ctx, record)
		}
		if record != nil {
			if err != nil {
				o.blockLoginMaintenance(record, err)
			}
			if saveErr := o.saveLoginMaintenance(ctx, record); saveErr != nil {
				err = errors.Join(err, saveErr)
				o.blockLoginMaintenance(record, err)
			} else {
				o.mu.Lock()
				if original := o.jobs[id]; original != nil {
					// The original process was already joined. A confirmed repair
					// of this exact journal discharges only its storage failure.
					original.cleanupErr = original.processCleanupErr
				}
				o.mu.Unlock()
			}
		}
		locked, unlock, _ := a.acquire(context.Background(), platform)
		a.lifecycleMu.Lock()
		locked.working = false
		delete(a.activeActions, platform)
		delete(a.accountWorkers, platform)
		a.lifecycleMu.Unlock()
		if record != nil {
			locked.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(record.Public)
		} else if err != nil && locked.snapshot.LoginMaintenance != nil {
			copy := &desktopLoginRecord{Public: *locked.snapshot.LoginMaintenance}
			o.blockLoginMaintenance(copy, err)
			locked.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(copy.Public)
		}
		locked.snapshot.Revision++
		unlock()
	}()
	return nil
}
