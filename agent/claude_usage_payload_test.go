package bee

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// A real /api/oauth/usage response, recorded 2026-10-11, in which nimbus_quill
// had become null. The parser refused it, and every Claude account stopped
// supplying as capabilities_unknown.
func TestClaudeUsageRecordedOn20261011(t *testing.T) {
	raw, err := os.ReadFile("testdata/claude-usage-2026-10-11.json")
	if err != nil {
		t.Fatal(err)
	}
	var usage map[string]json.RawMessage
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 11, 3, 0, 0, 0, time.UTC)
	windows, unrecognised, reason := parseClaudeQuota(usage, "pro", now)
	if reason != "" {
		t.Fatalf("recorded payload refused: %s", reason)
	}
	if len(windows) != 2 || *windows[0].UsedPercent != 27 || windows[0].Seconds != 18000 || *windows[1].UsedPercent != 24 || windows[1].Seconds != 604800 {
		t.Fatalf("windows: %+v", windows)
	}
	if len(unrecognised) != 0 {
		t.Fatalf("null placeholders reported as new buckets: %v", unrecognised)
	}
}

// Ultra has no five-hour limit, so its usage response leaves five_hour null.
// Only Ultra may omit it; on any other plan a missing five-hour window still
// stops supply.
func TestClaudeUltraHasNoFiveHourWindow(t *testing.T) {
	raw, err := os.ReadFile("testdata/claude-usage-2026-10-11.json")
	if err != nil {
		t.Fatal(err)
	}
	var usage map[string]json.RawMessage
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	usage["five_hour"] = json.RawMessage("null")
	now := time.Date(2026, 10, 11, 3, 0, 0, 0, time.UTC)
	windows, _, reason := parseClaudeQuota(usage, "ultra", now)
	if reason != "" || len(windows) != 1 || windows[0].Seconds != 604800 || *windows[0].UsedPercent != 24 {
		t.Fatalf("Ultra weekly-only payload: %q %+v", reason, windows)
	}
	for _, plan := range []string{"free", "pro", "max", "team", "enterprise"} {
		if _, _, reason := parseClaudeQuota(usage, plan, now); reason != "five_hour is missing" {
			t.Fatalf("%s without a five-hour window: %q", plan, reason)
		}
	}
	usage["seven_day"] = json.RawMessage("null")
	if _, _, reason := parseClaudeQuota(usage, "ultra", now); reason != "seven_day is missing" {
		t.Fatalf("Ultra without a seven-day window: %q", reason)
	}
}
