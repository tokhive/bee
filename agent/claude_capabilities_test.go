package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

const claudeModelsFixture = `{"data":[{"id":"claude-sonnet-4-6","type":"model"},{"id":"claude-haiku-4-5-20251001","type":"model"},{"id":"unmapped-family","type":"model"}],"has_more":false}`

func claudeQuotaFixture() map[string]any {
	return map[string]any{
		"five_hour":        map[string]any{"utilization": 25.7, "resets_at": time.Now().Add(time.Hour)},
		"seven_day":        map[string]any{"utilization": 30.4, "resets_at": time.Now().Add(24 * time.Hour)},
		"seven_day_sonnet": map[string]any{"utilization": 100.0, "resets_at": time.Now().Add(time.Hour)},
		"seven_day_opus":   nil, "seven_day_oauth_apps": nil, "extra_usage": map[string]any{"is_enabled": true}, "limits": []any{},
	}
}

func claudeExpandedQuotaFixture() map[string]any {
	usage := claudeQuotaFixture()
	for _, name := range []string{"five_hour", "seven_day", "seven_day_sonnet"} {
		value := usage[name].(map[string]any)
		for _, field := range []string{"limit_dollars", "remaining_dollars", "used_dollars", "locked_reason"} {
			value[field] = nil
		}
	}
	for _, name := range []string{"amber_ladder", "cedar_ember", "cinder_cove", "copper_kite", "harbor_lantern", "iguana_necktie", "juniper_tide", "omelette_promotional", "seven_day_breakdown", "seven_day_cowork", "seven_day_omelette", "tangelo"} {
		usage[name] = nil
	}
	usage["member_dashboard_available"] = false
	usage["spend"] = map[string]any{
		"enabled": false, "percent": 100, "severity": "critical", "can_purchase_credits": false, "can_toggle": false,
		"disabled_reason": "synthetic-disabled", "disclaimer": "synthetic-disclaimer", "auto_reload": nil, "balance": nil,
		"limit": map[string]any{"amount_minor": 5000, "currency": "USD", "exponent": 2},
		"used":  map[string]any{"amount_minor": 5100, "currency": "USD", "exponent": 2},
		"cap":   map[string]any{"credits": map[string]any{"amount_minor": 5000, "exponent": 2}, "money": nil},
	}
	usage["nimbus_quill"] = map[string]any{"utilization": 0, "resets_at": nil, "limit_dollars": nil, "remaining_dollars": nil, "used_dollars": nil, "locked_reason": nil}
	usage["limits"] = []any{
		map[string]any{"kind": "session", "group": "session", "is_active": false, "percent": usage["five_hour"].(map[string]any)["utilization"], "resets_at": usage["five_hour"].(map[string]any)["resets_at"], "scope": nil, "severity": "normal"},
		map[string]any{"kind": "weekly_all", "group": "weekly", "is_active": true, "percent": usage["seven_day"].(map[string]any)["utilization"], "resets_at": usage["seven_day"].(map[string]any)["resets_at"], "scope": nil, "severity": "normal"},
	}
	return usage
}

