package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Writes the actual v2 wire shape, independently of the current Go schema.
// The setup stop is clean; interruption tests below omit a stop deliberately.
func desktopLegacyStopFixture(t *testing.T, platforms ...string) (*desktopAutoMaintenanceFixture, []byte) {
	t.Helper()
	f := newDesktopAutoMaintenanceFixture(t)
	for _, platform := range platforms {
		f.selectAccount(platform)
		waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
			return s.Local == "running" && s.Platforms[platform].Supply != nil
		})
	}
	snapshot, err := f.runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: snapshot.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
	if !stopped.StopReceipt.SessionClean {
		t.Fatalf("legacy fixture requires clean stop: %+v", stopped.StopReceipt)
	}
	f.runtime.Close()
	path := filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document["version"] = 2
	for _, value := range document["scopes"].(map[string]any) {
		scope := value.(map[string]any)
		delete(scope, "legacy_stop")
		scope["runtime_intent"] = map[string]any{"running": false, "resume_platforms": []string{}}
	}
	legacy, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	for _, platform := range platforms {
		f.paused[platform] = false
	}
	f.mu.Unlock()
	return f, legacy
}

func TestDesktopLegacyStopLostPauseResponseOnlyRechecksAcrossRestart(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai")
	var intercept atomic.Bool
	intercept.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" || q.Method != http.MethodPut || !intercept.CompareAndSwap(true, false) {
			return false
		}
		// Hive commits, then the actual HTTP connection disappears before a
		// response reaches Bee. This is not a pre-seeded journal fixture.
		f.mu.Lock()
		f.paused["openai"] = true
		f.mu.Unlock()
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return true
		}
		conn.Close()
		return true
	}
	f.mu.Unlock()
	before := f.pauseWrites.Load()
	restoreDesktopLegacyStop(t, f)
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.LegacyStop == nil || failed.LegacyStop.Phase != "reconciling" || !failed.LegacyStop.CanRecheck || failed.LegacyStop.Error == nil {
		t.Fatalf("lost response did not expose recheck: %+v", failed.LegacyStop)
	}
	f.runtime.Close() // Real worker/service restart, without a normal Stop receipt.
	restoreDesktopLegacyStop(t, f)
	recovered := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !recovered.Platforms["openai"].Supply.Paused || recovered.LegacyStop == nil || recovered.LegacyStop.Phase != "completed" || f.pauseWrites.Load()-before != 1 {
		t.Fatalf("lost-response restart replayed or failed conversion: writes=%d status=%+v", f.pauseWrites.Load()-before, recovered.LegacyStop)
	}
}

func TestDesktopLegacyStopUnknownUncommittedWriteCannotBeReplayed(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai")
	var intercept atomic.Bool
	intercept.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" || q.Method != http.MethodPut || !intercept.CompareAndSwap(true, false) {
			return false
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return true
		}
		conn.Close() // Request reached Hive, but did not commit.
		return true
	}
	f.mu.Unlock()
	before := f.pauseWrites.Load()
	restoreDesktopLegacyStop(t, f)
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	f.runtime.Close()
	restoreDesktopLegacyStop(t, f)
	failed = waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.LegacyStop == nil || failed.LegacyStop.Phase != "reconciling" || !failed.LegacyStop.CanRecheck {
		t.Fatalf("unknown write lost durable recheck state: %+v", failed.LegacyStop)
	}
	if _, err := f.runtime.Start(context.Background(), DesktopStartRequest{ExpectedRevision: failed.Revision, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	failed = waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if f.pauseWrites.Load()-before != 1 || !strings.Contains(failed.Operation.Error.Error(), "must not be replayed") {
		t.Fatalf("unknown PUT was replayed or lost evidence: writes=%d error=%v", f.pauseWrites.Load()-before, failed.Operation.Error)
	}
	// A later explicit owner-level pause supplies new observable evidence; a
	// query can now complete the old conversion without sending another PUT.
	f.mu.Lock()
	f.paused["openai"] = true
	f.mu.Unlock()
	if _, err := f.runtime.Start(context.Background(), DesktopStartRequest{ExpectedRevision: failed.Revision, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	completed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if completed.LegacyStop == nil || completed.LegacyStop.Phase != "completed" || f.pauseWrites.Load()-before != 1 {
		t.Fatalf("explicit recheck did not preserve original attempt: status=%+v writes=%d", completed.LegacyStop, f.pauseWrites.Load()-before)
	}
}

func TestDesktopLegacyStopBothSelectedPlatformsPauseBeforeAuthorization(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai", "claude")
	beforeWrites, beforeConnections := f.pauseWrites.Load(), f.connections.Load()
	f.mu.Lock()
	beforeUploads := f.uploads["openai"] + f.uploads["claude"]
	// Observe every authorization/relay admission at the actual HTTP boundary.
	f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path == "/api/bee/agent" || q.URL.Path == "/api/bee/maintenance" || q.URL.Path == "/api/bee/credentials" {
			f.mu.Lock()
			bothPaused := f.paused["openai"] && f.paused["claude"]
			f.mu.Unlock()
			if !bothPaused {
				t.Errorf("authorization admitted before both selected pauses: path=%s", q.URL.Path)
			}
		}
		return false
	}
	f.mu.Unlock()
	restoreDesktopLegacyStop(t, f)
	completed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
	})
	f.mu.Lock()
	afterUploads := f.uploads["openai"] + f.uploads["claude"]
	f.mu.Unlock()
	if f.pauseWrites.Load()-beforeWrites != 2 || f.connections.Load()-beforeConnections != 1 || afterUploads-beforeUploads != 2 || len(completed.LegacyStop.Platforms) != 2 {
		t.Fatalf("both-platform conversion incomplete: writes=%d connections=%d uploads=%d status=%+v", f.pauseWrites.Load()-beforeWrites, f.connections.Load()-beforeConnections, afterUploads-beforeUploads, completed.LegacyStop)
	}
}

