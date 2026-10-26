package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func selectionOperation(t *testing.T, s DesktopAccountSnapshot) DesktopOperation {
	t.Helper()
	raw, _ := json.Marshal(s)
	var v struct {
		Operation *DesktopOperation `json:"operation"`
	}
	if err := json.Unmarshal(raw, &v); err != nil || v.Operation == nil {
		t.Fatalf("operation missing: %s", raw)
	}
	return *v.Operation
}
func waitSelection(t *testing.T, a *DesktopAccounts, platform string) DesktopAccountSnapshot {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s, err := a.Snapshot(context.Background(), platform, false)
		if err != nil {
			t.Fatal(err)
		}
		op := selectionOperation(t, s)
		if op.State != "pending" && op.State != "running" {
			return s
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("selection operation did not finish")
	return DesktopAccountSnapshot{}
}

func TestDesktopAccountSelectionDurablePauseAndRecovery(t *testing.T) {
	for _, scenario := range []string{"success", "lost_put", "source_changed", "owner_changed", "storage_corrupt", "pause_false", "save_failed"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			dir, _ = filepath.EvalSymlinks(dir)
			source := filepath.Join(dir, "auth.json")
			original := desktopCodexFixture(t, time.Now().Add(time.Hour))
			if err := os.WriteFile(source, original, 0600); err != nil {
				t.Fatal(err)
			}
			var mu sync.Mutex
			var calls []string
			paused := false
			var statePath string
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				calls = append(calls, r.Method+" "+r.URL.Path)
				if r.URL.Path == "/api/bee/identity" {
					id := desktopSupplyIdentity()
					if scenario == "owner_changed" {
						id.OwnerID = "other-owner"
					}
					json.NewEncoder(w).Encode(id)
					return
				}
				if r.URL.Path == "/api/bee/platforms/openai/account" {
					json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "not_configured"})
					return
				}
				if r.URL.Path == "/api/bee/platforms/openai/capabilities" {
					json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
					return
				}
				if r.URL.Path != "/api/bee/platforms/openai" {
					t.Errorf("unexpected request %s", r.URL)
					w.WriteHeader(500)
					return
				}
				if r.Method == "PUT" {
					disk, e := readDesktopAccountState(statePath)
					if e != nil || len(disk.Scopes) != 1 {
						t.Errorf("pause before persisted intent: %v", e)
					}
					for _, scope := range disk.Scopes {
						if scope.PendingOperations["openai"].ID == "" {
							t.Error("pause without durable operation")
						}
					}
					paused = true
					if scenario == "pause_false" {
						json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: false, Reasons: []string{"offline", "not_configured"}})
						return
					}
					if scenario == "save_failed" {
						if e := os.Chmod(statePath, 0000); e != nil {
							t.Error(e)
						}
					}
					if scenario == "source_changed" {
						os.WriteFile(source, desktopCodexFixture(t, time.Now().Add(2*time.Hour)), 0600)
					}
					if scenario == "lost_put" {
						conn, _, e := w.(http.Hijacker).Hijack()
						if e != nil {
							t.Error(e)
						} else {
							conn.Close()
						}
						return
					}
				}
				reasons := []string{"offline", "not_configured"}
				if paused {
					reasons = append(reasons, "manually_paused")
				}
				json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: paused, Reasons: reasons})
			})
			statePath = filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
			t.Cleanup(func() { os.Chmod(statePath, 0600) })
			a := NewDesktopAccounts(d)
			t.Cleanup(func() { a.Close() })
			a.readKeyring = func(context.Context, string) ([]byte, error) {
				t.Error("unselected keyring read")
				return nil, os.ErrNotExist
			}
			s, e := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
			if e != nil {
				t.Fatal(e)
			}
			if scenario == "storage_corrupt" {
				os.WriteFile(statePath, []byte(`{"version":999}`), 0600)
			}
			start, e := a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "select", Confirmed: true})
			if e != nil {
				t.Fatalf("select not started: %v", e)
			}
			if op := selectionOperation(t, start); op.State != "pending" {
				t.Fatalf("initial operation=%+v", op)
			}
			done := waitSelection(t, a, "openai")
			op := selectionOperation(t, done)
			mu.Lock()
			seen := append([]string{}, calls...)
			mu.Unlock()
			puts := 0
			for _, call := range seen {
				if strings.HasPrefix(call, "PUT ") {
					puts++
				}
				if strings.Contains(call, "claude") || strings.HasPrefix(call, "POST ") {
					t.Fatalf("unrequested side effect: %s", call)
				}
			}
			if scenario == "success" || scenario == "lost_put" {
				if op.State != "succeeded" || done.Selection.State != "selected" || puts != 1 {
					t.Fatalf("result=%+v selection=%+v calls=%v", op, done.Selection, seen)
				}
				disk, e := readDesktopAccountState(statePath)
				if e != nil {
					t.Fatal(e)
				}
				for _, scope := range disk.Scopes {
					selected, ok := scope.Selections["openai"]
					if !ok || selected.Source.Directory == nil || *selected.Source.Directory != dir || scope.RuntimeIntent.Running || len(scope.PendingOperations) != 0 || len(scope.Selections) != 1 {
						t.Fatalf("stored scope=%+v", scope)
					}
				}
				a.Close()
				restarted := NewDesktopAccounts(d)
				t.Cleanup(func() { restarted.Close() })
				restored, e := restarted.Snapshot(context.Background(), "openai", true)
				if e != nil || restored.Selection.State != "selected" || restored.Candidate.Reference != nil {
					t.Fatalf("restored=%+v error=%v", restored, e)
				}
				if e := os.Remove(source); e != nil {
					t.Fatal(e)
				}
				_, e = restarted.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: restored.Revision, CandidateRef: "", Action: "clear_selection", Confirmed: true})
				if e != nil {
					t.Fatalf("clear restored selection must not need official credentials: %v", e)
				}
				cleared := waitSelection(t, restarted, "openai")
				if selectionOperation(t, cleared).State != "succeeded" || cleared.Selection.State != "not_selected" {
					t.Fatalf("clear failed: %+v", cleared.Operation)
				}
			} else {
				if scenario == "source_changed" {
					if op.State != "failed" {
						t.Fatalf("verified pause with changed source must release failed selection, got %s", op.State)
					}
					disk, e := readDesktopAccountState(statePath)
					if e != nil {
						t.Fatal(e)
					}
					for _, scope := range disk.Scopes {
						if len(scope.PendingOperations) != 0 {
							t.Fatal("changed source left permanent unresolved pause")
						}
					}
				}
				if op.State == "succeeded" || done.Selection.State != "not_selected" || op.Error == nil {
					t.Fatalf("unsafe result=%+v", done)
				}
				if (scenario == "owner_changed" || scenario == "storage_corrupt") && puts != 0 {
					t.Fatalf("precondition failure wrote pause: %v", seen)
				}
			}
		})
	}
}

