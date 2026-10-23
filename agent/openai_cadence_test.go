package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

type openaiControlFixture struct {
	models, usage  int
	plan, excluded string
	fail           bool
	// primary overrides the length of the primary window when set.
	primary int
	// versions are the client_version and User-Agent each models query sent.
	versions [][2]string
	// identities are the originator, version header and User-Agent each models
	// query sent: every request a real Codex makes carries the full triple.
	identities [][3]string
}

func (f *openaiControlFixture) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host != "chatgpt.com" {
		return claudeProfileResponse(500, `{}`), nil
	}
	if r.URL.Path == "/backend-api/codex/models" {
		f.models++
		f.versions = append(f.versions, [2]string{r.URL.Query().Get("client_version"), r.Header.Get("User-Agent")})
		f.identities = append(f.identities, [3]string{r.Header.Get("Originator"), r.Header.Get("Version"), r.Header.Get("User-Agent")})
		return claudeProfileResponse(200, `{"models":[{"slug":"gpt-test-a"},{"slug":"gpt-test-b"}]}`), nil
	}
	f.usage++
	if f.fail {
		return claudeProfileResponse(503, `{}`), nil
	}
	window := func(seconds int) map[string]any {
		return map[string]any{"limit_window_seconds": seconds, "used_percent": 20, "reset_after_seconds": 3600, "reset_at": time.Now().Add(time.Hour).Unix()}
	}
	single := beewire.OpenAISingleWindow(f.plan)
	primary := 604800
	if single != 0 {
		primary = single
	}
	if f.primary != 0 {
		primary = f.primary
	}
	limit := map[string]any{"allowed": true, "limit_reached": false, "primary_window": window(primary)}
	if single == 0 {
		limit["secondary_window"] = window(18000)
	}
	usage := map[string]any{"plan_type": f.plan, "rate_limit": limit}
	if f.excluded != "" {
		usage["additional_rate_limits"] = []any{map[string]any{"metered_feature": "base_model_inference", "limit_name": "gpt-reserve", "normal_model_slug": f.excluded}}
	}
	raw, _ := json.Marshal(usage)
	return claudeProfileResponse(200, string(raw)), nil
}

func TestOpenAIIndependentQueryIntervals(t *testing.T) {
	f := &openaiControlFixture{plan: "pro"}
	s := capabilitySource{transport: f}
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "pro", ExpiresAt: time.Now().Add(time.Hour)}
	observe := func(models, usage int) beewire.Capabilities {
		t.Helper()
		got := s.observe(context.Background(), c, int64(usage))
		if got.Status != "ready" || f.models != models || f.usage != usage {
			t.Fatalf("status=%s models=%d usage=%d", got.Status, f.models, f.usage)
		}
		return got
	}
	observe(1, 1)
	observe(1, 1)
	s.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	observe(1, 2)
	s.metadataAt = time.Now().Add(-5 * time.Hour)
	observe(2, 3)
	// A usage restriction must take effect without re-querying the catalog.
	s.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	f.excluded = "gpt-test-a"
	if got := observe(2, 4); len(got.Models) != 1 || got.Models[0] != "gpt-test-b" {
		t.Fatal("cached catalog bypassed usage restriction", got.Models)
	}
	s.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	f.excluded = ""
	if got := observe(2, 5); len(got.Models) != 2 {
		t.Fatal("raw catalog was lost", got.Models)
	}
	c.Plan, f.plan = "plus", "plus"
	if got := observe(3, 6); got.Plan != "plus" {
		t.Fatal("plan change ignored")
	}
	c.AccountID = "other-account"
	observe(4, 7)
	s.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	f.fail = true
	if got := s.observe(context.Background(), c, 8); got.Status != "unknown" {
		t.Fatal("failed query retained ready status")
	}
	f.fail = false
	// Failed queries cannot make a previous usage observation reusable.
	observe(4, 9)
}

