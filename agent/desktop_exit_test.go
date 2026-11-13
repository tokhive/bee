package bee

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopExitRejectsLateStartAndRestore(t *testing.T) {
	for _, reason := range []string{"app_exit", "update"} {
		t.Run(reason, func(t *testing.T) {
			var externalWrites atomic.Int32
			d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				if desktopSupplyServeIdentity(w, q) {
					return
				}
				externalWrites.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
			})
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			before, _ := r.Snapshot(context.Background())
			if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: reason}); err != nil {
				t.Fatal(err)
			}
			stopped := waitRuntime(t, r, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
			for _, start := range []struct {
				name string
				call func() error
			}{
				{"start", func() error {
					_, err := r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: stopped.Revision, ResumePlatforms: []string{}})
					return err
				}},
				{"restore", func() error { _, err := r.Restore(context.Background()); return err }},
			} {
				if err := start.call(); err == nil || !strings.Contains(err.Error(), "shutdown") {
					t.Fatalf("late %s admitted after %s: error=%v; required=shutdown rejection", start.name, reason, err)
				}
			}
			after, _ := r.Snapshot(context.Background())
			if after.Revision != stopped.Revision || after.RunID != nil || externalWrites.Load() != 0 {
				t.Fatalf("exit admitted new work: before_revision=%d after_revision=%d run_present=%t external_writes=%d", stopped.Revision, after.Revision, after.RunID != nil, externalWrites.Load())
			}
		})
	}
}

func desktopExitWithLogin(t *testing.T) (*desktopAutoMaintenanceFixture, *DesktopAuthorizer, DesktopOperation) {
	t.Helper()
	f := newDesktopAutoMaintenanceFixture(t)
	f.accounts.goos = "linux"
	f.selectAccount("openai")
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	owner, started, _ := desktopLoginMaintenanceOwner(t, f, "openai", "succeeded")
	current, err := f.accounts.Snapshot(context.Background(), "openai", false)
	if err != nil || current.Candidate.Source == nil {
		t.Fatalf("login fixture source absent: candidate=%+v error=%v", current.Candidate, err)
	}
	login, err := owner.Start(context.Background(), DesktopAuthorizeRequest{Platform: "openai", Source: *current.Candidate.Source, ExpectedRevision: current.Revision})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(started); err == nil {
			break
		}
		if time.Now().After(deadline) {
			actual, statusErr := owner.Status(context.Background(), login.ID)
			t.Fatalf("owned login start marker absent after 5s: operation=%+v error=%v", actual, statusErr)
		}
		time.Sleep(time.Millisecond)
	}
	return f, owner, login
}

func TestDesktopExitJoinsOfficialLoginBeforeCleanReceipt(t *testing.T) {
	for _, reason := range []string{"user_stop", "app_exit", "update"} {
		t.Run(reason, func(t *testing.T) {
			f, owner, login := desktopExitWithLogin(t)
			before, _ := f.runtime.Snapshot(context.Background())
			if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: reason}); err != nil {
				t.Fatal(err)
			}
			stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
			actual, err := owner.Status(context.Background(), login.ID)
			if err != nil || actual.State != "cancelled" || !stopped.StopReceipt.WorkersStopped || !stopped.StopReceipt.SessionClean || stopped.Operation.State != "succeeded" {
				t.Fatalf("exit receipt preceded owned login cleanup: receipt=%+v login=%+v stop=%+v error=%v", stopped.StopReceipt, actual, stopped.Operation, err)
			}
		})
	}
}

func TestDesktopExitLoginJournalFailureStillDisconnectsWithoutCleanReceipt(t *testing.T) {
	f, owner, login := desktopExitWithLogin(t)
	journal := filepath.Join(filepath.Dir(f.accounts.device.path), "login-maintenance.json")
	saved := journal + ".saved"
	if err := os.Rename(journal, saved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(journal, 0700); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Remove(journal); err != nil {
			t.Error(err)
		}
		if err := os.Rename(saved, journal); err != nil {
			t.Error(err)
		}
	}()
	f.mu.Lock()
	peer := f.peer
	f.mu.Unlock()
	before, _ := f.runtime.Snapshot(context.Background())
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
	actual, err := owner.Status(context.Background(), login.ID)
	if err != nil || actual.State != "cancelled" || stopped.StopReceipt.WorkersStopped || stopped.StopReceipt.SessionClean || stopped.Operation.State != "failed" || stopped.Operation.Error == nil || !strings.Contains(stopped.Operation.Error.Error(), "login maintenance journal") {
		t.Fatalf("login journal failure certified clean exit: receipt=%+v login=%+v stop=%+v error=%v", stopped.StopReceipt, actual, stopped.Operation, err)
	}
	if stopped.Connection != "disconnected" {
		t.Fatalf("failed exit left connection=%s; required=disconnected", stopped.Connection)
	}
	select {
	case <-peer.Context.Done():
	case <-time.After(time.Second):
		t.Fatal("login journal failure left owned forwarding connection open after stop receipt")
	}
}

func TestDesktopExitCancelsForwardingBeforeWaitingForDeviceSession(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	before := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	f.mu.Lock()
	peer := f.peer
	f.mu.Unlock()
	session, release, err := f.accounts.device.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	session.mu.Lock()
	locked := true
	defer func() {
		if locked {
			session.mu.Unlock()
		}
	}()
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: before.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-peer.Context.Done():
	case <-time.After(time.Second):
		t.Fatal("stop waited for device session before cancelling owned forwarding connection")
	}
	session.mu.Unlock()
	locked = false
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
}
