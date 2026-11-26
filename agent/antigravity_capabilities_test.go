package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// antigravityCapturedQuota is a retrieveUserQuotaSummary response as a
// consumer Ultra account received it on 2026-11-04.
const antigravityCapturedQuota = `{"groups":[
 {"buckets":[{"bucketId":"gemini-weekly","displayName":"Weekly Limit Remaining","window":"weekly","resetTime":"2026-11-11T15:52:48Z","remainingFraction":0.75},
             {"bucketId":"gemini-5h","displayName":"Five Hour Limit Remaining","window":"5h","resetTime":"2026-11-04T20:52:48Z","remainingFraction":0.4}],
  "displayName":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro"},
 {"buckets":[{"bucketId":"3p-weekly","window":"weekly","resetTime":"2026-11-11T15:52:48Z","remainingFraction":1},{"bucketId":"3p-5h","window":"5h","remainingFraction":1}],
  "displayName":"Claude and GPT models"}],
 "description":"Within each group, models share a weekly limit and a 5-hour limit."}`

func antigravityQuotaFrom(t *testing.T, raw string) antigravityQuota {
	t.Helper()
	var summary antigravityQuota
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatal(err)
	}
	return summary
}

func TestAntigravityQuotaReadsTheGeminiWindows(t *testing.T) {
	observed := time.Date(2026, 11, 4, 16, 0, 0, 0, time.UTC)
	windows, reason := parseAntigravityQuota(antigravityQuotaFrom(t, antigravityCapturedQuota), observed)
	if reason != "" || len(windows) != 2 {
		t.Fatal(reason, windows)
	}
	five, week := windows[0], windows[1]
	if five.Seconds != 18000 || *five.UsedPercent != 60 || !five.ResetAt.Equal(time.Date(2026, 11, 4, 20, 52, 48, 0, time.UTC)) || five.Scope != "" {
		t.Fatalf("five-hour window %+v used=%d", five, *five.UsedPercent)
	}
	if week.Seconds != 604800 || *week.UsedPercent != 25 || !week.ResetAt.Equal(time.Date(2026, 11, 11, 15, 52, 48, 0, time.UTC)) || week.Scope != "" {
		t.Fatalf("weekly window %+v used=%d", week, *week.UsedPercent)
	}
	snapshot := beewire.Capabilities{Sequence: 1, ObservedAt: observed, Status: "ready", Plan: "ultra", Models: []string{"gemini-4-carbon"}, Windows: windows}
	if !snapshot.ValidFor(beewire.GooglePlatform, observed) {
		t.Fatal("the captured windows do not make a report Hive accepts")
	}

	for name, test := range map[string]struct {
		body string
		used []int
	}{
		// A window nothing has used has not started and names no reset.
		"idle":      {`{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","remainingFraction":1},{"bucketId":"gemini-weekly","window":"weekly","remainingFraction":1}]}]}`, []int{0, 0}},
		"exhausted": {`{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","resetTime":"2026-11-04T17:00:00Z"},{"bucketId":"gemini-weekly","window":"weekly","resetTime":"2026-11-08T00:00:00Z","remainingFraction":0.004}]}]}`, []int{100, 100}},
		"weekly":    {`{"groups":[{"buckets":[{"bucketId":"gemini-weekly","window":"weekly","resetTime":"2026-11-08T00:00:00Z","remainingFraction":0.5},{"bucketId":"gemini-monthly","window":"monthly","remainingFraction":0.1}]}]}`, []int{50}},
		"clamped":   {`{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","resetTime":"2026-11-04T17:00:00Z","remainingFraction":1.4},{"bucketId":"gemini-weekly","window":"weekly","resetTime":"2026-11-08T00:00:00Z","remainingFraction":-3}]}]}`, []int{0, 100}},
	} {
		windows, reason := parseAntigravityQuota(antigravityQuotaFrom(t, test.body), observed)
		if reason != "" || len(windows) != len(test.used) {
			t.Fatalf("%s: %s %v", name, reason, windows)
		}
		for i, window := range windows {
			if *window.UsedPercent != test.used[i] || !window.ResetAt.After(observed) || window.ResetAt.After(observed.Add(time.Duration(window.Seconds)*time.Second)) {
				t.Fatalf("%s: window %d used=%d reset=%s", name, i, *window.UsedPercent, window.ResetAt)
			}
		}
	}
	for name, body := range map[string]string{
		"no groups":       `{}`,
		"no Gemini group": `{"groups":[{"buckets":[{"bucketId":"3p-5h","window":"5h","remainingFraction":1}]}]}`,
		"empty group":     `{"groups":[{"displayName":"Gemini Models","buckets":[]}]}`,
		"unknown windows": `{"groups":[{"buckets":[{"bucketId":"gemini-daily","window":"daily","remainingFraction":1}]}]}`,
		"reset in past":   `{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","resetTime":"2026-11-04T15:59:59Z","remainingFraction":0.5}]}]}`,
		"unreadable time": `{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","resetTime":"soon","remainingFraction":0.5}]}]}`,
		"window twice":    `{"groups":[{"buckets":[{"bucketId":"gemini-5h","window":"5h","remainingFraction":1},{"bucketId":"gemini-flash-5h","window":"5h","remainingFraction":0.2}]}]}`,
	} {
		if windows, reason := parseAntigravityQuota(antigravityQuotaFrom(t, body), observed); reason == "" || windows != nil {
			t.Fatalf("%s was read as quota: %v", name, windows)
		}
	}
}

