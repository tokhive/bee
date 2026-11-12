package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/beewire"
)

func TestDesktopSwitchActivationVerifiesDeviceWithoutAccounts(t *testing.T) {
	for _, scenario := range []string{"no_accounts", "unavailable_account_source"} {
		t.Run(scenario, func(t *testing.T) {
			testDesktopSwitchActivationVerifiesDevice(t, scenario == "unavailable_account_source")
		})
	}
}

func testDesktopSwitchActivationVerifiesDevice(t *testing.T, unavailableAccount bool) {
	var writes, connects, releases atomic.Int32
	operation := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: "desktop-device", OwnerID: "owner-1", ExpectedEpoch: "", ExpectedLease: ""}
	seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48)}
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if q.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			w.Write([]byte(`{"version":1,"device_drain":1}`))
			return
		}
		if q.URL.Path == beewire.DeviceDrainOperationsPath+operation.ID+"/release" {
			var action beewire.DeviceDrainReleaseRequest
			if err := json.NewDecoder(q.Body).Decode(&action); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			status := switchSealedStatus(operation, seal)
			status.State = "released"
			status.Release = &action
			status.Current.BarrierID = ""
			status.Current.Lease = "switch-device-lease"
			releases.Add(1)
			json.NewEncoder(w).Encode(status)
			return
		}
		if q.URL.Path == beewire.DeviceDrainOperationsPath+operation.ID {
			json.NewEncoder(w).Encode(switchSealedStatus(operation, seal))
			return
		}
		if q.URL.Path != "/api/bee/connect" {
			writes.Add(1)
			w.WriteHeader(500)
			return
		}
		if q.Header.Get(beewire.RuntimeEpochHeader) != seal.ID {
			t.Errorf("wrong epoch %q", q.Header.Get(beewire.RuntimeEpochHeader))
			w.WriteHeader(409)
			return
		}
		w.Header().Set("X-Bee-Lease", "switch-device-lease")
		c, err := websocket.Accept(w, q, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		connects.Add(1)
		<-c.CloseRead(q.Context()).Done()
	})
	d.profileMode = DesktopProfileActivate
	a := NewDesktopAccounts(d)
	defer a.Close()
	if unavailableAccount {
		desktopRuntimeSelectionFixture(t, d, a)
		session, end, err := d.acquireSession(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		state, err := session.read()
		if err != nil {
			end()
			t.Fatal(err)
		}
		scope, err := a.selectionScope(session, state, nil)
		end()
		if err != nil {
			t.Fatal(err)
		}
		if err = os.Remove(filepath.Join(*scope.Selections["openai"].Source.Directory, "auth.json")); err != nil {
			t.Fatal(err)
		}
	}
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	operation.Origin = c.Hive
	operation.DeviceID = *c.DeviceID
	operation.OwnerID = *c.OwnerID
	seal.Request = operation
	request := DesktopSwitchRequest{Action: "drain_status", BindingRevision: c.BindingRevision, Operation: &operation}
	if _, err := r.SwitchControl(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	request.Action = "connect"
	view, err := r.SwitchControl(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if view.Connection != "connected" || view.Lease != "switch-device-lease" || view.MaintenanceAllowed || writes.Load() != 0 || connects.Load() != 1 {
		t.Fatalf("device verification started maintenance or lost lease: %+v writes=%d connects=%d", view, writes.Load(), connects.Load())
	}
	if _, err := r.Restore(context.Background()); err == nil {
		t.Fatal("activation restored accounts before commit and release")
	}
	release := beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("3", 48), Request: operation, Mode: "activate", ExpectedEpoch: seal.ID, ExpectedLease: view.Lease}
	request.Action = "drain_release"
	request.Release = &release
	if _, err := r.SwitchControl(context.Background(), request); err == nil || releases.Load() != 0 {
		t.Fatal("release bypassed trusted commit")
	}
	request.Action = "commit"
	if _, err := r.SwitchControl(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	request.Action = "drain_release"
	view, err = r.SwitchControl(context.Background(), request)
	if err != nil || !view.MaintenanceAllowed || releases.Load() != 1 || writes.Load() != 0 {
		t.Fatalf("committed release failed %+v %v writes=%d releases=%d", view, err, writes.Load(), releases.Load())
	}
	request.BindingRevision++
	if _, err := r.SwitchControl(context.Background(), request); err == nil {
		t.Fatal("stale binding accepted")
	}
}
func switchSealedStatus(request beewire.DeviceDrainRequest, seal beewire.DeviceDrainSealRequest) beewire.DeviceDrainStatus {
	return beewire.DeviceDrainStatus{Version: 1, DeviceID: request.DeviceID, OwnerID: request.OwnerID, OperationID: request.ID, State: "sealed", Request: &request, Seal: &seal, Receipt: &beewire.DeviceDrainReceipt{Version: 1, Seal: seal, Epoch: seal.ID, ConnectionRetired: true, Work: beewire.DeviceDrainWork{}}, Current: beewire.DeviceDrainCurrent{Epoch: seal.ID, BarrierID: request.ID, Work: &beewire.DeviceDrainWork{}}}
}

func desktopSwitchDeviceFixture(t *testing.T, handler http.HandlerFunc) *DesktopDevice {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	identity := desktopSupplyIdentity()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	if err := saveState(path, localState{Hive: server.URL, Name: identity.Name, Credential: "bee_" + strings.Repeat("b", 43), Identity: &identity}); err != nil {
		t.Fatal(err)
	}
	return newDesktopTestDevice(t, path)
}

func TestDesktopSwitchReleasedAdmissionSurvivesNormalRetirementEpochAndRestart(t *testing.T) {
	var retirement *beewire.RuntimeRecoveryRequest
	posts := 0
	d := desktopRetirementDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if !strings.HasPrefix(q.URL.Path, "/api/bee/runtime-recovery/") {
			t.Errorf("unexpected request %s %s", q.Method, q.URL.Path)
			w.WriteHeader(500)
			return
		}
		if q.Method == http.MethodPost {
			posts++
			if err := json.NewDecoder(q.Body).Decode(&retirement); err != nil {
				t.Error(err)
			}
		}
		result := beewire.RuntimeRecoveryResult{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", State: "absent"}
		if retirement != nil {
			result.Request = retirement
			result.State = "retired"
			result.Epoch = retirement.ID
			result.ConnectionRetired = true
			result.PreparationsRetired = true
		}
		json.NewEncoder(w).Encode(result)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	s, end, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, revision, err := s.readBinding()
	if err != nil {
		end()
		t.Fatal(err)
	}
	op := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: state.Identity.ID, OwnerID: state.Identity.OwnerID, Origin: state.Hive}
	seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48), Request: op}
	status := switchSealedStatus(op, seal)
	status.State = "released"
	status.Current.BarrierID = ""
	status.Release = &beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("3", 48), Request: op, Mode: "activate", ExpectedEpoch: seal.ID, ExpectedLease: "verified-lease"}
	state.RuntimeEpoch = seal.ID
	if err = saveState(s.path, state); err != nil {
		end()
		t.Fatal(err)
	}
	if err = r.saveSwitchProof(s, &desktopSwitchSeal{Version: 1, Binding: retirementBinding(state), OriginalEpoch: op.ExpectedEpoch, Status: status, Released: true}); err != nil {
		end()
		t.Fatal(err)
	}
	end()
	if _, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "commit", BindingRevision: revision, Operation: &op}); err != nil {
		t.Fatal(err)
	}
	s, end, err = d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.selectionScope(s, state, func(scope *desktopAccountScope) error {
		scope.RuntimeIntent.Running = true
		scope.Session = desktopSessionMarker{RunID: strings.Repeat("a", 32), Active: true}
		return nil
	})
	end()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(filepath.Dir(d.path), "runtime-session"), []byte(strings.Repeat("a", 32)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	retired := r.ReconcileRecovery(context.Background())
	if retired.Failure != nil || retired.State != "eligible" || posts != 1 {
		t.Fatalf("ordinary retirement did not complete: %+v posts=%d", retired, posts)
	}
	s, end, err = d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, _, err = s.readBinding()
	end()
	if err != nil {
		t.Fatal(err)
	}
	if state.RuntimeEpoch != retirement.ID || state.RuntimeEpoch == seal.ID {
		t.Fatal("retirement did not advance current epoch")
	}
	r.Close()
	next := NewDesktopRuntime(context.Background(), d, a)
	defer next.Close()
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	view, err := next.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "inspect", BindingRevision: c.BindingRevision})
	if err != nil || view.Frozen || !view.MaintenanceAllowed {
		t.Fatalf("completed historical switch blocked normal retired epoch: %+v %v", view, err)
	}
	if view.Drain == nil || view.Drain.Request.ID != op.ID || view.Drain.Receipt.Epoch != seal.ID || view.Epoch != retirement.ID {
		t.Fatalf("historical receipt was lost or treated as current fact: %+v", view)
	}
	next.Close()
	for _, mode := range []DesktopProfileMode{DesktopProfilePrepare, DesktopProfileActivate} {
		d.profileMode = mode
		limited := NewDesktopRuntime(context.Background(), d, a)
		view, err = limited.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "inspect", BindingRevision: c.BindingRevision})
		if err != nil || !view.Frozen || view.MaintenanceAllowed {
			t.Fatalf("historical completion opened restricted mode=%s: %+v %v", mode, view, err)
		}
		limited.Close()
	}
	d.profileMode = DesktopProfileCurrent
	if err = os.WriteFile(filepath.Join(filepath.Dir(d.path), "runtime-session"), []byte(strings.Repeat("f", 32)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	dirty := NewDesktopRuntime(context.Background(), d, a)
	defer dirty.Close()
	if inspection := dirty.InspectRecovery(context.Background()); inspection.Failure == nil || inspection.State != "blocked" {
		t.Fatalf("switch completion bypassed ordinary dirty guard: %+v", inspection)
	}
}

func TestDesktopSwitchStopRequiresDurableOriginalSeal(t *testing.T) {
	var calls atomic.Int32
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) { calls.Add(1); w.WriteHeader(500) })
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	guard := filepath.Join(filepath.Dir(d.path), "runtime-session")
	if err := os.WriteFile(guard, []byte("original-guard\n"), 0600); err != nil {
		t.Fatal(err)
	}
	op := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
	_, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "stop", BindingRevision: c.BindingRevision, Operation: &op})
	if err == nil {
		t.Fatal("stopped before server seal")
	}
	raw, readErr := os.ReadFile(guard)
	if readErr != nil || string(raw) != "original-guard\n" || calls.Load() != 0 {
		t.Fatalf("failed gate changed guard or contacted Hive: guard=%q read=%v calls=%d", raw, readErr, calls.Load())
	}
}

