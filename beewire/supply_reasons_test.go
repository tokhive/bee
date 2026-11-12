package beewire

import (
	"slices"
	"strings"
	"testing"
)

func TestEveryReasonIsExplainedAndEveryExplanationIsAReason(t *testing.T) {
	reasons := DetailedSupplyReasons()
	for _, reason := range reasons {
		e, ok := ExplainReason(reason, "claude")
		if !ok || e.Reason != reason || e.Cause == "" || e.Fix == "" || strings.Contains(e.Fix, "PLATFORM") {
			t.Errorf("%s: %+v", reason, e)
		}
	}
	for reason := range reasonExplanations {
		if !slices.Contains(reasons, reason) {
			t.Errorf("%s is explained but Hive never reports it", reason)
		}
	}
	if e, _ := ExplainReason(ReasonManuallyPaused, "claude"); !strings.Contains(e.Fix, "--platform claude") {
		t.Fatalf("platform not substituted: %s", e.Fix)
	}
	if e, ok := ExplainReason("from_a_newer_hive", "openai"); ok || e.Reason != "from_a_newer_hive" {
		t.Fatal("unknown reason explained")
	}
}

func TestDetailedSupplyReasonExplanationsPreserveLegacyReasons(t *testing.T) {
	legacy := []string{"manually_paused", "banned", "device_draining", "offline", "not_configured", "model_unavailable", "authorization_unavailable", "capabilities_unknown", "rate_limited", "quota_unknown", "quota_exhausted", "plan_not_configured", "concurrency_full", "codex_source_unavailable", "codex_confirmation_required", "codex_authorization_rejected", "codex_account_in_use", "claude_source_unavailable", "claude_confirmation_required", "claude_authorization_rejected", "claude_account_in_use"}
	if !slices.Equal(SupplyReasons(), legacy) {
		t.Fatalf("legacy reasons changed: actual=%v required=%v", SupplyReasons(), legacy)
	}
	for _, reason := range []string{"account_not_registered", "market_not_open", "supply_not_enabled", "supply_device_restricted", "account_not_admitted"} {
		e, ok := ExplainReason(reason, "openai")
		if !ok || e.Reason != reason || e.Cause == "" || e.Fix == "" {
			t.Errorf("detailed reason lacks explanation: reason=%s explanation=%+v known=%t", reason, e, ok)
		}
		if slices.Contains(SupplyReasons(), reason) {
			t.Errorf("detailed reason leaked into legacy list: %s", reason)
		}
	}
}

func TestDetailedSupplyReasonsExtendsLegacyWithoutMutatingIt(t *testing.T) {
	legacy := SupplyReasons()
	detailed := DetailedSupplyReasons()
	want := append(SupplyReasons(), "account_not_registered", "market_not_open", "supply_not_enabled", "supply_device_restricted", "account_not_admitted")
	if !slices.Equal(detailed, want) {
		t.Fatalf("detailed reasons=%v required=%v", detailed, want)
	}
	seen := map[string]bool{}
	for _, reason := range detailed {
		if seen[reason] {
			t.Errorf("duplicate detailed reason=%s", reason)
		}
		seen[reason] = true
	}
	detailed[0] = "mutated"
	if !slices.Equal(SupplyReasons(), legacy) || DetailedSupplyReasons()[0] != legacy[0] {
		t.Fatal("caller mutation changed reason registries")
	}
}
