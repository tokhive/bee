//go:build darwin || linux

package bee

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

func syntheticJWT(claims map[string]any) string {
	raw, _ := json.Marshal(claims)
	return base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(raw) + ".c2ln"
}

// codexAuth is an official Codex sign-in for email.
func codexAuth(email string, expires time.Time, refresh string) []byte {
	auth := map[string]any{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "plus"}
	raw, _ := json.Marshal(map[string]any{"auth_mode": "chatgpt", "tokens": map[string]any{
		"id_token":      syntheticJWT(map[string]any{"email": email, "https://api.openai.com/auth": auth}),
		"access_token":  syntheticJWT(map[string]any{"exp": expires.Unix(), "https://api.openai.com/auth": auth}),
		"refresh_token": refresh, "account_id": "synthetic-account"}})
	return raw
}

func claudeCredentials(scopes ...string) []byte {
	raw, _ := json.Marshal(map[string]any{"claudeAiOauth": map[string]any{
		"accessToken": "synthetic-claude-access", "refreshToken": "synthetic-claude-refresh",
		"expiresAt": time.Now().Add(time.Hour).UnixMilli(), "scopes": scopes, "subscriptionType": "max"}})
	return raw
}

// accountsHive records what Bee asks Hive about platforms and accounts.
type accountsHive struct {
	*httptest.Server
	mu        sync.Mutex
	calls     []string
	pauseFail bool
	account   beewire.PlatformAccount
}

func (h *accountsHive) record(call string) {
	h.mu.Lock()
	h.calls = append(h.calls, call)
	h.mu.Unlock()
}

func (h *accountsHive) called(call string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.calls {
		if c == call {
			return true
		}
	}
	return false
}

func newAccountsHive(t *testing.T) *accountsHive {
	h := &accountsHive{}
	h.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/bee/platforms/"), "/")
		platform := parts[0]
		switch {
		case r.Method == "PUT" && len(parts) == 1:
			var input struct{ Paused bool }
			json.NewDecoder(r.Body).Decode(&input)
			h.record("PUT " + platform + " paused=" + map[bool]string{true: "true", false: "false"}[input.Paused])
			if h.pauseFail {
				http.Error(w, `{"error":{"code":"unavailable"}}`, http.StatusServiceUnavailable)
				return
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Paused: input.Paused, Reasons: []string{}})
		case r.Method == "GET" && len(parts) == 2 && parts[1] == "account":
			h.mu.Lock()
			account := h.account
			h.mu.Unlock()
			account.Platform = platform
			json.NewEncoder(w).Encode(account)
		case r.Method == "POST" && len(parts) == 3 && parts[2] == "confirm":
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			h.record("CONFIRM " + platform + " " + input["account_fingerprint"])
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: platform, Status: "ready", AccountFingerprint: input["account_fingerprint"]})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(h.Close)
	return h
}

func newAccountsRunner(t *testing.T, hive string) *desktopRunner {
	t.Helper()
	config := shortConfigPath(t)
	r := newDesktopRunner(config, &egressConfig{liveSources: true}, newRunStatus(), io.Discard)
	r.status.setDevice(localState{Hive: hive, Name: "laptop", Credential: "bee_" + strings.Repeat("d", 43), Identity: &beewire.Identity{ID: "dev_1"}}, bindingPaired)
	r.status.setConnection(connectionConnected)
	r.claudeProfile = func(context.Context, claudeCredential) (claudeIdentity, error) {
		return claudeIdentity{account: "11111111-1111-1111-1111-111111111111", organization: "22222222-2222-2222-2222-222222222222", email: "claude@example.com"}, nil
	}
	r.drainTimeout, r.confirmWindow, r.confirmPoll = 300*time.Millisecond, 2*time.Second, 20*time.Millisecond
	return r
}

func egressFields(t *testing.T, r *desktopRunner) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(defaultEgressPath(r.configPath))
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	json.Unmarshal(raw, &fields)
	return fields
}

func refusalCode(err error) string {
	var refused *accountError
	if errors.As(err, &refused) {
		return refused.problem.Code
	}
	return ""
}

