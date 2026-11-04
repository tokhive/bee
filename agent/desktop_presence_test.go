package bee

import (
	"context"
	"github.com/coder/websocket"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func enableTestPresence(t *testing.T, r *DesktopRuntime) DesktopPresenceRequest {
	t.Helper()
	c, err := r.device.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	s, err := r.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	req := DesktopPresenceRequest{BindingRevision: c.BindingRevision, NetworkRevision: s.NetworkRevision}
	if err := r.EnablePresence(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	return req
}

func TestDesktopPresenceWithoutAccountsAndLifecycleStops(t *testing.T) {
	for _, reason := range []string{"user_stop", "app_exit", "update", "network_change"} {
		t.Run(reason, func(t *testing.T) {
			var connections, active, writes atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if desktopSupplyServeIdentity(w, q) {
					return
				}
				if q.URL.Path != "/api/bee/connect" {
					writes.Add(1)
					w.WriteHeader(500)
					return
				}
				c, err := websocket.Accept(w, q, nil)
				if err != nil {
					return
				}
				defer c.CloseNow()
				active.Add(1)
				defer active.Add(-1)
				connections.Add(1)
				<-c.CloseRead(q.Context()).Done()
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			req := enableTestPresence(t, r)
			s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
			if s.Local != "stopped" || s.RunID != nil || s.Operation != nil || writes.Load() != 0 {
				t.Fatalf("presence started contribution: %+v writes=%d", s, writes.Load())
			}
			if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: reason}); err != nil {
				t.Fatal(err)
			}
			s = waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
			if !s.StopReceipt.WorkersStopped {
				t.Fatal("stop did not join workers")
			}
			if reason == "user_stop" {
				waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
				if connections.Load() != 2 {
					t.Fatal("presence not restored")
				}
			} else {
				_ = r.EnablePresence(context.Background(), req)
				time.Sleep(50 * time.Millisecond)
				if active.Load() != 0 || connections.Load() != 1 {
					t.Fatalf("stop reconnected: active=%d connections=%d", active.Load(), connections.Load())
				}
			}
			if writes.Load() != 0 {
				t.Fatal("presence wrote contribution data")
			}
		})
	}
}

func TestDesktopPresenceFirstConflictAndRevisionFences(t *testing.T) {
	var connects atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) { connects.Add(1); w.WriteHeader(409) })
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, req := range []DesktopPresenceRequest{{BindingRevision: c.BindingRevision + 1}, {BindingRevision: c.BindingRevision, NetworkRevision: 1}} {
		if err := r.EnablePresence(context.Background(), req); err == nil {
			t.Fatal("stale presence admission accepted")
		}
	}
	req := enableTestPresence(t, r)
	s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "occupied" })
	if s.Local != "stopped" || s.ConnectionDetail.Retry != "halted" {
		t.Fatalf("bad conflict state %+v", s)
	}
	if err := r.EnablePresence(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	if connects.Load() != 1 {
		t.Fatal("first conflict retried or stale revision dialed")
	}
}

