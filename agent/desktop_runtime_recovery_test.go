package bee

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
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
			if idle && (got.Local != "stopped" || got.Operation.State != "succeeded") {
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
