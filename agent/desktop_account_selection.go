package bee

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/tokhive/bee/beewire"
)

// Close cancels only this management service's workers, then waits before the
// owner releases the shared device lock. A request timeout never orphans work.
func (a *DesktopAccounts) Close() {
	a.lifecycleMu.Lock()
	a.closed = true
	a.cancel()
	a.lifecycleMu.Unlock()
	a.workers.Wait()
}

func (a *DesktopAccounts) beginSelection(p *desktopAccountPlatform, r DesktopAccountActionRequest) (DesktopAccountSnapshot, error) {
	if p.working || p.pending != nil {
		return accountSnapshotCopy(p.snapshot), accountFailure(r.Platform, "operation_pending", "selection_operation", "an existing platform operation must be reconciled before another selection")
	}
	if a.device == nil {
		return accountSnapshotCopy(p.snapshot), accountFailure(r.Platform, "device_required", "device_binding", "selection requires a bound desktop device")
	}
	if r.Action != "clear_selection" && (p.source == nil || p.credentialRevision == "") {
		return accountSnapshotCopy(p.snapshot), accountFailure(r.Platform, "source_unavailable", "candidate_source", "current candidate has no verified source revision")
	}
	if r.Action == "clear_selection" && p.selected == nil {
		return accountSnapshotCopy(p.snapshot), accountFailure(r.Platform, "selection_missing", "clear_selection", "no persisted local selection is loaded; refresh account state first")
	}
	var id [24]byte
	if _, err := rand.Read(id[:]); err != nil {
		return DesktopAccountSnapshot{}, accountFailure(r.Platform, "reference_failed", "operation_id", err.Error())
	}
	op := desktopPendingOperation{ID: hex.EncodeToString(id[:]), Kind: "select", Stage: "intent", CredentialRevision: p.credentialRevision, StartedAt: a.now().UTC()}
	if p.source != nil {
		op.Source = *p.source
	}
	if p.snapshot.Candidate.Fingerprint != nil {
		op.ToFingerprint = *p.snapshot.Candidate.Fingerprint
	}
	if !a.launchSelection(p, r.Platform, op, false, r.Action == "clear_selection") {
		return accountSnapshotCopy(p.snapshot), accountFailure(r.Platform, "closed", "account_service", "management account service has closed")
	}
	return accountSnapshotCopy(p.snapshot), nil
}

// Caller holds only this platform's short gate. Network/disk work runs without
// it; duplicate writes remain fenced by working/pending and the durable ID.
func (a *DesktopAccounts) launchSelection(p *desktopAccountPlatform, platform string, op desktopPendingOperation, reconcile, clearSelection bool) bool {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if a.closed {
		return false
	}
	expectedSelectionRevision := int64(0)
	if clearSelection && p.selected != nil {
		expectedSelectionRevision = p.selected.Revision
	}
	if a.runtime != nil {
		a.runtime.mu.Lock()
		busy := a.runtime.snapshot.Local == "starting" || a.runtime.snapshot.Local == "stopping"
		a.runtime.mu.Unlock()
		if busy {
			return false
		}
	}
	a.activeActions[platform] = true
	p.working = true
	kind := "select"
	if clearSelection {
		kind = "clear_selection"
	}
	p.snapshot.Revision++
	p.snapshot.Operation = &DesktopOperation{ID: op.ID, Kind: kind, Platform: accountString(platform), State: "pending", Revision: p.snapshot.Revision}
	a.workers.Add(1)
	go func() {
		defer a.workers.Done()
		defer func() { a.lifecycleMu.Lock(); delete(a.activeActions, platform); a.lifecycleMu.Unlock() }()
		ctx, cancel := context.WithTimeout(a.ctx, 12*time.Second)
		defer cancel()
		selection, pending, err := a.performSelection(ctx, platform, op, reconcile, clearSelection, expectedSelectionRevision)
		// Closing cancels external work, not the final publication of its evidence.
		locked, release, _ := a.acquire(context.Background(), platform)
		defer release()
		locked.working = false
		locked.pending = pending
		locked.snapshot.Revision++
		result := locked.snapshot.Operation
		result.Revision = locked.snapshot.Revision
		result.State = "succeeded"
		if err != nil {
			result.State = "failed"
			if pending != nil {
				result.State = "reconciling"
			}
			var failure *DesktopAccountError
			if errors.As(err, &failure) {
				result.Error = failure
			} else {
				result.Error = accountFailure(platform, "selection_unconfirmed", "selection_commit", err.Error())
			}
		} else {
			locked.selected = selection
			locked.snapshot.Selection = DesktopAccountFact{State: "not_selected", ObservedAt: accountTime(a.now())}
			if selection != nil {
				locked.snapshot.Selection = DesktopAccountFact{State: "selected", Fingerprint: accountString(selection.Fingerprint), ObservedAt: accountTime(a.now())}
			}
		}
	}()
	return true
}