func TestClaudeExpandedQuotaResponse(t *testing.T) {
	for _, scenario := range []string{
		"ready", "exhausted_inactive_session", "exhausted_week", "scoped_exhaustion", "scoped_expiry",
		"conflicting_percent", "conflicting_fraction", "conflicting_reset", "wrong_group", "unknown_kind", "unknown_scope", "missing_active", "unknown_severity", "early_critical", "duplicate_limit", "partial_limits", "extra_limit", "unknown_limit_field", "malformed_limits",
		"locked_window", "monetary_window", "unknown_window_field", "activated_extension", "unknown_null_bucket", "unknown_populated_bucket", "dormant_used", "dormant_reset", "dormant_lock", "dormant_missing_usage", "enabled_spend", "missing_spend_state", "unknown_spend_field", "unknown_spend_amount_field", "invalid_spend_percent", "invalid_spend_amount", "invalid_spend_severity", "spend_auto_reload", "spend_balance", "invalid_dashboard", "idle_session", "idle_session_used", "idle_session_limit_reset",
	} {
		t.Run(scenario, func(t *testing.T) {
			usage := claudeExpandedQuotaFixture()
			five := usage["five_hour"].(map[string]any)
			week := usage["seven_day"].(map[string]any)
			limits := usage["limits"].([]any)
			session := limits[0].(map[string]any)
			weekly := limits[1].(map[string]any)
			dormant := usage["nimbus_quill"].(map[string]any)
			wantReady, wantReason := false, ""
			switch scenario {
			case "ready", "scoped_exhaustion":
				wantReady = true
			case "exhausted_inactive_session":
				five["utilization"], session["percent"], session["severity"] = 100.0, 100.0, "critical"
				wantReady, wantReason = true, "quota_exhausted"
			case "exhausted_week":
				week["utilization"], weekly["percent"], weekly["severity"] = 100.0, 100.0, "critical"
				wantReady, wantReason = true, "quota_exhausted"
			case "scoped_expiry":
				usage["seven_day_sonnet"].(map[string]any)["resets_at"] = time.Now().Add(-time.Second)
				wantReady = true
			case "conflicting_percent":
				session["percent"] = 99.0
			case "conflicting_fraction":
				session["percent"] = 25.9
			case "conflicting_reset":
				session["resets_at"] = time.Now().Add(2 * time.Hour)
			case "wrong_group":
				session["group"] = "weekly"
			case "unknown_kind":
				session["kind"] = "weekly_scoped"
			case "unknown_scope":
				session["scope"] = map[string]any{"model": map[string]any{"display_name": "synthetic-model"}}
			case "missing_active":
				delete(session, "is_active")
			case "unknown_severity":
				session["severity"] = "future"
			case "early_critical":
				session["severity"] = "critical"
			case "duplicate_limit":
				limits[1] = session
			case "partial_limits":
				usage["limits"] = limits[:1]
			case "extra_limit":
				usage["limits"] = append(limits, session)
			case "unknown_limit_field":
				session["future_lock"] = true
			case "malformed_limits":
				usage["limits"] = map[string]any{}
			case "locked_window":
				five["locked_reason"] = "synthetic-lock"
			case "monetary_window":
				five["remaining_dollars"] = 0
			case "unknown_window_field":
				five["future_lock"] = true
			case "activated_extension":
				// A named extension bucket that has started counting is read the
				// same way as any other bucket nobody here parses: ignored, with
				// the five hour and seven day windows still deciding. If it is a
				// real limit the account runs into it as a 429, which cools the
				// account down and bills nothing.
				usage["seven_day_cowork"] = map[string]any{"utilization": 1, "resets_at": time.Now().Add(time.Hour)}
				wantReady = true
			case "unknown_null_bucket":
				// A placeholder for a limit this account does not have.
				usage["future_bucket"] = nil
				wantReady = true
			case "unknown_populated_bucket":
				// Even a populated bucket is ignored: nothing here can read it,
				// and refusing it would take the supply down every time the
				// upstream payload grows. A limit that is real announces itself
				// as a 429 at execution time, which is already a cooldown and
				// is never billed.
				usage["future_bucket"] = map[string]any{"utilization": 1, "resets_at": time.Now().Add(time.Hour)}
				wantReady = true
			case "dormant_used":
				dormant["utilization"] = 1
			case "dormant_reset":
				dormant["resets_at"] = time.Now().Add(time.Hour)
			case "dormant_lock":
				dormant["locked_reason"] = "synthetic-lock"
			case "dormant_missing_usage":
				delete(dormant, "utilization")
			case "enabled_spend":
				usage["spend"].(map[string]any)["enabled"] = true
			case "missing_spend_state":
				delete(usage["spend"].(map[string]any), "enabled")
			case "unknown_spend_field":
				usage["spend"].(map[string]any)["future_lock"] = true
			case "unknown_spend_amount_field":
				usage["spend"].(map[string]any)["limit"].(map[string]any)["future_lock"] = true
			case "invalid_spend_percent":
				usage["spend"].(map[string]any)["percent"] = "synthetic-invalid"
			case "invalid_spend_amount":
				usage["spend"].(map[string]any)["used"] = []any{}
			case "invalid_spend_severity":
				usage["spend"].(map[string]any)["severity"] = "future"
			case "spend_auto_reload":
				usage["spend"].(map[string]any)["auto_reload"] = map[string]any{}
			case "spend_balance":
				usage["spend"].(map[string]any)["balance"] = map[string]any{}
			case "invalid_dashboard":
				usage["member_dashboard_available"] = nil
			case "idle_session":
				// Nothing used the account for five hours: the session window
				// has not started and carries no reset time.
				five["utilization"], five["resets_at"], session["percent"], session["resets_at"] = 0.0, nil, 0.0, nil
				wantReady = true
			case "idle_session_used":
				five["resets_at"], session["resets_at"] = nil, nil
			case "idle_session_limit_reset":
				five["utilization"], five["resets_at"], session["percent"] = 0.0, nil, 0.0
			}
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/models" {
					return claudeProfileResponse(200, claudeModelsFixture), nil
				}
				raw, _ := json.Marshal(usage)
				return claudeProfileResponse(200, string(raw)), nil
			})
			source := claudeCapabilitySource{}
			got, err := source.observe(context.Background(), credential, "synthetic-account", 1, transport)
			if err != nil || !got.ValidFor("claude", time.Now()) || (got.Status == "ready") != wantReady {
				t.Fatalf("status=%s ready=%t err=%v", got.Status, wantReady, err)
			}
			if wantReady && got.Reason(time.Now(), "claude-haiku-4-5-20251001") != wantReason {
				t.Fatal("general quota enforcement changed")
			}
			if scenario == "idle_session" && (got.Windows[0].Seconds != 18000 || *got.Windows[0].UsedPercent != 0 || got.Windows[0].ResetAt.Sub(time.Now()) < 4*time.Hour) {
				t.Fatalf("idle session window = %+v", got.Windows[0])
			}
			if scenario == "scoped_exhaustion" && got.Reason(time.Now(), "claude-sonnet-4-6") != "quota_exhausted" || scenario == "scoped_expiry" && got.Reason(time.Now(), "claude-sonnet-4-6") != "quota_unknown" {
				t.Fatal("scoped quota enforcement changed")
			}
		})
	}
}