func TestDesktopAccountSelectionPendingDoesNotBlockQueries(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			select {
			case <-started:
			default:
				close(started)
			}
			<-release
			json.NewEncoder(w).Encode(desktopSupplyIdentity())
			return
		}
		json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "not_configured"})
	})
	dir := t.TempDir()
	dir, _ = filepath.EvalSymlinks(dir)
	os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600)
	a := NewDesktopAccounts(d)
	defer a.Close()
	defer close(release)
	s, e := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "select", Confirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	<-started
	for _, platform := range []string{"openai", "claude"} {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		_, e = a.Snapshot(ctx, platform, false)
		cancel()
		if e != nil {
			t.Fatalf("%s query blocked by action: %v", platform, e)
		}
	}
	if _, e = a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"}); e == nil {
		t.Fatal("candidate overwritten while selection pending")
	}
}

func TestDesktopAccountSelectionUnknownPauseSurvivesRestartWithoutReplay(t *testing.T) {
	var mu sync.Mutex
	unknown := true
	puts := 0
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		switch r.URL.Path {
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "not_configured"})
		case "/api/bee/platforms/openai/capabilities":
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
		case "/api/bee/platforms/openai":
			if r.Method == "PUT" {
				puts++
				conn, _, _ := w.(http.Hijacker).Hijack()
				conn.Close()
				return
			}
			if unknown {
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: true, Reasons: []string{"manually_paused", "not_configured"}})
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	})
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600)
	a := NewDesktopAccounts(d)
	s, e := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "select", Confirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	if done := waitSelection(t, a, "openai"); selectionOperation(t, done).State != "reconciling" {
		t.Fatal("unknown pause result became terminal")
	}
	a.Close()
	mu.Lock()
	unknown = false
	mu.Unlock()
	restarted := NewDesktopAccounts(d)
	defer restarted.Close()
	if _, e := restarted.Snapshot(context.Background(), "openai", true); e != nil {
		t.Fatal(e)
	}
	done := waitSelection(t, restarted, "openai")
	if selectionOperation(t, done).State != "succeeded" || done.Selection.State != "selected" {
		t.Fatalf("recovery did not commit verified selection: %+v", done)
	}
	mu.Lock()
	defer mu.Unlock()
	if puts != 1 {
		t.Fatalf("pause replayed after restart: puts=%d", puts)
	}
}

