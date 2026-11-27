package beewire

import (
	"strings"
	"testing"
	"time"
)

func TestAntigravityModelFollowsTheThinkingLevelAnAccountLists(t *testing.T) {
	listed := []string{"gemini-4-carbon", "gemini-4-argon-low", "gemini-4-argon-medium", "gemini-4-argon-high", "gemini-3.8-flash-high", "gemini-3.8-flash-tiered", "gemini-4-neon", "gemini-4-neon-xhigh"}
	for _, test := range []struct{ model, level, want string }{
		// A model listed under its published name takes the level in its body.
		{"gemini-4-carbon", "", "gemini-4-carbon"},
		{"gemini-4-carbon", "low", "gemini-4-carbon"},
		// A model listed only per level is reached by the level's own name,
		// and by the documented default when the request names none.
		{"gemini-4-argon", "low", "gemini-4-argon-low"},
		{"gemini-4-argon", "high", "gemini-4-argon-high"},
		{"gemini-4-argon", "", "gemini-4-argon-medium"},
		// A level the account does not list falls to one it does.
		{"gemini-4-argon", "xhigh", "gemini-4-argon-high"},
		{"gemini-3.8-flash", "medium", "gemini-3.8-flash-high"},
		{"gemini-3.8-flash", "", "gemini-3.8-flash-high"},
		{"gemini-4-neon", "xhigh", "gemini-4-neon-xhigh"},
		{"gemini-4-neon", "", "gemini-4-neon"},
		{"gemini-4-hydrogen", "", ""},
		{"gemini-4", "", ""},
	} {
		if got := AntigravityModel(listed, nil, test.model, test.level); got != test.want {
			t.Errorf("%s at %q: got %q, want %q", test.model, test.level, got, test.want)
		}
	}
}

