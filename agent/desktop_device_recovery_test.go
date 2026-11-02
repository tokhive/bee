package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestDeviceRecoveryInitialUnknownCreateNeverReplays(t *testing.T) {
	creates := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			creates++
			w.Write([]byte(`{`))
			return
		}
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"code":"invalid_device_credential"}}`))
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	d := newDesktopTestDevice(t, path)
	for i := 0; i < 3; i++ {
		_, _ = d.Begin(context.Background(), server.URL, "Mac")
		closeDesktopTestDevice(t, d)
		d = newDesktopTestDevice(t, path)
	}
	if creates != 1 {
		t.Fatalf("unknown creation replayed: POST count=%d required=1", creates)
	}
}

func TestDeviceRecoveryInitialUnknownRedeemApprovedNeverReplays(t *testing.T) {
	redeems := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":{"code":"invalid_device_credential"}}`))
			return
		}
		if r.Method == "POST" {
			redeems++
			w.WriteHeader(503)
			w.Write([]byte(`{"error":{"code":"unavailable"}}`))
			return
		}
		json.NewEncoder(w).Encode(beewire.Pairing{Status: "approved"})
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	saveState(path, localState{Hive: server.URL, Name: "Mac", Credential: "bee_" + strings.Repeat("a", 43), Pairing: &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: server.URL + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "redeeming"}})
	d := newDesktopTestDevice(t, path)
	for i := 0; i < 3; i++ {
		_, _ = d.Status(context.Background())
		closeDesktopTestDevice(t, d)
		d = newDesktopTestDevice(t, path)
	}
	if redeems != 0 {
		t.Fatalf("legacy unknown exchange replayed: POST count=%d required=0", redeems)
	}
}

type recoveryHive struct {
	origin, oldCredential, newCredential                       string
	creates, redeems                                           int
	approved, bound, lostCreate, lostRedeem, draining, expired bool
	hideNewIdentity                                            bool
	owner                                                      string
	status                                                     int
	code                                                       string
	hook                                                       func(string)
}

