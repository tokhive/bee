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

	"github.com/coder/websocket"
)

func TestDesktopAutoServiceRestoreEmptyAccountsWaitsWithoutContribution(t *testing.T) {
	var connections, writes atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if q.URL.Path != "/api/bee/connect" {
			writes.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		connection, err := websocket.Accept(w, q, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		connections.Add(1)
		<-connection.CloseRead(q.Context()).Done()
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	if _, err := r.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	waiting := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
		return s.Operation != nil && (s.Operation.State == "succeeded" || s.Operation.State == "failed")
	})
	if waiting.Local != "waiting" || waiting.RunID != nil || waiting.Operation.State != "succeeded" {
		t.Fatalf("empty accounts did not settle in normal waiting: %+v", waiting)
	}
	request := enableTestPresence(t, r)
	live := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
	if live.Local != "waiting" || live.RunID != nil || writes.Load() != 0 {
		t.Fatalf("waiting started contribution: %+v writes=%d", live, writes.Load())
	}
	if err := r.EnablePresence(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if err := r.VerifyStartup(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: live.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "stopped" && s.StopReceipt != nil
	})
	if stopped.Operation.State != "succeeded" || !stopped.StopReceipt.WorkersStopped || !stopped.StopReceipt.SessionClean {
		t.Fatalf("waiting exit did not clean owned work: %+v", stopped)
	}
	if err := r.EnablePresence(context.Background(), request); err == nil {
		t.Fatal("exit allowed waiting presence to restart")
	}
	if connections.Load() != 1 || writes.Load() != 0 {
		t.Fatalf("waiting lifecycle created extra connections or contribution writes: connections=%d writes=%d", connections.Load(), writes.Load())
	}
}

func TestDesktopAutoServiceStartupRejectsDirtyEmptyAccountSession(t *testing.T) {
	var requests atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	state, err := readState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	scope := newDesktopAccountScope(state)
	scope.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
	disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	if err := saveDesktopAccountState(path, disk, 0); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	if err := r.VerifyStartup(context.Background()); err == nil || !strings.Contains(err.Error(), "previous_session_active=true") {
		t.Fatalf("startup accepted dirty zero-account session: error=%v", err)
	}
	deviceContext, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.EnablePresence(context.Background(), DesktopPresenceRequest{BindingRevision: deviceContext.BindingRevision}); err == nil || !strings.Contains(err.Error(), "previous_session_active=true") {
		t.Fatalf("presence accepted dirty zero-account session: error=%v", err)
	}
	if _, err := r.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Operation != nil && s.Operation.State == "failed" })
	if failed.Local != "failed" || failed.Operation.Error == nil || !strings.Contains(failed.Operation.Error.Error(), "previous_session_active=true") {
		t.Fatalf("restore lost dirty-session evidence: %+v", failed)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) || requests.Load() != 0 {
		t.Fatalf("blocked startup changed state or made requests: read_error=%v changed=%t requests=%d", err, string(after) != string(before), requests.Load())
	}
}

func TestDesktopAutoServiceWaitingAllowsFirstOfficialLogin(t *testing.T) {
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		t.Errorf("first login unexpectedly used Hive: %s %s", q.Method, q.URL.Path)
		w.WriteHeader(http.StatusInternalServerError)
	})
	owner, a, request, _ := authorizeFixture(t, "success")
	a.device = d
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	if _, err := r.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "waiting" })
	operation, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatalf("waiting blocked explicit first login: %v", err)
	}
	result := waitAuthorize(t, owner, operation.ID)
	if result.State != "succeeded" {
		t.Fatalf("first login did not finish: state=%s error=%v", result.State, result.Error)
	}
	account, err := a.Snapshot(context.Background(), "openai", false)
	if err != nil || account.Selection.State != "not_selected" || account.Candidate.Fingerprint == nil {
		t.Fatalf("first login selected an account or missed candidate: selection=%s candidate_present=%t error=%v", account.Selection.State, account.Candidate.Fingerprint != nil, err)
	}
	snapshot, err := r.Snapshot(context.Background())
	if err != nil || snapshot.Local != "waiting" || snapshot.RunID != nil {
		t.Fatalf("first login started contribution: local=%s run_present=%t error=%v", snapshot.Local, snapshot.RunID != nil, err)
	}
}

