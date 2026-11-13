package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestDesktopDevicePairingAndRestart(t *testing.T) {
	var origin, credential string
	approved, bound := false, false
	creates := 0
	identity := beewire.Identity{ID: "device-1", Name: "My Mac", OwnerID: "owner-1", OwnerEmail: "test@example.test"}
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Hive-Request") != "1" {
			t.Error("missing existing Hive request header")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /api/bee/identity":
			state, _ := readState(path)
			credential = state.Credential
			if r.Header.Get("Authorization") != "Bearer "+credential {
				t.Error("wrong identity credential")
			}
			if bound {
				json.NewEncoder(w).Encode(identity)
			} else {
				w.WriteHeader(401)
				w.Write([]byte(`{"error":{"code":"invalid_device_credential"}}`))
			}
		case "POST /api/bee/pairings":
			creates++
			state, err := readState(path)
			if err != nil || state.Credential == "" {
				t.Error("credential not saved before remote write")
			}
			var input beewire.StartPairing
			json.NewDecoder(r.Body).Decode(&input)
			digest := sha256.Sum256([]byte(state.Credential))
			if input.CredentialHash != hex.EncodeToString(digest[:]) || input.Name != "My Mac" || r.Header.Get("Authorization") != "" {
				t.Error("pairing request differs from Hive contract")
			}
			json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Minute), PollInterval: 2, Status: "pending"})
		case "GET /api/bee/pairings":
			if r.Header.Get("Authorization") != "Bearer beep_"+strings.Repeat("a", 43) {
				t.Error("wrong pairing token")
			}
			status := "pending"
			if approved {
				status = "approved"
			}
			json.NewEncoder(w).Encode(beewire.Pairing{ExpiresAt: time.Now().Add(time.Minute), PollInterval: 2, Status: status})
		case "POST /api/bee/pairings/redeem":
			bound = true
			// A committed exchange with a lost/malformed response must recover by identity.
			w.Write([]byte(`{`))
		default:
			t.Errorf("unexpected endpoint: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	origin = server.URL
	device := newDesktopTestDevice(t, path)
	empty, err := device.Status(context.Background())
	if err != nil || empty.State != "unbound" {
		t.Fatalf("empty: %+v %v", empty, err)
	}
	pending, err := device.Begin(context.Background(), origin, "My Mac")
	if err != nil || pending.State != "pending" || !strings.Contains(pending.VerificationURL, "code=ABCD-EFGH") {
		t.Fatalf("pending: %+v %v", pending, err)
	}
	public, _ := json.Marshal(pending)
	if strings.Contains(string(public), credential) || strings.Contains(string(public), "beep_") {
		t.Fatal("secret leaked")
	}
	// Reloading the service uses the same transaction, without another creation.
	closeDesktopTestDevice(t, device)
	device = newDesktopTestDevice(t, path)
	waiting, err := device.Status(context.Background())
	if err != nil || waiting.State != "pending" {
		t.Fatalf("waiting: %+v %v", waiting, err)
	}
	approved = true
	result, err := device.Status(context.Background())
	if err != nil || result.State != "bound" || result.Identity == nil || result.Identity.ID != "device-1" {
		t.Fatalf("recovery: %+v %v", result, err)
	}
	state, _ := readState(path)
	if state.Pairing != nil || state.Credential != credential || creates != 1 {
		t.Fatal("transaction was replaced or not finalized")
	}
	closeDesktopTestDevice(t, device)
	result, err = (newDesktopTestDevice(t, path)).Status(context.Background())
	if err != nil || result.State != "bound" {
		t.Fatalf("restart: %+v %v", result, err)
	}
}

func TestDesktopDeviceRejectsHiveChangeAndInvalidOrigin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop.json")
	original := localState{Hive: "https://hive.example", Name: "Mac", Credential: "bee_" + strings.Repeat("a", 43)}
	if err := saveState(path, original); err != nil {
		t.Fatal(err)
	}
	d := newDesktopTestDevice(t, path)
	for _, origin := range []string{"https://other.example", "http://remote.example", "https://hive.example/devices", "https://user:password@hive.example"} {
		if _, err := d.Begin(context.Background(), origin, "Mac"); err == nil {
			t.Fatalf("accepted %s", origin)
		}
	}
	actual, _ := readState(path)
	if actual != original {
		t.Fatal("mutated existing configuration")
	}
}