func TestDesktopSwitchUnknownSealPreservesGuardAndOriginalID(t *testing.T) {
	var calls atomic.Int32
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if q.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			w.Write([]byte(`{"version":1,"device_drain":1}`))
			return
		}
		calls.Add(1)
		w.WriteHeader(503)
		w.Write([]byte(`{"error":{"code":"temporarily_unavailable","message":"synthetic seal response unavailable"}}`))
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, _ := d.Context(context.Background())
	guard := filepath.Join(filepath.Dir(d.path), "runtime-session")
	os.WriteFile(guard, []byte("original-guard\n"), 0600)
	op := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
	seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48), Request: op}
	if _, err := r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "freeze", BindingRevision: c.BindingRevision}); err != nil {
		t.Fatal(err)
	}
	request := DesktopSwitchRequest{Action: "drain_seal", BindingRevision: c.BindingRevision, Operation: &op, Seal: &seal}
	_, err := r.SwitchControl(context.Background(), request)
	if err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("unknown server outcome lost: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("seal retried unknown write: calls=%d", calls.Load())
	}
	request.Action = "stop"
	if _, err = r.SwitchControl(context.Background(), request); err == nil {
		t.Fatal("unknown seal treated as proof")
	}
	raw, _ := os.ReadFile(guard)
	if string(raw) != "original-guard\n" {
		t.Fatalf("unknown seal cleaned guard: %q", raw)
	}
}

