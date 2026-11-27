package beewire

import (
	"testing"
	"time"
)

func TestDeclaredThinkingLevels(t *testing.T) {
	listed := []string{"gemini-4-hydrogen-sonar", "gemini-4-argon-low", "gemini-4-argon-high"}
	levels := map[string][]string{"gemini-4-hydrogen": {"sonar"}, "gemini-4-argon": {"low", "high"}}
	// A level Hive has no name for is still reached through the declaration.
	if got := AntigravityModel(listed, levels, "gemini-4-hydrogen", ""); got != "gemini-4-hydrogen-sonar" {
		t.Fatalf("declared level: %q", got)
	}
	if got := AntigravityModel(listed, nil, "gemini-4-hydrogen", ""); got != "" {
		t.Fatalf("without the declaration: %q", got)
	}
	if got := AntigravityModel(listed, levels, "gemini-4-argon", "low"); got != "gemini-4-argon-low" {
		t.Fatalf("requested level: %q", got)
	}
	known := []string{"-low", "-medium", "-high"}
	for id, want := range map[string]string{"gemini-4-hydrogen-sonar": "gemini-4-hydrogen", "gemini-4-argon-high": "gemini-4-argon", "gemini-4-neon": "gemini-4-neon"} {
		if got := AntigravityBase(levels, known, id); got != want {
			t.Errorf("%s: base %q, want %q", id, got, want)
		}
	}

	now := time.Now()
	used := 10
	window := func(seconds int) QuotaWindow {
		return QuotaWindow{Seconds: seconds, UsedPercent: &used, ResetAt: now.Add(time.Hour)}
	}
	report := Capabilities{Sequence: 1, ObservedAt: now, Status: "ready", Plan: "ultra", Models: listed, ThinkingLevels: levels, Windows: []QuotaWindow{window(18000), window(604800)}}
	if !report.ValidFor(GooglePlatform, now) {
		t.Fatal("a report with declared levels was rejected")
	}
	for name, bad := range map[string]map[string][]string{
		"a level not listed":    {"gemini-4-argon": {"medium"}},
		"a repeated level":      {"gemini-4-argon": {"low", "low"}},
		"a level that is no ID": {"gemini-4-argon": {"LOW"}},
		"no levels":             {"gemini-4-argon": {}},
	} {
		report.ThinkingLevels = bad
		if report.ValidFor(GooglePlatform, now) {
			t.Errorf("%s was accepted", name)
		}
	}
	report.ThinkingLevels = levels
	if report.ValidFor("openai", now) {
		t.Fatal("declared levels were accepted on another platform")
	}
}
