package bee

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
)

var errDesktopRuntimeIdle = errors.New("saved runtime intent is stopped")
var errDesktopRuntimeWaiting = errors.New("no selected accounts; waiting for explicit account selection")

type desktopRuntimeWaitingReservation struct{ bindingRevision int64 }

func (*desktopRuntimeWaitingReservation) Error() string { return errDesktopRuntimeWaiting.Error() }
func (*desktopRuntimeWaitingReservation) Unwrap() error { return errDesktopRuntimeWaiting }

// Reservation stays local under admission locks. The worker verifies this exact
// binding outside those locks before it may publish a successful waiting state.
func (r *DesktopRuntime) verifyWaitingDevice(ctx context.Context, expectedRevision int64) error {
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	_, revision, err := session.readBinding()
	if err != nil {
		return err
	}
	if revision != expectedRevision {
		return fmt.Errorf("waiting device binding changed before verification: actual=%d expected=%d", revision, expectedRevision)
	}
	state, err := r.accounts.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return fmt.Errorf("waiting device identity verification: %w", err)
	}
	waiting, err := r.canWaitForAccount(session, state)
	if err != nil {
		return err
	}
	if !waiting {
		return fmt.Errorf("waiting account evidence changed: eligible=false; original waiting admission cannot start contribution")
	}
	_, revision, err = session.readBinding()
	if err != nil {
		return err
	}
	if revision != expectedRevision {
		return fmt.Errorf("waiting device binding changed during verification: actual=%d expected=%d", revision, expectedRevision)
	}
	return ctx.Err()
}

// Waiting owns no contribution session and grants no account permission. Check
// persisted evidence before taking this path, including when saved intent is
// stopped: a missing selection cannot make an inherited operation/session safe.
func (r *DesktopRuntime) canWaitForAccount(session *desktopDeviceSession, state localState) (bool, error) {
	scope, err := r.accounts.selectionScope(session, state, nil)
	if err != nil {
		return false, err
	}
	if len(scope.Selections) != 0 {
		return false, nil
	}
	if desktopLegacyStopPending(scope) {
		return false, nil
	}
	if len(scope.PendingOperations) != 0 {
		return false, fmt.Errorf("account waiting blocked by unresolved account operations: count=%d", len(scope.PendingOperations))
	}
	if scope.Session.Active || !scope.Session.Clean {
		return false, fmt.Errorf("account waiting rejected: previous_session_active=%t clean=%t; explicit recovery required", scope.Session.Active, scope.Session.Clean)
	}
	guard, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(session.path), "runtime-session"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("account waiting recovery guard read: %w", err)
	}
	if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
		return false, fmt.Errorf("account waiting rejected: previous recovery guard is not clean; explicit recovery required")
	}
	return true, nil
}

// Restore is an internal lifecycle entry. It never synthesizes user consent;
// run rechecks the saved intent and clean-session evidence before any writes.
func (r *DesktopRuntime) Restore(ctx context.Context) (DesktopOperation, error) {
	return r.beginStart(ctx, DesktopStartRequest{ResumePlatforms: []string{}}, true)
}

func (r *DesktopRuntime) recoveryScope(ctx context.Context, session *desktopDeviceSession, state localState) (desktopAccountScope, error) {
	if state.Identity == nil {
		return desktopAccountScope{}, errDesktopRuntimeIdle
	}
	scope, err := r.accounts.selectionScope(session, state, nil)
	if err != nil {
		return scope, err
	}
	if !scope.RuntimeIntent.Running {
		return scope, errDesktopRuntimeIdle
	}
	if scope.Session.Active || !scope.Session.Clean {
		return scope, fmt.Errorf("automatic recovery rejected: previous_session_active=%t clean=%t; explicit recovery required", scope.Session.Active, scope.Session.Clean)
	}
	if len(scope.PendingOperations) > 0 {
		return scope, fmt.Errorf("automatic recovery blocked by unresolved account operations: count=%d", len(scope.PendingOperations))
	}
	return scope, nil
}