func TestDesktopLegacyStopUnsafeEvidenceBlocksAllWrites(t *testing.T) {
	for _, problem := range []string{"dirty_guard", "dirty_session", "pending_selection", "changed_source", "corrupt_state"} {
		t.Run(problem, func(t *testing.T) {
			f, _ := desktopLegacyStopFixture(t, "openai")
			path := filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json")
			state, err := readDesktopAccountState(path)
			if err != nil {
				t.Fatal(err)
			}
			for key, scope := range state.Scopes {
				selection := scope.Selections["openai"]
				switch problem {
				case "dirty_guard":
					if err := os.WriteFile(filepath.Join(filepath.Dir(path), "runtime-session"), []byte(strings.Repeat("a", 32)+"\n"), 0600); err != nil {
						t.Fatal(err)
					}
				case "dirty_session":
					scope.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
				case "pending_selection":
					scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("b", 48), Kind: "select", Stage: "submitted", Source: selection.Source, ToFingerprint: selection.Fingerprint, CredentialRevision: selection.CredentialRevision, StartedAt: time.Now().UTC()}
				case "changed_source":
					if err := os.WriteFile(filepath.Join(*selection.Source.Directory, "auth.json"), desktopOtherCodexFixture(t), 0600); err != nil {
						t.Fatal(err)
					}
				}
				state.Scopes[key] = scope
			}
			if problem == "dirty_session" || problem == "pending_selection" {
				state.Version = desktopAccountStateVersion
				raw, _ := json.Marshal(state)
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			} else if problem == "corrupt_state" {
				if err := os.WriteFile(path, []byte(`{"version":2`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			beforeWrites, beforeConnections := f.pauseWrites.Load(), f.connections.Load()
			restoreDesktopLegacyStop(t, f)
			failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
			if failed.Operation.Error == nil || f.pauseWrites.Load() != beforeWrites || f.connections.Load() != beforeConnections {
				t.Fatalf("unsafe migration escaped protections: writes=%d connections=%d error=%v", f.pauseWrites.Load()-beforeWrites, f.connections.Load()-beforeConnections, failed.Operation.Error)
			}
		})
	}
}

func TestDesktopLegacyStopKilledManagementProcessReconcilesWithoutReplay(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai")
	path, transport := f.accounts.device.path, f.accounts.transport
	f.accounts.Close()
	closeDesktopTestDevice(t, f.accounts.device)
	committed, release := make(chan struct{}), make(chan struct{})
	var intercept atomic.Bool
	intercept.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" || q.Method != http.MethodPut || !intercept.CompareAndSwap(true, false) {
			return false
		}
		f.mu.Lock()
		f.paused["openai"] = true
		f.mu.Unlock()
		close(committed)
		<-release
		return true
	}
	f.mu.Unlock()
	beforeWrites := f.pauseWrites.Load()
	worker := exec.Command(os.Args[0], "-test.run=^TestDesktopLegacyStopManagementProcessHelper$", "-test.count=1")
	worker.Env = append(os.Environ(), "BEE_LEGACY_STOP_TEST_PATH="+path, "BEE_LEGACY_STOP_TEST_PROXY="+f.network.ConnectProxy)
	var output bytes.Buffer
	worker.Stdout, worker.Stderr = &output, &output
	if err := worker.Start(); err != nil {
		close(release)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if worker.Process != nil {
			worker.Process.Kill()
		}
	})
	select {
	case <-committed:
	case <-time.After(5 * time.Second):
		worker.Process.Kill()
		worker.Wait()
		close(release)
		t.Fatalf("management subprocess did not dispatch migration pause: %s", output.String())
	}
	if err := worker.Process.Kill(); err != nil {
		close(release)
		t.Fatal(err)
	}
	if err := worker.Wait(); err == nil {
		close(release)
		t.Fatal("killed management process exited successfully")
	}
	close(release)
	f.accounts = NewDesktopAccounts(newDesktopTestDevice(t, path))
	f.accounts.transport = transport
	t.Cleanup(f.accounts.Close)
	restoreDesktopLegacyStop(t, f)
	recovered := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !recovered.Platforms["openai"].Supply.Paused || f.pauseWrites.Load()-beforeWrites != 1 || recovered.LegacyStop == nil || recovered.LegacyStop.Phase != "completed" {
		t.Fatalf("process kill lost migration evidence: writes=%d status=%+v", f.pauseWrites.Load()-beforeWrites, recovered.LegacyStop)
	}
}

