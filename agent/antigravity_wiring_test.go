package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestEgressConfigurationNeedsBothAntigravityTargets(t *testing.T) {
	both := `"targets": ["cloudcode-pa.googleapis.com:443", "daily-cloudcode-pa.googleapis.com:443"]`
	for _, body := range []string{
		`{` + both + `, "antigravity": {"capabilities": true}}`,
		`{` + both + `, "antigravity": {}, "connect_proxy": "http://127.0.0.1:8080"}`,
		`{"targets": ["chatgpt.com:443", "api.anthropic.com:443", "cloudcode-pa.googleapis.com:443", "daily-cloudcode-pa.googleapis.com:443"], "codex": {"home": "/x", "store": "file"}, "claude": {"store": "keychain"}, "antigravity": {"capabilities": true}}`,
		// A local fixture's loopback upstream stands in for the official addresses.
		`{"targets": ["127.0.0.1:8443"], "antigravity": {}}`,
	} {
		cfg, err := readEgress(context.Background(), writeEgress(t, body, 0600))
		if err != nil || cfg.Antigravity == nil || !cfg.dynamicAuthorization() || !slices.Contains(configuredPlatforms(cfg), beewire.GooglePlatform) {
			t.Fatalf("%s: %v", body, err)
		}
		if strings.Contains(body, "connect_proxy") != (cfg.Antigravity.transport != nil) {
			t.Fatal("connect_proxy does not decide how Bee's own Google requests leave")
		}
	}
	for _, test := range []struct{ name, body, code, detail string }{
		{"no daily target", `{"targets": ["cloudcode-pa.googleapis.com:443"], "antigravity": {}}`, "BEE-CONFIG-TARGET-MISSING", `"antigravity" is configured but targets lacks daily-cloudcode-pa.googleapis.com:443`},
		{"no production target", `{"targets": ["daily-cloudcode-pa.googleapis.com:443"], "antigravity": {}}`, "BEE-CONFIG-TARGET-MISSING", `"antigravity" is configured but targets lacks cloudcode-pa.googleapis.com:443`},
		{"another platform's target", `{"targets": ["api.anthropic.com:443"], "antigravity": {"capabilities": true}}`, "BEE-CONFIG-TARGET-MISSING", "cloudcode-pa.googleapis.com:443"},
		{"unknown field", `{` + both + `, "antigravity": {"store": "file"}}`, "BEE-CONFIG-UNKNOWN-FIELD", `"store"`},
		{"wrong type", `{` + both + `, "antigravity": {"capabilities": "yes"}}`, "BEE-CONFIG-FIELD-TYPE", `"antigravity.capabilities" must be true or false`},
		{"static mixed", `{` + both + `, "antigravity": {}, "credential": {"Token": "t", "Header": "authorization", "Scheme": "Bearer"}}`, "BEE-CONFIG-STATIC-MIXED", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := readEgress(context.Background(), writeEgress(t, test.body, 0600))
			code, summary, fix, _ := Coded(err)
			if code != test.code || !strings.Contains(summary, test.detail) || fix == "" {
				t.Fatalf("got %v, want %s naming %s", err, test.code, test.detail)
			}
		})
	}
	if got := platformUpstreams(beewire.GooglePlatform); !slices.Equal(got, []string{beewire.AntigravityHost, beewire.AntigravityDailyHost}) || len(platformUpstreams("openai")) != 1 || len(platformUpstreams("claude")) != 1 || platformUpstreams("gemini") != nil {
		t.Fatal("platform upstreams", got)
	}
	for _, host := range []string{beewire.AntigravityHost, beewire.AntigravityDailyHost} {
		if targetClass(host) != beewire.GooglePlatform {
			t.Fatal("telemetry does not class", host)
		}
	}
	if targetClass("oauth2.googleapis.com:443") != "other" {
		t.Fatal("a Google host that is no tunnel target was classed as one")
	}
}

