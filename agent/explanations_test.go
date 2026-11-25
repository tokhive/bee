package bee

import (
	"slices"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

// Every reason Hive can give, and every code the control interface answers
// with, has words the desktop app can show.
func TestEveryCodeIsExplained(t *testing.T) {
	codes := beewire.DetailedSupplyReasons()
	for code := range supplyReasonLabels {
		codes = append(codes, code)
	}
	codes = append(codes,
		// Refusals the control interface answers with.
		"import_unreadable", "import_invalid", "import_scope", "import_expired", "platform_has_account",
		"pause_unconfirmed", "supply_unconfirmed", "hive_unavailable", "confirmation_unconfirmed",
		"no_pending_switch", "not_paired", "login_scope",
		// Local sign-in and connection problems the app shows.
		"BEE-SETUP-CODEX-NOT-FOUND", "BEE-CODEX-SOURCE", "BEE-CODEX-EXPIRED", "BEE-CLAUDE-SOURCE",
		"BEE-CLAUDE-EXPIRED", "BEE-CLAUDE-SCOPE", "BEE-CLAUDE-UNSUPPORTED", "BEE-HIVE-UNREACHABLE",
		"BEE-HIVE-CREDENTIAL", "BEE-DEVICE-REPLACED", "BEE-HIVE-ERROR", "BEE-DEVICE-CONFIG",
		"pairing_rejected", "pairing_expired", "pairing_failed")
	for _, code := range codes {
		if _, ok := explanations[code]; !ok {
			t.Errorf("%s has no explanation", code)
		}
	}
}

func TestExplanationsAreComplete(t *testing.T) {
	categories := []string{categorySyncing, categoryPaused, categoryWaiting, categoryAction, categoryRestricted, categoryOffline, categoryError}
	actions := []string{"", actionResume, actionRelogin, actionReimport, actionConfirmSwitch, actionRemoveAccount, actionContactSupport, actionRepairBinding, actionRetry, actionCheckNetwork}
	for _, e := range allExplanations() {
		if !slices.Contains(categories, e.Category) {
			t.Errorf("%s: category %q", e.Code, e.Category)
		}
		if !slices.Contains(actions, e.Action) {
			t.Errorf("%s: action %q", e.Code, e.Action)
		}
		texts := []localized{e.Title, e.Cause, e.Fix}
		if e.FixImport != nil {
			texts = append(texts, *e.FixImport)
		}
		for _, text := range texts {
			if strings.TrimSpace(text.En) == "" || strings.TrimSpace(text.Zh) == "" {
				t.Errorf("%s: missing text %+v", e.Code, text)
			}
			// The person sees words, not codes or internal names.
			shown := strings.ReplaceAll(text.En+" / "+text.Zh, "TokHive", "")
			for _, internal := range []string{"egress", "supply", "fingerprint", "Hive", "BEE-"} {
				if strings.Contains(shown, internal) {
					t.Errorf("%s: %q shows %q", e.Code, text.En+" / "+text.Zh, internal)
				}
			}
		}
	}
}

func TestExplainUnknownCode(t *testing.T) {
	e := explainCode("something_new")
	if e.Code != "something_new" || e.Category != categoryError || e.Title.Zh == "" {
		t.Fatalf("fallback = %+v", e)
	}
}

func TestSharingOf(t *testing.T) {
	cases := []struct {
		supply beewire.PlatformSupply
		want   sharingState
	}{
		{beewire.PlatformSupply{Ready: true}, sharingState{State: categorySharing}},
		{beewire.PlatformSupply{}, sharingState{State: categorySyncing}},
		{beewire.PlatformSupply{Paused: true, Reasons: []string{"manually_paused"}}, sharingState{categoryPaused, "manually_paused"}},
		{beewire.PlatformSupply{Paused: true}, sharingState{categoryPaused, "manually_paused"}},
		{beewire.PlatformSupply{Reasons: []string{"quota_exhausted"}}, sharingState{categoryWaiting, "quota_exhausted"}},
		// What the person must fix comes before a pause or a wait.
		{beewire.PlatformSupply{Paused: true, Reasons: []string{"manually_paused", "quota_exhausted", "claude_authorization_rejected"}}, sharingState{categoryAction, "claude_authorization_rejected"}},
		{beewire.PlatformSupply{Reasons: []string{"capabilities_unknown", "banned"}}, sharingState{categoryRestricted, "banned"}},
		{beewire.PlatformSupply{Reasons: []string{"capabilities_unknown", "quota_exhausted"}}, sharingState{categoryWaiting, "quota_exhausted"}},
		{beewire.PlatformSupply{Reasons: []string{"account_not_registered"}}, sharingState{categorySyncing, "account_not_registered"}},
	}
	for _, c := range cases {
		if got := sharingOf(c.supply); got != c.want {
			t.Errorf("sharingOf(%+v) = %+v, want %+v", c.supply, got, c.want)
		}
	}
}

func TestRedactReport(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	got := string(redactReport([]byte(`{"path":"` + home + `/Library/tokhive/bee.json","owner":"someone.else@example.com"}`)))
	if strings.Contains(got, home) || strings.Contains(got, "someone.else") || !strings.Contains(got, "~/Library") || !strings.Contains(got, "s***@example.com") {
		t.Fatalf("redacted = %s", got)
	}
}
