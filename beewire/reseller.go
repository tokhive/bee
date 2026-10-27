package beewire

import (
	"encoding/hex"
	"regexp"
	"strings"
	"time"
)

// An API reseller (Hive ADR 0030) is a third-party endpoint, such as wokey,
// that the market falls back to when no subscription account can serve a
// request. Its key is a static bearer token: the Bee seals it for the TEE like
// any credential and registers it with the key's fingerprint, never the key.

var resellerID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// ResellerKey names the reseller key a credential registration carries.
type ResellerKey struct {
	Reseller string `json:"reseller"`
	// KeyFingerprint is the lowercase hex SHA-256 of the key.
	KeyFingerprint string `json:"key_fingerprint"`
}

func (k ResellerKey) Valid() bool {
	return resellerID.MatchString(k.Reseller) && validFingerprint(k.KeyFingerprint)
}

// The states of a reseller key, as the Bee last saw it.
const (
	ResellerReady               = "ready"
	ResellerInvalidKey          = "invalid_key"
	ResellerInsufficientBalance = "insufficient_balance"
)

// ResellerStatus is what a Bee reports about the key it registered: whether
// the reseller accepts it, the models it lists, and the balance left.
type ResellerStatus struct {
	KeyFingerprint string   `json:"key_fingerprint"`
	State          string   `json:"state"`
	Models         []string `json:"models"`
	// AvailableUSD is the balance the reseller reports, as a decimal string;
	// empty when it was not read.
	AvailableUSD string `json:"available_usd,omitempty"`
}

var usdBalance = regexp.MustCompile(`^(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?$`)

func (s ResellerStatus) Valid() bool {
	if !validFingerprint(s.KeyFingerprint) || len(s.Models) > 512 {
		return false
	}
	switch s.State {
	case ResellerReady, ResellerInvalidKey, ResellerInsufficientBalance:
	default:
		return false
	}
	if s.AvailableUSD != "" && !usdBalance.MatchString(s.AvailableUSD) {
		return false
	}
	seen := make(map[string]bool, len(s.Models))
	for _, model := range s.Models {
		if !capabilityModelID.MatchString(model) || seen[model] {
			return false
		}
		seen[model] = true
	}
	return true
}

func validFingerprint(value string) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == 32 && value == strings.ToLower(value)
}

// ResellerCharge is one request as the reseller billed it: its own request
// ID, which the reseller also returns on the response, and what it charged.
type ResellerCharge struct {
	RequestID string    `json:"request_id"`
	Model     string    `json:"model"`
	Status    string    `json:"status"`
	AmountUSD string    `json:"amount_usd"`
	ChargedAt time.Time `json:"charged_at"`
}

// ResellerCharges is a batch of charges a platform Bee read from the
// reseller's billing records with the registered key, for Hive to reconcile
// against what it settled.
type ResellerCharges struct {
	KeyFingerprint string           `json:"key_fingerprint"`
	Charges        []ResellerCharge `json:"charges"`
}

var resellerRequestID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// MaxResellerCharges bounds one report.
const MaxResellerCharges = 100

func (c ResellerCharges) Valid() bool {
	if !validFingerprint(c.KeyFingerprint) || len(c.Charges) == 0 || len(c.Charges) > MaxResellerCharges {
		return false
	}
	seen := make(map[string]bool, len(c.Charges))
	for _, charge := range c.Charges {
		if !resellerRequestID.MatchString(charge.RequestID) || seen[charge.RequestID] || len(charge.Model) > 128 || len(charge.Status) > 32 ||
			!usdBalance.MatchString(charge.AmountUSD) || charge.ChargedAt.IsZero() {
			return false
		}
		seen[charge.RequestID] = true
	}
	return true
}
