package bee

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/coder/websocket"
)

// The automatic-service recovery button reuses an explicit empty Start. It
// rechecks owned presence without selecting candidates or writing supply state.
func TestDesktopPresenceExplicitRecoveryAfterWaitingConflict(t *testing.T) {
	var attempts, writes atomic.Int32
	var occupied atomic.Bool
	occupied.Store(true)
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if q.URL.Path != "/api/bee/connect" {
			writes.Add(1)
			w.WriteHeader(500)
			return
		}
		attempts.Add(1)
		if occupied.Load() {
			w.WriteHeader(409)
			return
		}
		c, err := websocket.Accept(w, q, nil)
		if err != nil {
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
	s := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "occupied" })
	if s.Local != "waiting" || s.ConnectionDetail.Retry != "halted" {
		t.Fatalf("not halted waiting: %+v", s)
	}
	occupied.Store(false)
	if _, err := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: s.Revision, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	s = waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "waiting" && s.Connection == "connected" })
	if s.RunID != nil || attempts.Load() != 2 || writes.Load() != 0 {
		t.Fatalf("recovery changed contribution: run=%v attempts=%d writes=%d", s.RunID, attempts.Load(), writes.Load())
	}
	for p, v := range s.Platforms {
		if v.Account.Selection.State != "not_selected" {
			t.Fatalf("candidate selected: platform=%s", p)
		}
	}
}
