package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// dialPeer connects to a peer that answers pings only while answer is true:
// coder/websocket replies to a ping from inside Read, so a peer that does not
// read stands for one whose pong is stuck behind tunnel traffic.
func dialPeer(t *testing.T, answer bool) *websocket.Conn {
	t.Helper()
	if answer {
		return dialLatePeer(t, 0)
	}
	return dialLatePeer(t, -1)
}

// dialLatePeer connects to a peer that starts answering pings after delay,
// as over a link that held the connection still and then carried on; a
// negative delay never answers.
func dialLatePeer(t *testing.T, delay time.Duration) *websocket.Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		if delay < 0 {
			<-r.Context().Done()
			return
		}
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
		_, _, _ = conn.Read(r.Context())
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return conn
}

// shortWaits scales the pong wait and the stall limit down for a test.
func shortWaits(t *testing.T) {
	previousWait, previousLimit := pongWait, stallLimit
	pongWait, stallLimit = 50*time.Millisecond, 300*time.Millisecond
	t.Cleanup(func() { pongWait, stallLimit = previousWait, previousLimit })
}

// untilStalled checks until the connection is given up on, and reports how
// long that took.
func untilStalled(t *testing.T, liveness *Liveness, ctx context.Context) time.Duration {
	t.Helper()
	started := time.Now()
	for {
		err := liveness.Check(ctx)
		if errors.Is(err, ErrStalled) {
			return time.Since(started)
		}
		if err != nil {
			t.Fatalf("check: %v", err)
		}
		if time.Since(started) > 5*time.Second {
			t.Fatal("a silent connection was never given up on")
		}
	}
}

func TestLivenessAcceptsPong(t *testing.T) {
	conn := dialPeer(t, true)
	// A client reads to receive its pong.
	ctx := conn.CloseRead(context.Background())
	if err := NewLiveness(conn, nil).Check(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestLivenessKeepsBusyConnectionUntilTrafficStops(t *testing.T) {
	shortWaits(t)
	conn := dialPeer(t, false)
	ctx := conn.CloseRead(context.Background())
	var moved atomic.Uint64
	liveness := NewLiveness(conn, moved.Load)
	moved.Add(16 << 10)
	if err := liveness.Check(ctx); err != nil {
		t.Fatalf("connection moving tunnel bytes failed its heartbeat: %v", err)
	}
	moved.Add(1)
	if err := liveness.Check(ctx); err != nil {
		t.Fatalf("second busy heartbeat: %v", err)
	}
	// Silent from here on: given up on once the stall limit has passed.
	if took := untilStalled(t, liveness, ctx); took < stallLimit-pongWait {
		t.Fatalf("silent connection given up on after %v, inside the %v limit", took, stallLimit)
	}
}

func TestLivenessWithoutTunnelNeedsPong(t *testing.T) {
	shortWaits(t)
	conn := dialPeer(t, false)
	ctx := conn.CloseRead(context.Background())
	if took := untilStalled(t, NewLiveness(conn, nil), ctx); took < stallLimit {
		t.Fatalf("no pong given up on after %v, inside the %v limit", took, stallLimit)
	}
}

// A link that holds the connection still for longer than a pong wait and then
// carries on keeps its connection: the late pong counts.
func TestLivenessRidesOutAShortStall(t *testing.T) {
	shortWaits(t)
	conn := dialLatePeer(t, 4*pongWait)
	ctx := conn.CloseRead(context.Background())
	liveness := NewLiveness(conn, nil)
	started := time.Now()
	for time.Since(started) < stallLimit {
		if err := liveness.Check(ctx); err != nil {
			t.Fatalf("a %v stall ended the connection: %v", 4*pongWait, err)
		}
	}
	if !liveness.heard.After(started.Add(4 * pongWait)) {
		t.Fatal("the late pong was not heard")
	}
}