func TestGoogleCapabilities(t *testing.T) {
	now := time.Now()
	used, exhausted := 20, 100
	five := QuotaWindow{Seconds: 18000, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	week := QuotaWindow{Seconds: 604800, UsedPercent: &used, ResetAt: now.Add(24 * time.Hour)}
	c := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "pro", Models: []string{"gemini-4-argon-medium", "gemini-4-carbon"}, Windows: []QuotaWindow{five, week}}
	if !c.ValidFor(GooglePlatform, now) {
		t.Fatal("a Pro account with both windows was rejected")
	}
	if c.ReasonFor(GooglePlatform, now, "gemini-4-argon") != "" || c.ReasonFor(GooglePlatform, now, "gemini-4-carbon") != "" {
		t.Fatal("a catalog model the account lists per level was not available")
	}
	if c.ReasonFor(GooglePlatform, now, "gemini-4-neon") != ReasonModelUnavailable {
		t.Fatal("a model the account does not list was available")
	}
	for _, plan := range SubscriptionPlans(GooglePlatform) {
		c.Plan = plan
		if !c.ValidFor(GooglePlatform, now) {
			t.Fatal("known Google plan rejected", plan)
		}
	}
	for _, plan := range []string{"", "plus", "max", "g1-pro-tier"} {
		c.Plan = plan
		if c.ValidFor(GooglePlatform, now) {
			t.Fatal("unknown Google plan accepted", plan)
		}
	}
	c.Plan = "free"
	// An account without a paid tier is refreshed weekly only.
	for _, windows := range [][]QuotaWindow{{week}, {five}, {five, week}} {
		c.Windows = windows
		if !c.ValidFor(GooglePlatform, now) {
			t.Fatalf("Google windows rejected: %+v", windows)
		}
	}
	scoped := QuotaWindow{Scope: "sonnet", Seconds: 604800, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	month := QuotaWindow{Seconds: 2592000, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	for _, windows := range [][]QuotaWindow{{}, {week, week}, {five, week, scoped}, {scoped}, {month}} {
		c.Windows = windows
		if c.ValidFor(GooglePlatform, now) {
			t.Fatalf("Google windows accepted: %+v", windows)
		}
	}
	c.Windows = []QuotaWindow{five, {Seconds: 604800, UsedPercent: &exhausted, ResetAt: now.Add(time.Hour)}}
	if !c.ValidFor(GooglePlatform, now) || c.ReasonFor(GooglePlatform, now, "gemini-4-carbon") != ReasonQuotaExhausted {
		t.Fatal("an exhausted weekly window did not stop the account")
	}
	c.Windows = []QuotaWindow{five, week}
	// Antigravity lists a model once per thinking level, so the list is long;
	// it is still bounded, and it names no client release.
	c.Models = nil
	for i := 0; i < 128; i++ {
		c.Models = append(c.Models, "gemini-model-"+strings.Repeat("x", i%7)+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if !c.ValidFor(GooglePlatform, now) {
		t.Fatal("128 models rejected for Google")
	}
	if c.ValidFor("openai", now) {
		t.Fatal("the Google model bound leaked to OpenAI")
	}
	c.Models = append(c.Models, "gemini-one-too-many")
	if c.ValidFor(GooglePlatform, now) {
		t.Fatal("129 models accepted")
	}
	c.Models, c.ClientVersion = []string{"gemini-4-carbon"}, "2.23.0"
	if c.ValidFor(GooglePlatform, now) {
		t.Fatal("a Google report named a client release")
	}
}

func TestMaintenanceRequestNamesOnePlatform(t *testing.T) {
	auth := func(project string) *Authorization {
		return &Authorization{AccountID: "1234567890", AccountFingerprint: strings.Repeat("ab", 32), ExpiresAt: time.Now().Add(time.Hour), CredentialRevision: strings.Repeat("cd", 32), ProjectID: project}
	}
	if platform, got, valid := (MaintenanceRequest{Antigravity: auth("useful-project-1a2b3")}).Authorization(); platform != GooglePlatform || !valid || got.ProjectID != "useful-project-1a2b3" {
		t.Fatal("a Google authorization with its project was refused")
	}
	for _, project := range []string{"", "projects/one", "a b", strings.Repeat("p", 129)} {
		if _, _, valid := (MaintenanceRequest{Antigravity: auth(project)}).Authorization(); valid {
			t.Fatalf("a Google authorization was accepted with project %q", project)
		}
	}
	if _, _, valid := (MaintenanceRequest{Antigravity: auth("project"), Claude: auth("")}).Authorization(); valid {
		t.Fatal("one request maintained two platforms")
	}
	if _, _, valid := (MaintenanceRequest{Antigravity: auth("project"), Codex: *auth("")}).Authorization(); valid {
		t.Fatal("one request maintained two platforms")
	}
	// Only Google names a project.
	if platform, _, valid := (MaintenanceRequest{Claude: auth("project")}).Authorization(); platform != "claude" || valid {
		t.Fatal("a Claude authorization named a project")
	}
	if platform, _, valid := (MaintenanceRequest{Codex: *auth("project")}).Authorization(); platform != "openai" || valid {
		t.Fatal("an OpenAI authorization named a project")
	}
	if platform, _, valid := (MaintenanceRequest{Claude: auth("")}).Authorization(); platform != "claude" || !valid {
		t.Fatal("a Claude authorization was refused")
	}
}

func TestAntigravityHostFollowsThePlan(t *testing.T) {
	for plan, want := range map[string]string{"free": AntigravityHost, "": AntigravityHost, "pro": AntigravityDailyHost, "ultra": AntigravityDailyHost} {
		if got := AntigravityHostFor(plan); got != want {
			t.Errorf("plan %q: got %s, want %s", plan, got, want)
		}
	}
	if AccountReason(GooglePlatform, "source_unavailable") != "antigravity_source_unavailable" {
		t.Fatal("a Google account reason lost its prefix")
	}
}

func TestGoogleClaudeWindowsStopOnlyTheClaudeModels(t *testing.T) {
	now := time.Now()
	window := func(scope string, seconds, percent int) QuotaWindow {
		p := percent
		return QuotaWindow{Scope: scope, Seconds: seconds, UsedPercent: &p, ResetAt: now.Add(time.Hour)}
	}
	c := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "ultra",
		Models:  []string{"gemini-4-carbon", "claude-opus-5-5-high", "claude-opus-4-6-thinking"},
		Windows: []QuotaWindow{window("", 18000, 20), window("", 604800, 20), window(GoogleClaudeScope, 18000, 20), window(GoogleClaudeScope, 604800, 100)}}
	if !c.ValidFor(GooglePlatform, now) {
		t.Fatal("a report with both groups' windows was rejected")
	}
	// The Claude group is used up; the Gemini models go on.
	if c.ReasonFor(GooglePlatform, now, "claude-opus-5-5") != ReasonQuotaExhausted || c.ReasonFor(GooglePlatform, now, "gemini-4-carbon") != "" {
		t.Fatal("the Claude group's windows did not stop only the Claude models")
	}
	// And the other way round.
	c.Windows = []QuotaWindow{window("", 604800, 100), window(GoogleClaudeScope, 604800, 20)}
	if !c.ValidFor(GooglePlatform, now) || c.ReasonFor(GooglePlatform, now, "gemini-4-carbon") != ReasonQuotaExhausted || c.ReasonFor(GooglePlatform, now, "claude-opus-5-5") != "" {
		t.Fatal("the Gemini group's windows did not stop only the Gemini models")
	}
	// A Claude model listed only as its thinking variant is still served.
	if c.ReasonFor(GooglePlatform, now, "claude-opus-4-6") != "" || AntigravityModel(c.Models, nil, "claude-opus-4-6", "") != "claude-opus-4-6-thinking" {
		t.Fatal("the thinking variant was not found")
	}
	for _, windows := range [][]QuotaWindow{
		{window(GoogleClaudeScope, 604800, 20), window(GoogleClaudeScope, 604800, 20)},
		{window("opus", 604800, 20)},
		{window("", 18000, 20), window("", 604800, 20), window(GoogleClaudeScope, 18000, 20), window(GoogleClaudeScope, 604800, 20), window(GoogleClaudeScope, 604800, 20)},
	} {
		c.Windows = windows
		if c.ValidFor(GooglePlatform, now) {
			t.Fatalf("Google windows accepted: %+v", windows)
		}
	}
	// A Claude account's windows keep their own scopes.
	claude := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "pro", Models: []string{"claude-opus-5-5"}, Windows: []QuotaWindow{window("", 18000, 20), window("", 604800, 20), window(GoogleClaudeScope, 604800, 20)}}
	if claude.ValidFor("claude", now) {
		t.Fatal("the Google Claude scope was accepted on a Claude account")
	}
}
