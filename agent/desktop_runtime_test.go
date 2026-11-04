package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
	"github.com/tokhive/bee/relay"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func desktopRuntimeSelectionFixture(t *testing.T, d *DesktopDevice, a *DesktopAccounts) {
	t.Helper()
	dir := t.TempDir()
	if e := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); e != nil {
		t.Fatal(e)
	}
	read, e := a.readAccountSource(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
	if e != nil {
		t.Fatal(e)
	}
	defer read.clear()
	state, e2 := readState(d.path)
	if e2 != nil {
		t.Fatal(e2)
	}
	scope := newDesktopAccountScope(state)
	scope.Selections["openai"] = desktopAccountSelection{Source: read.source, Fingerprint: *read.fingerprint, CredentialRevision: read.revision, Revision: 1}
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
	if e := saveDesktopAccountState(path, disk, 0); e != nil {
		t.Fatal(e)
	}
}

func waitRuntime(t *testing.T, r *DesktopRuntime, match func(DesktopRuntimeSnapshot) bool) DesktopRuntimeSnapshot {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		s, e := r.Snapshot(context.Background())
		if e != nil {
			t.Fatal(e)
		}
		if match(s) {
			return s
		}
		time.Sleep(time.Millisecond)
	}
	s, _ := r.Snapshot(context.Background())
	t.Fatalf("runtime condition not reached: %+v", s)
	return s
}

func TestDesktopRuntimeFirstConflictDoesNotTakeOverOrRetry(t *testing.T) {
	var connects, registrations atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		switch q.URL.Path {
		case "/api/bee/agent":
			connects.Add(1)
			w.WriteHeader(http.StatusConflict)
		case "/api/bee/platforms/openai":
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: true, Reasons: []string{"manually_paused", "not_configured"}})
		case "/api/bee/maintenance", "/api/bee/credentials":
			registrations.Add(1)
			w.WriteHeader(500)
		default:
			t.Errorf("unexpected runtime request %s", q.URL.Path)
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	s, e := r.Snapshot(context.Background())
	if e != nil || s.Local != "stopped" || connects.Load() != 0 {
		t.Fatalf("constructor started runtime: %+v %v", s, e)
	}
	if _, e := d.SetPaused(context.Background(), "openai", false); e == nil {
		t.Fatal("resume allowed before owned runtime start")
	}
	op, e := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: s.Revision, ResumePlatforms: []string{"openai"}})
	if e != nil || op.State != "pending" {
		t.Fatalf("start=%+v error=%v", op, e)
	}
	failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.Connection != "occupied" || failed.Operation.Error == nil || connects.Load() != 1 || registrations.Load() != 0 {
		t.Fatalf("first conflict not fenced: %+v connects=%d", failed, connects.Load())
	}
	if failed.ConnectionDetail == nil || failed.ConnectionDetail.Failure.Code != "ownership_unconfirmed" || failed.ConnectionDetail.Failure.Evidence["owned_session"] != "false" || failed.ConnectionDetail.Failure.Evidence["consecutive_conflicts"] != "1" || failed.ConnectionDetail.Retry != "halted" || failed.ConnectionDetail.NextRetryAt != nil {
		t.Fatalf("first conflict evidence missing: %+v", failed.ConnectionDetail)
	}
	oldRun := *failed.RunID
	if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: failed.Revision, Reason: "user_stop"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
	if stopped.ConnectionDetail != nil {
		t.Fatalf("stop retained connection alert: %+v", stopped.ConnectionDetail)
	}
	r.connectionObserved(oldRun, DesktopConnectionObservation{Connection: "rejected", Detail: failed.ConnectionDetail})
	after, _ := r.Snapshot(context.Background())
	if after.Revision != stopped.Revision || after.Connection != "disconnected" || after.ConnectionDetail != nil {
		t.Fatalf("late rejection overwrote stop: %+v", after)
	}
	time.Sleep(50 * time.Millisecond)
	if connects.Load() != 1 {
		t.Fatal("first conflict automatically retried")
	}
}

