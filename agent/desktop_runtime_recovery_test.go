package bee

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopRuntimeRecoveryDoesNotStartWithoutCleanIntent(t *testing.T) {
	for _, scenario := range []string{"first", "stopped", "unclean", "dirty", "corrupt", "revoked"} {
		t.Run(scenario, func(t *testing.T) {
			var writes atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if scenario == "revoked" {
					w.WriteHeader(403)
					return
				}
				if desktopSupplyServeIdentity(w, q) {
					return
				}
				writes.Add(1)
				w.WriteHeader(500)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			if scenario != "first" {
				desktopRuntimeSelectionFixture(t, d, a)
				session, release, err := d.acquireSession(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				state, err := session.read()
				if err != nil {
					t.Fatal(err)
				}
				_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
					s.RuntimeIntent.Running = scenario != "stopped"
					s.RuntimeIntent.ResumePlatforms = []string{"openai"}
					s.Session.RunID = strings.Repeat("a", 32)
					s.Session.Active = scenario == "unclean"
					s.Session.Clean = scenario != "dirty" && scenario != "unclean"
					return nil
				})
				release()
				if err != nil {
					t.Fatal(err)
				}
				if scenario == "corrupt" {
					if err = os.WriteFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"), []byte("broken"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := r.Restore(context.Background()); err != nil {
				t.Fatal(err)
			}
			got := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
				return s.Operation != nil && (s.Operation.State == "failed" || s.Operation.State == "succeeded")
			})
			idle := scenario == "first" || scenario == "stopped"
			idleLocal := "stopped"
			if scenario == "first" {
				idleLocal = "waiting"
			}
			if idle && (got.Local != idleLocal || got.Operation.State != "succeeded") {
				t.Fatalf("first/stopped intent incorrectly failed: %+v", got)
			}
			if !idle && got.Operation.State != "failed" {
				t.Fatalf("unproved recovery accepted: %+v", got)
			}
			if writes.Load() != 0 {
				t.Fatalf("unsafe recovery issued requests=%d", writes.Load())
			}
		})
	}
}

func TestDesktopRecoveryInspectionHasNoSideEffects(t *testing.T) {
	for _, scenario := range []string{"clean", "stopped", "user_stopped", "pending", "dirty_guard", "active", "corrupt"} {
		t.Run(scenario, func(t *testing.T) {
			var writes atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) { writes.Add(1); w.WriteHeader(500) })
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			desktopRuntimeSelectionFixture(t, d, a)
			session, release, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			state, err := session.read()
			if err != nil {
				t.Fatal(err)
			}
			_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
				s.RuntimeIntent.Running = scenario != "stopped"
				s.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Clean: scenario != "active", Active: scenario == "active"}
				if scenario == "pending" {
					selection := s.Selections["openai"]
					s.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("b", 48), Kind: "select", Stage: "reconciling", Source: selection.Source, ToFingerprint: selection.Fingerprint, CredentialRevision: selection.CredentialRevision, StartedAt: time.Now().UTC()}
				}
				return nil
			})
			release()
			if err != nil {
				t.Fatal(err)
			}
			guard := []byte("clean\n")
			if scenario == "dirty_guard" {
				guard = []byte(strings.Repeat("a", 32) + "\n")
			}
			path := filepath.Join(filepath.Dir(d.path), "runtime-session")
			if err = os.WriteFile(path, guard, 0600); err != nil {
				t.Fatal(err)
			}
			if scenario == "corrupt" {
				if err = os.WriteFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"), []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := os.ReadFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
			r.userStopRequested = scenario == "user_stopped"
			got := r.InspectRecovery(context.Background())
			want := "eligible"
			if scenario == "stopped" || scenario == "user_stopped" {
				want = "idle"
			}
			if scenario == "dirty_guard" || scenario == "active" || scenario == "corrupt" || scenario == "pending" {
				want = "blocked"
			}
			if got.State != want {
				t.Fatalf("state=%s want=%s failure=%+v", got.State, want, got.Failure)
			}
			if scenario == "pending" && (got.Failure == nil || got.Failure.Code != "RECOVERY_OPERATION_UNRESOLVED") {
				t.Fatalf("pending operation was not preserved as unresolved: %+v", got.Failure)
			}
			after, _ := os.ReadFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
			actual, _ := os.ReadFile(path)
			if string(before) != string(after) || string(actual) != string(guard) || writes.Load() != 0 {
				t.Fatalf("inspection modified protected state or sent writes=%d", writes.Load())
			}
			if got.State == "blocked" && (got.Failure == nil || got.Failure.Message == "") {
				t.Fatal("missing original blocking evidence")
			}
			if r.snapshot.Operation != nil || r.snapshot.RunID != nil {
				t.Fatal("inspection admitted a runtime operation")
			}
		})
	}
}
