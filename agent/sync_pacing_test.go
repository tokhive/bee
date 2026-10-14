package bee

import (
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func deadline(at time.Time) beewire.PlatformAccount {
	return beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 3, CredentialRevision: "rev", SourceValidUntil: at}
}

// The window Hive grants is what decides the cadence, and the reserve has to
// survive a run of failed attempts, so a settled cycle idles until the window
// is nearly spent and not a moment past it.
func TestSyncPacerIdlesWithinTheObservationWindow(t *testing.T) {
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	var pacer syncPacer
	if pacer.skip(now) {
		t.Fatal("skipped before any cycle succeeded")
	}
	account := deadline(now.Add(45 * time.Second))
	pacer.settled(account, now, time.Time{})
	if !pacer.skip(now.Add(20 * time.Second)) {
		t.Fatal("did not idle inside the window")
	}
	if pacer.skip(now.Add(26 * time.Second)) {
		t.Fatal("idled past the renewal margin")
	}
	got, known := pacer.expected()
	if !known || got.Generation != 3 || got.CredentialRevision != "rev" {
		t.Fatalf("settled cycle did not carry the account version forward: %+v %v", got, known)
	}
}

// Work of the platform's own — a capability report falling due — must not be
// slept through just because the observation is still fresh.
func TestSyncPacerWakesForItsOwnWork(t *testing.T) {
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	var pacer syncPacer
	pacer.settled(deadline(now.Add(45*time.Second)), now, now.Add(5*time.Second))
	if pacer.skip(now.Add(6 * time.Second)) {
		t.Fatal("idled past work that had fallen due")
	}
}

// Every state but a quiet one keeps the cadence that never needed a deadline:
// an unsettled pacer neither idles nor offers an account version to claim.
func TestSyncPacerUnsettledRestoresTheOldCadence(t *testing.T) {
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	var pacer syncPacer
	pacer.settled(deadline(now.Add(45*time.Second)), now, time.Time{})
	pacer.unsettled()
	if pacer.skip(now) {
		t.Fatal("unsettled pacer idled")
	}
	if _, known := pacer.expected(); known {
		t.Fatal("unsettled pacer offered a stale account version")
	}
}

// A Hive that predates the deadline on the wire reports the zero time. That
// is "unknown", not "no deadline", and reading it the other way would idle
// past a window the agent cannot see.
func TestSyncPacerWillNotIdleWithoutADeadline(t *testing.T) {
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	var pacer syncPacer
	pacer.settled(beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 1}, now, time.Time{})
	if pacer.skip(now) {
		t.Fatal("idled against a Hive that reported no deadline")
	}
	// The account version it did report is still worth claiming next cycle.
	if _, known := pacer.expected(); !known {
		t.Fatal("account version discarded with the missing deadline")
	}
}

// A deadline already inside the margin leaves nothing to idle through.
func TestSyncPacerDoesNotIdleOnAnExpiringWindow(t *testing.T) {
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	var pacer syncPacer
	pacer.settled(deadline(now.Add(5*time.Second)), now, time.Time{})
	if pacer.skip(now) {
		t.Fatal("idled with the window nearly spent")
	}
}