func TestOpenAIIndependentReportIntervals(t *testing.T) {
	directory := t.TempDir()
	claims := jwt.MapClaims{"exp": time.Now().Add(time.Hour).Unix(), "https://api.openai.com/auth": map[string]string{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "pro"}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("synthetic-key"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"tokens": map[string]string{"access_token": token, "id_token": token, "account_id": "synthetic-account"}})
	if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	f := &openaiControlFixture{plan: "pro"}
	cfg := egressConfig{Codex: &codexSource{Home: directory, Store: "file"}, Capabilities: &capabilitySource{transport: f}}
	var reports []map[string]json.RawMessage
	reject := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1})
		case "/api/bee/maintenance":
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1}})
		case "/api/bee/platforms/openai/capabilities":
			var rbody map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&rbody); err != nil {
				t.Error(err)
			}
			reports = append(reports, rbody)
			if reject {
				w.WriteHeader(409)
				io.WriteString(w, `{"error":{"code":"capability_metadata_required"}}`)
				return
			}
			w.WriteHeader(201)
		default:
			t.Error("unexpected API", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	state := localState{Hive: server.URL, Credential: "synthetic-bee"}
	sync := func(force bool) error {
		return cfg.synchronize(context.Background(), state, "lease", io.Discard, force)
	}
	due := func() {
		cfg.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
		cfg.lastCapabilitySync = time.Now().Add(-5*time.Minute - time.Second)
		cfg.Capabilities.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	}
	check := func(count int, metadata bool) {
		t.Helper()
		if len(reports) != count {
			t.Fatalf("reports=%d want=%d", len(reports), count)
		}
		_, plan := reports[count-1]["plan"]
		_, models := reports[count-1]["models"]
		if plan != metadata || models != metadata {
			t.Fatalf("metadata plan=%v models=%v want=%v", plan, models, metadata)
		}
	}
	if err := sync(true); err != nil {
		t.Fatal(err)
	}
	check(1, true)
	cfg.lastCapabilitySync = time.Now().Add(-4 * time.Minute)
	cfg.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(1, true)
	due()
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(2, false)
	due()
	cfg.Capabilities.metadataAt = time.Now().Add(-5 * time.Hour)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(3, true)
	due()
	f.excluded = "gpt-test-a"
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(4, true)
	due()
	reject = true
	if err := sync(false); err == nil {
		t.Fatal("rejected report ignored")
	}
	check(5, false)
	reject = false
	cfg.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(6, true)
	if err := sync(true); err != nil {
		t.Fatal(err)
	}
	check(7, true)
	if f.models != 2 {
		t.Fatal("reporting repeatedly queried models", f.models)
	}
	// A short Retry-After can expire before the normal report interval.
	cfg.Capabilities.retryAt = time.Now().Add(-time.Second)
	if !cfg.capabilitiesDue(false, false, *cfg.authorization) {
		t.Fatal("cooldown recovery delayed")
	}
	reject = true
	if err := sync(false); err == nil {
		t.Fatal("expected report rejection")
	}
	if !cfg.Capabilities.retryAt.IsZero() {
		t.Fatal("expired cooldown reused stale usage")
	}
	cfg.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if !cfg.capabilitiesDue(false, false, *cfg.authorization) {
		t.Fatal("failed recovery report deferred for five minutes")
	}
	reject = false
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	// Hive asks for a report through a control stream when it holds the
	// account out until a newer observation arrives. The next cycle makes one
	// however recent the last, once ten seconds separate the attempts, and
	// making it clears the request.
	cfg.lastCapabilityAttempt, cfg.lastCapabilitySync = time.Now(), time.Now()
	if cfg.capabilitiesDue(false, false, *cfg.authorization) {
		t.Fatal("report due without being asked")
	}
	cfg.serveStream(io.Discard)(context.Background(), nil, []byte(`{"control":"capabilities","platform":"openai"}`))
	if cfg.capabilitiesDue(false, false, *cfg.authorization) {
		t.Fatal("an asked report skipped the ten seconds between attempts")
	}
	cfg.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if !cfg.capabilitiesDue(false, false, *cfg.authorization) {
		t.Fatal("asked report not due")
	}
	asked := len(reports)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	if len(reports) != asked+1 || cfg.capabilityWanted.Load() {
		t.Fatalf("asked report not made, or the request kept: reports %d after %d", len(reports), asked)
	}
}

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.DeadlineExceeded
}

