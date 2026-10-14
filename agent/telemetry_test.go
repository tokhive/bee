package bee

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/relay"
)

func beeMetricText(t *beeTelemetry) string {
	w := httptest.NewRecorder()
	t.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	return w.Body.String()
}

func TestBeeTelemetryDirectStreamUpdatesBeforeClose(t *testing.T) {
	metrics := newBeeTelemetry(nil)
	defer metrics.Close(context.Background())
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), beeTelemetryKey{}, metrics))
	defer cancel()
	ctx, stream := startBeeStream(beeSession(ctx), listener.Addr().String(), false)
	conn, err := (&egressConfig{}).dialEgress(ctx, listener.Addr().String())
	stream.Open(err)
	if err != nil {
		t.Fatal(err)
	}
	remote, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer remote.Close()
	buyer, hive := net.Pipe()
	defer buyer.Close()
	done := make(chan relay.BridgeResult, 1)
	go func() { done <- relay.BridgeObserved(ctx, hive, conn, stream) }()
	// Two exchanges on one transport remain a single connection observation.
	for range 2 {
		written := make(chan error, 1)
		go func() { _, err := buyer.Write([]byte("ciphertext")); written <- err }()
		buf := make([]byte, 10)
		if _, err := io.ReadFull(remote, buf); err != nil {
			t.Fatal(err)
		}
		if err := <-written; err != nil {
			t.Fatal(err)
		}
		go func() { _, err := remote.Write([]byte("reply")); written <- err }()
		if _, err := io.ReadFull(buyer, buf[:5]); err != nil {
			t.Fatal(err)
		}
		if err := <-written; err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(time.Second)
	for {
		wire := beeMetricText(metrics)
		if strings.Contains(wire, `tokhive_bee_egress_bytes_total{direction="to_hive",target="other"} 10`) && strings.Contains(wire, `tokhive_bee_egress_bytes_total{direction="to_upstream",target="other"} 20`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing live bytes", wire)
		}
		time.Sleep(time.Millisecond)
	}
	wire := beeMetricText(metrics)
	for _, want := range []string{
		`tokhive_bee_egress_streams_active{state="bridging",target="other"} 1`,
		`tokhive_bee_egress_phase_duration_seconds_count{outcome="success",phase="direct_dial",target="other"} 1`,
	} {
		if !strings.Contains(wire, want) {
			t.Fatal("missing", want)
		}
	}
	if strings.Contains(wire, "tokhive_inference_") {
		t.Fatal("Bee exposed request semantics")
	}
	cancel()
	result := <-done
	stream.Close(result)
	stream.Close(result)
	wire = beeMetricText(metrics)
	if !strings.Contains(wire, `tokhive_bee_egress_streams_closed_total{reason="canceled",target="other"} 1`) || !strings.Contains(wire, `tokhive_bee_egress_streams_active{state="bridging",target="other"} 0`) {
		t.Fatal(wire)
	}
}

func TestBeeTelemetryProxyWaitAndCancellation(t *testing.T) {
	for _, mode := range []string{"success", "canceled", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					return
				}
				defer conn.Close()
				close(entered)
				<-release
				io.WriteString(conn, "HTTP/1.1 200 Connection established\r\n\r\n")
			}))
			defer proxy.Close()
			metrics := newBeeTelemetry(nil)
			defer metrics.Close(context.Background())
			ctx, cancel := context.WithCancel(context.WithValue(context.Background(), beeTelemetryKey{}, metrics))
			defer cancel()
			ctx, stream := startBeeStream(ctx, "chatgpt.com:443", true)
			done := make(chan error, 1)
			go func() {
				conn, err := (&egressConfig{ConnectProxy: proxy.URL}).dialEgress(ctx, "chatgpt.com:443")
				stream.Open(err)
				if conn != nil {
					conn.Close()
				}
				done <- err
			}()
			<-entered
			wire := beeMetricText(metrics)
			if !strings.Contains(wire, `tokhive_bee_egress_streams_active{state="dialing",target="openai"} 1`) || strings.Contains(wire, `phase="proxy_connect"`) {
				t.Fatal("unfinished CONNECT counted as completed", wire)
			}
			if mode == "canceled" {
				cancel()
			} else if mode == "success" {
				close(release)
			}
			err := <-done
			if mode != "success" {
				close(release)
			}
			reason, outcome := "eof", "success"
			if mode != "success" {
				if err == nil {
					t.Fatal("interrupted dial succeeded")
				}
				reason, outcome = dialCloseReason(ctx, err), "canceled"
				if mode == "timeout" {
					outcome = "error"
				}
				if reason != mode {
					t.Fatalf("close reason = %s, want %s", reason, mode)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			stream.Close(relay.BridgeResult{Direction: "connect", Reason: reason})
			wire = beeMetricText(metrics)
			if !strings.Contains(wire, `tokhive_bee_egress_phase_duration_seconds_count{outcome="`+outcome+`",phase="proxy_connect",target="openai"} 1`) {
				t.Fatal(wire)
			}
			if !strings.Contains(wire, `tokhive_bee_egress_streams_active{state="dialing",target="openai"} 0`) {
				t.Fatal(wire)
			}
		})
	}
}
