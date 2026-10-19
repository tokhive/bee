package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"github.com/tokhive/bee/beewire"
)

type capabilitySource struct {
	LocalURL       string `json:"local_url,omitempty"`
	retryAt        time.Time
	account, user  string
	cached         beewire.Capabilities
	cachedAt       time.Time
	metadataModels []string
	metadataPlan   string
	metadataAt     time.Time
	transport      http.RoundTripper
	// failure is why the last observation came out unknown, empty when it
	// did not; logged is the failure the operator was last told about.
	failure, logged string
}

// reusable avoids extra upstream queries on reconnect while the observation
// remains current. Reset windows and expired metadata require a new query.
func (s *capabilitySource) reusable(now time.Time) bool {
	// A local fixture upstream has no quota endpoint to spare, and a test that
	// changes what it reports expects the next report to say so.
	if s.LocalURL != "" {
		return false
	}
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

func (s capabilitySource) valid() bool {
	if s.LocalURL == "" {
		return true
	}
	u, err := url.Parse(s.LocalURL)
	if err != nil {
		return false
	}
	ip := net.ParseIP(u.Hostname())
	return u.Scheme == "http" && ip != nil && ip.IsLoopback() && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/")
}

// codexClientVersion is the Codex CLI release Bee speaks as. The models
// endpoint lists only the models that release knows, so an old one hides
// newer models the account can use. Keep it equal to Hive's.
const codexClientVersion = "0.161.0"

// query fetches one official endpoint into target. It returns why it failed,
// empty on success, and the time a 429 asked to be left alone until.
func (s capabilitySource) query(ctx context.Context, credential codexCredential, path string, target any) (string, time.Time) {
	base := "https://chatgpt.com"
	if s.LocalURL != "" {
		base = s.LocalURL
	}
	u, err := url.Parse(base)
	if err != nil {
		return "invalid capability query URL", time.Time{}
	}
	reference, _ := url.Parse(path)
	req, err := http.NewRequestWithContext(ctx, "GET", u.ResolveReference(reference).String(), nil)
	if err != nil {
		return "invalid capability query URL", time.Time{}
	}
	req.Header.Set("Authorization", "Bearer "+credential.Secret.Token)
	req.Header.Set("ChatGPT-Account-Id", credential.AccountID)
	req.Header.Set("User-Agent", "codex_cli_rs/"+codexClientVersion)
	client := &http.Client{Transport: s.transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return capabilityTransportFailure(err), time.Time{}
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusTooManyRequests {
		retry := res.Header.Get("Retry-After")
		at, _ := http.ParseTime(retry)
		if seconds, err := strconv.ParseInt(retry, 10, 32); err == nil && seconds > 0 {
			at = wallNow().Add(time.Duration(seconds) * time.Second)
		}
		return reference.Path + " answered 429 without a usable Retry-After", at
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Sprintf("%s answered HTTP %d", reference.Path, res.StatusCode), time.Time{}
	}
	decoder := json.NewDecoder(io.LimitReader(res.Body, 1<<20))
	if decoder.Decode(target) != nil || decoder.Decode(new(any)) != io.EOF {
		return reference.Path + " response not understood", time.Time{}
	}
	return "", time.Time{}
}

// capabilityTransportFailure names a request that never got an answer. The
// usual cause is a proxy the official hosts need and did not get: HTTPS_PROXY
// when the process sets it, otherwise the egress connect_proxy.
func capabilityTransportFailure(err error) string {
	return "request failed (check HTTPS_PROXY, or connect_proxy when HTTPS_PROXY is unset): " + err.Error()
}

// logCapabilityFailure tells the operator once why a platform's capabilities
// are unknown, and once when they recover. Hive only ever sees "unknown"; the
// reason exists nowhere but here.
func logCapabilityFailure(platform string, logged *string, failure string) {
	if failure == *logged {
		return
	}
	if failure != "" {
		slog.Warn("capability query unknown", "module", "capabilities", "platform", platform, "reason", failure)
	} else {
		slog.Info("capability query recovered", "module", "capabilities", "platform", platform)
	}
	*logged = failure
}

type usageWindow struct {
	Used    *int   `json:"used_percent"`
	Seconds *int   `json:"limit_window_seconds"`
	After   *int   `json:"reset_after_seconds"`
	At      *int64 `json:"reset_at"`
}

// Separately metered models cannot inherit the main subscription window.
func excludedQuotaModels(scopes []json.RawMessage) (map[string]bool, bool) {
	excluded := map[string]bool{"gpt-5.3-codex-spark": true, "gpt-reserve": true}
	seen := map[string]bool{}
	for _, raw := range scopes {
		var scope struct {
			Feature string          `json:"metered_feature"`
			Name    string          `json:"limit_name"`
			Model   string          `json:"normal_model_slug"`
			Limit   json.RawMessage `json:"rate_limit"`
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&scope) != nil || seen[scope.Feature] {
			return nil, false
		}
		seen[scope.Feature] = true
		switch scope.Feature {
		case "codex_bengalfox":
			if scope.Name != "GPT-5.3-Codex-Spark" || scope.Model != "" {
				return nil, false
			}
		case "base_model_inference":
			if scope.Name != "gpt-reserve" || scope.Model == "" {
				return nil, false
			}
			excluded[scope.Model] = true
		default:
			return nil, false
		}
	}
	return excluded, true
}

func subscriptionSpendAvailable(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	var spend struct {
		Reached    *bool           `json:"reached"`
		Individual json.RawMessage `json:"individual_limit"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(&spend) == nil && spend.Reached != nil && !*spend.Reached && (len(spend.Individual) == 0 || string(spend.Individual) == "null")
}

// wallNow reads the clock without its monotonic reading. The monotonic clock
// stops while a Mac sleeps, so a time kept across a sleep and compared on it
// lags the wall clock Hive judges every report by: after a long sleep, Bee
// would keep sending model metadata it still thinks is fresh and Hive rejects
// as expired. Times without the reading compare on the wall clock.
func wallNow() time.Time { return time.Now().Round(0) }

func (s *capabilitySource) observe(ctx context.Context, credential codexCredential, sequence int64) beewire.Capabilities {
	now := wallNow()
	unknown := beewire.Capabilities{Sequence: sequence, ObservedAt: now, Status: "unknown", Models: []string{}, Windows: []beewire.QuotaWindow{}}
	s.failure = ""
	fail := func(reason string) beewire.Capabilities {
		s.failure = reason
		return unknown
	}
	if s.account != credential.AccountID || s.user != credential.UserID {
		s.retryAt, s.cached, s.cachedAt = time.Time{}, beewire.Capabilities{}, time.Time{}
		s.metadataModels, s.metadataPlan, s.metadataAt = nil, "", time.Time{}
		s.account, s.user = credential.AccountID, credential.UserID
	}
	if s.retryAt.IsZero() && s.reusable(now) && s.metadataPlan == credential.Plan {
		result := s.cached
		result.Sequence, result.ObservedAt = sequence, now
		result.Models = append([]string(nil), s.cached.Models...)
		result.Windows = append([]beewire.QuotaWindow(nil), s.cached.Windows...)
		if result.Valid(now) {
			return result
		}
		s.cached, s.cachedAt = beewire.Capabilities{}, time.Time{}
	}
	if now.Before(s.retryAt) {
		limited := unknown
		limited.Status, limited.RetryAt = "rate_limited", &s.retryAt
		if limited.Valid(now) {
			return limited
		}
		return fail("rate limit cooldown outside the accepted range")
	}
	s.retryAt = time.Time{}
	var models struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}
	var usage struct {
		Plan  string `json:"plan_type"`
		Limit *struct {
			Allowed   *bool        `json:"allowed"`
			Reached   *bool        `json:"limit_reached"`
			Primary   *usageWindow `json:"primary_window"`
			Secondary *usageWindow `json:"secondary_window"`
		} `json:"rate_limit"`
		Additional []json.RawMessage `json:"additional_rate_limits"`
		Spend      json.RawMessage   `json:"spend_control"`
	}
	refreshMetadata := s.LocalURL != "" || s.metadataAt.IsZero() || !now.Before(s.metadataAt.Add(capabilityMetadataTTL)) || s.metadataPlan != credential.Plan
	queries := []struct {
		path   string
		target any
	}{}
	if refreshMetadata {
		queries = append(queries, struct {
			path   string
			target any
		}{"/backend-api/codex/models?client_version=" + codexClientVersion, &models})
	}
	queries = append(queries, struct {
		path   string
		target any
	}{"/backend-api/wham/usage", &usage})
	for _, query := range queries {
		if failure, retry := s.query(ctx, credential, query.path, query.target); failure != "" {
			if retry.After(time.Now()) {
				s.retryAt = retry
				limited := unknown
				limited.Status, limited.RetryAt = "rate_limited", &retry
				if limited.Valid(time.Now()) {
					return limited
				}
			}
			return fail(failure)
		}
	}
	if usage.Limit == nil || usage.Limit.Allowed == nil || usage.Limit.Reached == nil {
		return fail("usage response has no rate_limit allowed/limit_reached")
	}
	if !subscriptionSpendAvailable(usage.Spend) {
		return fail("usage spend_control not recognised or reached")
	}
	single := beewire.OpenAISingleWindow(credential.Plan)
	if usage.Plan != "" && usage.Plan != credential.Plan || single != 0 && usage.Plan != credential.Plan {
		return fail(fmt.Sprintf("usage plan %q does not match authorization plan %q", usage.Plan, credential.Plan))
	}
	excluded, known := excludedQuotaModels(usage.Additional)
	if !known || len(usage.Additional) != 0 && credential.Plan != "pro" {
		return fail("usage additional_rate_limits not recognised")
	}
	result := unknown
	result.Status = "ready"
	result.Plan = credential.Plan
	catalog := s.metadataModels
	result.MetadataObservedAt = s.metadataAt
	if refreshMetadata {
		catalog = make([]string, 0, len(models.Models))
		for _, model := range models.Models {
			catalog = append(catalog, model.Slug)
		}
		result.MetadataObservedAt = now
	}
	for _, model := range catalog {
		if !excluded[model] {
			result.Models = append(result.Models, model)
		}
	}
	exhausted := false
	for _, window := range []*usageWindow{usage.Limit.Primary, usage.Limit.Secondary} {
		if window == nil && single != 0 {
			continue
		}
		if window == nil || window.Used == nil || window.Seconds == nil || window.After == nil || window.At == nil || *window.After < 0 || *window.After > *window.Seconds {
			return fail("usage quota window missing or incomplete")
		}
		reset := time.Unix(*window.At, 0)
		delta := reset.Sub(now.Add(time.Duration(*window.After) * time.Second))
		if delta < -time.Minute || delta > time.Minute {
			return fail("usage quota window reset times disagree (check the system clock)")
		}
		result.Windows = append(result.Windows, beewire.QuotaWindow{Seconds: *window.Seconds, UsedPercent: window.Used, ResetAt: reset})
		exhausted = exhausted || *window.Used >= 100
	}
	if (!*usage.Limit.Allowed || *usage.Limit.Reached) && !exhausted {
		return fail("usage reports the limit reached but no window is exhausted")
	}
	if !result.Valid(time.Now()) {
		return fail("capability snapshot failed validation")
	}
	if refreshMetadata {
		s.metadataModels, s.metadataPlan, s.metadataAt = catalog, credential.Plan, now
	}
	s.cached, s.cachedAt = result, now
	return result
}

func (cfg *egressConfig) synchronizeCapabilities(ctx context.Context, state localState, lease string, force bool) error {
	credential := *cfg.authorization
	cfg.capabilitySequence++
	snapshot := cfg.Capabilities.observe(ctx, credential, cfg.capabilitySequence)
	logCapabilityFailure("openai", &cfg.Capabilities.logged, cfg.Capabilities.failure)
	current, err := cfg.Codex.read(ctx)
	if err != nil || !current.sameAuthorization(credential) {
		// Do not publish a query from a source that changed while the requests ran.
		cfg.authorization = nil
		return call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/account/source", "PUT", state.Credential, map[string]string{"lease": lease}, nil)
	}
	fingerprint := sha256.Sum256([]byte(credential.AccountID + "\x00" + credential.UserID))
	revision := sha256.Sum256([]byte(credential.Secret.Token))
	report := beewire.CapabilityReport{Capabilities: snapshot, Lease: lease, AccountGeneration: cfg.accountGeneration, AccountFingerprint: hex.EncodeToString(fingerprint[:]), CredentialRevision: hex.EncodeToString(revision[:])}
	if snapshot.Status == "ready" && !force && cfg.capabilityRevision == report.CredentialRevision && cfg.metadataGeneration == cfg.accountGeneration && cfg.metadataLease == lease && !cfg.metadataReportedAt.IsZero() && cfg.metadataReportedAt.Equal(snapshot.MetadataObservedAt) && slices.Equal(cfg.metadataModels, snapshot.Models) {
		report.ReuseMetadata = true
		report.Plan, report.Models, report.MetadataObservedAt = "", nil, time.Time{}
	}
	if err := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/capabilities", "POST", state.Credential, report, nil); err != nil {
		var failure *apiFailure
		if errors.As(err, &failure) && failure.Code == "capability_metadata_required" {
			cfg.metadataReportedAt = time.Time{}
		}
		return err
	}
	slog.Debug("openai capability report accepted", "module", "capabilities", "status", snapshot.Status, "models", len(snapshot.Models))
	cfg.lastCapabilitySync = wallNow()
	cfg.capabilityReportPending = false
	cfg.capabilityRevision = report.CredentialRevision
	cfg.metadataReportedAt = snapshot.MetadataObservedAt
	cfg.metadataModels = append([]string(nil), snapshot.Models...)
	cfg.metadataGeneration, cfg.metadataLease = cfg.accountGeneration, lease
	return nil
}
