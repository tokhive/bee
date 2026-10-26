package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// Cache contains only public observations and metadata. In particular the
// runtime observers' raw account/user fields are never retained here.
type desktopOfficialObservation struct {
	key                           string
	fingerprint                   *string
	identityVerified              bool
	capabilities                  DesktopAccountCapabilities
	identityError                 *DesktopAccountError
	at                            time.Time
	metadataModels                []string
	metadataPlan, metadataVersion string
	metadataAt                    time.Time
}
type desktopObservationTransport struct {
	base            http.RoundTripper
	status          int
	path            string
	retryAt         time.Time
	transportFailed bool
}

func (t *desktopObservationTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.path = r.URL.Path
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	res, err := base.RoundTrip(r)
	if err != nil {
		t.transportFailed = true
		return nil, errors.New("official transport returned no HTTP response")
	}
	t.status = res.StatusCode
	if res.StatusCode == 429 {
		now := time.Now()
		at, _ := http.ParseTime(res.Header.Get("Retry-After"))
		if seconds, e := strconv.ParseInt(res.Header.Get("Retry-After"), 10, 32); e == nil && seconds > 0 {
			at = now.Add(time.Duration(seconds) * time.Second)
		}
		if !at.After(now) {
			at = now.Add(beewire.CapabilityLifetime)
		}
		if at.After(now.Add(time.Hour)) {
			at = now.Add(time.Hour)
		}
		t.retryAt = at
	}
	return res, nil
}
func desktopObservationKey(read desktopAccountRead) string {
	fingerprint := ""
	if read.fingerprint != nil {
		fingerprint = *read.fingerprint
	}
	value, _ := json.Marshal([]any{read.source, read.namespace, fingerprint, read.revision, read.plan, read.expires, read.claude.hasInferenceScope, read.claude.hasProfileScope})
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}
func (o *desktopOfficialObservation) reusable(now time.Time) bool {
	if o == nil || now.Before(o.at) {
		return false
	}
	if o.capabilities.RetryAt != nil {
		at, err := time.Parse(time.RFC3339Nano, *o.capabilities.RetryAt)
		return err == nil && now.Before(at)
	}
	if o.capabilities.Status != "ready" || !now.Before(o.at.Add(beewire.CapabilityUsageInterval)) || !now.Before(o.metadataAt.Add(beewire.CapabilityMetadataInterval)) {
		return false
	}
	if o.capabilities.Error != nil {
		return false
	}
	if o.capabilities.ObservedAt == nil {
		return false
	}
	observed, err := time.Parse(time.RFC3339Nano, *o.capabilities.ObservedAt)
	if err != nil || !now.Before(observed.Add(beewire.CapabilityUsageInterval)) {
		return false
	}
	for _, w := range o.capabilities.Windows {
		if w.ResetAt == nil {
			return false
		}
		at, err := time.Parse(time.RFC3339Nano, *w.ResetAt)
		if err != nil || !now.Before(at) {
			return false
		}
	}
	return true
}
func (a *DesktopAccounts) observeOfficial(ctx context.Context, p *desktopAccountPlatform, r DesktopAccountDetectRequest, read desktopAccountRead) {
	key := desktopObservationKey(read)
	old := p.official
	if old != nil && old.key == key && old.reusable(a.now()) {
		applyOfficialObservation(p, old)
		return
	}
	if r.Mode != "official" {
		return
	}
	if r.Platform == "claude" && (!read.claude.hasProfileScope || !read.claude.hasInferenceScope) {
		failure := accountFailure(r.Platform, "missing_scope", "official_scopes", "official check requires user:profile and user:inference")
		failure.Evidence["profile_scope"] = strconv.FormatBool(read.claude.hasProfileScope)
		failure.Evidence["inference_scope"] = strconv.FormatBool(read.claude.hasInferenceScope)
		p.snapshot.Authorization.Error = failure
		return
	}
	observation := &desktopOfficialObservation{key: key, at: a.now().UTC(), fingerprint: read.fingerprint}
	transport := &desktopObservationTransport{base: a.transport}
	var caps beewire.Capabilities
	var failure string
	metadata := old
	if metadata == nil || metadata.key != key {
		metadata = &desktopOfficialObservation{}
	}
	observation.metadataModels, observation.metadataPlan, observation.metadataAt, observation.metadataVersion = metadata.metadataModels, metadata.metadataPlan, metadata.metadataAt, metadata.metadataVersion
	if r.Platform == "claude" {
		identity, err := queryClaudeProfile(ctx, read.claude, transport)
		if err != nil {
			observation.identityError = officialObservationError(r.Platform, "profile", err.Error(), transport)
			observation.capabilities = emptyAccountCapabilities("official")
			observation.capabilities.Error = observation.identityError
			if !transport.retryAt.IsZero() {
				observation.capabilities.Status = "rate_limited"
				observation.capabilities.RetryAt = accountTime(transport.retryAt)
				observation.capabilities.ObservedAt = accountTime(observation.at)
			}
		} else {
			fp := identity.fingerprint()
			observation.fingerprint = &fp
			observation.identityVerified = true
			probe := claudeCapabilitySource{fingerprint: fp, restored: true, metadataModels: metadata.metadataModels, metadataPlan: metadata.metadataPlan, metadataAt: metadata.metadataAt, metadataVersion: metadata.metadataVersion}
			caps, _ = probe.observe(ctx, read.claude, fp, 1, transport)
			failure = probe.failure
			observation.metadataModels, observation.metadataPlan, observation.metadataAt, observation.metadataVersion = probe.metadataModels, probe.metadataPlan, probe.metadataAt, probe.metadataVersion
		}
	} else {
		probe := capabilitySource{home: *read.source.Directory, transport: transport, account: read.codex.AccountID, user: read.codex.UserID, metadataModels: metadata.metadataModels, metadataPlan: metadata.metadataPlan, metadataAt: metadata.metadataAt, metadataVersion: metadata.metadataVersion}
		caps = probe.observe(ctx, read.codex, 1)
		failure = probe.failure
		observation.metadataModels, observation.metadataPlan, observation.metadataAt, observation.metadataVersion = probe.metadataModels, probe.metadataPlan, probe.metadataAt, probe.metadataVersion
	}
	if observation.capabilities.Origin == "" {
		observation.capabilities = publicAccountCapabilities("official", r.Platform, caps)
		if failure != "" {
			observation.capabilities.Error = officialObservationError(r.Platform, "capabilities", failure, transport)
		}
		if !transport.retryAt.IsZero() {
			observation.capabilities.Status = "rate_limited"
			observation.capabilities.RetryAt = accountTime(transport.retryAt)
		}
	}
	// Even a failed query is discarded if its source changed. Never associate
	// the first account's identity/quota with the second account's candidate.
	current, err := a.readAccountSource(ctx, r)
	defer current.clear()
	var readbackFailure *DesktopAccountError
	if err != nil {
		readbackFailure = accountFailure(r.Platform, "unconfirmed", "source_readback", "official observation could not verify its source after the query")
		readbackFailure.Evidence["cause"] = err.Error()
	} else if !a.now().Add(30 * time.Second).Before(current.expires) {
		readbackFailure = accountFailure(r.Platform, "expired", "source_expiry_readback", "authorization entered the 30-second expiry boundary during official observation")
		readbackFailure.Evidence["expires_at"] = *accountTime(current.expires)
	} else if desktopObservationKey(current) != key {
		readbackFailure = accountFailure(r.Platform, "source_changed", "query_source_readback", "authorization source changed during official observation")
		readbackFailure.Evidence["source_revision_match"] = "false"
	}
	if readbackFailure != nil {
		p.official = nil
		p.source = nil
		p.credentialRevision = ""
		p.snapshot.Candidate.Reference = nil
		p.snapshot.Candidate.Fingerprint = nil
		p.snapshot.Candidate.IdentityVerified = false
		p.snapshot.Candidate.State = readbackFailure.Code
		p.snapshot.Candidate.Error = readbackFailure
		p.snapshot.Capabilities[0] = emptyAccountCapabilities("official")
		p.snapshot.Authorization = DesktopAccountFact{State: "unknown", Error: p.snapshot.Candidate.Error}
		return
	}
	if old != nil && old.key == key && observation.capabilities.Error != nil && observation.capabilities.Status != "rate_limited" && old.capabilities.ValidUntil != nil {
		until, e := time.Parse(time.RFC3339Nano, *old.capabilities.ValidUntil)
		if e == nil && a.now().Before(until) {
			failure := observation.capabilities.Error
			observation.capabilities = old.capabilities
			observation.capabilities.Error = failure
			expireOfficialCapabilities(&observation.capabilities, a.now())
		}
	}
	p.official = observation
	applyOfficialObservation(p, observation)
}
func applyOfficialObservation(p *desktopAccountPlatform, o *desktopOfficialObservation) {
	p.snapshot.Capabilities[0] = o.capabilities
	if o.identityVerified {
		p.snapshot.Candidate.IdentityVerified = true
		p.snapshot.Candidate.Fingerprint = o.fingerprint
		p.snapshot.Authorization = DesktopAccountFact{State: "official_identity_verified", Fingerprint: o.fingerprint, ObservedAt: accountTime(o.at)}
	}
	if o.identityError != nil {
		p.snapshot.Authorization.Error = o.identityError
	}
}
func officialObservationError(platform, check, reason string, t *desktopObservationTransport) *DesktopAccountError {
	// The one legacy diagnostic quoting upstream data is deliberately reduced
	// to its failed check. Transport error strings were sanitized at entry.
	if strings.HasPrefix(reason, "usage plan ") {
		reason = "usage plan does not match the local authorization plan"
	}
	failure := accountFailure(platform, "official_check_failed", check, reason)
	failure.Evidence["http_status"] = strconv.Itoa(t.status)
	failure.Evidence["path"] = t.path
	failure.Evidence["transport_failed"] = strconv.FormatBool(t.transportFailed)
	return failure
}
func publicAccountCapabilities(origin, platform string, c beewire.Capabilities) DesktopAccountCapabilities {
	result := emptyAccountCapabilities(origin)
	result.Status = c.Status
	if result.Status == "" {
		result.Status = "unknown"
	}
	result.ObservedAt = accountTime(c.ObservedAt)
	result.MetadataObservedAt = accountTime(c.MetadataObservedAt)
	if !c.ObservedAt.IsZero() {
		result.ValidUntil = accountTime(c.ObservedAt.Add(beewire.CapabilityLifetimeFor(platform)))
	}
	if c.RetryAt != nil {
		result.RetryAt = accountTime(*c.RetryAt)
	}
	if beewire.KnownPlan(platform, c.Plan) {
		result.Plan = accountString(c.Plan)
	}
	for _, w := range c.Windows {
		result.Windows = append(result.Windows, DesktopAccountWindow{Scope: w.Scope, Seconds: w.Seconds, UsedPercent: w.UsedPercent, ResetAt: accountTime(w.ResetAt)})
	}
	for _, model := range c.Models {
		supported := true
		result.Models = append(result.Models, DesktopAccountModel{ID: model, AccountSupported: &supported})
	}
	return result
}
func expireOfficialCapabilities(c *DesktopAccountCapabilities, now time.Time) {
	if c.ValidUntil == nil {
		return
	}
	until, err := time.Parse(time.RFC3339Nano, *c.ValidUntil)
	if err != nil || !now.Before(until) {
		c.Status = "stale"
		return
	}
	for _, w := range c.Windows {
		if w.ResetAt != nil {
			reset, e := time.Parse(time.RFC3339Nano, *w.ResetAt)
			if e != nil || !now.Before(reset) {
				c.Status = "stale"
				return
			}
		}
	}
}