func TestDesktopRuntimeStartRequiresSelectionAndFreshRevision(t *testing.T) {
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if !desktopSupplyServeIdentity(w, r) {
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	s, _ := r.Snapshot(context.Background())
	if _, e := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: s.Revision + 1, ResumePlatforms: []string{}}); e == nil {
		t.Fatal("stale revision accepted")
	}
	_, e := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: s.Revision, ResumePlatforms: []string{}})
	if e != nil {
		t.Fatal(e)
	}
	failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.Operation.Error == nil {
		t.Fatal("missing selection not reported")
	}
}

func desktopRuntimeDeviceFixture(t *testing.T, handler http.HandlerFunc) *DesktopDevice {
	t.Helper()
	credential := "bee_" + strings.Repeat("b", 43)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+credential || r.Header.Get("User-Agent") == "" {
			t.Error("runtime request lacks device authentication")
		}
		if r.URL.Path != "/api/bee/agent" && r.URL.Path != "/api/bee/connect" && (r.Header.Get("Content-Type") != "application/json" || r.Header.Get("X-Hive-Request") != "1") {
			t.Error("REST request lacks Bee headers")
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	identity := desktopSupplyIdentity()
	path := filepath.Join(t.TempDir(), "desktop.json")
	if err := saveState(path, localState{Hive: server.URL, Name: identity.Name, Credential: credential, Identity: &identity}); err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(path)
	t.Cleanup(func() {
		after, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(original, after) {
			t.Errorf("runtime mutated device config: %v", e)
		}
	})
	return newDesktopTestDevice(t, path)
}

func TestDesktopRuntimeRunsRealSynchronizationRelayAndStop(t *testing.T) {
	for _, scenario := range []string{"presence_handoff", "synchronization_failure_recovery", "readback_failure_recovery", "clean_stop", "save_failure", "pause_during_start", "failed_selection", "manual_generation_change", "claude_source_unavailable", "switch_source", "stop_during_start", "restore_running", "restore_paused", "restore_manual_resume", "restore_user_stop", "restore_new_token", "crash_then_exit", "restore_stop_save_failure", "restore_reservation_save_failure"} {
		t.Run(scenario, func(t *testing.T) {
			saveFailure := scenario == "save_failure"
			proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
				if q.Method != "CONNECT" || q.Host != "chatgpt.com:443" {
					t.Errorf("unexpected relay target: %s %s", q.Method, q.Host)
					w.WriteHeader(403)
					return
				}
				conn, buffer, e := w.(http.Hijacker).Hijack()
				if e != nil {
					t.Error(e)
					return
				}
				defer conn.Close()
				conn.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
				io.Copy(conn, buffer)
			}))
			defer proxy.Close()
			inbox, _ := tee.GenerateInboxKey()
			pub := inbox.Public()
			var mu sync.Mutex
			paused := true
			uploads, maintenance := 0, 0
			account := beewire.PlatformAccount{Platform: "openai", Status: "not_configured"}
			peer := make(chan *relay.Session, 1)
			pauseEntered, pauseRelease := make(chan struct{}), make(chan struct{})
			var blockPause atomic.Bool
			firstIdentity, releaseIdentity := make(chan struct{}), make(chan struct{})
			var identityRequests atomic.Int32
			var blockRecoveryIdentity atomic.Bool
			recoveryIdentityEntered := make(chan struct{})
			var resumePuts, supplyPuts, connections, presences atomic.Int32
			var occupied atomic.Bool
			var recoveryFailure atomic.Bool
			recoveryFailure.Store(true)
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if q.URL.Path == "/api/bee/identity" && blockRecoveryIdentity.CompareAndSwap(true, false) {
					close(recoveryIdentityEntered)
					<-q.Context().Done()
					return
				}
				if (scenario == "pause_during_start" || scenario == "stop_during_start") && q.URL.Path == "/api/bee/identity" && identityRequests.Add(1) == 1 {
					close(firstIdentity)
					select {
					case <-releaseIdentity:
					case <-q.Context().Done():
						return
					}
				}
				if desktopSupplyServeIdentity(w, q) {
					return
				}
				if scenario == "presence_handoff" && (q.URL.Path == "/api/bee/agent" || q.URL.Path == "/api/bee/connect") {
					if !occupied.CompareAndSwap(false, true) {
						w.WriteHeader(409)
						return
					}
					defer func() { time.Sleep(30 * time.Millisecond); occupied.Store(false) }()
				}
				if q.URL.Path == "/api/bee/connect" {
					c, err := websocket.Accept(w, q, nil)
					if err != nil {
						return
					}
					defer c.CloseNow()
					presences.Add(1)
					<-c.CloseRead(q.Context()).Done()
					return
				}
				if q.URL.Path == "/api/bee/agent" {
					connections.Add(1)
					w.Header().Set("X-Bee-Lease", "owned-test-lease")
					conn, e := websocket.Accept(w, q, nil)
					if e != nil {
						return
					}
					live := relay.New(q.Context(), conn, tunnel.Low, nil, relay.Options{})
					defer live.Close()
					peer <- live
					<-live.Context.Done()
					return
				}
				if q.URL.Path == "/api/bee/platforms/openai" && q.Method == "PUT" && blockPause.Load() {
					close(pauseEntered)
					select {
					case <-pauseRelease:
					case <-q.Context().Done():
						return
					}
				}
				mu.Lock()
				defer mu.Unlock()
				switch q.URL.Path {
				case "/api/bee/platforms/openai":
					if scenario == "readback_failure_recovery" && uploads > 0 && q.Method == "GET" && recoveryFailure.CompareAndSwap(true, false) {
						w.WriteHeader(503)
						w.Write([]byte(`{"code":"supply_temporarily_unavailable","message":"synthetic readback outage"}`))
						return
					}
					if q.Method == "PUT" {
						supplyPuts.Add(1)
						var v struct {
							Paused bool `json:"paused"`
						}
						json.NewDecoder(q.Body).Decode(&v)
						if !v.Paused && uploads == 0 {
							t.Error("resumed before actual encrypted registration")
						}
						if !v.Paused {
							resumePuts.Add(1)
						}
						paused = v.Paused
					}
					reasons := []string{}
					if paused {
						reasons = append(reasons, "manually_paused")
					}
					if uploads == 0 {
						reasons = append(reasons, "not_configured")
					}
					json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: paused, Ready: len(reasons) == 0, Reasons: reasons})
				case "/api/bee/platforms/openai/account":
					json.NewEncoder(w).Encode(account)
				case "/api/bee/maintenance":
					maintenance++
					if scenario == "synchronization_failure_recovery" && recoveryFailure.CompareAndSwap(true, false) {
						w.WriteHeader(503)
						w.Write([]byte(`{"code":"maintenance_unavailable","message":"synthetic synchronization outage"}`))
						return
					}
					var input beewire.MaintenanceRequest
					if e := json.NewDecoder(q.Body).Decode(&input); e != nil {
						t.Error(e)
					}
					if input.Lease != "owned-test-lease" {
						t.Error("authorization not bound to current connection lease")
					}
					account = beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1, AccountFingerprint: input.Codex.AccountFingerprint, CredentialRevision: input.Codex.CredentialRevision}
					var task *beewire.MaintenanceTask
					if uploads == 0 {
						task = &beewire.MaintenanceTask{ID: "desktop-authorization", Kind: "reencrypt_authorization", DeviceID: "device-1", Platform: "openai", AccountFingerprint: account.AccountFingerprint, AccountGeneration: 1, CredentialRevision: account.CredentialRevision, KeyVersion: 1, Key: pub}
					}
					json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: account, Task: task})
				case "/api/bee/credential-key":
					json.NewEncoder(w).Encode(pub)
				case "/api/bee/credentials":
					var input struct {
						Envelope tee.Envelope `json:"envelope"`
						TaskID   string       `json:"task_id"`
						Lease    string       `json:"lease"`
					}
					raw, _ := io.ReadAll(q.Body)
					if bytes.Contains(raw, []byte("synthetic-refresh-SECRET")) {
						t.Error("refresh token uploaded")
					}
					if e := json.Unmarshal(raw, &input); e != nil {
						t.Error(e)
					}
					secret, _, e := inbox.Open(input.Envelope)
					if e != nil || secret.Token == "" || input.TaskID != "desktop-authorization" || input.Lease != "owned-test-lease" {
						t.Errorf("actual authorization envelope invalid: %v", e)
					}
					uploads++
					json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
				case "/api/bee/platforms/openai/capabilities":
					if q.Method == "GET" {
						json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
					} else {
						json.NewEncoder(w).Encode(map[string]bool{"ok": true})
					}
				default:
					t.Errorf("unselected or unknown runtime endpoint: %s %s", q.Method, q.URL.Path)
					w.WriteHeader(404)
				}
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			desktopRuntimeSelectionFixture(t, d, a)
			if scenario == "claude_source_unavailable" {
				session, release, err := d.acquireSession(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				state, err := session.read()
				if err != nil {
					t.Fatal(err)
				}
				missing := filepath.Join(t.TempDir(), "missing")
				_, err = a.selectionScope(session, state, func(scope *desktopAccountScope) error {
					v := scope.Selections["openai"]
					v.Source = DesktopAccountSource{Directory: &missing, Store: "file"}
					scope.Selections["claude"] = v
					return nil
				})
				release()
				if err != nil {
					t.Fatal(err)
				}
			}
			a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) { return claudeProfileResponse(503, `{}`), nil })
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			if e := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); e != nil {
				t.Fatal(e)
			}
			if scenario == "presence_handoff" {
				enableTestPresence(t, r)
				waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Connection == "connected" })
			}
			s, _ := r.Snapshot(context.Background())
			mu.Lock()
			if uploads != 0 || maintenance != 0 {
				t.Fatal("construction synchronized credentials")
			}
			mu.Unlock()
			resume := []string{"openai"}
			if strings.HasSuffix(scenario, "failure_recovery") {
				resume = []string{}
			}
			if _, e := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: s.Revision, ResumePlatforms: resume}); e != nil {
				t.Fatal(e)
			}
			if scenario == "stop_during_start" {
				select {
				case <-firstIdentity:
				case <-time.After(time.Second):
					t.Fatal("start did not enter identity")
				}
				current, _ := r.Snapshot(context.Background())
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "user_stop"}); err != nil {
					close(releaseIdentity)
					t.Fatal(err)
				}
				stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
				close(releaseIdentity)
				if stopped.StopReceipt == nil || !stopped.StopReceipt.SessionClean {
					t.Fatalf("stop not confirmed: %+v", stopped.StopReceipt)
				}
				disk, err := readDesktopAccountState(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
				if err != nil {
					t.Fatal(err)
				}
				for _, scope := range disk.Scopes {
					if scope.RuntimeIntent.Running || scope.Session.Active {
						t.Fatal("late start save overwrote user stop")
					}
				}
				return
			}
			if scenario == "pause_during_start" {
				select {
				case <-firstIdentity:
				case <-time.After(time.Second):
					t.Fatal("start did not enter identity")
				}
				if _, err := d.SetPaused(context.Background(), "openai", true); err != nil {
					close(releaseIdentity)
					t.Fatal(err)
				}
				close(releaseIdentity)
			}
			if strings.HasSuffix(scenario, "failure_recovery") {
				failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.ConnectionDetail != nil && s.ConnectionDetail.Failure != nil && s.ConnectionDetail.Failure.Stage == "synchronize"
				})
				if failed.Connection != "connected" || failed.ConnectionDetail.Retry != "idle" || failed.ConnectionDetail.NextRetryAt != nil {
					t.Fatalf("platform outage changed core reconnect: %+v", failed)
				}
				before := supplyPuts.Load()
				recovered := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Platforms["openai"].Supply != nil && s.Platforms["openai"].Account.Authorization.State == "synchronized" && s.ConnectionDetail == nil
				})
				if recovered.ConnectionDetail != nil {
					t.Fatalf("same-connection successful synchronization retained current failure: %+v", recovered.ConnectionDetail)
				}
				if recovered.RunID == nil || *recovered.RunID != *failed.RunID || recovered.Connection != "connected" || connections.Load() != 1 || supplyPuts.Load() != before || resumePuts.Load() != 0 || !recovered.Platforms["openai"].Supply.Paused {
					t.Fatalf("recovery changed run/link/pause or wrote supply: snapshot=%+v connections=%d supply_puts=%d before=%d resume_puts=%d", recovered, connections.Load(), supplyPuts.Load(), before, resumePuts.Load())
				}
				for label, value := range map[string]DesktopRuntimeSnapshot{"failed": failed, "recovered": recovered} {
					raw, _ := json.Marshal(value)
					t.Logf("%s=%s", label, raw)
				}
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: recovered.Revision, Reason: "user_stop"}); err != nil {
					t.Fatal(err)
				}
				waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
				return
			}
			ready := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
				return s.Local == "running" && s.Platforms["openai"].Supply != nil && (scenario == "pause_during_start" || s.Platforms["openai"].Supply.Ready)
			})
			if scenario == "pause_during_start" && (!ready.Platforms["openai"].Supply.Paused || resumePuts.Load() != 0) {
				t.Fatal("startup overwrote acknowledged manual pause")
			}
			if ready.Connection != "connected" || ready.Platforms["claude"].Supply != nil {
				t.Fatalf("platform readiness conflated: %+v", ready)
			}
			var live *relay.Session
			select {
			case live = <-peer:
			case <-time.After(time.Second):
				t.Fatal("real WS handshake absent")
			}
			stream, e := live.Mux.Dial([]byte(`{"host":"chatgpt.com:443"}`))
			if e != nil {
				t.Fatal(e)
			}
			defer stream.Close()
			probe := []byte("controlled-desktop-relay-probe")
			reply := make(chan error, 1)
			go func() {
				_, e := stream.Write(probe)
				if e == nil {
					got := make([]byte, len(probe))
					_, e = io.ReadFull(stream, got)
					if e == nil && !bytes.Equal(got, probe) {
						e = io.ErrUnexpectedEOF
					}
				}
				reply <- e
			}()
			select {
			case e := <-reply:
				if e != nil {
					t.Fatal(e)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("relay did not reach local upstream proxy")
			}
			if scenario == "clean_stop" {
				blockPause.Store(true)
				pauseDone := make(chan error, 1)
				go func() { _, err := d.SetPaused(context.Background(), "openai", true); pauseDone <- err }()
				select {
				case <-pauseEntered:
				case <-time.After(time.Second):
					t.Fatal("manual pause did not acquire platform gate")
				}
				live.Close()
				select {
				case live = <-peer:
				case <-time.After(3 * time.Second):
					close(pauseRelease)
					t.Fatal("owned session did not reconnect while pause was pending")
				}
				mu.Lock()
				before := maintenance
				mu.Unlock()
				blockPause.Store(false)
				close(pauseRelease)
				if err := <-pauseDone; err != nil {
					t.Fatal(err)
				}
				waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					mu.Lock()
					calls := maintenance
					mu.Unlock()
					return calls > before && s.Platforms["openai"].Supply != nil && s.Platforms["openai"].Supply.Paused
				})
			}
			if scenario == "claude_source_unavailable" && ready.Platforms["claude"].Account.Authorization.Error == nil {
				t.Fatal("failed Claude source was presented as successful")
			}
			if scenario == "switch_source" {
				p, unlock, err := a.acquire(context.Background(), "openai")
				if err != nil {
					t.Fatal(err)
				}
				old := p.selected
				unlock()
				contents, err := os.ReadFile(filepath.Join(*old.Source.Directory, "auth.json"))
				if err != nil {
					t.Fatal(err)
				}
				next := t.TempDir()
				if err = os.WriteFile(filepath.Join(next, "auth.json"), contents, 0600); err != nil {
					t.Fatal(err)
				}
				detected, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &next, Store: "file", Mode: "local"})
				if err != nil {
					t.Fatal(err)
				}
				_, err = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: detected.Revision, CandidateRef: *detected.Candidate.Reference, Action: "select", Confirmed: true})
				if err != nil {
					t.Fatal(err)
				}
				selected := waitSelection(t, a, "openai")
				if selected.Operation.State != "succeeded" {
					t.Fatalf("runtime selection failed: %+v", selected.Operation)
				}
				switched := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Platforms["openai"].SelectionRevision > old.Revision && s.Platforms["openai"].Supply != nil
				})
				if !switched.Platforms["openai"].Supply.Paused {
					t.Fatal("source switch automatically resumed")
				}
				os.Remove(filepath.Join(*old.Source.Directory, "auth.json"))
				if _, err := d.SetPaused(context.Background(), "openai", false); err != nil {
					t.Fatalf("confirmed new source not resumable: %v", err)
				}
			}
			if scenario == "failed_selection" || scenario == "manual_generation_change" {
				if _, err := d.SetPaused(context.Background(), "openai", true); err != nil {
					t.Fatal(err)
				}
				if scenario == "failed_selection" {
					owned, finish, err := r.selectionBarrier(context.Background(), "openai")
					if err != nil || !owned {
						t.Fatalf("selection barrier: owned=%t err=%v", owned, err)
					}
					finish(nil, false)
				} else {
					mu.Lock()
					account.Generation += 2
					mu.Unlock()
				}
				before := resumePuts.Load()
				if _, err := d.SetPaused(context.Background(), "openai", false); err == nil || resumePuts.Load() != before {
					t.Fatalf("manual resume bypassed current runtime binding: err=%v new_puts=%d", err, resumePuts.Load()-before)
				}
			}
			if scenario == "crash_then_exit" {
				r.Close() // Kill owned workers without persisting a clean stop.
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
					t.Fatal(err)
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
				t.Logf("unclean restore correctly refused: %+v", failed.Operation.Error)
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: failed.Revision, Reason: "app_exit"}); err != nil {
					t.Fatal(err)
				}
				second := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
				t.Logf("after blocked restore, app exit receipt: %+v", second.StopReceipt)
				r.Close()
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
					t.Fatal(err)
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				restored := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "failed" || s.Local == "running" && s.Platforms["openai"].Supply != nil
				})
				if restored.Local == "running" {
					t.Fatalf("unclean session was erased by app_exit without explicit recovery: local=%s paused=%t", restored.Local, restored.Platforms["openai"].Supply.Paused)
				}
				return
			}
			path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
			if saveFailure {
				if e := os.Chmod(path, 0000); e != nil {
					t.Fatal(e)
				}
				defer os.Chmod(path, 0600)
			}
			if scenario == "restore_paused" || scenario == "restore_manual_resume" {
				if _, e := d.SetPaused(context.Background(), "openai", true); e != nil {
					t.Fatal(e)
				}
				if scenario == "restore_manual_resume" {
					if _, e := d.SetPaused(context.Background(), "openai", false); e != nil {
						t.Fatal(e)
					}
				}
			}
			reason := "user_stop"
			if strings.HasPrefix(scenario, "restore_") && scenario != "restore_user_stop" {
				reason = "app_exit"
			}
			s, _ = r.Snapshot(context.Background())
			if _, e := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: s.Revision, Reason: reason}); e != nil {
				t.Fatal(e)
			}
			stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
			if stopped.StopReceipt == nil || !stopped.StopReceipt.WorkersStopped || stopped.StopReceipt.IntentSaved == saveFailure || stopped.StopReceipt.SessionClean == saveFailure {
				t.Fatalf("stop receipt lied: %+v", stopped.StopReceipt)
			}
			select {
			case <-live.Context.Done():
			case <-time.After(time.Second):
				t.Fatal("owned WS remained after stop")
			}
			mu.Lock()
			calls := maintenance
			mu.Unlock()
			time.Sleep(50 * time.Millisecond)
			mu.Lock()
			if maintenance != calls {
				t.Error("worker submitted after stop receipt")
			}
			mu.Unlock()
			if scenario == "presence_handoff" {
				idle := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "stopped" && s.Connection == "connected" && presences.Load() == 2
				})
				if idle.Operation.State != "succeeded" || connections.Load() != 1 {
					t.Fatalf("contribution handoff failed: %+v", idle)
				}
			}
			if saveFailure {
				if err := os.Chmod(path, 0600); err != nil {
					t.Fatal(err)
				}
				current, _ := r.Snapshot(context.Background())
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "app_exit"}); err != nil {
					t.Fatal(err)
				}
				second := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
				t.Logf("after failed user stop, app exit receipt: %+v", second.StopReceipt)
				r.Close()
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
					t.Fatal(err)
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				restored := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "stopped" && s.Operation.State == "succeeded" || s.Local == "failed" || s.Local == "running" && s.Platforms["openai"].Supply != nil
				})
				if restored.Local == "running" {
					t.Fatalf("failed user-stop intent was erased by app_exit: local=%s paused=%t", restored.Local, restored.Platforms["openai"].Supply.Paused)
				}
			}
			if scenario == "restore_stop_save_failure" || scenario == "restore_reservation_save_failure" {
				r.Close()
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
					t.Fatal(err)
				}
				if scenario == "restore_reservation_save_failure" {
					if err := os.Chmod(path, 0000); err != nil {
						t.Fatal(err)
					}
					defer os.Chmod(path, 0600)
				} else {
					blockRecoveryIdentity.Store(true)
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				if scenario == "restore_reservation_save_failure" {
					waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
				} else {
					select {
					case <-recoveryIdentityEntered:
					case <-time.After(5 * time.Second):
						t.Fatal("restore did not enter identity")
					}
				}
				if err := os.Chmod(path, 0000); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(path, 0600)
				current, _ := r.Snapshot(context.Background())
				if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "user_stop"}); err != nil {
					t.Fatal(err)
				}
				stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
				t.Logf("stop during restore before active marker receipt: %+v", stopped.StopReceipt)
				if stopped.StopReceipt.IntentSaved {
					t.Fatal("expected actual save failure")
				}
				if err := os.Chmod(path, 0600); err != nil {
					t.Fatal(err)
				}
				r.Close()
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
					t.Fatal(err)
				}
				if _, err := r.Restore(context.Background()); err != nil {
					t.Fatal(err)
				}
				restored := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "failed" || s.Local == "running" && s.Platforms["openai"].Supply != nil
				})
				if restored.Local == "running" {
					t.Fatalf("stop-save failure during restore retained old clean marker: local=%s paused=%t", restored.Local, restored.Platforms["openai"].Supply.Paused)
				}
				return
			}
			if strings.HasPrefix(scenario, "restore_") {
				r.Close()
				if scenario == "restore_new_token" {
					p, unlock, e := a.acquire(context.Background(), "openai")
					if e != nil {
						t.Fatal(e)
					}
					path := filepath.Join(*p.selected.Source.Directory, "auth.json")
					unlock()
					raw, e := os.ReadFile(path)
					if e != nil {
						t.Fatal(e)
					}
					if e = os.WriteFile(path, []byte(strings.ReplaceAll(string(raw), "c3ludGhldGlj", "cmVuZXdlZA")), 0600); e != nil {
						t.Fatal(e)
					}
				}
				r = NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				if e := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); e != nil {
					t.Fatal(e)
				}
				if _, e := r.Restore(context.Background()); e != nil {
					t.Fatal(e)
				}
				if scenario == "restore_user_stop" {
					waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
						return s.Local == "stopped" && s.Operation != nil && s.Operation.State == "succeeded"
					})
				} else {
					restored := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
						return s.Local == "running" && s.Platforms["openai"].Supply != nil
					})
					if restored.Platforms["openai"].Supply.Paused != (scenario == "restore_paused") {
						t.Fatalf("restored pause incorrect: %+v", restored.Platforms["openai"].Supply)
					}
				}
			}
		})
	}
}
func fmtBool(v bool) string {
	if v {
		return "save_failure"
	}
	return "clean_stop"
}