func TestDesktopSwitchPreparationCannotOpenSocketOrUnlockMaintenance(t *testing.T) {
	var calls atomic.Int32
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) { calls.Add(1); w.WriteHeader(500) })
	d.profileMode = DesktopProfilePrepare
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, _ := d.Context(context.Background())
	op := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
	for _, action := range []string{"connect", "commit", "stop"} {
		if _, err := r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: action, BindingRevision: c.BindingRevision, Operation: &op}); err == nil {
			t.Fatalf("prepare allowed %s", action)
		}
	}
	if _, err := r.Restore(context.Background()); err == nil {
		t.Fatal("prepare allowed direct runtime restore")
	}
	if err := r.EnablePresence(context.Background(), DesktopPresenceRequest{BindingRevision: c.BindingRevision}); err == nil {
		t.Fatal("prepare allowed presence")
	}
	if calls.Load() != 0 {
		t.Fatalf("preparation emitted forbidden network call: %d", calls.Load())
	}
}

func TestDesktopSwitchSealPersistenceFailureCannotCleanGuard(t *testing.T) {
	var operation beewire.DeviceDrainRequest
	var seal beewire.DeviceDrainSealRequest
	var proofPath, target string
	var calls atomic.Int32
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if q.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			w.Write([]byte(`{"version":1,"device_drain":1}`))
			return
		}
		calls.Add(1)
		if err := os.Symlink(target, proofPath); err != nil {
			t.Error(err)
		}
		json.NewEncoder(w).Encode(switchSealedStatus(operation, seal))
	})
	d.profileMode = DesktopProfilePrepare
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, _ := d.Context(context.Background())
	operation = beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
	seal = beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48), Request: operation}
	directory := filepath.Dir(d.path)
	guard := filepath.Join(directory, "runtime-session")
	os.WriteFile(guard, []byte("original-guard\n"), 0600)
	target = filepath.Join(t.TempDir(), "protected-proof")
	os.WriteFile(target, []byte("original"), 0600)
	proofPath = filepath.Join(directory, "desktop-switch-seal.json")
	request := DesktopSwitchRequest{Action: "drain_seal", BindingRevision: c.BindingRevision, Operation: &operation, Seal: &seal}
	if _, err := r.SwitchControl(context.Background(), request); err == nil || calls.Load() != 1 {
		t.Fatalf("seal save failure was not exposed: calls=%d error=%v", calls.Load(), err)
	}
	request.Action = "stop"
	if _, err := r.SwitchControl(context.Background(), request); err == nil {
		t.Fatal("cleaned guard after proof save failure")
	}
	raw, _ := os.ReadFile(guard)
	if string(raw) != "original-guard\n" {
		t.Fatalf("proof failure cleaned guard: %q", raw)
	}
}

