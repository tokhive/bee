package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/tokhive/bee/beewire"
)

func TestClaudeRuntimeSynchronizesOnlyVerifiedCurrentAccessToken(t *testing.T) {
	for _, scenario := range []string{"ready", "upload_retry", "changed_before_upload", "expired_before_upload", "wrong_task_platform", "wrong_task_revision", "wrong_recipient", "profile_failure", "source_missing"} {
		t.Run(scenario, func(t *testing.T) {
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			inbox, _ := tee.GenerateInboxKey()
			pub := inbox.Public()
			identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
			revision := sha256.Sum256([]byte(credential.secret.Token))
			task := beewire.MaintenanceTask{ID: "claude-task", Kind: "reencrypt_authorization", DeviceID: "device", Platform: "claude", AccountFingerprint: identity.fingerprint(), AccountGeneration: 1, CredentialRevision: hex.EncodeToString(revision[:]), KeyVersion: 1, Key: pub}
			switch scenario {
			case "wrong_task_platform":
				task.Platform = "openai"
			case "wrong_task_revision":
				task.CredentialRevision = strings.Repeat("f", 64)
			case "wrong_recipient":
				other, _ := tee.GenerateInboxKey()
				task.Key = other.Public()
			}
			var uploads, stops atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer bee-test" {
					t.Error("device authentication missing")
				}
				switch r.URL.Path {
				case "/api/bee/platforms/claude/account":
					json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Generation: 1, CredentialRevision: hex.EncodeToString(revision[:])})
				case "/api/bee/platforms/claude/account/source":
					stops.Add(1)
					io.WriteString(w, `{}`)
				case "/api/bee/maintenance":
					body, _ := io.ReadAll(r.Body)
					var input beewire.MaintenanceRequest
					if json.Unmarshal(body, &input) != nil || input.Claude == nil || input.Codex != (beewire.Authorization{}) || input.Lease != "lease" || input.Claude.AccountID != identity.organization || input.Claude.AccountFingerprint != identity.fingerprint() || bytes.Contains(body, []byte("synthetic-claude-")) {
						t.Error("maintenance metadata mixed platforms or exposed tokens")
					}
					json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "claude", Generation: 1, Status: "source_unavailable"}, Task: &task})
				case "/api/bee/credential-key":
					json.NewEncoder(w).Encode(pub)
				case "/api/bee/credentials":
					body, _ := io.ReadAll(r.Body)
					var input beewire.CredentialRegistration
					if json.Unmarshal(body, &input) != nil || input.Claude == nil || input.Codex != nil || input.TaskID != task.ID || bytes.Contains(body, []byte("synthetic-claude-")) {
						t.Error("credential upload mixed platforms or exposed tokens")
					}
					opened, provider, err := inbox.Open(input.Envelope)
					if err != nil || opened.Token != "synthetic-claude-access" || provider != beewire.ProviderID("device") {
						t.Error("envelope did not contain expected access-only secret")
					}
					count := uploads.Add(1)
					if scenario == "upload_retry" && count == 1 {
						w.WriteHeader(503)
						return
					}
					json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
				default:
					t.Error("unexpected Hive request", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			reads, profiles := 0, 0
			source := &claudeSource{Store: "keychain", read: func(context.Context) (claudeCredential, error) {
				reads++
				if scenario == "source_missing" {
					return claudeCredential{}, errClaudeKeychainMissing
				}
				if reads == 3 {
					if scenario == "changed_before_upload" {
						credential.secret.Token = "synthetic-new-access"
					}
					if scenario == "expired_before_upload" {
						credential.expiresAt = time.Now().Add(-time.Hour)
					}
				}
				return credential, nil
			}, transport: claudeTransport(func(r *http.Request) (*http.Response, error) {
				profiles++
				if r.URL.String() != "https://api.anthropic.com/api/oauth/profile" {
					t.Fatal("nonofficial profile endpoint")
				}
				if scenario == "profile_failure" {
					return claudeProfileResponse(429, "synthetic-private-error"), nil
				}
				return claudeProfileResponse(200, claudeTestProfile), nil
			})}
			state := localState{Hive: server.URL, Credential: "bee-test", Identity: &beewire.Identity{ID: "device"}}
			var output bytes.Buffer
			err := source.synchronize(context.Background(), state, "lease", &output, true)
			if scenario == "upload_retry" {
				if err == nil {
					t.Fatal("upload error hidden")
				}
				err = source.synchronize(context.Background(), state, "lease", &output, false)
			}
			switch scenario {
			case "ready", "upload_retry":
				want := int32(1)
				if scenario == "upload_retry" {
					want = 2
				}
				if err != nil || uploads.Load() != want || profiles != 1 || stops.Load() != 0 {
					t.Fatal("synchronization/cache/retry failed", err, uploads.Load(), profiles, stops.Load())
				}
			case "wrong_task_platform", "wrong_task_revision", "wrong_recipient":
				if err == nil || uploads.Load() != 0 {
					t.Fatal("invalid task/key was accepted")
				}
			default:
				if err != nil || uploads.Load() != 0 || stops.Load() != 1 {
					t.Fatal("invalid source was not stopped", err)
				}
			}
			if strings.Contains(output.String(), "synthetic-") {
				t.Fatal("status exposed credential or HTTP body")
			}
		})
	}
}