func TestAddLocalCodexAccount(t *testing.T) {
	hive := newAccountsHive(t)
	home := t.TempDir()
	os.WriteFile(filepath.Join(home, "auth.json"), codexAuth("codex@example.com", time.Now().Add(time.Hour), "refresh"), 0o600)
	t.Setenv("CODEX_HOME", home)
	r := newAccountsRunner(t, hive.URL)

	found := r.detect(context.Background(), "openai")
	if !found.Available || found.Email != "codex@example.com" || found.Plan != "plus" || len(found.Fingerprint) != 64 {
		t.Fatalf("detect = %+v", found)
	}
	record, err := r.addAccount(context.Background(), addAccountRequest{Platform: "openai", Source: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if record.Email != "codex@example.com" || record.Source != "local" || record.Fingerprint != found.Fingerprint || !strings.HasPrefix(record.ID, "acc_") {
		t.Fatalf("record = %+v", record)
	}
	fields := egressFields(t, r)
	if fields["codex"].(map[string]any)["home"] != home || fields["capabilities"] == nil || fields["targets"].([]any)[0] != "chatgpt.com:443" {
		t.Fatalf("egress = %v", fields)
	}
	if _, err := readEgress(context.Background(), defaultEgressPath(r.configPath)); err != nil {
		t.Fatalf("written egress does not read back: %v", err)
	}
	if records := r.accounts(); len(records) != 1 || records[0].ID != record.ID {
		t.Fatalf("records = %+v", records)
	}
	if got := r.egress.sources().names(); len(got) != 1 || got[0] != "openai" || !r.egress.allowed("chatgpt.com:443") {
		t.Fatalf("running sources = %v", got)
	}
	waitUntil(t, "platform resumed", func() bool { return hive.called("PUT openai paused=false") })

	if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: "openai", Source: "local"}); refusalCode(err) != "platform_has_account" {
		t.Fatalf("second account: %v", err)
	}
}

func TestAddLocalAccountWithoutSignIn(t *testing.T) {
	t.Setenv("CODEX_HOME", filepath.Join(t.TempDir(), "missing"))
	r := newAccountsRunner(t, "https://hive.example")
	found := r.detect(context.Background(), "openai")
	if found.Available || found.Problem == nil || found.Problem.Code != "BEE-SETUP-CODEX-NOT-FOUND" {
		t.Fatalf("detect = %+v", found)
	}
	if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: "openai", Source: "local"}); refusalCode(err) != "BEE-SETUP-CODEX-NOT-FOUND" {
		t.Fatalf("add: %v", err)
	}
	if _, err := os.Stat(defaultEgressPath(r.configPath)); !os.IsNotExist(err) {
		t.Fatal("a failed add wrote the egress configuration")
	}
}

func TestImportClaudeAccountAndRemoveIt(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	file := filepath.Join(t.TempDir(), ".credentials.json")
	os.WriteFile(file, claudeCredentials("user:inference", "user:profile"), 0o644)

	record, err := r.addAccount(context.Background(), addAccountRequest{Platform: "claude", Source: "import", File: file})
	if err != nil {
		t.Fatal(err)
	}
	if record.Email != "claude@example.com" || record.Plan != "max" || record.Source != "import" || record.Fingerprint == "" {
		t.Fatalf("record = %+v", record)
	}
	directory := importDirectory(r.configPath, record.ID)
	info, err := os.Stat(filepath.Join(directory, ".credentials.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("imported copy: %v %v", info, err)
	}
	claude := egressFields(t, r)["claude"].(map[string]any)
	if claude["store"] != "file" || claude["config_dir"] != directory || claude["refresh"] != true || claude["capabilities"] != true {
		t.Fatalf("claude = %v", claude)
	}
	if !r.egress.allowed("api.anthropic.com:443") {
		t.Fatal("imported account's upstream not allowed")
	}

	// Removing waits for the account's open stream to finish.
	closeStream := r.egress.streamOpened("api.anthropic.com:443")
	time.AfterFunc(100*time.Millisecond, closeStream)
	started := time.Now()
	if err := r.removeAccount(context.Background(), record.ID); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) < 100*time.Millisecond {
		t.Fatal("removal did not wait for the open stream")
	}
	if !hive.called("PUT claude paused=true") {
		t.Fatal("platform not paused before removal")
	}
	if r.egress.allowed("api.anthropic.com:443") || len(r.egress.sources().names()) != 0 {
		t.Fatal("removed account still running")
	}
	if _, err := os.Stat(defaultEgressPath(r.configPath)); !os.IsNotExist(err) {
		t.Fatal("an egress configuration with no account left behind")
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("imported copy left behind")
	}
	if len(r.accounts()) != 0 {
		t.Fatal("record left behind")
	}
	if err := r.removeAccount(context.Background(), record.ID); refusalCode(err) != "not_found" {
		t.Fatalf("second removal: %v", err)
	}
}