func TestSetupOffersTheStoredAntigravitySignIn(t *testing.T) {
	t.Setenv("BEE_LANG", "en")
	config := filepath.Join(t.TempDir(), "bee.json")
	// Without a sign-in, asking for the platform says how to get one.
	out, err := runSetup(t, "--config", config, "--platform", "google", "--yes")
	if code, summary, fix, _ := Coded(err); code != "BEE-ANTIGRAVITY-SOURCE" || !strings.Contains(summary+fix+out, "bee antigravity-login") {
		t.Fatalf("%v\n%s", err, out)
	}
	credential := antigravitySample(time.Now().Add(time.Hour))
	store := antigravityStoreIn(filepath.Dir(config))
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	answer(t, "y\n")
	if out, err = runSetup(t, "--config", config, "--platform", "google"); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	path := defaultEgressPath(config)
	cfg := writtenEgress(t, path)
	if got := cfg["targets"].([]any); len(got) != 2 || got[0] != beewire.AntigravityHost || got[1] != beewire.AntigravityDailyHost {
		t.Fatalf("targets %v", got)
	}
	if cfg["antigravity"].(map[string]any)["capabilities"] != true || cfg["codex"] != nil || cfg["claude"] != nil {
		t.Fatalf("sources %v", cfg)
	}
	if _, err := readEgress(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Antigravity sign-in of p***@example.test") || !strings.Contains(out, "plan pro") || !strings.Contains(out, "Supply this google account") || strings.Contains(out, "provider@example.test") {
		t.Fatalf("summary: %s", out)
	}
	raw, _ := json.Marshal(cfg)
	assertNoAntigravitySecrets(t, out+string(raw))

	// A second run keeps the choice; a sign-in Google ended is not offered.
	if out, err = runSetup(t, "--config", config, "--platform", "google", "--yes"); err != nil || writtenEgress(t, path)["antigravity"] == nil {
		t.Fatalf("%v\n%s", err, out)
	}
	credential.Rejected = "invalid_grant"
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	if _, err = runSetup(t, "--config", config, "--platform", "google", "--yes"); !strings.Contains(err.Error(), "BEE-ANTIGRAVITY-SIGNIN") {
		t.Fatal("an ended sign-in was offered for supply", err)
	}
	// An access token that ran out is renewed once Bee runs, so it is offered.
	credential.Rejected, credential.ExpiresAt = "", time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	if out, err = runSetup(t, "--config", config, "--platform", "google", "--yes"); err != nil || !strings.Contains(out, "access token expired") {
		t.Fatalf("%v\n%s", err, out)
	}
	if _, err = runSetup(t, "--config", config, "--platform", "gemini"); !strings.Contains(err.Error(), "BEE-SETUP-PLATFORM") {
		t.Fatal(err)
	}
}

func TestDoctorChecksTheAntigravitySignIn(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	egress := writeEgress(t, `{"targets": ["cloudcode-pa.googleapis.com:443", "daily-cloudcode-pa.googleapis.com:443"], "antigravity": {"capabilities": true}}`, 0600)
	authorization := func() check {
		t.Helper()
		for _, c := range diagnose(context.Background(), config, egress).Checks {
			if c.Name == "authorization" && c.Platform == beewire.GooglePlatform {
				return c
			}
		}
		t.Fatal("doctor has no authorization check for google")
		return check{}
	}
	if c := authorization(); c.Status != "fail" || c.Code != "BEE-ANTIGRAVITY-SOURCE" || !strings.Contains(c.Fix, "bee antigravity-login") {
		t.Fatalf("no sign-in: %+v", c)
	}
	credential := antigravitySample(time.Now().Add(time.Hour))
	store := antigravityStoreIn(filepath.Dir(config))
	for _, test := range []struct {
		name         string
		change       func(*antigravityCredential)
		status, code string
	}{
		{"usable", func(*antigravityCredential) {}, "pass", ""},
		{"expired", func(c *antigravityCredential) { c.ExpiresAt = time.Now().Add(-time.Hour).UTC().Truncate(time.Second) }, "warn", "BEE-ANTIGRAVITY-EXPIRED"},
		{"expired for good", func(c *antigravityCredential) {
			c.RefreshToken, c.ExpiresAt = "", time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
		}, "fail", "BEE-ANTIGRAVITY-EXPIRED"},
		{"ended", func(c *antigravityCredential) { c.Rejected = "invalid_grant" }, "fail", "BEE-ANTIGRAVITY-SIGNIN"},
		{"tier", func(c *antigravityCredential) { c.Tier, c.Plan = "standard-tier", "" }, "fail", "BEE-ANTIGRAVITY-TIER"},
	} {
		changed := credential
		test.change(&changed)
		if err := store.write(changed); err != nil {
			t.Fatal(err)
		}
		c := authorization()
		if c.Status != test.status || c.Code != test.code {
			t.Fatalf("%s: %+v", test.name, c)
		}
		assertNoAntigravitySecrets(t, c.Detail+c.Fix)
		if strings.Contains(c.Detail, "provider@example.test") {
			t.Fatal("doctor's report carries the email", c.Detail)
		}
	}
}

