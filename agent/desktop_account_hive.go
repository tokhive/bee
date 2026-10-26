package bee

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"time"

	"github.com/tokhive/bee/beewire"
)

type desktopAccountBinding struct{ hive, owner, device, fingerprint string }

var desktopAccountModelPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)

func desktopAccountModelID(value string) bool { return desktopAccountModelPattern.MatchString(value) }

func (a *DesktopAccounts) refreshAccountHive(ctx context.Context, p *desktopAccountPlatform, platform string) {
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: "unbound"}}
	p.snapshot.Capabilities[1] = emptyAccountCapabilities("hive")
	p.snapshot.Issues = []DesktopAccountIssue{}
	if a.device == nil {
		return
	}
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		setAccountHiveFailure(p, platform, "device_lock", err)
		return
	}
	defer release()
	path := session.path
	// An unbound read never creates an account state file or new device config.
	state, err := session.read()
	if err != nil {
		setAccountHiveFailure(p, platform, "configuration", err)
		return
	}
	if state.Identity == nil || state.Credential == "" {
		p.binding = nil
		return
	}
	if state.Identity == nil || !deviceCredentialPattern.MatchString(state.Credential) {
		p.binding = nil
		setAccountHiveFailure(p, platform, "binding", errors.New("saved identity or credential format absent"))
		return
	}
	origin, e := hiveOrigin(state.Hive)
	if e != nil || origin != state.Hive {
		p.binding = nil
		setAccountHiveFailure(p, platform, "hive_origin", errors.New("saved Hive is not a canonical allowed origin"))
		return
	}
	if err := validateDesktopIdentity(state, *state.Identity); err != nil {
		p.binding = nil
		setAccountHiveFailure(p, platform, "saved_identity", err)
		return
	}
	if p.binding != nil && (p.binding.hive != state.Hive || p.binding.owner != state.Identity.OwnerID || p.binding.device != state.Identity.ID) {
		p.binding = nil
	}
	var identity beewire.Identity
	if err := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, state.Credential, nil, &identity); err != nil {
		setAccountHiveFailure(p, platform, "identity", err)
		var remote *apiFailure
		if errors.As(err, &remote) && (remote.Status == 401 || remote.Status == 403) {
			p.binding = nil
		} else if p.binding != nil {
			a.accountIssues(p, platform, path, *p.binding, []string{"offline"}, false)
		}
		return
	}
	if err := validateDesktopIdentity(state, identity); err != nil {
		p.binding = nil
		setAccountHiveFailure(p, platform, "identity_binding", err)
		return
	}
	if err := a.loadSelection(p, session, state, platform); err != nil {
		setAccountHiveFailure(p, platform, "selection_storage", err)
		return
	}
	base := "/api/bee/platforms/" + platform
	var before, after beewire.PlatformAccount
	var caps beewire.Capabilities
	if err := desktopCall(ctx, state, base+"/account", http.MethodGet, state.Credential, nil, &before); err != nil {
		setAccountHiveFailure(p, platform, "account_before", err)
		return
	}
	if err := validateDesktopHiveAccount(before, platform); err != nil {
		setAccountHiveFailure(p, platform, "account_before_schema", err)
		return
	}
	capErr := desktopCall(ctx, state, base+"/capabilities", http.MethodGet, state.Credential, nil, &caps)
	if err := desktopCall(ctx, state, base+"/account", http.MethodGet, state.Credential, nil, &after); err != nil {
		setAccountHiveFailure(p, platform, "account_after", err)
		return
	}
	if err := validateDesktopHiveAccount(after, platform); err != nil {
		setAccountHiveFailure(p, platform, "account_after_schema", err)
		return
	}
	if before.AccountFingerprint != after.AccountFingerprint || before.Generation != after.Generation || before.CredentialRevision != after.CredentialRevision || before.Status != after.Status || before.PendingFingerprint != after.PendingFingerprint {
		setAccountHiveFailure(p, platform, "account_sandwich", errors.New("account fingerprint, generation, authorization revision or status changed between reads"))
		return
	}
	now := a.now()
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: after.Status, ObservedAt: accountTime(now)}, Generation: &after.Generation}
	if after.PendingFingerprint != "" {
		p.snapshot.Hive.PendingFingerprint = accountString(after.PendingFingerprint)
	}
	p.snapshot.CheckedAt = accountTime(now)
	if after.AccountFingerprint != "" {
		p.snapshot.Hive.Fingerprint = accountString(after.AccountFingerprint)
	}
	p.binding = &desktopAccountBinding{hive: state.Hive, owner: identity.OwnerID, device: identity.ID, fingerprint: after.AccountFingerprint}
	problems := []string{}
	if after.Status == "source_unavailable" || after.Status == "authorization_rejected" || after.Status == "confirmation_required" {
		problems = append(problems, after.Status)
	}
	if capErr != nil {
		p.snapshot.Capabilities[1].Error = hiveAccountError(platform, "capabilities", capErr)
	} else if err := validateDesktopHiveCapabilities(caps, platform, now); err != nil {
		p.snapshot.Capabilities[1].Error = hiveAccountError(platform, "capabilities_schema", err)
	} else {
		p.snapshot.Capabilities[1] = publicAccountCapabilities("hive", platform, caps)
		expireOfficialCapabilities(&p.snapshot.Capabilities[1], now)
		if caps.Status == "quota_exhausted" || caps.Status == "rate_limited" {
			problems = append(problems, caps.Status)
		}
		if p.snapshot.Capabilities[1].Status == "ready" && caps.ReasonFor(platform, now, "") == beewire.ReasonQuotaExhausted {
			problems = append(problems, "quota_exhausted")
		}
	}
	a.accountIssues(p, platform, path, *p.binding, problems, true)
}
func hiveAccountError(platform, check string, err error) *DesktopAccountError {
	failure := accountFailure(platform, "hive_unconfirmed", check, err.Error())
	failure.Evidence["confirmed"] = "false"
	return failure
}
func setAccountHiveFailure(p *desktopAccountPlatform, platform, check string, err error) {
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: "unconfirmed", Error: hiveAccountError(platform, check, err)}}
	p.snapshot.Capabilities[1] = emptyAccountCapabilities("hive")
	p.snapshot.Issues = []DesktopAccountIssue{{Code: "hive_unconfirmed", Platform: platform, Message: p.snapshot.Hive.Error.Error()}}
}
func validateDesktopHiveAccount(c beewire.PlatformAccount, platform string) error {
	if c.Platform != platform {
		return errors.New("Hive account platform mismatch; required=requested platform")
	}
	if _, ok := accountStateLabels[c.Status]; !ok {
		return errors.New("Hive account status outside the known account state set")
	}
	if c.Generation < 0 || c.Generation > 9007199254740991 {
		return fmt.Errorf("Hive account generation invalid: actual=%d; required=nonnegative safe integer", c.Generation)
	}
	if c.AccountFingerprint != "" && !desktopAccountDigest(c.AccountFingerprint) {
		return errors.New("Hive account fingerprint invalid; required=SHA256 hex")
	}
	if c.PendingFingerprint != "" && !desktopAccountDigest(c.PendingFingerprint) {
		return errors.New("Hive pending fingerprint invalid; required=SHA256 hex")
	}
	if c.CredentialRevision != "" && !desktopAccountDigest(c.CredentialRevision) {
		return errors.New("Hive credential revision invalid; required=SHA256 hex")
	}
	if c.Status == "ready" && (c.AccountFingerprint == "" || c.CredentialRevision == "" || c.Generation < 1) {
		return errors.New("Hive ready account lacks fingerprint, credential revision or positive generation")
	}
	return nil
}
func validateDesktopHiveCapabilities(c beewire.Capabilities, platform string, now time.Time) error {
	if c.Status != "ready" && c.Status != "unknown" && !slices.Contains(beewire.SupplyReasons(), c.Status) {
		return errors.New("Hive capability status outside the known read status set")
	}
	if c.Sequence < 0 || c.Sequence > 9007199254740991 || len(c.Models) > 32 || len(c.Windows) > 5 || c.ObservedAt.After(now.Add(5*time.Second)) || c.MetadataObservedAt.After(now.Add(5*time.Second)) {
		return errors.New("Hive capability shape or timestamps invalid; required=bounded lists, safe sequence, no future observations")
	}
	if c.Plan != "" && !beewire.KnownPlan(platform, c.Plan) {
		return errors.New("Hive capability plan outside the platform known set")
	}
	seen := map[string]bool{}
	for _, model := range c.Models {
		if !desktopAccountModelID(model) || seen[model] || platform == "claude" && beewire.ClaudeModelFamily(model) == "" {
			return errors.New("Hive capability model ID invalid or duplicated")
		}
		seen[model] = true
	}
	for _, w := range c.Windows {
		if w.Seconds != 18000 && w.Seconds != 604800 && !(platform == "openai" && w.Seconds == 2592000) || w.UsedPercent != nil && (*w.UsedPercent < 0 || *w.UsedPercent > 10000) || !slices.Contains([]string{"", "sonnet", "opus", "oauth_apps"}, w.Scope) {
			return errors.New("Hive quota window invalid; required=known duration/scope and percentage null or 0..10000")
		}
	}
	return nil
}
func (a *DesktopAccounts) accountIssues(p *desktopAccountPlatform, platform, devicePath string, b desktopAccountBinding, problems []string, recovery bool) {
	p.snapshot.Issues = []DesktopAccountIssue{}
	for _, code := range problems {
		p.snapshot.Issues = append(p.snapshot.Issues, DesktopAccountIssue{Code: code, Platform: platform, Fingerprint: accountString(b.fingerprint), Message: code})
	}
	for _, code := range []string{"offline", "source_unavailable", "authorization_rejected", "confirmation_required", "quota_exhausted", "rate_limited"} {
		active := slices.Contains(problems, code)
		if !active && !(recovery && accountProblemRecovered(p.snapshot, code, a.now())) {
			continue
		}
		delay := time.Duration(0)
		if code == "offline" {
			delay = time.Minute
		}
		a.storageMu.Lock()
		notify, err := updateDesktopAccountNotice(filepath.Join(filepath.Dir(devicePath), "ai-accounts.json"), desktopNoticeKey(b.hive, b.owner, platform, b.fingerprint, code), a.now().UTC(), active, delay)
		a.storageMu.Unlock()
		if active {
			for i := range p.snapshot.Issues {
				if p.snapshot.Issues[i].Code == code {
					p.snapshot.Issues[i].Notify = notify
				}
			}
		}
		if err != nil {
			p.snapshot.Issues = append(p.snapshot.Issues, DesktopAccountIssue{Code: "notice_storage_unconfirmed", Platform: platform, Message: "notification deduplication persistence unconfirmed: " + err.Error()})
			return
		}
	}
}
func accountProblemRecovered(s DesktopAccountSnapshot, code string, now time.Time) bool {
	if code == "offline" {
		return s.Hive.Error == nil && s.Hive.State != "unconfirmed"
	}
	if code == "source_unavailable" || code == "authorization_rejected" || code == "confirmation_required" {
		return s.Hive.State == "ready"
	}
	c := s.Capabilities[1]
	if c.Status != "ready" || c.Error != nil || c.ValidUntil == nil || len(c.Windows) == 0 {
		return false
	}
	until, e := time.Parse(time.RFC3339Nano, *c.ValidUntil)
	if e != nil || !now.Before(until) {
		return false
	}
	for _, w := range c.Windows {
		if w.Scope == "opus" || w.Scope == "sonnet" {
			continue
		}
		if w.UsedPercent == nil || w.ResetAt == nil {
			return false
		}
		reset, e := time.Parse(time.RFC3339Nano, *w.ResetAt)
		if e != nil || !now.Before(reset) || code == "quota_exhausted" && *w.UsedPercent >= 100 {
			return false
		}
	}
	return true
}
