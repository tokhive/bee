package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func newDesktopTestDevice(t *testing.T, path string) *DesktopDevice {
	t.Helper()
	d := &DesktopDevice{path: path}
	t.Cleanup(func() { closeDesktopTestDevice(t, d) })
	return d
}

func closeDesktopTestDevice(t *testing.T, d *DesktopDevice) {
	t.Helper()
	closer, ok := any(d).(interface{ Close() error })
	if !ok {
		t.Fatal("desktop device has no lifetime ownership release")
	}
	if err := closer.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopSessionOwnsLockUntilClose(t *testing.T) {
	d := &DesktopDevice{path: filepath.Join(t.TempDir(), "desktop.json")}
	if _, err := d.Status(context.Background()); err != nil {
		t.Fatal(err)
	}
	if unlock, err := lockState(d.path); err == nil {
		unlock()
		t.Fatal("desktop released its ownership lock between business operations")
	}
	if _, err := d.Status(context.Background()); err != nil {
		t.Fatalf("own read reacquired and conflicted with lifetime lock: %v", err)
	}
	closeDesktopTestDevice(t, d)
	unlock, err := lockState(d.path)
	if err != nil {
		t.Fatalf("closed management session retained ownership: %v", err)
	}
	unlock()
	if _, err := d.Status(context.Background()); err == nil {
		t.Fatal("closed session reopened its configuration")
	}
}

func TestDesktopSessionNetworkDoesNotBlockOtherPlatform(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	var calls atomic.Int32
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" && calls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-r.Context().Done():
			}
		}
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"platform": "claude", "paused": true, "ready": false, "reasons": []string{"manually_paused"}})
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := d.SupplyStatus(ctx, "openai"); done <- err }()
	<-entered
	short, end := context.WithTimeout(ctx, time.Second)
	defer end()
	if _, err := d.SupplyStatus(short, "claude"); err != nil {
		t.Errorf("slow OpenAI observation blocked independent Claude query: %v", err)
	}
	cancel()
	<-done
	closeDesktopTestDevice(t, d)
}

func TestDesktopSessionCloseWaitsForInFlightRead(t *testing.T) {
	entered := make(chan struct{})
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done() })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requestDone := make(chan struct{})
	go func() { defer close(requestDone); _, _ = d.SupplyStatus(ctx, "openai") }()
	<-entered
	closed := make(chan struct{})
	go func() { _ = d.Close(); close(closed) }()
	deadline := time.Now().Add(time.Second)
	for {
		d.session.mu.Lock()
		closing := d.session.closed
		d.session.mu.Unlock()
		if closing {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("close did not reject new operations")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := d.SupplyStatus(ctx, "claude"); err == nil {
		t.Fatal("closing session accepted a new operation")
	}
	select {
	case <-closed:
		t.Fatal("close returned before in-flight work exited")
	default:
	}
	if unlock, err := lockState(d.path); err == nil {
		unlock()
		t.Fatal("ownership released while in-flight work remained")
	}
	cancel()
	<-requestDone
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close did not finish after cancellation")
	}
	unlock, err := lockState(d.path)
	if err != nil {
		t.Fatalf("ownership retained after close: %v", err)
	}
	unlock()
}
