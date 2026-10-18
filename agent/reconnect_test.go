package bee

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// Hive refuses a reconnect as a duplicate until it gives up on the connection
// that died. Bee retries those refusals at a short steady interval, so it is
// back as soon as Hive lets go rather than waiting out a doubled backoff.
func TestReconnectRetriesDuplicateRefusalsSteadily(t *testing.T) {
	previous := conflictRetryDelay
	conflictRetryDelay = 10 * time.Millisecond
	t.Cleanup(func() { conflictRetryDelay = previous })
	var dials atomic.Int32
	connected := make(chan struct{})
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if dials.Add(1) <= 4 {
			http.Error(w, `{"error":{"type":"device_connected"}}`, http.StatusConflict)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		close(connected)
		<-r.Context().Done()
		conn.CloseNow()
	}))
	defer hive.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- connect(ctx, localState{Hive: hive.URL, Credential: "device-secret"}, nil, io.Discard) }()
	// The first retry waits the initial second; the refusals after it do not
	// double it to 2, 4 and 8 seconds.
	select {
	case <-connected:
	case <-time.After(3 * time.Second):
		t.Fatalf("not reconnected after %d dials", dials.Load())
	}
	cancel()
	hive.CloseClientConnections()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
