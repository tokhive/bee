package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/tokhive/bee/beewire"
)

type claudeMemoryStore struct {
	mu     sync.Mutex
	raw    []byte
	writes int
}

func (s *claudeMemoryStore) read(context.Context) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return bytes.Clone(s.raw), nil
}

func (s *claudeMemoryStore) write(_ context.Context, raw []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.raw = bytes.Clone(raw)
	s.writes++
	return nil
}

func (s *claudeMemoryStore) mutate(t *testing.T, change func(map[string]any)) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var value map[string]any
	if json.Unmarshal(s.raw, &value) != nil {
		t.Fatal("invalid synthetic credential")
	}
	change(value)
	s.raw, _ = json.Marshal(value)
}

func claudeRefreshFixture(t *testing.T) (*claudeMaintenance, *claudeMemoryStore, beewire.MaintenanceTask, beewire.Authorization) {
	t.Helper()
	store := &claudeMemoryStore{raw: claudeSample(time.Now().Add(time.Minute))}
	store.mutate(t, func(value map[string]any) {
		value["unrelated"] = "preserved"
		delete(value["claudeAiOauth"].(map[string]any), "clientId")
	})
	m := &claudeMaintenance{directory: t.TempDir(), namespace: "synthetic-keychain", readRaw: store.read, writeRaw: store.write}
	key, _ := tee.GenerateInboxKey()
	identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
	current, err := m.read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	auth := current.metadata(identity)
	if err = m.remember(context.Background(), current.claudeCredential, auth); err != nil {
		t.Fatal(err)
	}
	task := beewire.MaintenanceTask{ID: "claude-refresh-task", Kind: "refresh_authorization", Platform: "claude", DeviceID: "device", AccountGeneration: 1, AccountFingerprint: identity.fingerprint(), CredentialRevision: auth.CredentialRevision, KeyVersion: 1, Key: key.Public()}
	clear(current.raw)
	return m, store, task, auth
}

const claudeRefreshResponse = `{"access_token":"synthetic-claude-new-access","refresh_token":"synthetic-claude-new-refresh","expires_in":3600,"refresh_token_expires_in":86400,"scope":"user:inference user:profile","token_type":"Bearer"}`

