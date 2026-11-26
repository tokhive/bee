package beewire

import "time"

// OfficialAPIKey identifies a Provider's official Platform key, independent of
// their subscription: an OpenAI Platform key, a Claude Platform key or a
// Gemini API key from Google AI Studio. Only the TEE envelope contains the key
// itself.
type OfficialAPIKey struct {
	KeyFingerprint string `json:"key_fingerprint"`
}

func (k OfficialAPIKey) Valid() bool { return validFingerprint(k.KeyFingerprint) }

// OfficialAPIStatus renews a short source lease. Models are the intersection of
// the Provider's selection and the upstream listing, never an empty wildcard.
type OfficialAPIStatus struct {
	Lease          string   `json:"lease"`
	KeyFingerprint string   `json:"key_fingerprint"`
	Ready          bool     `json:"ready"`
	Models         []string `json:"models"`
}

func (s OfficialAPIStatus) Valid() bool {
	return s.Lease != "" && validFingerprint(s.KeyFingerprint) && ValidModelIDs(s.Models)
}

// OfficialAPISupply is Hive's answer to a Bee asking about its Provider's
// official key (GET /api/bee/openai-api/status, /api/bee/claude-api/status or
// /api/bee/gemini-api/status): which key Hive holds, whether it takes new
// work, and why not.
type OfficialAPISupply struct {
	// Platform is openai_api, claude_api or gemini_api.
	Platform string `json:"platform"`
	// KeyFingerprint is the key Hive last registered for the Provider, empty
	// when none is registered. A Bee holding another key has not registered
	// it yet.
	KeyFingerprint string `json:"key_fingerprint"`
	Ready          bool   `json:"ready"`
	// Reasons say why the key takes no new work: ReasonManuallyPaused,
	// ReasonBanned, ReasonRateLimited, ReasonOffline or one of the
	// ReasonAPIKey reasons.
	Reasons []string `json:"reasons"`
	// Models are the selected models the key's listing shows that Hive sells
	// and the upstream has not refused. UnsoldModels are listed models Hive
	// does not sell; DeniedModels are models the upstream refused the key.
	Models        []string `json:"models"`
	UnsoldModels  []string `json:"unsold_models"`
	DeniedModels  []string `json:"denied_models"`
	MaxConcurrent int      `json:"max_concurrent"`
	// BlockedUntil is when an upstream rate limit on the key ends.
	BlockedUntil *time.Time `json:"blocked_until,omitempty"`
}

// OpenAIAPIKey and OpenAIAPIStatus are the names the OpenAI source was first
// introduced under.
type (
	OpenAIAPIKey    = OfficialAPIKey
	OpenAIAPIStatus = OfficialAPIStatus
)
