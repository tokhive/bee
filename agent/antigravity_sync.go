package bee

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

type antigravitySource struct {
	Capabilities bool `json:"capabilities,omitempty"`
	// directory is Bee's configuration directory, under which the sign-in is
	// kept; empty selects the default device configuration's.
	directory             string
	transport             http.RoundTripper
	lastState             string
	capabilities          antigravityCapabilitySource
	capabilitySequence    int64
	capabilityRevision    string
	lastCapabilitySync    time.Time
	lastCapabilityAttempt time.Time
	// announceReady is a capability recovery whose readiness line waits for
	// Hive to accept the report.
	announceReady bool
	// capabilityWanted is Hive asking for a capability report now; it lives
	// on the egress configuration, which control streams reach.
	capabilityWanted   *atomic.Bool
	metadataReportedAt time.Time
	metadataGeneration int64
	metadataLease      string
	pacer              syncPacer
	reportedAuth       beewire.Authorization
	// suspended is the last unavailable source this Bee told Hive about: why,
	// on which connection, and when. See unavailableReportInterval.
	suspended struct {
		reason, lease string
		at            time.Time
	}
	// refreshFailed is the token whose refresh did not succeed and when it may
	// be tried again, so a task repeated every cycle is not a request to
	// Google every cycle.
	refreshFailed struct {
		revision string
		retryAt  time.Time
	}
}

func (source *antigravitySource) store() antigravityStore {
	directory := source.directory
	if directory == "" {
		directory = filepath.Dir(defaultConfigPath())
	}
	return antigravityStoreIn(directory)
}

func (source *antigravitySource) message(out io.Writer, state, message string) {
	if source.lastState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", beewire.GooglePlatform, "state", state)
		source.lastState = state
	}
}

// capabilityWorkAt is when this platform next owes a capability report, so the
// pacer never idles past work the cycle would otherwise have picked up. A
// cooldown that expires sooner than the interval is the earlier of the two.
func (source *antigravitySource) capabilityWorkAt() time.Time {
	if !source.Capabilities {
		return time.Time{}
	}
	at := source.lastCapabilitySync.Add(beewire.CapabilityUsageInterval)
	if retry := source.capabilities.retryAt; !retry.IsZero() && retry.Before(at) {
		at = retry
	}
	return at
}

// authorization reads the stored sign-in. Bee wrote it from Google's own
// answers, so unlike an official client's store it needs no identity query
// before it is believed. An expired access token is still reported while a
// refresh token can renew it: that report is what has Hive schedule the
// refresh.
func (source *antigravitySource) authorization() (antigravityCredential, beewire.Authorization, error) {
	credential, err := source.store().read()
	switch {
	case err != nil:
	case credential.Rejected != "":
		err = errAntigravitySignIn
	case !beewire.KnownPlan(beewire.GooglePlatform, credential.Plan):
		err = fmt.Errorf("the stored Antigravity sign-in has tier %q, which Bee does not supply", credential.Tier)
	case credential.RefreshToken == "" && !credential.available(time.Now()):
		err = errAntigravityExpired
	}
	if err != nil {
		return antigravityCredential{}, beewire.Authorization{}, err
	}
	return credential, credential.metadata(), nil
}

