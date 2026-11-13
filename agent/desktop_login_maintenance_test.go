package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopLoginMaintenanceConcurrentPlatformsRetainBothOriginalOperations(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.accounts.goos = "linux"
	for round := 0; round < 24; round++ {
		var arrived atomic.Int32
		ready := make(chan struct{})
		var once sync.Once
		f.mu.Lock()
		f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
			if q.Method == "GET" && strings.HasSuffix(q.URL.Path, "/account") {
				if arrived.Add(1) == 2 {
					once.Do(func() { close(ready) })
				}
				select {
				case <-ready:
				case <-q.Context().Done():
					return true
				}
			}
			return false
		}
		f.mu.Unlock()
		owners := map[string]*DesktopAuthorizer{}
		operations := map[string]DesktopOperation{}
		for _, platform := range []string{"openai", "claude"} {
			current := f.detect(platform)
			o, _, release := desktopLoginMaintenanceOwner(t, f, platform, "succeeded")
			if err := os.WriteFile(release, []byte("continue"), 0600); err != nil {
				t.Fatal(err)
			}
			op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: platform, Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
			if err != nil {
				t.Fatal(err)
			}
			owners[platform], operations[platform] = o, op
		}
		for _, platform := range []string{"openai", "claude"} {
			if done := waitAuthorize(t, owners[platform], operations[platform].ID); done.State != "succeeded" {
				t.Fatalf("concurrent login round=%d platform=%s result=%+v", round, platform, done)
			}
		}
		path, _ := f.accounts.device.configPath()
		raw, err := os.ReadFile(filepath.Join(filepath.Dir(path), "login-maintenance.json"))
		var journal struct {
			Records map[string]struct {
				Maintenance DesktopLoginMaintenance `json:"maintenance"`
			} `json:"records"`
		}
		if err != nil || json.Unmarshal(raw, &journal) != nil || len(journal.Records) != 2 {
			t.Fatalf("concurrent login lost persisted platform evidence: round=%d records=%d read=%v", round, len(journal.Records), err)
		}
		for _, record := range journal.Records {
			op := record.Maintenance.Operation
			if op.Platform == nil || operations[*op.Platform].ID != op.ID || op.State != "succeeded" || record.Maintenance.Phase != "restored" {
				t.Fatalf("concurrent login replaced original operation: round=%d maintenance=%+v", round, record.Maintenance)
			}
		}
		for _, owner := range owners {
			owner.Close()
		}
	}
}

func TestDesktopLoginMaintenanceFinalJournalFailureKeepsIsolationUntilReadOnlyRepair(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.accounts.goos = "linux"
	path, _ := f.accounts.device.configPath()
	journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
	backup := journal + ".controlled-backup"
	var armed, replaced atomic.Bool
	original := f.accounts.transport
	f.accounts.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
		raw, _ := os.ReadFile(journal)
		if q.URL.Path == "/api/oauth/profile" && armed.Load() && bytes.Contains(raw, []byte(`"phase":"reconciling"`)) && replaced.CompareAndSwap(false, true) {
			if err := os.Rename(journal, backup); err != nil {
				return nil, err
			}
			if err := os.Mkdir(journal, 0700); err != nil {
				return nil, err
			}
		}
		return original.RoundTrip(q)
	})
	f.selectAccount("claude")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["claude"].Supply != nil })
	o, started, release := desktopLoginMaintenanceOwner(t, f, "claude", "succeeded")
	current, _ := f.accounts.Snapshot(context.Background(), "claude", false)
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "claude", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	waitDesktopLoginFile(t, started)
	armed.Store(true)
	os.WriteFile(release, []byte("continue"), 0600)
	if done := waitAuthorize(t, o, op.ID); done.State != "succeeded" {
		t.Fatalf("maintenance storage failure changed official result: %+v", done)
	}
	blocked, _ := f.accounts.Snapshot(context.Background(), "claude", false)
	if !replaced.Load() || blocked.LoginMaintenance == nil || blocked.LoginMaintenance.Phase != "blocked" || blocked.LoginMaintenance.Error == nil {
		t.Fatalf("final journal failure not reported: %+v", blocked.LoginMaintenance)
	}
	f.mu.Lock()
	peer := f.peer
	f.mu.Unlock()
	if err := probeDesktopAutoRelay(peer, "claude"); err == nil {
		t.Fatal("failed final journal commit reopened target forwarding")
	}
	if _, err := f.accounts.device.SetPaused(context.Background(), "claude", false); err == nil {
		t.Fatal("failed final journal commit allowed platform resume")
	}
	if err := os.Remove(journal); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, journal); err != nil {
		t.Fatal(err)
	}
	writes := f.pauseWrites.Load()
	if _, err := f.accounts.Snapshot(context.Background(), "claude", true); err != nil {
		t.Fatal(err)
	}
	after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		m := s.Platforms["claude"].Account.LoginMaintenance
		return m != nil && m.Phase == "restored" && s.Platforms["claude"].Supply != nil
	})
	m := after.Platforms["claude"].Account.LoginMaintenance
	if m.Operation.ID != op.ID || m.Operation.State != "succeeded" || !after.Platforms["claude"].Supply.Paused || f.pauseWrites.Load() != writes {
		t.Fatalf("read-only final journal repair changed original operation or pause: %+v", after)
	}
}

