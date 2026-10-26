package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
			if _, err := (newDesktopTestDevice(t, path)).Begin(context.Background(), server.URL, "Mac"); err == nil {
				t.Fatal("accepted untrusted verification URL")
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
	_, err := (newDesktopTestDevice(t, path)).Status(context.Background())
	if err == nil || !strings.Contains(err.Error(), "unconfirmed") || !strings.Contains(err.Error(), "503") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("lost failure evidence: %v", err)
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
	if _, err := device.Status(context.Background()); err == nil {
		t.Fatal("unexpected confirmed exchange")
	}
	state, _ := readState(path)
	state.Pairing.ExpiresAt = time.Now().Add(-time.Minute)
	saveState(path, state)
	expired = true
	closeDesktopTestDevice(t, device)
	_, err := (newDesktopTestDevice(t, path)).Begin(context.Background(), origin, "Mac")
	if err == nil || creates != 0 {
		t.Fatalf("replaced unknown transaction: creates=%d error=%v", creates, err)
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
				if err == nil || !strings.Contains(err.Error(), "unconfirmed") {
					t.Fatalf("prior unknown exchange cleared by later expiry: %+v %v", view, err)
				}
				if _, err = (newDesktopTestDevice(t, path)).Begin(context.Background(), origin, "Mac"); err == nil || creates != 0 {
					t.Fatalf("prior unknown exchange replaced: creates=%d error=%v", creates, err)
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
	_, err := (newDesktopTestDevice(t, path)).Status(context.Background())
	if err == nil || strings.Contains(err.Error(), secret) || !strings.Contains(err.Error(), "500") {
		t.Fatalf("unsafe remote error: %v", err)
	}
}
