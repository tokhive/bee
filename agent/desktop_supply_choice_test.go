package bee

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func reopenDesktopAutoService(t *testing.T, f *desktopAutoMaintenanceFixture) {
	t.Helper()
	snapshot, err := f.runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: snapshot.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
	if stopped.Operation.State != "succeeded" || !stopped.StopReceipt.SessionClean {
		t.Fatalf("restart requires confirmed shutdown: %+v", stopped.StopReceipt)
	}
	f.runtime.Close()
	f.runtime = NewDesktopRuntime(context.Background(), f.accounts.device, f.accounts)
	t.Cleanup(f.runtime.Close)
	if err := f.runtime.ConfigureNetwork(context.Background(), f.network); err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func waitDesktopChoiceDispatch(t *testing.T, f *desktopAutoMaintenanceFixture, count int) {
	t.Helper()
	for range count {
		select {
		case err := <-f.dispatchResults:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(4 * time.Second):
			t.Fatal("new authorization was not published with forwarding ready")
		}
	}
}

func TestDesktopSupplyChoiceReopenUsesCurrentHiveChoiceWithoutWrites(t *testing.T) {
	for _, openaiPaused := range []bool{false, true} {
		for _, claudePaused := range []bool{false, true} {
			t.Run(fmt.Sprintf("openai_%t_claude_%t", openaiPaused, claudePaused), func(t *testing.T) {
				f := newDesktopAutoMaintenanceFixture(t)
				f.selectAccount("openai")
				waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "running" && s.Platforms["openai"].Supply != nil
				})
				f.selectAccount("claude")
				waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["claude"].Supply != nil })
				// An explicit local resume gives the saved local permission the
				// opposite value from Hive's later owner-level platform choice.
				if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err != nil {
					t.Fatal(err)
				}
				f.mu.Lock()
				f.paused["openai"] = openaiPaused
				f.paused["claude"] = claudePaused
				f.dispatchOnUpload = true
				f.mu.Unlock()
				before := f.supplyWrites.Load()
				reopenDesktopAutoService(t, f)
				restored := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
					return s.Local == "running" && s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
				})
				if restored.Platforms["openai"].Supply.Paused != openaiPaused || restored.Platforms["claude"].Supply.Paused != claudePaused || f.supplyWrites.Load() != before {
					t.Fatalf("reopen overwrote Hive choice: openai_paused=%t claude_paused=%t added_supply_writes=%d", restored.Platforms["openai"].Supply.Paused, restored.Platforms["claude"].Supply.Paused, f.supplyWrites.Load()-before)
				}
				waitDesktopChoiceDispatch(t, f, 2)
			})
		}
	}
}

func TestDesktopSupplyChoiceReconnectPreservesChoiceAndDispatchesOnNewLease(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	f.selectAccount("claude")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["claude"].Supply != nil })
	if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	peer, previousLease := f.peer, f.lease
	f.dispatchOnUpload = true
	f.mu.Unlock()
	before := f.supplyWrites.Load()
	peer.Close()
	reconnected := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return f.connections.Load() == 2 && s.Connection == "connected" && s.Platforms["openai"].Supply != nil && s.Platforms["claude"].Supply != nil
	})
	waitDesktopChoiceDispatch(t, f, 2)
	f.mu.Lock()
	currentLease := f.lease
	f.mu.Unlock()
	if currentLease == previousLease || reconnected.Platforms["openai"].Supply.Paused || !reconnected.Platforms["claude"].Supply.Paused || f.supplyWrites.Load() != before {
		t.Fatalf("reconnect changed choice or reused old lease: new_lease=%t openai_paused=%t claude_paused=%t added_writes=%d", currentLease != previousLease, reconnected.Platforms["openai"].Supply.Paused, reconnected.Platforms["claude"].Supply.Paused, f.supplyWrites.Load()-before)
	}
}

