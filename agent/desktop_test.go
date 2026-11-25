//go:build darwin || linux

package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// fakePairingHive answers the pairing calls. Polls return "pending" until
// approve is closed, then outcome.
type fakePairingHive struct {
	*httptest.Server
	approve   chan struct{}
	outcome   string
	expiresIn time.Duration
	// loseRedeem fails the redeem call although the pairing succeeded.
	loseRedeem bool
	redeemed   atomic.Bool
	hash       atomic.Value
}

func newFakePairingHive(t *testing.T) *fakePairingHive {
	h := &fakePairingHive{approve: make(chan struct{}), outcome: "approved", expiresIn: 10 * time.Minute}
	h.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /api/bee/pairings":
			var input beewire.StartPairing
			json.NewDecoder(r.Body).Decode(&input)
			h.hash.Store(input.CredentialHash)
			json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "pt", UserCode: "ABCD-EFGH", VerificationURI: h.URL + "/devices/pair", ExpiresAt: time.Now().Add(h.expiresIn), Status: "pending"})
		case "GET /api/bee/pairings":
			status := "pending"
			select {
			case <-h.approve:
				status = h.outcome
			default:
			}
			json.NewEncoder(w).Encode(beewire.Pairing{Status: status})
		case "POST /api/bee/pairings/redeem":
			h.redeemed.Store(true)
			if h.loseRedeem {
				http.Error(w, `{"error":{"code":"unavailable"}}`, http.StatusServiceUnavailable)
				return
			}
			json.NewEncoder(w).Encode(beewire.Identity{ID: "dev_new", Name: "laptop", OwnerID: "u1", OwnerEmail: "owner@example.com"})
		case "GET /api/bee/identity":
			if !h.redeemed.Load() {
				http.Error(w, `{"error":{"code":"invalid_device_credential"}}`, http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(beewire.Identity{ID: "dev_new", Name: "laptop", OwnerID: "u1", OwnerEmail: "owner@example.com"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(h.Close)
	return h
}

func newTestRunner(t *testing.T, config string) *desktopRunner {
	t.Helper()
	status := newRunStatus()
	runner := newDesktopRunner(config, &egressConfig{liveSources: true}, status, io.Discard)
	runner.pollInterval = 20 * time.Millisecond
	return runner
}

func waitPairing(t *testing.T, r *desktopRunner, want string) pairingStatus {
	t.Helper()
	var got pairingStatus
	waitUntil(t, "pairing "+want, func() bool { got = r.pairingStatus(); return got.Status == want })
	return got
}

func TestDesktopPairingSavesDeviceAndKeepsBackup(t *testing.T) {
	hive := newFakePairingHive(t)
	config := shortConfigPath(t)
	old := []byte(`{"hive":"https://old.example","name":"laptop","credential":"bee_old"}`)
	if err := os.WriteFile(config, old, 0o600); err != nil {
		t.Fatal(err)
	}
	r := newTestRunner(t, config)
	r.status.setDevice(localState{Hive: "https://old.example", Name: "laptop", Credential: "bee_old"}, bindingReplaced)

	started, err := r.startPairing(context.Background(), hive.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if started.Status != pairingPending || started.UserCode != "ABCD-EFGH" || started.VerificationURL != hive.URL+"/devices/pair?code=ABCD-EFGH" {
		t.Fatalf("started = %+v", started)
	}
	if _, binding := r.status.device(); binding != bindingReplaced {
		t.Fatal("the current device changed before the pairing was confirmed")
	}
	close(hive.approve)
	waitPairing(t, r, pairingCompleted)

	state, binding := r.status.device()
	if binding != bindingPaired || state.Identity == nil || state.Identity.ID != "dev_new" || state.Hive != hive.URL || state.Name != "laptop" {
		t.Fatalf("device = %+v %s", state, binding)
	}
	saved, err := readState(config)
	if err != nil || saved.Credential != state.Credential || saved.Identity == nil {
		t.Fatalf("saved = %+v, %v", saved, err)
	}
	backups, _ := filepath.Glob(filepath.Join(filepath.Dir(config), "bee.json.backup.*", "bee.json"))
	if len(backups) != 1 {
		t.Fatalf("backups = %v", backups)
	}
	if raw, _ := os.ReadFile(backups[0]); !bytes.Equal(raw, old) {
		t.Fatalf("backup = %s", raw)
	}
	select {
	case <-r.rebound:
	default:
		t.Fatal("the run was not told to switch to the new device")
	}
}

func TestDesktopPairingRecoversLostRedeemAnswer(t *testing.T) {
	hive := newFakePairingHive(t)
	hive.loseRedeem = true
	r := newTestRunner(t, shortConfigPath(t))
	if _, err := r.startPairing(context.Background(), hive.URL, "laptop"); err != nil {
		t.Fatal(err)
	}
	close(hive.approve)
	waitPairing(t, r, pairingCompleted)
	if _, binding := r.status.device(); binding != bindingPaired {
		t.Fatalf("binding = %s", binding)
	}
}

func TestDesktopPairingEnds(t *testing.T) {
	t.Run("expired", func(t *testing.T) {
		hive := newFakePairingHive(t)
		hive.expiresIn = 200 * time.Millisecond
		r := newTestRunner(t, shortConfigPath(t))
		if _, err := r.startPairing(context.Background(), hive.URL, ""); err != nil {
			t.Fatal(err)
		}
		waitPairing(t, r, pairingExpired)
	})
	t.Run("rejected", func(t *testing.T) {
		hive := newFakePairingHive(t)
		hive.outcome = "rejected"
		r := newTestRunner(t, shortConfigPath(t))
		if _, err := r.startPairing(context.Background(), hive.URL, ""); err != nil {
			t.Fatal(err)
		}
		close(hive.approve)
		if got := waitPairing(t, r, pairingFailed); got.Problem == nil || got.Problem.Code != "pairing_rejected" {
			t.Fatalf("problem = %+v", got.Problem)
		}
	})
	t.Run("cancelled", func(t *testing.T) {
		hive := newFakePairingHive(t)
		config := shortConfigPath(t)
		r := newTestRunner(t, config)
		if _, err := r.startPairing(context.Background(), hive.URL, ""); err != nil {
			t.Fatal(err)
		}
		r.cancelPairing()
		close(hive.approve)
		time.Sleep(100 * time.Millisecond)
		if got := r.pairingStatus(); got.Status != pairingCancelled {
			t.Fatalf("status = %+v", got)
		}
		if _, err := os.Stat(config); !os.IsNotExist(err) {
			t.Fatal("a cancelled pairing saved a device configuration")
		}
	})
	t.Run("replaced by a new attempt", func(t *testing.T) {
		hive := newFakePairingHive(t)
		r := newTestRunner(t, shortConfigPath(t))
		first, _ := r.startPairing(context.Background(), hive.URL, "")
		second, err := r.startPairing(context.Background(), hive.URL, "")
		if err != nil || first.Status != pairingPending || second.Status != pairingPending {
			t.Fatalf("first %+v second %+v %v", first, second, err)
		}
		close(hive.approve)
		waitPairing(t, r, pairingCompleted)
	})
	t.Run("invalid input", func(t *testing.T) {
		r := newTestRunner(t, shortConfigPath(t))
		if _, err := r.startPairing(context.Background(), "ftp://hive.example", ""); !errors.Is(err, errInvalidPairingInput) {
			t.Fatalf("hive: %v", err)
		}
		if _, err := r.startPairing(context.Background(), "https://hive.example", strings.Repeat("x", 81)); !errors.Is(err, errInvalidPairingInput) {
			t.Fatalf("name: %v", err)
		}
	})
}

// scriptedConnect stands in for the connection loop: each call takes the next
// result, or blocks until cancelled once the script runs out.
type scriptedConnect struct {
	mu      sync.Mutex
	results []error
	states  []localState
}

func (s *scriptedConnect) connect(ctx context.Context, state localState, _ *egressConfig, _ io.Writer) error {
	s.mu.Lock()
	s.states = append(s.states, state)
	if len(s.results) > 0 {
		err := s.results[0]
		s.results = s.results[1:]
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()
	<-ctx.Done()
	return nil
}

func (s *scriptedConnect) calls() []localState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]localState(nil), s.states...)
}

func paired(credential string) localState {
	return localState{Hive: "https://hive.example", Name: "laptop", Credential: credential, Identity: &beewire.Identity{ID: "dev_" + credential}}
}

func TestDesktopRunHandlesBindingChanges(t *testing.T) {
	cases := []struct {
		name   string
		result error
		want   string
	}{
		{"replaced", nil, bindingReplaced},
		{"credential rejected", &apiFailure{Status: 401, Code: "invalid_device_credential"}, bindingInvalid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := newTestRunner(t, shortConfigPath(t))
			script := &scriptedConnect{results: []error{c.result}}
			r.connect = script.connect
			r.status.setDevice(paired("a"), bindingPaired)
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error)
			go func() { done <- r.run(ctx) }()
			waitUntil(t, "binding "+c.want, func() bool { _, b := r.status.device(); return b == c.want })
			if r.status.currentConnection() != connectionDisconnected {
				t.Fatalf("connection = %s", r.status.currentConnection())
			}

			// Pairing again resumes with the new device.
			r.status.setDevice(paired("b"), bindingPaired)
			r.rebound <- struct{}{}
			waitUntil(t, "reconnect with the new device", func() bool { calls := script.calls(); return len(calls) == 2 && calls[1].Credential == "b" })
			cancel()
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDesktopRunSwitchesToNewPairingWhileConnected(t *testing.T) {
	r := newTestRunner(t, shortConfigPath(t))
	script := &scriptedConnect{}
	r.connect = script.connect
	r.status.setDevice(paired("a"), bindingPaired)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.run(ctx)
	waitUntil(t, "first connection", func() bool { return len(script.calls()) == 1 })

	// A stale signal naming the device in use does not drop the connection.
	r.rebound <- struct{}{}
	time.Sleep(50 * time.Millisecond)
	if len(script.calls()) != 1 {
		t.Fatal("a stale signal restarted the connection")
	}

	r.status.setDevice(paired("b"), bindingPaired)
	r.rebound <- struct{}{}
	waitUntil(t, "connection with the new device", func() bool { calls := script.calls(); return len(calls) == 2 && calls[1].Credential == "b" })
	if _, binding := r.status.device(); binding != bindingPaired {
		t.Fatalf("binding = %s", binding)
	}
}

func TestDesktopRunRetriesOtherFailures(t *testing.T) {
	r := newTestRunner(t, shortConfigPath(t))
	script := &scriptedConnect{results: []error{errInboxIdentity}}
	r.connect = script.connect
	r.status.setDevice(paired("a"), bindingPaired)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.run(ctx)
	waitUntil(t, "problem reported", func() bool { return r.status.currentProblem() != nil })
	waitUntil(t, "retried after a second", func() bool { return len(script.calls()) == 2 })
	if _, binding := r.status.device(); binding != bindingPaired {
		t.Fatalf("binding = %s", binding)
	}
}

// bee run --desktop starts with no device configuration and serves the
// control interface, where the desktop app can pair it.
func TestRunDesktopStartsUnpaired(t *testing.T) {
	hive := newFakePairingHive(t)
	config := shortConfigPath(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)
	go func() { done <- Run(ctx, []string{"run", "--desktop", "--config", config}, io.Discard) }()
	client := unixClient(controlSocketPath(config))
	var overview controlOverview
	waitUntil(t, "control interface", func() bool {
		res, err := client.Get("http://bee/v1/overview")
		if err != nil {
			return false
		}
		defer res.Body.Close()
		return json.NewDecoder(res.Body).Decode(&overview) == nil
	})
	if overview.Mode != "desktop" || overview.Binding != bindingUnpaired || overview.Device != nil || overview.Connection != connectionDisconnected {
		t.Fatalf("overview = %+v", overview)
	}
	var started pairingStatus
	body := `{"hive":"` + hive.URL + `","name":"laptop"}`
	if code := getJSON(t, client, "POST", "/v1/pairing", body, &started); code != 200 || started.Status != pairingPending {
		t.Fatalf("pairing: %d %+v", code, started)
	}
	var failure struct {
		Error struct{ Code string } `json:"error"`
	}
	if code := getJSON(t, client, "GET", "/v1/platforms/openai", "", &failure); code != 409 || failure.Error.Code != "not_paired" {
		t.Fatalf("platform before pairing: %d %+v", code, failure)
	}
	if code := getJSON(t, client, "DELETE", "/v1/pairing", "", &started); code != 200 || started.Status != pairingCancelled {
		t.Fatalf("cancel: %d %+v", code, started)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bee run --desktop did not stop")
	}
	if _, err := os.Stat(controlSocketPath(config)); !os.IsNotExist(err) {
		t.Fatal("control socket left behind")
	}
}

func TestControlPairingNeedsDesktopMode(t *testing.T) {
	client, _, _ := startControl(t, "https://hive.example", nil)
	var failure struct {
		Error struct{ Code string } `json:"error"`
	}
	for _, method := range []string{"GET", "POST", "DELETE"} {
		if code := getJSON(t, client, method, "/v1/pairing", "", &failure); code != 409 || failure.Error.Code != "pairing_unavailable" {
			t.Fatalf("%s: %d %+v", method, code, failure)
		}
	}
	var overview controlOverview
	getJSON(t, client, "GET", "/v1/overview", "", &overview)
	if overview.Mode != "cli" || overview.Binding != bindingPaired {
		t.Fatalf("overview = %+v", overview)
	}
}
