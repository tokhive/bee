package beewire

import (
	"slices"
	"strings"
	"testing"
)

func TestEveryReasonIsExplainedAndEveryExplanationIsAReason(t *testing.T) {
	reasons := SupplyReasons()
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
