package beewire

import "strings"

// GooglePlatform is the platform of a Google account that reaches Gemini
// models, and the Claude models Antigravity offers it, through its
// Antigravity sign-in. The account source is called
// antigravity where OpenAI's is codex: in the egress configuration, on the
// wire and in supply reasons.
const GooglePlatform = "google"

// The two hosts Antigravity's requests go to. An account with a paid plan is
// served from the daily host and every other account from the production one;
// Google counts their quota apart, so an account stays on its own.
const (
	AntigravityHost      = "cloudcode-pa.googleapis.com:443"
	AntigravityDailyHost = "daily-cloudcode-pa.googleapis.com:443"
)

// AntigravityClientVersion is the Antigravity release requests are sent as
// when nothing configures another. The upstream lists newer models only to a
// recent enough client, so this follows the releases rather than staying put.
const AntigravityClientVersion = "2.32.1"

// AntigravityUserAgent is the User-Agent of the Antigravity client at version.
// A Bee's account calls and Hive's generation requests both send it, so the
// upstream sees one client for an account.
func AntigravityUserAgent(version string) string {
	if !ValidClientVersion(version) {
		version = AntigravityClientVersion
	}
	return "antigravity/hub/" + version + " (aidev_client; os_type=darwin; arch=arm64)"
}

// AntigravityHostFor is the host that serves an account on plan.
func AntigravityHostFor(plan string) string {
	if plan == "pro" || plan == "ultra" {
		return AntigravityDailyHost
	}
	return AntigravityHost
}

// GoogleClaudeScope is the scope of a Google account's quota windows for the
// Claude models Antigravity offers it. They share one group of limits, apart
// from the Gemini models', whose windows are unscoped.
const GoogleClaudeScope = "claude"

// GoogleClaudeModel reports whether a model a Google account serves is one of
// Anthropic's, metered in the Claude group rather than with Gemini.
func GoogleClaudeModel(model string) bool { return strings.HasPrefix(model, "claude-") }

// ValidProjectID reports whether id can be the project of a Google
// authorization: one bounded token, safe to write into a request body.
func ValidProjectID(id string) bool { return capabilityModelID.MatchString(id) }

// AntigravityModel returns the upstream model that serves a catalog model at
// a thinking level, out of the ones an account lists, or "" when none does.
//
// Antigravity lists some models under their published name and others only as
// one name per thinking level (gemini-4-argon-low, -medium, -high), where the
// published name alone is not found. So the level a request asks for is tried
// first, then the published name, then the levels from the documented default
// outwards. level is empty for a request that names none. A Claude model the
// upstream lists only as its thinking variant (claude-opus-4-6-thinking) is
// reached by that name last.
func AntigravityModel(listed []string, model, level string) string {
	has := make(map[string]bool, len(listed))
	for _, id := range listed {
		has[id] = true
	}
	candidates := make([]string, 0, 7)
	if level != "" {
		candidates = append(candidates, model+"-"+level)
	}
	candidates = append(candidates, model)
	if level == "xhigh" {
		candidates = append(candidates, model+"-high")
	}
	candidates = append(candidates, model+"-medium", model+"-high", model+"-low", model+"-tiered", model+"-thinking")
	for _, id := range candidates {
		if has[id] {
			return id
		}
	}
	return ""
}