func TestClaudeRefreshDurableSaveAndFailureRecovery(t *testing.T) {
	for _, scenario := range []string{"success", "custom_client", "no_rotated_refresh", "response_lost", "save_failure", "write_then_error", "official_updated", "unrelated_updated", "identity_changed", "lock_replaced", "oversized_store", "invalid_scope", "invalid_expiry", "empty_refresh", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			m, store, task, auth := claudeRefreshFixture(t)
			clientID := "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
			if scenario == "custom_client" {
				clientID = "synthetic-custom-client"
				store.mutate(t, func(value map[string]any) { value["claudeAiOauth"].(map[string]any)["clientId"] = clientID })
			}
			var refreshes atomic.Int32
			m.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() == "https://api.anthropic.com/api/oauth/profile" {
					if r.Header.Get("Authorization") != "Bearer synthetic-claude-new-access" {
						t.Error("wrong profile credential")
					}
					profile := claudeTestProfile
					if scenario == "identity_changed" {
						profile = strings.ReplaceAll(profile, "22222222", "33333333")
					}
					return claudeProfileResponse(200, profile), nil
				}
				refreshes.Add(1)
				var input map[string]string
				if r.URL.String() != "https://platform.claude.com/v1/oauth/token" || r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Authorization") != "" || json.NewDecoder(r.Body).Decode(&input) != nil || input["grant_type"] != "refresh_token" || input["refresh_token"] != "synthetic-claude-refresh" || input["client_id"] != clientID || !strings.Contains(input["scope"], "user:inference") {
					t.Error("invalid refresh grant")
				}
				if scenario == "response_lost" {
					return nil, errors.New("synthetic response lost")
				}
				if scenario == "redirect" {
					response := claudeProfileResponse(302, "")
					response.Header.Set("Location", "https://other.example/secret")
					return response, nil
				}
				if scenario == "official_updated" {
					store.mutate(t, func(value map[string]any) {
						oauth := value["claudeAiOauth"].(map[string]any)
						oauth["accessToken"], oauth["refreshToken"] = "official-access", "official-refresh"
					})
				}
				if scenario == "unrelated_updated" {
					store.mutate(t, func(value map[string]any) { value["unrelated"] = "newer-value" })
				}
				if scenario == "lock_replaced" {
					path := filepath.Join(m.directory, ".oauth_refresh.lock")
					if os.Rename(path, path+".old") != nil || os.Mkdir(path, 0700) != nil {
						t.Error("cannot replace synthetic lock")
					}
				}
				body := claudeRefreshResponse
				if scenario == "no_rotated_refresh" {
					body = strings.Replace(body, `"refresh_token":"synthetic-claude-new-refresh",`, "", 1)
				}
				if scenario == "invalid_scope" {
					body = strings.Replace(body, "user:inference user:profile", "user:profile", 1)
				}
				if scenario == "invalid_expiry" {
					body = strings.Replace(body, `"expires_in":3600`, `"expires_in":30`, 1)
				}
				if scenario == "empty_refresh" {
					body = strings.Replace(body, "synthetic-claude-new-refresh", "", 1)
				}
				return claudeProfileResponse(200, body), nil
			})
			m.writeRaw = func(ctx context.Context, raw []byte) error {
				if _, err := os.Stat(filepath.Join(m.directory, ".storage-write.lock")); err != nil {
					t.Error("write outside official storage lock")
				}
				if scenario == "save_failure" {
					return errRefreshRecovery
				}
				err := store.write(ctx, raw)
				if scenario == "write_then_error" {
					return errRefreshRecovery
				}
				return err
			}
			if scenario == "oversized_store" {
				m.validateWrite = func([]byte) error { return errRefreshRecovery }
			}
			credential, identity, err := m.execute(context.Background(), task, auth)
			success := scenario == "success" || scenario == "custom_client" || scenario == "no_rotated_refresh" || scenario == "unrelated_updated"
			if success {
				if err != nil || credential.secret.Token != "synthetic-claude-new-access" || identity.fingerprint() != task.AccountFingerprint {
					t.Fatal("refresh failed", err)
				}
				_, binding, err := m.binding(context.Background())
				if err != nil || binding.CredentialRevision != claudeDigest(credential.secret.Token) {
					t.Fatal("new identity binding not persisted")
				}
			} else if err == nil {
				t.Fatal("unsafe refresh accepted", scenario)
			}
			current, _ := m.read(context.Background())
			defer clear(current.raw)
			if scenario == "custom_client" && current.client != clientID {
				t.Fatal("lost custom client ID")
			}
			if scenario == "official_updated" && current.secret.Token != "official-access" {
				t.Fatal("overwrote official update")
			}
			if success || scenario == "write_then_error" {
				wantRefresh := "synthetic-claude-new-refresh"
				if scenario == "no_rotated_refresh" {
					wantRefresh = "synthetic-claude-refresh"
				}
				if current.refresh != wantRefresh || !bytes.Contains(current.raw, []byte(`"unrelated"`)) {
					t.Fatal("lost refresh token or unrelated data")
				}
				if scenario == "unrelated_updated" && !bytes.Contains(current.raw, []byte("newer-value")) {
					t.Fatal("overwrote unrelated concurrent update")
				}
			} else if store.writes != 0 {
				t.Fatal("unexpected write")
			}
			// Recreate the worker as after a process restart; no second use of the old grant.
			restarted := *m
			if _, _, err := restarted.execute(context.Background(), task, auth); err == nil {
				t.Fatal("old task replay accepted")
			}
			want := int32(1)
			if scenario == "oversized_store" {
				want = 0
			}
			if refreshes.Load() != want {
				t.Fatal("refresh grant repeated", refreshes.Load())
			}
			for _, kind := range []string{"binding", "maintenance"} {
				raw, _ := os.ReadFile(m.path(kind))
				if bytes.Contains(raw, []byte("synthetic-claude-")) {
					t.Fatal("journal contains token")
				}
			}
			if scenario == "lock_replaced" {
				if _, err := os.Stat(filepath.Join(m.directory, ".oauth_refresh.lock")); err != nil {
					t.Fatal("released successor lock")
				}
			}
		})
	}
}

func TestClaudeRefreshConcurrentWorkersDoNotRepeatGrant(t *testing.T) {
	m, _, task, auth := claudeRefreshFixture(t)
	arrived, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	m.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "api.anthropic.com" {
			return claudeProfileResponse(200, claudeTestProfile), nil
		}
		calls.Add(1)
		close(arrived)
		<-release
		return claudeProfileResponse(200, claudeRefreshResponse), nil
	})
	done := make(chan error, 1)
	go func() { _, _, err := m.execute(context.Background(), task, auth); done <- err }()
	select {
	case <-arrived:
	case err := <-done:
		t.Fatal("refresh did not reach OAuth", err)
	case <-time.After(5 * time.Second):
		t.Fatal("refresh did not start")
	}
	other := *m
	_, _, err := other.execute(context.Background(), task, auth)
	close(release)
	if !errors.Is(err, errClaudeLock) {
		t.Fatal("concurrent worker did not honor refresh lock", err)
	}
	if err := <-done; err != nil || calls.Load() != 1 {
		t.Fatal("concurrent refresh", err, calls.Load())
	}
}