func TestDesktopSwitchFreezeLeavesRuntimeIntentAndRejectsNewWrites(t *testing.T) {
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		t.Errorf("unexpected request %s", q.URL.Path)
		w.WriteHeader(500)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, _ := d.Context(context.Background())
	session, end, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, _ := session.read()
	_, err = a.selectionScope(session, state, func(scope *desktopAccountScope) error {
		scope.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{}}
		return nil
	})
	end()
	if err != nil {
		t.Fatal(err)
	}
	request := DesktopSwitchRequest{Action: "freeze", BindingRevision: c.BindingRevision}
	view, err := r.SwitchControl(context.Background(), request)
	if err != nil || !view.Frozen {
		t.Fatalf("freeze %+v: %v", view, err)
	}
	if _, err := r.Restore(context.Background()); err == nil {
		t.Fatal("freeze allowed restore")
	}
	if _, err := d.SetPaused(context.Background(), "openai", false); err == nil {
		t.Fatal("freeze allowed new supply write")
	}
	for _, reason := range []string{"user_stop", "network_change", "startup_recovery"} {
		if _, err := r.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: 0, Reason: reason}); err == nil {
			t.Fatalf("freeze allowed ordinary stop reason=%s", reason)
		}
	}
	session, end, err = d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	scope, err := a.selectionScope(session, state, nil)
	end()
	if err != nil || !scope.RuntimeIntent.Running || len(scope.RuntimeIntent.ResumePlatforms) != 0 {
		t.Fatalf("freeze changed intent: %+v %v", scope.RuntimeIntent, err)
	}
}

