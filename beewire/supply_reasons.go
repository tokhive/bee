package beewire

import "strings"

// Reasons Hive gives in PlatformSupply.Reasons for a platform that cannot take
// new work. Hive produces them and the Bee explains them to its provider, so
// both sides name them from this list; a reason missing here is one the Bee
// can only print raw.
const (
	ReasonManuallyPaused           = "manually_paused"
	ReasonBanned                   = "banned"
	ReasonDeviceDraining           = "device_draining"
	ReasonOffline                  = "offline"
	ReasonNotConfigured            = "not_configured"
	ReasonModelUnavailable         = "model_unavailable"
	ReasonAuthorizationUnavailable = "authorization_unavailable"
	ReasonCapabilitiesUnknown      = "capabilities_unknown"
	ReasonRateLimited              = "rate_limited"
	ReasonQuotaUnknown             = "quota_unknown"
	ReasonQuotaExhausted           = "quota_exhausted"
	ReasonPlanNotConfigured        = "plan_not_configured"
	ReasonConcurrencyFull          = "concurrency_full"
)

// AccountReason is the supply reason for an account status other than ready
// or not_configured, prefixed by platform: codex_ for openai, claude_ for
// claude.
func AccountReason(platform, status string) string {
	if platform == "claude" {
		return "claude_" + status
	}
	return "codex_" + status
}

// AccountStatuses are the account states that surface as an AccountReason.
var AccountStatuses = []string{"source_unavailable", "confirmation_required", "authorization_rejected"}

// SupplyReasons lists every reason Hive can report.
func SupplyReasons() []string {
	reasons := []string{
		ReasonManuallyPaused, ReasonBanned, ReasonDeviceDraining, ReasonOffline,
		ReasonNotConfigured, ReasonModelUnavailable, ReasonAuthorizationUnavailable,
		ReasonCapabilitiesUnknown, ReasonRateLimited, ReasonQuotaUnknown,
		ReasonQuotaExhausted, ReasonPlanNotConfigured,
		ReasonConcurrencyFull,
	}
	for _, platform := range []string{"openai", "claude"} {
		for _, status := range AccountStatuses {
			reasons = append(reasons, AccountReason(platform, status))
		}
	}
	return reasons
}

// ReasonExplanation says why a platform does not take work and what to do,
// and whether the provider or the market's administrator acts on it. Bee's
// terminal and Hive's device page both read it from here, so the two say the
// same thing.
type ReasonExplanation struct {
	Reason string `json:"reason"`
	Cause  string `json:"cause"`
	Fix    string `json:"fix"`
	Admin  bool   `json:"admin,omitempty"`
}

// ExplainReason explains reason for platform; ok is false for a reason this
// build does not know.
func ExplainReason(reason, platform string) (ReasonExplanation, bool) {
	e, ok := reasonExplanations[reason]
	e.Reason = reason
	e.Fix = strings.ReplaceAll(e.Fix, "PLATFORM", platform)
	return e, ok
}

var reasonExplanations = map[string]ReasonExplanation{
	ReasonManuallyPaused: {
		Cause: "supply is paused on this Bee",
		Fix:   "run bee resume --platform PLATFORM when you want to take work again",
	},
	ReasonBanned: {
		Cause: "an administrator has banned this platform's supply",
		Fix:   "contact the market administrator",
		Admin: true,
	},
	ReasonDeviceDraining: {
		Cause: "this device is being replaced and finishes only work it already has",
		Fix:   "run the new Bee; it takes over once this one is drained",
	},
	ReasonOffline: {
		Cause: "Hive does not see this Bee connected",
		Fix:   "start bee run and check that it reaches Hive",
	},
	ReasonNotConfigured: {
		Cause: "no account is registered for this platform, or the market does not offer it",
		Fix:   "configure the platform's official account source in the egress configuration and restart bee run; if it is configured, ask the administrator whether the market offers this platform",
	},
	ReasonModelUnavailable: {
		Cause: "none of the market's models is available to this account",
		Fix:   "check the account's plan in the official client; if it should qualify, ask the administrator which models the market offers",
	},
	ReasonAuthorizationUnavailable: {
		Cause: "Hive holds no usable encrypted authorization from this Bee",
		Fix:   "keep bee run connected; if this persists, sign in again in the official client",
	},
	ReasonCapabilitiesUnknown: {
		Cause: "Hive has no current report of this account's models and quota",
		Fix:   "keep bee run connected with capability reporting enabled; the report arrives within a few minutes",
	},
	ReasonRateLimited: {
		Cause: "the upstream platform is rate limiting this account",
		Fix:   "wait; supply resumes after the upstream cooldown",
	},
	ReasonQuotaUnknown: {
		Cause: "this account's quota window could not be read",
		Fix:   "keep bee run connected; Bee retries the quota query",
	},
	ReasonQuotaExhausted: {
		Cause: "this account's subscription quota is used up",
		Fix:   "wait for the quota window to reset",
	},
	ReasonPlanNotConfigured: {
		Cause: "the market has no concurrency limit for this account's plan",
		Fix:   "ask the administrator to set one for the plan",
		Admin: true,
	},
	ReasonConcurrencyFull: {
		Cause: "the account is running as many requests as its plan allows",
		Fix:   "nothing to do; new work is admitted as running requests finish",
	},
	AccountReason("openai", "source_unavailable"): {
		Cause: "Bee cannot currently read the Codex sign-in",
		Fix:   "sign in again in the official Codex client; the running Bee synchronizes automatically",
	},
	AccountReason("openai", "confirmation_required"): {
		Cause: "the Codex sign-in changed to a different account",
		Fix:   "run bee account-status --platform openai, then bee confirm-account with the shown fingerprint",
	},
	AccountReason("openai", "authorization_rejected"): {
		Cause: "OpenAI rejected this account's authorization",
		Fix:   "sign in again in the official Codex client",
	},
	AccountReason("claude", "source_unavailable"): {
		Cause: "Bee cannot currently read the Claude Code sign-in",
		Fix:   "sign in again in Claude Code; the running Bee synchronizes automatically",
	},
	AccountReason("claude", "confirmation_required"): {
		Cause: "the Claude Code sign-in changed to a different account",
		Fix:   "run bee account-status --platform claude, then bee confirm-account with the shown fingerprint",
	},
	AccountReason("claude", "authorization_rejected"): {
		Cause: "Anthropic rejected this account's authorization",
		Fix:   "sign in again in Claude Code",
	},
}