func TestClaudeMaintenanceBindingRejectsUnverifiedSourceChanges(t *testing.T) {
	for _, field := range []string{"unchanged_expired", "accessToken", "refreshToken", "expiresAt"} {
		t.Run(field, func(t *testing.T) {
			m, store, _, _ := claudeRefreshFixture(t)
			if field == "unchanged_expired" {
				store.mutate(t, func(value map[string]any) {
					value["claudeAiOauth"].(map[string]any)["expiresAt"] = time.Now().Add(-time.Hour).UnixMilli()
				})
				current, _ := m.read(context.Background())
				identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
				if err := m.remember(context.Background(), current.claudeCredential, current.metadata(identity)); err != nil {
					t.Fatal(err)
				}
			} else {
				store.mutate(t, func(value map[string]any) {
					oauth := value["claudeAiOauth"].(map[string]any)
					if field == "expiresAt" {
						oauth[field] = time.Now().Add(time.Hour).UnixMilli()
					} else {
						oauth[field] = "changed"
					}
				})
			}
			_, _, err := m.binding(context.Background())
			if (err == nil) != (field == "unchanged_expired") {
				t.Fatal("invalid maintenance identity binding", err)
			}
		})
	}
}

func TestClaudeKeychainWriteUsesBoundedHexInput(t *testing.T) {
	source := claudeKeychain{service: "Claude Code-credentials", account: "synthetic-user"}
	raw := []byte(`{"claudeAiOauth":{"accessToken":"quotes\" and newline\n"}}`)
	command, err := source.writeCommand(raw)
	if err != nil || strings.Contains(command, "accessToken") || strings.Count(command, "\n") != 1 || !strings.Contains(command, " -X ") {
		t.Fatal("unsafe security input", err)
	}
	if _, err := source.writeCommand([]byte(`{"large":"` + strings.Repeat("a", 3000) + `"}`)); err == nil {
		t.Fatal("oversized secret would enter argv")
	}
	source.service = "Claude Code-credentials\"\ndelete-keychain"
	if _, err := source.writeCommand(raw); err == nil {
		t.Fatal("injected keychain command")
	}
}

func TestClaudeRefreshRejectsInvalidRecipientBeforeOAuth(t *testing.T) {
	m, _, task, auth := claudeRefreshFixture(t)
	task.Key.PublicKey = []byte("invalid")
	m.transport = claudeTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("OAuth before key validation")
		return nil, io.EOF
	})
	if _, _, err := m.execute(context.Background(), task, auth); err == nil {
		t.Fatal("invalid recipient accepted")
	}
}