func TestClaudeCapabilityQueryAndFailClosed(t *testing.T) {
	for _, scenario := range []string{"ready", "scoped_reset_passed", "missing_five_hour", "null_percent", "bad_percent", "reset_passed", "unknown_quota", "scoped_limits", "pagination", "duplicate_model", "redirect", "oversized", "401", "429", "network"} {
		t.Run(scenario, func(t *testing.T) {
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			queries := 0
			transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
				queries++
				if r.Method != "GET" || r.URL.Host != "api.anthropic.com" || r.URL.Scheme != "https" || r.Header.Get("Authorization") != "Bearer synthetic-claude-access" || r.Header.Get("anthropic-beta") != "oauth-2025-04-20,interleaved-thinking-2025-05-14" {
					t.Error("incorrect fixed capability query")
				}
				if scenario == "network" {
					return nil, errors.New("synthetic-secret-network-error")
				}
				if scenario == "401" {
					return claudeProfileResponse(401, "synthetic-secret"), nil
				}
				if scenario == "429" {
					r := claudeProfileResponse(429, "synthetic-secret")
					r.Header.Set("Retry-After", "120")
					return r, nil
				}
				if scenario == "redirect" {
					r := claudeProfileResponse(302, "")
					r.Header.Set("Location", "https://other.example")
					return r, nil
				}
				if scenario == "oversized" {
					return claudeProfileResponse(200, strings.Repeat("x", 65537)), nil
				}
				if r.URL.RequestURI() == "/v1/models?limit=1000" {
					body := claudeModelsFixture
					if scenario == "pagination" {
						body = strings.Replace(body, "false", "true", 1)
					}
					if scenario == "duplicate_model" {
						body = strings.Replace(body, "unmapped-family", "claude-sonnet-4-6", 1)
					}
					return claudeProfileResponse(200, body), nil
				}
				if r.URL.Path != "/api/oauth/usage" {
					t.Error("unexpected credential destination")
				}
				usage := claudeQuotaFixture()
				switch scenario {
				case "missing_five_hour":
					delete(usage, "five_hour")
				case "null_percent":
					usage["five_hour"].(map[string]any)["utilization"] = nil
				case "bad_percent":
					usage["five_hour"].(map[string]any)["utilization"] = -1
				case "reset_passed":
					usage["five_hour"].(map[string]any)["resets_at"] = time.Now().Add(-time.Second)
				case "scoped_reset_passed":
					usage["seven_day_sonnet"].(map[string]any)["resets_at"] = time.Now().Add(-time.Second)
				case "unknown_quota":
					usage["future_bucket"] = map[string]any{"utilization": 100}
				case "scoped_limits":
					usage["limits"] = []any{map[string]any{"kind": "weekly_scoped", "percent": 100}}
				}
				raw, _ := json.Marshal(usage)
				return claudeProfileResponse(200, string(raw)), nil
			})
			source := claudeCapabilitySource{}
			got, err := source.observe(context.Background(), credential, "same-account", 1, transport)
			want := "unknown"
			// unknown_quota stays ready: a bucket nobody here reads does not
			// decide anything, and the five hour and seven day windows in this
			// fixture are healthy.
			if scenario == "ready" || scenario == "scoped_reset_passed" || scenario == "unknown_quota" {
				want = "ready"
			}
			if scenario == "429" {
				want = "rate_limited"
			}
			if got.Status != want || !got.ValidFor("claude", time.Now()) || errors.Is(err, errClaudeProfileRejected) != (scenario == "401") {
				t.Fatal("capability observation", got.Status, err)
			}
			if scenario == "ready" && (len(got.Models) != 2 || got.Reason(time.Now(), "claude-haiku-4-5-20251001") != "" || got.Reason(time.Now(), "claude-sonnet-4-6") != "quota_exhausted" || *got.Windows[0].UsedPercent != 25) {
				t.Fatal("quota scope or fractional percent mapping")
			}
			if scenario == "scoped_reset_passed" && (got.Reason(time.Now(), "claude-haiku-4-5-20251001") != "" || got.Reason(time.Now(), "claude-sonnet-4-6") != "quota_unknown") {
				t.Fatal("expired model window blocked unrelated family")
			}
			if scenario == "429" {
				credential.secret.Token = "synthetic-new-access"
				got, _ = source.observe(context.Background(), credential, "same-account", 2, transport)
				if queries != 1 || got.Status != "rate_limited" {
					t.Fatal("refresh bypassed account cooldown")
				}
			}
			raw, _ := json.Marshal(got)
			if bytes.Contains(raw, []byte("synthetic-")) {
				t.Fatal("secret leaked in report")
			}
		})
	}
}

