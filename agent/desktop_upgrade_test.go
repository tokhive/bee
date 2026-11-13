package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// Upgrade acceptance must validate every persisted account file before an idle
// restore can certify success; an unpaired device is not proof of readable data.
func TestDesktopUpgradeRejectsUnreadableAccountsBeforeIdleRestore(t *testing.T) {
	for _, paired := range []bool{false, true} {
		for _, format := range []string{"corrupt", "future"} {
			name := "unpaired_" + format
			if paired {
				name = "user_stopped_" + format
			}
			t.Run(name, func(t *testing.T) {
				var requests atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					w.WriteHeader(http.StatusServiceUnavailable)
				}))
				defer server.Close()
				path := filepath.Join(t.TempDir(), "desktop.json")
				identity := desktopSupplyIdentity()
				deviceState := localState{Hive: server.URL, Name: "Upgrade fixture", Credential: "bee_" + strings.Repeat("g", 43)}
				if paired {
					deviceState.Identity = &identity
				} else {
					deviceState.Pairing = &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("h", 43),
						UserCode: "UPGR-ADE1", VerificationURI: server.URL + "/devices/pair", Status: "pending",
						ExpiresAt: time.Now().Add(time.Hour).UTC(), PollInterval: 2}
				}
				if err := saveState(path, deviceState); err != nil {
					t.Fatal(err)
				}
				pairedBytes := desktopUpgradeReadBytes(t, path)
				accountPath := filepath.Join(filepath.Dir(path), "ai-accounts.json")
				raw := []byte(`{"version":2`)
				if format == "future" {
					future := desktopAccountState{Version: 99, Revision: 4, Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{}}
					if paired {
						scope := newDesktopAccountScope(deviceState)
						future.Scopes[desktopScopeKey(scope.Hive, scope.OwnerID, scope.DeviceID)] = scope
					}
					var err error
					raw, err = json.Marshal(future)
					if err != nil {
						t.Fatal(err)
					}
				}
				if err := os.WriteFile(accountPath, raw, 0600); err != nil {
					t.Fatal(err)
				}
				d := newDesktopTestDevice(t, path)
				a := NewDesktopAccounts(d)
				defer a.Close()
				r := NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				got := desktopUpgradeWaitOperation(t, r)
				if got.Operation.State != "failed" || got.Operation.Error == nil {
					t.Errorf("upgrade restore certified unreadable data: paired=%t format=%s local=%s operation=%s; required=failed with account-state evidence", paired, format, got.Local, got.Operation.State)
				} else if message := got.Operation.Error.Error(); !strings.Contains(message, "account state") {
					t.Errorf("restore error lost account-state diagnosis: %s", message)
				} else if format == "future" && !strings.Contains(message, "actual=99") {
					t.Errorf("future-version rejection omitted actual version: %s", message)
				}
				desktopUpgradeAssertBytes(t, accountPath, raw)
				desktopUpgradeAssertBytes(t, path, pairedBytes)
				after, err := readState(path)
				if err != nil || !reflect.DeepEqual(after, deviceState) {
					t.Errorf("rejected upgrade changed device pairing/identity: read_error=%v", err)
				}
				if requests.Load() != 0 {
					t.Errorf("unvalidated upgrade issued remote requests: actual=%d required=0", requests.Load())
				}
			})
		}
	}
}

