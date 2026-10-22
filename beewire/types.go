package beewire

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/tokhive/tee/tee"
)

// ProviderID maps a bound device to the reference protocol's lowercase identifier.
func ProviderID(deviceID string) string {
	hash := sha256.Sum256([]byte(deviceID))
	return hex.EncodeToString(hash[:])
}

type StartPairing struct {
	Name           string `json:"name"`
	CredentialHash string `json:"credential_hash"`
}

type Pairing struct {
	PairingToken    string    `json:"pairing_token,omitempty"`
	UserCode        string    `json:"user_code,omitempty"`
	VerificationURI string    `json:"verification_uri,omitempty"`
	ExpiresAt       time.Time `json:"expires_at"`
	PollInterval    int       `json:"poll_interval_seconds"`
	Status          string    `json:"status"`
}

type Identity struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OwnerID    string `json:"owner_id"`
	OwnerEmail string `json:"owner_email"`
}

type PlatformSupply struct {
	Platform string   `json:"platform"`
	Paused   bool     `json:"paused"`
	Ready    bool     `json:"ready"`
	Reasons  []string `json:"reasons"`
}

// Authorization is Bee-reported control metadata, never proof of model access or quota.
type Authorization struct {
	AccountID          string    `json:"account_id"`
	AccountFingerprint string    `json:"account_fingerprint"`
	ExpiresAt          time.Time `json:"expires_at"`
	CredentialRevision string    `json:"credential_revision"`
}

type CodexAuthorization = Authorization

func (a Authorization) Available(now time.Time) bool {
	return now.Add(30 * time.Second).Before(a.ExpiresAt)
}

func (a Authorization) Valid(now time.Time) bool {
	return a.ValidMetadata() && a.Available(now)
}

func (a Authorization) ValidMetadata() bool {
	revision, err := hex.DecodeString(a.CredentialRevision)
	return a.ValidIdentity() && !a.ExpiresAt.IsZero() && err == nil && len(revision) == 32
}

type PlatformAccount struct {
	Platform           string `json:"platform"`
	Status             string `json:"status"`
	AccountFingerprint string `json:"account_fingerprint"`
	Generation         int64  `json:"generation"`
	PendingFingerprint string `json:"pending_fingerprint"`
	ConfirmationID     string `json:"confirmation_id"`
	CredentialRevision string `json:"credential_revision"`
	// SourceValidUntil is when Hive stops dispatching and settling for this
	// account unless the agent observes its source again. Without it on the
	// wire an agent cannot tell how much of its window is left, and the only
	// safe cadence is one short enough to be wrong about any deadline — which
	// is what a fixed two second loop was. Zero from a Hive that predates the
	// field, and an agent must keep its old cadence when it reads zero.
	SourceValidUntil time.Time `json:"source_valid_until,omitzero"`
}

type MaintenanceTask struct {
	ID                 string          `json:"id"`
	Kind               string          `json:"kind"`
	DeviceID           string          `json:"device_id"`
	Platform           string          `json:"platform"`
	AccountFingerprint string          `json:"account_fingerprint"`
	AccountGeneration  int64           `json:"account_generation"`
	CredentialRevision string          `json:"credential_revision"`
	KeyVersion         int64           `json:"key_version"`
	Key                tee.InboxPublic `json:"key"`
}

type MaintenanceRequest struct {
	RefreshSupported   bool               `json:"refresh_supported,omitempty"`
	RefreshRequired    bool               `json:"refresh_required,omitempty"`
	Lease              string             `json:"lease"`
	Codex              CodexAuthorization `json:"codex,omitzero"`
	Claude             *Authorization     `json:"claude,omitempty"`
	ExpectedGeneration int64              `json:"expected_generation"`
	ExpectedRevision   string             `json:"expected_revision"`
}

func (r MaintenanceRequest) Authorization() (string, Authorization, bool) {
	if r.Claude != nil {
		return "claude", *r.Claude, r.Codex == (Authorization{}) && r.Claude.ValidMetadata()
	}
	return "openai", r.Codex, r.Codex.ValidMetadata()
}

type CredentialRegistration struct {
	Lease    string         `json:"lease"`
	Envelope tee.Envelope   `json:"envelope"`
	Codex    *Authorization `json:"codex,omitempty"`
	Claude   *Authorization `json:"claude,omitempty"`
	TaskID   string         `json:"task_id,omitempty"`
}

type MaintenanceResponse struct {
	Account PlatformAccount  `json:"account"`
	Task    *MaintenanceTask `json:"task"`
}

func (a Authorization) ValidIdentity() bool {
	fingerprint, err := hex.DecodeString(a.AccountFingerprint)
	return ValidCodexIdentity(a.AccountID) && err == nil && len(fingerprint) == 32
}

func ValidCodexIdentity(value string) bool {
	if len(value) == 0 || len(value) > 256 {
		return false
	}
	for _, c := range value {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
