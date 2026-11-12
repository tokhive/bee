package bee

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopFirstLaunchContinuesOriginalSaveWithoutReplayingPairing(t *testing.T) {
	for _, fault := range []string{"configuration", "completion_receipt"} {
		for _, restart := range []bool{false, true} {
			session := "same_session"
			if restart {
				session = "restart"
			}
			t.Run(fault+"/"+session, func(t *testing.T) {
				h, d, path := newRecoveryHive(t)
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				h.code = "invalid_device_credential"
				ctx := context.Background()
				pending, err := d.Begin(ctx, h.origin, "Mac")
				if err != nil || pending.State != "pending" || pending.Recovery == nil {
					t.Fatalf("begin initial pairing: view=%+v error=%v", pending, err)
				}
				before, err := d.Context(ctx)
				if err != nil || before.DeviceID != nil || before.OwnerID != nil {
					t.Fatalf("pending pairing appeared locally bound: context=%+v error=%v", before, err)
				}
				target, failure := path, "save Bee configuration"
				if fault == "completion_receipt" {
					target = filepath.Join(filepath.Dir(path), "bee-desktop-recovery.json")
					failure = "persist recovery phase=completed"
				}
				h.approved = true
				var restore func()
				h.hook = func(request string) {
					if request == "GET /api/bee/identity" && h.bound && restore == nil {
						restore = blockFirstLaunchFile(t, target)
					}
				}
				failed, err := d.Status(ctx)
				if err == nil || restore == nil || failed.State == "bound" || !strings.Contains(err.Error(), failure) || !strings.Contains(err.Error(), target) {
					t.Fatalf("missing actual %s failure evidence: view=%+v error=%v", fault, failed, err)
				}
				restore()
				h.hook = nil
				local, err := d.Context(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if fault == "configuration" {
					if local.DeviceID != nil || local.OwnerID != nil {
						t.Fatalf("failed configuration save appeared bound: context=%+v", local)
					}
				} else if local.DeviceID == nil || *local.DeviceID != "new-device" || local.OwnerID == nil || *local.OwnerID != "owner" || local.BindingRevision <= before.BindingRevision {
					t.Fatalf("committed binding lost after completion receipt failure: before=%+v after=%+v", before, local)
				}
				if restart {
					closeDesktopTestDevice(t, d)
					d = newDesktopTestDevice(t, path)
				}
				completed, err := d.Status(ctx)
				if err != nil || completed.State != "bound" || completed.Identity == nil || completed.Identity.ID != "new-device" || completed.Identity.OwnerID != "owner" || completed.Hive != h.origin || completed.Recovery == nil || completed.Recovery.Phase != "completed" || completed.Recovery.OperationID != pending.Recovery.OperationID {
					t.Fatalf("original initial save did not complete: view=%+v error=%v", completed, err)
				}
				// A duplicate continue and a subsequent process start must both
				// retain the original operation and its saved device scope.
				if _, err := d.Begin(ctx, h.origin, "Mac"); err != nil {
					t.Fatal(err)
				}
				closeDesktopTestDevice(t, d)
				d = newDesktopTestDevice(t, path)
				again, err := d.Status(ctx)
				if err != nil || again.State != "bound" || again.Recovery == nil || again.Recovery.OperationID != pending.Recovery.OperationID {
					t.Fatalf("completed initial pairing did not survive restart: view=%+v error=%v", again, err)
				}
				local, err = d.Context(ctx)
				if err != nil || local.Hive != h.origin || local.DeviceID == nil || *local.DeviceID != "new-device" || local.OwnerID == nil || *local.OwnerID != "owner" {
					t.Fatalf("completion and saved context disagree: context=%+v error=%v", local, err)
				}
				if h.creates != 1 || h.redeems != 1 {
					t.Fatalf("initial pairing replayed during %s continuation: create=%d redeem=%d required=1,1", fault, h.creates, h.redeems)
				}
			})
		}
	}
}

func TestDesktopFirstLaunchRejectsChangedIdentityAfterSaveFailure(t *testing.T) {
	h, d, path := newRecoveryHive(t)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	h.code = "invalid_device_credential"
	ctx := context.Background()
	pending, err := d.Begin(ctx, h.origin, "Mac")
	if err != nil || pending.State != "pending" {
		t.Fatalf("begin initial pairing: view=%+v error=%v", pending, err)
	}
	h.approved = true
	var restore func()
	h.hook = func(request string) {
		if request == "GET /api/bee/identity" && h.bound && restore == nil {
			restore = blockFirstLaunchFile(t, path)
		}
	}
	failed, err := d.Status(ctx)
	if err == nil || restore == nil || !strings.Contains(err.Error(), "save Bee configuration") {
		t.Fatalf("initial save did not fail at the configuration boundary: view=%+v error=%v", failed, err)
	}
	restore()
	h.hook = nil
	closeDesktopTestDevice(t, d)
	d = newDesktopTestDevice(t, path)

	// The original pairing verified owner before saving. A later response for
	// the same credential cannot silently replace that confirmed ownership.
	for _, changed := range []struct{ device, owner, evidence string }{
		{"new-device", "", "owner_id_match=false"},
		{"new-device", "different-owner", "owner_id_match=false"},
		{"different-device", "owner", "device_id_match=false"},
	} {
		h.deviceID, h.owner = changed.device, changed.owner
		v, err := d.Status(ctx)
		if err == nil || !strings.Contains(err.Error(), "identity changed") || !strings.Contains(err.Error(), changed.evidence) {
			t.Fatalf("changed identity adopted or lacks mismatch evidence: view=%+v error=%v", v, err)
		}
	}
	local, err := d.Context(ctx)
	if err != nil || local.DeviceID != nil || local.OwnerID != nil {
		t.Fatalf("changed identity reached local configuration: context=%+v error=%v", local, err)
	}
	if h.creates != 1 || h.redeems != 1 {
		t.Fatalf("initial pairing replayed after changed identity: create=%d redeem=%d required=1,1", h.creates, h.redeems)
	}
	h.deviceID, h.owner = "new-device", "owner"
	v, err := d.Status(ctx)
	if err != nil || v.State != "bound" || v.Identity == nil || v.Identity.OwnerID != "owner" {
		t.Fatalf("original verified identity did not remain resumable: view=%+v error=%v", v, err)
	}
	if h.creates != 1 || h.redeems != 1 {
		t.Fatalf("resume replayed the original pairing: create=%d redeem=%d required=1,1", h.creates, h.redeems)
	}
}

// The fault is a real refused filesystem replacement, inserted only after the
// save's identity request so it cannot fail an earlier pairing/configuration read.
func blockFirstLaunchFile(t *testing.T, path string) func() {
	t.Helper()
	backup := filepath.Join(filepath.Dir(path), filepath.Base(path)+".save-failure-backup")
	if err := os.Rename(path, backup); err != nil {
		t.Errorf("prepare save failure: %v", err)
		return nil
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Errorf("block save replacement: %v", err)
		if err := os.Rename(backup, path); err != nil {
			t.Errorf("restore after fault setup failed: %v", err)
		}
		return nil
	}
	return func() {
		t.Helper()
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(backup, path); err != nil {
			t.Fatal(err)
		}
	}
}