// Before manual supply writes, remove automatic-resume permission. Re-add it
// only after a successful unpause and readback on the current owned run.
func (r *DesktopRuntime) savePlatformResumeIntent(ctx context.Context, platform string, resume bool) error {
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, err := session.read()
	if err != nil {
		return err
	}
	if state.Identity == nil {
		return fmt.Errorf("save platform intent requires a saved device identity")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		s.RuntimeIntent.ResumePlatforms = slices.DeleteFunc(s.RuntimeIntent.ResumePlatforms, func(p string) bool { return p == platform })
		if resume {
			running := r.snapshot.Local == "running" && r.snapshot.RunID != nil && *r.snapshot.RunID == s.Session.RunID
			_, pending := s.PendingOperations[platform]
			if !running || !s.RuntimeIntent.Running || !s.Session.Active || pending {
				return fmt.Errorf("resume intent binding unconfirmed: owned_running=%t active=%t pending=%t", running, s.Session.Active, pending)
			}
			s.RuntimeIntent.ResumePlatforms = append(s.RuntimeIntent.ResumePlatforms, platform)
		}
		return nil
	})
	return err
}

// Caller holds r.mu and lifecycleMu. Only local storage is touched here.
func (r *DesktopRuntime) reserveRuntimeSession(ctx context.Context, run string, restoring bool) error {
	r.snapshot.LegacyStop = nil
	if restoring && r.userStopRequested {
		return errDesktopRuntimeIdle
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, bindingRevision, err := session.readBinding()
	if err != nil {
		return err
	}
	if state.Identity == nil {
		if restoring {
			// An unpaired device still has local account data. Upgrade recovery
			// must validate that data before declaring an idle restore successful.
			if err := r.accounts.verifyStoredAccountState(session); err != nil {
				return err
			}
			return errDesktopRuntimeIdle
		}
		return fmt.Errorf("runtime start requires a saved device identity")
	}
	waiting, err := r.canWaitForAccount(session, state)
	if err != nil {
		// A failed account-state read must still revoke a previous clean guard:
		// an intent save can fail during the following stop as well. Never
		// overwrite an already unconfirmed guard while recording this failure.
		if guardErr := r.reserveRecoveryGuard(session, run, true); guardErr != nil {
			return errors.Join(err, guardErr)
		}
		return err
	}
	if waiting {
		return &desktopRuntimeWaitingReservation{bindingRevision: bindingRevision}
	}
	scope, err := r.accounts.selectionScope(session, state, nil)
	if err != nil {
		if guardErr := r.reserveRecoveryGuard(session, run, true); guardErr != nil {
			return errors.Join(err, guardErr)
		}
		return err
	}
	if desktopLegacyStopPending(scope) {
		// Migration is durable but has not admitted contribution work. A crash
		// here must remain queryable without claiming/cleaning a runtime marker.
		if err := r.legacyStopPrerequisites(session, state, scope); err != nil {
			r.snapshot.LegacyStop = &DesktopLegacyStopStatus{Phase: "blocked", Platforms: desktopLegacyStopPlatforms(scope), Error: accountFailure("unknown", "legacy_stop_blocked", "legacy_stop_prerequisites", err.Error())}
			return err
		}
		r.snapshot.LegacyStop = &DesktopLegacyStopStatus{Phase: "processing", Platforms: desktopLegacyStopPlatforms(scope)}
		return nil
	}
	// Independent evidence survives a failure to read/write ai-accounts.json.
	if err = r.reserveRecoveryGuard(session, run, restoring); err != nil {
		return err
	}
	if restoring {
		if _, err = r.recoveryScope(ctx, session, state); err != nil {
			if errors.Is(err, errDesktopRuntimeIdle) {
				if cleanup := r.cleanRecoveryGuard(session); cleanup != nil {
					return cleanup
				}
			}
			return err
		}
	}
	_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		if len(s.Selections) == 0 || len(s.PendingOperations) > 0 {
			return fmt.Errorf("runtime reservation requires selections and no pending operations: selections=%d pending=%d", len(s.Selections), len(s.PendingOperations))
		}
		if restoring && (s.Session.Active || !s.Session.Clean || !s.RuntimeIntent.Running) {
			return fmt.Errorf("runtime recovery evidence changed before reservation")
		}
		s.Session = desktopSessionMarker{RunID: run, Active: true}
		return nil
	})
	if err == nil {
		r.ownedSession = &desktopRetiredAccountSession{run: run, scope: desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)}
	}
	return err
}

func (r *DesktopRuntime) verifyCleanLegacyStopGuard(session *desktopDeviceSession) error {
	guard, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(session.path), "runtime-session"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("legacy stop recovery guard read failed: %w", err)
	}
	if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
		return fmt.Errorf("legacy stop migration blocked: previous recovery guard is not clean; explicit runtime recovery required")
	}
	return nil
}