// antigravityQuotaNow is the captured response with reset times that lie
// ahead of the test's clock.
func antigravityQuotaNow() string {
	now := time.Now().UTC()
	body := strings.ReplaceAll(antigravityCapturedQuota, "2026-11-11T15:52:48Z", now.Add(100*time.Hour).Format(time.RFC3339))
	return strings.ReplaceAll(body, "2026-11-04T20:52:48Z", now.Add(3*time.Hour).Format(time.RFC3339))
}

const antigravityTestModels = `{"models":{
 "gemini-4-argon-high":{"displayName":"Gemini 4 Argon","quotaInfo":{"remainingFraction":0.4,"resetTime":"2026-11-04T20:52:48Z"},"supportsThinking":true},
 "gemini-4-argon-low":{"quotaInfo":{"remainingFraction":0.4}},
 "gemini-4-carbon":{"quotaInfo":{"remainingFraction":0.4}},
 "gemini-3.8-flash-tiered":{},
 "gemini-3.1-flash-image":{"supportsImages":true},
 "gemini-2.5-flash-image-preview":{},
 "claude-sonnet-4-5":{"quotaInfo":{"remainingFraction":1}},
 "gpt-oss-120b-medium":{},
 "tab_flash_lite_preview":{},
 "gemini-bad model":{}},
 "deprecatedModelIds":{"gemini-3-pro-high":{"newModelId":"gemini-pro-agent"}}}`

func antigravityCapabilityGoogle(t *testing.T, base string) *googleFake {
	t.Helper()
	check := func(r *http.Request, body string, wantBody string) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+antigravityTestAccess || r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("User-Agent") != beewire.AntigravityUserAgent(beewire.AntigravityClientVersion) {
			t.Errorf("%s headers %v", r.URL.Path, r.Header)
		}
		if wantBody != "" && body != wantBody {
			t.Errorf("%s body %s", r.URL.Path, body)
		}
	}
	return &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		base + "loadCodeAssist": func(r *http.Request, body string) (int, string) {
			check(r, body, "")
			return 200, antigravityTestLoad
		},
		base + "fetchAvailableModels": func(r *http.Request, body string) (int, string) {
			check(r, body, `{"project":"synthetic-project-1"}`)
			return 200, antigravityTestModels
		},
		base + "retrieveUserQuotaSummary": func(r *http.Request, body string) (int, string) {
			check(r, body, `{"project":"synthetic-project-1"}`)
			return 200, antigravityQuotaNow()
		},
	}}
}

