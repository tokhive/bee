package bee

import (
	"context"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// blockingSource counts its synchronizations and then waits for its context, so
// a test can see when it starts and whether cancelling it stops it.
func blockingSource(name string, runs *atomic.Int32, targets ...string) syncSource {
	return syncSource{name: name, targets: targets, report: func(io.Writer, string, string) {},
		synchronize: func(ctx context.Context, _ localState, _ string, _ io.Writer, _ bool) error {
			runs.Add(1)
			<-ctx.Done()
			return ctx.Err()
		}}
}

func waitUntil(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting: %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A source removed from a live connection stops alone; the other keeps running
// and keeps its upstream allowed, and a source added later starts at once.
func TestSourceSetChangesWhileConnected(t *testing.T) {
	live, cancel := context.WithCancel(context.Background())
	defer cancel()
	var first, second, third atomic.Int32
	set := &sourceSet{}
	set.add(blockingSource("first", &first, "first.example:443"))
	set.add(blockingSource("second", &second, "second.example:443"))
	_, wait := set.begin(live, localState{}, "lease", io.Discard)

	// Streams keep checking the allowlist while sources change.
	var streams sync.WaitGroup
	stopStreams := make(chan struct{})
	for range 4 {
		streams.Go(func() {
			for {
				select {
				case <-stopStreams:
					return
				default:
					set.allows("first.example:443")
					set.want("")
				}
			}
		})
	}

	waitUntil(t, "both sources start", func() bool { return first.Load() == 1 && second.Load() == 1 })
	if !set.remove("second") {
		t.Fatal("second source was not configured")
	}
	if set.allows("second.example:443") {
		t.Fatal("a removed source's upstream is still allowed")
	}
	if !set.allows("first.example:443") {
		t.Fatal("removing one source dropped another's upstream")
	}
	if err := set.add(blockingSource("third", &third, "third.example:443")); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "a source added while connected starts", func() bool { return third.Load() == 1 })
	if err := set.add(blockingSource("third", &third)); err != errSourceExists {
		t.Fatalf("adding a duplicate = %v, want errSourceExists", err)
	}
	if got := set.names(); len(got) != 2 || got[0] != "first" || got[1] != "third" {
		t.Fatalf("names = %v", got)
	}
	close(stopStreams)
	streams.Wait()

	cancel()
	done := make(chan struct{})
	go func() { wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("ending the connection did not stop the sources, including the one added later")
	}
	if first.Load() != 1 || third.Load() != 1 {
		t.Fatalf("a source synchronized again after the connection ended: first=%d third=%d", first.Load(), third.Load())
	}
}

// A source added between connections waits for the next one, and every source
// starts again on a reconnect.
func TestSourceSetAcrossConnections(t *testing.T) {
	var a, b atomic.Int32
	set := &sourceSet{}
	set.add(blockingSource("a", &a))

	live, cancel := context.WithCancel(context.Background())
	_, wait := set.begin(live, localState{}, "lease", io.Discard)
	waitUntil(t, "a starts", func() bool { return a.Load() == 1 })
	cancel()
	wait()

	set.add(blockingSource("b", &b))
	time.Sleep(50 * time.Millisecond)
	if b.Load() != 0 {
		t.Fatal("a source started with no connection")
	}

	live, cancel = context.WithCancel(context.Background())
	_, wait = set.begin(live, localState{}, "lease", io.Discard)
	waitUntil(t, "both start on the next connection", func() bool { return a.Load() == 2 && b.Load() == 1 })
	cancel()
	wait()
}

// A source that Hive rejects the device for ends the connection's
// synchronization with that error.
func TestSourceSetForwardsDeviceRejection(t *testing.T) {
	set := &sourceSet{}
	rejected := &apiFailure{Status: 401, Code: "invalid_device_credential"}
	set.add(syncSource{name: "rejected", report: func(io.Writer, string, string) {},
		synchronize: func(context.Context, localState, string, io.Writer, bool) error { return rejected }})
	live, cancel := context.WithCancel(context.Background())
	defer cancel()
	failures, wait := set.begin(live, localState{}, "lease", io.Discard)
	select {
	case err := <-failures:
		if err != rejected {
			t.Fatalf("failure = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("rejection not forwarded")
	}
	cancel()
	wait()
}

// Hive's capability request reaches the configured platform's source only.
func TestControlRoutesCapabilityRequests(t *testing.T) {
	cfg := &egressConfig{Codex: &codexSource{}, Capabilities: &capabilitySource{}, Claude: &claudeSource{}}
	cfg.control(beewire.Control{Control: beewire.ControlCapabilities, Platform: "claude"})
	if !cfg.claudeCapabilityWanted.Load() || cfg.capabilityWanted.Load() {
		t.Fatalf("claude request: claude=%v openai=%v", cfg.claudeCapabilityWanted.Load(), cfg.capabilityWanted.Load())
	}
	cfg.control(beewire.Control{Control: beewire.ControlCapabilities, Platform: "openai"})
	if !cfg.capabilityWanted.Load() {
		t.Fatal("openai request not delivered")
	}

	withoutReports := &egressConfig{Codex: &codexSource{}}
	withoutReports.control(beewire.Control{Control: beewire.ControlCapabilities, Platform: "openai"})
	if withoutReports.capabilityWanted.Load() {
		t.Fatal("a capability request reached an OpenAI source that sends no capability reports")
	}
}

// A stream is allowed to the configuration's targets and to those a source
// brought while running, and to nothing else.
func TestAllowedUnionsConfigurationAndSourceTargets(t *testing.T) {
	cfg := &egressConfig{Targets: []string{"chatgpt.com:443"}}
	var runs atomic.Int32
	if err := cfg.sources().add(blockingSource("claude", &runs, "api.anthropic.com:443")); err != nil {
		t.Fatal(err)
	}
	for host, want := range map[string]bool{"chatgpt.com:443": true, "api.anthropic.com:443": true, "evil.example:443": false} {
		if got := cfg.allowed(host); got != want {
			t.Errorf("allowed(%q) = %v, want %v", host, got, want)
		}
	}
	cfg.sources().remove("claude")
	if cfg.allowed("api.anthropic.com:443") {
		t.Error("upstream still allowed after its source was removed")
	}
}
