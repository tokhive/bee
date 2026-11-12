package beewire

// ValidModelIDs checks a bounded, distinct model selection or discovery list.
// An empty list is valid; each source decides whether it offers anything.
func ValidModelIDs(models []string) bool {
	if len(models) > 512 {
		return false
	}
	seen := make(map[string]bool, len(models))
	for _, model := range models {
		if !capabilityModelID.MatchString(model) || seen[model] {
			return false
		}
		seen[model] = true
	}
	return true
}