func TestClaudeRuntimeCapabilitiesBindSourceAndThrottle(t *testing.T) {
	for _, scenario := range []string{"ready", "source_changed", "unauthorized", "disabled"} {
		t.Run(scenario, func(t *testing.T) {
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
			original := credential
			reports, stops, queries := 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/bee/platforms/claude/account":
					json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 3, CredentialRevision: claudeDigest(original.secret.Token)})
				case "/api/bee/maintenance":
					json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 3}})
				case "/api/bee/platforms/claude/capabilities":
					reports++
					var report beewire.CapabilityReport
					if json.NewDecoder(r.Body).Decode(&report) != nil || report.Lease != "synthetic-lease" || report.AccountGeneration != 3 || report.CredentialRevision != claudeDigest(original.secret.Token) || report.AccountFingerprint != identity.fingerprint() || report.Status != "ready" {
						t.Error("unbound capability report")
					}
					w.WriteHeader(201)
				case "/api/bee/platforms/claude/account/source":
					stops++
					w.WriteHeader(200)
				default:
					t.Error("unexpected control call", r.URL.Path)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			source := claudeSource{Capabilities: scenario != "disabled", credential: credential, identity: identity, verifiedAt: time.Now(), read: func(context.Context) (claudeCredential, error) { return credential, nil }}
			source.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
				queries++
				if scenario == "unauthorized" {
					return claudeProfileResponse(401, "{}"), nil
				}
				if r.URL.Path == "/v1/models" {
					return claudeProfileResponse(200, claudeModelsFixture), nil
				}
				if scenario == "source_changed" {
					credential.secret.Token = "changed-source"
				}
				raw, _ := json.Marshal(claudeQuotaFixture())
				return claudeProfileResponse(200, string(raw)), nil
			})
			state := localState{Hive: server.URL, Credential: "synthetic-bee"}
			if err := source.synchronize(context.Background(), state, "synthetic-lease", io.Discard, true); err != nil {
				t.Fatal(err)
			}
			if scenario == "ready" {
				if err := source.synchronize(context.Background(), state, "synthetic-lease", io.Discard, false); err != nil {
					t.Fatal(err)
				}
				if queries != 2 || reports != 1 || stops != 0 {
					t.Fatal("capability queries were not throttled")
				}
			} else if scenario == "disabled" {
				if queries != 0 || reports != 0 || stops != 0 {
					t.Fatal("default path queried capabilities")
				}
			} else if reports != 0 || stops != 1 || !source.verifiedAt.IsZero() {
				t.Fatal("changed/rejected source reported capabilities")
			}
		})
	}
}