func TestAntigravityCapabilitiesReportModelsPlanAndWindows(t *testing.T) {
	// A Pro account is served from daily, and only daily is asked.
	credential := antigravitySample(time.Now().Add(time.Hour))
	google := antigravityCapabilityGoogle(t, googleDaily)
	var source antigravityCapabilitySource
	snapshot := source.observe(context.Background(), credential, 7, google)
	if snapshot.Status != "ready" || source.failure != "" || source.problem != nil {
		t.Fatal(snapshot.Status, source.failure, source.problem)
	}
	if want := []string{"gemini-3.8-flash-tiered", "gemini-4-argon-high", "gemini-4-argon-low", "gemini-4-carbon"}; !slices.Equal(snapshot.Models, want) {
		t.Fatalf("models %v, want %v", snapshot.Models, want)
	}
	if snapshot.Plan != "pro" || snapshot.ClientVersion != "" || snapshot.Sequence != 7 || snapshot.Credits != nil || len(snapshot.Windows) != 2 ||
		snapshot.Windows[0].Seconds != 18000 || *snapshot.Windows[0].UsedPercent != 60 || snapshot.Windows[1].Seconds != 604800 || *snapshot.Windows[1].UsedPercent != 25 {
		t.Fatalf("snapshot %+v", snapshot)
	}
	if !snapshot.ValidFor(beewire.GooglePlatform, time.Now()) || snapshot.ReasonFor(beewire.GooglePlatform, time.Now(), "gemini-4-argon") != "" || snapshot.ReasonFor(beewire.GooglePlatform, time.Now(), "gemini-4-neon") != beewire.ReasonModelUnavailable {
		t.Fatal("Hive would not take the report, or not find a catalog model in it")
	}
	if len(google.calls) != 3 {
		t.Fatalf("queries %v", google.calls)
	}
	// Within the usage interval nothing is asked again; after it only the quota is.
	if again := source.observe(context.Background(), credential, 8, google); again.Status != "ready" || again.Sequence != 8 || len(google.calls) != 3 {
		t.Fatal("a current observation was queried again", google.calls)
	}
	source.cachedAt = source.cachedAt.Add(-capabilityTTL)
	later := source.observe(context.Background(), credential, 9, google)
	if later.Status != "ready" || len(google.calls) != 4 || google.count(googleDaily+"retrieveUserQuotaSummary") != 2 || !later.MetadataObservedAt.Equal(snapshot.MetadataObservedAt) || !slices.Equal(later.Models, snapshot.Models) {
		t.Fatalf("usage refresh: %v", google.calls)
	}
	// The command reads the same thing and prints no token.
	_, store := antigravityFixture(t, credential)
	var out bytes.Buffer
	if err := inspectAntigravityCapabilities(context.Background(), store, google, &out); err != nil || !strings.Contains(out.String(), `"plan":"pro"`) {
		t.Fatal(err, out.String())
	}
	assertNoAntigravitySecrets(t, out.String())
}

func TestAntigravityCapabilitiesUseTheEndpointOfThePlan(t *testing.T) {
	// A free account is served from production.
	free := antigravitySample(time.Now().Add(time.Hour))
	free.Tier, free.Plan = "free-tier", "free"
	google := antigravityCapabilityGoogle(t, googleProd)
	google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"cloudaicompanionProject":"synthetic-project-1","currentTier":{"id":"free-tier"}}`)
	var source antigravityCapabilitySource
	if snapshot := source.observe(context.Background(), free, 1, google); snapshot.Status != "ready" || snapshot.Plan != "free" {
		t.Fatal(snapshot.Status, source.failure)
	}

	// The stored plan is from the last refresh. Google names the plan the
	// account has now, and models and quota are read where that one is served.
	google = antigravityCapabilityGoogle(t, googleDaily)
	google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"cloudaicompanionProject":"synthetic-project-1","paidTier":{"id":"g1-ultra-tier"}}`)
	source = antigravityCapabilitySource{}
	snapshot := source.observe(context.Background(), free, 1, google)
	if snapshot.Status != "ready" || snapshot.Plan != "ultra" || google.count(googleProd+"loadCodeAssist") != 1 || google.count(googleDaily+"fetchAvailableModels") != 1 || google.count(googleDaily+"retrieveUserQuotaSummary") != 1 {
		t.Fatal(snapshot.Status, source.failure, google.calls)
	}
	// The metadata stays current until the stored plan changes, not on every
	// observation the stored plan still lags behind.
	source.cachedAt = source.cachedAt.Add(-capabilityTTL)
	if again := source.observe(context.Background(), free, 2, google); again.Status != "ready" || google.count(googleProd+"loadCodeAssist") != 1 {
		t.Fatal("metadata was read again although nothing changed", google.calls)
	}
}