// Migration calls this only after all owner/platform pauses are confirmed and
// completion is durable. It cannot adopt an inherited dirty runtime session.
func (r *DesktopRuntime) reserveMigratedRuntimeSession(ctx context.Context, session *desktopDeviceSession, state localState, run string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if ctx.Err() != nil || r.snapshot.Local != "starting" {
		return fmt.Errorf("legacy stop runtime admission cancelled: local=%s context_cancelled=%t", r.snapshot.Local, ctx.Err() != nil)
	}
	if err := r.verifyCleanLegacyStopGuard(session); err != nil {
		return err
	}
	if err := r.reserveRecoveryGuard(session, run, true); err != nil {
		return err
	}
	_, err := r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		if s.LegacyStop.State != "completed" || !s.RuntimeIntent.Running || s.Session.Active || !s.Session.Clean || len(s.PendingOperations) > 0 {
			return fmt.Errorf("legacy stop runtime admission evidence changed: state=%s running=%t active=%t clean=%t pending=%d", s.LegacyStop.State, s.RuntimeIntent.Running, s.Session.Active, s.Session.Clean, len(s.PendingOperations))
		}
		s.Session = desktopSessionMarker{RunID: run, Active: true}
		return nil
	})
	if err == nil {
		r.ownedSession = &desktopRetiredAccountSession{run: run, scope: desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)}
	}
	return err
}

// The device lock serializes this file across processes. Only this owner may
// retire its marker, after the normal account-state stop has been persisted.
func (r *DesktopRuntime) reserveRecoveryGuard(session *desktopDeviceSession, run string, restoring bool) error {
	path := filepath.Join(filepath.Dir(session.path), "runtime-session")
	previous, err := readDesktopAccountBytes(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read recovery guard: %w", err)
	}
	if restoring && err == nil && !bytes.Equal(previous, []byte("clean\n")) {
		return fmt.Errorf("automatic recovery rejected: previous recovery guard is not clean; explicit start required")
	}
	if err = writePrivateFile(path, []byte(run+"\n"), ".runtime-session-*"); err != nil {
		return fmt.Errorf("reserve recovery guard before account-state access: %w", err)
	}
	r.recoveryGuardRun = run
	return nil
}
func (r *DesktopRuntime) cleanRecoveryGuard(session *desktopDeviceSession) error {
	path := filepath.Join(filepath.Dir(session.path), "runtime-session")
	previous, err := readDesktopAccountBytes(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read recovery guard before cleanup: %w", err)
	}
	if bytes.Equal(previous, []byte("clean\n")) {
		return nil
	}
	if r.recoveryGuardRun == "" || !bytes.Equal(previous, []byte(r.recoveryGuardRun+"\n")) {
		return fmt.Errorf("cannot clean recovery guard: current owner does not match stored run")
	}
	if err = writePrivateFile(path, []byte("clean\n"), ".runtime-session-*"); err != nil {
		return fmt.Errorf("persist clean recovery guard: %w", err)
	}
	return nil
}

// VerifyStartup validates protected local state without reserving a run, changing
// intent, launching account workers, or performing any external write.
func (r *DesktopRuntime) VerifyStartup(ctx context.Context) error {
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, err := session.read()
	if err != nil {
		return err
	}
	if err = r.accounts.verifyStoredAccountState(session); err != nil {
		return err
	}
	if state.Identity != nil {
		scope, err := r.accounts.selectionScope(session, state, nil)
		if err != nil {
			return err
		}
		if len(scope.PendingOperations) > 0 {
			return fmt.Errorf("startup verification blocked: unresolved account operations=%d; query existing operations before writes", len(scope.PendingOperations))
		}
		if len(scope.Selections) == 0 {
			if _, err := r.canWaitForAccount(session, state); err != nil {
				return err
			}
		}
	}
	path := filepath.Join(filepath.Dir(session.path), "runtime-session")
	guard, err := readDesktopAccountBytes(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("startup recovery guard read: %w", err)
	}
	if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
		r.mu.Lock()
		run := r.snapshot.RunID
		local := r.snapshot.Local
		r.mu.Unlock()
		if run == nil || (local != "running" && local != "starting") || !bytes.Equal(guard, []byte(*run+"\n")) {
			return fmt.Errorf("startup recovery guard unconfirmed: local=%s; required=clean guard or current owned running session", local)
		}
	}
	return nil
}