func TestClaudeCapabilityInspectionIsReadOnlyAndSanitized(t *testing.T) {
	for _, fail := range []bool{false, true} {
		credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
		queries := 0
		transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
			queries++
			if r.Method != "GET" || r.URL.Host != "api.anthropic.com" {
				t.Error("inspection performed a write or refresh")
			}
			switch r.URL.Path {
			case "/api/oauth/profile":
				return claudeProfileResponse(200, claudeTestProfile), nil
			case "/v1/models":
				return claudeProfileResponse(200, claudeModelsFixture), nil
			case "/api/oauth/usage":
				if fail {
					return claudeProfileResponse(403, "synthetic-secret"), nil
				}
				raw, _ := json.Marshal(claudeQuotaFixture())
				return claudeProfileResponse(200, string(raw)), nil
			default:
				t.Error("unexpected inspection destination")
				return claudeProfileResponse(500, ""), nil
			}
		})
		var out bytes.Buffer
		err := inspectClaudeCapabilities(context.Background(), func(context.Context) (claudeCredential, error) { return credential, nil }, transport, &out)
		if (err != nil) != fail || queries != 3 || bytes.Contains(out.Bytes(), []byte("synthetic-")) || fail && out.Len() != 0 {
			t.Fatal("inspection result or privacy", err)
		}
	}
}

// TestClaudeCapabilityQueryIsCached pins that reporting to Hive does not mean
// asking the upstream again on reconnect. Usage and metadata have independent
// cache lifetimes; a quota reset must not trigger another model query.
func TestClaudeCapabilityQueryIsCached(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	usage := claudeExpandedQuotaFixture()
	var queries int
	transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
		queries++
		if r.URL.Path == "/v1/models" {
			return claudeProfileResponse(200, claudeModelsFixture), nil
		}
		raw, _ := json.Marshal(usage)
		return claudeProfileResponse(200, string(raw)), nil
	})
	source := claudeCapabilitySource{}
	first, err := source.observe(context.Background(), credential, "account-1", 1, transport)
	if err != nil || first.Status != "ready" || queries != 2 {
		t.Fatalf("first observation: status=%s queries=%d err=%v", first.Status, queries, err)
	}

	second, err := source.observe(context.Background(), credential, "account-1", 2, transport)
	if err != nil || second.Status != "ready" || queries != 2 {
		t.Fatalf("a report inside the window asked the upstream again: queries=%d", queries)
	}
	if second.Sequence != 2 || !second.ObservedAt.After(first.ObservedAt) && second.ObservedAt.Before(first.ObservedAt) {
		t.Fatal("the replayed snapshot did not carry this report's own sequence and time")
	}
	if len(second.Models) != len(first.Models) || len(second.Windows) != len(first.Windows) {
		t.Fatal("the replayed snapshot lost part of the observation")
	}
	second.Models[0] = "mutated"
	if third, _ := source.observe(context.Background(), credential, "account-1", 3, transport); third.Models[0] == "mutated" {
		t.Fatal("callers share the cached slice and can corrupt later reports")
	}

	// A window that has reset since it was read is no longer a description of
	// the account, so the next report must go and look.
	source.cachedAt = time.Now()
	for i := range source.cached.Windows {
		source.cached.Windows[i].ResetAt = time.Now().Add(-time.Second)
	}
	if _, err := source.observe(context.Background(), credential, "account-1", 4, transport); err != nil || queries != 3 {
		t.Fatalf("a lapsed window did not force a new query: queries=%d", queries)
	}

	// Ageing out and switching accounts both retire the cache.
	source.cachedAt = time.Now().Add(-beewire.CapabilityUsageInterval - time.Second)
	if _, err := source.observe(context.Background(), credential, "account-1", 5, transport); err != nil || queries != 4 {
		t.Fatalf("an aged snapshot was replayed: queries=%d", queries)
	}
	if _, err := source.observe(context.Background(), credential, "account-2", 6, transport); err != nil || queries != 6 {
		t.Fatalf("another account reused the previous account's snapshot: queries=%d", queries)
	}
	// Five hours invalidates metadata even while the quota cache is fresh.
	source.metadataAt = time.Now().Add(-5 * time.Hour)
	if _, err := source.observe(context.Background(), credential, "account-2", 7, transport); err != nil || queries != 8 {
		t.Fatalf("five-hour model refresh missing: queries=%d", queries)
	}
	credential.plan = "max"
	if got, err := source.observe(context.Background(), credential, "account-2", 8, transport); err != nil || queries != 10 || got.Plan != "max" {
		t.Fatalf("changed plan was cached: queries=%d plan=%s", queries, got.Plan)
	}
}