// Public-boundary risk matrix: pause acknowledgment precedes isolation/login;
// unknown writes are never replayed; original login result survives recovery;
// another platform and existing streams remain independent; forwarding is ready
// before newly synchronized authorization may be dispatched.
func TestDesktopLoginMaintenanceProcessHelper(t *testing.T) {
	if os.Getenv("BEE_MAINTENANCE_HELPER") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	args = args[1:]
	if args[0] == "--version" {
		if os.Getenv("BEE_MAINTENANCE_PLATFORM") == "claude" {
			fmt.Print("2.1.153 (Claude Code)")
		} else {
			fmt.Print("codex-cli 0.162.1")
		}
		os.Exit(0)
	}
	if args[len(args)-1] == "--help" {
		fmt.Print("Usage: login --claudeai")
		os.Exit(0)
	}
	if err := os.WriteFile(os.Getenv("BEE_MAINTENANCE_STARTED"), []byte("started"), 0600); err != nil {
		os.Exit(2)
	}
	for {
		if _, err := os.Stat(os.Getenv("BEE_MAINTENANCE_RELEASE")); err == nil {
			break
		}
		time.Sleep(time.Millisecond)
	}
	raw, err := os.ReadFile(os.Getenv("BEE_MAINTENANCE_SOURCE"))
	if err != nil {
		os.Exit(3)
	}
	path := filepath.Join(os.Getenv("CODEX_HOME"), "auth.json")
	if os.Getenv("BEE_MAINTENANCE_PLATFORM") == "claude" {
		path = filepath.Join(os.Getenv("CLAUDE_CONFIG_DIR"), ".credentials.json")
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		os.Exit(4)
	}
	if os.Getenv("BEE_MAINTENANCE_RESULT") == "failed" {
		os.Exit(7)
	}
	if os.Getenv("BEE_MAINTENANCE_RESULT") == "cancel_after_write" {
		os.WriteFile(os.Getenv("BEE_MAINTENANCE_STARTED")+".changed", []byte("changed"), 0600)
		for {
			time.Sleep(time.Second)
		}
	}
	os.Exit(0)
}