func TestRemoveAccountKeepsItWhenHiveCannotPause(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	file := filepath.Join(t.TempDir(), "auth.json")
	os.WriteFile(file, codexAuth("codex@example.com", time.Now().Add(time.Hour), "refresh"), 0o644)
	record, err := r.addAccount(context.Background(), addAccountRequest{Platform: "openai", Source: "import", File: file})
	if err != nil {
		t.Fatal(err)
	}
	hive.mu.Lock()
	hive.pauseFail = true
	hive.mu.Unlock()
	if err := r.removeAccount(context.Background(), record.ID); refusalCode(err) != "pause_unconfirmed" {
		t.Fatalf("remove: %v", err)
	}
	if len(r.accounts()) != 1 || len(r.egress.sources().names()) != 1 {
		t.Fatal("a failed removal changed the account")
	}
	// Offline, Hive sends no work, so there is nothing to pause.
	r.status.setConnection(connectionDisconnected)
	if err := r.removeAccount(context.Background(), record.ID); err != nil {
		t.Fatal(err)
	}
}

func TestImportRefusesUnusableFiles(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, raw []byte) string {
		path := filepath.Join(dir, name)
		os.WriteFile(path, raw, 0o644)
		return path
	}
	cases := []struct {
		name, platform, file, code string
	}{
		{"missing file", "claude", filepath.Join(dir, "nope.json"), "import_unreadable"},
		{"not JSON", "claude", write("a.json", []byte("hello")), "import_invalid"},
		{"Codex file for Claude", "claude", write("b.json", codexAuth("x@example.com", time.Now().Add(time.Hour), "r")), "import_invalid"},
		{"missing profile permission", "claude", write("c.json", claudeCredentials("user:inference")), "import_scope"},
		{"Claude file for Codex", "openai", write("d.json", claudeCredentials("user:inference", "user:profile")), "import_invalid"},
		{"expired without refresh", "openai", write("e.json", codexAuth("x@example.com", time.Now().Add(-time.Hour), "")), "import_expired"},
		{"too large", "openai", write("f.json", []byte(strings.Repeat(" ", maxImportBytes+1))), "import_invalid"},
	}
	r := newAccountsRunner(t, "https://hive.example")
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: c.platform, Source: "import", File: c.file}); refusalCode(err) != c.code {
				t.Fatalf("err = %v, want %s", err, c.code)
			}
		})
	}
	if entries, _ := os.ReadDir(filepath.Join(filepath.Dir(r.configPath), "accounts")); len(entries) != 0 {
		t.Fatalf("a refused import left files: %v", entries)
	}
	if len(r.accounts()) != 0 {
		t.Fatal("a refused import left a record")
	}
}

// Adding an account Hive does not know yet confirms the switch Hive asks for.
func TestAddedAccountConfirmsTheSwitch(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	file := filepath.Join(t.TempDir(), ".credentials.json")
	os.WriteFile(file, claudeCredentials("user:inference", "user:profile"), 0o644)
	fingerprint := claudeIdentity{account: "11111111-1111-1111-1111-111111111111", organization: "22222222-2222-2222-2222-222222222222"}.fingerprint()
	hive.account = beewire.PlatformAccount{Status: "confirmation_required", AccountFingerprint: "old", PendingFingerprint: fingerprint, ConfirmationID: "c1"}
	if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: "claude", Source: "import", File: file}); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "switch confirmed", func() bool { return hive.called("CONFIRM claude " + fingerprint) })
}