// An unknown observation carries its reason, so a Bee that cannot reach the
// official hosts says so instead of reporting a bare "unknown".
func TestOpenAIUnknownCapabilitiesNameTheirReason(t *testing.T) {
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "plus", ExpiresAt: time.Now().Add(time.Hour)}
	for name, test := range map[string]struct {
		transport http.RoundTripper
		want      string
	}{
		"unreachable": {failingTransport{}, "HTTPS_PROXY"},
		"http error":  {&openaiControlFixture{plan: "plus", fail: true}, "/backend-api/wham/usage answered HTTP 503"},
		"plan":        {&openaiControlFixture{plan: "team"}, `usage plan "team" does not match authorization plan "plus"`},
	} {
		t.Run(name, func(t *testing.T) {
			s := capabilitySource{transport: test.transport}
			if got := s.observe(context.Background(), c, 1); got.Status != "unknown" || !strings.Contains(s.failure, test.want) {
				t.Fatalf("status=%s failure=%q", got.Status, s.failure)
			}
		})
	}
	s := capabilitySource{transport: &openaiControlFixture{plan: "plus"}}
	s.failure = "stale"
	if got := s.observe(context.Background(), c, 1); got.Status != "ready" || s.failure != "" {
		t.Fatalf("status=%s failure=%q", got.Status, s.failure)
	}
}

func TestOpenAIFreeSuppliesOnItsMonthlyWindow(t *testing.T) {
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "free", ExpiresAt: time.Now().Add(time.Hour)}
	s := capabilitySource{transport: &openaiControlFixture{plan: "free"}}
	got := s.observe(context.Background(), c, 1)
	if got.Status != "ready" || got.Plan != "free" || len(got.Windows) != 1 || got.Windows[0].Seconds != 2592000 || len(got.Models) != 2 {
		t.Fatalf("free account not ready on its 30-day window: %+v", got)
	}
	// Free borrows neither Pro's weekly window nor another plan's usage.
	for _, f := range []*openaiControlFixture{{plan: "free", primary: 604800}, {plan: "plus", primary: 2592000}} {
		plan := c
		plan.Plan = f.plan
		s := capabilitySource{transport: f}
		if got := s.observe(context.Background(), plan, 1); got.Status != "unknown" {
			t.Fatalf("plan %s with a %ds primary window: %+v", f.plan, f.primary, got)
		}
	}
	s = capabilitySource{transport: &openaiControlFixture{plan: "plus", primary: 2592000}}
	if got := s.observe(context.Background(), c, 1); got.Status != "unknown" || s.failure == "" {
		t.Fatalf("free authorization accepted plus usage: %+v %q", got, s.failure)
	}
}

// Go reports one 30-day window like Free, and the $100 and $500 Pro tiers
// (prolite, promax) only the weekly window like pro.
func TestOpenAISingleWindowPlansSupply(t *testing.T) {
	for plan, seconds := range map[string]int{"go": 2592000, "prolite": 604800, "promax": 604800} {
		c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: plan, ExpiresAt: time.Now().Add(time.Hour)}
		s := capabilitySource{transport: &openaiControlFixture{plan: plan}}
		got := s.observe(context.Background(), c, 1)
		if got.Status != "ready" || got.Plan != plan || len(got.Windows) != 1 || got.Windows[0].Seconds != seconds {
			t.Fatalf("%s account not ready on its %ds window: %+v %q", plan, seconds, got, s.failure)
		}
	}
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "promax", ExpiresAt: time.Now().Add(time.Hour)}
	s := capabilitySource{transport: &openaiControlFixture{plan: "promax", excluded: "gpt-test-b"}}
	if got := s.observe(context.Background(), c, 1); got.Status != "ready" || len(got.Models) != 1 || got.Models[0] != "gpt-test-a" {
		t.Fatalf("promax additional_rate_limits not honoured: %+v %q", got, s.failure)
	}
}

// TestCapabilityTimesSurviveSleep pins that the times a capability source keeps
// carry no monotonic reading. macOS stops the monotonic clock while the machine
// sleeps, so a kept time compared on it would call model metadata fresh after a
// day asleep, and Hive, which reads the wall clock, would reject every report.
func TestCapabilityTimesSurviveSleep(t *testing.T) {
	monotonic := func(at time.Time) bool { return strings.Contains(at.String(), " m=") }
	f := &openaiControlFixture{plan: "pro"}
	s := capabilitySource{transport: f}
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "pro", ExpiresAt: time.Now().Add(time.Hour)}
	if got := s.observe(context.Background(), c, 1); got.Status != "ready" {
		t.Fatalf("status=%s", got.Status)
	}
	if monotonic(s.cachedAt) || monotonic(s.metadataAt) {
		t.Fatalf("OpenAI kept monotonic times: cached=%s metadata=%s", s.cachedAt, s.metadataAt)
	}

	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	usage := claudeExpandedQuotaFixture()
	transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/models" {
			return claudeProfileResponse(200, claudeModelsFixture), nil
		}
		raw, _ := json.Marshal(usage)
		return claudeProfileResponse(200, string(raw)), nil
	})
	claude := claudeCapabilitySource{}
	if got, err := claude.observe(context.Background(), credential, "account-1", 1, transport); err != nil || got.Status != "ready" {
		t.Fatalf("status=%s err=%v", got.Status, err)
	}
	if monotonic(claude.cachedAt) || monotonic(claude.metadataAt) {
		t.Fatalf("Claude kept monotonic times: cached=%s metadata=%s", claude.cachedAt, claude.metadataAt)
	}
}

