package relay

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

// BridgeObserver receives concurrent callbacks, one copier per direction. It
// must return promptly and never retain or inspect the transferred bytes.
type BridgeObserver interface {
	Read(direction string, n int)
	Write(direction string, n int, elapsed time.Duration)
}

type BridgeResult struct {
	Direction string
	Reason    string
}

// BridgeObserved has the same cancellation and full-close semantics as Bridge.
// The first termination is recorded before closing the other direction, whose
// resulting closed-socket error must not replace the original cause.
func BridgeObserved(ctx context.Context, left, right io.ReadWriteCloser, observer BridgeObserver) BridgeResult {
	var once sync.Once
	var result BridgeResult
	finish := func(direction string, err error) {
		once.Do(func() {
			reason := "io_error"
			var timeout net.Error
			switch {
			case ctx.Err() != nil:
				reason = "canceled"
			case err == nil || errors.Is(err, io.EOF):
				reason = "eof"
			case errors.As(err, &timeout) && timeout.Timeout():
				reason = "timeout"
			}
			result = BridgeResult{Direction: direction, Reason: reason}
			left.Close()
			right.Close()
		})
	}
	stop := context.AfterFunc(ctx, func() { finish("context", ctx.Err()) })
	defer stop()
	done := make(chan struct{}, 2)
	copyBytes := func(direction string, dst, src io.ReadWriteCloser) {
		var reader io.Reader = src
		var writer io.Writer = dst
		if observer != nil {
			reader = observedReader{src, observer, direction}
			writer = observedWriter{dst, observer, direction}
		}
		_, err := io.Copy(writer, reader)
		finish(direction, err)
		done <- struct{}{}
	}
	go copyBytes("to_upstream", right, left)
	go copyBytes("to_hive", left, right)
	<-done
	<-done
	return result
}

type observedReader struct {
	io.Reader
	observer  BridgeObserver
	direction string
}

func (r observedReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if n > 0 {
		r.observer.Read(r.direction, n)
	}
	return n, err
}

type observedWriter struct {
	io.Writer
	observer  BridgeObserver
	direction string
}

func (w observedWriter) Write(p []byte) (int, error) {
	start := time.Now()
	n, err := w.Writer.Write(p)
	w.observer.Write(w.direction, n, time.Since(start))
	return n, err
}
