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

// Diagnostics never sit on the business request's completion path. One writer
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