func TestDesktopLegacyStopManagementProcessHelper(t *testing.T) {
	path := os.Getenv("BEE_LEGACY_STOP_TEST_PATH")
	if path == "" {
		return
	}
	d := newDesktopTestDevice(t, path)
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: os.Getenv("BEE_LEGACY_STOP_TEST_PROXY")}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {} // Parent kills this actual OS process after Hive commits the pause.
}

func TestDesktopLegacyStopDiskFailurePreservesOriginalAttempt(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires an unprivileged Unix directory replacement failure")
	}
	for _, point := range []string{"before_send", "after_commit"} {
		t.Run(point, func(t *testing.T) {
			f, _ := desktopLegacyStopFixture(t, "openai")
			directory := filepath.Dir(f.accounts.device.path)
			t.Cleanup(func() { os.Chmod(directory, 0700) })
			var inject atomic.Bool
			inject.Store(true)
			f.mu.Lock()
			f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
				if q.URL.Path != "/api/bee/platforms/openai" || q.Method != http.MethodGet {
					return false
				}
				f.mu.Lock()
				paused := f.paused["openai"]
				f.mu.Unlock()
				if (point == "after_commit") == paused && inject.CompareAndSwap(true, false) {
					if err := os.Chmod(directory, 0500); err != nil {
						t.Error(err)
					}
				}
				return false
			}
			f.mu.Unlock()
			before := f.pauseWrites.Load()
			restoreDesktopLegacyStop(t, f)
			failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
			if err := os.Chmod(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if failed.Operation.Error == nil || !strings.Contains(failed.Operation.Error.Error(), "replace account state") {
				t.Fatalf("actual disk failure evidence lost: %v", failed.Operation.Error)
			}
			wantBefore := int32(0)
			if point == "after_commit" {
				wantBefore = 1
			}
			if f.pauseWrites.Load()-before != wantBefore {
				t.Fatalf("save failure dispatched an unauthorized attempt: point=%s writes=%d", point, f.pauseWrites.Load()-before)
			}
			f.runtime.Close()
			restoreDesktopLegacyStop(t, f)
			completed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
				return s.Local == "running" && s.Platforms["openai"].Supply != nil
			})
			if completed.LegacyStop == nil || completed.LegacyStop.Phase != "completed" || f.pauseWrites.Load()-before != 1 {
				t.Fatalf("disk-failure restart duplicated migration: point=%s writes=%d status=%+v", point, f.pauseWrites.Load()-before, completed.LegacyStop)
			}
		})
	}
}

func TestDesktopLegacyStopRequiresCurrentVerifiedHiveOwner(t *testing.T) {
	f, original := desktopLegacyStopFixture(t, "openai")
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/identity" {
			return false
		}
		identity := desktopSupplyIdentity()
		identity.OwnerID = "other-owner"
		json.NewEncoder(w).Encode(identity)
		return true
	}
	f.mu.Unlock()
	before := f.pauseWrites.Load()
	restoreDesktopLegacyStop(t, f)
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	after, err := os.ReadFile(filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json"))
	if err != nil || !bytes.Equal(after, original) || f.pauseWrites.Load() != before || failed.LegacyStop == nil || failed.LegacyStop.Phase != "blocked" {
		t.Fatalf("unverified owner changed old scope: writes=%d original_preserved=%t status=%+v error=%v", f.pauseWrites.Load()-before, bytes.Equal(after, original), failed.LegacyStop, err)
	}
}

