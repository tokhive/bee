package relay

import (
	"context"
	"github.com/coder/websocket"
	"github.com/tokhive/tee/tunnel"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSessionWaitJoinsCancelledRelayHandlers(t *testing.T) {
	entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	peer := make(chan *Session, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		s := New(r.Context(), conn, tunnel.Low, func(ctx context.Context, _ *tunnel.Stream, _ []byte) {
			close(entered)
			<-ctx.Done()
			close(cancelled)
			<-release
		}, Options{})
		peer <- s
		<-s.Context.Done()
	}))
	defer server.Close()
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	client := New(context.Background(), conn, tunnel.High, nil, Options{})
	defer client.Close()
	s := <-peer
	stream, err := client.Mux.Dial([]byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("handler did not start")
	}
	s.Close()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("handler not cancelled")
	}
	done := make(chan struct{})
	go func() { s.Wait(); close(done) }()
	select {
	case <-done:
		close(release)
		t.Fatal("wait returned before handler cleanup")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("wait did not join handler")
	}
}

// TestSessionErrCarriesThePeersCloseCode: a peer that leaves with an
// application close code is told apart from a transport that failed.
func TestSessionErrCarriesThePeersCloseCode(t *testing.T) {
	peer := make(chan *Session, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		s := New(r.Context(), conn, tunnel.Low, nil, Options{})
		peer <- s
		<-s.Context.Done()
	}))
	defer server.Close()
	dial := func() (*websocket.Conn, *Session, *Session) {
		conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil {
			t.Fatal(err)
		}
		return conn, New(context.Background(), conn, tunnel.High, nil, Options{}), <-peer
	}
	ended := func(s *Session) {
		t.Helper()
		select {
		case <-s.Context.Done():
		case <-time.After(2 * time.Second):
			t.Fatal("session did not end")
		}
	}

	conn, client, served := dial()
	if err := served.Err(); err != nil {
		t.Fatalf("a live session reported %v", err)
	}
	if err := conn.Close(websocket.StatusCode(4001), "leaving"); err != nil {
		t.Fatalf("close handshake: %v", err)
	}
	ended(served)
	if got := websocket.CloseStatus(served.Err()); got != 4001 {
		t.Fatalf("served side saw close status %d (%v), want 4001", got, served.Err())
	}
	client.Close()

	conn, client, served = dial()
	conn.CloseNow()
	ended(served)
	if err := served.Err(); err == nil || websocket.CloseStatus(err) != -1 {
		t.Fatalf("an abrupt close reported %v, want a transport error without a close status", err)
	}
	client.Close()
}