func TestDesktopPresenceAccountHandoffWaitsForRetirement(t *testing.T) {
	var occupied atomic.Bool
	var connects, conflicts, actions atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if !occupied.CompareAndSwap(false, true) {
			conflicts.Add(1)
			w.WriteHeader(409)
			return
		}
		defer occupied.Store(false)
		w.Header().Set("X-Bee-Lease", "presence-test-lease")
		c, err := websocket.Accept(w, q, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		connects.Add(1)
		<-c.CloseRead(q.Context()).Done()
		// Hive's registry cleanup may lag the local socket close.
		time.Sleep(70 * time.Millisecond)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err = r.withAccountConnection(ctx, session, state, func(ctx context.Context, lease string) error {
		if lease != "presence-test-lease" {
			t.Errorf("wrong lease: %q", lease)
		}
		actions.Add(1)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" && connects.Load() == 3 })
	if actions.Load() != 1 || conflicts.Load() == 0 {
		t.Fatalf("handoff actions=%d conflicts=%d", actions.Load(), conflicts.Load())
	}
	scope, err := a.selectionScope(session, state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if scope.RuntimeIntent.Running || scope.Session.Active || !scope.Session.Clean {
		t.Fatalf("account handoff changed contribution/cleanup: %+v", scope.Session)
	}
}

func TestDesktopPresenceNetworkAndRecoveryRetireOldWorker(t *testing.T) {
	var active atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		c, err := websocket.Accept(w, q, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		active.Add(1)
		defer active.Add(-1)
		<-c.CloseRead(q.Context()).Done()
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	old := enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := r.EnablePresence(context.Background(), old); err == nil {
		t.Fatal("old network enabled")
	}
	enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	end, err := d.recoveryAdmission(session)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.EnablePresence(context.Background(), DesktopPresenceRequest{BindingRevision: old.BindingRevision, NetworkRevision: 1}); err == nil {
		t.Fatal("recovery barrier bypassed")
	}
	s, _ := r.Snapshot(context.Background())
	if s.Connection != "disconnected" {
		t.Fatal("old presence survived recovery")
	}
	end()
	enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	r.Close()
	if r.presence.done != nil && !channelClosed(r.presence.done) {
		t.Fatal("Close did not join presence")
	}
}

func TestDesktopPresenceExitCoalescesUserStopWithoutReconnect(t *testing.T) {
	var connections atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		c, e := websocket.Accept(w, q, nil)
		if e != nil {
			return
		}
		defer c.CloseNow()
		connections.Add(1)
		<-c.CloseRead(q.Context()).Done()
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	enableTestPresence(t, r)
	s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	joined := make(chan struct{})
	r.mu.Lock()
	r.runCancel = func() {}
	r.runDone = joined
	r.mu.Unlock()
	op, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: "user_stop"})
	if err != nil {
		close(joined)
		t.Fatal(err)
	}
	s, _ = r.Snapshot(context.Background())
	exit, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: "app_exit"})
	close(joined)
	if err != nil || exit.ID != op.ID {
		t.Fatalf("exit failed to suppress in-flight user stop: %+v %v", exit, err)
	}
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
	time.Sleep(40 * time.Millisecond)
	if connections.Load() != 1 {
		t.Fatal("exiting user stop reconnected")
	}
}

func TestDesktopPresenceStartupCleanupCanBeRechecked(t *testing.T) {
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		c, e := websocket.Accept(w, q, nil)
		if e != nil {
			return
		}
		defer c.CloseNow()
		<-c.CloseRead(q.Context()).Done()
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	enableTestPresence(t, r)
	s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: "startup_recovery"}); err != nil {
		t.Fatal(err)
	}
	s = waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
	if s.Connection != "disconnected" {
		t.Fatal("cleanup did not suspend presence")
	}
	enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
}

func TestDesktopPresenceEarlyStartFailureStillJoinsRetiredWorker(t *testing.T) {
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) { desktopSupplyServeIdentity(w, q) })
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	retired := make(chan struct{})
	r.mu.Lock()
	r.presence.done = retired
	r.presence.cancel = func() {}
	r.mu.Unlock()
	if _, err := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: 0, ResumePlatforms: []string{}}); err != nil {
		close(retired)
		t.Fatal(err)
	}
	s, _ := r.Snapshot(context.Background())
	if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: "user_stop"}); err != nil {
		close(retired)
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	s, _ = r.Snapshot(context.Background())
	if s.Local != "stopping" || s.StopReceipt != nil {
		close(retired)
		t.Fatalf("stop certified before old presence joined: %+v", s)
	}
	close(retired)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt.WorkersStopped })
}

func TestDesktopPresenceLostConnectionThenRevokedIdentityHalts(t *testing.T) {
	var attempts atomic.Int32
	drop := make(chan struct{})
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if q.URL.Path != "/api/bee/connect" {
			w.WriteHeader(401)
			return
		}
		if attempts.Add(1) > 1 {
			w.WriteHeader(401)
			return
		}
		c, e := websocket.Accept(w, q, nil)
		if e != nil {
			return
		}
		defer c.CloseNow()
		live := c.CloseRead(q.Context())
		select {
		case <-drop:
		case <-live.Done():
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	req := enableTestPresence(t, r)
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	close(drop)
	s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "rejected" })
	if s.Local != "stopped" || s.ConnectionDetail.Retry != "halted" {
		t.Fatalf("revoked idle state: %+v", s)
	}
	if err := r.EnablePresence(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	if attempts.Load() != 2 {
		t.Fatalf("revoked identity retried: attempts=%d", attempts.Load())
	}
}

func TestDesktopPresenceHandoffProofCannotCrossBindings(t *testing.T) {
	var attempts atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if attempts.Add(1) > 1 {
			w.WriteHeader(409)
			return
		}
		c, e := websocket.Accept(w, q, nil)
		if e != nil {
			return
		}
		defer c.CloseNow()
		<-c.CloseRead(q.Context()).Done()
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	session, release, e := d.acquireSession(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer release()
	state, e := session.read()
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if e = r.connectDesktop(ctx, state, nil, func(o DesktopConnectionObservation) {
		if o.Connection == "connected" {
			cancel()
		}
	}); e != nil {
		t.Fatal(e)
	}
	identity := *state.Identity
	identity.ID = "another-device"
	state.Identity = &identity
	var last DesktopConnectionObservation
	ctx2, cancel2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel2()
	if e = r.connectDesktop(ctx2, state, nil, func(o DesktopConnectionObservation) { last = o }); e == nil {
		t.Fatal("other binding inherited live ownership")
	}
	if last.Connection != "occupied" || attempts.Load() != 2 {
		t.Fatalf("foreign binding retried: %+v attempts=%d", last, attempts.Load())
	}
}