func TestDesktopLoginMaintenanceConfirmedChangeJournalFailureCanBeReconciledWithoutAnotherConfirmation(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.accounts.goos = "linux"
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	o, started, release := desktopLoginMaintenanceOwner(t, f, "openai", "failed")
	if err := os.WriteFile(filepath.Join(filepath.Dir(started), "sample"), desktopOtherCodexFixture(t), 0600); err != nil {
		t.Fatal(err)
	}
	current, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	waitDesktopLoginFile(t, started)
	os.WriteFile(release, []byte("continue"), 0600)
	if done := waitAuthorize(t, o, op.ID); done.State != "failed" {
		t.Fatalf("official login result=%+v; required=failed", done)
	}
	changed, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	if changed.LoginMaintenance == nil || changed.LoginMaintenance.Phase != "confirmation_required" || changed.Candidate.Reference == nil {
		t.Fatalf("changed identity not ready for explicit confirmation: %+v", changed)
	}
	path, _ := f.accounts.device.configPath()
	journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
	backup := journal + ".controlled-backup"
	var replaced atomic.Bool
	var confirms atomic.Int32
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if strings.HasSuffix(q.URL.Path, "/account/confirm") {
			confirms.Add(1)
		}
		if q.Method == "GET" && q.URL.Path == "/api/bee/platforms/openai" {
			f.mu.Lock()
			account := f.account["openai"]
			f.mu.Unlock()
			if account.Generation == 2 && account.Status == "ready" && replaced.CompareAndSwap(false, true) {
				if err := os.Rename(journal, backup); err != nil {
					t.Error(err)
				}
				if err := os.Mkdir(journal, 0700); err != nil {
					t.Error(err)
				}
			}
		}
		return false
	}
	f.mu.Unlock()
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Action: "confirm_change", Revision: changed.Revision, CandidateRef: *changed.Candidate.Reference, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	failed := waitSelection(t, f.accounts, "openai")
	if !replaced.Load() || failed.Operation.State == "succeeded" || failed.Operation.Error == nil || confirms.Load() != 1 {
		t.Fatalf("final login journal failure not reached: confirms=%d snapshot=%+v", confirms.Load(), failed)
	}
	if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err == nil {
		t.Fatal("unconfirmed maintenance commit allowed resume")
	}
	if err := os.Remove(journal); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, journal); err != nil {
		t.Fatal(err)
	}
	writes := f.supplyWrites.Load()
	if _, err := f.accounts.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		after, _ := f.accounts.Snapshot(context.Background(), "openai", false)
		if m := after.LoginMaintenance; m != nil && m.Phase == "restored" {
			if m.Operation.ID != op.ID || m.Operation.State != "failed" || after.Hive.Generation == nil || *after.Hive.Generation != 2 || confirms.Load() != 1 || f.supplyWrites.Load() != writes {
				t.Fatalf("read-only repair replaced login or replayed a write: confirms=%d snapshot=%+v", confirms.Load(), after)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	after, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	t.Fatalf("confirmed account cannot repair final login journal without another user confirmation: %+v", after)
}

func TestDesktopLoginMaintenanceDifferentIdentityNeedsExplicitConfirmationAndReadyForwarding(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			f.accounts.goos = "linux"
			if platform == "claude" {
				f.accounts.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
					if q.URL.Path == "/api/oauth/profile" {
						profile := `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`
						if strings.Contains(q.Header.Get("Authorization"), "renewed") {
							profile = strings.ReplaceAll(profile, "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333")
						}
						return claudeProfileResponse(200, profile), nil
					}
					return claudeProfileResponse(503, `{}`), nil
				})
			}
			f.selectAccount(platform)
			before := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms[platform].Supply != nil })
			o, started, release := desktopLoginMaintenanceOwner(t, f, platform, "failed")
			if platform == "openai" {
				os.WriteFile(filepath.Join(filepath.Dir(started), "sample"), desktopOtherCodexFixture(t), 0600)
			}
			var confirms atomic.Int32
			f.mu.Lock()
			f.dispatchOnUpload = true
			f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
				if strings.HasSuffix(q.URL.Path, "/account/confirm") {
					confirms.Add(1)
				}
				return false
			}
			f.mu.Unlock()
			current, _ := f.accounts.Snapshot(context.Background(), platform, false)
			op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: platform, Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
			if err != nil {
				t.Fatal(err)
			}
			waitDesktopLoginFile(t, started)
			os.WriteFile(release, []byte("continue"), 0600)
			done := waitAuthorize(t, o, op.ID)
			changed, _ := f.accounts.Snapshot(context.Background(), platform, false)
			if done.State != "failed" || changed.LoginMaintenance == nil || changed.LoginMaintenance.Phase != "confirmation_required" || changed.Candidate.Fingerprint == nil || changed.Selection.Fingerprint == nil || *changed.Candidate.Fingerprint == *changed.Selection.Fingerprint || confirms.Load() != 0 {
				t.Fatalf("different identity was auto-selected or original login result lost: operation=%+v snapshot=%+v confirms=%d", done, changed, confirms.Load())
			}
			if _, err := f.accounts.device.SetPaused(context.Background(), platform, false); err == nil {
				t.Fatal("different identity resumed before account confirmation")
			}
			if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: platform, Action: "confirm_change", Revision: changed.Revision, CandidateRef: *changed.Candidate.Reference, Confirmed: true}); err != nil {
				t.Fatal(err)
			}
			confirmed := waitSelection(t, f.accounts, platform)
			if confirmed.Operation.State != "succeeded" {
				t.Fatalf("explicit account change failed: %+v", confirmed.Operation)
			}
			select {
			case err := <-f.dispatchResults:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("new identity authorization not uploaded")
			}
			after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Platforms[platform].Supply != nil && s.Platforms[platform].Account.Authorization.State == "synchronized"
			})
			maintenance := after.Platforms[platform].Account.LoginMaintenance
			if confirms.Load() != 1 || before.RunID == nil || after.RunID == nil || *before.RunID != *after.RunID || !after.Platforms[platform].Supply.Paused || maintenance == nil || maintenance.Phase != "restored" || maintenance.Operation.State != "failed" || maintenance.Operation.ID != op.ID {
				t.Fatalf("account confirmation lost original result or resumed platform: confirms=%d maintenance=%+v snapshot=%+v", confirms.Load(), maintenance, after)
			}
		})
	}
}