func TestDesktopUpgradeLegacyNoticesMigrateThroughUpdateStopWithoutChangingPairing(t *testing.T) {
	var requests atomic.Int32
	var verifyWaiting atomic.Bool
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if verifyWaiting.Load() && r.Method == "GET" && desktopSupplyServeIdentity(w, r) {
			return
		}
		requests.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	pairedBytes := desktopUpgradeReadBytes(t, d.path)
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	key := strings.Repeat("a", 64)
	legacy := []byte(`{"version":1,"revision":7,"entries":{"` + key + `":{"first_seen":"2026-10-26T00:00:00Z","notified":true}}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	a, r := desktopUpgradeServices(t, d)
	stopped := desktopUpgradeStop(t, r, "update")
	if stopped.Operation.State != "succeeded" || stopped.StopReceipt == nil || !stopped.StopReceipt.IntentSaved || !stopped.StopReceipt.SessionClean || !stopped.StopReceipt.WorkersStopped {
		t.Fatalf("update stop did not validate v1 migration: operation=%s receipt=%+v error=%v", stopped.Operation.State, stopped.StopReceipt, stopped.Operation.Error)
	}
	migrated, err := readDesktopAccountState(path)
	if err != nil || migrated.Version != 3 || !migrated.Entries[key].Notified || migrated.Entries[key].FirstSeen.Format(time.RFC3339) != "2026-10-26T00:00:00Z" {
		t.Fatalf("update migration lost prior notice: version=%d revision=%d error=%v", migrated.Version, migrated.Revision, err)
	}
	desktopUpgradeAssertBytes(t, path+".v1.bak", legacy)
	backup, err := openRegularNoFollow(path + ".v1.bak")
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePrivateFile(backup); err != nil {
		backup.Close()
		t.Fatalf("upgrade backup is not protected: %v", err)
	}
	backup.Close()
	migratedBytes := desktopUpgradeReadBytes(t, path)
	r.Close()
	a.Close()
	closeDesktopTestDevice(t, d)
	_, next := desktopUpgradeServices(t, newDesktopTestDevice(t, d.path))
	verifyWaiting.Store(true)
	if _, err := next.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	restored := desktopUpgradeWaitOperation(t, next)
	if restored.Local != "waiting" || restored.RunID != nil || restored.Operation.State != "succeeded" {
		t.Fatalf("v1 migration invented runtime consent: local=%s operation=%s error=%v", restored.Local, restored.Operation.State, restored.Operation.Error)
	}
	desktopUpgradeAssertBytes(t, path, migratedBytes)
	desktopUpgradeAssertBytes(t, path+".v1.bak", legacy)
	desktopUpgradeAssertBytes(t, d.path, pairedBytes)
	if requests.Load() != 0 {
		t.Fatalf("notice-only upgrade issued requests beyond verified waiting identity: actual=%d required=0", requests.Load())
	}
}

func TestDesktopUpgradeMigrationReplacementFailurePreservesProtectedOriginals(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("replacement failure fixture requires an unprivileged Unix filesystem; Windows ACL failure remains native acceptance")
	}
	var verifyWaiting atomic.Bool
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if verifyWaiting.Load() && r.Method == "GET" && desktopSupplyServeIdentity(w, r) {
			return
		}
		t.Errorf("failed migration issued request: method=%s path=%s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	a, r := desktopUpgradeServices(t, d)
	pairedBytes := desktopUpgradeReadBytes(t, d.path)
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	legacy := []byte(`{"version":1,"revision":8,"entries":{}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	// Leave a verified private backup and existing locks, then fail the actual
	// atomic replacement rather than merely repeating the backup-failure unit test.
	if err := backupDesktopAccountV1(path); err != nil {
		t.Fatal(err)
	}
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.read(); err != nil {
		release()
		t.Fatal(err)
	}
	release()
	unlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	directory := filepath.Dir(path)
	if err := os.Chmod(directory, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(directory, 0700); err != nil {
			t.Errorf("restore upgrade fixture directory permissions: %v", err)
		}
	})
	stopped := desktopUpgradeStop(t, r, "update")
	if stopped.Operation.State != "failed" || stopped.Operation.Error == nil || !strings.Contains(stopped.Operation.Error.Error(), "replace account state") {
		t.Fatalf("migration replacement failure not diagnosed: operation=%s error=%v", stopped.Operation.State, stopped.Operation.Error)
	}
	if stopped.StopReceipt == nil || !stopped.StopReceipt.WorkersStopped || stopped.StopReceipt.IntentSaved || stopped.StopReceipt.SessionClean {
		t.Fatalf("failed migration certified install readiness: receipt=%+v", stopped.StopReceipt)
	}
	desktopUpgradeAssertBytes(t, path, legacy)
	desktopUpgradeAssertBytes(t, path+".v1.bak", legacy)
	desktopUpgradeAssertBytes(t, d.path, pairedBytes)
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	r.Close()
	a.Close()
	closeDesktopTestDevice(t, d)
	_, next := desktopUpgradeServices(t, newDesktopTestDevice(t, d.path))
	verifyWaiting.Store(true)
	if _, err := next.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	if restored := desktopUpgradeWaitOperation(t, next); restored.Local != "waiting" || restored.RunID != nil || restored.Operation.State != "succeeded" {
		t.Fatalf("readable legacy data could not be reopened safely: local=%s operation=%s error=%v", restored.Local, restored.Operation.State, restored.Operation.Error)
	}
	desktopUpgradeAssertBytes(t, path, legacy)
	desktopUpgradeAssertBytes(t, path+".v1.bak", legacy)
}

func TestDesktopUpgradePendingConfirmationIdentitySurvivesUpdateAndBlockedRestore(t *testing.T) {
	var requests atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	pairedBytes := desktopUpgradeReadBytes(t, d.path)
	a, r := desktopUpgradeServices(t, d)
	desktopRuntimeSelectionFixture(t, d, a)
	before := desktopUpgradeMutateScope(t, d, a, func(scope *desktopAccountScope) {
		selected := scope.Selections["openai"]
		scope.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{}}
		scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("d", 48), Kind: "confirm_change", Stage: "submitted",
			Source: selected.Source, FromFingerprint: selected.Fingerprint, FromGeneration: 7,
			ToFingerprint: strings.Repeat("e", 64), CredentialRevision: strings.Repeat("f", 64),
			ConfirmationID: "synthetic-upgrade-existing-confirmation", StartedAt: time.Date(2026, 10, 26, 4, 0, 0, 0, time.UTC)}
	})
	sourcePath := filepath.Join(*before.Selections["openai"].Source.Directory, "auth.json")
	sourceBytes := desktopUpgradeReadBytes(t, sourcePath)
	stopped := desktopUpgradeStop(t, r, "update")
	if stopped.Operation.State != "succeeded" || stopped.StopReceipt == nil || !stopped.StopReceipt.SessionClean || !stopped.StopReceipt.IntentSaved {
		t.Fatalf("update failed to persist pending operation: receipt=%+v error=%v", stopped.StopReceipt, stopped.Operation.Error)
	}
	r.Close()
	a.Close()
	closeDesktopTestDevice(t, d)
	nextDevice := newDesktopTestDevice(t, d.path)
	_, next := desktopUpgradeServices(t, nextDevice)
	if _, err := next.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	restored := desktopUpgradeWaitOperation(t, next)
	if restored.Operation.State != "failed" || restored.Operation.Error == nil || !strings.Contains(restored.Operation.Error.Error(), "unresolved account operations") {
		t.Fatalf("upgrade resumed an unresolved confirmation: operation=%s error=%v", restored.Operation.State, restored.Operation.Error)
	}
	after := desktopUpgradeSavedScope(t, nextDevice)
	if !reflect.DeepEqual(before.PendingOperations, after.PendingOperations) || !reflect.DeepEqual(before.Selections, after.Selections) || !reflect.DeepEqual(before.RuntimeIntent, after.RuntimeIntent) {
		t.Fatal("upgrade changed confirmation identity, source/generation, selections, or paused intent; private values omitted")
	}
	desktopUpgradeAssertBytes(t, sourcePath, sourceBytes)
	desktopUpgradeAssertBytes(t, d.path, pairedBytes)
	if requests.Load() != 0 {
		t.Fatalf("upgrade resubmitted/reconciled before explicit pending handling: requests=%d required=0", requests.Load())
	}
}

