package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/tokhive/bee/beewire"
)

// DesktopNotificationFact contains only an opaque S1 identity and fixed public
// problem facts. It cannot carry source paths, account identities or messages.
type DesktopNotificationFact struct {
	Identity  string `json:"identity"`
	Platform  string `json:"platform"`
	Problem   string `json:"problem"`
	Active    bool   `json:"active"`
	Eligible  bool   `json:"eligible"`
	Recovered bool   `json:"recovered"`
}
type DesktopNotificationSnapshot struct {
	Facts           []DesktopNotificationFact `json:"facts"`
	ObservedAt      string                    `json:"observed_at"`
	NetworkRevision int64                     `json:"network_revision"`
}

var notificationWindowsSIDPattern = regexp.MustCompile(`S-[0-9]+(?:-[0-9]+)+`)

// NotificationSnapshot reads S1's existing snapshot and durable reminder gate.
// It never refreshes account state, reads an authorization source, updates the
// notice ledger, or consumes the one-observation Issues.Notify pulse.
func (a *DesktopAccounts) NotificationSnapshot(ctx context.Context) (DesktopNotificationSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	result := DesktopNotificationSnapshot{Facts: []DesktopNotificationFact{}, ObservedAt: a.now().UTC().Format(time.RFC3339Nano)}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	// Acquire only the public snapshot gates. a.acquire invalidates official
	// observations on network changes and is deliberately not used by this read.
	for _, platform := range []string{"openai", "claude"} {
		p := a.platforms[platform]
		select {
		case p.gate <- struct{}{}:
			defer func() { <-p.gate }()
		case <-ctx.Done():
			return result, ctx.Err()
		}
	}
	a.networkMu.RLock()
	defer a.networkMu.RUnlock()
	result.NetworkRevision = a.network.Revision
	if a.device == nil {
		return result, nil
	}
	devicePath, err := a.device.configPath()
	if err != nil {
		return result, notificationReadFailure("device_config_location", err, false)
	}
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return result, notificationReadFailure("device_session", err, true, devicePath+".lock", devicePath)
	}
	defer release()
	// Match S1's storage -> session ordering and keep device identity and the
	// persisted selections/notices coherent during this bounded disk-only read.
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	session.mu.Lock()
	defer session.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	state, err := readState(session.path)
	if err != nil {
		return result, notificationReadFailure("device_state", err, false, session.path)
	}
	if state.Identity == nil || state.Credential == "" {
		return result, nil
	}
	if !deviceCredentialPattern.MatchString(state.Credential) || state.Pairing != nil {
		return result, fmt.Errorf("notification device binding rejected: credential_format_valid=%t pairing_present=%t", deviceCredentialPattern.MatchString(state.Credential), state.Pairing != nil)
	}
	origin, err := hiveOrigin(state.Hive)
	if err != nil || origin != state.Hive {
		return result, errors.New("notification device origin check failed: canonical_allowed_origin=false")
	}
	if err := validateDesktopIdentity(state, *state.Identity); err != nil {
		return result, notificationReadFailure("device_identity", err, true)
	}
	path := filepath.Join(filepath.Dir(session.path), "ai-accounts.json")
	disk, err := readDesktopAccountState(path)
	if err != nil {
		return result, notificationReadFailure("account_state", err, true, path, session.path)
	}
	scope, ok := disk.Scopes[desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)]
	if !ok {
		return result, nil
	}
	now := a.now()
	for _, platform := range []string{"openai", "claude"} {
		selected, ok := scope.Selections[platform]
		if !ok {
			continue
		}
		p := a.platforms[platform]
		bound := p.binding != nil && p.binding.hive == state.Hive && p.binding.owner == state.Identity.OwnerID && p.binding.device == state.Identity.ID && p.binding.fingerprint == selected.Fingerprint
		selectedMatches := p.selected != nil && reflect.DeepEqual(*p.selected, selected) && p.snapshot.Platform == platform && p.snapshot.Selection.State == "selected" && p.snapshot.Selection.Fingerprint != nil && *p.snapshot.Selection.Fingerprint == selected.Fingerprint
		_, pending := scope.PendingOperations[platform]
		trusted := bound && selectedMatches && !p.working && p.pending == nil && !pending
		for _, issue := range p.snapshot.Issues {
			if issue.Code == "notice_storage_unconfirmed" {
				trusted = false
			}
		}
		positive := trusted && notificationPositiveObservation(p.snapshot, selected.Fingerprint, platform, now)
		for _, problem := range []string{"authorization_rejected", "confirmation_required", "offline", "quota_exhausted"} {
			fact := DesktopNotificationFact{Identity: desktopNoticeKey(state.Hive, state.Identity.OwnerID, platform, selected.Fingerprint, problem), Platform: platform, Problem: problem}
			issueCount, matching := 0, false
			for _, issue := range p.snapshot.Issues {
				if issue.Code == problem {
					issueCount++
					matching = issue.Platform == platform && issue.Fingerprint != nil && *issue.Fingerprint == selected.Fingerprint
				}
			}
			if trusted {
				// An explicit offline issue can accompany an unconfirmed Hive
				// read. Its timing remains exclusively S1's durable Notified gate.
				fact.Active = issueCount == 1 && matching && (positive || problem == "offline")
				notice, exists := disk.Entries[fact.Identity]
				fact.Eligible = fact.Active && exists && notice.Notified && !notice.FirstSeen.After(now)
				// No issue is insufficient evidence. Only S1's positive recovery
				// predicate over a fresh, bound observation may clear OS dedupe.
				if issueCount == 0 && positive {
					fact.Recovered = accountProblemRecovered(p.snapshot, problem, now)
				}
			}
			result.Facts = append(result.Facts, fact)
		}
	}
	return result, nil
}