func TestDesktopAccountSelectionClaudeAndLocalClear(t *testing.T) {
	var mu sync.Mutex
	registered := false
	puts := 0
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		switch r.URL.Path {
		case "/api/bee/platforms/claude/account":
			account := beewire.PlatformAccount{Platform: "claude", Status: "not_configured"}
			if registered {
				account.AccountFingerprint = strings.Repeat("a", 64)
				account.Generation = 1
			}
			json.NewEncoder(w).Encode(account)
		case "/api/bee/platforms/claude":
			if r.Method == "PUT" {
				puts++
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "claude", Paused: true, Reasons: []string{"manually_paused", "not_configured"}})
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	})
	dir := t.TempDir()
	original := claudeSample(time.Now().Add(time.Hour))
	os.WriteFile(filepath.Join(dir, ".credentials.json"), original, 0600)
	a := NewDesktopAccounts(d)
	defer a.Close()
	a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/oauth/profile" || r.Method != "GET" {
			t.Errorf("unexpected official request: %s %s", r.Method, r.URL.Path)
		}
		return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
	})
	s, e := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "claude", Directory: &dir, Store: "file", Mode: "local"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "claude", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "select", Confirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	s = waitSelection(t, a, "claude")
	if selectionOperation(t, s).State != "succeeded" {
		t.Fatalf("Claude select: %+v", s.Operation)
	}
	mu.Lock()
	registered = true
	mu.Unlock()
	_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "claude", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "clear_selection", Confirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	s = waitSelection(t, a, "claude")
	if selectionOperation(t, s).State != "failed" || s.Selection.State != "selected" {
		t.Fatal("registered account cleared")
	}
	mu.Lock()
	registered = false
	mu.Unlock()
	_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "claude", Revision: s.Revision, CandidateRef: *s.Candidate.Reference, Action: "clear_selection", Confirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	s = waitSelection(t, a, "claude")
	if selectionOperation(t, s).State != "succeeded" || s.Selection.State != "not_selected" {
		t.Fatalf("local selection not cleared: %+v", s.Operation)
	}
	after, _ := os.ReadFile(filepath.Join(dir, ".credentials.json"))
	if string(after) != string(original) {
		t.Fatal("selection changed official credentials")
	}
	mu.Lock()
	defer mu.Unlock()
	if puts != 1 {
		t.Fatalf("clear issued supply writes: puts=%d", puts)
	}
}
