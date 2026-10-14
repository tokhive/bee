package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// Both platforms cache usage and account metadata independently.
const capabilityTTL = beewire.CapabilityUsageInterval

const capabilityMetadataTTL = beewire.CapabilityMetadataInterval

// capabilityBackoff is how long the quota endpoint is left alone after it
// refuses a query with 429 and names no time to come back — which is what it
// actually sends.
//
// The six-minute fallback also outlasts Claude's five-minute usage interval.
// An explicit Retry-After is preferred, subject to the one-hour wire limit.
const capabilityBackoff = 6 * time.Minute

type claudeCapabilitySource struct {
	fingerprint    string
	unrecognised   []string
	announced      string
	retryAt        time.Time
	cached         beewire.Capabilities
	cachedAt       time.Time
	metadataModels []string
	metadataPlan   string
	metadataAt     time.Time
	cooldown       cooldownStore
	restored       bool
	// failure is why the last observation came out unknown, empty when it
	// did not; logged is the failure the operator was last told about.
	failure, logged string
}

// reusable reports whether the last query still describes the account: it must
// be recent, and no window it carries may have reset since it was read.
func (s *claudeCapabilitySource) reusable(now time.Time) bool {
	if s.cached.Status != "ready" || s.cachedAt.IsZero() || !now.Before(s.cachedAt.Add(capabilityTTL)) || !now.Before(s.metadataAt.Add(capabilityMetadataTTL)) {
		return false
	}
	for _, window := range s.cached.Windows {
		if !now.Before(window.ResetAt) {
			return false
		}
	}
	return true
}

