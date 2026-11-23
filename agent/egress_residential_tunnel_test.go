package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
	"github.com/tokhive/tee/tunnel"
)

// TestResidentialOverRelayTunnel runs the full seller path: a real echo
// listener, the real relay framing, and the residential handler Hive reaches
// when it opens a stream with a signed lease.
func TestResidentialOverRelayTunnel(t *testing.T) {
	target, stop := echoListener(t)
	defer stop()
	plane, key := residentialForTest(t, target, true)
	plane.rules, _ = residentialRules([]residentialRule{{Suffix: "denied.test", BPS: 0}})
	cfg := &egressConfig{residential: plane, failures: newEgressFailures()}

	peerReady := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		session := relay.New(r.Context(), conn, tunnel.Low, cfg.serveStream(io.Discard), relay.Options{})
		close(peerReady)
		<-session.Context.Done()
	}))
	defer server.Close()
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	client := relay.New(context.Background(), conn, tunnel.High, nil, relay.Options{})
	defer client.Close()
	<-peerReady

	lease := residentialToken(t, key, beewire.EgressLease{})
	open := func(host string) (*tunnel.Stream, error) {
		metadata, _ := json.Marshal(map[string]string{"host": host, "lease": lease})
		return client.Mux.Dial(metadata)
	}

	stream, err := open("target.test:80")
	if err != nil {
		t.Fatalf("dial stream: %v", err)
	}
	defer stream.Close()
	if _, err := stream.Write([]byte("ping")); err != nil {
		t.Fatalf("write: %v", err)
	}
	echo := make([]byte, 4)
	if _, err := io.ReadFull(stream, echo); err != nil || string(echo) != "ping" {
		t.Fatalf("echo = %q, err = %v", echo, err)
	}

	// A rule with no rate refuses the suffix: the stream opens on the tunnel
	// but the Bee closes it before dialling.
	denied, err := open("denied.test:80")
	if err != nil {
		t.Fatalf("dial denied stream: %v", err)
	}
	defer denied.Close()
	done := make(chan error, 1)
	go func() {
		_, err := denied.Read(make([]byte, 1))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("denied host delivered data")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("denied host left the stream open")
	}
}
