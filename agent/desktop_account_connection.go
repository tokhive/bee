package bee

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
)

// A cleanup receipt lives only in the instance that joined this exact tunnel.
// A new instance cannot use it to clear an unclean session from a prior run.
type desktopRetiredAccountSession struct{ run, scope string }

func (r *DesktopRuntime) repairRetiredAccountSession(session *desktopDeviceSession, state localState) error {
	r.mu.Lock()
	proof := r.retiredAccountSession
	idle := !r.closed && r.snapshot.Local != "stopping" && r.controlDone == nil
	r.mu.Unlock()
	if proof == nil || !idle {
		return fmt.Errorf("account session cleanup unproved: owned_join_receipt=%t idle=%t", proof != nil, idle)
	}
	return r.clearRetiredAccountSession(session, state, proof)
}
func (r *DesktopRuntime) clearRetiredAccountSession(session *desktopDeviceSession, state localState, proof *desktopRetiredAccountSession) error {
	_, err := r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		r.mu.Lock()
		allowed := r.retiredAccountSession == proof && !r.closed && r.snapshot.Local != "stopping"
		r.mu.Unlock()
		if !allowed || proof.scope != desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID) || s.Session.RunID != proof.run {
			return fmt.Errorf("account session cleanup binding changed: receipt_current=%t run_match=%t", allowed, s.Session.RunID == proof.run)
		}
		s.Session.Active = false
		s.Session.Clean = true
		return nil
	})
	if err == nil {
		r.mu.Lock()
		if r.retiredAccountSession == proof {
			r.retiredAccountSession = nil
		}
		r.mu.Unlock()
	}
	return err
}

// withAccountConnection reuses the owned run, or briefly owns a tunnel with no
// allowed relay targets. A stopped user's contribution intent remains stopped.
// Hive requires a live device lease even for confirming a paused account.
func (r *DesktopRuntime) withAccountConnection(ctx context.Context, session *desktopDeviceSession, state localState, action func(context.Context, string) error) (result error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	if r.closed || r.snapshot.Local == "starting" || r.snapshot.Local == "stopping" {
		r.mu.Unlock()
		return fmt.Errorf("account connection unavailable during runtime transition or shutdown")
	}
	running := r.snapshot.Local == "running"
	if !running && r.controlDone != nil {
		r.mu.Unlock()
		return fmt.Errorf("another owned account connection is active; recheck after it finishes")
	}
	r.syncMu.Lock()
	connection := r.connection
	if running {
		valid := connection != nil && connection.active && connection.ctx.Err() == nil
		r.syncMu.Unlock()
		r.mu.Unlock()
		if !valid {
			return fmt.Errorf("account change requires the owned Hive connection; current run is disconnected")
		}
		live, cancel := context.WithCancel(ctx)
		defer cancel()
		stop := context.AfterFunc(connection.ctx, cancel)
		defer stop()
		if connection.state.Credential != state.Credential || connection.state.Hive != state.Hive || connection.state.Identity == nil || connection.state.Identity.ID != state.Identity.ID {
			return fmt.Errorf("owned account connection differs from verified device binding")
		}
		return action(live, connection.lease)
	}
	r.syncMu.Unlock()
	live, cancel := context.WithCancel(r.ctx)
	stop := context.AfterFunc(ctx, cancel)
	done := make(chan struct{})
	r.controlCancel = cancel
	r.controlDone = done
	r.workers.Add(1)
	r.mu.Unlock()
	defer func() {
		stop()
		cancel()
		r.mu.Lock()
		r.controlCancel = nil
		r.controlDone = nil
		r.snapshot.Connection = "disconnected"
		r.snapshot.Revision++
		r.mu.Unlock()
		close(done)
		r.workers.Done()
	}()
	id, err := desktopOperationID()
	if err != nil {
		return err
	}
	run := id[:32]
	_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		if s.Session.Active {
			return fmt.Errorf("account connection blocked: previous session remains active; verify owned shutdown before changing accounts")
		}
		s.Session = desktopSessionMarker{RunID: run, Active: true}
		return nil
	})
	if err != nil {
		return err
	}
	// The receipt is issued only after connectObserved has joined its action
	// and relay, and survives a failed local cleanup write in this instance.
	defer func() {
		proof := &desktopRetiredAccountSession{run: run, scope: desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)}
		r.mu.Lock()
		stopping := r.closed || r.snapshot.Local == "stopping"
		if !stopping {
			r.retiredAccountSession = proof
		}
		r.mu.Unlock()
		if stopping {
			return
		}
		result = errors.Join(result, r.clearRetiredAccountSession(session, state, proof))
	}()
	var once sync.Once
	outcome := make(chan error, 1)
	cfg := &egressConfig{Targets: []string{}, desktopAction: func(connectionCtx context.Context, _ localState, lease string, _ io.Writer) (<-chan error, func()) {
		var workers sync.WaitGroup
		once.Do(func() {
			workers.Add(1)
			go func() { defer workers.Done(); outcome <- action(connectionCtx, lease); cancel() }()
		})
		return nil, workers.Wait
	}}
	err = connectObserved(live, state, cfg, io.Discard, func(value string) { r.mu.Lock(); r.snapshot.Connection = value; r.snapshot.Revision++; r.mu.Unlock() })
	// connectObserved joins its relay and action before returning.
	select {
	case actionErr := <-outcome:
		return errors.Join(actionErr, err)
	default:
		if ctx.Err() != nil {
			return errors.Join(ctx.Err(), err)
		}
		if err != nil {
			return err
		}
		return fmt.Errorf("owned account connection ended before confirmation could run")
	}
}