func newRecoveryHive(t *testing.T) (*recoveryHive, *DesktopDevice, string) {
	t.Helper()
	h := &recoveryHive{oldCredential: "bee_" + strings.Repeat("o", 43), owner: "owner", status: 401, code: "device_replaced"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.hook != nil {
			h.hook(r.Method + " " + r.URL.Path)
		}
		reject := func(status int, code string) {
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code}})
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /api/bee/identity":
			if h.bound && !h.hideNewIdentity && r.Header.Get("Authorization") != "Bearer "+h.oldCredential {
				json.NewEncoder(w).Encode(beewire.Identity{ID: "new-device", Name: "Mac", OwnerID: h.owner, OwnerEmail: "new@example.test"})
				return
			}
			reject(h.status, h.code)
		case "POST /api/bee/pairings":
			h.creates++
			if h.lostCreate {
				w.Write([]byte(`{`))
				return
			}
			json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("t", 43), UserCode: "ABCD-EFGH", VerificationURI: h.origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"})
		case "GET /api/bee/pairings":
			if h.expired {
				reject(410, "pairing_expired")
				return
			}
			status := "pending"
			if h.approved {
				status = "approved"
			}
			json.NewEncoder(w).Encode(beewire.Pairing{Status: status})
		case "POST /api/bee/pairings/redeem":
			h.redeems++
			if h.draining {
				reject(409, "device_draining")
				return
			}
			h.bound = true
			if h.lostRedeem {
				w.Write([]byte(`{`))
				return
			}
			json.NewEncoder(w).Encode(beewire.Identity{ID: "new-device", Name: "Mac", OwnerID: h.owner, OwnerEmail: "new@example.test"})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(server.Close)
	h.origin = server.URL
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	if err := saveState(path, localState{Hive: h.origin, Name: "Mac", Credential: h.oldCredential, Identity: &beewire.Identity{ID: "old-device", Name: "Mac", OwnerID: "owner", OwnerEmail: "old@example.test"}}); err != nil {
		t.Fatal(err)
	}
	return h, newDesktopTestDevice(t, path), path
}
func TestDeviceRecoveryExplicitConfirmationAndOwnerAdoption(t *testing.T) {
	for _, owner := range []string{"owner", "different-owner"} {
		t.Run(owner, func(t *testing.T) {
			h, d, path := newRecoveryHive(t)
			h.owner = owner
			v, err := d.RecoveryPrepare(context.Background())
			if err != nil || v.Phase != "awaiting_confirmation" || h.creates != 0 {
				t.Fatalf("prepare %+v %v creates=%d", v, err, h.creates)
			}
			initial := v
			closeDesktopTestDevice(t, d)
			d = newDesktopTestDevice(t, path)
			v, err = d.RecoveryStatus(context.Background())
			if err != nil || v.Phase != "awaiting_confirmation" || h.creates != 0 {
				t.Fatalf("restart authorized a write %+v %v", v, err)
			}
			v, err = d.RecoveryConfirm(context.Background(), initial.OperationID, initial.Revision, "begin_pairing")
			if err != nil || v.Phase != "pending" {
				t.Fatalf("confirm %+v %v", v, err)
			}
			duplicate, err := d.RecoveryConfirm(context.Background(), initial.OperationID, initial.Revision, "begin_pairing")
			if err != nil || duplicate.Revision != v.Revision || h.creates != 1 {
				t.Fatalf("duplicate %+v %v creates=%d", duplicate, err, h.creates)
			}
			if _, err = d.RecoveryConfirm(context.Background(), initial.OperationID, initial.Revision, "adopt_owner"); err == nil {
				t.Fatal("accepted conflicting old confirmation")
			}
			h.approved = true
			h.lostRedeem = true
			v, err = d.RecoveryStatus(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if owner != "owner" {
				if v.Phase != "awaiting_owner_confirmation" {
					t.Fatalf("owner confirmation bypassed %+v", v)
				}
				saved, _ := readState(path)
				if saved.Identity.ID != "old-device" {
					t.Fatal("replaced old identity before consent")
				}
				closeDesktopTestDevice(t, d)
				d = newDesktopTestDevice(t, path)
				v, err = d.RecoveryStatus(context.Background())
				if err != nil || v.Phase != "awaiting_owner_confirmation" {
					t.Fatalf("restart adopted owner %+v %v", v, err)
				}
				v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "adopt_owner")
			}
			if err != nil || v.Phase != "completed" || h.creates != 1 || h.redeems != 1 {
				t.Fatalf("completion %+v %v creates=%d redeems=%d", v, err, h.creates, h.redeems)
			}
			saved, _ := readState(path)
			if saved.Identity.ID != "new-device" || saved.Credential == h.oldCredential {
				t.Fatal("new binding not saved")
			}
			raw, _ := json.Marshal(v)
			if strings.Contains(string(raw), "bee_") || strings.Contains(string(raw), "beep_") {
				t.Fatal("public recovery leaked credentials")
			}
			closeDesktopTestDevice(t, d)
			d = newDesktopTestDevice(t, path)
			v, err = d.RecoveryStatus(context.Background())
			if err != nil || v.Phase != "completed" || h.redeems != 1 {
				t.Fatalf("restart completion %+v %v", v, err)
			}
		})
	}
}
func TestDeviceRecoveryEligibilityFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		status  int
		code    string
		allowed bool
	}{{401, "device_replaced", true}, {401, "invalid_device_credential", true}, {401, "", false}, {401, "unknown", false}, {403, "device_replaced", false}, {503, "unavailable", false}} {
		t.Run(tc.code+string(rune(tc.status)), func(t *testing.T) {
			h, d, _ := newRecoveryHive(t)
			h.status, h.code = tc.status, tc.code
			v, err := d.RecoveryPrepare(context.Background())
			if (err == nil) != tc.allowed || h.creates != 0 {
				t.Fatalf("eligibility %+v %v allowed=%t creates=%d", v, err, tc.allowed, h.creates)
			}
		})
	}
}
func TestDeviceRecoveryUnknownCreationAndExpiryNeverRecreate(t *testing.T) {
	h, d, path := newRecoveryHive(t)
	h.lostCreate = true
	v, err := d.RecoveryPrepare(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
	if err != nil || v.Phase != "creation_unknown" {
		t.Fatalf("unknown %+v %v", v, err)
	}
	for i := 0; i < 3; i++ {
		closeDesktopTestDevice(t, d)
		d = newDesktopTestDevice(t, path)
		v, err = d.RecoveryStatus(context.Background())
		if err != nil || v.Phase != "creation_unknown" {
			t.Fatalf("unknown restart %+v %v", v, err)
		}
	}
	if _, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "renew_expired"); err == nil || h.creates != 1 {
		t.Fatal("unknown creation allowed renewal")
	}
}
func TestDeviceRecoveryDrainingAndAuthoritativeExpiry(t *testing.T) {
	h, d, _ := newRecoveryHive(t)
	v, _ := d.RecoveryPrepare(context.Background())
	v, err := d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
	if err != nil {
		t.Fatal(err)
	}
	h.approved = true
	h.draining = true
	v, err = d.RecoveryStatus(context.Background())
	if err != nil || v.Phase != "draining" || h.redeems != 1 {
		t.Fatalf("drain %+v %v", v, err)
	}
	h.expired = true
	v, err = d.RecoveryStatus(context.Background())
	if err != nil || v.Phase != "expired" {
		t.Fatalf("expire %+v %v", v, err)
	}
	h.expired = false
	v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "renew_expired")
	if err != nil || v.Phase != "pending" || h.creates != 2 {
		t.Fatalf("renew %+v %v creates=%d", v, err, h.creates)
	}
}

