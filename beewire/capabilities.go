package beewire

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"
)

const CapabilityUsageInterval = 5 * time.Minute
const CapabilityMetadataInterval = 5 * time.Hour
const CapabilityLifetime = CapabilityUsageInterval + time.Minute

func CapabilityLifetimeFor(platform string) time.Duration {
	return CapabilityLifetime
}

type QuotaWindow struct {
	Scope       string    `json:"scope,omitempty"`
	Seconds     int       `json:"seconds"`
	UsedPercent *int      `json:"used_percent"`
	ResetAt     time.Time `json:"reset_at"`
}

type Capabilities struct {
	Sequence           int64         `json:"sequence"`
	ObservedAt         time.Time     `json:"observed_at"`
	Status             string        `json:"status"`
	Plan               string        `json:"plan,omitempty"`
	Models             []string      `json:"models"`
	MetadataObservedAt time.Time     `json:"metadata_observed_at,omitzero"`
	Windows            []QuotaWindow `json:"windows"`
	RetryAt            *time.Time    `json:"retry_at,omitempty"`

	// ClientVersion is the official client release the account runs (Codex
	// for OpenAI, Claude Code for Claude), and the one Hive sends this
	// account's requests as. Only a ready report carries it; it is metadata,
	// reported and reused with the models.
	ClientVersion string `json:"client_version,omitempty"`
}

type CapabilityReport struct {
	Capabilities
	ReuseMetadata      bool   `json:"reuse_metadata,omitempty"`
	Lease              string `json:"lease"`
	AccountGeneration  int64  `json:"account_generation"`
	AccountFingerprint string `json:"account_fingerprint"`
	CredentialRevision string `json:"credential_revision"`
}

func (r CapabilityReport) MarshalJSON() ([]byte, error) {
	type report CapabilityReport
	if !r.ReuseMetadata {
		return json.Marshal(report(r))
	}
	return json.Marshal(struct {
		report
		Models []string `json:"models,omitempty"`
	}{report: report(r), Models: r.Models})
}

var capabilityModelID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)

var clientVersion = regexp.MustCompile(`^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.]{1,32})?$`)

// ValidClientVersion reports whether version is an official client release
// number, such as 0.161.0, 2.1.303 or 0.163.0-alpha.2, fit to send as a header.
func ValidClientVersion(version string) bool { return clientVersion.MatchString(version) }

// ValidCodexClientVersion is ValidClientVersion, kept for callers that
// predate Claude reporting a release.
func ValidCodexClientVersion(version string) bool { return ValidClientVersion(version) }

var subscriptionPlans = map[string][]string{
	"openai": {"free", "plus", "pro", "team", "business", "enterprise", "edu"},
	"claude": {"pro", "max", "team", "enterprise"},
}

// SubscriptionPlans lists the plans a ready capability report may name for a
// platform. An OpenAI report may also omit its plan; that is not a plan.
func SubscriptionPlans(platform string) []string {
	return append([]string(nil), subscriptionPlans[platform]...)
}

// openAISingleWindow is the one quota window an OpenAI plan may report alone:
// Pro has only the weekly window, Free only a 30-day one. Every other plan
// reports both the five-hour and the weekly window.
var openAISingleWindow = map[string]int{"pro": 604800, "free": 2592000}

// OpenAISingleWindow returns the length in seconds of the only quota window an
// OpenAI plan reports, or 0 when the plan reports two windows.
func OpenAISingleWindow(plan string) int { return openAISingleWindow[plan] }

// KnownPlan reports whether plan is one SubscriptionPlans lists for platform.
func KnownPlan(platform, plan string) bool {
	for _, known := range subscriptionPlans[platform] {
		if known == plan {
			return true
		}
	}
	return false
}

func (c Capabilities) Valid(now time.Time) bool {
	return c.ValidFor("openai", now)
}