func TestDesktopAutoServiceStartEmptyAccountsPreservesSavedIntent(t *testing.T) {
	for _, running := range []bool{false, true} {
		t.Run(map[bool]string{false: "stopped", true: "running"}[running], func(t *testing.T) {
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				t.Errorf("empty-account start unexpectedly used Hive: %s %s", q.Method, q.URL.Path)
				w.WriteHeader(http.StatusInternalServerError)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			state, err := readState(d.path)
			if err != nil {
				t.Fatal(err)
			}
			scope := newDesktopAccountScope(state)
			scope.RuntimeIntent.Running = running
			disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
			path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
			if err := saveDesktopAccountState(path, disk, 0); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			if _, err := r.Start(context.Background(), DesktopStartRequest{ResumePlatforms: []string{}}); err != nil {
				t.Fatal(err)
			}
			waiting := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
				return s.Operation != nil && (s.Operation.State == "failed" || s.Operation.State == "succeeded")
			})
			if waiting.Local != "waiting" || waiting.RunID != nil || waiting.Operation.State != "succeeded" {
				t.Fatalf("empty account start did not wait: local=%s run_present=%t operation=%+v", waiting.Local, waiting.RunID != nil, waiting.Operation)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != string(before) {
				t.Fatalf("waiting changed persisted runtime consent: read_error=%v changed=%t", err, string(after) != string(before))
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(d.path), "runtime-session")); !os.IsNotExist(err) {
				t.Fatalf("waiting reserved a contribution session: stat_error=%v", err)
			}
		})
	}
}

func TestDesktopAutoServiceEmptyAccountAdmissionPreservesUnresolvedEvidence(t *testing.T) {
	for _, scenario := range []string{"corrupt", "pending", "guard"} {
		t.Run(scenario, func(t *testing.T) {
			var requests atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				requests.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			state, err := readState(d.path)
			if err != nil {
				t.Fatal(err)
			}
			scope := newDesktopAccountScope(state)
			if scenario == "pending" {
				directory := t.TempDir()
				scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("a", 48), Kind: "select", Stage: "submitted", Source: DesktopAccountSource{Directory: &directory, Store: "file"}, ToFingerprint: strings.Repeat("b", 64), CredentialRevision: strings.Repeat("c", 64), StartedAt: time.Now().UTC()}
			}
			disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
			path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
			if err := saveDesktopAccountState(path, disk, 0); err != nil {
				t.Fatal(err)
			}
			protected := path
			if scenario == "corrupt" {
				if err := os.WriteFile(path, []byte(`{"version":2`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "guard" {
				protected = filepath.Join(filepath.Dir(d.path), "runtime-session")
				if err := os.WriteFile(protected, []byte(strings.Repeat("d", 32)+"\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(protected)
			if err != nil {
				t.Fatal(err)
			}
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			if err := r.VerifyStartup(context.Background()); err == nil {
				t.Fatal("startup accepted unresolved zero-account state")
			}
			deviceContext, err := d.Context(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if err := r.EnablePresence(context.Background(), DesktopPresenceRequest{BindingRevision: deviceContext.BindingRevision}); err == nil {
				t.Fatal("presence accepted unresolved zero-account state")
			}
			if _, err := r.Restore(context.Background()); err != nil {
				t.Fatal(err)
			}
			failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Operation != nil && s.Operation.State == "failed" })
			if failed.Operation.Error == nil || failed.Local != "failed" {
				t.Fatalf("unresolved state has no failure evidence: %+v", failed.Operation)
			}
			after, err := os.ReadFile(protected)
			if err != nil || string(before) != string(after) || requests.Load() != 0 {
				t.Fatalf("unresolved evidence changed or sent remote requests: read_error=%v changed=%t requests=%d", err, string(before) != string(after), requests.Load())
			}
		})
	}
}
