package bee_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
	"github.com/tokhive/tee/tee"
	"github.com/tokhive/tee/tunnel"
)

type maintenanceTransport struct {
	local http.RoundTripper
	oauth string
}

func (t maintenanceTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host == "auth.openai.com" {
		clone := r.Clone(r.Context())
		clone.URL.Host = strings.TrimPrefix(t.oauth, "https://")
		clone.Host = clone.URL.Host
		return t.local.RoundTrip(clone)
	}
	return t.local.RoundTrip(r)
}

func TestCodexMaintenanceRefreshPersistsBeforeUploadAndSurvivesRetry(t *testing.T) {
	for _, scenario := range []string{"upload_retry", "reencrypt", "expired", "response_lost", "official_updated", "account_changed", "partial_write", "save_failure", "concurrent_bees", "key_rotates_on_upload", "expires_on_upload"} {
		t.Run(scenario, func(t *testing.T) { testCodexMaintenance(t, scenario) })
	}
}

func testCodexMaintenance(t *testing.T, scenario string) {
	directory := t.TempDir()
	sample := codexSample(time.Now().Add(time.Minute))
	if scenario == "expired" {
		sample = codexSample(time.Now().Add(-time.Minute))
	}
	sample["preserved"] = map[string]any{"value": "unrelated"}
	raw, _ := json.Marshal(sample)
	authPath := filepath.Join(directory, "auth.json")
	if err := os.WriteFile(authPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	fresh := codexSample(time.Now().Add(time.Hour))
	freshTokens := fresh["tokens"].(map[string]any)
	freshTokens["refresh_token"] = "rotated-refresh-secret"
	expectedTokens := freshTokens
	if scenario == "reencrypt" {
		expectedTokens = sample["tokens"].(map[string]any)
	}
	blocked := scenario == "response_lost" || scenario == "account_changed" || scenario == "partial_write" || scenario == "save_failure"
	defer os.Chmod(directory, 0700)
	var refreshes, uploads atomic.Int32
	oauth := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshes.Add(1)
		var body map[string]string
		if r.TLS == nil || r.URL.Path != "/oauth/token" || json.NewDecoder(r.Body).Decode(&body) != nil || body["refresh_token"] != "synthetic-refresh-secret" || body["grant_type"] != "refresh_token" || body["client_id"] != "app_EMoamEEZ73f0CkXaXp7hrann" {
			t.Error("invalid OAuth refresh request")
		}
		if version := r.Header.Get("Version"); r.Header.Get("Originator") != "codex_cli_rs" || version == "" || r.Header.Get("User-Agent") != "codex_cli_rs/"+version+" (Ubuntu 22.4.0; x86_64) xterm-256color" {
			t.Error("OAuth refresh sent without the complete Codex client identity", r.Header.Get("Originator"), version, r.Header.Get("User-Agent"))
		}
		if scenario == "response_lost" {
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		if scenario == "official_updated" || scenario == "account_changed" {
			updated := codexSample(time.Now().Add(2 * time.Hour))
			updated["preserved"] = sample["preserved"]
			if scenario == "account_changed" {
				updated["tokens"].(map[string]any)["account_id"] = "different-account"
			}
			encoded, _ := json.Marshal(updated)
			if os.WriteFile(authPath, encoded, 0600) != nil {
				t.Error("official update failed")
			}
			if scenario == "official_updated" {
				w.WriteHeader(401)
				return
			}
		}
		if scenario == "partial_write" {
			os.WriteFile(authPath, []byte(`{"tokens":`), 0600)
		}
		if scenario == "save_failure" {
			if os.Chmod(directory, 0500) != nil {
				t.Error("write failure fixture unavailable")
			}
		}
		if scenario == "concurrent_bees" {
			time.Sleep(150 * time.Millisecond)
		}
		json.NewEncoder(w).Encode(freshTokens)
	}))
	defer oauth.Close()
	original := http.DefaultTransport
	http.DefaultTransport = maintenanceTransport{local: oauth.Client().Transport, oauth: oauth.URL}
	defer func() { http.DefaultTransport = original }()
	inbox, _ := tee.GenerateInboxKey()
	pub := inbox.Public()
	var currentInbox atomic.Pointer[tee.InboxKey]
	currentInbox.Store(inbox)
	revision := sha256.Sum256([]byte(sample["tokens"].(map[string]any)["access_token"].(string)))
	fingerprint := sha256.Sum256([]byte("synthetic-account\x00synthetic-user"))
	task := beewire.MaintenanceTask{ID: "maintenance-test", Kind: "refresh_authorization", DeviceID: "device", Platform: "openai", AccountFingerprint: hex.EncodeToString(fingerprint[:]), AccountGeneration: 1, CredentialRevision: hex.EncodeToString(revision[:]), KeyVersion: 1, Key: pub}
	if scenario == "reencrypt" {
		task.Kind = "reencrypt_authorization"
	}
	var currentTask atomic.Pointer[beewire.MaintenanceTask]
	currentTask.Store(&task)
	duration := 15 * time.Second
	if blocked {
		duration = 3 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		task := *currentTask.Load()
		switch r.URL.Path {
		case "/api/bee/agent":
			w.Header().Set("X-Bee-Lease", "test-lease")
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			live := relay.New(r.Context(), conn, tunnel.Low, nil, relay.Options{})
			defer live.Close()
			<-live.Context.Done()
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Generation: 1, CredentialRevision: task.CredentialRevision})
		case "/api/bee/maintenance":
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "openai", Generation: 1, Status: "ready", CredentialRevision: task.CredentialRevision}, Task: &task})
		case "/api/bee/credential-key":
			json.NewEncoder(w).Encode(task.Key)
		case "/api/bee/platforms/openai/account/source":
			json.NewEncoder(w).Encode(map[string]string{"status": "source_unavailable"})
		case "/api/bee/credentials":
			var input struct {
				Envelope tee.Envelope `json:"envelope"`
				TaskID   string       `json:"task_id"`
			}
			body, _ := io.ReadAll(r.Body)
			if bytes.Contains(body, []byte("refresh-secret")) {
				t.Error("refresh token uploaded to Hive")
			}
			if json.Unmarshal(body, &input) != nil || input.TaskID != task.ID {
				t.Error("task binding missing")
			}
			secret, _, err := currentInbox.Load().Open(input.Envelope)
			if err != nil || scenario != "official_updated" && secret.Token != expectedTokens["access_token"] {
				t.Error("TEE envelope contains wrong access token")
			}
			saved, _ := os.ReadFile(authPath)
			var disk map[string]any
			if json.Unmarshal(saved, &disk) != nil || scenario != "official_updated" && disk["tokens"].(map[string]any)["refresh_token"] != expectedTokens["refresh_token"] || disk["preserved"].(map[string]any)["value"] != "unrelated" {
				t.Error("upload occurred before durable credential save")
			}
			if scenario == "official_updated" && secret.Token != disk["tokens"].(map[string]any)["access_token"] {
				t.Error("official update was not used")
			}
			if uploads.Add(1) == 1 {
				if scenario == "key_rotates_on_upload" {
					next, _ := tee.GenerateInboxKey()
					currentInbox.Store(next)
					nextTask := task
					nextTask.ID, nextTask.Key, nextTask.KeyVersion, nextTask.Kind = "rotated-task", next.Public(), 2, "reencrypt_authorization"
					currentTask.Store(&nextTask)
					w.WriteHeader(409)
					json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "stale_maintenance"}})
					return
				}
				if scenario == "expires_on_upload" {
					w.WriteHeader(400)
					json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "invalid_codex_authorization"}})
					return
				}
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"account_generation": 1})
			cancel()
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	config, _ := json.Marshal(map[string]any{"hive": server.URL, "credential": "bee_" + strings.Repeat("a", 43), "identity": map[string]string{"id": "device"}})
	egress, _ := json.Marshal(map[string]any{"targets": []string{"chatgpt.com:443"}, "codex": map[string]string{"home": directory, "store": "file"}})
	if scenario == "reencrypt" {
		egress, _ = json.Marshal(map[string]any{"targets": []string{"chatgpt.com:443"}, "inbox_key_id": strings.Repeat("0", 64), "codex": map[string]string{"home": directory, "store": "file"}})
	}
	configPath, egressPath := filepath.Join(directory, "bee.json"), filepath.Join(directory, "egress.json")
	if os.WriteFile(configPath, config, 0600) != nil || os.WriteFile(egressPath, egress, 0600) != nil {
		t.Fatal("fixture write failed")
	}
	var output bytes.Buffer
	var concurrent chan error
	if scenario == "concurrent_bees" {
		otherConfig := filepath.Join(directory, "other-bee.json")
		if os.WriteFile(otherConfig, config, 0600) != nil {
			t.Fatal("other Bee configuration failed")
		}
		concurrent = make(chan error, 1)
		go func() {
			concurrent <- bee.Run(ctx, []string{"run", "--config", otherConfig, "--egress-config", egressPath}, io.Discard)
		}()
	}
	err := bee.Run(ctx, []string{"run", "--config", configPath, "--egress-config", egressPath}, &output)
	if concurrent != nil {
		if err := <-concurrent; err != nil {
			t.Error(err)
		}
	}
	expectedRefreshes, expectedUploads := int32(1), int32(2)
	if scenario == "reencrypt" {
		expectedRefreshes = 0
	}
	if blocked {
		expectedUploads = 0
	}
	if scenario == "response_lost" || scenario == "save_failure" {
		restarted, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		err = bee.Run(restarted, []string{"run", "--config", configPath, "--egress-config", egressPath}, &output)
		after, _ := os.ReadFile(authPath)
		if !bytes.Equal(after, raw) {
			t.Fatal("uncertain refresh changed official credentials")
		}
	}
	if err != nil || refreshes.Load() != expectedRefreshes || uploads.Load() != expectedUploads && !(scenario == "concurrent_bees" && uploads.Load() >= 2) {
		t.Fatalf("refresh/retry failed: refresh=%d upload=%d error=%v output=%s", refreshes.Load(), uploads.Load(), err, output.String())
	}
	info, _ := os.Stat(authPath)
	if info.Mode().Perm() != 0600 || strings.Contains(output.String(), "refresh-secret") {
		t.Fatal("credential permissions or redaction failed")
	}
}
