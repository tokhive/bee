package bee

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func desktopOtherCodexFixture(t *testing.T) []byte {
	raw := desktopCodexFixture(t, time.Now().Add(time.Hour))
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	tokens := v["tokens"].(map[string]any)
	for _, key := range []string{"access_token", "id_token"} {
		parts := strings.Split(tokens[key].(string), ".")
		claims, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			t.Fatal(err)
		}
		parts[1] = base64.RawURLEncoding.EncodeToString([]byte(strings.ReplaceAll(string(claims), "synthetic-account", "synthetic-other-account")))
		tokens[key] = strings.Join(parts, ".")
	}
	tokens["account_id"] = "synthetic-other-account"
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestDesktopAccountSwitchDurableConfirmationAndUnknownResults(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		for _, scenario := range []string{"success", "lost_confirm", "confirm_unknown", "wrong_generation", "pending_changed", "pause_failed", "confirm_not_submitted", "save_failed", "source_changed", "stop_before_connection", "committed_token_revision", "final_sync_save_failed", "restart_reconcile"} {
			if platform == "claude" && scenario == "source_changed" {
				continue
			}
			t.Run(platform+"/"+scenario, func(t *testing.T) {
				var mu sync.Mutex
				old := strings.Repeat("a", 64)
				rev := strings.Repeat("b", 64)
				account := beewire.PlatformAccount{Platform: platform, Status: "ready", AccountFingerprint: old, Generation: 3, CredentialRevision: rev}
				paused := false
				connected := false
				confirms := 0
				registrations := 0
				resumes := 0
				statePath := ""
				sourcePath := ""
				saveBlocked := false
				confirmationReadFailed := false
				pauseReadFailed := false
				pauseReady, pauseRelease := make(chan struct{}), make(chan struct{})
				var pauseOnce sync.Once
				defer pauseOnce.Do(func() { close(pauseRelease) })
				dials := 0
				d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
					if desktopSupplyServeIdentity(w, q) {
						return
					}
					if q.URL.Path == "/api/bee/agent" {
						mu.Lock()
						connected = true
						dials++
						mu.Unlock()
						w.Header().Set("X-Bee-Lease", "synthetic-owned-lease")
						conn, err := websocket.Accept(w, q, nil)
						if err != nil {
							return
						}
						live := relay.New(q.Context(), conn, tunnel.High, nil, relay.Options{})
						<-live.Context.Done()
						live.Close()
						live.Wait()
						mu.Lock()
						connected = false
						mu.Unlock()
						return
					}
					mu.Lock()
					defer mu.Unlock()
					switch q.URL.Path {
					case "/api/bee/platforms/" + platform:
						if q.Method == "PUT" {
							var body struct {
								Paused bool `json:"paused"`
							}
							_ = json.NewDecoder(q.Body).Decode(&body)
							if !body.Paused {
								resumes++
							}
							if scenario == "confirm_not_submitted" {
								paused = true
								w.WriteHeader(503)
								return
							}
							if scenario == "pause_failed" {
								w.WriteHeader(503)
								return
							}
							paused = body.Paused
							if scenario == "stop_before_connection" {
								close(pauseReady)
								select {
								case <-pauseRelease:
								case <-q.Context().Done():
								}
							}
						}
						if scenario == "confirm_not_submitted" && paused && !pauseReadFailed {
							pauseReadFailed = true
							w.WriteHeader(503)
							return
						}
						reasons := []string{"not_configured"}
						if paused {
							reasons = append(reasons, "manually_paused")
						}
						_ = json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Paused: paused, Reasons: reasons})
					case "/api/bee/platforms/" + platform + "/account":
						if scenario == "restart_reconcile" && confirms > 0 && !confirmationReadFailed {
							confirmationReadFailed = true
							w.WriteHeader(503)
							return
						}
						_ = json.NewEncoder(w).Encode(account)
					case "/api/bee/platforms/" + platform + "/capabilities":
						_ = json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
					case "/api/bee/maintenance":
						if !connected || !paused {
							t.Error("candidate reported without owned paused connection")
						}
						var input beewire.MaintenanceRequest
						_ = json.NewDecoder(q.Body).Decode(&input)
						registrations++
						if scenario == "committed_token_revision" && registrations == 2 {
							disk, e := readDesktopAccountState(statePath)
							if e != nil {
								t.Error(e)
							}
							for _, scope := range disk.Scopes {
								if scope.PendingOperations[platform].Stage != "committed" {
									t.Error("renewal fixture requires committed operation")
								}
							}
							raw, e := os.ReadFile(sourcePath)
							if e != nil {
								t.Error(e)
							}
							if e = os.WriteFile(sourcePath, []byte(strings.ReplaceAll(strings.ReplaceAll(string(raw), "c3ludGhldGlj", "cmVuZXdlZA"), "synthetic-claude-access", "synthetic-claude-renewed")), 0600); e != nil {
								t.Error(e)
							}
							w.WriteHeader(503)
							return
						}
						metadata := input.Codex
						if platform == "claude" {
							if input.Claude == nil {
								t.Error("missing Claude metadata")
								return
							}
							metadata = *input.Claude
						}
						if metadata.AccountFingerprint != account.AccountFingerprint {
							account.Status = "confirmation_required"
							account.PendingFingerprint = metadata.AccountFingerprint
							account.ConfirmationID = "synthetic-private-confirmation"
						} else {
							account.Status = "ready"
							account.CredentialRevision = metadata.CredentialRevision
						}
						if scenario == "final_sync_save_failed" && registrations == 2 {
							if e := os.Chmod(filepath.Dir(statePath), 0500); e != nil {
								t.Error(e)
							}
							saveBlocked = true
						}
						if scenario == "pending_changed" {
							account.PendingFingerprint = strings.Repeat("f", 64)
						}
						_ = json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: account})
					case "/api/bee/platforms/" + platform + "/account/confirm":
						confirms++
						disk, e := readDesktopAccountState(statePath)
						if e != nil {
							t.Errorf("confirm before durable intent: %v", e)
						}
						for _, scope := range disk.Scopes {
							if p := scope.PendingOperations[platform]; p.Kind != "confirm_change" || p.Stage != "submitted" || p.ConfirmationID != "synthetic-private-confirmation" {
								t.Errorf("confirm without durable submitted proof: %+v", p)
							}
						}
						var input map[string]string
						_ = json.NewDecoder(q.Body).Decode(&input)
						if !connected || !paused || input["account_fingerprint"] != account.PendingFingerprint || input["confirmation_id"] != account.ConfirmationID {
							t.Error("confirmation binding or pause invalid")
						}
						if scenario == "confirm_unknown" {
							w.WriteHeader(503)
							return
						}
						account.AccountFingerprint = account.PendingFingerprint
						account.Generation++
						account.PendingFingerprint = ""
						account.ConfirmationID = ""
						account.Status = "source_unavailable"
						account.CredentialRevision = ""
						if scenario == "wrong_generation" {
							account.Generation++
						}
						if scenario == "source_changed" {
							_ = os.WriteFile(sourcePath, desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600)
						}
						if scenario == "save_failed" {
							if e := os.Chmod(filepath.Dir(statePath), 0500); e != nil {
								t.Error(e)
							}
							saveBlocked = true
						}
						if scenario == "lost_confirm" {
							w.WriteHeader(503)
							return
						}
						_ = json.NewEncoder(w).Encode(account)
					default:
						t.Errorf("unexpected switch request %s", q.URL.Path)
						w.WriteHeader(404)
					}
				})
				a := NewDesktopAccounts(d)
				a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
					if q.URL.Path != "/api/oauth/profile" {
						t.Errorf("unexpected official request: %s", q.URL.Path)
					}
					return claudeProfileResponse(200, claudeTestProfile), nil
				})
				defer a.Close()
				r := NewDesktopRuntime(context.Background(), d, a)
				defer r.Close()
				dir, _ := filepath.EvalSymlinks(t.TempDir())
				sourcePath = filepath.Join(dir, "auth.json")
				rawSource := desktopOtherCodexFixture(t)
				if platform == "claude" {
					sourcePath = filepath.Join(dir, ".credentials.json")
					rawSource = claudeSample(time.Now().Add(time.Hour))
				}
				if e := os.WriteFile(sourcePath, rawSource, 0600); e != nil {
					t.Fatal(e)
				}
				session, release, e := d.acquireSession(context.Background())
				if e != nil {
					t.Fatal(e)
				}
				state, e := session.read()
				if e != nil {
					t.Fatal(e)
				}
				_, e = a.selectionScope(session, state, func(s *desktopAccountScope) error {
					s.Selections[platform] = desktopAccountSelection{Source: DesktopAccountSource{Directory: &dir, Store: "file"}, Fingerprint: old, CredentialRevision: rev, Generation: 3, Revision: 1}
					return nil
				})
				release()
				if e != nil {
					t.Fatal(e)
				}
				statePath = filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
				defer os.Chmod(filepath.Dir(statePath), 0700)
				_, e = a.Snapshot(context.Background(), platform, true)
				if e != nil {
					t.Fatal(e)
				}
				candidate, e := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: platform, Directory: &dir, Store: "file", Mode: "local"})
				if e != nil {
					t.Fatal(e)
				}
				_, e = a.Action(context.Background(), DesktopAccountActionRequest{Platform: platform, Revision: candidate.Revision, CandidateRef: *candidate.Candidate.Reference, Action: "confirm_change", Confirmed: true})
				if e != nil {
					t.Fatal(e)
				}
				if scenario == "stop_before_connection" {
					select {
					case <-pauseReady:
					case <-time.After(3 * time.Second):
						t.Fatal("pause not reached")
					}
					snap, e := r.Snapshot(context.Background())
					if e != nil {
						t.Fatal(e)
					}
					if _, e = r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: snap.Revision, Reason: "user_stop"}); e != nil {
						t.Fatal(e)
					}
					deadline := time.Now().Add(3 * time.Second)
					for {
						snap, e = r.Snapshot(context.Background())
						if e != nil {
							t.Fatal(e)
						}
						if snap.Operation.State == "succeeded" {
							break
						}
						if time.Now().After(deadline) {
							t.Fatalf("stop stalled: %+v", snap)
						}
						time.Sleep(time.Millisecond)
					}
					if snap.StopReceipt == nil || !snap.StopReceipt.WorkersStopped {
						t.Fatal("stop did not join workers")
					}
					pauseOnce.Do(func() { close(pauseRelease) })
				}
				result := waitSelection(t, a, platform)
				wantSuccess := scenario == "success" || scenario == "lost_confirm"
				if (result.Operation.State == "succeeded") != wantSuccess {
					t.Fatalf("scenario=%s operation=%+v", scenario, result.Operation)
				}
				mu.Lock()
				before := confirms
				resumeCount := resumes
				registrationCount := registrations
				registeredFingerprint := account.AccountFingerprint
				restore := saveBlocked
				mu.Unlock()
				if resumeCount != 0 {
					t.Fatal("account change resumed contribution")
				}
				if wantSuccess && (before != 1 || registrationCount < 2 || result.Selection.Fingerprint == nil || *result.Selection.Fingerprint != registeredFingerprint) {
					t.Fatalf("switch incomplete: confirms=%d reports=%d selection=%+v", before, registrationCount, result.Selection)
				}
				if scenario == "pending_changed" || scenario == "pause_failed" || scenario == "confirm_not_submitted" {
					if before != 0 {
						t.Fatal("unverified candidate/pause still confirmed")
					}
				}
				if restore {
					if e := os.Chmod(filepath.Dir(statePath), 0700); e != nil {
						t.Fatal(e)
					}
				}
				if scenario == "save_failed" {
					raw, e := os.ReadFile(sourcePath)
					if e != nil {
						t.Fatal(e)
					}
					raw = []byte(strings.ReplaceAll(strings.ReplaceAll(string(raw), "c3ludGhldGlj", "cmVuZXdlZA"), "synthetic-claude-access", "synthetic-claude-renewed"))
					if e = os.WriteFile(sourcePath, raw, 0600); e != nil {
						t.Fatal(e)
					}
				}
				if scenario == "restart_reconcile" {
					snap, err := r.Snapshot(context.Background())
					if err != nil {
						t.Fatal(err)
					}
					if _, err = r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: snap.Revision, Reason: "app_exit"}); err != nil {
						t.Fatal(err)
					}
					waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool {
						return s.Local == "stopped" && s.StopReceipt != nil && s.StopReceipt.SessionClean
					})
					r.Close()
					a.Close()
					transport := a.transport
					a = NewDesktopAccounts(d)
					a.transport = transport
					defer a.Close()
					r = NewDesktopRuntime(context.Background(), d, a)
					defer r.Close()
				}
				for i := 0; i < 2; i++ {
					_, e = a.Snapshot(context.Background(), platform, true)
					if e != nil {
						t.Fatal(e)
					}
					if result.Operation.State == "reconciling" {
						result = waitSelection(t, a, platform)
					}
				}
				mu.Lock()
				after := confirms
				dialCount := dials
				mu.Unlock()
				if scenario == "stop_before_connection" && (after != 0 || dialCount != 0) {
					t.Fatalf("stopped account action restarted: confirms=%d dials=%d", after, dialCount)
				}
				if (scenario == "committed_token_revision" || scenario == "restart_reconcile" || restore) && result.Operation.State != "succeeded" {
					t.Fatalf("account change cannot reconcile: operation=%+v error=%+v", result.Operation, result.Operation.Error)
				}
				if after != before {
					t.Fatalf("unknown confirmation repeated POST: before=%d after=%d", before, after)
				}
				if scenario == "confirm_not_submitted" {
					if result.Operation.Error == nil || result.Operation.Error.Code != "confirmation_not_submitted" {
						t.Fatalf("no structured explicit-continuation evidence: %+v", result.Operation)
					}
					_, err := a.Action(context.Background(), DesktopAccountActionRequest{Platform: platform, Revision: result.Revision, CandidateRef: *result.Candidate.Reference, Action: "confirm_change", Confirmed: true})
					if err != nil {
						t.Fatal(err)
					}
					result = waitSelection(t, a, platform)
					if result.Operation.State != "succeeded" {
						t.Fatalf("explicit continuation failed: %+v", result.Operation)
					}
					mu.Lock()
					count := confirms
					mu.Unlock()
					if count != 1 {
						t.Fatalf("explicit continuation confirms=%d", count)
					}
				}
				runtime, _ := r.Snapshot(context.Background())
				if runtime.Local != "stopped" {
					t.Fatalf("account change started contribution: local=%s", runtime.Local)
				}
				disk, e := readDesktopAccountState(statePath)
				if e != nil {
					t.Fatal(e)
				}
				for _, scope := range disk.Scopes {
					if scope.RuntimeIntent.Running {
						t.Fatal("account change changed stopped intent")
					}
				}
			})
		}
	}
}