func TestDesktopRuntimeOwnedReconnectStopsAfterPersistentConflict(t *testing.T) {
	originalRetries, originalDelay := conflictRetries, conflictRetryDelay
	conflictRetries, conflictRetryDelay = 1, 10*time.Millisecond
	defer func() { conflictRetries, conflictRetryDelay = originalRetries, originalDelay }()
	var connects atomic.Int32
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		switch q.URL.Path {
		case "/api/bee/agent":
			if connects.Add(1) > 1 {
				w.WriteHeader(http.StatusConflict)
				return
			}
			conn, err := websocket.Accept(w, q, nil)
			if err == nil {
				conn.CloseNow()
			}
		case "/api/bee/platforms/openai":
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: true, Reasons: []string{"manually_paused", "not_configured"}})
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	if _, err := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: 0, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	failed := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.ConnectionDetail == nil || failed.ConnectionDetail.Failure.Code != "ownership_unconfirmed" || failed.ConnectionDetail.Failure.Evidence["owned_session"] != "true" || failed.ConnectionDetail.Failure.Evidence["consecutive_conflicts"] != "2" || failed.ConnectionDetail.Retry != "halted" || failed.ConnectionDetail.NextRetryAt != nil {
		t.Fatalf("bounded conflict evidence missing: %+v", failed.ConnectionDetail)
	}
	if failed.Connection != "occupied" || connects.Load() != 3 {
		t.Fatalf("persistent conflict not bounded: connection=%s attempts=%d", failed.Connection, connects.Load())
	}
}