func TestAntigravityCapabilitiesAreUnknownWhenTheAnswerIsNot(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	for name, change := range map[string]func(*googleFake){
		"no Gemini group": func(g *googleFake) {
			g.answer[googleDaily+"retrieveUserQuotaSummary"] = googleAnswer(200, `{"groups":[{"buckets":[{"bucketId":"3p-5h","window":"5h","remainingFraction":1}]}]}`)
		},
		"empty quota":    func(g *googleFake) { g.answer[googleDaily+"retrieveUserQuotaSummary"] = googleAnswer(200, `{}`) },
		"quota not JSON": func(g *googleFake) { g.answer[googleDaily+"retrieveUserQuotaSummary"] = googleAnswer(200, `<html>`) },
		"no models":      func(g *googleFake) { g.answer[googleDaily+"fetchAvailableModels"] = googleAnswer(200, `{}`) },
		"server error": func(g *googleFake) {
			g.answer[googleDaily+"fetchAvailableModels"] = googleAnswer(503, `{"error":{"code":503}}`)
		},
		"unreachable": func(g *googleFake) { g.answer[googleDaily+"loadCodeAssist"] = googleAnswer(0, "") },
		"unknown tier": func(g *googleFake) {
			g.answer[googleDaily+"loadCodeAssist"] = googleAnswer(200, `{"cloudaicompanionProject":"synthetic-project-1","currentTier":{"id":"standard-tier"}}`)
		},
	} {
		t.Run(name, func(t *testing.T) {
			google := antigravityCapabilityGoogle(t, googleDaily)
			change(google)
			var source antigravityCapabilitySource
			snapshot := source.observe(context.Background(), credential, 1, google)
			if snapshot.Status != "unknown" || source.failure == "" || len(snapshot.Models) != 0 || len(snapshot.Windows) != 0 || snapshot.Plan != "" || !snapshot.ValidFor(beewire.GooglePlatform, time.Now()) {
				t.Fatalf("status=%s failure=%q", snapshot.Status, source.failure)
			}
			assertNoAntigravitySecrets(t, source.failure)
			// No answer from one endpoint is not made up for on the other.
			for _, call := range google.calls {
				if strings.HasPrefix(call, googleProd) {
					t.Fatal("a quota query crossed to the other endpoint", call)
				}
			}
			if code, _, _, _ := Coded(source.problem); (name == "unknown tier") != (code == "BEE-ANTIGRAVITY-TIER") {
				t.Fatal("problem", code)
			}
		})
	}
	// A token that has run out is not offered to Google at all.
	var source antigravityCapabilitySource
	if snapshot := source.observe(context.Background(), antigravitySample(time.Now().Add(-time.Minute)), 1, &googleFake{t: t}); snapshot.Status != "unknown" || !strings.Contains(source.failure, "expired") {
		t.Fatal(snapshot.Status, source.failure)
	}
}

