package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
)

// codexHome writes a synthetic official Codex sign-in.
func codexHome(t *testing.T, expires time.Time) string {
	t.Helper()
	directory := t.TempDir()
	claims := jwt.MapClaims{"exp": expires.Unix(), "https://api.openai.com/auth": map[string]string{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "pro"}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("synthetic-key"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"tokens": map[string]string{"access_token": token, "id_token": token, "account_id": "synthetic-account", "refresh_token": "synthetic-refresh-secret"}})
	if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return directory
}

// fakeClaude stands in for Claude Code's credential store: a sign-in, or an
// error.
func fakeClaude(t *testing.T, err error) {
	t.Helper()
	previous := claudeReader
	claudeReader = func(string, *string) func(context.Context) (claudeCredential, error) {
		return func(context.Context) (claudeCredential, error) {
			if err != nil {
				return claudeCredential{}, err
			}
			return claudeCredential{secret: tee.Secret{Token: "synthetic", Header: "authorization", Scheme: "Bearer"}, expiresAt: time.Now().Add(time.Hour), plan: "max", hasInferenceScope: true}, nil
		}
	}
	t.Cleanup(func() { claudeReader = previous })
}

func answer(t *testing.T, text string) {
	t.Helper()
	previous := setupInput
	setupInput = strings.NewReader(text)
	t.Cleanup(func() { setupInput = previous })
}

func runSetup(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	err := Run(context.Background(), append([]string{"setup"}, args...), &out)
	return out.String(), err
}

func writtenEgress(t *testing.T, path string) map[string]any {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("egress configuration mode %04o", info.Mode().Perm())
	}
	raw, _ := os.ReadFile(path)
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestSetupWritesWhatBeeRunAccepts(t *testing.T) {
	home := codexHome(t, time.Now().Add(time.Hour))
	config := filepath.Join(t.TempDir(), "bee.json")
	out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", home, "--yes")
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	path := defaultEgressPath(config)
	cfg := writtenEgress(t, path)
	if got := cfg["targets"].([]any); len(got) != 1 || got[0] != "chatgpt.com:443" {
		t.Fatalf("targets %v", got)
	}
	if cfg["capabilities"] == nil || cfg["codex"].(map[string]any)["home"] != home || cfg["codex"].(map[string]any)["store"] != "file" {
		t.Fatalf("codex source %v", cfg)
	}
	if _, err := readEgress(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"synthetic-refresh-secret", "synthetic-account"} {
		raw, _ := os.ReadFile(path)
		if strings.Contains(out, secret) || strings.Contains(string(raw), secret) {
			t.Fatal("setup copied sign-in material")
		}
	}
	if !strings.Contains(out, "plan pro") || !strings.Contains(out, "Wrote "+path) || !strings.Contains(out, "bee run --config "+config+"\"") {
		t.Fatalf("summary: %s", out)
	}
}

func TestSetupFindsCodexHomeFromTheEnvironment(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	config := filepath.Join(t.TempDir(), "bee.json")
	if out, err := runSetup(t, "--config", config, "--platform", "openai", "--yes"); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if writtenEgress(t, defaultEgressPath(config))["codex"].(map[string]any)["home"] != os.Getenv("CODEX_HOME") {
		t.Fatal("CODEX_HOME not used")
	}
}

func TestSetupExplainsAnAccountItCannotUse(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	for _, test := range []struct {
		name, home, code string
	}{
		{"no directory", filepath.Join(t.TempDir(), "absent"), "BEE-SETUP-CODEX-NOT-FOUND"},
		{"not signed in", t.TempDir(), "BEE-CODEX-SOURCE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", test.home, "--yes")
			if code, _, _, _ := Coded(err); code != test.code || !strings.Contains(out, "not found") || !strings.Contains(out, "fix:") || strings.Contains(out, "Keychain") {
				t.Fatalf("%v\n%s", err, out)
			}
			if _, statErr := os.Stat(defaultEgressPath(config)); statErr == nil {
				t.Fatal("setup wrote a configuration for an account it could not read")
			}
		})
	}
	if _, err := runSetup(t, "--config", config, "--platform", "gemini", "--yes"); err == nil {
		t.Fatal("unknown platform accepted")
	} else if code, _, _, _ := Coded(err); code != "BEE-SETUP-PLATFORM" {
		t.Fatal(err)
	}
}

func TestSetupAsksBeforeSupplyingEachAccount(t *testing.T) {
	home := codexHome(t, time.Now().Add(time.Hour))
	config := filepath.Join(t.TempDir(), "bee.json")
	path := defaultEgressPath(config)
	fakeClaude(t, nil)

	answer(t, "y\nn\n")
	if out, err := runSetup(t, "--config", config, "--codex-home", home); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if cfg := writtenEgress(t, path); cfg["claude"] != nil || cfg["codex"] == nil {
		t.Fatalf("declined Claude was configured: %v", cfg)
	}

	// A second run adds Claude and keeps the provider's proxy.
	if out, err := runSetup(t, "--config", config, "--codex-home", home, "--connect-proxy", "http://127.0.0.1:7890", "--yes"); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	answer(t, "\n\n")
	if out, err := runSetup(t, "--config", config, "--codex-home", home); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	cfg := writtenEgress(t, path)
	if cfg["connect_proxy"] != "http://127.0.0.1:7890" || cfg["claude"].(map[string]any)["store"] != defaultClaudeStore() || cfg["claude"].(map[string]any)["capabilities"] != true {
		t.Fatalf("second run: %v", cfg)
	}
	if targets := cfg["targets"].([]any); len(targets) != 2 {
		t.Fatalf("targets %v", targets)
	}

	// Removing the proxy and Claude again.
	answer(t, "y\nno\n")
	if out, err := runSetup(t, "--config", config, "--codex-home", home, "--connect-proxy", ""); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if cfg := writtenEgress(t, path); cfg["claude"] != nil || cfg["connect_proxy"] != nil {
		t.Fatalf("third run: %v", cfg)
	}

	answer(t, "")
	if _, err := runSetup(t, "--config", config, "--codex-home", home); err == nil {
		t.Fatal("setup proceeded without an answer")
	} else if code, _, _, _ := Coded(err); code != "BEE-SETUP-NO-ANSWER" {
		t.Fatal(err)
	}
	answer(t, "n\nn\n")
	if _, err := runSetup(t, "--config", config, "--codex-home", home); err == nil {
		t.Fatal("setup wrote a configuration supplying nothing")
	} else if code, _, _, _ := Coded(err); code != "BEE-SETUP-NOTHING" {
		t.Fatal(err)
	}
}

