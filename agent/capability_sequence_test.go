package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tokhive/bee/beewire"
)

// Hive keeps a platform's newest capability report per connection and refuses
// one whose sequence is not above it. Removing a desktop account and adding it
// back builds a new source on the connection already open; its reports must
// still be accepted without Bee reconnecting.
func TestCapabilityReportsStayAcceptedAfterAnAccountIsAddedAgain(t *testing.T) {
	directory := t.TempDir()
	claims := jwt.MapClaims{"exp": time.Now().Add(8 * time.Hour).Unix(), "https://api.openai.com/auth": map[string]string{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "pro"}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("synthetic-key"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"tokens": map[string]string{"access_token": token, "id_token": token, "account_id": "synthetic-account"}})
	if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	newest := map[string]int64{}
	accepted, refused := 0, 0
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1})
		case "/api/bee/maintenance":
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1}})
		case "/api/bee/platforms/openai/capabilities":
			var report beewire.CapabilityReport
			json.NewDecoder(r.Body).Decode(&report)
			mu.Lock()
			defer mu.Unlock()
			// The same rule as Hive's upsert: within one lease, only a
			// higher sequence replaces the stored report.
			if report.Sequence <= newest[report.Lease] {
				refused++
				w.WriteHeader(http.StatusConflict)
				io.WriteString(w, `{"error":{"code":"stale_observation","message":"capability snapshot updated","type":"invalid_request_error","param":null}}`)
				return
			}
			newest[report.Lease] = report.Sequence
			accepted++
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"status":"registered"}`)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer hive.Close()
	source := func() *egressConfig {
		return &egressConfig{Codex: &codexSource{Home: directory, Store: "file"}, Capabilities: &capabilitySource{transport: &openaiControlFixture{plan: "pro"}}}
	}
	first := source()
	for cycle := 0; cycle < 3; cycle++ {
		if err := first.synchronize(context.Background(), localState{Hive: hive.URL}, "open-lease", io.Discard, true); err != nil {
			t.Fatalf("first source, cycle %d: %v", cycle, err)
		}
	}
	// Removed and added back while the connection stays open.
	again := source()
	if err := again.synchronize(context.Background(), localState{Hive: hive.URL}, "open-lease", io.Discard, true); err != nil {
		t.Fatalf("account added again: %v", err)
	}
	if refused != 0 || accepted != 4 {
		t.Fatalf("Hive accepted %d reports and refused %d; want 4 accepted", accepted, refused)
	}
}
