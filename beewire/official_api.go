package beewire

// OfficialAPIKey identifies a Provider's official Platform key, independent of
// their subscription: an OpenAI Platform key or a Claude Platform key. Only
// the TEE envelope contains the key itself.
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

// OpenAIAPIKey and OpenAIAPIStatus are the names the OpenAI source was first
// introduced under.
type (
	OpenAIAPIKey    = OfficialAPIKey
	OpenAIAPIStatus = OfficialAPIStatus
)
