package bee

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/tokhive/bee/beewire"
)

type claudeSource struct {
	Store                 string  `json:"store"`
	ConfigDir             *string `json:"config_dir,omitempty"`
	Refresh               bool    `json:"refresh,omitempty"`
	Capabilities          bool    `json:"capabilities,omitempty"`
	read                  func(context.Context) (claudeCredential, error)
	transport             http.RoundTripper
	credential            claudeCredential
	identity              claudeIdentity
	verifiedAt            time.Time
	retryAt               time.Time
	lastState             string
	maintenance           *claudeMaintenance
	capabilities          claudeCapabilitySource
	capabilitySequence    int64
	capabilityRevision    string
	lastCapabilitySync    time.Time
	lastCapabilityAttempt time.Time
	metadataReportedAt    time.Time
	metadataGeneration    int64
	metadataLease         string
	pacer                 syncPacer
	reportedAuth          beewire.Authorization
}

// capabilityWorkAt is when this platform next owes a capability report, so the
// pacer never idles past work the cycle would otherwise have picked up. A
// cooldown that expires sooner than the interval is the earlier of the two.
func (source *claudeSource) capabilityWorkAt() time.Time {
	if !source.Capabilities {
		return time.Time{}
	}
	at := source.lastCapabilitySync.Add(beewire.CapabilityUsageInterval)
	if retry := source.capabilities.retryAt; !retry.IsZero() && retry.Before(at) {
		at = retry
	}
	return at
}

func (source *claudeSource) message(out io.Writer, state, message string) {
	if source.lastState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", "claude", "state", state)
		source.lastState = state
	}
}

func (source *claudeSource) authorization(ctx context.Context) (claudeCredential, beewire.Authorization, error) {
	if source.read == nil {
		store, err := resolveClaudeStore(source.Store, source.ConfigDir)
		if err != nil {
			return claudeCredential{}, beewire.Authorization{}, err
		}
		source.read = store.read
		if source.Refresh {
			source.maintenance = &claudeMaintenance{directory: store.directory, namespace: store.namespace, readRaw: store.readRaw, writeRaw: store.writeRaw, validateWrite: store.validateWrite, transport: source.transport}
		}
	}
	credential, err := source.read(ctx)
	if err == nil && !credential.available(time.Now()) {
		err = errClaudeExpired
	}
	if err == nil && !credential.hasInferenceScope {
		err = errors.New("Claude authorization lacks the user:inference scope")
	}
	if err != nil {
		source.verifiedAt = time.Time{}
		return claudeCredential{}, beewire.Authorization{}, err
	}
	if source.verifiedAt.IsZero() || source.credential != credential || time.Since(source.verifiedAt) >= 5*time.Minute {
		if time.Now().Before(source.retryAt) {
			return claudeCredential{}, beewire.Authorization{}, errors.New("official Claude identity query temporarily unavailable; waiting to retry")
		}
		source.verifiedAt = time.Time{}
		identity, err := queryClaudeProfile(ctx, credential, source.transport)
		if err != nil {
			source.retryAt = time.Now().Add(30 * time.Second)
			return claudeCredential{}, beewire.Authorization{}, err
		}
		current, err := source.read(ctx)
		if err != nil || current != credential || !current.available(time.Now()) {
			return claudeCredential{}, beewire.Authorization{}, errClaudeSourceChanged
		}
		source.credential, source.identity, source.verifiedAt = credential, identity, time.Now()
		source.retryAt = time.Time{}
	}
	metadata := credential.metadata(source.identity)
	if source.maintenance != nil {
		if err := source.maintenance.remember(ctx, credential, metadata); err != nil {
			return claudeCredential{}, beewire.Authorization{}, err
		}
	}
	return credential, metadata, nil
}