// TestClaudeUnknownBucketsAreAnnouncedOnce pins the only thing that happens to
// a bucket this build cannot read: the operator is told, once, and the supply
// keeps running. A silent new limit is how an account starts failing for
// reasons nobody can see.
func TestClaudeUnknownBucketsAreAnnouncedOnce(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	usage := claudeExpandedQuotaFixture()
	transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/models" {
			return claudeProfileResponse(200, claudeModelsFixture), nil
		}
		raw, _ := json.Marshal(usage)
		return claudeProfileResponse(200, string(raw)), nil
	})
	var out bytes.Buffer
	source := claudeCapabilitySource{}
	if got, err := source.observe(context.Background(), credential, "account-1", 1, transport); err != nil || got.Status != "ready" {
		t.Fatalf("known payload: status=%s err=%v", got.Status, err)
	}
	source.announce(&out)
	if out.Len() != 0 {
		t.Fatalf("a payload with nothing unknown in it announced something: %q", out.String())
	}

	usage["future_bucket"] = map[string]any{"utilization": 1}
	source.cachedAt = time.Time{}
	if got, err := source.observe(context.Background(), credential, "account-1", 2, transport); err != nil || got.Status != "ready" {
		t.Fatalf("an unreadable bucket stopped the supply: status=%s err=%v", got.Status, err)
	}
	source.announce(&out)
	first := out.String()
	if !strings.Contains(first, "future_bucket") {
		t.Fatalf("the operator was not told which bucket is unread: %q", first)
	}
	source.announce(&out)
	if out.String() != first {
		t.Fatal("the same unread bucket was announced twice")
	}

	// A null placeholder is not worth saying out loud; a second populated one is.
	usage["placeholder_bucket"] = nil
	source.cachedAt = time.Time{}
	if _, err := source.observe(context.Background(), credential, "account-1", 3, transport); err != nil {
		t.Fatal(err)
	}
	source.announce(&out)
	if out.String() != first {
		t.Fatalf("a null placeholder was announced: %q", out.String())
	}
	usage["later_bucket"] = map[string]any{"utilization": 2}
	source.cachedAt = time.Time{}
	if _, err := source.observe(context.Background(), credential, "account-1", 4, transport); err != nil {
		t.Fatal(err)
	}
	source.announce(&out)
	if !strings.Contains(strings.TrimPrefix(out.String(), first), "later_bucket") {
		t.Fatalf("a newly added bucket was not announced: %q", out.String())
	}
}

// A 429 that names no time is what this endpoint actually sends, and the
// fallback decides how often Bee may ask again. It has to stay longer than
// capabilityTTL: asking a refusing endpoint more often than a willing one is
// what kept an account in a cooldown it could not leave. The hour ceiling is
// beewire's, which rejects a rate_limited report reaching past it.
func TestClaudeCapabilityRestsLongerWhenNoRetryIsNamed(t *testing.T) {
	if capabilityBackoff <= capabilityTTL {
		t.Fatalf("backoff %v does not outlast the %v cache", capabilityBackoff, capabilityTTL)
	}
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	queries := 0
	transport := claudeTransport(func(*http.Request) (*http.Response, error) {
		queries++
		return claudeProfileResponse(429, "synthetic-secret"), nil
	})
	source := claudeCapabilitySource{}
	now := time.Now()
	got, err := source.observe(context.Background(), credential, "same-account", 1, transport)
	if err != nil || got.Status != "rate_limited" || got.RetryAt == nil {
		t.Fatal("headerless 429 not reported as a cooldown", got.Status, err)
	}
	if got.RetryAt.Before(now.Add(capabilityTTL)) || got.RetryAt.After(now.Add(time.Hour)) {
		t.Fatalf("cooldown until %v is outside the cache and the hour ceiling", got.RetryAt)
	}
	if !got.ValidFor("claude", time.Now()) {
		t.Fatal("cooldown report rejected by the wire contract")
	}
	// The whole point is that the endpoint is left alone until then.
	if _, err := source.observe(context.Background(), credential, "same-account", 2, transport); err != nil || queries != 1 {
		t.Fatalf("queried again during the cooldown: %d queries", queries)
	}
}

