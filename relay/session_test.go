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
