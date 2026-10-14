package bee_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/agent"
)

func codexJWT(claims map[string]any) string {
	raw, _ := json.Marshal(claims)
	return base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString([]byte("synthetic-signature"))
}

func TestCodexCredentialInspectionThroughMacOSKeychain(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("TEST_CODEX_KEYCHAIN") != "1" {
		t.Skip("set TEST_CODEX_KEYCHAIN=1 to exercise a temporary synthetic entry in the macOS Keychain")
	}
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(directory))
	account := "cli|" + hex.EncodeToString(hash[:])[:16]
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	sample, _ := json.Marshal(codexSample(time.Now().Add(time.Hour)))
	command := exec.CommandContext(ctx, "/usr/bin/security", "add-generic-password", "-s", "Codex Auth", "-a", account, "-w", string(sample))
	if err := command.Run(); err != nil {
		t.Fatal("could not create temporary synthetic Keychain entry")
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if exec.CommandContext(cleanup, "/usr/bin/security", "delete-generic-password", "-s", "Codex Auth", "-a", account).Run() != nil {
			t.Errorf("temporary synthetic Keychain entry cleanup failed for %s", account)
		}
	})
	// A conflicting file proves that auto honors the selected Keychain account.
	if err := os.WriteFile(filepath.Join(directory, "auth.json"), []byte(`{"OPENAI_API_KEY":"synthetic-api-key"}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, store := range []string{"keyring", "auto"} {
		var output bytes.Buffer
		if err := bee.Run(ctx, []string{"codex-status", "--codex-home", directory, "--store", store}, &output); err != nil {
			t.Fatal(err)
		}
		var status map[string]string
		if json.Unmarshal(output.Bytes(), &status) != nil || status["source"] != "keyring" || status["validation"] != "local_structure_only" || strings.Contains(output.String(), "synthetic-") {
			t.Fatal("Keychain selection or metadata redaction failed")
		}
	}
}

func TestCodexLinuxKeyringDoesNotSilentlySelectFile(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux persistent Keyring compatibility gate")
	}
	directory := t.TempDir()
	raw, _ := json.Marshal(codexSample(time.Now().Add(time.Hour)))
	if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	for _, store := range []string{"keyring", "auto"} {
		var output bytes.Buffer
		err := bee.Run(context.Background(), []string{"codex-status", "--codex-home", directory, "--store", store}, &output)
		if err == nil || !strings.Contains(err.Error(), "Linux") || !strings.Contains(err.Error(), "file") {
			t.Fatal("unverified Linux Keyring silently selected an authorization")
		}
	}
}

func codexSample(expires time.Time) map[string]any {
	auth := map[string]any{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "plus"}
	return map[string]any{"auth_mode": "chatgpt", "OPENAI_API_KEY": nil, "tokens": map[string]any{"id_token": codexJWT(map[string]any{"https://api.openai.com/auth": auth}), "access_token": codexJWT(map[string]any{"exp": expires.Unix(), "https://api.openai.com/auth": auth}), "refresh_token": "synthetic-refresh-secret", "account_id": "synthetic-account"}, "last_refresh": time.Now().UTC().Format(time.RFC3339)}
}

func TestCodexCredentialInspectionUsesOfficialFileWithoutCopyingSecrets(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "auth.json")
	sample := codexSample(time.Now().Add(time.Hour))
	raw, _ := json.Marshal(sample)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	err := bee.Run(context.Background(), []string{"codex-status", "--codex-home", directory, "--store", "file"}, &output)
	if err != nil {
		t.Fatal(err)
	}
	var status map[string]any
	if json.Unmarshal(output.Bytes(), &status) != nil || status["source"] != "file" || status["plan"] != "plus" || status["account_fingerprint"] == "" || status["expires_at"] == "" {
		t.Fatalf("safe metadata: %s", output.String())
	}
	for _, secret := range []string{sample["tokens"].(map[string]any)["access_token"].(string), "synthetic-refresh-secret", "synthetic-account", "synthetic-user"} {
		if strings.Contains(output.String(), secret) {
			t.Fatal("credential inspection exposed secrets or raw identity")
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(raw, after) {
		t.Fatal("credential inspection modified official auth file")
	}
}

// The official client rewrites auth.json with group-readable permissions, so Bee reads
// whatever mode it finds instead of suspending supply until someone runs chmod.
func TestCodexCredentialInspectionAcceptsGroupReadableOfficialFile(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "auth.json")
	raw, _ := json.Marshal(codexSample(time.Now().Add(time.Hour)))
	if err := os.WriteFile(path, raw, 0644); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := bee.Run(context.Background(), []string{"codex-status", "--codex-home", directory, "--store", "file"}, &output); err != nil {
		t.Fatal(err)
	}
	var status map[string]any
	if json.Unmarshal(output.Bytes(), &status) != nil || status["plan"] != "plus" {
		t.Fatalf("safe metadata: %s", output.String())
	}
	if info, err := os.Lstat(path); err != nil || info.Mode().Perm() != 0644 {
		t.Fatal("credential inspection changed official file permissions")
	}
}

func TestCodexCredentialInspectionRejectsUnsupportedOrExpiredAuthorization(t *testing.T) {
	for _, name := range []string{"api_key", "api_mode", "flat_proxy", "expired", "unknown_expiry", "wrong_account", "wrong_user", "unsafe_identity", "bedrock", "unknown_plan", "fedramp", "ephemeral", "secrets", "missing_store"} {
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			sample := codexSample(time.Now().Add(time.Hour))
			tokens := sample["tokens"].(map[string]any)
			store, backend := "file", "direct"
			switch name {
			case "api_key":
				sample["OPENAI_API_KEY"] = "synthetic-api-key"
			case "api_mode":
				sample["auth_mode"] = "apikey"
			case "flat_proxy":
				sample = map[string]any{"access_token": tokens["access_token"], "account_id": "synthetic-account"}
			case "expired":
				sample = codexSample(time.Now().Add(-time.Minute))
			case "unknown_expiry":
				tokens["access_token"] = codexJWT(map[string]any{})
			case "wrong_account":
				tokens["account_id"] = "other-account"
			case "wrong_user":
				tokens["access_token"] = codexJWT(map[string]any{"exp": time.Now().Add(time.Hour).Unix(), "https://api.openai.com/auth": map[string]string{"chatgpt_user_id": "other-user"}})
			case "unsafe_identity":
				tokens["id_token"] = codexJWT(map[string]any{"https://api.openai.com/auth": map[string]string{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic\tuser", "chatgpt_plan_type": "plus"}})
			case "bedrock":
				sample["bedrock_api_key"] = map[string]string{"api_key": "synthetic-secret"}
			case "unknown_plan":
				tokens["id_token"] = codexJWT(map[string]any{"https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "unknown"}})
			case "fedramp":
				tokens["id_token"] = codexJWT(map[string]any{"https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "plus", "chatgpt_account_is_fedramp": true}})
			case "ephemeral":
				store = "ephemeral"
			case "secrets":
				backend = "secrets"
			case "missing_store":
				store = ""
			}
			raw, _ := json.Marshal(sample)
			if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			err := bee.Run(context.Background(), []string{"codex-status", "--codex-home", directory, "--store", store, "--keyring-backend", backend}, &output)
			if err == nil {
				t.Fatal("unsupported authorization accepted")
			}
			if strings.Contains(err.Error()+output.String(), "synthetic-") {
				t.Fatal("error leaked credential material")
			}
		})
	}
}