func TestDesktopUpgradeUserStopAndPausedIntentRemainAcrossUpdate(t *testing.T) {
	for _, mode := range []string{"user_stopped", "paused_reconnect_occupied"} {
		t.Run(mode, func(t *testing.T) {
			var connections, unpauseWrites atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if desktopSupplyServeIdentity(w, r) {
					return
				}
				switch r.Method + " " + r.URL.Path {
				case "GET /api/bee/platforms/openai":
					json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: true, Reasons: []string{"manually_paused"}})
				case "GET /api/bee/agent":
					connections.Add(1)
					w.WriteHeader(http.StatusConflict)
				default:
					if r.Method == "PUT" {
						unpauseWrites.Add(1)
					}
					t.Errorf("upgrade issued unexpected write/request: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusServiceUnavailable)
				}
			})
			pairedBytes := desktopUpgradeReadBytes(t, d.path)
			a, r := desktopUpgradeServices(t, d)
			desktopRuntimeSelectionFixture(t, d, a)
			before := desktopUpgradeMutateScope(t, d, a, func(scope *desktopAccountScope) {
				scope.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{}}
				if mode == "user_stopped" {
					scope.RuntimeIntent.ResumePlatforms = []string{"openai"}
				}
			})
			if mode == "user_stopped" {
				if got := desktopUpgradeStop(t, r, "user_stop"); got.Operation.State != "succeeded" {
					t.Fatalf("user stop failed before upgrade: error=%v", got.Operation.Error)
				}
			}
			if got := desktopUpgradeStop(t, r, "update"); got.Operation.State != "succeeded" || got.StopReceipt == nil || !got.StopReceipt.SessionClean {
				t.Fatalf("update exit not clean: receipt=%+v error=%v", got.StopReceipt, got.Operation.Error)
			}
			r.Close()
			a.Close()
			closeDesktopTestDevice(t, d)
			nextDevice := newDesktopTestDevice(t, d.path)
			_, next := desktopUpgradeServices(t, nextDevice)
			if _, err := next.Restore(context.Background()); err != nil {
				t.Fatal(err)
			}
			got := desktopUpgradeWaitOperation(t, next)
			after := desktopUpgradeSavedScope(t, nextDevice)
			if mode == "user_stopped" {
				if got.Local != "stopped" || got.Operation.State != "succeeded" || after.RuntimeIntent.Running || connections.Load() != 0 {
					t.Fatalf("update undid user stop: local=%s operation=%s running_intent=%t connections=%d", got.Local, got.Operation.State, after.RuntimeIntent.Running, connections.Load())
				}
			} else if got.Operation.State != "failed" || got.Connection != "occupied" || !after.RuntimeIntent.Running || connections.Load() != 1 {
				t.Fatalf("paused recovery did not preserve actual reconnect failure: local=%s operation=%s connection=%s attempts=%d running_intent=%t", got.Local, got.Operation.State, got.Connection, connections.Load(), after.RuntimeIntent.Running)
			}
			if len(after.RuntimeIntent.ResumePlatforms) != 0 || unpauseWrites.Load() != 0 || !reflect.DeepEqual(before.Selections, after.Selections) {
				t.Fatalf("upgrade granted resume permission or changed selection: resume_platforms=%d remote_writes=%d", len(after.RuntimeIntent.ResumePlatforms), unpauseWrites.Load())
			}
			desktopUpgradeAssertBytes(t, d.path, pairedBytes)
		})
	}
}

