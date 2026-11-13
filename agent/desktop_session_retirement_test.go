package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestDesktopSessionRetirementRequiresHiveProof(t *testing.T) {
	for _, scenario := range []string{"retired", "draining", "unsupported", "wrong_scope", "missing_proof", "lost_response", "wrong_epoch", "wrong_request", "pending", "guard_mismatch", "corrupt_record", "preparation_conflict"} {
		t.Run(scenario, func(t *testing.T) {
			var request *beewire.RuntimeRecoveryRequest
			posts := 0
			d := desktopRetirementDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if desktopSupplyServeIdentity(w, q) {
					return
				}
				if !strings.HasPrefix(q.URL.Path, "/api/bee/runtime-recovery/") {
					t.Errorf("unexpected request %s %s", q.Method, q.URL.Path)
					w.WriteHeader(500)
					return
				}
				if scenario == "unsupported" {
					w.WriteHeader(404)
					return
				}
				if q.Method == "POST" {
					posts++
					if err := json.NewDecoder(q.Body).Decode(&request); err != nil {
						t.Error(err)
					}
					if scenario == "preparation_conflict" {
						w.WriteHeader(409)
						json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "runtime_preparation_conflict"}})
						return
					}
					if scenario == "lost_response" {
						w.WriteHeader(503)
						return
					}
				}
				result := beewire.RuntimeRecoveryResult{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", State: "absent", Epoch: ""}
				if request != nil {
					result.Request = request
					result.State = "retired"
					result.Epoch = request.ID
					result.ConnectionRetired = true
					result.PreparationsRetired = true
					if scenario == "draining" || scenario == "preparation_conflict" {
						result.State = "draining"
						result.Unfinished = true
						result.PreparationsRetired = false
					}
					if scenario == "missing_proof" {
						result.ConnectionRetired = false
					}
					if scenario == "wrong_epoch" {
						result.Epoch = strings.Repeat("f", 48)
					}
					if scenario == "wrong_request" {
						copy := *result.Request
						copy.AccountRevision = strings.Repeat("f", 64)
						result.Request = &copy
					}
					if scenario == "wrong_scope" {
						result.DeviceID = "another-device"
					}
				}
				json.NewEncoder(w).Encode(result)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			desktopRuntimeSelectionFixture(t, d, a)
			s, release, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			state, err := s.read()
			if err != nil {
				t.Fatal(err)
			}
			_, err = a.selectionScope(s, state, func(scope *desktopAccountScope) error {
				scope.RuntimeIntent.Running = true
				scope.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
				if scenario == "pending" {
					selected := scope.Selections["openai"]
					scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("e", 48), Kind: "select", Stage: "reconciling", Source: selected.Source, ToFingerprint: selected.Fingerprint, CredentialRevision: selected.CredentialRevision, StartedAt: time.Now().UTC()}
				}
				return nil
			})
			release()
			if err != nil {
				t.Fatal(err)
			}
			guardPath := filepath.Join(filepath.Dir(d.path), "runtime-session")
			guard := []byte(strings.Repeat("a", 32) + "\n")
			if scenario == "guard_mismatch" {
				guard = []byte(strings.Repeat("f", 32) + "\n")
			}
			if scenario == "corrupt_record" {
				os.WriteFile(sessionRetirementPath(s), []byte("broken"), 0600)
			}
			if err = os.WriteFile(guardPath, guard, 0600); err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
			got := r.ReconcileRecovery(context.Background())
			success := scenario == "retired" || scenario == "lost_response"
			if success && (got.State != "eligible" || got.Failure != nil) {
				t.Fatalf("safe retirement did not enable recovery: %+v", got)
			}
			if scenario == "preparation_conflict" && (got.Failure == nil || got.Failure.Code != "RECOVERY_RETIREMENT_CONFLICT" || !strings.Contains(got.Failure.Message, "runtime_preparation_conflict")) {
				t.Fatalf("server conflict evidence was replaced by draining: %+v failure=%+v", got, got.Failure)
			}
			if !success && (got.State != "blocked" || got.Failure == nil) {
				t.Fatalf("unproved retirement allowed: %+v", got)
			}
			after, _ := os.ReadFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
			actual, _ := os.ReadFile(guardPath)
			if !success && (string(before) != string(after) || string(actual) != string(guard)) {
				t.Fatal("unproved retirement modified protected session")
			}
			if success {
				if string(actual) != "clean\n" {
					t.Fatal("proven retirement did not finish local guard")
				}
				if posts != 1 {
					t.Fatalf("posts=%d; original operation must not be replayed", posts)
				}
				again := r.ReconcileRecovery(context.Background())
				if again.State != "eligible" || posts != 1 {
					t.Fatalf("recheck replayed retirement: %+v posts=%d", again, posts)
				}
			}
		})
	}
}

