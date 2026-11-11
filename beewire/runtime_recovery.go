package beewire

// RuntimeEpochHeader fences requests from a retired Bee management process.
// It is not a credential. Hive still authenticates the device independently.
const RuntimeEpochHeader = "X-Bee-Runtime-Epoch"

type RuntimeRecoveryPreparation struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
}

type RuntimeRecoveryRequest struct {
	ID              string                                `json:"id"`
	PreviousEpoch   string                                `json:"previous_epoch"`
	PreviousRunID   string                                `json:"previous_run_id"`
	AccountRevision string                                `json:"account_revision"`
	Preparations    map[string]RuntimeRecoveryPreparation `json:"preparations"`
}

// Retired is a durable result: Hive has fenced the old epoch, joined its
// connection, checked unsettled work and retired the named preparation barriers.
// An absent result is authoritative only on Hive's primary database.
type RuntimeRecoveryResult struct {
	Version             int                     `json:"version"`
	DeviceID            string                  `json:"device_id"`
	OwnerID             string                  `json:"owner_id"`
	State               string                  `json:"state"`
	Request             *RuntimeRecoveryRequest `json:"request"`
	Epoch               string                  `json:"epoch"`
	ConnectionRetired   bool                    `json:"connection_retired"`
	PreparationsRetired bool                    `json:"preparations_retired"`
	Unfinished          bool                    `json:"unfinished"`
}
