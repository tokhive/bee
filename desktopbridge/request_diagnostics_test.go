package desktopbridge

import (
	"context"
	"testing"
	"time"

	bee "github.com/tokhive/bee/agent"
)

type blockedDiagnosticWriter struct {
	entered chan struct{}
	release chan struct{}
}

func (w blockedDiagnosticWriter) Write(p []byte) (int, error) {
	select {
	case w.entered <- struct{}{}:
	default:
	}
	<-w.release
	return len(p), nil
}
func TestBlockedDiagnosticsCannotBlockBusinessSink(t *testing.T) {
	writer := blockedDiagnosticWriter{make(chan struct{}, 1), make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer close(writer.release)
	sink := requestDiagnosticSink(ctx, writer)
	event := bee.DesktopDiagnosticEvent{Code: "request_http_started", Evidence: map[string]string{"method": "GET"}}
	sink(event)
	select {
	case <-writer.entered:
	case <-time.After(time.Second):
		t.Fatal("writer not entered")
	}
	complete := make(chan struct{})
	go func() {
		for range 10000 {
			sink(event)
		}
		close(complete)
	}()
	select {
	case <-complete:
	case <-time.After(time.Second):
		t.Fatal("diagnostic backpressure blocked business caller")
	}
	cancel()
}
