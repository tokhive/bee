package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestPairingProtocolLostCreateUsesOriginalAttemptAfterRestart(t *testing.T) {
	var first, second beewire.PairingAttempt
	creates := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == beewire.PairingRecoveryCapabilitiesPath:
			json.NewEncoder(w).Encode(map[string]int{"version": 1, "pairing_recovery": 1})
		case r.URL.Path == "/api/bee/identity":
			http.Error(w, `{"error":{"code":"invalid_device_credential","message":"unknown device"}}`, 401)
		case strings.HasSuffix(r.URL.Path, "/begin"):
			creates++
			var input beewire.PairingAttempt
			json.NewDecoder(r.Body).Decode(&input)
			if creates == 1 {
				first = input
				http.Error(w, `{"error":{"code":"unavailable","message":"lost reply"}}`, 503)
				return
			}
			second = input
			json.NewEncoder(w).Encode(beewire.PairingRecoveryStatus{Version: 1, AttemptID: strings.Split(r.URL.Path, "/")[5], State: "pending", Pairing: &beewire.Pairing{ExpiresAt: time.Now().Add(time.Hour), VerificationURI: server.URL + "/devices/pair", PollInterval: 2}, Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()})
		default:
			http.Error(w, `{"error":{"code":"pairing_attempt_not_found","message":"not observed yet"}}`, 404)
		}
	}))
	defer server.Close()
	d := &DesktopDevice{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
	v, err := d.Begin(context.Background(), server.URL, "Bee")
	if err != nil {
		t.Fatal(err)
	}
	if v.Recovery == nil || v.Recovery.Phase != "creation_unknown" {
		t.Fatalf("lost reply: %+v", v)
	}
	d.Close()
	d = &DesktopDevice{path: d.path}
	defer d.Close()
	v, err = d.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if v.Recovery == nil || v.Recovery.Phase != "pending" {
		t.Fatalf("replay not accepted: %+v", v)
	}
	if creates != 2 || first != second {
		t.Fatalf("restart did not replay original request: creates=%d original_equal=%t", creates, first == second)
	}
}

func TestPairingRecoveryDamagedConfigRetainsEvidenceAndStartsExplicitly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == beewire.PairingRecoveryCapabilitiesPath {
			json.NewEncoder(w).Encode(map[string]int{"version": 1, "pairing_recovery": 1})
			return
		}
		t.Errorf("prepare sent unexpected request: %s", r.URL.Path)
		w.WriteHeader(500)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	raw := []byte("{damaged credential evidence")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	d := &DesktopDevice{path: path}
	defer d.Close()
	v, err := d.RecoveryAt(context.Background(), server.URL, "Recovered Bee")
	if err != nil || v.Phase != "awaiting_confirmation" {
		t.Fatalf("recovery entry: %+v %v", v, err)
	}
	saved, _ := os.ReadFile(path)
	if string(saved) != string(raw) {
		t.Fatal("damaged original overwritten before recovery")
	}
	if _, err = d.RecoveryStatus(context.Background()); err != nil {
		t.Fatal("damaged file still prevents recovery observation", err)
	}
}