func (s *claudeCapabilitySource) observe(ctx context.Context, credential claudeCredential, fingerprint string, sequence int64, transport http.RoundTripper) (beewire.Capabilities, error) {
	now := time.Now()
	unknown := beewire.Capabilities{Sequence: sequence, ObservedAt: now, Status: "unknown", Models: []string{}, Windows: []beewire.QuotaWindow{}}
	s.failure = ""
	fail := func(reason string) beewire.Capabilities {
		s.failure = reason
		return unknown
	}
	if s.fingerprint != fingerprint {
		s.fingerprint, s.retryAt, s.cached, s.cachedAt = fingerprint, time.Time{}, beewire.Capabilities{}, time.Time{}
		s.metadataModels, s.metadataPlan, s.metadataAt, s.restored = nil, "", time.Time{}, false
	}
	// A cooldown this account was already serving is adopted once, so a
	// restart does not hand the endpoint a query it asked not to receive.
	if !s.restored {
		s.restored = true
		s.retryAt = s.cooldown.load("claude", fingerprint, now)
	}
	limited := func() beewire.Capabilities {
		result := unknown
		at := s.retryAt
		result.Status, result.RetryAt = "rate_limited", &at
		return result
	}
	if now.Before(s.retryAt) {
		return limited(), nil
	}
	if s.reusable(now) && s.metadataPlan == credential.plan {
		result := s.cached
		result.Sequence, result.ObservedAt = sequence, now
		result.Models = append([]string(nil), s.cached.Models...)
		result.Windows = append([]beewire.QuotaWindow(nil), s.cached.Windows...)
		if result.ValidFor("claude", now) {
			return result, nil
		}
		s.cached, s.cachedAt = beewire.Capabilities{}, time.Time{}
	}
	if !credential.available(now) {
		return fail("Claude authorization expired or about to expire"), nil
	}
	if !credential.hasProfileScope || !credential.hasInferenceScope {
		return fail("Claude authorization lacks the user:profile or user:inference scope"), nil
	}
	s.retryAt = time.Time{}
	var models struct {
		Data []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"data"`
		HasMore *bool `json:"has_more"`
	}
	var usage map[string]json.RawMessage
	queries := []struct {
		path   string
		target any
	}{{"/api/oauth/usage", &usage}}
	metadataFresh := s.metadataAt.IsZero() || s.metadataPlan != credential.plan || !now.Before(s.metadataAt.Add(capabilityMetadataTTL))
	if metadataFresh {
		queries = append([]struct {
			path   string
			target any
		}{{"/v1/models?limit=1000", &models}}, queries...)
	}
	for _, query := range queries {
		retry, err := queryClaudeCapability(ctx, credential, query.path, query.target, transport)
		if err != nil {
			if retry.After(time.Now()) {
				s.retryAt = retry
				s.cooldown.save("claude", fingerprint, retry)
				return limited(), nil
			}
			if errors.Is(err, errClaudeProfileRejected) {
				return fail(err.Error()), err
			}
			var failed *claudeQueryFailure
			if errors.As(err, &failed) {
				return fail(failed.detail), nil
			}
			return fail(err.Error()), nil
		}
	}
	s.cooldown.save("claude", fingerprint, time.Time{})
	// Older Claude model responses omit has_more; a short page is complete,
	// while a full page remains fail-closed because pagination is ambiguous.
	if metadataFresh {
		if models.HasMore != nil && *models.HasMore || models.HasMore == nil && len(models.Data) >= 1000 || len(models.Data) > 1000 {
			return fail("/v1/models list is paginated beyond one page"), nil
		}
	}
	result := unknown
	result.Status, result.Plan = "ready", credential.plan
	if metadataFresh {
		seen := map[string]bool{}
		for _, model := range models.Data {
			if model.Type != "model" || seen[model.ID] {
				return fail("/v1/models response not understood"), nil
			}
			seen[model.ID] = true
			if beewire.ClaudeModelFamily(model.ID) != "" {
				result.Models = append(result.Models, model.ID)
			}
		}
	} else {
		result.Models = append([]string(nil), s.metadataModels...)
		result.Plan = s.metadataPlan
	}
	windows, unrecognised, reason := parseClaudeQuota(usage, now)
	if reason != "" {
		return fail("/api/oauth/usage quota windows not understood: " + reason), nil
	}
	s.unrecognised = unrecognised
	result.Windows = windows
	result.MetadataObservedAt = s.metadataAt
	if metadataFresh {
		result.MetadataObservedAt = now
	}
	if !result.ValidFor("claude", time.Now()) {
		return fail("capability snapshot failed validation"), nil
	}
	if metadataFresh {
		s.metadataModels = append([]string(nil), result.Models...)
		s.metadataPlan, s.metadataAt = credential.plan, now
	}
	s.cached, s.cachedAt = result, now
	return result, nil
}

// parseClaudeQuota reads the two windows that decide whether an account can
// take work — the five hour and seven day general limits — plus the scoped
// weekly windows when the account has them. It also returns the names of any
// top-level buckets it does not know, so the operator can be told the upstream
// grew something new.
func parseClaudeQuota(usage map[string]json.RawMessage, now time.Time) ([]beewire.QuotaWindow, []string, string) {
	if usage == nil {
		return nil, nil, "empty response"
	}
	var unrecognised []string
	for name, raw := range usage {
		switch name {
		case "five_hour", "seven_day", "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet", "extra_usage", "limits":
		case "member_dashboard_available":
			var available *bool
			if json.Unmarshal(raw, &available) != nil || available == nil {
				return nil, nil, "member_dashboard_available is not true or false"
			}
		case "spend":
			if !claudeSpendDisabled(raw) {
				return nil, nil, "spend is enabled or has fields this build does not read"
			}
		case "nimbus_quill":
			// Once a dormant window reported as zero usage, now null like the
			// other placeholders; a live one is a limit this build cannot honour.
			if claudeQuotaNull(raw) {
				continue
			}
			value, ok := parseClaudeQuotaValue(raw)
			if !ok || *value.Used != 0 || value.Reset != nil {
				return nil, nil, "nimbus_quill is in use"
			}
		case "seven_day_breakdown":
			// Informational model breakdown; the authoritative seven-day window is parsed below.
		default:
			// Anthropic keeps growing this payload — placeholders for limits the
			// account does not have, and occasionally a new one that means
			// something. None of them are read here.
			//
			// Refusing what it did not recognise took the platform out of supply
			// every time the payload grew, which is a certain outage traded
			// against a hypothetical one. If an unknown bucket does turn out to
			// be a live limit, the account simply runs into it: the upstream
			// answers 429, the account goes into cooldown, and the attempt is
			// not billed. The five hour and seven day windows below remain
			// required, so a payload that stops describing those still stops the
			// supply.
			// Only a bucket with content is worth the operator's attention: the
			// null ones are placeholders for limits the account does not have,
			// and listing them would be the same noise in a different place.
			if !claudeQuotaNull(raw) {
				unrecognised = append(unrecognised, name)
			}
		}
	}
	var windows []beewire.QuotaWindow
	general := map[string]claudeQuotaValue{}
	for _, field := range []struct {
		name, scope string
		seconds     int
	}{
		{"five_hour", "", 18000}, {"seven_day", "", 604800},
		{"seven_day_oauth_apps", "oauth_apps", 604800}, {"seven_day_opus", "opus", 604800}, {"seven_day_sonnet", "sonnet", 604800},
	} {
		raw := usage[field.name]
		if claudeQuotaNull(raw) {
			if field.scope == "" {
				return nil, nil, field.name + " is missing"
			}
			continue
		}
		value, ok := parseClaudeQuotaValue(raw)
		modelScoped := field.scope == "sonnet" || field.scope == "opus"
		if !ok {
			return nil, nil, field.name + " has fields or values this build does not read"
		}
		if field.scope == "" {
			general[field.name] = value
		}
		reset := value.Reset
		if reset == nil && *value.Used == 0 {
			// A window nothing has used since it last rolled over has not
			// started, so it carries no reset time. The first request starts
			// it, and it cannot reset any later than one full window from now.
			idle := now.Add(time.Duration(field.seconds) * time.Second)
			reset = &idle
		}
		if reset == nil || reset.IsZero() || !modelScoped && !reset.After(now) {
			return nil, nil, field.name + " has no future reset time"
		}
		used := int(math.Floor(*value.Used))
		windows = append(windows, beewire.QuotaWindow{Scope: field.scope, Seconds: field.seconds, UsedPercent: &used, ResetAt: *reset})
	}
	if !claudeQuotaLimitsMatch(usage["limits"], general) {
		return nil, nil, "limits disagree with five_hour and seven_day"
	}
	sort.Strings(unrecognised)
	return windows, unrecognised, ""
}

type claudeQuotaValue struct {
	Used      *float64        `json:"utilization"`
	Reset     *time.Time      `json:"resets_at"`
	Limit     json.RawMessage `json:"limit_dollars"`
	Remaining json.RawMessage `json:"remaining_dollars"`
	Spent     json.RawMessage `json:"used_dollars"`
	Locked    json.RawMessage `json:"locked_reason"`
}

func claudeQuotaNull(raw json.RawMessage) bool {
	return len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func claudeSpendDisabled(raw json.RawMessage) bool {
	type amount struct {
		Minor    int64  `json:"amount_minor"`
		Currency string `json:"currency"`
		Exponent int    `json:"exponent"`
	}
	var spend struct {
		Enabled     *bool           `json:"enabled"`
		CanPurchase *bool           `json:"can_purchase_credits"`
		CanToggle   *bool           `json:"can_toggle"`
		Disabled    string          `json:"disabled_reason"`
		Disclaimer  string          `json:"disclaimer"`
		Percent     *float64        `json:"percent"`
		Severity    string          `json:"severity"`
		AutoReload  json.RawMessage `json:"auto_reload"`
		Balance     json.RawMessage `json:"balance"`
		Limit       *amount         `json:"limit"`
		Used        *amount         `json:"used"`
		Cap         *struct {
			Credits *amount `json:"credits"`
			Money   *amount `json:"money"`
		} `json:"cap"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&spend) != nil || spend.Enabled == nil || *spend.Enabled || !claudeQuotaNull(spend.AutoReload) || !claudeQuotaNull(spend.Balance) {
		return false
	}
	if spend.Percent != nil && (*spend.Percent < 0 || *spend.Percent > 10000) {
		return false
	}
	return spend.Severity == "" || spend.Severity == "normal" || spend.Severity == "warning" || spend.Severity == "critical"
}