func TestAntigravityStatusDescribesTheStoredSignIn(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	var out bytes.Buffer
	err := Run(context.Background(), []string{"antigravity-status", "--config", config}, &out)
	if code, _, fix, _ := Coded(err); code != "BEE-ANTIGRAVITY-SOURCE" || !strings.Contains(fix, "bee antigravity-login") {
		t.Fatal("a missing sign-in", err)
	}
	credential := antigravitySample(time.Now().Add(time.Hour))
	store := antigravityStoreIn(filepath.Dir(config))
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	// Without --verify the command reads the file and nothing else.
	if err := Run(context.Background(), []string{"antigravity-status", "--config", config}, &out); err != nil {
		t.Fatal(err)
	}
	var status map[string]any
	if json.Unmarshal(out.Bytes(), &status) != nil || status["status"] != "available" || status["validation"] != "local_structure_only" || status["plan"] != "pro" || status["email"] != "provider@example.test" ||
		status["project_id"] != "synthetic-project-1" || status["account_fingerprint"] != credential.fingerprint() || status["refresh_token_present"] != true {
		t.Fatalf("status %s", out.String())
	}
	assertNoAntigravitySecrets(t, out.String())

	google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleUserURL:                 googleAnswer(200, `{"id":"`+antigravityTestUser+`","email":"provider@example.test"}`),
		googleProd + "loadCodeAssist": googleAnswer(200, `{"cloudaicompanionProject":"synthetic-project-1","paidTier":{"id":"g1-ultra-tier"}}`),
	}}
	verified, err := readAntigravityStatus(context.Background(), store, true, google)
	if err != nil || verified["validation"] != "google_account_verified" || verified["plan"] != "ultra" || verified["tier"] != "g1-ultra-tier" {
		t.Fatal(err, verified)
	}
	google.answer[googleUserURL] = googleAnswer(200, `{"id":"998877665544332211009","email":"other@example.test"}`)
	if _, err = readAntigravityStatus(context.Background(), store, true, google); err == nil || !strings.Contains(err.Error(), "another account") {
		t.Fatal("a sign-in Google names another account for was verified", err)
	}
	google.answer[googleUserURL] = googleAnswer(401, `{"error":{"code":401,"message":"Request had invalid authentication credentials."}}`)
	if code, _, _, _ := Coded(func() error { _, err := readAntigravityStatus(context.Background(), store, true, google); return err }()); code != "BEE-ANTIGRAVITY-UPSTREAM" {
		t.Fatal("a rejected token was verified", code)
	}
	credential.Rejected = "invalid_grant"
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	if local, err := readAntigravityStatus(context.Background(), store, false, nil); err != nil || local["status"] != "sign_in_rejected" {
		t.Fatal(err, local)
	}
	if code, _, _, _ := Coded(func() error { _, err := readAntigravityStatus(context.Background(), store, true, google); return err }()); code != "BEE-ANTIGRAVITY-SIGNIN" {
		t.Fatal("an ended sign-in was offered to Google", code)
	}
}