func TestPairingRecoveryRetiresOnlyAttributedOldRuntimeGuard(t *testing.T) {
	for _, matching := range []bool{false, true} {
		t.Run(map[bool]string{true: "old-device", false: "unattributed"}[matching], func(t *testing.T) {
			directory := t.TempDir()
			session := &desktopDeviceSession{path: filepath.Join(directory, "bee-desktop.json")}
			record := &desktopRecoveryRecord{OperationID: strings.Repeat("a", 48), Purpose: "local_recovery", Hive: "https://hive.example", NewIdentity: &beewire.Identity{ID: "new-device", OwnerID: "owner"}}
			protocol := &desktopPairingProtocol{ReplacedDeviceID: "old-device"}
			old := newDesktopAccountScope(localState{Hive: record.Hive, Identity: &beewire.Identity{ID: "old-device", OwnerID: "owner"}})
			old.Session = desktopSessionMarker{RunID: strings.Repeat("b", 32), Active: true}
			disk := desktopAccountState{Version: desktopAccountStateVersion, Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(record.Hive, "owner", "old-device"): old}}
			raw, _ := json.Marshal(disk)
			os.WriteFile(filepath.Join(directory, "ai-accounts.json"), raw, 0600)
			guard := old.Session.RunID + "\n"
			if !matching {
				guard = strings.Repeat("c", 32) + "\n"
			}
			os.WriteFile(filepath.Join(directory, "runtime-session"), []byte(guard), 0600)
			err := retirePairingRecoveryGuard(session, record, protocol)
			actual, _ := os.ReadFile(filepath.Join(directory, "runtime-session"))
			if matching {
				if err != nil || string(actual) != "clean\n" {
					t.Fatal("proven old guard not retired", err, string(actual))
				}
			} else if err == nil || string(actual) != guard {
				t.Fatal("unattributed guard discarded", err)
			}
			preserved, _ := os.ReadFile(filepath.Join(directory, "ai-accounts.json"))
			if string(preserved) != string(raw) {
				t.Fatal("old account history modified")
			}
		})
	}
}

func TestPairingCancellationUsesPersistedObservationBudget(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Error(w, `{"error":{"code":"unavailable","message":"synthetic outage"}}`, 503)
	}))
	defer server.Close()
	session := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
	r := &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: strings.Repeat("a", 48), Revision: 1, Phase: "creation_unknown", Hive: server.URL, Name: "Bee", Credential: "bee_" + strings.Repeat("b", 43), CreateAttempted: true, Accepted: []desktopRecoveryDecision{}}
	p, err := newPairingProtocol(r)
	if err != nil {
		t.Fatal(err)
	}
	p.Cancel = true
	p.Failures = 3
	d := &DesktopDevice{}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	if p.Failures != 4 {
		t.Fatalf("cancellation failure budget=%d required=4", p.Failures)
	}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || r.Failure == nil || r.Failure.Code != "PAIRING_OBSERVATION_PAUSED" {
		t.Fatal("paused cancellation resent", requests, r.Failure)
	}
}

func TestPairingRejectedClosureStopsAutomaticWritesAcrossRestart(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "restart"}[restart], func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				requests++
				json.NewEncoder(w).Encode(beewire.PairingRecoveryStatus{Version: 1, AttemptID: strings.Repeat("f", 48), State: "closed", Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()})
			}))
			defer server.Close()
			session := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
			r := &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: strings.Repeat("a", 48), Revision: 1, Phase: "creation_unknown", Hive: server.URL, Name: "Bee", Credential: "bee_" + strings.Repeat("b", 43), CreateAttempted: true, Accepted: []desktopRecoveryDecision{}}
			p, err := newPairingProtocol(r)
			if err != nil {
				t.Fatal(err)
			}
			p.Restart, p.Cancel = restart, !restart
			d := &DesktopDevice{}
			if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
				t.Fatal(err)
			}
			p, err = readPairingProtocol(session, r)
			if err != nil {
				t.Fatal(err)
			}
			if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
				t.Fatal(err)
			}
			if requests != 1 || r.Phase != "blocked" || r.Failure == nil || r.Failure.Code != "PAIRING_ADMIN_REQUIRED" || p.Failures != 4 {
				t.Fatal("rejected closure replayed or hidden", requests, r.Phase, r.Failure, p.Failures)
			}
		})
	}
}