func TestDeviceRecoveryCoreAdmissionAndNewScopeIsolation(t *testing.T) {
	for _, scenario := range []string{"running", "worker", "worker_exit", "pending", "unclean", "network_race", "new_scope"} {
		t.Run(scenario, func(t *testing.T) {
			h, d, path := newRecoveryHive(t)
			a := NewDesktopAccounts(d)
			r := NewDesktopRuntime(context.Background(), d, a)
			t.Cleanup(func() { r.Close(); a.Close() })
			s, release, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			state, _ := s.read()
			switch scenario {
			case "running":
				r.snapshot.Local = "running"
			case "worker":
				a.activeActions["openai"] = true
			case "worker_exit":
				r.runCancel = func() {}
				r.runDone = make(chan struct{})
			case "pending":
				_, err = a.selectionScope(s, state, func(scope *desktopAccountScope) error {
					scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("a", 48), Kind: "select", Stage: "submitted", Source: DesktopAccountSource{Directory: accountString(t.TempDir()), Store: "file"}, CredentialRevision: strings.Repeat("b", 64), ToFingerprint: strings.Repeat("c", 64), StartedAt: time.Now().UTC()}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
			case "unclean":
				_, err = a.selectionScope(s, state, func(scope *desktopAccountScope) error {
					scope.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
			case "network_race", "new_scope":
				if err = r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: "http://127.0.0.1:7890"}); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "new_scope" || scenario == "network_race" {
				selection := desktopAccountSelection{Source: DesktopAccountSource{Directory: accountString(t.TempDir()), Store: "file"}, Fingerprint: strings.Repeat("c", 64), CredentialRevision: strings.Repeat("d", 64), Revision: 1}
				_, err = a.selectionScope(s, state, func(scope *desktopAccountScope) error {
					scope.Selections["openai"] = selection
					scope.RuntimeIntent.Running = true
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				a.platforms["openai"].selected = &selection
				a.platforms["openai"].source = &selection.Source
			}

			v, err := d.RecoveryPrepare(context.Background())
			if scenario != "new_scope" && scenario != "network_race" {
				if err == nil || h.creates != 0 {
					t.Fatalf("unsafe recovery admitted %+v %v", v, err)
				}
				if scenario == "pending" {
					scope, _ := a.selectionScope(s, state, nil)
					if len(scope.PendingOperations) != 1 {
						t.Fatal("erased old pending operation")
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = r.Start(context.Background(), DesktopStartRequest{ExpectedRevision: r.snapshot.Revision, ResumePlatforms: []string{}}); err == nil {
				t.Fatal("start bypassed durable recovery admission")
			}
			if err = r.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 2, ConnectProxy: "http://127.0.0.1:9999"}); err == nil {
				t.Fatal("network write bypassed recovery admission")
			}
			v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
			if err != nil {
				t.Fatal(err)
			}
			h.approved = true
			v, err = d.RecoveryStatus(context.Background())
			if err != nil || v.Phase != "completed" {
				t.Fatalf("completion %+v %v", v, err)
			}
			current, _ := readState(path)
			scope, err := a.selectionScope(s, current, nil)
			if err != nil || len(scope.Selections) != 0 || len(scope.PendingOperations) != 0 || scope.RuntimeIntent.Running {
				t.Fatalf("new scope inherited old intent %+v %v", scope, err)
			}
			oldDisk, e := readDesktopAccountState(filepath.Join(filepath.Dir(path), "ai-accounts.json"))
			if e != nil {
				t.Fatal(e)
			}
			oldScope := oldDisk.Scopes[desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)]
			if len(oldScope.Selections) != 1 || !oldScope.RuntimeIntent.Running {
				t.Fatal("erased original scope to make replacement succeed")
			}
			if a.platforms["openai"].selected != nil || a.platforms["openai"].source != nil {
				t.Fatal("new scope inherited old in-memory source")
			}
			network, _ := NewDesktopNetwork(a).Status(context.Background())
			if network.EffectiveProxy != "" || r.snapshot.Local != "stopped" || r.snapshot.RunID != nil {
				t.Fatalf("new device inherited runtime/proxy %+v %+v", network, r.snapshot)
			}
			r.mu.Lock()
			r.snapshot.Local = "running"
			r.mu.Unlock()
			v, err = d.RecoveryStatus(context.Background())
			if err != nil || v.Phase != "completed" {
				t.Fatalf("immutable completed status blocked by later runtime: %+v %v", v, err)
			}
			r.mu.Lock()
			r.snapshot.Local = "stopped"
			r.mu.Unlock()
		})
	}
}

func TestDeviceRecoveryCrashPointsPreserveRequestCounts(t *testing.T) {
	for _, point := range []string{"token_save", "config_save", "transaction_finish"} {
		t.Run(point, func(t *testing.T) {
			h, d, path := newRecoveryHive(t)
			ctx := context.Background()
			v, err := d.RecoveryPrepare(ctx)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(filepath.Dir(path), "bee-desktop-recovery.json")
			backup := target + ".crash-backup"
			blocked := false
			block := func() {
				if blocked {
					return
				}
				blocked = true
				if err := os.Rename(target, backup); err != nil {
					t.Error(err)
					return
				}
				if err := os.Mkdir(target, 0700); err != nil {
					t.Error(err)
				}
			}
			if point == "token_save" {
				h.hook = func(request string) {
					if request == "POST /api/bee/pairings" {
						block()
					}
				}
			}
			v, err = d.RecoveryConfirm(ctx, v.OperationID, v.Revision, "begin_pairing")
			if point != "token_save" {
				if err != nil {
					t.Fatal(err)
				}
				h.approved = true
				identityReads := 0
				h.hook = func(request string) {
					if request == "GET /api/bee/identity" {
						identityReads++
						if point == "config_save" || point == "transaction_finish" {
							if point == "config_save" {
								target = path
								backup = path + ".crash-backup"
							}
							block()
						}
					}
				}
				v, err = d.RecoveryStatus(ctx)
			}
			if err == nil || !blocked {
				t.Fatalf("fault was not injected: view=%+v error=%v", v, err)
			}
			if err := os.Remove(target); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(backup, target); err != nil {
				t.Fatal(err)
			}
			h.hook = nil
			closeDesktopTestDevice(t, d)
			d = newDesktopTestDevice(t, path)
			v, err = d.RecoveryStatus(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if point == "token_save" {
				if v.Phase != "creation_unknown" || h.creates != 1 || h.redeems != 0 {
					t.Fatalf("creation replay after token save failure: %+v creates=%d redeems=%d", v, h.creates, h.redeems)
				}
			} else if v.Phase != "completed" || h.creates != 1 || h.redeems != 1 {
				t.Fatalf("exchange replay/rollback after save failure: %+v creates=%d redeems=%d", v, h.creates, h.redeems)
			}
		})
	}
}
func TestDeviceRecoveryCorruptRecordAndBindingChangeFailClosed(t *testing.T) {
	for _, scenario := range []string{"null_attempt", "unknown_field", "duplicate", "binding_changed", "missing_binding", "occupied"} {
		t.Run(scenario, func(t *testing.T) {
			h, d, path := newRecoveryHive(t)
			v, err := d.RecoveryPrepare(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			record := filepath.Join(filepath.Dir(path), "bee-desktop-recovery.json")
			switch scenario {
			case "missing_binding":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if view, statusErr := d.Status(context.Background()); statusErr == nil {
					t.Fatalf("missing binding with existing recovery became %+v", view)
				}
			case "binding_changed":
				state, _ := readState(path)
				state.Identity.ID = "externally-changed"
				if err := saveState(path, state); err != nil {
					t.Fatal(err)
				}
			case "occupied":
				other := NewDesktopDevice()
				other.path = path
				defer other.Close()
				if _, err := other.RecoveryStatus(context.Background()); err == nil {
					t.Fatal("ignored process ownership lock")
				}
				return
			default:
				raw, err := os.ReadFile(record)
				if err != nil {
					t.Fatal(err)
				}
				switch scenario {
				case "null_attempt":
					raw = bytes.Replace(raw, []byte(`"create_attempted":false`), []byte(`"create_attempted":null`), 1)
				case "unknown_field":
					raw = bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1,"extra":true`), 1)
				case "duplicate":
					raw = bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1)
				}
				if err := os.WriteFile(record, raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			_, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
			if err == nil || h.creates != 0 {
				t.Fatalf("unsafe record/binding reached POST: err=%v creates=%d", err, h.creates)
			}
		})
	}
}

func TestDeviceRecoveryUnknownExchangeSurvivesApprovedExpiryAndRestart(t *testing.T) {
	h, d, path := newRecoveryHive(t)
	v, err := d.RecoveryPrepare(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
	if err != nil {
		t.Fatal(err)
	}
	h.approved = true
	h.lostRedeem = true
	h.hideNewIdentity = true
	v, err = d.RecoveryStatus(context.Background())
	if err != nil || v.Phase != "redemption_unknown" {
		t.Fatalf("unknown %+v %v", v, err)
	}
	for i := 0; i < 3; i++ {
		h.expired = i > 0
		closeDesktopTestDevice(t, d)
		d = newDesktopTestDevice(t, path)
		v, err = d.RecoveryStatus(context.Background())
		if err != nil || v.Phase != "redemption_unknown" || h.redeems != 1 {
			t.Fatalf("unknown POST replay/expiry reset %+v %v redeem=%d", v, err, h.redeems)
		}
		for attempt := 0; attempt < 20; attempt++ {
			v, err = d.RecoveryStatus(context.Background())
			if err != nil || v.Failure == nil || len(v.Failure.Message) > 2048 || h.redeems != 1 {
				t.Fatalf("repeated unknown observation grew/replayed: %+v %v", v, err)
			}
		}
	}
	if _, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "renew_expired"); err == nil {
		t.Fatal("unknown exchange allowed renewal")
	}
	h.hideNewIdentity = false
	v, err = d.RecoveryStatus(context.Background())
	if err != nil || v.Phase != "completed" || h.redeems != 1 {
		t.Fatalf("identity recovery %+v %v", v, err)
	}
}

func TestDeviceRecoveryRejectsAnAlreadyAdmittedSupplyWrite(t *testing.T) {
	h, d, _ := newRecoveryHive(t)
	entered, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	var once sync.Once
	h.hook = func(request string) {
		if request == "GET /api/bee/identity" {
			once.Do(func() { close(entered); <-release })
		}
	}
	done := make(chan error, 1)
	go func() { _, err := d.SetPaused(context.Background(), "openai", true); done <- err }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("supply writer never reached identity request")
	}
	_, err := d.RecoveryPrepare(context.Background())
	close(release)
	if err == nil || !strings.Contains(err.Error(), "in-flight device writes") || h.creates != 0 {
		t.Fatalf("replacement raced an admitted supply request: err=%v creates=%d", err, h.creates)
	}
	if err = <-done; err == nil {
		t.Fatal("revoked supply credential unexpectedly accepted")
	}
	if _, err = d.RecoveryPrepare(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDeviceRecoveryAccountWorkerAdmissionPreservesActualFailure(t *testing.T) {
	for _, caller := range []string{"select", "confirm", "reconcile_confirm", "snapshot"} {
		for _, reason := range []string{"recovery", "account_closed", "runtime_closed", "starting", "stopping"} {
			t.Run(caller+"/"+reason, func(t *testing.T) {
				h, d, _ := newRecoveryHive(t)
				if reason == "recovery" {
					if _, err := d.RecoveryPrepare(context.Background()); err != nil {
						t.Fatal(err)
					}
				}
				a := NewDesktopAccounts(d)
				runtime := NewDesktopRuntime(context.Background(), d, a)
				t.Cleanup(func() { runtime.Close(); a.Close() })
				switch reason {
				case "account_closed":
					a.closed = true
				case "runtime_closed":
					runtime.closed = true
				case "starting", "stopping":
					runtime.snapshot.Local = reason
				}
				p, release, err := a.acquire(context.Background(), "openai")
				if err != nil {
					t.Fatal(err)
				}
				source := DesktopAccountSource{Directory: accountString(t.TempDir()), Store: "file"}
				p.source = &source
				p.credentialRevision = strings.Repeat("c", 64)
				p.selected = &desktopAccountSelection{Source: source, Fingerprint: strings.Repeat("a", 64), Generation: 1}
				p.snapshot.Candidate.Fingerprint = accountString(strings.Repeat("b", 64))
				if caller == "reconcile_confirm" || caller == "snapshot" {
					p.pending = &desktopPendingOperation{ID: strings.Repeat("d", 48), Kind: "confirm_change", Stage: "intent", Source: source, ToFingerprint: strings.Repeat("b", 64), CredentialRevision: p.credentialRevision, StartedAt: time.Now().UTC()}
				}
				var view DesktopAccountSnapshot
				switch caller {
				case "select":
					view, err = a.beginSelection(p, DesktopAccountActionRequest{Platform: "openai", Action: "select"})
					release()
				case "confirm", "reconcile_confirm":
					view, err = a.beginAccountChange(p, DesktopAccountActionRequest{Platform: "openai", Action: "confirm_change"})
					release()
				case "snapshot":
					release()
					view, err = a.Snapshot(context.Background(), "openai", true)
				}
				var failure *DesktopAccountError
				if !errors.As(err, &failure) {
					t.Fatalf("admission failure missing: caller=%s reason=%s err=%v view=%+v", caller, reason, err, view)
				}
				code, check, observed := "closed", "account_service", "account service"
				switch reason {
				case "recovery":
					code, check, observed = "device_recovery_active", "device_recovery_admission", "phase=awaiting_confirmation"
				case "runtime_closed":
					check, observed = "runtime_ownership", "runtime owner"
				case "starting", "stopping":
					code, check, observed = "runtime_dependency", "runtime_state", "local="+reason
				}
				if failure.Code != code || failure.Check != check || !strings.Contains(failure.Message, observed) {
					t.Fatalf("actual admission reason lost: caller=%s reason=%s got=%+v required code=%s check=%s evidence=%s", caller, reason, failure, code, check, observed)
				}
				if p.working || len(a.activeActions) != 0 || len(a.accountWorkers) != 0 || view.Operation != nil || h.creates != 0 || h.redeems != 0 {
					t.Fatalf("rejected admission launched work: working=%t active=%d workers=%d operation=%+v creates=%d redeems=%d", p.working, len(a.activeActions), len(a.accountWorkers), view.Operation, h.creates, h.redeems)
				}
				if (caller == "reconcile_confirm" || caller == "snapshot") && p.pending == nil {
					t.Fatal("rejected admission erased pending operation")
				}
			})
		}
	}
}
