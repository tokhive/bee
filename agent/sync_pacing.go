package bee

import (
	"time"

	"github.com/tokhive/bee/beewire"
)

// renewalMargin is how much of the source observation window Bee keeps in
// reserve. Hive gives an observation 45 seconds, and losing the window stops
// dispatch and settlement for the account, so the reserve has to cover a run
// of failed attempts: at the two second loop below it is ten of them.
const renewalMargin = 20 * time.Second

// syncPacer decides when a platform's synchronization cycle has to talk to
// Hive again.
//
// The cycle renews the source observation, claims the account version it
// believes in, and collects any maintenance task — one call carrying one
// frequent need and three rare ones. Without knowing when the observation
// expires the only safe cadence is one short enough to be wrong about any
// deadline, and the two second loop was exactly that: a keychain read, two
// Hive requests and a write transaction every two seconds against a window
// that lasts forty five, for a provider whose account had not changed.
//
// So the pacer idles only through a cycle that finished with nothing
// outstanding, and only as far as the deadline Hive reported. Anything else —
// an error, a waiting state, a task, a Hive too old to report a deadline —
// leaves it unpaced, and that cycle behaves exactly as it did before.
type syncPacer struct {
	account   beewire.PlatformAccount
	known     bool
	idleUntil time.Time
}

// skip reports whether this cycle can be passed over without asking anything
// of Hive, the credential store, or the upstream.
func (p *syncPacer) skip(now time.Time) bool {
	return p.known && now.Before(p.idleUntil)
}

// expected returns the account version the next request should claim. When it
// reports false the caller must read the account from Hive first, which is
// what every unsettled cycle does.
func (p *syncPacer) expected() (beewire.PlatformAccount, bool) {
	return p.account, p.known
}

// unsettled restores the unpaced cadence. Called at the top of every cycle
// that runs, so only a cycle that reaches settled below can idle.
func (p *syncPacer) unsettled() {
	p.account, p.known, p.idleUntil = beewire.PlatformAccount{}, false, time.Time{}
}

// settled records a cycle that ended ready, with no task outstanding. work is
// when this platform next has something of its own to do, zero if nothing.
func (p *syncPacer) settled(account beewire.PlatformAccount, now, work time.Time) {
	p.account, p.known = account, true
	// A Hive that predates the deadline on the wire reports the zero time.
	// Reading that as "no deadline" would idle past the window; it means
	// "unknown", and unknown keeps the cadence that never needed to be told.
	if account.SourceValidUntil.IsZero() {
		p.idleUntil = time.Time{}
		return
	}
	until := account.SourceValidUntil.Add(-renewalMargin)
	if !work.IsZero() && work.Before(until) {
		until = work
	}
	if !until.After(now) {
		until = time.Time{}
	}
	p.idleUntil = until
}