func TestDesktopLoginMaintenanceRecoveryPreservesFailedCancelledAndTimedOutLogin(t *testing.T) {
	for _, outcome := range []string{"failed", "cancelled", "timeout"} {
		t.Run(outcome, func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			f.selectAccount("openai")
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
			mode := outcome
			if outcome != "failed" {
				mode = "cancel_after_write"
			}
			o, started, release := desktopLoginMaintenanceOwner(t, f, "openai", mode)
			var deadlineContext *authorizeObservedDeadline
			if outcome == "timeout" {
				deadlineContext = &authorizeObservedDeadline{Context: context.Background(), done: make(chan struct{})}
				o.cancel()
				o.ctx, o.cancel = context.WithCancel(deadlineContext)
			}
			f.mu.Lock()
			f.dispatchOnUpload = true
			f.mu.Unlock()
			current, _ := f.accounts.Snapshot(context.Background(), "openai", false)
			op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
			if err != nil {
				t.Fatal(err)
			}
			waitDesktopLoginFile(t, started)
			os.WriteFile(release, []byte("continue"), 0600)
			if outcome != "failed" {
				waitDesktopLoginFile(t, started+".changed")
				if outcome == "cancelled" {
					if _, err := o.Cancel(context.Background(), op.ID); err != nil {
						t.Fatal(err)
					}
				} else {
					close(deadlineContext.done)
				}
			}
			done := waitAuthorize(t, o, op.ID)
			want := "failed"
			if outcome == "cancelled" {
				want = "cancelled"
			}
			after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Platforms["openai"].Supply != nil && s.Platforms["openai"].Account.Authorization.State == "synchronized"
			})
			maintenance := after.Platforms["openai"].Account.LoginMaintenance
			if done.State != want || done.Error == nil || maintenance == nil || maintenance.Phase != "restored" || maintenance.Operation.State != want || maintenance.Operation.ID != op.ID || maintenance.Operation.Error == nil || !after.Platforms["openai"].Supply.Paused || f.resumeWrites.Load() != 0 {
				t.Fatalf("recovery rewrote original login result: original=%+v maintenance=%+v snapshot=%+v", done, maintenance, after)
			}
			select {
			case err := <-f.dispatchResults:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("restored authorization was not uploaded through the ready relay")
			}
			path, _ := f.accounts.device.configPath()
			journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
			raw, err := os.ReadFile(journal)
			info, statErr := os.Stat(journal)
			if err != nil || statErr != nil || info.Mode().Perm() != 0600 || bytes.Contains(raw, []byte("synthetic-refresh")) || bytes.Contains(raw, []byte("access_token")) {
				t.Fatalf("login maintenance evidence protection: read=%v stat=%v", err, statErr)
			}
		})
	}
}