func TestPairingPersistedCancellationOverridesRestartAfterCrash(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		if !strings.HasSuffix(request.URL.Path, "/cancel") {
			t.Errorf("persisted cancellation sent %s", request.URL.Path)
		}
		json.NewEncoder(w).Encode(beewire.PairingRecoveryStatus{Version: 1, AttemptID: strings.Split(request.URL.Path, "/")[5], State: "cancelled", Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()})
	}))
	defer server.Close()
	session := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
	r := &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: strings.Repeat("a", 48), Revision: 3, Phase: "creation_unknown", Hive: server.URL, Name: "Bee", Credential: "bee_" + strings.Repeat("b", 43), CreateAttempted: true}
	r.Accepted = []desktopRecoveryDecision{{OperationID: r.OperationID, ExpectedRevision: 1, Decision: "restart_pairing"}, {OperationID: r.OperationID, ExpectedRevision: 2, Decision: "cancel_pairing"}}
	p, err := newPairingProtocol(r)
	if err != nil {
		t.Fatal(err)
	}
	p.Restart, p.DecisionRevision = true, 2 // Crash after accepted cancellation, before protocol intent save.
	if err = savePairingProtocol(session, p); err != nil {
		t.Fatal(err)
	}
	d := &DesktopDevice{}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	p, err = readPairingProtocol(session, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || p.Restart || !p.Cancel || p.DecisionRevision < 3 || r.Failure == nil || r.Failure.Code != "PAIRING_CLOSED" {
		t.Fatal("latest cancellation lost or replayed", requests, p.Restart, p.Cancel, p.DecisionRevision, r.Failure)
	}
}

func TestPairingRestartDoesNotReapplyDecisionToNewAttempt(t *testing.T) {
	closes, begins := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path == beewire.PairingRecoveryCapabilitiesPath {
			json.NewEncoder(w).Encode(map[string]int{"version": 1, "pairing_recovery": 1})
			return
		}
		out := beewire.PairingRecoveryStatus{Version: 1, AttemptID: strings.Split(request.URL.Path, "/")[5], State: "pending", Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()}
		if strings.HasSuffix(request.URL.Path, "/close") {
			closes++
			out.State = "closed"
		} else {
			if strings.HasSuffix(request.URL.Path, "/begin") {
				begins++
			}
			out.Pairing = &beewire.Pairing{ExpiresAt: time.Now().Add(time.Hour), VerificationURI: server.URL + "/devices/pair", PollInterval: 2}
		}
		json.NewEncoder(w).Encode(out)
	}))
	defer server.Close()
	session := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
	r := &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: strings.Repeat("a", 48), Revision: 2, Phase: "creation_unknown", Hive: server.URL, Name: "Bee", Credential: "bee_" + strings.Repeat("b", 43), CreateAttempted: true}
	r.Accepted = []desktopRecoveryDecision{{OperationID: r.OperationID, ExpectedRevision: 1, Decision: "restart_pairing"}}
	p, err := newPairingProtocol(r)
	if err != nil {
		t.Fatal(err)
	}
	if err = savePairingProtocol(session, p); err != nil {
		t.Fatal(err)
	}
	d := &DesktopDevice{}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	p, err = readPairingProtocol(session, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = d.advancePairingProtocol(context.Background(), session, r, p); err != nil {
		t.Fatal(err)
	}
	if begins != 1 || closes != 1 || len(p.History) != 1 || r.Phase != "pending" {
		t.Fatal("restart intent created another attempt", begins, closes, len(p.History), r.Phase)
	}
}

func TestPairingLegacyObservationRetainsOriginalCreationFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != beewire.PairingLegacyPath || request.Method != http.MethodGet {
			t.Errorf("legacy observation sent %s %s", request.Method, request.URL.Path)
		}
		json.NewEncoder(w).Encode(beewire.PairingRecoveryStatus{Version: 1, State: "unknown", Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()})
	}))
	defer server.Close()
	session := &desktopDeviceSession{path: filepath.Join(t.TempDir(), "bee-desktop.json")}
	original := &DesktopRecoveryFailure{Code: "DEVICE_RECOVERY_BLOCKED", Message: "pairing verification URL rejected"}
	r := &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: strings.Repeat("a", 48), Revision: 1, Phase: "creation_unknown", Hive: server.URL, Name: "Bee", Credential: "bee_" + strings.Repeat("b", 43), CreateAttempted: true, Failure: original, Accepted: []desktopRecoveryDecision{}}
	if err := (&DesktopDevice{}).observeLegacyPairing(context.Background(), session, r); err != nil {
		t.Fatal(err)
	}
	p, err := readPairingProtocol(session, r)
	if err != nil || p == nil || p.OriginalFailure == nil || p.OriginalFailure.Message != original.Message || p.OriginalFailure.Code != original.Code || r.Failure.Code != "PAIRING_LEGACY_UNRESOLVED" {
		t.Fatal("old original evidence overwritten", p, err)
	}
}