func TestSetupSkipsAnUnusablePlatformUnlessAskedForIt(t *testing.T) {
	home := codexHome(t, time.Now().Add(time.Hour))
	config := filepath.Join(t.TempDir(), "bee.json")
	fakeClaude(t, errClaudeKeychainMissing)
	out, err := runSetup(t, "--config", config, "--codex-home", home, "--yes")
	if err != nil || !strings.Contains(out, "claude  not found") {
		t.Fatalf("%v\n%s", err, out)
	}
	if cfg := writtenEgress(t, defaultEgressPath(config)); cfg["claude"] != nil {
		t.Fatal("unusable Claude configured")
	}
	if _, err := runSetup(t, "--config", config, "--platform", "openai,claude", "--codex-home", home, "--yes"); err == nil {
		t.Fatal("a platform asked for by name was silently dropped")
	} else if code, _, _, _ := Coded(err); code != "BEE-CLAUDE-SOURCE" {
		t.Fatal(err)
	}
}

func TestSetupLeavesAHandWrittenStaticConfigurationAlone(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	path := defaultEgressPath(config)
	static := `{"targets": ["upstream.example:443"], "inbox_key_id": "` + strings.Repeat("0", 63) + `1", "credential": {"Token": "t", "Header": "authorization", "Scheme": "Bearer"}}`
	if err := os.WriteFile(path, []byte(static), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", codexHome(t, time.Now().Add(time.Hour)), "--yes")
	if code, _, _, _ := Coded(err); code != "BEE-SETUP-MANUAL" {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(path); string(raw) != static {
		t.Fatal("setup overwrote a configuration it does not manage")
	}
}

func TestRunUsesTheConfigurationSetupWrote(t *testing.T) {
	directory := t.TempDir()
	config := filepath.Join(directory, "bee.json")
	state, _ := json.Marshal(map[string]any{"hive": "http://127.0.0.1:1", "name": "setup", "credential": "bee_" + strings.Repeat("A", 43), "identity": map[string]string{"id": "device", "name": "setup", "owner_id": "owner", "owner_email": "provider@example.com"}})
	if err := os.WriteFile(config, state, 0600); err != nil {
		t.Fatal(err)
	}
	run := func() string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		var out bytes.Buffer
		if err := Run(ctx, []string{"run", "--config", config}, &out); err != nil {
			t.Fatal(err)
		}
		return out.String()
	}
	if out := run(); !strings.Contains(out, "code=BEE-SETUP-NEEDED") {
		t.Fatalf("bee run without a configuration did not point to bee setup: %s", out)
	}
	if out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", codexHome(t, time.Now().Add(time.Hour)), "--yes"); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if out := run(); !strings.Contains(out, "using egress configuration") || !strings.Contains(out, defaultEgressPath(config)) || strings.Contains(out, "BEE-SETUP-NEEDED") {
		t.Fatalf("bee run ignored the configuration setup wrote: %s", out)
	}
}

// An expired access token is still a usable account: Hive schedules its
// refresh once bee run connects, so setup lists and configures it.
func TestSetupConfiguresAnAccountWhoseTokenExpired(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", codexHome(t, time.Now().Add(-time.Hour)), "--yes")
	if err != nil || !strings.Contains(out, "access token expired; Hive refreshes it once bee run is connected") {
		t.Fatalf("%v\n%s", err, out)
	}
	if writtenEgress(t, defaultEgressPath(config))["codex"] == nil {
		t.Fatal("expired account not configured")
	}
}

// A sign-in Bee cannot supply from is refused with the reason, not written
// into a configuration that would fail later.
func TestSetupRefusesASignInBeeCannotSupply(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "auth.json"), []byte(`{"auth_mode": "apikey", "OPENAI_API_KEY": "sk-synthetic-secret"}`), 0600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(t.TempDir(), "bee.json")
	out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", home, "--yes")
	code, summary, fix, _ := Coded(err)
	if code != "BEE-CODEX-SOURCE" || !strings.Contains(summary, "ChatGPT") || fix == "" || !strings.Contains(out, "fix:") {
		t.Fatalf("%v\n%s", err, out)
	}
	if strings.Contains(out, "sk-synthetic-secret") || strings.Contains(err.Error(), "sk-synthetic-secret") {
		t.Fatal("setup echoed the API key")
	}
	if _, statErr := os.Stat(defaultEgressPath(config)); statErr == nil {
		t.Fatal("setup wrote a configuration for an unsupported sign-in")
	}
}