func TestDesktopLoginMaintenanceUnknownPauseOnlyRechecksOriginalProcess(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err != nil {
		t.Fatal(err)
	}
	o, started, _ := desktopLoginMaintenanceOwner(t, f, "openai", "succeeded")
	var written, recovered atomic.Bool
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" {
			return false
		}
		if q.Method == "PUT" {
			io.Copy(io.Discard, q.Body)
			f.mu.Lock()
			f.paused["openai"] = true
			f.mu.Unlock()
			written.Store(true)
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
			} else {
				conn.Close()
			}
			return true
		}
		if written.Load() && !recovered.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			io.WriteString(w, `{"code":"readback_unavailable","message":"controlled login pause read outage"}`)
			return true
		}
		return false
	}
	f.mu.Unlock()
	current, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	done := waitAuthorize(t, o, op.ID)
	blocked, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	if done.State != "failed" || blocked.LoginMaintenance == nil || blocked.LoginMaintenance.Phase != "blocked" || blocked.LoginMaintenance.Error == nil {
		t.Fatalf("unknown pause lost original result: operation=%+v maintenance=%+v", done, blocked.LoginMaintenance)
	}
	if _, err := os.Stat(started); !os.IsNotExist(err) {
		t.Fatalf("unknown pause started official login: stat=%v", err)
	}
	writes := f.pauseWrites.Load()
	recovered.Store(true)
	if _, err := f.accounts.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		after, _ := f.accounts.Snapshot(context.Background(), "openai", false)
		if after.LoginMaintenance != nil && after.LoginMaintenance.Phase == "restored" {
			if after.LoginMaintenance.Operation.ID != op.ID || after.LoginMaintenance.Operation.State != "failed" || after.LoginMaintenance.Operation.Error == nil || f.pauseWrites.Load() != writes {
				t.Fatalf("recheck changed original result or replayed write: %+v writes=%d expected=%d", after.LoginMaintenance, f.pauseWrites.Load(), writes)
			}
			if _, err := os.Stat(started); !os.IsNotExist(err) {
				t.Fatalf("read-only recheck started official login: stat=%v", err)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("read-only recheck did not recover original maintenance")
}

func desktopLoginMaintenanceOwner(t *testing.T, f *desktopAutoMaintenanceFixture, platform, result string) (*DesktopAuthorizer, string, string) {
	t.Helper()
	directory := t.TempDir()
	started, release, sample := filepath.Join(directory, "started"), filepath.Join(directory, "release"), filepath.Join(directory, "sample")
	raw := desktopCodexFixture(t, time.Now().Add(2*time.Hour))
	if platform == "claude" {
		raw = claudeSample(time.Now().Add(2 * time.Hour))
		raw = bytes.ReplaceAll(raw, []byte("synthetic-claude-access"), []byte("synthetic-claude-renewed-access"))
	}
	if err := os.WriteFile(sample, raw, 0600); err != nil {
		t.Fatal(err)
	}
	o := NewDesktopAuthorizer(context.Background(), f.accounts)
	o.interact = runDesktopAuthorization
	o.resolve = func(string) (string, error) { return os.Executable() }
	o.command = func(program string, args ...string) *exec.Cmd {
		c := exec.Command(program, append([]string{"-test.run=^TestDesktopLoginMaintenanceProcessHelper$", "--"}, args...)...)
		c.Env = append(os.Environ(), "BEE_MAINTENANCE_HELPER=1", "GORACE=atexit_sleep_ms=0", "BEE_MAINTENANCE_PLATFORM="+platform, "BEE_MAINTENANCE_RESULT="+result, "BEE_MAINTENANCE_STARTED="+started, "BEE_MAINTENANCE_RELEASE="+release, "BEE_MAINTENANCE_SOURCE="+sample)
		return c
	}
	t.Cleanup(o.Close)
	return o, started, release
}

func waitDesktopLoginFile(t *testing.T, path string) {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("owned official process did not produce its start marker within 5s")
}

func echoExistingDesktopLoginStream(t *testing.T, stream io.ReadWriter) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		probe := "existing-login-stream"
		_, err := io.WriteString(stream, probe)
		if err == nil {
			buffer := make([]byte, len(probe))
			_, err = io.ReadFull(stream, buffer)
			if err == nil && string(buffer) != probe {
				err = fmt.Errorf("existing stream reply mismatch: bytes=%d", len(buffer))
			}
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("owned login interrupted an existing stream: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("existing stream did not remain usable during login")
	}
}

func TestDesktopLoginMaintenanceRejectsCorruptJournalWithoutLaunchingOrReplacingEvidence(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	o, started, release := desktopLoginMaintenanceOwner(t, f, "openai", "succeeded")
	current, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	waitDesktopLoginFile(t, started)
	os.WriteFile(release, []byte("continue"), 0600)
	if result := waitAuthorize(t, o, op.ID); result.State != "succeeded" {
		t.Fatalf("initial login=%+v", result)
	}
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	path, _ := f.accounts.device.configPath()
	journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
	raw, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	json.Unmarshal(raw, &decoded)
	for _, value := range decoded["records"].(map[string]any) {
		value.(map[string]any)["maintenance"].(map[string]any)["started_at"] = "invalid timestamp"
	}
	corrupt, _ := json.Marshal(decoded)
	os.WriteFile(journal, corrupt, 0600)
	os.Remove(started)
	writes := f.pauseWrites.Load()
	current, _ = f.accounts.Snapshot(context.Background(), "openai", false)
	op, err = o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, o, op.ID)
	after, _ := os.ReadFile(journal)
	if result.State != "failed" || result.Error == nil || !strings.Contains(result.Error.Message, "timestamp") || !bytes.Equal(after, corrupt) || f.pauseWrites.Load() != writes {
		t.Fatalf("corrupt recovery evidence was accepted or replaced: operation=%+v error=%+v unchanged=%t writes=%d expected=%d", result, result.Error, bytes.Equal(after, corrupt), f.pauseWrites.Load(), writes)
	}
	if _, err := os.Stat(started); !os.IsNotExist(err) {
		t.Fatalf("corrupt journal reached official process: stat=%v", err)
	}
}