func (a *DesktopAccounts) verifiedSelectionDevice(ctx context.Context, session *desktopDeviceSession) (localState, error) {
	state, err := session.read()
	if err != nil {
		return state, err
	}
	if state.Identity == nil || !deviceCredentialPattern.MatchString(state.Credential) {
		return state, fmt.Errorf("selection binding absent: identity_present=%t credential_valid=%t", state.Identity != nil, deviceCredentialPattern.MatchString(state.Credential))
	}
	origin, err := hiveOrigin(state.Hive)
	if err != nil || origin != state.Hive {
		return state, fmt.Errorf("selection Hive origin is not canonical; binding rejected")
	}
	if err := validateDesktopIdentity(state, *state.Identity); err != nil {
		return state, err
	}
	var identity beewire.Identity
	if err := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, state.Credential, nil, &identity); err != nil {
		return state, err
	}
	if err := validateDesktopIdentity(state, identity); err != nil {
		return state, err
	}
	return state, nil
}

func (a *DesktopAccounts) selectionScope(session *desktopDeviceSession, state localState, mutate func(*desktopAccountScope) error) (desktopAccountScope, error) {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	current, err := session.read()
	if err != nil {
		return desktopAccountScope{}, err
	}
	if current.Identity == nil || current.Hive != state.Hive || current.Identity.ID != state.Identity.ID || current.Identity.OwnerID != state.Identity.OwnerID || current.Credential != state.Credential {
		return desktopAccountScope{}, fmt.Errorf("selection device binding changed during operation; original scope preserved")
	}
	path := filepath.Join(filepath.Dir(session.path), "ai-accounts.json")
	unlock, err := lockState(path)
	if err != nil {
		return desktopAccountScope{}, err
	}
	defer unlock()
	disk, err := readDesktopAccountState(path)
	if err != nil {
		return desktopAccountScope{}, err
	}
	key := desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)
	scope, ok := disk.Scopes[key]
	if !ok {
		scope = newDesktopAccountScope(state)
	}
	if mutate != nil {
		if err := mutate(&scope); err != nil {
			return scope, err
		}
		disk.Scopes[key] = scope
		if err := saveDesktopAccountState(path, disk, disk.Revision); err != nil {
			return scope, err
		}
	}
	return scope, nil
}

func (a *DesktopAccounts) selectionSource(ctx context.Context, platform string, op desktopPendingOperation) (string, error) {
	request := DesktopAccountDetectRequest{Platform: platform, Directory: op.Source.Directory, Store: op.Source.Store, Mode: "local"}
	read, failure := a.readAccountSource(ctx, request)
	defer read.clear()
	if failure != nil {
		return "", failure
	}
	if read.revision != op.CredentialRevision {
		return "", accountFailure(platform, "source_changed", "selection_source_revision", "source credential revision differs from the confirmed candidate")
	}
	if !a.now().Add(30 * time.Second).Before(read.expires) {
		return "", accountFailure(platform, "expired", "selection_source_expiry", "source expires within the 30-second safety boundary")
	}
	if !beewire.KnownPlan(platform, read.plan) {
		return "", accountFailure(platform, "unknown_plan", "selection_plan", "source plan is outside the supported platform plans")
	}
	fingerprint := read.fingerprint
	if platform == "claude" {
		if !read.claude.hasProfileScope || !read.claude.hasInferenceScope {
			return "", accountFailure(platform, "missing_scope", "selection_scopes", fmt.Sprintf("Claude selection requires user:profile and user:inference; profile=%t inference=%t", read.claude.hasProfileScope, read.claude.hasInferenceScope))
		}
		transport := &desktopObservationTransport{base: a.transport}
		identity, err := queryClaudeProfile(ctx, read.claude, transport)
		if err != nil {
			return "", officialObservationError(platform, "selection_profile", err.Error(), transport)
		}
		fingerprint = accountString(identity.fingerprint())
		after, failed := a.readAccountSource(ctx, request)
		defer after.clear()
		if failed != nil {
			return "", failed
		}
		if after.revision != op.CredentialRevision {
			return "", accountFailure(platform, "source_changed", "selection_source_readback", "Claude source changed during identity verification")
		}
	}
	if fingerprint == nil || !desktopAccountDigest(*fingerprint) {
		return "", accountFailure(platform, "identity_unconfirmed", "selection_fingerprint", "source identity fingerprint is absent")
	}
	if op.ToFingerprint != "" && op.ToFingerprint != *fingerprint {
		return "", accountFailure(platform, "source_changed", "selection_fingerprint", "source identity differs from the confirmed candidate")
	}
	return *fingerprint, nil
}

