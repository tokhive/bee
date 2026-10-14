// Package telemetry provides process-local collection and bounded diagnostic
// logging. It never sends telemetry over the inference or accounting paths.
package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var Buckets = []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 900, 1200}
var RequestBuckets = []float64{.01, .05, .1, .25, .5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 900, 1200}

type Runtime struct {
	Registry    *prometheus.Registry
	queue       chan any
	done        chan struct{}
	mu          sync.RWMutex
	closed      bool
	dropped     prometheus.Counter
	writeErrors prometheus.Counter
}

// TimingWriter is deliberately independent of the ordinary debug-log filters.
func TimingWriter() io.Writer {
	if os.Getenv("TOKHIVE_TIMING_LOG") == "1" {
		return os.Stderr
	}
	return nil
}

func New(writer io.Writer, capacity int) *Runtime {
	if capacity < 1 {
		capacity = 256
	}
	r := &Runtime{Registry: prometheus.NewRegistry(), done: make(chan struct{})}
	r.dropped = prometheus.NewCounter(prometheus.CounterOpts{Name: "tokhive_telemetry_dropped_total", Help: "Diagnostic records dropped without delaying business work.", ConstLabels: prometheus.Labels{"kind": "timing_log"}})
	r.writeErrors = prometheus.NewCounter(prometheus.CounterOpts{Name: "tokhive_telemetry_log_errors_total", Help: "Diagnostic records that could not be encoded or written."})
	r.Registry.MustRegister(r.dropped, r.writeErrors, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	if writer == nil {
		close(r.done)
		return r
	}
	r.queue = make(chan any, capacity)
	go func() {
		defer close(r.done)
		encoder := json.NewEncoder(writer)
		for record := range r.queue {
			if encoder.Encode(record) != nil {
				r.writeErrors.Inc()
			}
		}
	}()
	return r
}

// Emit takes ownership of an immutable record. The caller must not mutate it
// afterwards. A saturated or closed sink never blocks its caller.
func (r *Runtime) Emit(record any) {
	if r == nil || r.queue == nil {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		r.dropped.Inc()
		return
	}
	select {
	case r.queue <- record:
	default:
		r.dropped.Inc()
	}
}

func (r *Runtime) Close(ctx context.Context) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	if !r.closed {
		r.closed = true
		if r.queue != nil {
			close(r.queue)
		}
	}
	r.mu.Unlock()
	select {
	case <-r.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *Runtime) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(r.Registry, promhttp.HandlerOpts{Timeout: 5 * time.Second}))
	return mux
}

type Endpoint struct {
	server   *http.Server
	listener net.Listener
	errors   chan error
}

// Listen binds before returning so configuration failures surface at startup.
// An empty address disables the listener while retaining in-memory metrics.
func Listen(address string, handler http.Handler) (*Endpoint, error) {
	if address == "" {
		return nil, nil
	}
	l, err := net.Listen("tcp", address)
	if err != nil {
		return nil, err
	}
	e := &Endpoint{server: &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}, listener: l, errors: make(chan error, 1)}
	go func() {
		err := e.server.Serve(l)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			e.errors <- err
		}
		close(e.errors)
	}()
	return e, nil
}

func (e *Endpoint) Errors() <-chan error {
	if e == nil {
		return nil
	}
	return e.errors
}
func (e *Endpoint) Close(ctx context.Context) error {
	if e == nil {
		return nil
	}
	return e.server.Shutdown(ctx)
}
func (e *Endpoint) Addr() string {
	if e == nil {
		return ""
	}
	return e.listener.Addr().String()
}

func Outcome(err error) string {
	if err == nil {
		return "success"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	return "error"
}