func TestAntigravityCapabilitiesHonourGooglesCooldown(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	for name, test := range map[string]struct {
		body     string
		min, max time.Duration
	}{
		// The bodies Google sends, as sub2api recorded them.
		"quota reset":   {`{"error":{"code":429,"message":"You have exhausted your capacity on this model. Your quota will reset after 2h.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"QUOTA_EXHAUSTED","metadata":{"quotaResetDelay":"2h0m0s"}}]}}`, 59 * time.Minute, time.Hour},
		"retry info":    {`{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","metadata":{"model":"gemini-3-pro-high"},"reason":"RATE_LIMIT_EXCEEDED"},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"39s"}]}}`, 38 * time.Second, 39 * time.Second},
		"moments":       {`{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","domain":"cloudcode-pa.googleapis.com","metadata":{"model":"claude-sonnet-4-5","quotaResetDelay":"201.506475ms"},"reason":"RATE_LIMIT_EXCEEDED"},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0.201506475s"}],"message":"You have exhausted your capacity on this model.","status":"RESOURCE_EXHAUSTED"}}`, 29 * time.Second, 30 * time.Second},
		"names no time": {`{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}`, capabilityBackoff - time.Second, capabilityBackoff},
		"not JSON":      {`Too Many Requests`, capabilityBackoff - time.Second, capabilityBackoff},
	} {
		t.Run(name, func(t *testing.T) {
			google := antigravityCapabilityGoogle(t, googleDaily)
			google.answer[googleDaily+"retrieveUserQuotaSummary"] = googleAnswer(429, test.body)
			source := antigravityCapabilitySource{cooldown: cooldownStore{path: filepath.Join(t.TempDir(), "capability-cooldown.json")}}
			snapshot := source.observe(context.Background(), credential, 1, google)
			if snapshot.Status != "rate_limited" || snapshot.RetryAt == nil || !snapshot.ValidFor(beewire.GooglePlatform, time.Now()) {
				t.Fatal(snapshot.Status, source.failure)
			}
			if wait := time.Until(*snapshot.RetryAt); wait < test.min || wait > test.max {
				t.Fatalf("cooldown %s, want %s..%s", wait, test.min, test.max)
			}
			queries := len(google.calls)
			if again := source.observe(context.Background(), credential, 2, google); again.Status != "rate_limited" || len(google.calls) != queries {
				t.Fatal("the endpoint was queried during its cooldown")
			}
			// A restart serves the same cooldown, for this account only.
			restarted := antigravityCapabilitySource{cooldown: source.cooldown}
			if again := restarted.observe(context.Background(), credential, 1, google); again.Status != "rate_limited" || len(google.calls) != queries || !again.RetryAt.Equal(*snapshot.RetryAt) {
				t.Fatal("a restart did not adopt the cooldown")
			}
			other := credential
			other.UserID = "998877665544332211009"
			google.answer[googleDaily+"retrieveUserQuotaSummary"] = googleAnswer(200, antigravityQuotaNow())
			another := antigravityCapabilitySource{cooldown: source.cooldown}
			if ready := another.observe(context.Background(), other, 1, google); ready.Status != "ready" {
				t.Fatal("another account inherited the cooldown", another.failure)
			}
		})
	}
}