func (source *antigravitySource) synchronize(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	// The store is read every cycle whatever the pacer says: it is what
	// notices a new sign-in. Only the Hive round trip below is paced.
	credential, auth, err := source.authorization()
	if last := source.suspended; err == nil {
		source.suspended.reason = ""
	} else if !force && last.lease == lease && last.reason == err.Error() && time.Since(last.at) < unavailableReportInterval {
		// Still unavailable for the reason Hive was told a moment ago.
		return nil
	}
	refreshRequired := err == nil && source.capabilities.wantsRefresh(auth.CredentialRevision, time.Now())
	if !force && err == nil && auth == source.reportedAuth && !refreshRequired && !capabilityRequestDue(source.capabilityWanted, source.lastCapabilityAttempt) && source.pacer.skip(time.Now()) {
		return nil
	}
	path := "/api/bee/platforms/" + beewire.GooglePlatform + "/account"
	// The previous cycle's response already carried the account version this
	// one has to claim, so the read is only for a cycle that has none.
	observed, known := source.pacer.expected()
	source.pacer.unsettled()
	if !known {
		if readErr := callState(ctx, httpClient(), state, path, "GET", nil, &observed); readErr != nil {
			return readErr
		}
	}
	if observed.Platform != beewire.GooglePlatform {
		return errors.New("Hive returned an unexpected platform for the Google account")
	}
	stop := func(reason error) error {
		if err := callState(ctx, httpClient(), state, path+"/source", "PUT", map[string]string{"lease": lease}, nil); err != nil {
			return err
		}
		source.suspended.reason, source.suspended.lease, source.suspended.at = reason.Error(), lease, time.Now()
		source.message(out, "source_unavailable", "new Google jobs paused; waiting for the Antigravity sign-in: "+reason.Error())
		return nil
	}
	if err != nil {
		return stop(err)
	}
	var result beewire.MaintenanceResponse
	input := beewire.MaintenanceRequest{Lease: lease, Antigravity: &auth, ExpectedGeneration: observed.Generation, ExpectedRevision: observed.CredentialRevision, RefreshSupported: credential.RefreshToken != "", RefreshRequired: refreshRequired}
	if err := callState(ctx, httpClient(), state, "/api/bee/maintenance", "POST", input, &result); err != nil {
		return err
	}
	if refreshRequired {
		source.capabilities.askedRefresh(auth.CredentialRevision, time.Now())
		slog.Info("google authorization stale; refresh requested", "module", "maintenance")
	}
	if result.Account.Platform != beewire.GooglePlatform {
		return errors.New("Hive returned an unexpected platform for Google maintenance")
	}
	if result.Account.Status == "account_in_use" {
		source.message(out, "account_in_use", accountStateLabels["account_in_use"]+"; new Google jobs paused")
		return nil
	}
	if result.Account.Status == "confirmation_required" {
		source.message(out, "confirmation_required", "different Google account detected; new jobs paused; run bee account-status --platform google and explicitly confirm with bee confirm-account")
		return nil
	}
	if result.Task == nil {
		if result.Account.Status != "ready" {
			source.message(out, "maintenance_wait", "Google authorization maintenance incomplete; new jobs paused")
			return nil
		}
	} else {
		task := result.Task
		if task.ID == "" || (task.Kind != "reencrypt_authorization" && task.Kind != "refresh_authorization") || task.Platform != beewire.GooglePlatform || task.DeviceID != state.Identity.ID || task.AccountGeneration != result.Account.Generation || task.AccountFingerprint != auth.AccountFingerprint || task.CredentialRevision != auth.CredentialRevision || task.KeyVersion < 1 {
			return errors.New("invalid Hive Google authorization maintenance task binding")
		}
		key, err := fetchInboxKey(ctx, state, "")
		if err != nil {
			return err
		}
		if !validClaudeMaintenanceKey(key) {
			return errInboxIdentity
		}
		if task.Key.KeyID != key.KeyID || sha256.Sum256(task.Key.PublicKey) != task.Key.KeyID {
			return errors.New("TEE inbox public key changed; waiting for a new Google maintenance task")
		}
		slog.Info("google maintenance task received", "module", "maintenance", "task", task.ID, "kind", task.Kind)
		if task.Kind == "refresh_authorization" {
			if wait := time.Until(source.refreshFailed.retryAt); wait > 0 && source.refreshFailed.revision == auth.CredentialRevision {
				return fmt.Errorf("Google token refresh did not succeed; trying again in %s", wait.Round(time.Second))
			}
			credential, err = source.refresh(ctx, *task)
			if errors.Is(err, errAntigravityLock) || errors.Is(err, errAntigravitySourceChanged) {
				return err
			}
			if err != nil {
				// Google is left alone for a moment whatever it said. Unless
				// it ended the sign-in nothing was lost: the refresh token is
				// still good, and the next task repeats the request.
				source.refreshFailed.revision, source.refreshFailed.retryAt = auth.CredentialRevision, time.Now().Add(30*time.Second)
				if errors.Is(err, errAntigravitySignIn) || errors.Is(err, errAntigravityExpired) {
					return stop(err)
				}
				return err
			}
			slog.Info("google maintenance task completed", "module", "maintenance", "task", task.ID, "kind", task.Kind)
			auth = credential.metadata()
		}
		current, err := source.store().read()
		if err != nil || !current.same(credential) {
			return stop(errAntigravitySourceChanged)
		}
		if !current.available(time.Now()) {
			return stop(errAntigravityStale)
		}
		envelope, err := tee.EncryptCredential(key, beewire.ProviderID(state.Identity.ID), credential.secret())
		if err != nil {
			return errInboxIdentity
		}
		upload := beewire.CredentialRegistration{Lease: lease, Envelope: envelope, Antigravity: &auth, TaskID: task.ID}
		var registered struct {
			Generation int64 `json:"account_generation"`
		}
		if err := callState(ctx, httpClient(), state, "/api/bee/credentials", "POST", upload, &registered); err != nil {
			var failure *apiFailure
			if errors.As(err, &failure) && failure.Code == "invalid_antigravity_authorization" {
				return stop(errAntigravityStale)
			}
			return err
		}
		if registered.Generation != task.AccountGeneration {
			return errors.New("Hive returned an unexpected Google account generation")
		}
		slog.Debug("google credential registered", "module", "maintenance", "task", task.ID, "generation", registered.Generation)
	}
	source.message(out, "ready", "Google authorization synchronized and account confirmed")
	if source.Capabilities && (force || capabilityRequestDue(source.capabilityWanted, source.lastCapabilityAttempt) || time.Since(source.lastCapabilityAttempt) >= 10*time.Second && (source.capabilityRevision != auth.CredentialRevision || time.Since(source.lastCapabilitySync) >= beewire.CapabilityUsageInterval)) {
		source.lastCapabilityAttempt = time.Now()
		if source.capabilityWanted != nil {
			source.capabilityWanted.Store(false)
		}
		source.capabilitySequence++
		snapshot := source.capabilities.observe(ctx, credential, source.capabilitySequence, source.transport)
		source.capabilities.announce(out)
		if logCapabilityFailure(beewire.GooglePlatform, &source.capabilities.logged, source.capabilities.failure) {
			source.announceReady = true
		}
		// Do not publish a query from a sign-in that changed while it ran.
		if current, err := source.store().read(); err != nil || !current.same(credential) {
			return stop(errAntigravitySourceChanged)
		}
		report := beewire.CapabilityReport{Capabilities: snapshot, Lease: lease, AccountGeneration: result.Account.Generation, AccountFingerprint: auth.AccountFingerprint, CredentialRevision: auth.CredentialRevision}
		if snapshot.Status == "ready" && !force && source.capabilityRevision == auth.CredentialRevision && source.metadataGeneration == result.Account.Generation && source.metadataLease == lease && !source.metadataReportedAt.IsZero() && source.metadataReportedAt.Equal(snapshot.MetadataObservedAt) {
			report.ReuseMetadata = true
			report.Plan, report.Models, report.MetadataObservedAt = "", nil, time.Time{}
		}
		if err := callState(ctx, httpClient(), state, "/api/bee/platforms/"+beewire.GooglePlatform+"/capabilities", "POST", report, nil); err != nil {
			var failure *apiFailure
			if errors.As(err, &failure) && failure.Code == "capability_metadata_required" {
				source.metadataReportedAt = time.Time{}
			}
			return err
		}
		slog.Debug("google capability report accepted", "module", "capabilities", "status", snapshot.Status, "models", len(snapshot.Models))
		source.lastCapabilitySync = wallNow()
		source.metadataReportedAt = snapshot.MetadataObservedAt
		source.metadataGeneration, source.metadataLease = result.Account.Generation, lease
		source.capabilityRevision = auth.CredentialRevision
		if source.announceReady {
			source.announceReady = false
			go reportReadiness(ctx, state, beewire.GooglePlatform, out)
		}
	}
	// A cycle that handled a task leaves Hive in a state worth confirming at
	// once, so only a quiet one may idle, and only until the observation needs
	// renewing or the next capability report falls due.
	if result.Task == nil {
		source.reportedAuth = auth
		source.pacer.settled(result.Account, time.Now(), source.capabilityWorkAt())
	}
	return nil
}