func TestClaudeRuntimeRevalidatesIdentityOnTokenChangeAndCacheExpiry(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	profile := claudeTestProfile
	queries := 0
	source := claudeSource{read: func(context.Context) (claudeCredential, error) { return credential, nil }, transport: claudeTransport(func(*http.Request) (*http.Response, error) {
		queries++
		return claudeProfileResponse(200, profile), nil
	})}
	_, first, err := source.authorization(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, same, err := source.authorization(context.Background())
	if err != nil || queries != 1 || same != first {
		t.Fatal("stable source was not cached")
	}
	credential.secret.Token = "synthetic-renewed-token"
	_, renewed, err := source.authorization(context.Background())
	if err != nil || queries != 2 || renewed.AccountFingerprint != first.AccountFingerprint || renewed.CredentialRevision == first.CredentialRevision {
		t.Fatal("renewal not verified or treated as account change")
	}
	profile = strings.ReplaceAll(profile, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333")
	source.verifiedAt = time.Now().Add(-6 * time.Minute)
	_, changed, err := source.authorization(context.Background())
	if err != nil || queries != 3 || changed.AccountFingerprint == first.AccountFingerprint {
		t.Fatal("expired identity cache remained trusted")
	}
	source.transport = claudeTransport(func(*http.Request) (*http.Response, error) { queries++; return nil, errors.New("synthetic-secret") })
	source.verifiedAt = time.Time{}
	if _, _, err = source.authorization(context.Background()); err == nil {
		t.Fatal("failed profile was accepted")
	}
	if _, _, err = source.authorization(context.Background()); err == nil || queries != 4 {
		t.Fatal("failed profile was retried without backoff")
	}
}

func TestClaudeRuntimeConfigurationAndIndependentWorkers(t *testing.T) {
	for _, test := range []struct {
		name, claude string
		static       bool
		valid        bool
	}{
		{"claude only", `{"store":"keychain"}`, false, true},
		{"refresh enabled", `{"store":"keychain","refresh":true}`, false, true},
		{"missing store", `{}`, false, false},
		{"file fallback", `{"store":"file"}`, false, false},
		{"static mixed", `{"store":"keychain"}`, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := map[string]any{"targets": []string{"api.anthropic.com:443"}, "claude": json.RawMessage(test.claude)}
			if test.static {
				cfg["credential"] = tee.Secret{Token: "synthetic-static", Header: "authorization", Scheme: "Bearer"}
			}
			raw, _ := json.Marshal(cfg)
			path := filepath.Join(t.TempDir(), "egress.json")
			if os.WriteFile(path, raw, 0600) != nil {
				t.Fatal("write fixture")
			}
			_, err := readEgress(context.Background(), path)
			if (err == nil) != test.valid {
				t.Fatal("configuration validation", err)
			}
		})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	blocked := make(chan struct{})
	var openaiPolls atomic.Int32
	claudeStarted := make(chan struct{}, 1)
	openaiStarted := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/platforms/claude/account" {
			select {
			case claudeStarted <- struct{}{}:
			default:
			}
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude"})
			return
		}
		if r.URL.Path == "/api/bee/platforms/openai/account" {
			openaiPolls.Add(1)
			select {
			case openaiStarted <- struct{}{}:
			default:
			}
		}
		io.WriteString(w, `{}`)
	}))
	defer server.Close()
	cfg := egressConfig{Codex: &codexSource{Home: t.TempDir(), Store: "file"}, Claude: &claudeSource{read: func(ctx context.Context) (claudeCredential, error) {
		select {
		case <-blocked:
		default:
			close(blocked)
		}
		<-ctx.Done()
		return claudeCredential{}, ctx.Err()
	}}}
	_, wait := cfg.startSynchronization(ctx, localState{Hive: server.URL, Credential: "bee-test"}, "lease", io.Discard)
	select {
	case <-blocked:
	case <-ctx.Done():
		t.Fatal("Claude source never started")
	}
	select {
	case <-openaiStarted:
	case <-time.After(time.Second):
		t.Fatal("OpenAI synchronization did not start while Claude was blocked")
	}
	deadline := time.Now().Add(5 * time.Second)
	for openaiPolls.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	wait()
	if openaiPolls.Load() < 2 {
		t.Fatal("blocked Claude source stopped OpenAI synchronization")
	}
}
