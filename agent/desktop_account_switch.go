package bee

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"

	"github.com/tokhive/bee/beewire"
)

func (a *DesktopAccounts) beginAccountChange(p *desktopAccountPlatform, request DesktopAccountActionRequest) (DesktopAccountSnapshot, error) {
	fail := func(code, check, message string) (DesktopAccountSnapshot, error) {
		return accountSnapshotCopy(p.snapshot), accountFailure(request.Platform, code, check, message)
	}
	if a.runtime == nil || a.device == nil {
		return fail("runtime_dependency", "runtime_ownership", "account change requires the owned runtime and a verified desktop device")
	}
	if p.working {
		return fail("operation_pending", "account_change", "reconcile the existing platform operation before another account change")
	}
	if p.selected == nil {
		return fail("selection_missing", "account_change", "load the persisted selection before changing its account")
	}
	if p.source == nil || p.credentialRevision == "" {
		return fail("source_unavailable", "account_change", "detect the new source before confirming its account")
	}
	if p.pending != nil {
		op := *p.pending
		if op.Kind != "confirm_change" || !sameDesktopAuthorizationSource(op.Source, *p.source) || (p.snapshot.Candidate.Fingerprint != nil && *p.snapshot.Candidate.Fingerprint != op.ToFingerprint) || (op.Stage != "committed" && p.credentialRevision != op.CredentialRevision) {
			return fail("operation_pending", "account_change_binding", "confirmed candidate differs from the original unresolved account change")
		}
		if err := a.launchAccountOperation(p, request.Platform, op, true, false, true); err != nil {
			return accountSnapshotCopy(p.snapshot), err
		}
		return accountSnapshotCopy(p.snapshot), nil
	}
	if p.snapshot.Candidate.Fingerprint != nil && *p.snapshot.Candidate.Fingerprint == p.selected.Fingerprint {
		return fail("identity_unchanged", "account_change_identity", "candidate identity is unchanged; token renewal does not require account confirmation")
	}
	id, err := desktopOperationID()
	if err != nil {
		return DesktopAccountSnapshot{}, err
	}
	op := desktopPendingOperation{ID: id, Kind: "confirm_change", Stage: "intent", Source: *p.source, CredentialRevision: p.credentialRevision, FromFingerprint: p.selected.Fingerprint, FromGeneration: p.selected.Generation, StartedAt: a.now().UTC()}
	if p.snapshot.Candidate.Fingerprint != nil {
		op.ToFingerprint = *p.snapshot.Candidate.Fingerprint
	}
	if err := a.launchAccountOperation(p, request.Platform, op, false, false, true); err != nil {
		return accountSnapshotCopy(p.snapshot), err
	}
	return accountSnapshotCopy(p.snapshot), nil
}