func selectionHiveAccount(ctx context.Context, state localState, platform string) (beewire.PlatformAccount, error) {
	var account beewire.PlatformAccount
	err := desktopCall(ctx, state, "/api/bee/platforms/"+platform+"/account", http.MethodGet, state.Credential, nil, &account)
	if err == nil {
		err = validateDesktopHiveAccount(account, platform)
	}
	return account, err
}

func (a *DesktopAccounts) performSelection(ctx context.Context, platform string, op desktopPendingOperation, reconcile, clearSelection bool, expectedSelectionRevision int64) (*desktopAccountSelection, *desktopPendingOperation, error) {
	owned := false
	finish := func(*desktopAccountSelection, bool) {}
	if a.runtime != nil {
		var err error
		owned, finish, err = a.runtime.selectionBarrier(ctx, platform)
		if err != nil {
			return nil, nil, err
		}
	}
	selection, pending, err := a.performSelectionOwned(ctx, platform, op, reconcile, clearSelection, expectedSelectionRevision, owned)
	finish(selection, err == nil)
	return selection, pending, err
}
func (a *DesktopAccounts) performSelectionOwned(ctx context.Context, platform string, op desktopPendingOperation, reconcile, clearSelection bool, expectedSelectionRevision int64, ownedBarrier bool) (*desktopAccountSelection, *desktopPendingOperation, error) {
	var pending *desktopPendingOperation
	if reconcile {
		pending = &op
	}
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return nil, pending, err
	}
	defer release()
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
			return nil, &saved, fmt.Errorf("selection has an unresolved durable operation; recheck the original operation")
		}
		op = saved
		pending = &op
	}
	if scope.Session.Active && !ownedBarrier {
		return nil, pending, fmt.Errorf("source selection blocked: session active=true; owned platform worker barrier required")
	}
	if _, ok := scope.PendingOperations[platform]; reconcile && !ok {
		return nil, pending, fmt.Errorf("pending selection is absent from persisted scope; original result remains unconfirmed")
	}
	if clearSelection {
		if selected, ok := scope.Selections[platform]; !ok || selected.Revision != expectedSelectionRevision {
			return nil, pending, fmt.Errorf("local selection changed before clear: revision=%d expected=%d", selected.Revision, expectedSelectionRevision)
		}
		account, err := selectionHiveAccount(ctx, state, platform)
		if err != nil {
			return nil, pending, err
		}
		if account.AccountFingerprint != "" || account.Generation != 0 || account.PendingFingerprint != "" {
			return nil, pending, fmt.Errorf("clear local selection blocked: registered=%t generation=%d pending=%t; registered account removal is unavailable", account.AccountFingerprint != "", account.Generation, account.PendingFingerprint != "")
		}
		_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
			if len(s.PendingOperations) > 0 {
				return fmt.Errorf("clear selection blocked by unresolved operation")
			}
			if s.RuntimeIntent.Running {
				return fmt.Errorf("clear selection blocked: runtime intent running=true")
			}
			if s.Selections[platform].Revision != expectedSelectionRevision {
				return fmt.Errorf("local selection revision changed during clear")
			}
			delete(s.Selections, platform)
			next := []string{}
			for _, item := range s.RuntimeIntent.ResumePlatforms {
				if item != platform {
					next = append(next, item)
				}
			}
			s.RuntimeIntent.ResumePlatforms = next
			return nil
		})
		return nil, nil, err
	}
	fingerprint := op.ToFingerprint
	if !reconcile {
		fingerprint, err = a.selectionSource(ctx, platform, op)
		if err != nil {
			return nil, pending, err
		}
		op.ToFingerprint = fingerprint
	}
	account, err := selectionHiveAccount(ctx, state, platform)
	if err != nil {
		return nil, pending, err
	}
	if account.PendingFingerprint != "" || account.AccountFingerprint != "" && account.AccountFingerprint != fingerprint {
		return nil, pending, fmt.Errorf("selection requires account change confirmation: registered_match=%t pending=%t", account.AccountFingerprint == fingerprint, account.PendingFingerprint != "")
	}
	if !reconcile {
		op.FromFingerprint, op.FromGeneration = account.AccountFingerprint, account.Generation
		_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
			if _, exists := s.PendingOperations[platform]; exists {
				return fmt.Errorf("selection intent collision; existing operation retained")
			}
			s.PendingOperations[platform] = op
			return nil
		})
		if err != nil {
			return nil, &op, err
		}
		pending = &op
		// Persist uncertainty before sending; restart can only query, never replay PUT.
		op.Stage = "reconciling"
		_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error { s.PendingOperations[platform] = op; return nil })
		if err != nil {
			return nil, pending, err
		}
		yes := true
		written, writeErr := desktopSupplyCall(ctx, state, platform, &yes)
		if writeErr == nil && !written.Paused {
			return nil, &op, fmt.Errorf("pause PUT returned paused=false; required=true; result unconfirmed and must be queried without replay")
		}
		if writeErr != nil {
			// A committed write may have lost its response. Only a fresh GET can prove
			// pause; the write is never submitted again by this operation.
			supply, getErr := desktopSupplyCall(ctx, state, platform, nil)
			if getErr != nil {
				return nil, &op, fmt.Errorf("pause result unresolved: %w; query failed: %w", writeErr, getErr)
			}
			if !supply.Paused {
				return nil, &op, fmt.Errorf("pause result unresolved: %w; GET paused=false", writeErr)
			}
		}
	}
	supply, err := desktopSupplyCall(ctx, state, platform, nil)
	if err != nil {
		return nil, &op, err
	}
	if !supply.Paused {
		return nil, &op, fmt.Errorf("selection pause readback failed: paused=false; original PUT must not be replayed")
	}
	latest, err := a.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return nil, &op, err
	}
	if latest.Hive != state.Hive || latest.Identity.ID != state.Identity.ID || latest.Identity.OwnerID != state.Identity.OwnerID || latest.Credential != state.Credential {
		return nil, &op, fmt.Errorf("device identity changed before selection commit")
	}
	after, err := selectionHiveAccount(ctx, state, platform)
	if err != nil {
		return nil, &op, err
	}
	if after.AccountFingerprint != op.FromFingerprint || after.Generation != op.FromGeneration || after.PendingFingerprint != "" {
		return nil, &op, fmt.Errorf("Hive account changed before selection commit: generation=%d expected=%d pending=%t", after.Generation, op.FromGeneration, after.PendingFingerprint != "")
	}
	if _, sourceErr := a.selectionSource(ctx, platform, op); sourceErr != nil {
		// The only external side effect was pause and its result is now proven.
		// End this failed selection without changing the previous selected source.
		_, saveErr := a.selectionScope(session, state, func(s *desktopAccountScope) error {
			if s.PendingOperations[platform].ID != op.ID {
				return fmt.Errorf("abandon selection operation ID changed")
			}
			delete(s.PendingOperations, platform)
			return nil
		})
		if saveErr != nil {
			return nil, &op, fmt.Errorf("source verification failed: %w; failed operation persistence: %w", sourceErr, saveErr)
		}
		return nil, nil, sourceErr
	}
	var selected desktopAccountSelection
	_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
		if s.PendingOperations[platform].ID != op.ID {
			return fmt.Errorf("selection commit operation ID no longer matches durable intent")
		}
		revision := s.Selections[platform].Revision + 1
		selected = desktopAccountSelection{Source: op.Source, Fingerprint: op.ToFingerprint, Generation: after.Generation, CredentialRevision: op.CredentialRevision, Revision: revision}
		s.Selections[platform] = selected
		delete(s.PendingOperations, platform)
		return nil
	})
	if err != nil {
		return nil, &op, err
	}
	return &selected, nil, nil
}

func (a *DesktopAccounts) loadSelection(p *desktopAccountPlatform, session *desktopDeviceSession, state localState, platform string) error {
	scope, err := a.selectionScope(session, state, nil)
	if err != nil {
		return err
	}
	p.snapshot.Revision++
	p.selected = nil
	p.snapshot.Selection = DesktopAccountFact{State: "not_selected"}
	if selected, ok := scope.Selections[platform]; ok {
		p.selected = &selected
		p.snapshot.Selection = DesktopAccountFact{State: "selected", Fingerprint: accountString(selected.Fingerprint), ObservedAt: accountTime(a.now())}
	}
	if pending, ok := scope.PendingOperations[platform]; ok {
		p.pending = &pending
		p.snapshot.Operation = &DesktopOperation{ID: pending.ID, Kind: pending.Kind, Platform: accountString(platform), State: "reconciling", Revision: p.snapshot.Revision}
	} else {
		p.pending = nil
	}
	return nil
}
