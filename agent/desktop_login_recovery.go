package bee

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func desktopLoginBindingMatches(session *desktopDeviceSession, state localState, record *desktopLoginRecord) bool {
	session.mu.Lock()
	digest := hex.EncodeToString(session.bindingDigest[:])
	session.mu.Unlock()
	return state.Identity != nil && state.Hive == record.Hive && state.Identity.ID == record.DeviceID && state.Identity.OwnerID == record.OwnerID && digest == record.BindingDigest
}

// Loading publishes the original operation without attaching it to this
// instance's process jobs. Only an explicit/background read-only recheck may
// settle the separate maintenance state after acquiring the original guard.
func (a *DesktopAccounts) loadLoginMaintenance(ctx context.Context, p *desktopAccountPlatform, platform string) (*desktopLoginRecord, error) {
	if a.device == nil || p.snapshot.LoginMaintenance != nil {
		return nil, nil
	}
	path, err := a.device.configPath()
	if err != nil {
		return nil, err
	}
	// Pure source detection owns no device write. Absence needs no management
	// lock; every later write still reopens the journal under device ownership
	// and rejects any unresolved record, including one created after this read.
	if _, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(path), "login-maintenance.json")); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	state, _, err := session.readBinding()
	if err != nil {
		return nil, err
	}
	journal, err := readDesktopLoginJournal(session)
	if err != nil {
		return nil, err
	}
	if state.Identity == nil {
		if len(journal.Records) != 0 {
			return nil, fmt.Errorf("login maintenance ownership unconfirmed: identity_present=false records=%d; original journal retained", len(journal.Records))
		}
		return nil, nil
	}
	key := desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID) + ":" + platform
	record, found := journal.Records[key]
	if !found {
		for _, old := range journal.Records {
			if *old.Public.Operation.Platform == platform && old.Public.Phase != "restored" {
				return nil, fmt.Errorf("login maintenance scope mismatch: platform=%s; unresolved original scope retained", platform)
			}
		}
		return nil, nil
	}
	markDesktopInterruptedLogin(&record)
	if record.Public.Phase != "restored" {
		record.Public.Phase, record.Public.CanRecheck = "blocked", true
		record.Public.Error = accountFailure(platform, "login_recovery_required", "original_login_process", "original login maintenance requires read-only verification of process stop, device ownership and source")
	}
	if !desktopLoginBindingMatches(session, state, &record) {
		record.Public.Phase, record.Public.CanRecheck = "blocked", true
		record.Public.Error = accountFailure(platform, "login_binding_changed", "login_maintenance_binding", "saved device binding digest differs from original login maintenance; original journal retained")
	}
	p.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(record.Public)
	p.snapshot.Revision++
	return &record, nil
}

func markDesktopInterruptedLogin(record *desktopLoginRecord) {
	if record.Public.Operation.State == "pending" || record.Public.Operation.State == "running" {
		record.Public.Operation.State = "unknown"
		record.Public.Operation.Error = accountFailure(*record.Public.Operation.Platform, "authorization_result_unknown", "original_login_process", "previous management process ended without a confirmed official login result; read-only source recovery cannot determine that result")
	}
}

func (a *DesktopAccounts) verifyLoginRecoverySession(ctx context.Context, state localState, scope desktopAccountScope, record *desktopLoginRecord) error {
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	guard, guardErr := readDesktopAccountBytes(filepath.Join(filepath.Dir(session.path), "runtime-session"))
	release()
	if guardErr != nil && !errors.Is(guardErr, os.ErrNotExist) {
		return fmt.Errorf("login recovery runtime guard read: %w", guardErr)
	}
	owned := false
	recoveryRun := ""
	if r := a.runtime; r != nil {
		r.mu.Lock()
		current := r.snapshot.RunID
		owned = current != nil && r.ownedSession != nil && r.ownedSession.run == *current && r.ownedSession.scope == desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID) && scope.Session.Active && scope.Session.RunID == *current && guardErr == nil && bytes.Equal(guard, []byte(*current+"\n")) && !r.closed && !r.presence.shutdown && (r.snapshot.Local == "starting" || r.snapshot.Local == "running")
		if owned {
			recoveryRun = *current
		}
		r.mu.Unlock()
	}
	if !owned && (scope.Session.Active || !scope.Session.Clean || guardErr == nil && !bytes.Equal(guard, []byte("clean\n"))) {
		return fmt.Errorf("login recovery blocked by unowned runtime evidence: active=%t clean=%t guard_clean=%t; explicit runtime recovery required", scope.Session.Active, scope.Session.Clean, guardErr == nil && bytes.Equal(guard, []byte("clean\n")))
	}
	if recoveryRun != "" {
		slot := a.runtime.slots[*record.Public.Operation.Platform]
		if err := slot.gate.lock(ctx); err != nil {
			return err
		}
		slot.loginRecoveryRun = recoveryRun
		slot.gate.unlock()
	}
	return nil
}
