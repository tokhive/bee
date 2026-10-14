package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func readinessHive(account beewire.PlatformAccount, supply beewire.PlatformSupply) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account") {
			json.NewEncoder(w).Encode(account)
			return
		}
		json.NewEncoder(w).Encode(supply)
	}))
}

// The summary must say the same as bee doctor: one line when the platform
// takes work, and otherwise one line per reason with its code and fix, the
// account's own state counted once.
func TestReadinessSummaryExplainsEachReason(t *testing.T) {
	ready := readinessHive(
		beewire.PlatformAccount{Platform: "openai", Status: "ready", AccountFingerprint: strings.Repeat("cd", 32), Generation: 2},
		beewire.PlatformSupply{Platform: "openai", Ready: true, Reasons: []string{}},
	)
	defer ready.Close()
	var out bytes.Buffer
	reportReadiness(context.Background(), localState{Hive: ready.URL, Credential: "bee-test"}, "openai", newConsole(&out))
	if lines := strings.Split(strings.TrimSpace(out.String()), "\n"); len(lines) != 1 || !strings.Contains(lines[0], "openai ready: taking new work") || !strings.Contains(lines[0], "cdcdcdcdcdcd") {
		t.Fatalf("ready summary: %q", out.String())
	}

	blocked := readinessHive(
		beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required"},
		beewire.PlatformSupply{Platform: "openai", Reasons: []string{beewire.AccountReason("openai", "confirmation_required"), beewire.ReasonPlanNotConfigured}},
	)
	defer blocked.Close()
	out.Reset()
	reportReadiness(context.Background(), localState{Hive: blocked.URL, Credential: "bee-test"}, "openai", newConsole(&out))
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("want one line per reason: %q", out.String())
	}
	for _, want := range []string{"code=codex_confirmation_required", "confirm-account", "code=plan_not_configured", "owner=administrator"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("summary lacks %q: %s", want, out.String())
		}
	}
	if strings.Contains(out.String(), "taking new work\"") {
		t.Fatal("blocked platform reported ready")
	}
}

func TestReadinessSummaryNamesAnUnreachableHive(t *testing.T) {
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	var out bytes.Buffer
	reportReadiness(context.Background(), localState{Hive: closed.URL, Credential: "bee-test"}, "openai", newConsole(&out))
	if !strings.Contains(out.String(), "code=BEE-HIVE-UNREACHABLE") {
		t.Fatalf("%q", out.String())
	}
}

func TestEgressFailuresAreVisibleAndThrottled(t *testing.T) {
	var out bytes.Buffer
	console := newConsole(&out)
	clock := time.Unix(0, 0)
	failures := newEgressFailures()
	failures.now = func() time.Time { return clock }
	refused := fail("BEE-EGRESS-NOT-ALLOWED", `"evil.example:443"`)
	for range 5 {
		failures.report(console, refused, "evil.example:443")
	}
	failures.report(console, dialProblem("chatgpt.com:443", errors.New("dial tcp: lookup chatgpt.com: no such host")), "chatgpt.com:443")
	failures.report(console, dialProblem("chatgpt.com:443", proxyError{"egress proxy did not establish a tunnel", nil}), "chatgpt.com:443")
	if got := strings.Count(out.String(), "\n"); got != 3 {
		t.Fatalf("want one line per code and address, got %d: %s", got, out.String())
	}
	for _, want := range []string{"level=WARN", "code=BEE-EGRESS-NOT-ALLOWED", "code=BEE-EGRESS-DIAL", "no such host", "code=BEE-EGRESS-PROXY", "fix="} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("lacks %q: %s", want, out.String())
		}
	}
	out.Reset()
	clock = clock.Add(time.Minute)
	failures.report(console, refused, "evil.example:443")
	if !strings.Contains(out.String(), `repeated="4 more since the last report"`) {
		t.Fatalf("held-back count missing: %s", out.String())
	}
}

// Reported egress failures reach Hive, and a report Hive does not confirm is
// sent again rather than lost.
func TestEgressFailuresAreForwardedToHive(t *testing.T) {
	previous := eventFlushInterval
	eventFlushInterval = 20 * time.Millisecond
	defer func() { eventFlushInterval = previous }()
	var mu sync.Mutex
	var received []beewire.SupplyEvent
	refuse := true
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path != "/api/bee/events" || r.Header.Get("Authorization") != "Bearer bee-test" {
			t.Errorf("unexpected request %s", r.URL.Path)
		}
		if refuse {
			refuse = false
			w.WriteHeader(503)
			return
		}
		var report beewire.SupplyEventReport
		json.NewDecoder(r.Body).Decode(&report)
		received = append(received, report.Events...)
		w.WriteHeader(204)
	}))
	defer hive.Close()
	failures := newEgressFailures()
	var out bytes.Buffer
	failures.report(newConsole(&out), fail("BEE-EGRESS-NOT-ALLOWED", `"evil.example:443"`), "evil.example:443")
	failures.report(newConsole(&out), dialProblem("chatgpt.com:443", errors.New("no such host")), "chatgpt.com:443")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { failures.forward(ctx, localState{Hive: hive.URL, Credential: "bee-test"}); close(done) }()
	// Hive holds the events before forward has read its answer, so wait for
	// forward to drop them too; cancelling earlier fails the send in flight
	// and rightly keeps the events for the next attempt.
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		n := len(received)
		mu.Unlock()
		failures.mu.Lock()
		queued := len(failures.pending)
		failures.mu.Unlock()
		if n >= 2 && queued == 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 2 || received[0].Code != "BEE-EGRESS-NOT-ALLOWED" || received[1].Code != "BEE-EGRESS-DIAL" || received[1].Host != "chatgpt.com:443" || received[0].Count != 1 {
		t.Fatalf("received %+v", received)
	}
	if len(failures.pending) != 0 {
		t.Fatal("sent events were kept")
	}
}