func TestOpenAIReportsTheLocalCodexVersion(t *testing.T) {
	home := t.TempDir()
	f := &openaiControlFixture{plan: "pro"}
	s := capabilitySource{transport: f, home: home}
	c := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "pro", ExpiresAt: time.Now().Add(time.Hour)}
	observe := func(sequence int64, want string) {
		t.Helper()
		result := s.observe(context.Background(), c, sequence)
		if result.Status != "ready" || result.ClientVersion != want {
			t.Fatalf("observation %d = %s with version %q, want ready with %q (%s)", sequence, result.Status, result.ClientVersion, want, s.failure)
		}
		if last := f.versions[len(f.versions)-1]; last != [2]string{want, "codex_cli_rs/" + want + codexFallbackUserAgentSuffix} {
			t.Fatalf("models were listed as %v, want %s", last, want)
		}
		if identity := f.identities[len(f.identities)-1]; identity != [3]string{"codex_cli_rs", want, "codex_cli_rs/" + want + codexFallbackUserAgentSuffix} {
			t.Fatalf("models were listed speaking %v, want the full codex_cli_rs identity of %s", identity, want)
		}
	}
	// No cache: the official Codex has not said which release it runs.
	observe(1, defaultCodexClientVersion)
	if err := os.WriteFile(filepath.Join(home, "models_cache.json"), []byte(`{"client_version":"0.163.0","models":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	// A new release lists models again, though the old list is still fresh.
	observe(2, "0.163.0")
	if f.models != 2 {
		t.Fatalf("models queried %d times, want 2", f.models)
	}
	observe(3, "0.163.0")
	if f.models != 2 {
		t.Fatalf("models queried %d times for an unchanged release, want 2", f.models)
	}
	if err := os.WriteFile(filepath.Join(home, "models_cache.json"), []byte(`{"client_version":"0.163.0\r\nX-Injected: 1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	observe(4, defaultCodexClientVersion)
	// An upgraded codex on PATH counts before Codex refreshes its cache, and
	// the newer of the two wins either way.
	if err := os.WriteFile(filepath.Join(home, "models_cache.json"), []byte(`{"client_version":"0.163.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	installed := "0.165.0"
	installedCodexVersion = func(context.Context) string { return installed }
	t.Cleanup(func() { installedCodexVersion = func(context.Context) string { return "" } })
	observe(5, "0.165.0")
	installed = "0.160.0"
	observe(6, "0.163.0")
}

func TestCodexOnPath(t *testing.T) {
	directory := t.TempDir()
	t.Setenv("PATH", directory)
	if got := codexOnPath(context.Background()); got != "" {
		t.Fatalf("no codex on PATH = %q", got)
	}
	for output, want := range map[string]string{"codex-cli 0.163.0": "0.163.0", "codex 1.0.0 something else": ""} {
		script := "#!/bin/sh\nprintf '%s\\n' '" + output + "'\n"
		if err := os.WriteFile(filepath.Join(directory, "codex"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
		if got := codexOnPath(context.Background()); got != want {
			t.Fatalf("%q read as %q, want %q", output, got, want)
		}
	}
}

func TestNewerVersion(t *testing.T) {
	for _, pair := range [][2]string{{"0.163.0", "0.161.9"}, {"0.163.10", "0.163.9"}, {"1.0.0", "0.999.999"}, {"0.163.0", "0.163.0-alpha.2"}, {"0.163.0-beta.1", "0.163.0-alpha.2"}} {
		if !newerVersion(pair[0], pair[1]) || newerVersion(pair[1], pair[0]) {
			t.Fatalf("%s should be newer than %s", pair[0], pair[1])
		}
	}
	if newerVersion("0.163.0", "0.163.0") {
		t.Fatal("a release is not newer than itself")
	}
}