func TestDesktopAccountSwitchConnectionOwnership(t *testing.T) {
	for _, scenario := range []string{"conflict", "no_relay", "close"} {
		t.Run(scenario, func(t *testing.T) {
			var dials atomic.Int32
			peer := make(chan *relay.Session, 1)
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if q.URL.Path != "/api/bee/agent" {
					t.Errorf("unexpected request %s", q.URL.Path)
					w.WriteHeader(404)
					return
				}
				dials.Add(1)
				if scenario == "conflict" {
					w.WriteHeader(409)
					return
				}
				w.Header().Set("X-Bee-Lease", "owned-control-lease")
				conn, err := websocket.Accept(w, q, nil)
				if err != nil {
					return
				}
				live := relay.New(q.Context(), conn, tunnel.High, nil, relay.Options{})
				peer <- live
				<-live.Context.Done()
				live.Close()
				live.Wait()
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			session, release, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			state, err := session.read()
			if err != nil {
				t.Fatal(err)
			}
			entered, finish := make(chan struct{}), make(chan struct{})
			var finishOnce sync.Once
			defer finishOnce.Do(func() { close(finish) })
			done := make(chan error, 1)
			go func() {
				done <- r.withAccountConnection(context.Background(), session, state, func(ctx context.Context, lease string) error {
					if lease != "owned-control-lease" {
						t.Errorf("unexpected lease")
					}
					close(entered)
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-finish:
						return nil
					}
				})
			}()
			if scenario != "conflict" {
				select {
				case <-entered:
				case <-time.After(3 * time.Second):
					t.Fatal("account connection absent")
				}
				if err := r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1}); err == nil {
					t.Fatal("network changed during account connection")
				}
				if scenario == "no_relay" {
					live := <-peer
					stream, err := live.Mux.Dial([]byte(`{"host":"chatgpt.com:443"}`))
					if err != nil {
						t.Fatal(err)
					}
					blocked := make(chan error, 1)
					go func() { defer stream.Close(); var b [1]byte; _, err := stream.Read(b[:]); blocked <- err }()
					select {
					case err := <-blocked:
						if err == nil {
							t.Fatal("temporary account connection forwarded relay")
						}
					case <-time.After(3 * time.Second):
						stream.Close()
						t.Fatal("relay target was not rejected")
					}
					finishOnce.Do(func() { close(finish) })
				} else {
					r.Close()
				}
			}
			select {
			case err := <-done:
				if (err == nil) != (scenario == "no_relay") {
					t.Fatalf("scenario=%s error=%v", scenario, err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("owned connection did not finish")
			}
			if dials.Load() != 1 {
				t.Fatalf("unexpected reconnects: %d", dials.Load())
			}
		})
	}
}