func desktopUpgradeServices(t *testing.T, d *DesktopDevice) (*DesktopAccounts, *DesktopRuntime) {
	t.Helper()
	a := NewDesktopAccounts(d)
	r := NewDesktopRuntime(context.Background(), d, a)
	t.Cleanup(func() {
		r.Close()
		a.Close()
	})
	return a, r
}

func desktopUpgradeStop(t *testing.T, r *DesktopRuntime, reason string) DesktopRuntimeSnapshot {
	t.Helper()
	current, err := r.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: reason}); err != nil {
		t.Fatal(err)
	}
	return desktopUpgradeWaitOperation(t, r)
}

func desktopUpgradeMutateScope(t *testing.T, d *DesktopDevice, a *DesktopAccounts, mutate func(*desktopAccountScope)) desktopAccountScope {
	t.Helper()
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.selectionScope(session, state, func(scope *desktopAccountScope) error { mutate(scope); return nil }); err != nil {
		t.Fatal(err)
	}
	return desktopUpgradeSavedScope(t, d)
}

func desktopUpgradeSavedScope(t *testing.T, d *DesktopDevice) desktopAccountScope {
	t.Helper()
	state, err := readState(d.path)
	if err != nil || state.Identity == nil {
		t.Fatalf("upgrade scope lacks device identity: error=%v", err)
	}
	disk, err := readDesktopAccountState(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	scope, ok := disk.Scopes[desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)]
	if !ok {
		t.Fatal("upgrade scope missing for saved Hive/owner/device")
	}
	return scope
}

func desktopUpgradeWaitOperation(t *testing.T, r *DesktopRuntime) DesktopRuntimeSnapshot {
	t.Helper()
	return waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
		return s.Operation != nil && (s.Operation.State == "succeeded" || s.Operation.State == "failed")
	})
}

func desktopUpgradeReadBytes(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read upgrade fixture %s: %v", filepath.Base(path), err)
	}
	return raw
}

func desktopUpgradeAssertBytes(t *testing.T, path string, expected []byte) {
	t.Helper()
	if actual := desktopUpgradeReadBytes(t, path); !bytes.Equal(actual, expected) {
		t.Errorf("upgrade changed protected file %s: actual_bytes=%d expected_bytes=%d; contents omitted", filepath.Base(path), len(actual), len(expected))
	}
}
