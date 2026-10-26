package bee

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"
)

// DesktopAccounts keeps public observations, never authorization material.
// Each platform has a separate, deadline-aware gate; snapshots are deep copies.
type DesktopAccounts struct {
	device      *DesktopDevice
	platforms   map[string]*desktopAccountPlatform
	goos        string
	now         func() time.Time
	readKeyring func(context.Context, string) ([]byte, error)
	transport   http.RoundTripper
}

type desktopAccountPlatform struct {
	gate               chan struct{}
	snapshot           DesktopAccountSnapshot
	source             *DesktopAccountSource
	credentialRevision string
}

type DesktopAccountError struct {
	Code     string            `json:"code"`
	Check    string            `json:"check"`
	Platform string            `json:"platform"`
	Message  string            `json:"message"`
	Evidence map[string]string `json:"evidence"`
}

func (e *DesktopAccountError) Error() string {
	return fmt.Sprintf("account %s: %s; check=%s, platform=%s, evidence=%v", e.Code, e.Message, e.Check, e.Platform, e.Evidence)
}

type DesktopAccountSource struct {
	Directory *string `json:"directory"`
	Store     string  `json:"store"`
}
type DesktopAccountCandidate struct {
	State            string                `json:"state"`
	Reference        *string               `json:"reference"`
	Source           *DesktopAccountSource `json:"source"`
	Fingerprint      *string               `json:"fingerprint"`
	Plan             *string               `json:"plan"`
	ExpiresAt        *string               `json:"expires_at"`
	IdentityVerified bool                  `json:"identity_verified"`
	ObservedAt       *string               `json:"observed_at"`
	Error            *DesktopAccountError  `json:"error"`
}
type DesktopAccountFact struct {
	State       string               `json:"state"`
	Fingerprint *string              `json:"fingerprint"`
	ObservedAt  *string              `json:"observed_at"`
	Error       *DesktopAccountError `json:"error"`
}
type DesktopAccountWindow struct {
	Scope       string  `json:"scope"`
	Seconds     int     `json:"seconds"`
	UsedPercent *int    `json:"used_percent"`
	ResetAt     *string `json:"reset_at"`
}
type DesktopAccountModel struct {
	ID               string `json:"id"`
	AccountSupported *bool  `json:"account_supported"`
	MarketOpen       *bool  `json:"market_open"`
	Accepting        *bool  `json:"accepting"`
}
type DesktopAccountCapabilities struct {
	Origin             string                 `json:"origin"`
	Status             string                 `json:"status"`
	ObservedAt         *string                `json:"observed_at"`
	MetadataObservedAt *string                `json:"metadata_observed_at"`
	ValidUntil         *string                `json:"valid_until"`
	RetryAt            *string                `json:"retry_at"`
	Plan               *string                `json:"plan"`
	Windows            []DesktopAccountWindow `json:"windows"`
	Models             []DesktopAccountModel  `json:"models"`
	Error              *DesktopAccountError   `json:"error"`
}
type DesktopAccountAvailability struct {
	Available bool    `json:"available"`
	Reason    *string `json:"reason"`
}
type DesktopAccountFeatures struct {
	Detect              DesktopAccountAvailability `json:"detect"`
	Check               DesktopAccountAvailability `json:"check"`
	Select              DesktopAccountAvailability `json:"select"`
	ConfirmChange       DesktopAccountAvailability `json:"confirm_change"`
	Remove              DesktopAccountAvailability `json:"remove"`
	ClearSelection      DesktopAccountAvailability `json:"clear_selection"`
	Authorize           DesktopAccountAvailability `json:"authorize"`
	SystemNotifications DesktopAccountAvailability `json:"system_notifications"`
}
type DesktopAccountIssue struct {
	Code        string  `json:"code"`
	Platform    string  `json:"platform"`
	Fingerprint *string `json:"fingerprint"`
	Message     string  `json:"message"`
	Notify      bool    `json:"notify"`
}
type DesktopAccountSnapshot struct {
	Platform      string                       `json:"platform"`
	Revision      int64                        `json:"revision"`
	Candidate     DesktopAccountCandidate      `json:"candidate"`
	Selection     DesktopAccountFact           `json:"selection"`
	Hive          DesktopAccountFact           `json:"hive"`
	Authorization DesktopAccountFact           `json:"authorization"`
	Capabilities  []DesktopAccountCapabilities `json:"capabilities"`
	Features      DesktopAccountFeatures       `json:"features"`
	Issues        []DesktopAccountIssue        `json:"issues"`
	CheckedAt     *string                      `json:"checked_at"`
}
type DesktopAccountStore struct {
	Store     string  `json:"store"`
	Supported bool    `json:"supported"`
	Reason    *string `json:"reason"`
}
type DesktopAccountDefault struct {
	Platform     string                `json:"platform"`
	Directory    string                `json:"directory"`
	DefaultStore string                `json:"default_store"`
	Stores       []DesktopAccountStore `json:"stores"`
}
type DesktopAccountDefaults struct {
	Platforms []DesktopAccountDefault `json:"platforms"`
}
type DesktopAccountDetectRequest struct {
	Platform  string  `json:"platform"`
	Directory *string `json:"directory"`
	Store     string  `json:"store"`
	Mode      string  `json:"mode"`
}
type DesktopAccountActionRequest struct {
	Platform     string `json:"platform"`
	Revision     int64  `json:"revision"`
	CandidateRef string `json:"candidate_ref"`
	Action       string `json:"action"`
	Confirmed    bool   `json:"confirmed"`
}

