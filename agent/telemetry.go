package bee

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/tokhive/bee/relay"
	base "github.com/tokhive/bee/telemetry"
)

type beeTelemetryKey struct{}
type beeSessionKey struct{}
type beeStreamKey struct{}

type beeTelemetry struct {
	*base.Runtime
	runID                                      string
	sequence                                   atomic.Uint64
	connected                                  prometheus.Gauge
	reconnects                                 prometheus.Counter
	connectDuration, pingDuration, egressPhase *prometheus.HistogramVec
	active                                     *prometheus.GaugeVec
	closed, bytes, writeDuration               *prometheus.CounterVec
}

func newBeeTelemetry(writer io.Writer) *beeTelemetry {
	t := &beeTelemetry{Runtime: base.New(writer, 256), runID: rand.Text()}
	t.connected = prometheus.NewGauge(prometheus.GaugeOpts{Name: "tokhive_bee_hive_connected", Help: "Whether the Bee Hive WebSocket is connected."})
	t.reconnects = prometheus.NewCounter(prometheus.CounterOpts{Name: "tokhive_bee_hive_reconnects_total", Help: "Reconnect attempts after the initial Hive connection attempt."})
	hist := func(name, help string, labels ...string) *prometheus.HistogramVec {
		return prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: name, Help: help, Buckets: base.Buckets}, labels)
	}
	t.connectDuration = hist("tokhive_bee_hive_connect_duration_seconds", "Hive WebSocket connection establishment duration.", "outcome")
	t.pingDuration = hist("tokhive_bee_hive_ping_duration_seconds", "Existing Hive heartbeat round trip including failures.", "outcome")
	t.egressPhase = hist("tokhive_bee_egress_phase_duration_seconds", "Egress connection phase duration; direct dialing includes DNS.", "target", "phase", "outcome")
	t.active = prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "tokhive_bee_egress_streams_active", Help: "Current egress streams by connection state."}, []string{"target", "state"})
	t.closed = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "tokhive_bee_egress_streams_closed_total", Help: "Egress streams closed once by their initiating cause."}, []string{"target", "reason"})
	t.bytes = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "tokhive_bee_egress_bytes_total", Help: "Ciphertext bytes successfully copied; includes TLS handshake traffic."}, []string{"target", "direction"})
	t.writeDuration = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "tokhive_bee_egress_write_duration_seconds_total", Help: "Cumulative wall time in ciphertext writes across concurrent streams."}, []string{"target", "direction"})
	t.Registry.MustRegister(t.connected, t.reconnects, t.connectDuration, t.pingDuration, t.egressPhase, t.active, t.closed, t.bytes, t.writeDuration)
	return t
}

func beeMetrics(ctx context.Context) *beeTelemetry {
	v, _ := ctx.Value(beeTelemetryKey{}).(*beeTelemetry)
	return v
}
func beeSession(ctx context.Context) context.Context {
	t := beeMetrics(ctx)
	if t == nil {
		return ctx
	}
	return context.WithValue(ctx, beeSessionKey{}, strconv.FormatUint(t.sequence.Add(1), 10))
}

func runWithTelemetry(ctx context.Context, run func(context.Context) error) error {
	t := newBeeTelemetry(base.TimingWriter())
	endpoint, err := base.Listen(os.Getenv("BEE_METRICS_ADDR"), t.Handler())
	defer func() {
		stop, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = endpoint.Close(stop)
		_ = t.Close(stop)
	}()
	if err != nil {
		return err
	}
	live, cancel := context.WithCancel(context.WithValue(ctx, beeTelemetryKey{}, t))
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(live) }()
	select {
	case err := <-done:
		return err
	case err := <-endpoint.Errors():
		cancel()
		<-done
		return err
	}
}

func (t *beeTelemetry) connect(start time.Time, err error) {
	if t == nil {
		return
	}
	t.connectDuration.WithLabelValues(base.Outcome(err)).Observe(time.Since(start).Seconds())
	if err == nil {
		t.connected.Set(1)
	} else {
		t.connected.Set(0)
	}
	t.Emit(map[string]any{"event": "bee_hive_connect", "schema_version": 1, "service": "bee", "time": start.UTC(), "process_run_id": t.runID, "outcome": base.Outcome(err), "duration_ms": float64(time.Since(start)) / float64(time.Millisecond)})
}
func (t *beeTelemetry) disconnect() {
	if t != nil {
		t.connected.Set(0)
	}
}
func (t *beeTelemetry) reconnect() {
	if t != nil {
		t.reconnects.Inc()
	}
}
func (t *beeTelemetry) ping(start time.Time, err error) {
	if t != nil {
		t.pingDuration.WithLabelValues(base.Outcome(err)).Observe(time.Since(start).Seconds())
	}
}