func TestConfirmAccountSwitch(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	file := filepath.Join(t.TempDir(), "auth.json")
	os.WriteFile(file, codexAuth("codex@example.com", time.Now().Add(time.Hour), "refresh"), 0o644)
	record, err := r.addAccount(context.Background(), addAccountRequest{Platform: "openai", Source: "import", File: file})
	if err != nil {
		t.Fatal(err)
	}
	hive.mu.Lock()
	hive.account = beewire.PlatformAccount{Status: "ready", AccountFingerprint: record.Fingerprint}
	hive.mu.Unlock()
	if _, err := r.confirmAccount(context.Background(), record.ID); refusalCode(err) != "no_pending_switch" {
		t.Fatalf("nothing pending: %v", err)
	}
	hive.mu.Lock()
	hive.account = beewire.PlatformAccount{Status: "confirmation_required", AccountFingerprint: record.Fingerprint, PendingFingerprint: "newprint", ConfirmationID: "c2"}
	hive.mu.Unlock()
	account, err := r.confirmAccount(context.Background(), record.ID)
	if err != nil || account.AccountFingerprint != "newprint" {
		t.Fatalf("confirm: %+v %v", account, err)
	}
	if records := r.accounts(); records[0].Fingerprint != "newprint" || records[0].Email != "" {
		t.Fatalf("record = %+v", records[0])
	}
}

func TestAdoptConfiguredAccounts(t *testing.T) {
	r := newAccountsRunner(t, "https://hive.example")
	imported := importDirectory(r.configPath, "acc_x")
	r.egress.Codex = &codexSource{Home: "/Users/someone/.codex"}
	r.egress.Claude = &claudeSource{ConfigDir: &imported}
	if err := r.adoptConfiguredAccounts(); err != nil {
		t.Fatal(err)
	}
	records := r.accounts()
	if len(records) != 2 || records[0].Platform != "openai" || records[0].Source != "local" || records[1].Platform != "claude" || records[1].Source != "import" {
		t.Fatalf("records = %+v", records)
	}
	if err := r.adoptConfiguredAccounts(); err != nil || len(r.accounts()) != 2 {
		t.Fatal("adopting again duplicated records")
	}
}

func TestControlAccountRoutes(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	previous := claudeReader
	claudeReader = func(string, *string) func(context.Context) (claudeCredential, error) {
		return func(context.Context) (claudeCredential, error) {
			return claudeCredential{secret: tee.Secret{Token: "synthetic", Header: "authorization", Scheme: "Bearer"}, expiresAt: time.Now().Add(time.Hour), plan: "max", hasInferenceScope: true, hasProfileScope: true}, nil
		}
	}
	t.Cleanup(func() { claudeReader = previous })
	stop := serveControl(r.configPath, r.egress, r.status, r, io.Discard)
	defer stop()
	client := unixClient(controlSocketPath(r.configPath))

	var found accountDetection
	if code := getJSON(t, client, "GET", "/v1/platforms/claude/login", "", &found); code != 200 || !found.Available || found.Email != "claude@example.com" {
		t.Fatalf("login: %d %+v", code, found)
	}
	var record accountRecord
	if code := getJSON(t, client, "POST", "/v1/accounts", `{"platform":"claude","source":"local"}`, &record); code != 201 || record.Platform != "claude" {
		t.Fatalf("add: %d %+v", code, record)
	}
	var failure struct {
		Error struct{ Code string } `json:"error"`
	}
	if code := getJSON(t, client, "POST", "/v1/accounts", `{"platform":"claude","source":"local"}`, &failure); code != 409 || failure.Error.Code != "platform_has_account" {
		t.Fatalf("duplicate: %d %+v", code, failure)
	}
	if code := getJSON(t, client, "POST", "/v1/accounts", `{"platform":"claude","source":"elsewhere"}`, &failure); code != 409 && code != 400 {
		t.Fatalf("bad source: %d", code)
	}
	var overview controlOverview
	getJSON(t, client, "GET", "/v1/overview", "", &overview)
	if len(overview.Accounts) != 1 || overview.Accounts[0].ID != record.ID {
		t.Fatalf("overview accounts = %+v", overview.Accounts)
	}
	if code := getJSON(t, client, "DELETE", "/v1/accounts/"+record.ID, "", nil); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	if code := getJSON(t, client, "DELETE", "/v1/accounts/"+record.ID, "", &failure); code != 404 || failure.Error.Code != "not_found" {
		t.Fatalf("delete again: %d %+v", code, failure)
	}
}

func TestControlAccountsNeedDesktopMode(t *testing.T) {
	client, _, _ := startControl(t, "https://hive.example", nil)
	var failure struct {
		Error struct{ Code string } `json:"error"`
	}
	if code := getJSON(t, client, "GET", "/v1/accounts", "", &failure); code != 409 || failure.Error.Code != "accounts_unavailable" {
		t.Fatalf("%d %+v", code, failure)
	}
}