func TestClaudeRuntimeRefreshAndUploadRetry(t *testing.T) {
	for _, scenario := range []string{"expiring", "expired", "profile_rejected", "upload_retry", "lock_busy"} {
		t.Run(scenario, func(t *testing.T) {
			m, store, task, auth := claudeRefreshFixture(t)
			identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
			if scenario == "expired" || scenario == "profile_rejected" {
				expires := time.Now().Add(-time.Minute)
				if scenario == "profile_rejected" {
					expires = time.Now().Add(time.Hour)
				}
				store.mutate(t, func(value map[string]any) { value["claudeAiOauth"].(map[string]any)["expiresAt"] = expires.UnixMilli() })
				current, _ := m.read(context.Background())
				auth = current.metadata(identity)
				if err := m.remember(context.Background(), current.claudeCredential, auth); err != nil {
					t.Fatal(err)
				}
			}
			inbox, _ := tee.GenerateInboxKey()
			task.Key = inbox.Public()
			var refreshes, uploads atomic.Int32
			m.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "platform.claude.com" {
					refreshes.Add(1)
					return claudeProfileResponse(200, claudeRefreshResponse), nil
				}
				if scenario == "profile_rejected" && r.Header.Get("Authorization") == "Bearer synthetic-claude-access" {
					return claudeProfileResponse(401, "{}"), nil
				}
				return claudeProfileResponse(200, claudeTestProfile), nil
			})
			source := claudeSource{maintenance: m, transport: m.transport, read: func(ctx context.Context) (claudeCredential, error) {
				current, err := m.read(ctx)
				clear(current.raw)
				return current.claudeCredential, err
			}}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/bee/platforms/claude/account":
					json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Generation: 1, CredentialRevision: task.CredentialRevision})
				case "/api/bee/maintenance":
					var input beewire.MaintenanceRequest
					if json.NewDecoder(r.Body).Decode(&input) != nil || !input.RefreshSupported {
						t.Error("refresh capability missing")
					}
					if scenario == "profile_rejected" && uploads.Load() == 0 && !input.RefreshRequired {
						t.Error("profile rejection did not request maintenance")
					}
					next := task
					if input.Claude.CredentialRevision != auth.CredentialRevision {
						next.CredentialRevision, next.Kind, next.ID = input.Claude.CredentialRevision, "reencrypt_authorization", "new-recipient-task"
					}
					json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "claude", Generation: 1}, Task: &next})
				case "/api/bee/credential-key":
					json.NewEncoder(w).Encode(task.Key)
				case "/api/bee/credentials":
					var input beewire.CredentialRegistration
					body, _ := io.ReadAll(r.Body)
					if json.Unmarshal(body, &input) != nil || input.Claude == nil || bytes.Contains(body, []byte("synthetic-claude-")) {
						t.Error("invalid or exposed credential upload")
					}
					opened, _, err := inbox.Open(input.Envelope)
					if err != nil || opened.Token != "synthetic-claude-new-access" {
						t.Error("incorrect refreshed access envelope")
					}
					current, _ := m.read(r.Context())
					if current.refresh != "synthetic-claude-new-refresh" || current.secret.Token != opened.Token || store.writes != 1 {
						t.Error("upload before durable save")
					}
					if uploads.Add(1) == 1 && scenario == "upload_retry" {
						w.WriteHeader(503)
						return
					}
					json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
				default:
					t.Error("unexpected Hive operation", r.URL.Path)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			state := localState{Hive: server.URL, Credential: "synthetic-bee", Identity: &beewire.Identity{ID: "device"}}
			var out bytes.Buffer
			if scenario == "lock_busy" {
				_, _, release, err := lockClaudeRefresh(context.Background(), m.directory)
				if err != nil {
					t.Fatal(err)
				}
				for range 5 {
					if err := source.synchronize(context.Background(), state, "lease", &out, false); !errors.Is(err, errClaudeLock) {
						t.Error("busy refresh invalidated source or task", err)
					}
				}
				release()
				if refreshes.Load() != 0 || uploads.Load() != 0 {
					t.Fatal("busy refresh used OAuth or uploaded")
				}
			}
			err := source.synchronize(context.Background(), state, "lease", &out, true)
			if scenario == "upload_retry" {
				if err == nil {
					t.Fatal("unconfirmed upload treated as successful")
				}
				err = source.synchronize(context.Background(), state, "lease", &out, false)
			}
			want := int32(1)
			if scenario == "upload_retry" {
				want = 2
			}
			if err != nil || refreshes.Load() != 1 || uploads.Load() != want || bytes.Contains(out.Bytes(), []byte("synthetic-claude-")) {
				t.Fatal("runtime refresh/retry failed", err, refreshes.Load(), uploads.Load())
			}
		})
	}
}

// The binding is rewritten on every cycle, and each rewrite used to cost a
// second read of the credential store — a keychain subprocess, twice every
// two seconds, for an authorization that changes perhaps daily.
func TestRememberReadsTheStoreOnlyWhenTheAuthorizationChanges(t *testing.T) {
	raw := claudeSample(time.Now().Add(time.Hour))
	store := &claudeMemoryStore{raw: raw}
	credential, _ := parseClaudeCredential(raw)
	reads := 0
	m := &claudeMaintenance{directory: t.TempDir(), namespace: "synthetic-keychain", writeRaw: store.write,
		readRaw: func(ctx context.Context) ([]byte, error) {
			reads++
			return store.read(ctx)
		}}
	auth := beewire.Authorization{AccountID: "org", AccountFingerprint: "abc", CredentialRevision: claudeDigest(credential.secret.Token), ExpiresAt: credential.expiresAt}

	for range 30 {
		if err := m.remember(context.Background(), credential, auth); err != nil {
			t.Fatal(err)
		}
	}
	if reads != 1 {
		t.Fatalf("unchanged authorization read the store %d times", reads)
	}

	// A different authorization is written through, not assumed.
	changed := auth
	changed.CredentialRevision = claudeDigest("synthetic-other-access")
	if err := m.remember(context.Background(), credential, changed); err != nil {
		t.Fatal(err)
	}
	if reads != 2 {
		t.Fatalf("changed authorization did not reach the store: %d reads", reads)
	}

	// And the trust is bounded in time, so a store that changed underneath a
	// stable access token is re-read rather than assumed forever.
	m.rememberedAt = time.Now().Add(-rememberInterval - time.Second)
	if err := m.remember(context.Background(), credential, changed); err != nil {
		t.Fatal(err)
	}
	if reads != 3 {
		t.Fatalf("interval did not expire: %d reads", reads)
	}
}