func TestDesktopLegacyStopOldRunningIntentKeepsCurrentSupplyChoice(t *testing.T) {
	f, legacy := desktopLegacyStopFixture(t, "openai")
	legacy = bytes.Replace(legacy, []byte(`"running":false`), []byte(`"running":true`), 1)
	if err := os.WriteFile(filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json"), legacy, 0600); err != nil {
		t.Fatal(err)
	}
	before := f.pauseWrites.Load()
	restoreDesktopLegacyStop(t, f)
	restored := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if restored.Platforms["openai"].Supply.Paused || f.pauseWrites.Load() != before || restored.LegacyStop != nil {
		t.Fatalf("running v2 scope was treated as stopped: writes=%d status=%+v", f.pauseWrites.Load()-before, restored.LegacyStop)
	}
}

func TestDesktopLegacyStopStrictV3CannotCertifyIncompleteEvidence(t *testing.T) {
	for _, defect := range []string{"missing", "null", "unknown_stage", "completed_without_confirmation", "running_original", "pending_running", "null_platforms"} {
		t.Run(defect, func(t *testing.T) {
			f, _ := desktopLegacyStopFixture(t, "openai")
			path := filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json")
			state, err := readDesktopAccountState(path)
			if err != nil {
				t.Fatal(err)
			}
			state.Version = desktopAccountStateVersion
			raw, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			var document map[string]any
			if err := json.Unmarshal(raw, &document); err != nil {
				t.Fatal(err)
			}
			for _, value := range document["scopes"].(map[string]any) {
				scope := value.(map[string]any)
				migration := scope["legacy_stop"].(map[string]any)
				switch defect {
				case "missing":
					delete(scope, "legacy_stop")
				case "null":
					scope["legacy_stop"] = nil
				case "unknown_stage":
					migration["platforms"].(map[string]any)["openai"].(map[string]any)["stage"] = "assumed"
				case "completed_without_confirmation":
					migration["state"] = "completed"
				case "running_original":
					migration["original_intent"].(map[string]any)["running"] = true
				case "pending_running":
					scope["runtime_intent"].(map[string]any)["running"] = true
				case "null_platforms":
					migration["platforms"] = nil
				}
			}
			raw, err = json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			before := f.pauseWrites.Load()
			restoreDesktopLegacyStop(t, f)
			failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
			after, err := os.ReadFile(path)
			if failed.Operation.Error == nil || err != nil || !bytes.Equal(after, raw) || f.pauseWrites.Load() != before {
				t.Fatalf("invalid migration evidence bypassed strict recovery: writes=%d error=%v preserved=%t", f.pauseWrites.Load()-before, failed.Operation.Error, bytes.Equal(after, raw))
			}
		})
	}
}

func TestDesktopLegacyStopRechecksSourceAfterSupplyReadBeforePause(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai")
	path := filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json")
	state, err := readDesktopAccountState(path)
	if err != nil {
		t.Fatal(err)
	}
	var source string
	for _, scope := range state.Scopes {
		source = filepath.Join(*scope.Selections["openai"].Source.Directory, "auth.json")
	}
	changed := desktopOtherCodexFixture(t)
	var inject atomic.Bool
	inject.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path == "/api/bee/platforms/openai" && q.Method == http.MethodGet && inject.CompareAndSwap(true, false) {
			if err := os.WriteFile(source, changed, 0600); err != nil {
				t.Error(err)
			}
		}
		return false
	}
	f.mu.Unlock()
	beforeWrites, beforeConnections := f.pauseWrites.Load(), f.connections.Load()
	restoreDesktopLegacyStop(t, f)
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if f.pauseWrites.Load() != beforeWrites || f.connections.Load() != beforeConnections || failed.LegacyStop == nil || failed.LegacyStop.Phase != "blocked" {
		t.Fatalf("changed identity passed pause admission: writes=%d connections=%d status=%+v", f.pauseWrites.Load()-beforeWrites, f.connections.Load()-beforeConnections, failed.LegacyStop)
	}
}