func TestMenuAntigravityChecks(t *testing.T) {
	google := antigravityCapabilityGoogle(t, googleDaily)
	google.answer[googleUserURL] = googleAnswer(200, `{"id":"`+antigravityTestUser+`","email":"provider@example.test"}`)
	google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, antigravityTestLoad)
	previous := antigravityTransport
	antigravityTransport = func(context.Context, string) http.RoundTripper { return google }
	defer func() { antigravityTransport = previous }()
	m, out := menuFixture(t, "")
	if err := m.checkAntigravity("local"); err == nil {
		t.Fatal("a check without a sign-in passed")
	} else {
		// The menu has the catalog's words for it in both languages.
		m.reportError(err)
		if !strings.Contains(out.String(), "bee antigravity-login") || !strings.Contains(out.String(), "BEE-ANTIGRAVITY-SOURCE") || strings.Contains(out.String(), "本次操作未完成") {
			t.Fatal(out.String())
		}
	}
	// Signing in from the menu without a browser here: the code is pasted.
	google.answer[googleTokenURL] = googleAnswer(200, antigravityTestTokens)
	m.in.Reset(strings.NewReader("synthetic-code\n"))
	if err := m.antigravityLogin(true); err != nil || !strings.Contains(out.String(), "Signed in to Google as provider@example.test") {
		t.Fatal(err, out.String())
	}
	if stored, err := antigravityStoreIn(filepath.Dir(m.configPath)).read(); err != nil || stored.UserID != antigravityTestUser || stored.Plan != "pro" {
		t.Fatal("the menu's sign-in was not stored", err)
	}
	assertNoAntigravitySecrets(t, out.String())
	out.Reset()
	queries := len(google.calls)
	if err := m.checkAntigravity("local"); err != nil || len(google.calls) != queries {
		t.Fatal("the local check failed or contacted Google", err, google.calls)
	}
	for _, want := range []string{"本地结构检查", "账号指纹", "有效期", "provider@example.test", "pro"} {
		if !strings.Contains(out.String(), want) {
			t.Fatal(want, out.String())
		}
	}
	if err := m.checkAntigravity("verify"); err != nil || !strings.Contains(out.String(), "已向 Google 验证账号与方案") {
		t.Fatal(err, out.String())
	}
	if err := m.checkAntigravity("capabilities"); err != nil || !strings.Contains(out.String(), "gemini-4-carbon") || !strings.Contains(out.String(), "18000") {
		t.Fatal(err, out.String())
	}
	assertNoAntigravitySecrets(t, out.String())
	for code := range problems {
		if _, zh := menuProblemsZH[code]; strings.HasPrefix(code, "BEE-ANTIGRAVITY-") && !zh {
			t.Error("the menu has no Chinese words for", code)
		}
	}
	if platforms := (&managementMenu{}).reason("antigravity_source_unavailable"); platforms == "antigravity_source_unavailable" {
		t.Fatal("the menu has no words for a Google account reason")
	}
}

func TestGoogleIsAPlatformOfEveryCommandThatNamesOne(t *testing.T) {
	config := filepath.Join(t.TempDir(), "bee.json")
	for _, command := range []string{"pause", "resume", "supply-status", "account-status", "confirm-account"} {
		var out bytes.Buffer
		// The platform is accepted; what stops the command is the device.
		if err := Run(context.Background(), []string{command, "--platform", "google", "--config", config}, &out); err == nil || !strings.Contains(err.Error(), "not paired") {
			t.Fatalf("%s --platform google: %v", command, err)
		}
		if err := Run(context.Background(), []string{command, "--platform", "gemini", "--config", config}, &out); err == nil || !strings.Contains(err.Error(), "openai, claude or google") {
			t.Fatalf("%s --platform gemini: %v", command, err)
		}
	}
	for _, command := range []string{"antigravity-login", "antigravity-status"} {
		var out bytes.Buffer
		if err := Run(context.Background(), []string{command, "-h"}, &out); err != nil || !strings.Contains(out.String(), "Usage of bee "+command) {
			t.Fatal(command, err, out.String())
		}
		if !strings.Contains(usage, "bee "+command) {
			t.Fatal("bee help does not list", command)
		}
	}
	if platformName(beewire.GooglePlatform) != "Google (Antigravity)" || sourceName(beewire.GooglePlatform) != "antigravity" || sourceName("claude") != "claude" || !supplyPlatform(beewire.GooglePlatform) || supplyPlatform("gemini") {
		t.Fatal("platform names")
	}
	for _, status := range beewire.AccountStatuses {
		reason := beewire.AccountReason(beewire.GooglePlatform, status)
		if _, ok := supplyReasonLabels[reason]; !ok {
			t.Error("bee status has no words for", reason)
		}
		if e := explainCode(reason); e.Code != reason || e.Category != categoryAction {
			t.Error("the desktop app has no words for", reason)
		}
	}
}
