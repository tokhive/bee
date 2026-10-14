package beewire

import (
	"testing"
	"time"
)

func TestCapabilityUsageAndMetadataExpireIndependently(t *testing.T) {
	now := time.Now()
	used := 10
	for _, platform := range []string{"openai", "claude"} {
		c := Capabilities{Sequence: 1, Status: "ready", Plan: "pro", ObservedAt: now.Add(-5 * time.Minute), MetadataObservedAt: now.Add(-4 * time.Hour), Models: []string{}, Windows: []QuotaWindow{{Seconds: 18000, UsedPercent: &used, ResetAt: now.Add(time.Hour)}, {Seconds: 604800, UsedPercent: &used, ResetAt: now.Add(time.Hour)}}}
		if !c.ValidFor(platform, now) || c.ReasonFor(platform, now, "") != "" {
			t.Fatal("five-minute snapshot expired", platform)
		}
		c.ObservedAt = now.Add(-6 * time.Minute)
		if c.ValidFor(platform, now) || c.ReasonFor(platform, now, "") != "capabilities_unknown" {
			t.Fatal("six-minute snapshot accepted", platform)
		}
		c.ObservedAt = now
		c.MetadataObservedAt = now.Add(-CapabilityMetadataInterval - CapabilityLifetime)
		if c.ValidFor(platform, now) || c.ReasonFor(platform, now, "") != "capabilities_unknown" {
			t.Fatal("fresh usage revived expired metadata", platform)
		}
	}
}

func TestCapabilityPlatformWindowsAndModelScopes(t *testing.T) {
	now := time.Now()
	used, exhausted := 20, 100
	five := QuotaWindow{Seconds: 18000, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	week := QuotaWindow{Seconds: 604800, UsedPercent: &used, ResetAt: now.Add(24 * time.Hour)}
	c := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "pro", Models: []string{"claude-sonnet-4-6", "claude-haiku-4-5-20251001"}, Windows: []QuotaWindow{week}}
	if !c.Valid(now) || c.ValidFor("claude", now) {
		t.Fatal("ChatGPT Pro exception leaked to Claude")
	}
	c.Windows = []QuotaWindow{five, week, {Scope: "sonnet", Seconds: 604800, UsedPercent: &exhausted, ResetAt: now.Add(time.Hour)}}
	if !c.ValidFor("claude", now) || c.Valid(now) {
		t.Fatal("scoped Claude quota accepted on wrong platform")
	}
	if c.Reason(now, "claude-sonnet-4-6") != "quota_exhausted" || c.Reason(now, "claude-haiku-4-5-20251001") != "" || c.Reason(now, "") != "" {
		t.Fatal("model scope blocked wrong model")
	}
	c.Windows[2].Scope = "oauth_apps"
	if c.Reason(now, "claude-haiku-4-5-20251001") != "quota_exhausted" {
		t.Fatal("OAuth application quota did not block all models")
	}
	c.Windows[2].Scope = "sonnet"
	c.Windows[2].UsedPercent = &used
	c.Windows[2].ResetAt = now.Add(-time.Second)
	if c.Reason(now, "claude-sonnet-4-6") != "quota_unknown" || c.Reason(now, "claude-haiku-4-5-20251001") != "" {
		t.Fatal("reset was treated as automatic quota recovery")
	}
	if !c.ValidFor("claude", now) {
		t.Fatal("local scoped uncertainty invalidated unrelated models")
	}
	for _, platform := range []string{"openai", "unknown"} {
		if c.ValidFor(platform, now) {
			t.Fatal("expired quota snapshot accepted", platform)
		}
	}
	c.Windows = []QuotaWindow{five, week}
	for _, plan := range []string{"max", "team", "enterprise"} {
		c.Plan = plan
		if !c.ValidFor("claude", now) {
			t.Fatal("known Claude plan rejected", plan)
		}
	}
	c.Windows = append(c.Windows, week)
	if c.ValidFor("claude", now) {
		t.Fatal("duplicate window accepted")
	}
}

func TestOpenAISingleWindowPlans(t *testing.T) {
	now := time.Now()
	used := 0
	window := func(seconds int) QuotaWindow {
		return QuotaWindow{Seconds: seconds, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	}
	for _, test := range []struct {
		plan    string
		windows []int
		want    bool
	}{
		{"free", []int{2592000}, true},
		{"free", []int{18000, 604800}, true},
		{"free", []int{604800}, false},
		{"free", []int{18000, 2592000}, false},
		{"free", []int{2592000, 2592000}, false},
		{"pro", []int{604800}, true},
		{"pro", []int{2592000}, false},
		{"plus", []int{2592000}, false},
		{"", []int{2592000}, false},
	} {
		c := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: test.plan, Models: []string{}}
		for _, seconds := range test.windows {
			c.Windows = append(c.Windows, window(seconds))
		}
		if c.Valid(now) != test.want {
			t.Errorf("plan %q windows %v: valid=%v want %v", test.plan, test.windows, !test.want, test.want)
		}
	}
	c := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "pro", Models: []string{"claude-sonnet-4-6"}, Windows: []QuotaWindow{window(2592000)}}
	if c.ValidFor("claude", now) {
		t.Fatal("OpenAI Free window accepted for Claude")
	}
}