func TestDesktopLegacyStopStopDuringPauseNeverPublishesAuthorization(t *testing.T) {
	f, _ := desktopLegacyStopFixture(t, "openai")
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	var intercept atomic.Bool
	intercept.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" || q.Method != http.MethodPut || !intercept.CompareAndSwap(true, false) {
			return false
		}
		f.mu.Lock()
		f.paused["openai"] = true
		f.mu.Unlock()
		close(entered)
		select {
		case <-q.Context().Done():
		case <-release:
		}
		return true
	}
	f.mu.Unlock()
	beforeWrites, beforeConnections := f.pauseWrites.Load(), f.connections.Load()
	restoreDesktopLegacyStop(t, f)
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("migration did not dispatch pause")
	}
	starting, err := f.runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: starting.Revision, Reason: "user_stop"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
	if stopped.Operation.State != "succeeded" || !stopped.StopReceipt.SessionClean || f.connections.Load() != beforeConnections || f.pauseWrites.Load()-beforeWrites != 1 {
		t.Fatalf("stop raced migration admission: receipt=%+v writes=%d connections=%d", stopped.StopReceipt, f.pauseWrites.Load()-beforeWrites, f.connections.Load()-beforeConnections)
	}
	if _, err := f.runtime.Start(context.Background(), DesktopStartRequest{ExpectedRevision: stopped.Revision, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	completed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !completed.Platforms["openai"].Supply.Paused || f.pauseWrites.Load()-beforeWrites != 1 {
		t.Fatalf("explicit recheck replayed stopped write: paused=%t writes=%d", completed.Platforms["openai"].Supply.Paused, f.pauseWrites.Load()-beforeWrites)
	}
}

func TestDesktopLegacyStopOnlyConvertsCurrentScopeAndSelectedPlatforms(t *testing.T) {
	f, legacy := desktopLegacyStopFixture(t, "openai")
	var document map[string]any
	if err := json.Unmarshal(legacy, &document); err != nil {
		t.Fatal(err)
	}
	scopes := document["scopes"].(map[string]any)
	var historical map[string]any
	for _, value := range scopes {
		raw, _ := json.Marshal(value)
		if err := json.Unmarshal(raw, &historical); err != nil {
			t.Fatal(err)
		}
		break
	}
	historical["owner_id"] = "historical-owner"
	historical["selections"] = map[string]any{"claude": historical["selections"].(map[string]any)["openai"]}
	key := desktopScopeKey(historical["hive"].(string), "historical-owner", historical["device_id"].(string))
	scopes[key] = historical
	legacy, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json")
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.paused["claude"] = false
	f.mu.Unlock()
	before := f.pauseWrites.Load()
	restoreDesktopLegacyStop(t, f)
	restored := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	f.mu.Lock()
	unselectedPaused := f.paused["claude"]
	f.mu.Unlock()
	state, err := readDesktopAccountState(path)
	if err != nil || state.Scopes[key].RuntimeIntent.Running || state.Scopes[key].LegacyStop.State != "pending" || unselectedPaused || f.pauseWrites.Load()-before != 1 || len(restored.LegacyStop.Platforms) != 1 {
		t.Fatalf("migration crossed current selected scope: writes=%d unselected_paused=%t historical_state=%s error=%v", f.pauseWrites.Load()-before, unselectedPaused, state.Scopes[key].LegacyStop.State, err)
	}
}

func restoreDesktopLegacyStop(t *testing.T, f *desktopAutoMaintenanceFixture) {
	t.Helper()
	f.runtime = NewDesktopRuntime(context.Background(), f.accounts.device, f.accounts)
	t.Cleanup(f.runtime.Close)
	if err := f.runtime.ConfigureNetwork(context.Background(), f.network); err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopLegacyStopPausesOnceBeforeAutomaticMaintenance(t *testing.T) {
	f, original := desktopLegacyStopFixture(t, "openai")
	before := f.supplyWrites.Load()
	restoreDesktopLegacyStop(t, f)
	restored := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !restored.Platforms["openai"].Supply.Paused || f.supplyWrites.Load()-before != 1 {
		t.Fatalf("legacy stop did not become one confirmed platform pause: paused=%t writes=%d", restored.Platforms["openai"].Supply.Paused, f.supplyWrites.Load()-before)
	}
	backup, err := os.ReadFile(filepath.Join(filepath.Dir(f.accounts.device.path), "ai-accounts.json.v2.bak"))
	if err != nil || !bytes.Equal(backup, original) {
		t.Fatalf("legacy original not preserved: error=%v equal=%t", err, bytes.Equal(backup, original))
	}
	if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err != nil {
		t.Fatal(err)
	}
	afterResume := f.supplyWrites.Load()
	reopenDesktopAutoService(t, f)
	reopened := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if reopened.Platforms["openai"].Supply.Paused || f.supplyWrites.Load() != afterResume {
		t.Fatalf("completed migration overrode later resume: paused=%t writes=%d", reopened.Platforms["openai"].Supply.Paused, f.supplyWrites.Load()-afterResume)
	}
}