func TestDesktopSwitchMalformedSavedProofFailsClosed(t *testing.T) {
	for _, scenario := range []string{"missing_receipt", "binding_changed", "epoch_changed", "completion_before_release", "completed_unexplained_epoch"} {
		t.Run(scenario, func(t *testing.T) {
			d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
				t.Errorf("unexpected request %s", q.URL.Path)
				w.WriteHeader(500)
			})
			c, err := d.Context(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			session, end, err := d.acquireSession(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			state, err := session.read()
			end()
			if err != nil {
				t.Fatal(err)
			}
			op := beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
			seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48), Request: op}
			status := switchSealedStatus(op, seal)
			proof := desktopSwitchSeal{Version: 1, Binding: retirementBinding(state), Status: status, WorkersStopped: true}
			switch scenario {
			case "missing_receipt":
				proof.Status.State = "ready"
				proof.Status.Seal = nil
				proof.Status.Receipt = nil
				proof.Status.Current.Epoch = ""
			case "binding_changed":
				proof.Binding = "unrelated-binding"
			case "epoch_changed":
				proof.WorkersStopped = false
				proof.OriginalEpoch = strings.Repeat("3", 48)
				proof.Status.Request.ExpectedEpoch = proof.OriginalEpoch
				proof.Status.Seal.Request = *proof.Status.Request
				proof.Status.Receipt.Seal = *proof.Status.Seal
			case "completion_before_release":
				proof.AdmissionCompleted = true
			case "completed_unexplained_epoch":
				proof.AdmissionCompleted = true
				proof.Released = true
				proof.WorkersStopped = false
				proof.Status.State = "released"
				proof.Status.Current.BarrierID = ""
				proof.Status.Release = &beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("3", 48), Request: op, Mode: "activate", ExpectedEpoch: seal.ID, ExpectedLease: "verified-lease"}
				state.RuntimeEpoch = strings.Repeat("4", 48)
				if err = saveState(session.path, state); err != nil {
					t.Fatal(err)
				}
			}
			raw, err := json.Marshal(proof)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(filepath.Dir(d.path), "desktop-switch-seal.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			a := NewDesktopAccounts(d)
			defer a.Close()
			r := NewDesktopRuntime(context.Background(), d, a)
			defer r.Close()
			if _, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "inspect", BindingRevision: c.BindingRevision}); err == nil {
				t.Fatal("accepted invalid saved lifecycle proof")
			}
			if r.SwitchMaintenanceAllowed() {
				t.Fatal("invalid saved proof unlocked maintenance")
			}
		})
	}
}

func TestDesktopSwitchExitJoinsOwnedWorkerWithoutCleaningUnknownGuard(t *testing.T) {
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		t.Errorf("unexpected request %s", q.URL.Path)
		w.WriteHeader(500)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	guard := filepath.Join(filepath.Dir(d.path), "runtime-session")
	if err = os.WriteFile(guard, []byte("original-guard\n"), 0600); err != nil {
		t.Fatal(err)
	}
	workerCtx, cancel := context.WithCancel(r.ctx)
	done := make(chan struct{})
	r.runCancel = cancel
	r.runDone = done
	go func() { defer close(done); <-workerCtx.Done() }()
	if _, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "freeze", BindingRevision: c.BindingRevision}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Stop(context.Background(), DesktopStopRequest{Reason: "app_exit", ExpectedRevision: 0}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		r.mu.Lock()
		pending := r.snapshot.Operation.State == "pending"
		receipt := r.snapshot.StopReceipt
		state := r.snapshot.Operation.State
		r.mu.Unlock()
		if !pending {
			if state != "failed" || receipt == nil || !receipt.WorkersStopped || receipt.SessionClean {
				t.Fatalf("exit falsely certified switch: state=%s receipt=%+v", state, receipt)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("owned worker exit did not finish")
		}
		time.Sleep(time.Millisecond)
	}
	raw, err := os.ReadFile(guard)
	if err != nil || string(raw) != "original-guard\n" {
		t.Fatalf("unknown seal exit cleaned guard: %q %v", raw, err)
	}
	if inspection := r.InspectRecovery(context.Background()); inspection.State != "blocked" {
		t.Fatalf("unknown seal exit became recoverable: %+v", inspection)
	}
}

