package desktopbridge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	bee "github.com/tokhive/bee/agent"
)

type diagnosticWriter struct {
	writer io.Writer
	mu     sync.Mutex
}

func (w *diagnosticWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.writer == nil {
		return len(p), nil
	}
	return w.writer.Write(p)
}

// Fatal error reporting must not race the event writer or wait behind a stuck
// diagnostic pipe. The returned run error still carries the complete failure.
func (w *diagnosticWriter) report(cause error) error {
	if w.writer == nil || !w.mu.TryLock() {
		return nil
	}
	defer w.mu.Unlock()
	_, err := fmt.Fprintln(w.writer, cause)
	return err
}

// Timing diagnostics never sit on the business request's completion path. One writer
// owns a bounded queue; congestion drops events instead of stalling Bee. As for
// other caller-owned streams, an owner must close/unblock a stuck writer when
// disposing its session. The management process can exit without waiting for it.
func requestDiagnosticSink(ctx context.Context, writer io.Writer) func(bee.DesktopDiagnosticEvent) {
	if writer == nil {
		return func(bee.DesktopDiagnosticEvent) {}
	}
	events := make(chan []byte, 64)
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			case event := <-events:
				if _, err := writer.Write(event); err != nil {
					return
				}
			}
		}
	}()
	return func(event bee.DesktopDiagnosticEvent) {
		if ctx.Err() != nil {
			return
		}
		encoded, err := json.Marshal(event)
		if err != nil || len(encoded) > 4096 {
			return
		}
		line := []byte(fmt.Sprintf("BEE_DESKTOP_EVENT %s\n", encoded))
		select {
		case events <- line:
		default:
		}
	}
}

// FailureDiagnostics shares the stderr writer with timing diagnostics, but
// writes failures synchronously instead of dropping them when telemetry is full.
func FailureDiagnostics(ctx context.Context, output io.Writer) (context.Context, io.Writer) {
	writer := &diagnosticWriter{writer: output}
	if output == nil {
		return ctx, nil
	}
	ctx = bee.WithDesktopFailureRecorder(ctx, func(event bee.DesktopDiagnosticEvent) error {
		data, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("encode failure event: %w", err)
		}
		line := append(append([]byte("BEE_DESKTOP_FAILURE "), data...), '\n')
		n, err := writer.Write(line)
		if err == nil && n != len(line) {
			err = io.ErrShortWrite
		}
		return err
	})
	return ctx, writer
}