func TestAntigravityCapabilitiesNameWhyGoogleRefusesTheAccount(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	for name, test := range map[string]struct {
		body, code, cause, detail string
	}{
		"disabled":     {`{"error":{"code":403,"message":"Gemini has been disabled in this account for violation of Terms of Service. If you believe this is an error, please appeal.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"TOS_VIOLATION","domain":"cloudcode-pa.googleapis.com","metadata":{"appeal_url":"https://support.google.com/accounts/troubleshooter/2402620?ref=synthetic&x=1"}}]}}`, "BEE-ANTIGRAVITY-DISABLED", "Google has disabled Antigravity for this account", "https://support.google.com/accounts/troubleshooter/2402620?ref=synthetic&x=1"},
		"verification": {`{"error":{"code":403,"message":"Verify your account to continue.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"VALIDATION_REQUIRED","metadata":{"validation_url":"https://accounts.google.com/signin/continue?sarp=1&scc=1"}}]}}`, "BEE-ANTIGRAVITY-VERIFY", "Google asks you to verify this account", "https://accounts.google.com/signin/continue?sarp=1&scc=1"},
		"link in text": {`{"error":{"code":403,"message":"Please verify your account at https://accounts.google.com/verify?t=synthetic to continue","status":"PERMISSION_DENIED"}}`, "BEE-ANTIGRAVITY-VERIFY", "verify this account", "https://accounts.google.com/verify?t=synthetic"},
		"forbidden":    {`{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED","details":[{"reason":"SUBSCRIPTION_REQUIRED","metadata":{"appeal_url":"javascript:alert(1)"}}]}}`, "BEE-ANTIGRAVITY-FORBIDDEN", "Google refused this account's Antigravity request", "HTTP 403"},
	} {
		t.Run(name, func(t *testing.T) {
			google := antigravityCapabilityGoogle(t, googleDaily)
			google.answer[googleDaily+"fetchAvailableModels"] = googleAnswer(403, test.body)
			var source antigravityCapabilitySource
			snapshot := source.observe(context.Background(), credential, 1, google)
			code, summary, fix, _ := Coded(source.problem)
			if snapshot.Status != "unknown" || !snapshot.ValidFor(beewire.GooglePlatform, time.Now()) || code != test.code || !strings.Contains(summary, test.cause) || !strings.Contains(summary, test.detail) || fix == "" {
				t.Fatalf("status=%s problem=%v", snapshot.Status, source.problem)
			}
			// What Google names is offered to open only when it is an address.
			if strings.Contains(summary, "javascript:alert(1) (") {
				t.Fatal("something that is no address was offered to open")
			}
			// The operator is shown it once, in the catalog's words.
			var out bytes.Buffer
			source.announce(&out)
			source.announce(&out)
			if strings.Count(out.String(), test.cause) != 1 {
				t.Fatalf("announced %q", out.String())
			}
			assertNoAntigravitySecrets(t, out.String()+summary)
			if source.wantsRefresh(antigravityDigest(credential.AccessToken), time.Now()) {
				t.Fatal("a refused account asked for a refresh")
			}
			// The command returns the same problem.
			_, store := antigravityFixture(t, credential)
			if _, err := readAntigravityCapabilities(context.Background(), store, google); err == nil || !strings.Contains(err.Error(), test.code) {
				t.Fatal("antigravity-status --capabilities hid the refusal", err)
			}
		})
	}
}

// Google answering 401 to a token that has time left is the token going
// stale, which a refresh mends: Hive is asked for one, once.
func TestAntigravityCapabilitiesAskForARefreshOnAStaleToken(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	directory, _ := antigravityFixture(t, credential)
	hive := newAntigravityHive(t, credential, "")
	reports := 0
	hive.capabilityReport = func(report beewire.CapabilityReport) int {
		reports++
		if report.Status != "unknown" || report.Lease != "lease" || report.AccountGeneration != 1 || report.AccountFingerprint != credential.fingerprint() || report.CredentialRevision != antigravityDigest(credential.AccessToken) {
			t.Errorf("report %+v", report)
		}
		return 200
	}
	google := antigravityCapabilityGoogle(t, googleDaily)
	google.answer[googleDaily+"loadCodeAssist"] = googleAnswer(401, `{"error":{"code":401,"message":"Invalid bearer token","status":"UNAUTHENTICATED"}}`)
	source := &antigravitySource{directory: directory, Capabilities: true, transport: google}
	var output bytes.Buffer
	if err := source.synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil {
		t.Fatal(err)
	}
	if reports != 1 || hive.maintained.RefreshRequired || !source.capabilities.wantsRefresh(antigravityDigest(credential.AccessToken), time.Now()) {
		t.Fatal("the stale token was not noticed", reports)
	}
	if err := source.synchronize(context.Background(), hive.state(), "lease", &output, false); err != nil || !hive.maintained.RefreshRequired || hive.maintenances.Load() != 2 {
		t.Fatal("Hive was not asked to refresh the stale token", err)
	}
	for range 2 {
		if err := source.synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil || hive.maintained.RefreshRequired {
			t.Fatal("the same token asked for a refresh twice", err)
		}
	}
	assertNoAntigravitySecrets(t, output.String())
}