// The backoff only works if a restart cannot discard it — restarting is
// exactly what a person does when they see an account reported rate limited,
// and it used to hand the endpoint a fresh query every time.
func TestClaudeCapabilityCooldownOutlivesTheProcess(t *testing.T) {
	directory := t.TempDir()
	store := cooldownStore{path: filepath.Join(directory, "capability-cooldown.json")}
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	queries := 0
	transport := claudeTransport(func(*http.Request) (*http.Response, error) {
		queries++
		return claudeProfileResponse(429, "synthetic-secret"), nil
	})

	first := claudeCapabilitySource{cooldown: store}
	if _, err := first.observe(context.Background(), credential, "same-account", 1, transport); err != nil {
		t.Fatal(err)
	}

	// A new process reads the same directory and must honour the cooldown.
	restarted := claudeCapabilitySource{cooldown: store}
	got, err := restarted.observe(context.Background(), credential, "same-account", 2, transport)
	if err != nil || got.Status != "rate_limited" || queries != 1 {
		t.Fatalf("restart spent another query: %d queries, status %s", queries, got.Status)
	}
	if !got.ValidFor("claude", time.Now()) {
		t.Fatal("restored cooldown rejected by the wire contract")
	}

	// A cooldown belongs to the account that earned it.
	other := claudeCapabilitySource{cooldown: store}
	if _, err := other.observe(context.Background(), credential, "other-account", 3, transport); err != nil || queries != 2 {
		t.Fatalf("another account inherited the cooldown: %d queries", queries)
	}
}

// A store with no directory is the shape every other test builds, and the
// shape a Bee run without a device file has: it must simply do nothing.
func TestCapabilityCooldownWithoutADirectoryIsInert(t *testing.T) {
	var store cooldownStore
	store.save("claude", "account", time.Now().Add(time.Hour))
	if at := store.load("claude", "account", time.Now()); !at.IsZero() {
		t.Fatalf("pathless store returned %v", at)
	}
}

// A stored time further ahead than beewire accepts would park the account
// behind reports Hive discards, so it is clamped rather than trusted.
func TestCapabilityCooldownClampsAFarFutureFile(t *testing.T) {
	store := cooldownStore{path: filepath.Join(t.TempDir(), "capability-cooldown.json")}
	now := time.Now()
	store.save("claude", "account", now.Add(72*time.Hour))
	at := store.load("claude", "account", now)
	if at.After(now.Add(time.Hour)) || !at.After(now.Add(59*time.Minute)) {
		t.Fatalf("far future cooldown not clamped to the hour ceiling: %v", at)
	}
	store.save("claude", "account", time.Time{})
	if at := store.load("claude", "account", now); !at.IsZero() {
		t.Fatalf("cleared cooldown still returned %v", at)
	}
}

func TestClaudeUnknownCapabilitiesNameTheirReason(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	for name, test := range map[string]struct {
		transport http.RoundTripper
		want      string
	}{
		"unreachable": {failingTransport{}, "HTTPS_PROXY"},
		"http error": {claudeTransport(func(r *http.Request) (*http.Response, error) {
			return claudeProfileResponse(503, `{}`), nil
		}), "/v1/models answered HTTP 503"},
	} {
		t.Run(name, func(t *testing.T) {
			source := claudeCapabilitySource{}
			got, err := source.observe(context.Background(), credential, "synthetic-account", 1, test.transport)
			if err != nil || got.Status != "unknown" || !strings.Contains(source.failure, test.want) {
				t.Fatalf("status=%s err=%v failure=%q", got.Status, err, source.failure)
			}
		})
	}
}