type beeStream struct {
	mu                         sync.Mutex
	t                          *beeTelemetry
	started                    time.Time
	session, id, target, state string
	mode                       string
	finished                   bool
	phases                     map[string]float64
	firstReads, firstWrites    map[string]float64
	writes, maxWrites          map[string]float64
	bytes                      map[string]int64
}

func targetClass(target string) string {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		host = target
	}
	switch host {
	case "chatgpt.com", "api.openai.com":
		return "openai"
	case "api.anthropic.com":
		return "claude"
	default:
		return "other"
	}
}
func startBeeStream(ctx context.Context, target string, proxy bool) (context.Context, *beeStream) {
	t := beeMetrics(ctx)
	if t == nil {
		return ctx, nil
	}
	session, _ := ctx.Value(beeSessionKey{}).(string)
	s := &beeStream{t: t, started: time.Now(), session: session, id: strconv.FormatUint(t.sequence.Add(1), 10), target: targetClass(target), state: "dialing", mode: "direct", phases: map[string]float64{}, firstReads: map[string]float64{}, firstWrites: map[string]float64{}, writes: map[string]float64{}, maxWrites: map[string]float64{}, bytes: map[string]int64{}}
	if proxy {
		s.mode = "proxy"
	}
	t.active.WithLabelValues(s.target, s.state).Inc()
	return context.WithValue(ctx, beeStreamKey{}, s), s
}
func beeEgressPhase(ctx context.Context, phase string) func(error) {
	s, _ := ctx.Value(beeStreamKey{}).(*beeStream)
	if s == nil {
		return func(error) {}
	}
	start := time.Now()
	return func(err error) {
		if err != nil && ctx.Err() != nil {
			err = ctx.Err()
		}
		d := time.Since(start)
		s.t.egressPhase.WithLabelValues(s.target, phase, base.Outcome(err)).Observe(d.Seconds())
		s.mu.Lock()
		s.phases[phase] = float64(d) / float64(time.Millisecond)
		s.mu.Unlock()
	}
}

func dialCloseReason(ctx context.Context, err error) string {
	var timeout net.Error
	switch {
	case errors.Is(ctx.Err(), context.Canceled):
		return "canceled"
	case errors.Is(ctx.Err(), context.DeadlineExceeded), errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	default:
		return "dial_error"
	}
}
func (s *beeStream) record(event string) map[string]any {
	copyFloats := func(in map[string]float64) map[string]float64 {
		out := map[string]float64{}
		for k, v := range in {
			out[k] = v
		}
		return out
	}
	bytes := map[string]int64{}
	for k, v := range s.bytes {
		bytes[k] = v
	}
	return map[string]any{"event": event, "schema_version": 1, "service": "bee", "time": s.started.UTC(), "process_run_id": s.t.runID, "session_id": s.session, "stream_id": s.id, "target": s.target, "mode": s.mode, "duration_ms": float64(time.Since(s.started)) / float64(time.Millisecond), "phases_ms": copyFloats(s.phases), "first_read_ms": copyFloats(s.firstReads), "first_write_ms": copyFloats(s.firstWrites), "write_ms": copyFloats(s.writes), "max_write_ms": copyFloats(s.maxWrites), "bytes": bytes}
}
func (s *beeStream) Open(err error) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.record("bee_egress_open")
	record["outcome"] = base.Outcome(err)
	s.t.Emit(record)
	if err == nil {
		s.t.active.WithLabelValues(s.target, s.state).Dec()
		s.state = "bridging"
		s.t.active.WithLabelValues(s.target, s.state).Inc()
	}
}
func (s *beeStream) Read(direction string, n int) {
	if s == nil || n <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.firstReads[direction]; !ok {
		s.firstReads[direction] = float64(time.Since(s.started)) / float64(time.Millisecond)
	}
}
func (s *beeStream) Write(direction string, n int, elapsed time.Duration) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if n > 0 {
		if _, ok := s.firstWrites[direction]; !ok {
			s.firstWrites[direction] = float64(time.Since(s.started)) / float64(time.Millisecond)
		}
	}
	d := float64(elapsed) / float64(time.Millisecond)
	s.bytes[direction] += int64(n)
	s.writes[direction] += d
	s.maxWrites[direction] = max(s.maxWrites[direction], d)
	s.t.bytes.WithLabelValues(s.target, direction).Add(float64(n))
	s.t.writeDuration.WithLabelValues(s.target, direction).Add(elapsed.Seconds())
}
func (s *beeStream) Close(result relay.BridgeResult) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.finished {
		return
	}
	s.finished = true
	reason := result.Reason
	switch reason {
	case "eof", "canceled", "timeout", "dial_error", "io_error":
	default:
		reason = "unknown"
	}
	s.t.active.WithLabelValues(s.target, s.state).Dec()
	s.t.closed.WithLabelValues(s.target, reason).Inc()
	record := s.record("bee_egress_timing")
	record["close_reason"] = reason
	record["close_direction"] = result.Direction
	s.t.Emit(record)
}
