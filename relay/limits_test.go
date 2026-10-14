package relay

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
)

// sessions joins a client tunnel to a server tunnel serving with options; the
// server's handler holds each stream until release is closed.
func sessions(t *testing.T, options Options, release <-chan struct{}) *Session {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		s := New(r.Context(), conn, tunnel.Low, func(ctx context.Context, stream *tunnel.Stream, _ []byte) {
			_, _ = stream.Write([]byte("ok"))
			select {
			case <-release:
			case <-ctx.Done():
			}
		}, options)
		<-s.Context.Done()
	}))
	t.Cleanup(server.Close)
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	client := New(context.Background(), conn, tunnel.High, nil, Options{})
	t.Cleanup(client.Close)
	return client
}

func open(t *testing.T, s *Session) (*tunnel.Stream, error) {
	t.Helper()
	stream, err := s.Mux.Dial([]byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2)
	done := make(chan error, 1)
	go func() { _, err := io.ReadFull(stream, buf); done <- err }()
	select {
	case err := <-done:
		return stream, err
	case <-time.After(5 * time.Second):
		t.Fatal("stream neither served nor refused")
		return nil, nil
	}
}

// At the bound a new stream is reset, not quietly closed, and counted; a
// freed slot serves the next one.
func TestStreamsBeyondTheLimitAreResetAndCounted(t *testing.T) {
	release := make(chan struct{})
	var refused atomic.Int32
	client := sessions(t, Options{MaxStreams: 2, Refused: func() { refused.Add(1) }}, release)
	for range 2 {
		if _, err := open(t, client); err != nil {
			t.Fatal("stream within the limit failed:", err)
		}
	}
	if _, err := open(t, client); !errors.Is(err, tunnel.ErrStreamReset) {
		t.Fatalf("stream beyond the limit: %v", err)
	}
	if refused.Load() != 1 {
		t.Fatalf("refused %d", refused.Load())
	}
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := open(t, client); err == nil {
			break
		} else if time.Now().After(deadline) {
			t.Fatal("freed slots were not reused:", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// The old fixed bound was 32 for every tunnel, including the one tunnel that
// carries the whole market's upstream connections.
func TestDefaultLimitServesMoreThanTheOldBound(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	client := sessions(t, Options{}, release)
	for i := range 40 {
		if _, err := open(t, client); err != nil {
			t.Fatalf("stream %d: %v", i, err)
		}
	}
	if HubStreams < 1024 || BeeStreams < 128 {
		t.Fatalf("limits %d %d", HubStreams, BeeStreams)
	}
}