func desktopRetirementDeviceFixture(t *testing.T, handler http.HandlerFunc) *DesktopDevice {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	identity := desktopSupplyIdentity()
	path := filepath.Join(t.TempDir(), "desktop.json")
	if err := saveState(path, localState{Hive: server.URL, Name: "My Mac", Credential: "bee_" + strings.Repeat("b", 43), Identity: &identity}); err != nil {
		t.Fatal(err)
	}
	return newDesktopTestDevice(t, path)
}

func TestDesktopSessionRetirementResumesPartialLocalSavesUsingSameProof(t *testing.T) {
	for _, stage := range []string{"proof_saved", "epoch_saved", "scope_saved", "guard_saved"} {
		t.Run(stage, func(t *testing.T) {
			posts := 0
			var input *beewire.RuntimeRecoveryRequest
			d := desktopRetirementDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if q.Method == "POST" {
					posts++
					json.NewDecoder(q.Body).Decode(&input)
				}
				result := beewire.RuntimeRecoveryResult{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", State: "absent"}
				if input != nil {
					result.Request = input
					result.State = "retired"
					result.Epoch = input.ID
					result.ConnectionRetired = true
					result.PreparationsRetired = true
				}
				json.NewEncoder(w).Encode(result)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			desktopRuntimeSelectionFixture(t, d, a)
			s, release, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			state, err := s.read()
			if err != nil {
				t.Fatal(err)
			}
			original, err := a.selectionScope(s, state, func(v *desktopAccountScope) error {
				v.RuntimeIntent.Running = true
				v.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			guardPath := filepath.Join(filepath.Dir(d.path), "runtime-session")
			if err = os.WriteFile(guardPath, []byte(original.Session.RunID+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			first := r.ReconcileRecovery(context.Background())
			if first.Failure != nil {
				t.Fatal(first.Failure)
			}
			receipt, err := readSessionRetirement(s)
			if err != nil {
				t.Fatal(err)
			}
			receipt.Completed = false
			if err = saveSessionRetirement(s, receipt); err != nil {
				t.Fatal(err)
			}
			if stage == "proof_saved" {
				if err = s.save(state); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "proof_saved" || stage == "epoch_saved" {
				if _, err = a.selectionScope(s, state, func(v *desktopAccountScope) error { *v = original; return nil }); err != nil {
					t.Fatal(err)
				}
			}
			if stage != "guard_saved" {
				if err = os.WriteFile(guardPath, []byte(receipt.Guard), 0600); err != nil {
					t.Fatal(err)
				}
			}
			inspected := r.InspectRecovery(context.Background())
			if inspected.State != "blocked" || inspected.Failure == nil {
				t.Fatalf("partial retirement must remain blocked until completion: %+v", inspected)
			}
			result := r.ReconcileRecovery(context.Background())
			if result.State != "eligible" || result.Failure != nil || posts != 1 {
				t.Fatalf("partial retirement failed or repeated remote write: %+v posts=%d", result, posts)
			}
		})
	}
}

func TestSessionRetirementMetadataErrorsIdentifyFailedCheck(t *testing.T) {
	for _, check := range []string{"previous_epoch_valid", "account_revision_match", "preparations_match"} {
		t.Run(check, func(t *testing.T) {
			s := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee.json")}
			original := desktopAccountScope{Selections: map[string]desktopAccountSelection{}, PendingOperations: map[string]desktopPendingOperation{}, RuntimeIntent: desktopRuntimeIntent{ResumePlatforms: []string{}}, LegacyStop: desktopLegacyStopMigration{Platforms: map[string]desktopLegacyStopPlatform{}}, Session: desktopSessionMarker{RunID: strings.Repeat("a", 32)}}
			record := &desktopSessionRetirement{Version: 1, Binding: strings.Repeat("b", 64), Guard: "clean\n", Original: original,
				Request: beewire.RuntimeRecoveryRequest{ID: strings.Repeat("c", 48), PreviousRunID: original.Session.RunID, AccountRevision: recoveryDigest(original), Preparations: retirementPreparations(original)}}
			switch check {
			case "previous_epoch_valid":
				record.Request.PreviousEpoch = "SECRET-EPOCH"
			case "account_revision_match":
				record.Request.AccountRevision = "SECRET-REVISION"
			case "preparations_match":
				record.Request.Preparations["openai"] = beewire.RuntimeRecoveryPreparation{ID: "SECRET-PREPARATION"}
			}
			if err := saveSessionRetirement(s, record); err != nil {
				t.Fatal(err)
			}
			_, err := readSessionRetirement(s)
			if err == nil || !strings.Contains(err.Error(), check+"=false") {
				t.Fatalf("missing failure check %s: %v", check, err)
			}
			if strings.Contains(err.Error(), "SECRET-") {
				t.Fatalf("metadata error exposed untrusted value: %v", err)
			}
		})
	}
}
