package bee

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// A capability cooldown is the one piece of Bee's runtime state that must
// outlive the process. retryAt keeps Bee off a quota endpoint that has just
// refused it, and that endpoint rate-limits hard enough that spending a query
// on it needlessly can keep the refusal alive. Held only in memory, the
// backoff was defeated by exactly the action a person takes when they see an
// account reported as rate limited: restarting the agent. Every restart spent
// a fresh query on an endpoint that had asked to be left alone.
//
// This is a cache, not configuration: it lives beside the device file rather
// than inside it, so losing it costs one early query and nothing else, and so
// an older agent reading a directory a newer one wrote is unaffected. Both
// operations are best effort for the same reason — a cooldown that cannot be
// stored is a missed optimisation, never a failure to report.
type cooldownStore struct{ path string }

// entry records which account a cooldown belongs to. An account change already
// clears the in-memory backoff, and a stored one must not outlive its account
// either.
type entry struct {
	Fingerprint string    `json:"fingerprint"`
	RetryAt     time.Time `json:"retry_at"`
}

func (s cooldownStore) read() map[string]entry {
	stored := map[string]entry{}
	if s.path == "" {
		return stored
	}
	raw, err := os.ReadFile(s.path)
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, &stored) != nil {
		return map[string]entry{}
	}
	return stored
}

// load returns a stored cooldown for this account, or the zero time.
//
// The ceiling is beewire's: it rejects a rate_limited report reaching further
// than an hour ahead, so a file carrying a further time — a clock that moved,
// or a hand-edited value — would otherwise park the account behind reports
// Hive discards. Clamping keeps a bad file merely unhelpful.
func (s cooldownStore) load(platform, fingerprint string, now time.Time) time.Time {
	stored, ok := s.read()[platform]
	if !ok || stored.Fingerprint != fingerprint || !stored.RetryAt.After(now) {
		return time.Time{}
	}
	if ceiling := now.Add(time.Hour); stored.RetryAt.After(ceiling) {
		return ceiling
	}
	return stored.RetryAt
}

// save records a cooldown, or forgets one when at is zero.
func (s cooldownStore) save(platform, fingerprint string, at time.Time) {
	if s.path == "" {
		return
	}
	stored := s.read()
	if at.IsZero() {
		if _, ok := stored[platform]; !ok {
			return
		}
		delete(stored, platform)
	} else {
		stored[platform] = entry{Fingerprint: fingerprint, RetryAt: at}
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return
	}
	file, err := os.CreateTemp(filepath.Dir(s.path), ".cooldown-*")
	if err != nil {
		return
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(raw)
	}
	if closeErr := file.Close(); err != nil || closeErr != nil {
		return
	}
	_ = os.Rename(file.Name(), s.path)
}