func TestDesktopDeviceBoundCredentialNeverRebinds(t *testing.T) {
	creates := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			creates++
		}
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"code":"device_replaced"}}`))
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "desktop.json")
	saveState(path, localState{Hive: server.URL, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43), Identity: &beewire.Identity{ID: "original", OwnerID: "owner", OwnerEmail: "a@b.test", Name: "Mac"}})
	d := newDesktopTestDevice(t, path)
	if _, err := d.Status(context.Background()); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("missing failure evidence: %v", err)
	}
	if _, err := d.Begin(context.Background(), server.URL, "Mac"); err == nil {
		t.Fatal("silently rebound revoked device")
	}
	if creates != 0 {
		t.Fatal("created new pairing for bound device")
	}
}

func TestDesktopDeviceRejectsChangedIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(beewire.Identity{ID: "different", Name: "Mac", OwnerID: "owner", OwnerEmail: "a@b.test"})
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "desktop.json")
	saveState(path, localState{Hive: server.URL, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43), Identity: &beewire.Identity{ID: "original", OwnerID: "owner", OwnerEmail: "a@b.test", Name: "Mac"}})
	if _, err := (newDesktopTestDevice(t, path)).Status(context.Background()); err == nil {
		t.Fatal("accepted changed device ID")
	}
	state, _ := readState(path)
	if state.Identity.ID != "original" {
		t.Fatal("overwrote trusted identity")
	}
}

func TestDesktopDeviceRejectsUnsafePairingURL(t *testing.T) {
	for _, link := range []string{"https://other.example/devices/pair", "https://hive.example/devices/pair?code=bad", "https://hive.example/other", "javascript:alert(1)"} {
		t.Run(link, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					w.WriteHeader(401)
					return
				}
				json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: link, ExpiresAt: time.Now().Add(time.Minute), PollInterval: 2, Status: "pending"})
			}))
			defer server.Close()
			path := filepath.Join(t.TempDir(), "desktop.json")
			v, err := (newDesktopTestDevice(t, path)).Begin(context.Background(), server.URL, "Mac")
			if err != nil || v.Recovery == nil || v.Recovery.Phase != "creation_unknown" || v.Recovery.Pairing != nil {
				t.Fatalf("accepted untrusted verification URL: %+v %v", v, err)
			}
			state, _ := readState(path)
			if state.Pairing != nil {
				t.Fatal("persisted unsafe pairing")
			}
		})
	}
}

func TestDesktopDeviceLockConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop.json")
	unlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if _, err := (newDesktopTestDevice(t, path)).Status(context.Background()); err == nil {
		t.Fatal("ignored existing owner")
	}
}

func TestDesktopDeviceHiveExpiryAllowsExplicitNewCode(t *testing.T) {
	creates := 0
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/bee/identity":
			w.WriteHeader(401)
		case "GET /api/bee/pairings":
			w.WriteHeader(410)
			w.Write([]byte(`{"error":{"code":"pairing_expired"}}`))
		case "POST /api/bee/pairings":
			creates++
			json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("c", 43), UserCode: "JKLM-NPQR", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Minute), PollInterval: 2, Status: "pending"})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()
	origin = server.URL
	path := filepath.Join(t.TempDir(), "desktop.json")
	credential := "bee_" + strings.Repeat("b", 43)
	saveState(path, localState{Hive: origin, Name: "Mac", Credential: credential, Pairing: &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"}})
	device := newDesktopTestDevice(t, path)
	expired, err := device.Status(context.Background())
	if err != nil || expired.State != "expired" || creates != 0 {
		t.Fatalf("expiry: %+v %v", expired, err)
	}
	pending, err := device.Begin(context.Background(), origin, "Mac")
	if err != nil || pending.State != "pending" || creates != 1 {
		t.Fatalf("explicit new code: %+v %v creates=%d", pending, err, creates)
	}
	state, _ := readState(path)
	if state.Credential != credential {
		t.Fatal("rotated credential instead of preserving identity")
	}
}

func TestDesktopDeviceUncertainRedeemKeepsTransaction(t *testing.T) {
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			w.WriteHeader(401)
			return
		}
		if r.Method == "GET" {
			json.NewEncoder(w).Encode(beewire.Pairing{Status: "approved"})
			return
		}
		w.WriteHeader(503)
		w.Write([]byte(`{"error":{"code":"unavailable"}}`))
	}))
	defer server.Close()
	origin = server.URL
	path := filepath.Join(t.TempDir(), "desktop.json")
	original := localState{Hive: origin, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43), Pairing: &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"}}
	saveState(path, original)
	v, err := (newDesktopTestDevice(t, path)).Status(context.Background())
	if err != nil || v.Recovery == nil || v.Recovery.Phase != "redemption_unknown" || v.Recovery.Failure == nil || !strings.Contains(v.Recovery.Failure.Message, "unconfirmed") || !strings.Contains(v.Recovery.Failure.Message, "503") || !strings.Contains(v.Recovery.Failure.Message, "401") {
		t.Fatalf("lost failure evidence: %+v %v", v.Recovery, err)
	}
	actual, _ := readState(path)
	if actual.Credential != original.Credential || actual.Pairing.PairingToken != original.Pairing.PairingToken || actual.Identity != nil {
		t.Fatal("lost uncertain transaction")
	}
}

func TestDesktopDeviceUnknownExchangeCannotBeReplacedAfterExpiry(t *testing.T) {
	var origin string
	expired := false
	creates := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			w.WriteHeader(401)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/api/bee/pairings" {
			creates++
			w.WriteHeader(500)
			return
		}
		if expired {
			w.WriteHeader(410)
			w.Write([]byte(`{"error":{"code":"pairing_expired"}}`))
			return
		}
		if r.Method == "GET" {
			json.NewEncoder(w).Encode(beewire.Pairing{Status: "approved"})
			return
		}
		w.WriteHeader(503)
		w.Write([]byte(`{"error":{"code":"unavailable"}}`))
	}))
	defer server.Close()
	origin = server.URL
	path := filepath.Join(t.TempDir(), "desktop.json")
	saveState(path, localState{Hive: origin, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43), Pairing: &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("a", 43), UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"}})
	device := newDesktopTestDevice(t, path)
	if v, err := device.Status(context.Background()); err != nil || v.Recovery == nil || v.Recovery.Phase != "redemption_unknown" {
		t.Fatalf("unexpected confirmed exchange: %+v %v", v, err)
	}
	state, _ := readState(path)
	state.Pairing.ExpiresAt = time.Now().Add(-time.Minute)
	saveState(path, state)
	expired = true
	closeDesktopTestDevice(t, device)
	v, err := (newDesktopTestDevice(t, path)).Begin(context.Background(), origin, "Mac")
	if err != nil || v.Recovery == nil || v.Recovery.Phase != "redemption_unknown" || creates != 0 {
		t.Fatalf("replaced unknown transaction: creates=%d phase=%+v error=%v", creates, v.Recovery, err)
	}
	state, _ = readState(path)
	if state.Pairing == nil || state.Pairing.PairingToken != "beep_"+strings.Repeat("a", 43) {
		t.Fatal("lost original pairing transaction")
	}
}

func TestDesktopDeviceRedeemExpiryDistinguishesFirstAttemptFromUnknown(t *testing.T) {
	for _, previous := range []string{"pending", "redeeming"} {
		t.Run(previous, func(t *testing.T) {
			creates := 0
			var origin string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method + " " + r.URL.Path {
				case "GET /api/bee/identity":
					w.WriteHeader(401)
				case "GET /api/bee/pairings":
					json.NewEncoder(w).Encode(beewire.Pairing{Status: "approved"})
				case "POST /api/bee/pairings/redeem":
					w.WriteHeader(410)
					w.Write([]byte(`{"error":{"code":"pairing_expired"}}`))
				case "POST /api/bee/pairings":
					creates++
					json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("c", 43), UserCode: "JKLM-NPQR", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Minute), PollInterval: 2, Status: "pending"})
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			}))
			defer server.Close()
			origin = server.URL
			path := filepath.Join(t.TempDir(), "desktop.json")
			credential := "bee_" + strings.Repeat("b", 43)
			token := "beep_" + strings.Repeat("a", 43)
			if err := saveState(path, localState{Hive: origin, Name: "Mac", Credential: credential, Pairing: &beewire.Pairing{PairingToken: token, UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: previous}}); err != nil {
				t.Fatal(err)
			}
			device := newDesktopTestDevice(t, path)
			view, err := device.Status(context.Background())
			closeDesktopTestDevice(t, device)
			if previous == "pending" {
				if err != nil || view.State != "expired" {
					t.Fatalf("explicit first-attempt expiry became unknown: view=%+v error=%v", view, err)
				}
				state, _ := readState(path)
				if state.Pairing.Status != "pending" || !state.Pairing.ExpiresAt.IsZero() || creates != 0 {
					t.Fatal("first-attempt expiry not persisted without automatic creation")
				}
				restarted := newDesktopTestDevice(t, path)
				view, err = restarted.Status(context.Background())
				if err != nil || view.State != "expired" {
					t.Fatalf("restart lost known expiry: %+v %v", view, err)
				}
				view, err = restarted.Begin(context.Background(), origin, "Mac")
				if err != nil || view.State != "pending" || creates != 1 {
					t.Fatalf("explicit restart rejected: %+v %v creates=%d", view, err, creates)
				}
			} else {
				if err != nil || view.Recovery == nil || view.Recovery.Phase != "redemption_unknown" {
					t.Fatalf("prior unknown exchange cleared by later expiry: %+v %v", view, err)
				}
				if view, err = (newDesktopTestDevice(t, path)).Begin(context.Background(), origin, "Mac"); err != nil || view.Recovery == nil || view.Recovery.Phase != "redemption_unknown" || creates != 0 {
					t.Fatalf("prior unknown exchange replaced: creates=%d phase=%+v error=%v", creates, view.Recovery, err)
				}
				state, _ := readState(path)
				if state.Pairing.Status != "redeeming" || state.Pairing.PairingToken != token {
					t.Fatal("prior unknown transaction was not preserved")
				}
			}
			state, _ := readState(path)
			if state.Credential != credential || state.Identity != nil {
				t.Fatal("expiry changed device credential or invented identity")
			}
		})
	}
}

func TestDesktopDeviceRevokedCredentialWithoutCachedIdentityCannotRebind(t *testing.T) {
	creates := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			creates++
		}
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"code":"device_replaced"}}`))
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "desktop.json")
	saveState(path, localState{Hive: server.URL, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43)})
	_, err := (newDesktopTestDevice(t, path)).Begin(context.Background(), server.URL, "Mac")
	if err == nil || creates != 0 {
		t.Fatalf("attempted rebind of revoked device: creates=%d error=%v", creates, err)
	}
}