func (source *claudeSource) synchronize(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	// The local source is read every cycle whatever the pacer says: it is what
	// notices that the provider logged in again, and waiting out an
	// observation window before looking would make a re-login take as long as
	// the window. Only the Hive round trip below is paced, because that is the
	// part that costs a write transaction.
	credential, auth, err := source.authorization(ctx)
	if !force && err == nil && auth == source.reportedAuth && source.pacer.skip(time.Now()) {
		return nil
	}
	path := "/api/bee/platforms/claude/account"
	// The previous cycle's response already carried the account version this
	// one has to claim, so the read is only for a cycle that has none.
	observed, known := source.pacer.expected()
	source.pacer.unsettled()
	if !known {
		if readErr := call(ctx, httpClient(), state.Hive, path, "GET", state.Credential, nil, &observed); readErr != nil {
			return readErr
		}
	}
	if observed.Platform != "claude" {
		return errors.New("Hive returned an unexpected platform for the Claude account")
	}
	stop := func(reason error) error {
		if err := call(ctx, httpClient(), state.Hive, path+"/source", "PUT", state.Credential, map[string]string{"lease": lease}, nil); err != nil {
			return err
		}
		source.message(out, "source_unavailable", "new Claude jobs paused; waiting for official authorization recovery: "+reason.Error())
		return nil
	}
	profileRejected := errors.Is(err, errClaudeProfileRejected)
	if err != nil && source.maintenance != nil && (errors.Is(err, errClaudeExpired) || errors.Is(err, errClaudeProfileRejected) || observed.Status == "authorization_rejected") {
		credential, auth, err = source.maintenance.binding(ctx)
	}
	if err != nil {
		return stop(err)
	}
	var result beewire.MaintenanceResponse
	input := beewire.MaintenanceRequest{Lease: lease, Claude: &auth, ExpectedGeneration: observed.Generation, ExpectedRevision: observed.CredentialRevision, RefreshSupported: source.maintenance != nil && credential.hasRefreshToken, RefreshRequired: profileRejected}
	if err := call(ctx, httpClient(), state.Hive, "/api/bee/maintenance", "POST", state.Credential, input, &result); err != nil {
		return err
	}
	if result.Account.Platform != "claude" {
		return errors.New("Hive returned an unexpected platform for Claude maintenance")
	}
	if result.Account.Status == "confirmation_required" {
		source.message(out, "confirmation_required", "different Claude account detected; new jobs paused; run bee account-status --platform claude and explicitly confirm with bee confirm-account")
		return nil
	}
	if result.Task == nil {
		if result.Account.Status != "ready" {
			source.message(out, "maintenance_wait", "Claude authorization maintenance incomplete; new jobs paused")
			return nil
		}
	} else {
		task := result.Task
		if task.ID == "" || (task.Kind != "reencrypt_authorization" && task.Kind != "refresh_authorization") || task.Platform != "claude" || task.DeviceID != state.Identity.ID || task.AccountGeneration != result.Account.Generation || task.AccountFingerprint != auth.AccountFingerprint || task.CredentialRevision != auth.CredentialRevision || task.KeyVersion < 1 {
			return errors.New("invalid Hive Claude authorization maintenance task binding")
		}
		var key tee.InboxPublic
		if err := call(ctx, httpClient(), state.Hive, "/api/bee/credential-key", "GET", state.Credential, nil, &key); err != nil {
			return err
		}
		if !validClaudeMaintenanceKey(key) {
			return errInboxIdentity
		}
		if task.Key.KeyID != key.KeyID || sha256.Sum256(task.Key.PublicKey) != task.Key.KeyID {
			return errors.New("TEE inbox public key changed; waiting for a new Claude maintenance task")
		}
		if task.Kind == "refresh_authorization" {
			if source.maintenance == nil {
				return stop(errors.New("current Claude source does not support writing refreshed credentials"))
			}
			slog.Info("claude maintenance task received", "module", "maintenance", "task", task.ID, "kind", task.Kind)
			var identity claudeIdentity
			credential, identity, err = source.maintenance.execute(ctx, *task, auth)
			if err != nil {
				if errors.Is(err, errClaudeLock) {
					return err
				}
				return stop(err)
			}
			slog.Info("claude maintenance task completed", "module", "maintenance", "task", task.ID, "kind", task.Kind)
			source.credential, source.identity, source.verifiedAt = credential, identity, time.Now()
			source.retryAt = time.Time{}
			auth = credential.metadata(identity)
		} else {
			slog.Info("claude maintenance task received", "module", "maintenance", "task", task.ID, "kind", task.Kind)
		}
		current, err := source.read(ctx)
		if err != nil || current != credential || !current.available(time.Now()) {
			source.verifiedAt = time.Time{}
			return stop(errClaudeSourceChanged)
		}
		envelope, err := tee.EncryptCredential(key, beewire.ProviderID(state.Identity.ID), credential.secret)
		if err != nil {
			return errInboxIdentity
		}
		upload := beewire.CredentialRegistration{Lease: lease, Envelope: envelope, Claude: &auth, TaskID: task.ID}
		var registered struct {
			Generation int64 `json:"account_generation"`
		}
		if err := call(ctx, httpClient(), state.Hive, "/api/bee/credentials", "POST", state.Credential, upload, &registered); err != nil {
			var failure *apiFailure
			if errors.As(err, &failure) && failure.Code == "invalid_claude_authorization" {
				return stop(errClaudeExpired)
			}
			return err
		}
		if registered.Generation != task.AccountGeneration {
			return errors.New("Hive returned an unexpected Claude account generation")
		}
		slog.Debug("claude credential registered", "module", "maintenance", "task", task.ID, "generation", registered.Generation)
	}
	source.message(out, "ready", "Claude authorization synchronized and account confirmed")
	if source.Capabilities && (force || time.Since(source.lastCapabilityAttempt) >= 10*time.Second && (source.capabilityRevision != auth.CredentialRevision || time.Since(source.lastCapabilitySync) >= beewire.CapabilityUsageInterval)) {
		source.lastCapabilityAttempt = time.Now()
		source.capabilitySequence++
		snapshot, err := source.capabilities.observe(ctx, credential, auth.AccountFingerprint, source.capabilitySequence, source.transport)
		source.capabilities.announce(out)
		logCapabilityFailure("claude", &source.capabilities.logged, source.capabilities.failure)
		if errors.Is(err, errClaudeProfileRejected) {
			source.verifiedAt = time.Time{}
			return stop(err)
		}
		current, readErr := source.read(ctx)
		if readErr != nil || current != credential || !current.available(time.Now()) {
			source.verifiedAt = time.Time{}
			return stop(errClaudeSourceChanged)
		}
		report := beewire.CapabilityReport{Capabilities: snapshot, Lease: lease, AccountGeneration: result.Account.Generation, AccountFingerprint: auth.AccountFingerprint, CredentialRevision: auth.CredentialRevision}
		if snapshot.Status == "ready" && !force && source.capabilityRevision == auth.CredentialRevision && source.metadataGeneration == result.Account.Generation && source.metadataLease == lease && !source.metadataReportedAt.IsZero() && source.metadataReportedAt.Equal(snapshot.MetadataObservedAt) {
			report.ReuseMetadata = true
			report.Plan, report.Models, report.MetadataObservedAt = "", nil, time.Time{}
		}
		if err := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/claude/capabilities", "POST", state.Credential, report, nil); err != nil {
			var failure *apiFailure
			if errors.As(err, &failure) && failure.Code == "capability_metadata_required" {
				source.metadataReportedAt = time.Time{}
			}
			return err
		}
		slog.Debug("claude capability report accepted", "module", "capabilities", "status", snapshot.Status, "models", len(snapshot.Models))
		source.lastCapabilitySync = time.Now()
		source.metadataReportedAt = snapshot.MetadataObservedAt
		source.metadataGeneration, source.metadataLease = result.Account.Generation, lease
		source.capabilityRevision = auth.CredentialRevision
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
