package bee

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// A confirmed selection may advance an already verified zero-account waiting
// owner. Stopped/failed scopes and legacy saved intent are never upgraded here.
func (r *DesktopRuntime) maintainSelectedAccounts() {
	ctx, cancel := context.WithTimeout(r.ctx, 12*time.Second)
	defer cancel()
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.accounts.closed || r.userStopRequested || r.snapshot.Local != "waiting" || !r.presence.enabled || r.presence.shutdown || r.presence.suspended {
		return
	}
	if len(r.accounts.activeActions) != 0 {
		// The last completing worker retries admission, including when it fails.
		return
	}
	if err := r.admitSelectedAccountsLocked(ctx); err != nil {
		// An automatic start is separate from the account operation that woke
		// it. Keep its failure on the runtime, never on an unrelated platform.
		r.snapshot.Local = "failed"
		r.snapshot.Revision++
		id, idErr := desktopOperationID()
		failure := errors.Join(err, idErr)
		r.snapshot.ConnectionDetail = &DesktopConnectionDetail{Failure: observedConnectionFailure(failure, nil, r.presence.state, "", "synchronize"), Retry: "halted"}
		if idErr == nil {
			r.snapshot.Operation = &DesktopOperation{ID: id, Kind: "start", State: "failed", Revision: r.snapshot.Revision, Error: accountFailure("unknown", "automatic_maintenance_failed", "automatic_maintenance", failure.Error())}
			r.snapshot.StartupProgress = nil
		}
	}
}

// Caller owns runtime admission. No unknown account operation is advanced here.
func (r *DesktopRuntime) admitSelectedAccountsLocked(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("automatic maintenance admission context: %w", err)
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	state, bindingRevision, err := session.readBinding()
	if err == nil && (!sameDesktopConnectionBinding(state, r.presence.state) || bindingRevision != r.presence.request.BindingRevision || r.network.Revision != r.presence.request.NetworkRevision) {
		err = fmt.Errorf("automatic maintenance waiting context changed: binding_match=%t binding_revision=%d expected_binding_revision=%d network_revision=%d expected_network_revision=%d", sameDesktopConnectionBinding(state, r.presence.state), bindingRevision, r.presence.request.BindingRevision, r.network.Revision, r.presence.request.NetworkRevision)
	}
	if err == nil {
		var scope desktopAccountScope
		scope, err = r.accounts.selectionScope(session, state, nil)
		if err == nil && len(scope.PendingOperations) != 0 {
			// The original account operation already exposes its unresolved
			// result. Its next read-only settlement will retry this admission.
			release()
			return nil
		}
		if err == nil && len(scope.Selections) == 0 {
			release()
			return nil
		}
		if err == nil && (scope.Session.Active || !scope.Session.Clean) {
			err = fmt.Errorf("automatic maintenance session unconfirmed: active=%t clean=%t; required=inactive clean owned waiting session", scope.Session.Active, scope.Session.Clean)
		}
	}
	if err == nil {
		var guard []byte
		guard, err = readDesktopAccountBytes(filepath.Join(filepath.Dir(session.path), "runtime-session"))
		if errors.Is(err, os.ErrNotExist) {
			err = nil
		} else if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
			err = fmt.Errorf("automatic maintenance recovery guard is not clean; explicit recovery required")
		}
	}
	release()
	if err != nil {
		return err
	}
	_, err = r.beginStartLocked(ctx, DesktopStartRequest{ExpectedRevision: r.snapshot.Revision, ResumePlatforms: []string{}}, false)
	return err
}