func TestDesktopDeviceRemoteErrorCannotEchoPairingToken(t *testing.T) {
	secret := "beep_" + strings.Repeat("a", 43)
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			w.WriteHeader(401)
			return
		}
		w.WriteHeader(500)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": secret}})
	}))
	defer server.Close()
	origin = server.URL
	path := filepath.Join(t.TempDir(), "desktop.json")
	saveState(path, localState{Hive: origin, Name: "Mac", Credential: "bee_" + strings.Repeat("b", 43), Pairing: &beewire.Pairing{PairingToken: secret, UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"}})
	v, err := (newDesktopTestDevice(t, path)).Status(context.Background())
	raw, _ := json.Marshal(v)
	if err != nil || v.Recovery == nil || v.Recovery.Failure == nil || strings.Contains(string(raw), secret) || !strings.Contains(v.Recovery.Failure.Message, "500") {
		t.Fatalf("unsafe remote result: %s %v", raw, err)
	}
}

// Context must remain local even when Hive rejects the saved device.
func TestDesktopDeviceContextRetainsRejectedBindingWithoutHiveRequests(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/bee/identity" {
			t.Errorf("revoked identity reached Hive write or contribution: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":{"code":"device_replaced"}}`)
	}))
	defer server.Close()
	d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
	state := localState{Hive: server.URL, Name: "Saved Mac", Credential: "bee_" + strings.Repeat("b", 43), Identity: &beewire.Identity{ID: "device", OwnerID: "owner", Name: "Saved Mac", OwnerEmail: "owner@example.test"}}
	if err := saveState(d.path, state); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Status(context.Background()); err == nil {
		t.Fatal("expected rejected identity")
	}
	method := reflect.ValueOf(d).MethodByName("Context")
	if !method.IsValid() {
		t.Fatal("device_context is unavailable during identity rejection")
	}
	read := func() map[string]any {
		result := method.Call([]reflect.Value{reflect.ValueOf(context.Background())})
		if !result[1].IsNil() {
			t.Fatal(result[1].Interface())
		}
		raw, _ := json.Marshal(result[0].Interface())
		var value map[string]any
		json.Unmarshal(raw, &value)
		if strings.Contains(string(raw), state.Credential) {
			t.Fatal("context leaked credential")
		}
		return value
	}
	before := calls
	first := read()
	second := read()
	if calls != before || first["hive"] != server.URL || first["device_id"] != "device" || first["owner_id"] != "owner" || first["binding_revision"] != second["binding_revision"] {
		t.Fatalf("local context rejected: %+v", first)
	}
	if _, err := d.SetPaused(context.Background(), "openai", false); err == nil {
		t.Fatal("revoked identity resumed Hive supply")
	}
	accounts := NewDesktopAccounts(d)
	defer accounts.Close()
	runtime := NewDesktopRuntime(context.Background(), d, accounts)
	defer runtime.Close()
	if _, err := runtime.Start(context.Background(), DesktopStartRequest{ExpectedRevision: 0, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	failed := waitRuntime(t, runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "failed" })
	if failed.Operation == nil || failed.Operation.Error == nil {
		t.Fatal("revoked identity contribution failure lost its evidence")
	}
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err = session.save(state); err != nil {
		t.Fatal(err)
	}
	if read()["binding_revision"] != first["binding_revision"] {
		t.Fatal("same binding save advanced revision")
	}
	state.Identity.ID = "replacement"
	if err = session.save(state); err != nil {
		t.Fatal(err)
	}
	if read()["binding_revision"].(float64) <= first["binding_revision"].(float64) {
		t.Fatal("changed binding retained revision")
	}
}

func TestDesktopDeviceContextDistinguishesAbsentAndCorruptLocalRecords(t *testing.T) {
	d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
	for _, value := range []struct{ raw, code string }{{"", "DEVICE_CONTEXT_UNCONFIGURED"}, {`{"bad":true}`, "DEVICE_CONTEXT_INVALID"}} {
		if value.raw != "" {
			if err := os.WriteFile(d.path, []byte(value.raw), 0600); err != nil {
				t.Fatal(err)
			}
		}
		_, err := d.Context(context.Background())
		failure, ok := err.(*DesktopFailure)
		if !ok || failure.Code != value.code || failure.Details == nil || failure.Details.Check != "device_context" {
			t.Fatalf("local record failure=%v required=%s", err, value.code)
		}
	}
}

func TestDesktopAccountsStartupVerificationNeverStartsRuntime(t *testing.T) {
	d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	method := reflect.ValueOf(r).MethodByName("VerifyStartup")
	if !method.IsValid() {
		t.Fatal("read-only startup verification is unavailable without Restore")
	}
	before, _ := r.Snapshot(context.Background())
	result := method.Call([]reflect.Value{reflect.ValueOf(context.Background())})
	if !result[0].IsNil() {
		t.Fatal(result[0].Interface())
	}
	after, _ := r.Snapshot(context.Background())
	if after.Local != "stopped" || after.Revision != before.Revision || after.Operation != nil {
		t.Fatal("startup verification changed runtime")
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"), []byte(`{"version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	if method.Call([]reflect.Value{reflect.ValueOf(context.Background())})[0].IsNil() {
		t.Fatal("corrupt account state passed verification")
	}
}

func TestDesktopDeviceContextFailuresKeepObservedBindingRevision(t *testing.T) {
	d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
	var previous int64
	for _, raw := range []string{"", `{"bad":true}`, `{"hive":"https://hive.example","name":"Mac","credential":"bee_` + strings.Repeat("a", 43) + `"}`, `{"bad":true}`} {
		if raw != "" {
			if err := os.WriteFile(d.path, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
		}
		value, _ := d.Context(context.Background())
		revision, _ := d.bindingRevision(context.Background())
		if value.BindingRevision != revision || revision <= previous {
			t.Fatalf("context revision=%d actual session=%d previous=%d", value.BindingRevision, revision, previous)
		}
		previous = revision
	}
}

func TestDesktopDeviceContextMetadataFailuresIncludeSafeFacts(t *testing.T) {
	valid := localState{Hive: "https://hive.example", Name: "Mac", Credential: "bee_" + strings.Repeat("a", 43)}
	tests := []struct {
		name                   string
		edit                   func(*localState)
		want, actual, required string
	}{
		{"credential", func(s *localState) { s.Credential = "SECRET-CREDENTIAL" }, "credential format", "format_valid=false", "bee_ followed by 43 URL-safe characters"},
		{"empty", func(s *localState) { s.Name = "  " }, "name is empty", "trimmed_characters=0", "nonempty device name"},
		{"length", func(s *localState) { s.Name = strings.Repeat("界", 81) }, "name length", "characters=81", "characters<=80"},
		{"controls", func(s *localState) { s.Name = "Mac\n" }, "name contains control", "control_present=true", "control_present=false"},
		{"origin_parse", func(s *localState) { s.Hive = "https://host:bad?token=SECRET-ORIGIN" }, "origin parse", "parsed=false", "valid HTTPS origin"},
		{"origin_host", func(s *localState) { s.Hive = "https:///SECRET-ORIGIN" }, "origin host missing", "host_present=false", "host_present=true"},
		{"origin_opaque", func(s *localState) { s.Hive = "https:SECRET-ORIGIN" }, "origin opaque", "opaque_present=true", "opaque_present=false"},
		{"origin_fragment", func(s *localState) { s.Hive = "https://hive.example#SECRET-ORIGIN" }, "origin fragment", "fragment_present=true", "fragment_present=false"},
		{"origin_auth", func(s *localState) { s.Hive = "https://user:SECRET-ORIGIN@hive.example" }, "origin credentials", "credentials_present=true", "credentials_present=false"},
		{"origin_query", func(s *localState) { s.Hive = "https://hive.example?token=SECRET-ORIGIN" }, "origin query", "query_present=true", "query_present=false"},
		{"origin_path", func(s *localState) { s.Hive = "https://hive.example/path/SECRET-ORIGIN" }, "origin path", "path_present=true", "empty origin path"},
		{"origin_slash", func(s *localState) { s.Hive = "https://hive.example/" }, "origin is not canonical", "canonical_match=false", "saved origin equals validated origin"},
		{"origin_http", func(s *localState) { s.Hive = "http://hive.example" }, "HTTP is allowed only for loopback", "secure_or_loopback=false", "HTTPS or loopback HTTP"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
			s := valid
			tc.edit(&s)
			if err := saveState(d.path, s); err != nil {
				t.Fatal(err)
			}
			_, err := d.Context(context.Background())
			var f *DesktopFailure
			if !errors.As(err, &f) || !strings.Contains(f.Message, tc.want) || !strings.Contains(f.Message, tc.actual) || !strings.Contains(f.Message, tc.required) || f.Details.Evidence["actual"] != tc.actual || f.Details.Evidence["required"] != tc.required || errors.Unwrap(f) == nil {
				t.Fatalf("failure lacks specific facts: %+v", f)
			}
			raw, _ := json.Marshal(f)
			if strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), s.Credential) {
				t.Fatalf("failure leaked secret: %s", raw)
			}
		})
	}
}