func TestAntigravityRuntimeReportsCapabilitiesToHive(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	directory, _ := antigravityFixture(t, credential)
	hive := newAntigravityHive(t, credential, "")
	hive.account.SourceValidUntil = time.Now().Add(45 * time.Second)
	var reports []beewire.CapabilityReport
	hive.capabilityReport = func(report beewire.CapabilityReport) int {
		reports = append(reports, report)
		return 200
	}
	google := antigravityCapabilityGoogle(t, googleDaily)
	cfg := &egressConfig{Targets: []string{beewire.AntigravityHost, beewire.AntigravityDailyHost}, Antigravity: &antigravitySource{Capabilities: true, transport: google}}
	cfg.useStateDirectory(directory)
	sources := cfg.fileSources()
	if len(sources) != 1 || sources[0].name != "antigravity" || sources[0].platform != beewire.GooglePlatform || sources[0].label() != "Google" || sources[0].wanted == nil {
		t.Fatalf("sources %+v", sources)
	}
	var output bytes.Buffer
	if err := sources[0].synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil {
		t.Fatal(err)
	}
	if len(reports) != 1 || reports[0].Status != "ready" || reports[0].Plan != "pro" || len(reports[0].Models) != 4 || len(reports[0].Windows) != 2 || reports[0].ClientVersion != "" || reports[0].ReuseMetadata ||
		reports[0].AccountFingerprint != credential.fingerprint() || reports[0].CredentialRevision != antigravityDigest(credential.AccessToken) || !reports[0].ValidFor(beewire.GooglePlatform, time.Now()) {
		t.Fatalf("reports %+v", reports)
	}
	// A quiet cycle idles; Hive asking for a report is answered once the
	// last attempt is far enough back, with the metadata Hive already has.
	if err := sources[0].synchronize(context.Background(), hive.state(), "lease", &output, false); err != nil || len(reports) != 1 || hive.maintenances.Load() != 1 {
		t.Fatal("a quiet cycle talked to Hive", err, len(reports))
	}
	cfg.control(beewire.Control{Control: beewire.ControlCapabilities, Platform: beewire.GooglePlatform})
	if !cfg.antigravityCapabilityWanted.Load() {
		t.Fatal("Hive's capability request did not reach the source")
	}
	cfg.Antigravity.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if err := cfg.Antigravity.synchronize(context.Background(), hive.state(), "lease", &output, false); err != nil || len(reports) != 2 || !reports[1].ReuseMetadata || reports[1].Plan != "" || len(reports[1].Models) != 0 || len(reports[1].Windows) != 2 || cfg.antigravityCapabilityWanted.Load() {
		t.Fatalf("requested report: %v %+v", err, reports)
	}
	assertNoAntigravitySecrets(t, output.String())
}

func TestAntigravityModelsAreTheGeminiTextModels(t *testing.T) {
	listed := map[string]json.RawMessage{"gemini-pro-agent": nil, "gemini-2.5-flash": nil, "gemini-3-pro-image": nil, "Gemini-upper": nil, "gemini-": nil, "claude-opus-4-5": nil, "models/gemini-2.5-pro": nil}
	if got := antigravityModels(listed); !slices.Equal(got, []string{"gemini-", "gemini-2.5-flash", "gemini-pro-agent"}) {
		t.Fatal(got)
	}
	for i := range 200 {
		listed[fmt.Sprintf("gemini-synthetic-%03d", i)] = nil
	}
	got := antigravityModels(listed)
	if len(got) != 128 || !slices.IsSorted(got) || !beewire.ValidModelIDs(got) {
		t.Fatal("the listing is not bounded to what a report may carry", len(got))
	}
	if got := antigravityModels(map[string]json.RawMessage{}); got == nil || len(got) != 0 {
		t.Fatal("an empty listing", got)
	}
}