func TestDesktopSupplyChoiceSameIdentityRefreshDoesNotChangeChoice(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			selected := f.selectAccount(platform)
			waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms[platform].Supply != nil })
			if _, err := f.accounts.device.SetPaused(context.Background(), platform, false); err != nil {
				t.Fatal(err)
			}
			before := f.supplyWrites.Load()
			f.mu.Lock()
			f.dispatchOnUpload = true
			f.mu.Unlock()
			source := selected.Candidate.Source
			if source == nil || source.Directory == nil {
				t.Fatal("selected source is absent from account candidate")
			}
			filename, refreshed := "auth.json", desktopCodexFixture(t, time.Now().Add(2*time.Hour))
			if platform == "claude" {
				filename = ".credentials.json"
				refreshed = bytes.ReplaceAll(claudeSample(time.Now().Add(2*time.Hour)), []byte("synthetic-claude-access"), []byte("synthetic-claude-refreshed-access"))
			}
			if err := os.WriteFile(filepath.Join(*source.Directory, filename), refreshed, 0600); err != nil {
				t.Fatal(err)
			}
			waitDesktopChoiceDispatch(t, f, 1)
			supply, err := f.accounts.device.SupplyStatus(context.Background(), platform)
			if err != nil || supply.Paused || f.supplyWrites.Load() != before {
				t.Fatalf("silent same-account refresh changed choice: paused=%t added_writes=%d error=%v", supply.Paused, f.supplyWrites.Load()-before, err)
			}
		})
	}
}

func TestDesktopSupplyChoiceDifferentIdentityWaitsForConfirmation(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	selected := f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	f.mu.Lock()
	beforeUploads := f.uploads["openai"]
	f.mu.Unlock()
	beforeWrites := f.supplyWrites.Load()
	if selected.Candidate.Source == nil || selected.Candidate.Source.Directory == nil {
		t.Fatal("selected source is absent from account candidate")
	}
	if err := os.WriteFile(filepath.Join(*selected.Candidate.Source.Directory, "auth.json"), desktopOtherCodexFixture(t), 0600); err != nil {
		t.Fatal(err)
	}
	changed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Platforms["openai"].Account.Hive.State == "confirmation_required"
	})
	f.mu.Lock()
	afterUploads := f.uploads["openai"]
	f.mu.Unlock()
	if changed.Platforms["openai"].Account.Selection.Fingerprint == nil || selected.Selection.Fingerprint == nil || *changed.Platforms["openai"].Account.Selection.Fingerprint != *selected.Selection.Fingerprint || afterUploads != beforeUploads || f.supplyWrites.Load() != beforeWrites {
		t.Fatalf("new identity was accepted without confirmation: added_uploads=%d added_writes=%d", afterUploads-beforeUploads, f.supplyWrites.Load()-beforeWrites)
	}
}

func TestDesktopSupplyChoiceLatestPauseWinsDuringRecovery(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	if _, err := f.accounts.device.SetPaused(context.Background(), "openai", false); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var block atomic.Bool
	block.Store(true)
	f.mu.Lock()
	f.beforeRequest = func(_ http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path == "/api/bee/maintenance" && block.CompareAndSwap(true, false) {
			close(entered)
			select {
			case <-release:
			case <-q.Context().Done():
			}
		}
		return false
	}
	f.mu.Unlock()
	reopenDesktopAutoService(t, f)
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("recovery did not reach authorization maintenance")
	}
	_, pauseErr := f.accounts.device.SetPaused(context.Background(), "openai", true)
	close(release)
	if pauseErr != nil {
		t.Fatal(pauseErr)
	}
	afterPauseWrites := f.supplyWrites.Load()
	ready := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	if !ready.Platforms["openai"].Supply.Paused || f.supplyWrites.Load() != afterPauseWrites {
		t.Fatalf("old recovery overwrote latest pause: paused=%t added_writes=%d", ready.Platforms["openai"].Supply.Paused, f.supplyWrites.Load()-afterPauseWrites)
	}
}
