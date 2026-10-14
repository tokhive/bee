package bee

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

// egressFailures reports the connections Bee refuses or cannot open at the
// default log level. Without it these failures were visible only with
// BEE_DEBUG, and Hive saw nothing but a connection that ended, so neither the
// provider nor the administrator could tell a missing target from a dead proxy.
//
// A broken network fails every stream, so each code and address is reported
// at most once per interval, with a count of what was held back.
type egressFailures struct {
	mu       sync.Mutex
	interval time.Duration
	now      func() time.Time
	last     map[string]time.Time
	held     map[string]int
	// pending holds what was reported, for forward to send to Hive.
	pending []beewire.SupplyEvent
}

// maxPendingEvents bounds what waits for Hive while it cannot be reached;
// the oldest go first.
const maxPendingEvents = 100

// eventFlushInterval is how often reported failures are sent to Hive.
var eventFlushInterval = 10 * time.Second

func newEgressFailures() *egressFailures {
	return &egressFailures{interval: time.Minute, now: time.Now, last: map[string]time.Time{}, held: map[string]int{}}
}

func (f *egressFailures) report(out io.Writer, err error, host string) {
	code, summary, fix, ok := Coded(err)
	if !ok {
		code, summary = "", err.Error()
	}
	key := code + "\x00" + host
	f.mu.Lock()
	now := f.now()
	if last, seen := f.last[key]; seen && now.Sub(last) < f.interval {
		f.held[key]++
		f.mu.Unlock()
		return
	}
	held := f.held[key]
	f.last[key], f.held[key] = now, 0
	f.mu.Unlock()
	if strings.HasPrefix(code, "BEE-EGRESS-") {
		f.mu.Lock()
		f.pending = append(f.pending, beewire.SupplyEvent{At: now.UTC(), Code: code, Host: host, Count: held + 1})
		if len(f.pending) > maxPendingEvents {
			f.pending = f.pending[len(f.pending)-maxPendingEvents:]
		}
		f.mu.Unlock()
	}
	attrs := []any{"code", code, "host", host, "fix", fix}
	if held > 0 {
		attrs = append(attrs, "repeated", strconv.Itoa(held)+" more since the last report")
	}
	notify(out, slog.LevelWarn, "egress", summary, attrs...)
}

// dialProblem catalogues a failed upstream dial.
func dialProblem(host string, err error) error {
	var proxy proxyError
	if errors.As(err, &proxy) {
		// proxyError's message deliberately omits the proxy's address.
		return fail("BEE-EGRESS-PROXY", host+": "+proxy.message)
	}
	return fail("BEE-EGRESS-DIAL", host+": "+err.Error())
}

// forward sends reported failures to Hive until ctx ends, so the
// administrator's supply failures page and the call audit show what the Bee's
// own log says. A report Hive does not
// confirm is kept for the next round.
func (f *egressFailures) forward(ctx context.Context, state localState) {
	ticker := time.NewTicker(eventFlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		f.mu.Lock()
		batch := f.pending
		if len(batch) > beewire.MaxReportedEvents {
			batch = batch[:beewire.MaxReportedEvents]
		}
		batch = append([]beewire.SupplyEvent(nil), batch...)
		f.mu.Unlock()
		if len(batch) == 0 {
			continue
		}
		send, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := call(send, httpClient(), state.Hive, "/api/bee/events", "POST", state.Credential, beewire.SupplyEventReport{Events: batch}, nil)
		cancel()
		if err != nil {
			continue
		}
		f.mu.Lock()
		// Drop what was sent; anything reported meanwhile stays queued.
		sent := 0
		for sent < len(batch) && sent < len(f.pending) && f.pending[sent] == batch[sent] {
			sent++
		}
		f.pending = f.pending[sent:]
		f.mu.Unlock()
	}
}
