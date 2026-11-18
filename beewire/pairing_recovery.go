package beewire

import "time"

const PairingRecoveryPath = "/api/bee/pairings/attempts/"
const PairingRecoveryCapabilitiesPath = "/api/bee/pairings/capabilities"
const PairingLegacyPath = "/api/bee/pairings/legacy"

// PairingAttempt is persisted by Bee before the first request. Secrets are sent
// only over the configured Hive transport; Hive stores their digests.
type PairingAttempt struct {
	Name             string `json:"name"`
	PairingToken     string `json:"pairing_token"`
	UserCode         string `json:"user_code"`
	ExpectedDeviceID string `json:"expected_device_id"`
	ExpectedOwnerID  string `json:"expected_owner_id"`
	Recovery         bool   `json:"recovery"`
}
type PairingBlocker struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Reason string `json:"reason"`
	Manual bool   `json:"manual"`
}
type PairingRecoveryStatus struct {
	Version          int              `json:"version"`
	AttemptID        string           `json:"attempt_id"`
	State            string           `json:"state"`
	Pairing          *Pairing         `json:"pairing"`
	Identity         *Identity        `json:"identity"`
	ReplacedDeviceID string           `json:"replaced_device_id"`
	Blockers         []PairingBlocker `json:"blockers"`
	ObservedAt       time.Time        `json:"observed_at"`
}