func TestPairingRecoveryRestoresOriginalCredentialFromProtectedRecordBeforeReplacement(t *testing.T) {
	credential := "bee_" + strings.Repeat("a", 43)
	identity := beewire.Identity{ID: "original-device", Name: "Original Bee", OwnerID: "owner", OwnerEmail: "owner@example.test"}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/bee/identity" || r.Header.Get("Authorization") != "Bearer "+credential {
			t.Errorf("original restore sent unexpected request %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		json.NewEncoder(w).Encode(identity)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	session := &desktopDeviceSession{path: path}
	record := &desktopRecoveryRecord{Version: 1, Purpose: "local_recovery", OperationID: strings.Repeat("b", 48), Revision: 1, Phase: "completed", Hive: server.URL, Name: identity.Name, Credential: credential, NewIdentity: &identity, ConfirmedOwner: identity.OwnerID, Accepted: []desktopRecoveryDecision{}}
	if err := saveDesktopRecovery(session, record); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(path, []byte("{damaged-config"), 0600)
	device := &DesktopDevice{path: path}
	defer device.Close()
	view, err := device.RecoveryAt(context.Background(), server.URL, "Recovery name")
	if err != nil || view.Phase != "completed" || calls != 1 {
		t.Fatal("original binding not restored", view, err, calls)
	}
	raw, _ := os.ReadFile(path)
	var restored localState
	if err = json.Unmarshal(raw, &restored); err != nil || restored.Credential != credential || restored.Identity.ID != identity.ID {
		t.Fatal("original credential changed", err)
	}
}

func TestPairingRecoveryRetainsCompletedRecordScopeWhenOriginalSecretIsInvalid(t *testing.T) {
	identity := beewire.Identity{ID: "original-device", Name: "Original Bee", OwnerID: "original-owner", OwnerEmail: "owner@example.test"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path == beewire.PairingRecoveryCapabilitiesPath {
			json.NewEncoder(w).Encode(map[string]int{"version": 1, "pairing_recovery": 1})
			return
		}
		http.Error(w, `{"error":{"code":"device_replaced","message":"original device revoked"}}`, 401)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	session := &desktopDeviceSession{path: path}
	record := &desktopRecoveryRecord{Version: 1, Purpose: "local_recovery", OperationID: strings.Repeat("b", 48), Revision: 1, Phase: "completed", Hive: server.URL, Name: identity.Name, Credential: "bee_" + strings.Repeat("a", 43), NewIdentity: &identity, ConfirmedOwner: identity.OwnerID, Accepted: []desktopRecoveryDecision{}}
	if err := saveDesktopRecovery(session, record); err != nil {
		t.Fatal(err)
	}
	device := &DesktopDevice{path: path}
	defer device.Close()
	if _, err := device.RecoveryAt(context.Background(), "https://other.example", "Recovery name"); err == nil || !strings.Contains(err.Error(), "another Hive") {
		t.Fatal("completed original Hive scope discarded", err)
	}
	view, err := device.RecoveryAt(context.Background(), server.URL, "Recovery name")
	if err != nil || view.Phase != "awaiting_confirmation" || view.OldIdentity == nil || *view.OldIdentity != identity {
		t.Fatal("trusted original owner/device discarded", view, err)
	}
}
