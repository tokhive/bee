package bee

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

// Uses the real persistent pairing and runtime services. The only control file
// represents the human approval in the synthetic Hive, never a journal edit.
func NewDesktopNativePairingFixture(t *testing.T, control string) (*DesktopDevice, *DesktopAccounts, *DesktopRuntime, *DesktopNetwork) {
	t.Helper()
	h, d, _ := newRecoveryHive(t)
	a := NewDesktopAccounts(d)
	r := NewDesktopRuntime(context.Background(), d, a)
	t.Cleanup(a.Close)
	t.Cleanup(r.Close)
	v, err := d.RecoveryPrepare(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
	if err != nil || v.Phase != "pending" {
		t.Fatalf("pairing fixture: %+v %v", v, err)
	}
	h.hook = func(request string) {
		if request == "GET /api/bee/pairings" {
			_, err := os.Stat(control + ".approve")
			h.approved = err == nil
		}
	}
	return d, a, r, NewDesktopNetwork(a)
}

// NewDesktopNativeBridgeFixture exposes real services only to the external test
// process that runs the production management transport. Official identity and
// Hive are controlled; the runtime, persistence, relay and encryption are real.
func NewDesktopNativeBridgeFixture(t *testing.T, auditPath string) (*DesktopDevice, *DesktopAccounts, *DesktopRuntime, *DesktopNetwork) {
	t.Helper()
	f := newDesktopAutoMaintenanceFixture(t)
	f.detect("openai")
	f.detect("claude")
	f.mu.Lock()
	f.dispatchOnUpload = true
	f.mu.Unlock()
	t.Cleanup(func() {
		failures, probes := 0, 0
		for {
			select {
			case err := <-f.dispatchResults:
				probes++
				if err != nil {
					failures++
				}
			default:
				f.mu.Lock()
				audit := map[string]any{"connections": f.connections.Load(), "supply_writes": f.supplyWrites.Load(), "resume_writes": f.resumeWrites.Load(), "pause_writes": f.pauseWrites.Load(), "relay_probes": probes, "relay_failures": failures, "uploads": f.uploads, "paused": f.paused}
				raw, err := json.Marshal(audit)
				f.mu.Unlock()
				if err == nil {
					err = os.WriteFile(auditPath, raw, 0600)
				}
				if err != nil {
					t.Error(err)
				}
				return
			}
		}
	})
	// Snapshot through the transport must remain a read; candidates alone do not
	// select an account or create the contribution connection.
	if _, err := f.runtime.Snapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
	return f.accounts.device, f.accounts, f.runtime, NewDesktopNetwork(f.accounts)
}
