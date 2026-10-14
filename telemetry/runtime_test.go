package telemetry_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/telemetry"
)

type blockedWriter struct{ entered, release chan struct{} }

func (w blockedWriter) Write(p []byte) (int, error) {
	select {
	case w.entered <- struct{}{}:
	default:
	}
	<-w.release
	return len(p), nil
}

func TestBlockedLogSinkDoesNotBlockCollectionOrShutdown(t *testing.T) {
	w := blockedWriter{make(chan struct{}, 1), make(chan struct{})}
	r := telemetry.New(w, 1)
	r.Emit(map[string]any{"event": "first"})
	select {
	case <-w.entered:
	case <-time.After(time.Second):
		t.Fatal("logger did not start")
	}
	defer close(w.release)
	r.Emit(map[string]any{"event": "queued"})
	r.Emit(map[string]any{"event": "dropped"})
	response := httptest.NewRecorder()
	r.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(response.Body.String(), "tokhive_telemetry_dropped_total{kind=\"timing_log\"} 1") {
		t.Fatal(response.Body.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r.Close(ctx) == nil {
		t.Fatal("blocked sink must report unfinished shutdown")
	}
	r.Emit(map[string]any{"event": "after_close"})
}

func TestIndependentRegistriesAndMetricsOnlyEndpoint(t *testing.T) {
	for range 2 {
		r := telemetry.New(io.Discard, 1)
		w := httptest.NewRecorder()
		r.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/other", nil))
		if w.Code != 404 {
			t.Fatalf("status = %d", w.Code)
		}
		if err := r.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEndpointBindsAndShutsDown(t *testing.T) {
	runtime := telemetry.New(nil, 1)
	endpoint, err := telemetry.Listen("127.0.0.1:0", runtime.Handler())
	if err != nil {
		t.Fatal(err)
	}
	defer endpoint.Close(context.Background())
	if _, err := telemetry.Listen(endpoint.Addr(), runtime.Handler()); err == nil {
		t.Fatal("occupied metrics address accepted")
	}
	response, err := http.Get("http://" + endpoint.Addr() + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || !strings.Contains(string(body), "go_goroutines") {
		t.Fatal("metrics unavailable", err)
	}
	if err := endpoint.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := http.Get("http://" + endpoint.Addr() + "/metrics"); err == nil {
		t.Fatal("endpoint still listening")
	}
	disabled, err := telemetry.Listen("", runtime.Handler())
	if err != nil || disabled != nil || disabled.Errors() != nil {
		t.Fatal("empty address must disable endpoint")
	}
}