func accountString(value string) *string { return &value }
func accountTime(value time.Time) *string {
	if value.IsZero() {
		return nil
	}
	return accountString(value.UTC().Format(time.RFC3339Nano))
}
func accountFailure(platform, code, check, message string) *DesktopAccountError {
	return &DesktopAccountError{Code: code, Check: check, Platform: platform, Message: message, Evidence: map[string]string{}}
}
func unavailable(reason string) DesktopAccountAvailability {
	return DesktopAccountAvailability{Reason: accountString(reason)}
}
func initialAccountSnapshot(platform string) DesktopAccountSnapshot {
	blocked := unavailable("runtime_ownership_and_source_barrier_required")
	return DesktopAccountSnapshot{
		Platform: platform, Candidate: DesktopAccountCandidate{State: "not_checked"},
		Selection: DesktopAccountFact{State: "not_selected"}, Hive: DesktopAccountFact{State: "not_checked"},
		Authorization: DesktopAccountFact{State: "not_checked"}, Capabilities: []DesktopAccountCapabilities{emptyAccountCapabilities("official"), emptyAccountCapabilities("hive")}, Issues: []DesktopAccountIssue{},
		Features: DesktopAccountFeatures{Detect: DesktopAccountAvailability{Available: true}, Check: DesktopAccountAvailability{Available: true},
			Select: blocked, ConfirmChange: blocked, ClearSelection: blocked, Remove: unavailable("runtime_drain_and_detach_required"),
			Authorize: unavailable("verified_official_authorization_adapter_required"), SystemNotifications: unavailable("system_notification_service_required")},
	}
}
func NewDesktopAccounts(device *DesktopDevice) *DesktopAccounts {
	result := &DesktopAccounts{device: device, platforms: map[string]*desktopAccountPlatform{}, goos: runtime.GOOS, now: time.Now, readKeyring: readCodexKeyring}
	for _, platform := range []string{"openai", "claude"} {
		result.platforms[platform] = &desktopAccountPlatform{gate: make(chan struct{}, 1), snapshot: initialAccountSnapshot(platform)}
	}
	return result
}
func (a *DesktopAccounts) acquire(ctx context.Context, platform string) (*desktopAccountPlatform, func(), error) {
	p, ok := a.platforms[platform]
	if !ok {
		return nil, nil, accountFailure("unknown", "invalid_platform", "platform", "required=openai,claude")
	}
	select {
	case p.gate <- struct{}{}:
		if ctx.Err() != nil {
			<-p.gate
			return nil, nil, accountFailure(platform, "deadline", "platform_gate", "request context canceled before source access")
		}
		return p, func() { <-p.gate }, nil
	case <-ctx.Done():
		return nil, nil, accountFailure(platform, "deadline", "platform_gate", "request canceled or 12-second deadline exceeded")
	}
}
func accountSnapshotCopy(s DesktopAccountSnapshot) DesktopAccountSnapshot {
	// Only public DTOs enter this copy; pointers/maps never escape shared state.
	raw, _ := json.Marshal(s)
	var result DesktopAccountSnapshot
	_ = json.Unmarshal(raw, &result)
	return result
}
func (a *DesktopAccounts) Snapshot(ctx context.Context, platform string, refresh bool) (DesktopAccountSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	p, release, err := a.acquire(ctx, platform)
	if err != nil {
		return DesktopAccountSnapshot{}, err
	}
	defer release()
	a.expireCandidate(p, platform)
	return accountSnapshotCopy(p.snapshot), nil
}
func (a *DesktopAccounts) expireCandidate(p *desktopAccountPlatform, platform string) {
	c := &p.snapshot.Candidate
	if c.Reference == nil || c.ExpiresAt == nil {
		return
	}
	expires, err := time.Parse(time.RFC3339Nano, *c.ExpiresAt)
	if err != nil || !a.now().Add(30*time.Second).Before(expires) {
		c.State = "expired"
		c.Reference = nil
		p.snapshot.Revision++
		c.Error = accountFailure(platform, "expired", "expiry", "authorization no longer satisfies expires_at > now+30s")
		c.Error.Evidence["expires_at"] = *c.ExpiresAt
		p.snapshot.Authorization = DesktopAccountFact{State: "expired", ObservedAt: accountTime(a.now()), Error: c.Error}
	}
}
func (a *DesktopAccounts) Detect(ctx context.Context, request DesktopAccountDetectRequest) (DesktopAccountSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if err := validateDesktopAccountDetect(request); err != nil {
		return DesktopAccountSnapshot{}, err
	}
	p, release, err := a.acquire(ctx, request.Platform)
	if err != nil {
		return DesktopAccountSnapshot{}, err
	}
	defer release()
	// Invalidate before reading: a failed replacement must not keep an old candidate usable.
	p.snapshot.Revision++
	p.snapshot.Candidate = DesktopAccountCandidate{State: "unavailable", ObservedAt: accountTime(a.now())}
	p.snapshot.Capabilities[0] = emptyAccountCapabilities("official")
	p.snapshot.Authorization = DesktopAccountFact{State: "unknown"}
	p.snapshot.CheckedAt = accountTime(a.now())
	p.source, p.credentialRevision = nil, ""
	read, failure := a.readAccountSource(ctx, request)
	if failure != nil {
		p.snapshot.Candidate.Error = failure
		p.snapshot.Candidate.State = failure.Code
		p.snapshot.Authorization = DesktopAccountFact{State: failure.Code, ObservedAt: accountTime(a.now()), Error: failure}
		return accountSnapshotCopy(p.snapshot), nil
	}
	defer read.clear()
	p.snapshot.Candidate = DesktopAccountCandidate{State: "available", Source: &read.source, Fingerprint: read.fingerprint,
		Plan: accountString(read.plan), ExpiresAt: accountTime(read.expires), ObservedAt: accountTime(a.now())}
	if !a.now().Add(30 * time.Second).Before(read.expires) {
		p.snapshot.Candidate.State = "expired"
		p.snapshot.Candidate.Error = accountFailure(request.Platform, "expired", "expiry", "authorization must expire more than 30 seconds from now")
	} else if read.plan == "unknown" {
		p.snapshot.Candidate.State = "unknown_plan"
		p.snapshot.Candidate.Error = accountFailure(request.Platform, "unknown_plan", "plan", "subscription plan is not recognized")
	} else if request.Platform == "claude" && !read.claude.hasInferenceScope {
		p.snapshot.Candidate.State = "missing_scope"
		p.snapshot.Candidate.Error = accountFailure(request.Platform, "missing_scope", "scope", "required=user:inference")
	} else {
		var random [24]byte
		if _, err := rand.Read(random[:]); err != nil {
			return DesktopAccountSnapshot{}, accountFailure(request.Platform, "reference_failed", "candidate_reference", "system random source failed")
		}
		p.snapshot.Candidate.Reference = accountString(hex.EncodeToString(random[:]))
		p.source, p.credentialRevision = &read.source, read.revision
		p.snapshot.Authorization = DesktopAccountFact{State: "local_structure_only", ObservedAt: accountTime(a.now())}
	}
	return accountSnapshotCopy(p.snapshot), nil
}
func emptyAccountCapabilities(origin string) DesktopAccountCapabilities {
	return DesktopAccountCapabilities{Origin: origin, Status: "unknown", Windows: []DesktopAccountWindow{}, Models: []DesktopAccountModel{}}
}
func (a *DesktopAccounts) Action(ctx context.Context, request DesktopAccountActionRequest) (DesktopAccountSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	p, release, err := a.acquire(ctx, request.Platform)
	if err != nil {
		return DesktopAccountSnapshot{}, err
	}
	defer release()
	fail := func(code, check, message string) (DesktopAccountSnapshot, error) {
		return accountSnapshotCopy(p.snapshot), accountFailure(request.Platform, code, check, message)
	}
	a.expireCandidate(p, request.Platform)
	if !request.Confirmed {
		return fail("confirmation_required", "confirmed", "explicit confirmed=true required")
	}
	if request.Revision < 0 || request.Revision > 9007199254740991 || request.Revision != p.snapshot.Revision {
		return fail("stale_revision", "revision", "revision must match the current platform snapshot")
	}
	if p.snapshot.Candidate.Reference == nil || request.CandidateRef != *p.snapshot.Candidate.Reference {
		return fail("stale_candidate", "candidate_ref", "candidate must belong to this platform and current management instance")
	}
	switch request.Action {
	case "select", "confirm_change", "clear_selection":
		return fail("runtime_dependency", "runtime_ownership", "runtime ownership, unused-source proof and source-switch barrier are required")
	case "remove":
		return fail("runtime_dependency", "runtime_detach", "runtime stop, drain and credential-detach proof are required")
	default:
		return fail("invalid_action", "action", "required=select,confirm_change,remove,clear_selection")
	}
}