func parseClaudeQuotaValue(raw json.RawMessage) (claudeQuotaValue, bool) {
	var value claudeQuotaValue
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || value.Used == nil || math.IsNaN(*value.Used) || math.IsInf(*value.Used, 0) || *value.Used < 0 || *value.Used > 10000 {
		return value, false
	}
	// Non-null monetary or lock fields may add constraints the wire format cannot represent.
	return value, claudeQuotaNull(value.Limit) && claudeQuotaNull(value.Remaining) && claudeQuotaNull(value.Spent) && claudeQuotaNull(value.Locked)
}

func claudeQuotaLimitsMatch(raw json.RawMessage, general map[string]claudeQuotaValue) bool {
	if claudeQuotaNull(raw) {
		return true
	}
	var limits []struct {
		Kind     string          `json:"kind"`
		Group    string          `json:"group"`
		Percent  *float64        `json:"percent"`
		Reset    *time.Time      `json:"resets_at"`
		Scope    json.RawMessage `json:"scope"`
		Active   *bool           `json:"is_active"`
		Severity string          `json:"severity"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&limits) != nil {
		return false
	}
	if len(limits) == 0 {
		return true
	}
	if len(limits) != 2 {
		return false
	}
	seen := map[string]bool{}
	for _, limit := range limits {
		name := ""
		switch {
		case limit.Kind == "session" && limit.Group == "session":
			name = "five_hour"
		case limit.Kind == "weekly_all" && limit.Group == "weekly":
			name = "seven_day"
		default:
			return false
		}
		window := general[name]
		// is_active does not remove a quota; both representations must agree before rounding.
		if seen[name] || limit.Active == nil || !claudeQuotaNull(limit.Scope) || limit.Percent == nil || window.Used == nil || *limit.Percent != *window.Used || !claudeSameReset(limit.Reset, window.Reset) {
			return false
		}
		if limit.Severity != "normal" && !(limit.Severity == "critical" && *limit.Percent >= 100) {
			return false
		}
		seen[name] = true
	}
	return true
}

// claudeSameReset reports whether two reset times agree; an idle window has
// none in either representation.
func claudeSameReset(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

// Control queries use the local token only; they neither refresh nor inspect buyer traffic.
func queryClaudeCapability(ctx context.Context, credential claudeCredential, path string, target any, transport http.RoundTripper) (time.Time, error) {
	if path != "/v1/models?limit=1000" && path != "/api/oauth/usage" {
		return time.Time{}, errClaudeCapabilityQuery
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com"+path, nil)
	if err != nil {
		return time.Time{}, errClaudeCapabilityQuery
	}
	req.Header.Set("Authorization", "Bearer "+credential.secret.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("anthropic-beta", "oauth-2025-04-20,interleaved-thinking-2025-05-14")
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return time.Time{}, &claudeQueryFailure{capabilityTransportFailure(err)}
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		return time.Time{}, errClaudeProfileRejected
	}
	if res.StatusCode == 429 {
		now := time.Now()
		at, _ := http.ParseTime(res.Header.Get("Retry-After"))
		if seconds, err := strconv.ParseInt(res.Header.Get("Retry-After"), 10, 32); err == nil && seconds > 0 {
			at = now.Add(time.Duration(seconds) * time.Second)
		}
		if !at.After(now) {
			at = now.Add(capabilityBackoff)
		}
		if at.After(now.Add(time.Hour)) {
			at = now.Add(time.Hour)
		}
		return at, errClaudeCapabilityQuery
	}
	if res.StatusCode != 200 {
		return time.Time{}, &claudeQueryFailure{fmt.Sprintf("%s answered HTTP %d", req.URL.Path, res.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	defer clear(raw)
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, target) != nil {
		return time.Time{}, &claudeQueryFailure{req.URL.Path + " response not understood"}
	}
	return time.Time{}, nil
}

var errClaudeCapabilityQuery = errors.New("official Claude capability query failed; quota remains unknown")

// claudeQueryFailure is errClaudeCapabilityQuery with the reason attached.
type claudeQueryFailure struct{ detail string }

func (e *claudeQueryFailure) Error() string {
	return errClaudeCapabilityQuery.Error() + ": " + e.detail
}
func (e *claudeQueryFailure) Unwrap() error { return errClaudeCapabilityQuery }

func inspectClaudeCapabilities(ctx context.Context, read func(context.Context) (claudeCredential, error), transport http.RoundTripper, out io.Writer) error {
	source := claudeSource{read: read, transport: transport}
	credential, auth, err := source.authorization(ctx)
	if err != nil {
		return err
	}
	snapshot, err := source.capabilities.observe(ctx, credential, auth.AccountFingerprint, 1, transport)
	if err != nil {
		return err
	}
	current, err := read(ctx)
	if err != nil || current != credential || !current.available(time.Now()) {
		return errClaudeSourceChanged
	}
	if snapshot.Status != "ready" {
		if failure := source.capabilities.failure; failure != "" {
			return &claudeQueryFailure{failure}
		}
		return errClaudeCapabilityQuery
	}
	return json.NewEncoder(out).Encode(snapshot)
}

// announce tells the operator once when the upstream quota payload grows a
// bucket this build does not read. Nothing here acts on it — the supply keeps
// running — but a silent new limit is how an account starts failing for
// reasons nobody can see.
func (s *claudeCapabilitySource) announce(out io.Writer) {
	current := strings.Join(s.unrecognised, ",")
	if current == s.announced {
		return
	}
	s.announced = current
	if current == "" {
		return
	}
	notify(out, slog.LevelWarn, "capabilities", "Claude quota response contains buckets this build does not read; supply continues and the five hour and seven day limits still apply: "+current)
}
