package bee

import (
	"context"
	"fmt"
	"io"
	"time"
)

// DesktopPresenceRequest is supplied only after the native owner verifies the
// saved binding and effective network. It conveys no contribution consent.
type DesktopPresenceRequest struct {
	BindingRevision int64 `json:"binding_revision"`
	NetworkRevision int64 `json:"network_revision"`
}

type desktopPresence struct {
	enabled   bool
	suspended bool
	shutdown  bool
	request   DesktopPresenceRequest
	state     localState
	lease     string
	cancel    context.CancelFunc
	done      chan struct{}
	retired   chan struct{}
}

// Accessed only while holding the connection gate, never persisted or inferred
// from credentials. Only a joined, intentionally cancelled live socket grants it.
type desktopConnectionHandoff struct {
	state   localState
	expires time.Time
}

func (r *DesktopRuntime) EnablePresence(ctx context.Context, input DesktopPresenceRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	if err := r.switchMaintenanceBarrier(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.presence.shutdown || r.presence.suspended {
		return fmt.Errorf("presence admission blocked: closed=%t shutdown=%t suspended=%t", r.closed, r.presence.shutdown, r.presence.suspended)
	}
	if err := r.device.recoveryWriteBarrier(); err != nil {
		return err
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, revision, err := session.readBinding()
	if err != nil {
		return err
	}
	if !desktopSafeRevision(input.BindingRevision) || !desktopSafeRevision(input.NetworkRevision) || revision != input.BindingRevision || r.network.Revision != input.NetworkRevision {
		return fmt.Errorf("presence context changed: binding_actual=%d binding_expected=%d network_actual=%d network_expected=%d", revision, input.BindingRevision, r.network.Revision, input.NetworkRevision)
	}
	if state.Identity == nil || state.Credential == "" {
		return fmt.Errorf("presence requires a saved device binding: identity_present=%t credential_present=%t", state.Identity != nil, state.Credential != "")
	}
	waiting, err := r.canWaitForAccount(session, state)
	if err != nil {
		return err
	}
	if waiting && !r.userStopRequested && r.snapshot.Local == "stopped" {
		r.snapshot.Local = "waiting"
		r.snapshot.Revision++
	}
	if r.presence.enabled && r.presence.request == input {
		return nil
	}
	r.cancelPresenceLocked()
	r.presence.enabled = true
	r.presence.request = input
	r.presence.state = state
	r.startPresenceLocked()
	return nil
}

// Caller holds r.mu. Invalidation happens before cancellation so old observations
// cannot overwrite a new run, binding, or a confirmed stop.
func (r *DesktopRuntime) cancelPresenceLocked() chan struct{} {
	done := r.presence.done
	if done == nil {
		return r.presence.retired
	}
	if r.presence.cancel != nil {
		r.presence.cancel()
	}
	r.presence.cancel = nil
	r.presence.done = nil
	r.presence.retired = done
	return done
}

func (r *DesktopRuntime) startPresenceLocked() {
	if !r.switchAllowsMaintenance() || r.closed || !r.presence.enabled || r.presence.shutdown || r.presence.suspended || r.presence.done != nil || r.controlDone != nil || (r.snapshot.Local != "stopped" && r.snapshot.Local != "failed" && r.snapshot.Local != "waiting") {
		return
	}
	ctx, cancel := context.WithCancel(r.ctx)
	done := make(chan struct{})
	r.presence.cancel = cancel
	r.presence.done = done
	state := r.presence.state
	previous := r.presence.retired
	r.snapshot.Connection = "connecting"
	r.snapshot.ConnectionDetail = nil
	r.snapshot.Revision++
	r.workers.Add(1)
	go func() {
		defer r.workers.Done()
		defer close(done)
		defer cancel()
		if previous != nil {
			<-previous
		}
		_ = r.connectDesktop(ctx, state, nil, func(o DesktopConnectionObservation) {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.closed || ctx.Err() != nil || r.presence.done != done {
				return
			}
			r.presence.lease = o.Lease
			r.snapshot.Connection = o.Connection
			r.snapshot.ConnectionDetail = o.Detail
			r.snapshot.Revision++
		})
		// Terminal rejection/occupation remains visible and halted. Repeated device
		// reads do not turn a failed initial ownership check into a retry loop.
	}()
}

func sameDesktopConnectionBinding(a, b localState) bool {
	return a.Hive == b.Hive && a.Credential == b.Credential && a.Identity != nil && b.Identity != nil && a.Identity.ID == b.Identity.ID && a.Identity.OwnerID == b.Identity.OwnerID
}

func (r *DesktopRuntime) connectDesktop(ctx context.Context, state localState, cfg *egressConfig, observe func(DesktopConnectionObservation)) error {
	if err := r.connectionGate.lock(ctx); err != nil {
		return err
	}
	defer r.connectionGate.unlock()
	inherited := r.handoff != nil && time.Now().Before(r.handoff.expires) && sameDesktopConnectionBinding(r.handoff.state, state)
	r.handoff = nil // consume once; a failed handoff cannot lend ownership again
	connected := false
	err := connectObservedOwned(context.WithValue(ctx, desktopReconnectKey{}, func() bool { return !r.switching.sealing.Load() }), state, cfg, io.Discard, inherited, func(o DesktopConnectionObservation) {
		connected = o.Connection == "connected"
		observe(o)
	})
	if ctx.Err() != nil && connected {
		r.handoff = &desktopConnectionHandoff{state: state, expires: time.Now().Add(30 * time.Second)}
	}
	return err
}

type desktopReconnectKey struct{}

func desktopReconnectPermitted(ctx context.Context) bool {
	if allowed, ok := ctx.Value(desktopReconnectKey{}).(func() bool); ok {
		return allowed()
	}
	return true
}