func (c Capabilities) ValidFor(platform string, now time.Time) bool {
	if platform != "openai" && platform != "claude" {
		return false
	}
	if c.Sequence < 1 || c.ObservedAt.After(now.Add(5*time.Second)) || !now.Before(c.ObservedAt.Add(CapabilityLifetimeFor(platform))) || len(c.Models) > 32 {
		return false
	}
	if c.ClientVersion != "" && (c.Status != "ready" || !ValidClientVersion(c.ClientVersion)) {
		return false
	}
	seen := map[string]bool{}
	for _, model := range c.Models {
		if !capabilityModelID.MatchString(model) || seen[model] || platform == "claude" && ClaudeModelFamily(model) == "" {
			return false
		}
		seen[model] = true
	}
	if c.Status == "unknown" {
		return len(c.Windows) == 0 && len(c.Models) == 0 && c.RetryAt == nil && c.Plan == ""
	}
	if c.Status == "rate_limited" {
		return len(c.Windows) == 0 && len(c.Models) == 0 && c.Plan == "" && c.RetryAt != nil && c.RetryAt.After(now) && !c.RetryAt.After(now.Add(time.Hour))
	}
	if c.Status != "ready" || c.RetryAt != nil {
		return false
	}
	if !c.MetadataObservedAt.IsZero() && (c.MetadataObservedAt.After(now.Add(5*time.Second)) || !now.Before(c.MetadataObservedAt.Add(CapabilityMetadataInterval+CapabilityLifetimeFor(platform)))) {
		return false
	}
	if platform == "openai" {
		single := OpenAISingleWindow(c.Plan)
		if len(c.Windows) != 2 && !(single != 0 && len(c.Windows) == 1 && c.Windows[0].Seconds == single) {
			return false
		}
		if c.Plan != "" && !KnownPlan(platform, c.Plan) {
			return false
		}
	} else {
		if len(c.Windows) < 2 || len(c.Windows) > 5 {
			return false
		}
		if !KnownPlan(platform, c.Plan) {
			return false
		}
	}
	windows := map[int]bool{}
	scopes := map[string]bool{}
	for _, window := range c.Windows {
		modelScoped := platform == "claude" && (window.Scope == "sonnet" || window.Scope == "opus")
		if (window.Seconds != 18000 && window.Seconds != 604800 && (platform != "openai" || len(c.Windows) != 1 || window.Seconds != OpenAISingleWindow(c.Plan))) || window.UsedPercent == nil || *window.UsedPercent < 0 || *window.UsedPercent > 10000 || window.ResetAt.IsZero() || !modelScoped && !window.ResetAt.After(c.ObservedAt) || window.ResetAt.After(c.ObservedAt.Add(time.Duration(window.Seconds)*time.Second+time.Minute)) {
			return false
		}
		if window.Scope == "" {
			if windows[window.Seconds] {
				return false
			}
			windows[window.Seconds] = true
		} else {
			if platform != "claude" || window.Seconds != 604800 || scopes[window.Scope] || window.Scope != "opus" && window.Scope != "sonnet" && window.Scope != "oauth_apps" {
				return false
			}
			scopes[window.Scope] = true
		}
	}
	return platform != "claude" || windows[18000] && windows[604800]
}

func (c Capabilities) Reason(now time.Time, model string) string {
	return c.ReasonFor("openai", now, model)
}

func (c Capabilities) ReasonFor(platform string, now time.Time, model string) string {
	if !now.Before(c.ObservedAt.Add(CapabilityLifetimeFor(platform))) || !c.MetadataObservedAt.IsZero() && !now.Before(c.MetadataObservedAt.Add(CapabilityMetadataInterval+CapabilityLifetimeFor(platform))) {
		return ReasonCapabilitiesUnknown
	}
	if c.Status == "rate_limited" && c.RetryAt != nil && now.Before(*c.RetryAt) {
		return ReasonRateLimited
	}
	if c.Status != "ready" {
		return ReasonCapabilitiesUnknown
	}
	for _, window := range c.Windows {
		if window.Scope == "opus" || window.Scope == "sonnet" {
			if model == "" || ClaudeModelFamily(model) != window.Scope {
				continue
			}
		}
		if window.UsedPercent == nil {
			return ReasonQuotaUnknown
		}
		if !now.Before(window.ResetAt) {
			return ReasonQuotaUnknown
		}
		if *window.UsedPercent >= 100 {
			return ReasonQuotaExhausted
		}
	}
	if model != "" {
		for _, supported := range c.Models {
			if supported == model {
				return ""
			}
		}
		return ReasonModelUnavailable
	}
	return ""
}

// Unknown families require new quota mapping before discovery can expose them.
func ClaudeModelFamily(model string) string {
	for _, family := range []string{"haiku", "sonnet", "opus"} {
		if strings.HasPrefix(model, "claude-"+family+"-") && capabilityModelID.MatchString(model) {
			return family
		}
	}
	return ""
}
