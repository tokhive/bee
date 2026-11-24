package bee

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/beewire"
)

// A Bee that ends its tunnel itself tells Hive why with a close code, so
// Hive's record of the disconnect names the Bee's reason rather than a
// connection that merely ended.
func TestConnectTellsHiveWhyItLeaves(t *testing.T) {
	for name, tc := range map[string]struct {
		syncFailure bool
		want        int
	}{
		"stopped":                {false, beewire.CloseStopping},
		"synchronization failed": {true, beewire.CloseSyncFailed},
	} {
		t.Run(name, func(t *testing.T) {
			connected := make(chan struct{})
			status := make(chan websocket.StatusCode, 1)
			hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer conn.CloseNow()
				for first := true; ; first = false {
					// Tunnel frames are read and dropped; the close frame
					// ends the loop with its status. The first frame is the
					// tunnel's hello: the Bee's session is up from then on,
					// where a stop during the handshake has no tunnel to
					// leave.
					if _, _, err := conn.Read(context.Background()); err != nil {
						status <- websocket.CloseStatus(err)
						return
					}
					if first {
						close(connected)
					}
				}
			}))
			defer hive.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			cfg := &egressConfig{Targets: []string{}, synchronizeOverride: func(context.Context, localState, string, io.Writer) (<-chan error, func()) {
				failures := make(chan error, 1)
				if tc.syncFailure {
					failures <- fmt.Errorf("authorization sync: %w", errInboxIdentity)
				}
				return failures, func() {}
			}}
			done := make(chan error, 1)
			go func() { done <- connect(ctx, localState{Hive: hive.URL}, cfg, io.Discard) }()
			select {
			case <-connected:
			case <-time.After(3 * time.Second):
				t.Fatal("Bee did not connect")
			}
			if !tc.syncFailure {
				cancel()
			}
			select {
			case got := <-status:
				if int(got) != tc.want {
					t.Fatalf("Hive saw close status %d, want %d", got, tc.want)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("Hive saw no close")
			}
			cancel()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("connect did not return")
			}
		})
	}
}
