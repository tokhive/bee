package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This is a genuine management process, terminated by the caller without any
// cancellation/Close hook. The official fixture is its own separate OS child.
func TestDesktopLoginRecoveryManagementProcess(t *testing.T) {
	if os.Getenv("BEE_LOGIN_RECOVERY_MANAGER") != "1" {
		return
	}
	d := &DesktopDevice{path: os.Getenv("BEE_LOGIN_RECOVERY_DEVICE")}
	a := NewDesktopAccounts(d)
	a.goos = "linux"
	platform := os.Getenv("BEE_LOGIN_RECOVERY_PLATFORM")
	if platform == "" {
		platform = "openai"
	}
	result := os.Getenv("BEE_LOGIN_RECOVERY_RESULT")
	if result == "" {
		result = "succeeded"
	}
	a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
		if profile := os.Getenv("BEE_LOGIN_RECOVERY_PROFILE"); profile != "" {
			request, err := http.NewRequestWithContext(q.Context(), http.MethodGet, profile+q.URL.Path, nil)
			if err != nil {
				return nil, err
			}
			return http.DefaultClient.Do(request)
		}
		if q.URL.Path == "/api/oauth/profile" {
			return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
		}
		return claudeProfileResponse(503, `{}`), nil
	})
	o := NewDesktopAuthorizer(context.Background(), a)
	o.interact = runDesktopAuthorization
	o.resolve = func(string) (string, error) { return os.Executable() }
	o.command = func(program string, args ...string) *exec.Cmd {
		c := exec.Command(program, append([]string{"-test.run=^TestDesktopLoginMaintenanceProcessHelper$", "--"}, args...)...)
		c.Env = append(os.Environ(), "BEE_MAINTENANCE_HELPER=1", "BEE_MAINTENANCE_PLATFORM="+platform, "BEE_MAINTENANCE_RESULT="+result)
		return c
	}
	if raw := os.Getenv("BEE_LOGIN_RECOVERY_RUNTIME"); raw != "" {
		var network DesktopNetworkConfig
		if err := json.Unmarshal([]byte(raw), &network); err != nil {
			t.Fatal(err)
		}
		r := NewDesktopRuntime(context.Background(), d, a)
		if err := r.ConfigureNetwork(context.Background(), network); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Restore(context.Background()); err != nil {
			t.Fatal(err)
		}
		waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
			return s.Local == "running" && s.Platforms["openai"].Supply != nil
		})
	}
	directory := os.Getenv("BEE_LOGIN_RECOVERY_SOURCE")
	s, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: platform, Directory: &directory, Store: "file", Mode: "local"})
	if err != nil {
		t.Fatal(err)
	}
	op, err := o.Start(context.Background(), DesktopAuthorizeRequest{Platform: platform, Source: *s.Candidate.Source, ExpectedRevision: s.Revision})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(op)
	if err := os.WriteFile(os.Getenv("BEE_LOGIN_RECOVERY_OPERATION"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if result == "cancel_after_write" {
		waitDesktopLoginFile(t, os.Getenv("BEE_MAINTENANCE_STARTED")+".changed")
		if _, err := o.Cancel(context.Background(), op.ID); err != nil {
			t.Fatal(err)
		}
	}
	for {
		if current, err := o.Status(context.Background(), op.ID); err != nil {
			t.Fatal(err)
		} else if current.State != "pending" && current.State != "running" {
			if _, err := os.Stat(os.Getenv("BEE_MAINTENANCE_STARTED")); os.IsNotExist(err) {
				t.Fatalf("official fixture did not start: state=%s error=%+v", current.State, current.Error)
			}
		}
		time.Sleep(time.Second)
	}
}

func TestDesktopLoginRecoveryAcrossRealProcessStageAndTerminalBoundaries(t *testing.T) {
	for _, scenario := range []struct{ name, platform, phase, result, state string }{
		{"pause_pending", "openai", "pause_pending", "succeeded", "unknown"},
		{"reconciling", "claude", "reconciling", "succeeded", "succeeded"},
		{"failed_result", "openai", "authorizing", "failed", "failed"},
		{"cancelled_result", "openai", "authorizing", "cancel_after_write", "cancelled"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			f.accounts.goos = "linux"
			f.selectAccount(scenario.platform)
			before := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms[scenario.platform].Supply != nil })
			source := before.Platforms[scenario.platform].Account.Candidate.Source
			if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: "app_exit"}); err != nil {
				t.Fatal(err)
			}
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
			path, _ := f.accounts.device.configPath()
			transport := f.accounts.transport
			f.runtime.Close()
			f.accounts.Close()
			f.accounts.device.Close()
			journal := filepath.Join(filepath.Dir(path), "login-maintenance.json")
			entered, unblock := make(chan struct{}), make(chan struct{})
			var once sync.Once
			blocked := func(q *http.Request) {
				raw, _ := os.ReadFile(journal)
				if bytes.Contains(raw, []byte(`"phase":"`+scenario.phase+`"`)) && (scenario.state == "unknown" || bytes.Contains(raw, []byte(`"state":"`+scenario.state+`"`))) {
					once.Do(func() { close(entered) })
					select {
					case <-unblock:
					case <-q.Context().Done():
					}
				}
			}
			profile := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
				blocked(q)
				fmt.Fprint(w, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`)
			}))
			t.Cleanup(profile.Close)
			f.mu.Lock()
			f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool { blocked(q); return false }
			f.mu.Unlock()
			control := t.TempDir()
			started, release, sample, operation := filepath.Join(control, "started"), filepath.Join(control, "release"), filepath.Join(control, "sample"), filepath.Join(control, "operation")
			raw := desktopCodexFixture(t, time.Now().Add(3*time.Hour))
			if scenario.platform == "claude" {
				raw = claudeSample(time.Now().Add(3 * time.Hour))
				raw = bytes.ReplaceAll(raw, []byte("synthetic-claude-access"), []byte("synthetic-claude-renewed-access"))
			}
			os.WriteFile(sample, raw, 0600)
			program, _ := os.Executable()
			manager := exec.Command(program, "-test.run=^TestDesktopLoginRecoveryManagementProcess$")
			manager.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_LOGIN_RECOVERY_MANAGER=1", "BEE_LOGIN_RECOVERY_DEVICE="+path, "BEE_LOGIN_RECOVERY_SOURCE="+*source.Directory, "BEE_LOGIN_RECOVERY_OPERATION="+operation,
				"BEE_LOGIN_RECOVERY_PLATFORM="+scenario.platform, "BEE_LOGIN_RECOVERY_RESULT="+scenario.result, "BEE_LOGIN_RECOVERY_PROFILE="+profile.URL,
				"BEE_MAINTENANCE_STARTED="+started, "BEE_MAINTENANCE_RELEASE="+release, "BEE_MAINTENANCE_SOURCE="+sample)
			var output bytes.Buffer
			manager.Stdout, manager.Stderr = &output, &output
			if err := manager.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { manager.Process.Kill(); os.WriteFile(release, []byte("cleanup"), 0600); close(unblock) })
			waitDesktopLoginFile(t, operation)
			if scenario.phase != "pause_pending" {
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					if _, err := os.Stat(started); err == nil {
						break
					}
					time.Sleep(time.Millisecond)
				}
				if _, err := os.Stat(started); err != nil {
					manager.Process.Kill()
					manager.Wait()
					t.Fatalf("official process did not start: %s", output.String())
				}
				os.WriteFile(release, []byte("continue"), 0600)
			}
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				manager.Process.Kill()
				manager.Wait()
				t.Fatalf("management process did not reach real external boundary: phase=%s result=%s output=%s", scenario.phase, scenario.state, output.String())
			}
			var original DesktopOperation
			raw, _ = os.ReadFile(operation)
			if err := json.Unmarshal(raw, &original); err != nil {
				t.Fatal(err)
			}
			manager.Process.Kill()
			manager.Wait()
			f.mu.Lock()
			f.beforeRequest = nil
			f.mu.Unlock()
			d := newDesktopTestDevice(t, path)
			a := NewDesktopAccounts(d)
			a.goos, a.transport = "linux", transport
			t.Cleanup(a.Close)
			o := NewDesktopAuthorizer(context.Background(), a)
			t.Cleanup(o.Close)
			writes := f.supplyWrites.Load()
			if _, err := a.Snapshot(context.Background(), scenario.platform, true); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				view, _ := a.Snapshot(context.Background(), scenario.platform, false)
				if m := view.LoginMaintenance; m != nil && m.Phase == "restored" {
					if m.Operation.ID != original.ID || m.Operation.State != scenario.state || f.supplyWrites.Load() != writes {
						t.Fatalf("cross-process recovery replaced terminal fact or replayed supply: %+v", m)
					}
					if scenario.phase == "pause_pending" {
						if _, err := os.Stat(started); !os.IsNotExist(err) {
							t.Fatal("pause_pending recovery launched an official login")
						}
					}
					return
				}
				time.Sleep(time.Millisecond)
			}
			view, _ := a.Snapshot(context.Background(), scenario.platform, false)
			t.Fatalf("interrupted stage did not settle original maintenance: %+v", view.LoginMaintenance)
		})
	}
}

func TestDesktopLoginRecoveryAfterActualParentDeathStopsOriginalProcessAndRetainsOperation(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	source := f.detect("openai")
	directory := *source.Candidate.Source.Directory
	devicePath, _ := f.accounts.device.configPath()
	f.runtime.Close()
	f.accounts.Close()
	f.accounts.device.Close()
	control := t.TempDir()
	started, release, sample, operation := filepath.Join(control, "started"), filepath.Join(control, "release"), filepath.Join(control, "sample"), filepath.Join(control, "operation")
	original, err := os.ReadFile(filepath.Join(directory, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sample, desktopCodexFixture(t, time.Now().Add(3*time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	program, _ := os.Executable()
	manager := exec.Command(program, "-test.run=^TestDesktopLoginRecoveryManagementProcess$")
	manager.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_LOGIN_RECOVERY_MANAGER=1", "BEE_LOGIN_RECOVERY_DEVICE="+devicePath, "BEE_LOGIN_RECOVERY_SOURCE="+directory, "BEE_LOGIN_RECOVERY_OPERATION="+operation,
		"BEE_MAINTENANCE_STARTED="+started, "BEE_MAINTENANCE_RELEASE="+release, "BEE_MAINTENANCE_SOURCE="+sample)
	var output bytes.Buffer
	manager.Stdout, manager.Stderr = &output, &output
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		manager.Process.Kill()
		os.WriteFile(release, []byte("cleanup"), 0600)
	})
	waitDesktopLoginFile(t, started)
	var originalOperation DesktopOperation
	raw, _ := os.ReadFile(operation)
	if err := json.Unmarshal(raw, &originalOperation); err != nil {
		t.Fatal(err)
	}
	if err := manager.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	manager.Wait()
	// Release the original command after the owner is dead. It must have been
	// stopped by owned lifetime supervision and cannot write the source later.
	time.Sleep(100 * time.Millisecond)
	os.WriteFile(release, []byte("continue after parent death"), 0600)
	time.Sleep(150 * time.Millisecond)
	after, err := os.ReadFile(filepath.Join(directory, "auth.json"))
	if err != nil || !bytes.Equal(after, original) {
		t.Fatalf("official login outlived its management owner and changed source: read=%v manager=%s", err, output.String())
	}
	d := newDesktopTestDevice(t, devicePath)
	a := NewDesktopAccounts(d)
	t.Cleanup(a.Close)
	o := NewDesktopAuthorizer(context.Background(), a)
	t.Cleanup(o.Close)
	first, err := a.Snapshot(context.Background(), "openai", true)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		current, err := a.Snapshot(context.Background(), "openai", false)
		if err != nil {
			t.Fatal(err)
		}
		if m := current.LoginMaintenance; m != nil && m.Phase == "restored" {
			if m.Operation.ID != originalOperation.ID || m.Operation.State != "unknown" {
				t.Fatalf("cross-process recovery replaced original result: %+v", m)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal(fmt.Sprintf("reopened manager did not restore original login maintenance: %+v", first.LoginMaintenance))
}

func TestDesktopLoginRecoveryCleanNewRunRestoresOrIsolatesOnlyInterruptedPlatform(t *testing.T) {
	for _, scenario := range []string{"same_identity", "missing_source", "different_identity", "stop_while_mark_waits", "snapshot_during_start", "dirty_runtime"} {
		t.Run(scenario, func(t *testing.T) {
			missing := scenario == "missing_source"
			different := scenario == "different_identity"
			f := newDesktopAutoMaintenanceFixture(t)
			f.accounts.goos = "linux"
			f.selectAccount("openai")
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
			f.selectAccount("claude")
			before := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
			})
			source := before.Platforms["openai"].Account.Candidate.Source
			if source == nil || source.Directory == nil {
				t.Fatal("selected source absent")
			}
			if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: "app_exit"}); err != nil {
				t.Fatal(err)
			}
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
			path, _ := f.accounts.device.configPath()
			transport := f.accounts.transport
			f.runtime.Close()
			f.accounts.Close()
			f.accounts.device.Close()
			control := t.TempDir()
			started, release, sample, operation := filepath.Join(control, "started"), filepath.Join(control, "release"), filepath.Join(control, "sample"), filepath.Join(control, "operation")
			os.WriteFile(sample, desktopCodexFixture(t, time.Now().Add(3*time.Hour)), 0600)
			program, _ := os.Executable()
			manager := exec.Command(program, "-test.run=^TestDesktopLoginRecoveryManagementProcess$")
			manager.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_LOGIN_RECOVERY_MANAGER=1", "BEE_LOGIN_RECOVERY_DEVICE="+path, "BEE_LOGIN_RECOVERY_SOURCE="+*source.Directory, "BEE_LOGIN_RECOVERY_OPERATION="+operation,
				"BEE_MAINTENANCE_STARTED="+started, "BEE_MAINTENANCE_RELEASE="+release, "BEE_MAINTENANCE_SOURCE="+sample)
			if scenario == "dirty_runtime" {
				raw, _ := json.Marshal(f.network)
				manager.Env = append(manager.Env, "BEE_LOGIN_RECOVERY_RUNTIME="+string(raw))
			}
			if err := manager.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { manager.Process.Kill(); os.WriteFile(release, []byte("cleanup"), 0600) })
			waitDesktopLoginFile(t, started)
			var original DesktopOperation
			raw, _ := os.ReadFile(operation)
			json.Unmarshal(raw, &original)
			manager.Process.Kill()
			manager.Wait()
			if missing {
				if err := os.Remove(filepath.Join(*source.Directory, "auth.json")); err != nil {
					t.Fatal(err)
				}
			} else if different {
				if err := os.WriteFile(filepath.Join(*source.Directory, "auth.json"), desktopOtherCodexFixture(t), 0600); err != nil {
					t.Fatal(err)
				}
			}
			d := newDesktopTestDevice(t, path)
			a := NewDesktopAccounts(d)
			a.goos, a.transport = "linux", transport
			t.Cleanup(a.Close)
			r := NewDesktopRuntime(context.Background(), d, a)
			t.Cleanup(r.Close)
			o := NewDesktopAuthorizer(context.Background(), a)
			t.Cleanup(o.Close)
			if err := r.ConfigureNetwork(context.Background(), f.network); err != nil {
				t.Fatal(err)
			}
			if scenario == "stop_while_mark_waits" {
				officialEntered, officialRelease := make(chan struct{}), make(chan struct{})
				t.Cleanup(func() {
					select {
					case <-officialRelease:
					default:
						close(officialRelease)
					}
				})
				var once sync.Once
				a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
					once.Do(func() { close(officialEntered) })
					select {
					case <-officialRelease:
					case <-q.Context().Done():
						return nil, q.Context().Err()
					}
					return transport.RoundTrip(q)
				})
				detected := make(chan error, 1)
				go func() {
					_, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: source.Directory, Store: "file", Mode: "official"})
					detected <- err
				}()
				select {
				case <-officialEntered:
				case <-time.After(5 * time.Second):
					t.Fatal("official source check did not reach controlled HTTP boundary")
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				// The source read holds the public platform gate while startup
				// clears its old configuration and waits to claim maintenance.
				time.Sleep(25 * time.Millisecond)
				pauseEntered, pauseRelease := make(chan struct{}), make(chan struct{})
				t.Cleanup(func() {
					select {
					case <-pauseRelease:
					default:
						close(pauseRelease)
					}
				})
				var pauseOnce sync.Once
				f.mu.Lock()
				f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
					if q.Method == "PUT" && q.URL.Path == "/api/bee/platforms/openai" && q.URL.Query().Get("preparation_id") == "" {
						pauseOnce.Do(func() { close(pauseEntered) })
						<-pauseRelease
					}
					return false
				}
				f.mu.Unlock()
				pauseDone := make(chan error, 1)
				go func() { _, err := d.SetPaused(context.Background(), "openai", true); pauseDone <- err }()
				select {
				case <-pauseEntered:
				case <-time.After(5 * time.Second):
					t.Fatal("manual pause did not hold the real supply gate")
				}
				close(officialRelease)
				if err := <-detected; err != nil {
					t.Fatal(err)
				}
				deadline := time.Now().Add(5 * time.Second)
				for {
					view, err := a.Snapshot(context.Background(), "openai", false)
					if err != nil {
						t.Fatal(err)
					}
					if view.LoginMaintenance != nil && view.LoginMaintenance.Phase == "authorizing" {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("startup never claimed original maintenance before waiting on supply gate")
					}
					time.Sleep(time.Millisecond)
				}
				beforeStop, _ := r.Snapshot(context.Background())
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: beforeStop.Revision, Reason: "user_stop"}); err != nil {
					t.Fatal(err)
				}
				close(pauseRelease)
				<-pauseDone
				stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
				if _, err := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: stopped.Revision, ResumePlatforms: []string{}}); err != nil {
					t.Fatalf("cancelled startup left platform permanently busy: %v", err)
				}
				waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
				})
				return
			}
			writes := f.pauseWrites.Load()
			var unexpectedWrites atomic.Int32
			runEntered, runRelease := make(chan struct{}), make(chan struct{})
			recheckEntered, recheckRelease := make(chan struct{}), make(chan struct{})
			var runOnce, recheckOnce sync.Once
			t.Cleanup(func() {
				select {
				case <-runRelease:
				default:
					close(runRelease)
				}
				select {
				case <-recheckRelease:
				default:
					close(recheckRelease)
				}
			})
			f.mu.Lock()
			f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
				if scenario == "snapshot_during_start" && q.Method == "GET" {
					firstRun := false
					if q.URL.Path == "/api/bee/identity" {
						runOnce.Do(func() { firstRun = true; close(runEntered) })
					}
					if firstRun {
						select {
						case <-runRelease:
						case <-q.Context().Done():
							return true
						}
					}
					if q.URL.Path == "/api/bee/platforms/openai" {
						recheckOnce.Do(func() { close(recheckEntered) })
						select {
						case <-recheckRelease:
						case <-q.Context().Done():
							return true
						}
					}
				}
				// A new owned connection establishes its own preparation barrier;
				// recovery must still never replay the login's manual pause/change.
				if q.Method == "PUT" && q.URL.Query().Get("preparation_id") == "" || strings.HasSuffix(q.URL.Path, "/account/confirm") {
					unexpectedWrites.Add(1)
				}
				return false
			}
			f.mu.Unlock()
			if _, err := r.Restore(context.Background()); err != nil {
				t.Fatal(err)
			}
			if scenario == "dirty_runtime" {
				failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
				if failed.Operation == nil || failed.Operation.State != "failed" || failed.Operation.Error == nil || failed.Platforms["claude"].Supply != nil || failed.Platforms["openai"].Supply != nil {
					t.Fatalf("dirty shared runtime was automatically adopted: %+v", failed)
				}
				if _, err := a.Snapshot(context.Background(), "openai", true); err != nil {
					t.Fatal(err)
				}
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					view, _ := a.Snapshot(context.Background(), "openai", false)
					if m := view.LoginMaintenance; m != nil && m.Error != nil && strings.Contains(m.Error.Message, "unowned runtime evidence") {
						if m.Phase != "blocked" || m.Operation.ID != original.ID || m.Operation.State != "unknown" || f.pauseWrites.Load() != writes || unexpectedWrites.Load() != 0 {
							t.Fatalf("dirty session recovery changed original evidence: %+v", view)
						}
						return
					}
					time.Sleep(time.Millisecond)
				}
				t.Fatal("login source recheck bypassed or hid dirty shared runtime protection")
			}
			if scenario == "snapshot_during_start" {
				select {
				case <-runEntered:
				case <-time.After(5 * time.Second):
					t.Fatal("start never reached controlled identity query")
				}
				if _, err := a.Snapshot(context.Background(), "openai", true); err != nil {
					t.Fatal(err)
				}
				select {
				case <-recheckEntered:
				case <-time.After(5 * time.Second):
					t.Fatal("snapshot never claimed original read-only recovery")
				}
				close(runRelease)
				// Startup reaches the existing recovery while its real supply
				// GET remains outstanding; it must join rather than replace it.
				time.Sleep(30 * time.Millisecond)
				if _, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: source.Directory, Store: "file", Mode: "local"}); err == nil {
					t.Fatal("startup released platform admission while original snapshot recovery was still active")
				}
				close(recheckRelease)
			}
			after := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
				return s.Local == "running" && s.Platforms["claude"].Supply != nil && (missing || different || s.Platforms["openai"].Supply != nil)
			})
			m := after.Platforms["openai"].Account.LoginMaintenance
			if m == nil || m.Operation.ID != original.ID || m.Operation.State != "unknown" || f.pauseWrites.Load() != writes || unexpectedWrites.Load() != 0 {
				t.Fatalf("new run lost original login or replayed a write: maintenance=%+v writes=%d", m, unexpectedWrites.Load())
			}
			if missing {
				if m.Phase != "blocked" || !m.CanRecheck || after.Platforms["openai"].Supply != nil {
					t.Fatalf("unreadable interrupted platform escaped isolation: %+v", after)
				}
				otherDirectory := t.TempDir()
				os.WriteFile(filepath.Join(otherDirectory, "auth.json"), desktopOtherCodexFixture(t), 0600)
				newer, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &otherDirectory, Store: "file", Mode: "local"})
				if err != nil || newer.Candidate.Source == nil {
					t.Fatalf("new explicit source detection: %v", err)
				}
				os.WriteFile(filepath.Join(*source.Directory, "auth.json"), desktopCodexFixture(t, time.Now().Add(2*time.Hour)), 0600)
				if _, err := a.Snapshot(context.Background(), "openai", true); err != nil {
					t.Fatal(err)
				}
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					checked, _ := a.Snapshot(context.Background(), "openai", false)
					m = checked.LoginMaintenance
					if m != nil && m.Error != nil && strings.Contains(m.Error.Message, "observed source differs") {
						if checked.Candidate.Source == nil || *checked.Candidate.Source.Directory != *newer.Candidate.Source.Directory || m.Phase != "blocked" || m.Operation.ID != original.ID {
							t.Fatalf("old maintenance replaced newer source: %+v", checked)
						}
						return
					}
					if m != nil && m.Phase == "restored" {
						t.Fatalf("old maintenance overrode an explicitly detected newer source: %+v", checked)
					}
					time.Sleep(time.Millisecond)
				}
				t.Fatal("old maintenance did not report explicit source conflict")
			} else if different {
				if m.Phase != "confirmation_required" || !m.CanRecheck || after.Platforms["openai"].Supply != nil {
					t.Fatalf("different interrupted identity was adopted: %+v", m)
				}
				current, _ := a.Snapshot(context.Background(), "openai", false)
				if current.Candidate.Reference == nil {
					t.Fatal("recovered new identity has no explicit confirmation candidate")
				}
				if _, err := a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: current.Revision, CandidateRef: *current.Candidate.Reference, Action: "confirm_change", Confirmed: true}); err != nil {
					t.Fatal(err)
				}
				confirmed := waitSelection(t, a, "openai")
				if confirmed.Operation.State != "succeeded" || confirmed.LoginMaintenance == nil || confirmed.LoginMaintenance.Phase != "restored" || confirmed.LoginMaintenance.Operation.ID != original.ID || confirmed.LoginMaintenance.Operation.State != "unknown" {
					t.Fatalf("explicit confirmation lost original interrupted result: %+v", confirmed)
				}
			} else if m.Phase != "restored" || after.Platforms["openai"].Supply == nil || !after.Platforms["openai"].Supply.Paused {
				t.Fatalf("clean new run did not restore interrupted platform paused: %+v", after)
			}
		})
	}
}