func notificationPositiveObservation(s DesktopAccountSnapshot, fingerprint, platform string, now time.Time) bool {
	_, known := accountStateLabels[s.Hive.State]
	if !known || s.Hive.Error != nil || s.Hive.Fingerprint == nil || *s.Hive.Fingerprint != fingerprint || len(s.Capabilities) < 2 || s.Capabilities[1].Origin != "hive" {
		return false
	}
	for _, timestamp := range []*string{s.CheckedAt, s.Hive.ObservedAt} {
		if timestamp == nil {
			return false
		}
		observed, err := time.Parse(time.RFC3339Nano, *timestamp)
		if err != nil || observed.After(now) || !now.Before(observed.Add(beewire.CapabilityLifetimeFor(platform))) {
			return false
		}
	}
	return true
}

// Device JSON decoding can quote untrusted keys; filesystem errors contain
// private paths. Preserve safe native codes/offsets and S1's closed-schema checks.
func notificationReadFailure(stage string, err error, trustedSchema bool, paths ...string) error {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return fmt.Errorf("notification %s failed: errno=%d cause=%s", stage, errno, errno.Error())
	}
	var syntax *json.SyntaxError
	if errors.As(err, &syntax) {
		return fmt.Errorf("notification %s JSON syntax rejected: byte=%d", stage, syntax.Offset)
	}
	var shape *json.UnmarshalTypeError
	if errors.As(err, &shape) {
		return fmt.Errorf("notification %s JSON type rejected: byte=%d required_type=%s", stage, shape.Offset, shape.Type)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("notification %s canceled: %w", stage, err)
	}
	if strings.Contains(err.Error(), "json: unknown field") {
		return fmt.Errorf("notification %s JSON schema rejected: unknown_field=true; required=closed device schema", stage)
	}
	if trustedSchema {
		message := err.Error()
		for _, path := range paths {
			message = strings.ReplaceAll(message, fmt.Sprintf("%q", path), "<private-file>")
			message = strings.ReplaceAll(message, path, "<private-file>")
		}
		message = notificationWindowsSIDPattern.ReplaceAllString(message, "<os-user>")
		return fmt.Errorf("notification %s rejected: %s", stage, message)
	}
	// Unknown localState fields are user-controlled and must not be echoed.
	var pathError *os.PathError
	if errors.As(err, &pathError) {
		return fmt.Errorf("notification %s file access failed: operation=%s cause_type=%T", stage, pathError.Op, pathError.Err)
	}
	return fmt.Errorf("notification %s rejected: cause_type=%T; required=trusted device JSON and live shared session", stage, err)
}
