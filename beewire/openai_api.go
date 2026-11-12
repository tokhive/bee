package beewire

// OpenAIAPIKey identifies a Provider's official Platform key, independent of
// their ChatGPT subscription. Only the TEE envelope contains the key itself.
type OpenAIAPIKey struct {
	KeyFingerprint string `json:"key_fingerprint"`
}

func (k OpenAIAPIKey) Valid() bool { return validFingerprint(k.KeyFingerprint) }

// OpenAIAPIStatus renews a short source lease. Models are the intersection of
// the Provider's selection and the upstream listing, never an empty wildcard.
type OpenAIAPIStatus struct {
	Lease          string   `json:"lease"`
	KeyFingerprint string   `json:"key_fingerprint"`
	Ready          bool     `json:"ready"`
	Models         []string `json:"models"`
}

func (s OpenAIAPIStatus) Valid() bool {
	return s.Lease != "" && validFingerprint(s.KeyFingerprint) && ValidModelIDs(s.Models)
}
