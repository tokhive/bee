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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		if answer {
			_, _, _ = conn.Read(r.Context())
			return
		}
		<-r.Context().Done()
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

func shortPongWait(t *testing.T) {
	previous := pongWait
	pongWait = 50 * time.Millisecond
	t.Cleanup(func() { pongWait = previous })
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
	shortPongWait(t)
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
	if err := liveness.Check(ctx); !errors.Is(err, ErrStalled) {
		t.Fatalf("silent connection: %v", err)
	}
}

func TestLivenessWithoutTunnelNeedsPong(t *testing.T) {
	shortPongWait(t)
	conn := dialPeer(t, false)
	ctx := conn.CloseRead(context.Background())
	if err := NewLiveness(conn, nil).Check(ctx); !errors.Is(err, ErrStalled) {
		t.Fatalf("no pong: %v", err)
	}
}