func TestDesktopSwitchSavedSealStopsOwnedSessionAndSurvivesRestart(t *testing.T) {
	var op beewire.DeviceDrainRequest
	var seal beewire.DeviceDrainSealRequest
	d := desktopSwitchDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if q.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			w.Write([]byte(`{"version":1,"device_drain":1}`))
			return
		}
		if q.Method != http.MethodGet || q.URL.Path != beewire.DeviceDrainOperationsPath+op.ID {
			t.Errorf("unexpected request %s %s", q.Method, q.URL.Path)
			w.WriteHeader(500)
			return
		}
		json.NewEncoder(w).Encode(switchSealedStatus(op, seal))
	})
	d.profileMode = DesktopProfileCurrent
	a := NewDesktopAccounts(d)
	r := NewDesktopRuntime(context.Background(), d, a)
	c, err := d.Context(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	op = beewire.DeviceDrainRequest{ID: strings.Repeat("1", 48), DeviceID: *c.DeviceID, OwnerID: *c.OwnerID, Origin: c.Hive}
	seal = beewire.DeviceDrainSealRequest{ID: strings.Repeat("2", 48), Request: op}
	run := strings.Repeat("a", 32)
	session, end, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, err := session.read()
	if err != nil {
		end()
		t.Fatal(err)
	}
	_, err = a.selectionScope(session, state, func(s *desktopAccountScope) error {
		s.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{}}
		s.Session = desktopSessionMarker{RunID: run, Active: true}
		return nil
	})
	if err == nil {
		err = r.reserveRecoveryGuard(session, run, false)
	}
	end()
	if err != nil {
		t.Fatal(err)
	}
	r.ownedSession = &desktopRetiredAccountSession{run: run, scope: desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)}
	if _, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "freeze", BindingRevision: c.BindingRevision}); err != nil {
		t.Fatal(err)
	}
	request := DesktopSwitchRequest{Action: "drain_status", BindingRevision: c.BindingRevision, Operation: &op}
	if _, err = r.SwitchControl(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	request.Action = "stop"
	view, err := r.SwitchControl(context.Background(), request)
	if err != nil || !view.WorkersStopped || !view.SealPersisted || view.Epoch != seal.ID || view.MaintenanceAllowed {
		t.Fatalf("sealed owned stop failed: %+v %v", view, err)
	}
	guard, err := os.ReadFile(filepath.Join(filepath.Dir(d.path), "runtime-session"))
	if err != nil || string(guard) != "clean\n" {
		t.Fatalf("owned seal did not clean guard after proof: %q %v", guard, err)
	}
	r.Close()
	a.Close()
	a = NewDesktopAccounts(d)
	defer a.Close()
	r = NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	view, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "inspect", BindingRevision: c.BindingRevision})
	if err != nil || !view.WorkersStopped || !view.Frozen || view.Drain == nil || view.Drain.OperationID != op.ID || view.MaintenanceAllowed {
		t.Fatalf("restart lost original seal fence: %+v %v", view, err)
	}
	session, end, err = d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	scope, err := a.selectionScope(session, state, nil)
	end()
	if err != nil || !scope.RuntimeIntent.Running || !scope.Session.Clean || scope.Session.Active {
		t.Fatalf("switch stop changed intent or retained active session: %+v %v", scope, err)
	}
	changed := op
	changed.ExpectedLease = "different-lease"
	if _, err = r.SwitchControl(context.Background(), DesktopSwitchRequest{Action: "drain_status", BindingRevision: c.BindingRevision, Operation: &changed}); err == nil {
		t.Fatal("restart accepted changed original request")
	}
}