func (a *DesktopAccounts) performAccountChange(ctx context.Context, platform string, op desktopPendingOperation, reconcile, allowConfirm bool) (selected *desktopAccountSelection, pending *desktopPendingOperation, result error) {
	var completedMaintenance *DesktopLoginMaintenance
	if reconcile {
		pending = &op
	}
	if a.runtime == nil {
		return nil, pending, fmt.Errorf("account change has no owned runtime")
	}
	if !reconcile {
		fingerprint, err := a.selectionSource(ctx, platform, op)
		if err != nil {
			return nil, pending, err
		}
		if fingerprint == op.FromFingerprint {
			return nil, pending, accountFailure(platform, "identity_unchanged", "account_change_identity", "candidate identity is unchanged; token renewal does not require account confirmation")
		}
		op.ToFingerprint = fingerprint
	}
	owned, finish, err := a.runtime.selectionBarrier(ctx, platform, false)
	if err != nil {
		return nil, pending, err
	}
	defer func() { finish(selected, result == nil) }()
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return nil, pending, err
	}
	defer func() {
		release()
		if completedMaintenance != nil {
			p, unlock, _ := a.acquire(context.Background(), platform)
			p.snapshot.LoginMaintenance = completedMaintenance
			p.snapshot.Revision++
			unlock()
		}
	}()
	state, err := a.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return nil, pending, err
	}
	scope, err := a.selectionScope(session, state, nil)
	if err != nil {
		return nil, pending, err
	}
	if saved, ok := scope.PendingOperations[platform]; ok {
		if !reconcile || saved.ID != op.ID {
			return nil, &saved, fmt.Errorf("account change has a different unresolved operation")
		}
		op = saved
		pending = &op
	} else if reconcile {
		return nil, pending, fmt.Errorf("account change durable operation is absent; original result remains unconfirmed")
	}
	if scope.Session.Active && !owned {
		if err = a.runtime.repairRetiredAccountSession(session, state); err != nil {
			return nil, pending, fmt.Errorf("account change blocked by an unclean session: %w", err)
		}
	}
	if !reconcile {
		original, ok := scope.Selections[platform]
		if !ok || original.Fingerprint != op.FromFingerprint || original.Generation != op.FromGeneration {
			return nil, nil, fmt.Errorf("saved account selection changed before confirmation")
		}
		fingerprint, err := a.selectionSource(ctx, platform, op)
		if err != nil {
			return nil, nil, err
		}
		op.ToFingerprint = fingerprint
		account, err := selectionHiveAccount(ctx, state, platform)
		if err != nil {
			return nil, nil, err
		}
		if account.AccountFingerprint != original.Fingerprint || account.Generation < 1 || account.Generation != original.Generation || account.Generation >= desktopMaxRevision {
			return nil, nil, fmt.Errorf("registered account differs from saved selection: fingerprint_match=%t generation=%d expected=%d", account.AccountFingerprint == original.Fingerprint, account.Generation, original.Generation)
		}
		if fingerprint == account.AccountFingerprint {
			return nil, nil, fmt.Errorf("candidate identity is unchanged; token renewal does not require account confirmation")
		}
		if account.PendingFingerprint != "" && account.PendingFingerprint != fingerprint {
			return nil, nil, fmt.Errorf("Hive pending candidate differs from the user-confirmed source")
		}
		op.ConfirmationID = account.ConfirmationID
		_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
			if _, ok := s.PendingOperations[platform]; ok {
				return fmt.Errorf("account change intent collision")
			}
			s.PendingOperations[platform] = op
			return nil
		})
		if err != nil {
			return nil, &op, err
		}
		pending = &op
		// Persist the uncertainty boundary before sending pause. Reconciliation only
		// reads its result, and never repeats this PUT.
		op.Stage = "paused"
		if err = a.saveAccountChange(session, state, platform, op); err != nil {
			return nil, pending, err
		}
		yes := true
		written, writeErr := desktopSupplyCall(ctx, state, platform, &yes)
		if writeErr == nil && !written.Paused {
			return nil, pending, fmt.Errorf("account change pause PUT returned paused=false; result requires read-only reconciliation")
		}
	}
	supply, err := desktopSupplyCall(ctx, state, platform, nil)
	if err != nil {
		return nil, pending, err
	}
	if !supply.Paused {
		return nil, pending, fmt.Errorf("account change pause unconfirmed: GET paused=false; original PUT is not replayed")
	}
	if !allowConfirm && (op.Stage == "intent" || op.Stage == "paused") {
		return nil, pending, accountFailure(platform, "confirmation_not_submitted", "account_change_submission", fmt.Sprintf("account confirmation was not submitted: stage=%s; an explicit confirmation is required to continue", op.Stage))
	}
	if err := ctx.Err(); err != nil {
		return nil, pending, err
	}
	// Before the sole confirm POST, source and pending are rechecked under the
	// platform worker barrier. Submitted/confirmed operations only query confirm.
	var synchronized desktopAccountSelection
	result = a.runtime.withAccountConnection(ctx, session, state, func(live context.Context, lease string) error {
		account, err := selectionHiveAccount(live, state, platform)
		if err != nil {
			return err
		}
		submitted := slices.Contains([]string{"submitted", "reconciling", "confirmed", "committed", "synchronized"}, op.Stage)
		if !submitted {
			if account.AccountFingerprint != op.FromFingerprint || account.Generation != op.FromGeneration {
				return fmt.Errorf("account changed before confirmation submission: generation=%d expected=%d", account.Generation, op.FromGeneration)
			}
			if _, err = a.selectionSource(live, platform, op); err != nil {
				return err
			}
			if account.PendingFingerprint == "" {
				if op.ConfirmationID != "" {
					return fmt.Errorf("original Hive pending confirmation expired; no replacement confirmation is submitted")
				}
				if err = a.reportAccountChangeCandidate(live, state, lease, platform, op, account); err != nil {
					return err
				}
				account, err = selectionHiveAccount(live, state, platform)
				if err != nil {
					return err
				}
			}
			if account.AccountFingerprint != op.FromFingerprint || account.Generation != op.FromGeneration || account.Status != "confirmation_required" || account.PendingFingerprint != op.ToFingerprint || account.ConfirmationID == "" || op.ConfirmationID != "" && op.ConfirmationID != account.ConfirmationID {
				return fmt.Errorf("Hive pending confirmation changed: generation=%d expected=%d candidate_match=%t original_confirmation_match=%t", account.Generation, op.FromGeneration, account.PendingFingerprint == op.ToFingerprint, op.ConfirmationID == "" || op.ConfirmationID == account.ConfirmationID)
			}
			op.ConfirmationID = account.ConfirmationID
			if _, err = a.selectionSource(live, platform, op); err != nil {
				return err
			}
			op.Stage = "submitted"
			if err = a.saveAccountChange(session, state, platform, op); err != nil {
				return err
			}
			var response beewire.PlatformAccount
			writeErr := desktopCall(live, state, "/api/bee/platforms/"+platform+"/account/confirm", http.MethodPost, state.Credential, map[string]string{"account_fingerprint": op.ToFingerprint, "confirmation_id": op.ConfirmationID}, &response)
			if writeErr == nil {
				if err = validateDesktopConfirmedChange(response, platform, op); err != nil {
					return fmt.Errorf("confirm response binding rejected: %w", err)
				}
			}
			account, err = selectionHiveAccount(live, state, platform)
			if err != nil {
				return fmt.Errorf("account confirmation result unresolved: write=%v; read=%w", writeErr, err)
			}
		}
		if err = validateDesktopConfirmedChange(account, platform, op); err != nil {
			return err
		}
		// Hive has proved the exact target and next generation. Local writes
		// may have failed before any committed marker, while the official
		// client safely renewed this same identity in the meantime.
		read, failed := a.readAccountSource(live, DesktopAccountDetectRequest{Platform: platform, Directory: op.Source.Directory, Store: op.Source.Store, Mode: "local"})
		currentRevision := read.revision
		read.clear()
		if failed != nil {
			return failed
		}
		source := op
		source.CredentialRevision = currentRevision
		if _, err = a.selectionSource(live, platform, source); err != nil {
			return err
		}
		op.CredentialRevision = currentRevision

		if op.Stage != "committed" {
			op.Stage = "confirmed"
			if err = a.saveAccountChange(session, state, platform, op); err != nil {
				return err
			}
		}
		_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
			if s.PendingOperations[platform].ID != op.ID {
				return fmt.Errorf("account change commit operation ID changed")
			}
			current := s.Selections[platform]
			if op.Stage == "committed" {
				if current.Fingerprint != op.ToFingerprint || current.Generation != op.FromGeneration+1 || !sameDesktopAuthorizationSource(current.Source, op.Source) {
					return fmt.Errorf("committed account change selection no longer matches original operation")
				}
				selected = &current
				return nil
			}
			if current.Fingerprint != op.FromFingerprint || current.Generation != op.FromGeneration {
				return fmt.Errorf("original selection changed before local account commit")
			}
			current = desktopAccountSelection{Source: op.Source, Fingerprint: op.ToFingerprint, Generation: account.Generation, CredentialRevision: op.CredentialRevision, Revision: current.Revision + 1}
			s.Selections[platform] = current
			selected = &current
			op.Stage = "committed"
			s.PendingOperations[platform] = op
			s.RuntimeIntent.ResumePlatforms = slices.DeleteFunc(s.RuntimeIntent.ResumePlatforms, func(p string) bool { return p == platform })
			return nil
		})
		if err != nil {
			return err
		}
		synchronized, err = a.synchronizeAccountChange(live, state, lease, platform, *selected)
		return err
	})
	if result != nil {
		return
	}
	if result = ctx.Err(); result != nil {
		return
	}
	// Keep durable pending evidence until both synchronization and owned
	// connection cleanup have succeeded; a failed save remains retryable.
	if _, result = a.selectionSource(ctx, platform, desktopPendingOperation{Source: synchronized.Source, ToFingerprint: synchronized.Fingerprint, CredentialRevision: synchronized.CredentialRevision}); result != nil {
		return
	}
	// The confirmed account operation is the durable link between the old login
	// selection and its explicitly approved successor. Retain it until the login
	// journal has also committed; a journal failure must remain read-only repairable.
	completedMaintenance, result = a.completeLoginAccountChange(session, state, platform, synchronized)
	if result != nil {
		return
	}
	_, result = a.selectionScope(session, state, func(s *desktopAccountScope) error {
		if s.PendingOperations[platform].ID != op.ID || s.Selections[platform].Revision != selected.Revision {
			return fmt.Errorf("account change synchronization commit no longer owns selection")
		}
		if synchronized.CredentialRevision != selected.CredentialRevision {
			synchronized.Revision++
		}
		s.Selections[platform] = synchronized
		delete(s.PendingOperations, platform)
		return nil
	})
	if result == nil {
		selected = &synchronized
		pending = nil
	}

	return
}
func (a *DesktopAccounts) saveAccountChange(session *desktopDeviceSession, state localState, platform string, op desktopPendingOperation) error {
	_, err := a.selectionScope(session, state, func(s *desktopAccountScope) error {
		if s.PendingOperations[platform].ID != op.ID {
			return fmt.Errorf("account change operation ID differs from durable intent")
		}
		s.PendingOperations[platform] = op
		return nil
	})
	return err
}
func validateDesktopConfirmedChange(account beewire.PlatformAccount, platform string, op desktopPendingOperation) error {
	if err := validateDesktopHiveAccount(account, platform); err != nil {
		return err
	}
	if account.AccountFingerprint != op.ToFingerprint || account.Generation != op.FromGeneration+1 || account.PendingFingerprint != "" || account.ConfirmationID != "" || !slices.Contains([]string{"source_unavailable", "ready"}, account.Status) {
		return fmt.Errorf("account confirmation remains unresolved: fingerprint_match=%t generation=%d expected=%d pending=%t status=%s; confirm POST must not be replayed", account.AccountFingerprint == op.ToFingerprint, account.Generation, op.FromGeneration+1, account.PendingFingerprint != "", account.Status)
	}
	return nil
}
func (a *DesktopAccounts) reportAccountChangeCandidate(ctx context.Context, state localState, lease, platform string, op desktopPendingOperation, observed beewire.PlatformAccount) error {
	read, failure := a.readAccountSource(ctx, DesktopAccountDetectRequest{Platform: platform, Directory: op.Source.Directory, Store: op.Source.Store, Mode: "local"})
	defer read.clear()
	if failure != nil {
		return failure
	}
	if read.revision != op.CredentialRevision {
		return fmt.Errorf("account change candidate revision changed before reporting")
	}
	request := beewire.MaintenanceRequest{Lease: lease, ExpectedGeneration: observed.Generation, ExpectedRevision: observed.CredentialRevision}
	if platform == "openai" {
		request.Codex = read.codex.metadata()
	} else {
		cfg, err := a.runtime.configForSelection(platform, desktopAccountSelection{Source: op.Source})
		if err != nil {
			return err
		}
		_, auth, err := cfg.Claude.authorization(ctx)
		if err != nil {
			return err
		}
		if auth.AccountFingerprint != op.ToFingerprint || auth.CredentialRevision != op.CredentialRevision {
			return fmt.Errorf("Claude candidate changed before report")
		}
		request.Claude = &auth
	}
	var result beewire.MaintenanceResponse
	// Report metadata only. Any returned maintenance task is not executed until
	// the user-confirmed account and generation are proved after confirm.
	return desktopCall(ctx, state, "/api/bee/maintenance", http.MethodPost, state.Credential, request, &result)
}
func (a *DesktopAccounts) synchronizeAccountChange(ctx context.Context, state localState, lease, platform string, selection desktopAccountSelection) (desktopAccountSelection, error) {
	if err := a.runtime.prepareAccountChangeForwarding(platform); err != nil {
		return selection, err
	}
	cfg, err := a.runtime.configForSelection(platform, selection)
	if err != nil {
		return selection, err
	}
	cfg.Capabilities = nil
	var receipt *desktopSynchronizationReceipt
	if platform == "openai" {
		err = cfg.synchronize(ctx, state, lease, io.Discard, true)
		receipt = cfg.synchronized
	} else {
		cfg.Claude.Capabilities = false
		err = cfg.Claude.synchronize(ctx, state, lease, io.Discard, true)
		receipt = cfg.Claude.synchronized
	}
	if err != nil {
		return selection, err
	}
	if receipt == nil || receipt.lease != lease || receipt.fingerprint != selection.Fingerprint || receipt.generation != selection.Generation {
		return selection, fmt.Errorf("new account authorization synchronization has no matching owned receipt")
	}
	account, err := selectionHiveAccount(ctx, state, platform)
	if err != nil {
		return selection, err
	}
	if account.Status != "ready" || account.AccountFingerprint != selection.Fingerprint || account.Generation != selection.Generation || account.CredentialRevision != receipt.revision || account.PendingFingerprint != "" {
		return selection, fmt.Errorf("new account synchronization readback differs from receipt: status=%s generation=%d expected=%d", account.Status, account.Generation, selection.Generation)
	}
	op := desktopPendingOperation{Source: selection.Source, ToFingerprint: selection.Fingerprint, CredentialRevision: receipt.revision}
	if _, err = a.selectionSource(ctx, platform, op); err != nil {
		return selection, err
	}
	supply, err := desktopSupplyCall(ctx, state, platform, nil)
	if err != nil {
		return selection, err
	}
	if !supply.Paused {
		return selection, fmt.Errorf("new account lost manual pause during synchronization")
	}
	selection.CredentialRevision = receipt.revision
	return selection, nil
}