func TestDesktopLoginMaintenanceReadOnlyRepairDischargesOnlyConfirmedJournalFailure(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	o, started, _ := desktopLoginMaintenanceOwner(t, f, "openai", "succeeded")
	current, _ := f.accounts.Snapshot(context.Background(), "openai", false)
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	waitDesktopLoginFile(t, started)
	path, _ := f.accounts.device.configPath()
	journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
	if err := os.Rename(journal, journal+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(journal, 0700); err != nil {
		t.Fatal(err)
	}
	if err := o.CancelAndWait(); err == nil {
		t.Fatal("failed journal save produced a clean login join receipt")
	}
	done := waitAuthorize(t, o, op.ID)
	if done.State != "cancelled" {
		t.Fatalf("journal failure changed original cancellation: %+v", done)
	}
	if err := os.Remove(journal); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(journal+".saved", journal); err != nil {
		t.Fatal(err)
	}
	if _, err := f.accounts.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		snapshot, _ := f.accounts.Snapshot(context.Background(), "openai", false)
		if snapshot.LoginMaintenance != nil && snapshot.LoginMaintenance.Phase == "restored" {
			if snapshot.LoginMaintenance.Operation.State != "cancelled" || snapshot.LoginMaintenance.Operation.ID != op.ID {
				t.Fatalf("journal repair rewrote original process result: %+v", snapshot.LoginMaintenance)
			}
			if err := o.CancelAndWait(); err != nil {
				t.Fatalf("confirmed journal repair kept stale storage cleanup failure: %v", err)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("repaired original journal did not settle")
}

func TestDesktopLoginMaintenanceRunningPlatformRestoresSameIdentityAndKeepsOtherPlatform(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			f.accounts.goos = "linux"
			f.selectAccount("openai")
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
			f.selectAccount("claude")
			before := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
			})
			other := "claude"
			if platform == "claude" {
				other = "openai"
			}
			if _, err := f.accounts.device.SetPaused(context.Background(), platform, false); err != nil {
				t.Fatal(err)
			}
			if _, err := f.accounts.device.SetPaused(context.Background(), other, false); err != nil {
				t.Fatal(err)
			}
			o, started, release := desktopLoginMaintenanceOwner(t, f, platform, "succeeded")
			f.mu.Lock()
			peerBeforeLogin := f.peer
			f.mu.Unlock()
			metadata, _ := json.Marshal(map[string]string{"host": runtimePlatformTarget(platform)})
			existing, err := peerBeforeLogin.Mux.Dial(metadata)
			if err != nil {
				t.Fatal(err)
			}
			defer existing.Close()
			echoExistingDesktopLoginStream(t, existing)
			current, err := f.accounts.Snapshot(context.Background(), platform, false)
			if err != nil || current.Candidate.Source == nil {
				t.Fatalf("login source: snapshot=%+v error=%v", current, err)
			}
			op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: platform, Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
			if err != nil {
				t.Fatalf("running target login rejected: %v", err)
			}
			waitDesktopLoginFile(t, started)
			f.mu.Lock()
			paused, otherPaused, peer := f.paused[platform], f.paused[other], f.peer
			f.mu.Unlock()
			if !paused || otherPaused {
				t.Fatalf("official process started without independent pause: target=%t other=%t", paused, otherPaused)
			}
			echoExistingDesktopLoginStream(t, existing)
			if err := probeDesktopAutoRelay(peer, platform); err == nil {
				t.Fatal("new forwarding remained open during official login")
			}
			if err := probeDesktopAutoRelay(peer, other); err != nil {
				t.Fatalf("other platform forwarding interrupted: %v", err)
			}
			if _, err := f.accounts.device.SetPaused(context.Background(), platform, false); err == nil {
				t.Fatal("target resumed while official login active")
			}
			if err := os.WriteFile(release, []byte("continue"), 0600); err != nil {
				t.Fatal(err)
			}
			done := waitAuthorize(t, o, op.ID)
			if done.State != "succeeded" {
				t.Fatalf("official login failed: %+v", done)
			}
			verified, _ := f.accounts.Snapshot(context.Background(), platform, false)
			if verified.LoginMaintenance == nil || verified.LoginMaintenance.Phase != "restored" {
				raw, _ := json.Marshal(verified)
				t.Fatalf("login maintenance did not restore: %s", raw)
			}
			after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Platforms[platform].Supply != nil && s.Platforms[platform].Account.Authorization.State == "synchronized"
			})
			if before.RunID == nil || after.RunID == nil || *before.RunID != *after.RunID || !after.Platforms[platform].Supply.Paused || f.connections.Load() != 1 {
				t.Fatalf("login restarted owned run or resumed target: before=%+v after=%+v connections=%d", before, after, f.connections.Load())
			}
			raw, _ := json.Marshal(after.Platforms[platform].Account)
			var published struct {
				Maintenance *struct {
					Phase     string           `json:"phase"`
					Operation DesktopOperation `json:"operation"`
				} `json:"login_maintenance"`
			}
			json.Unmarshal(raw, &published)
			if published.Maintenance == nil || published.Maintenance.Phase != "restored" || published.Maintenance.Operation.ID != op.ID {
				t.Fatalf("maintenance recovery not published separately: %s", raw)
			}
		})
	}
}
