package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// Hive ae6573b service/credential_maintenance.go schedules an OpenAI refresh
// before expiry only when refresh_required is true. Without that request a
// changed plan keeps producing unknown capabilities until token expiry.
func TestOpenAIPlanChangeRequestsHiveMaintenanceBeforeTokenExpiry(t *testing.T) {
	for _, scenario := range []struct {
		name, usagePlan string
		refuseRefresh   bool
		rotateToken     bool
		restart         bool
		want            []bool
	}{
		{name: "changed", usagePlan: "free", want: []bool{false, true, false}},
		{name: "unchanged", usagePlan: "pro", want: []bool{false, false, false}},
		{name: "request rejected", usagePlan: "free", refuseRefresh: true, want: []bool{false, true, true}},
		{name: "source token changed", usagePlan: "free", rotateToken: true, want: []bool{false, false, true}},
		{name: "restart requires new observation", usagePlan: "free", restart: true, want: []bool{false, true, false}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
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
			cfg := egressConfig{Codex: &codexSource{Home: directory, Store: "file"}, Capabilities: &capabilitySource{transport: &openaiControlFixture{plan: scenario.usagePlan}}}
			var requests []bool
			rejected := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/bee/platforms/openai/account":
					json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1})
				case "/api/bee/maintenance":
					var request beewire.MaintenanceRequest
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
					}
					requests = append(requests, request.RefreshRequired)
					if request.RefreshRequired && scenario.refuseRefresh && !rejected {
						rejected = true
						w.WriteHeader(409)
						io.WriteString(w, `{"error":{"code":"stale_maintenance","message":"authorization version changed; read account state again","type":"invalid_request_error","param":null}}`)
						return
					}
					// No task means no OAuth refresh or writeback is authorized.
					json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1}})
				case "/api/bee/platforms/openai/capabilities":
					var report beewire.CapabilityReport
					json.NewDecoder(r.Body).Decode(&report)
					if scenario.usagePlan != "pro" && report.Status != "unknown" {
						t.Errorf("changed plan became dispatchable before refreshed authorization: %s", report.Status)
					}
					w.WriteHeader(201)
					io.WriteString(w, `{"status":"registered"}`)
				default:
					t.Errorf("unexpected write or request: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			for i := 0; i < 3; i++ {
				if scenario.rotateToken && i == 1 {
					claims["jti"] = "synthetic-new-revision"
					token, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("synthetic-key"))
					if err != nil {
						t.Fatal(err)
					}
					raw, _ = json.Marshal(map[string]any{"tokens": map[string]string{"access_token": token, "id_token": token, "account_id": "synthetic-account"}})
					if err := os.WriteFile(filepath.Join(directory, "auth.json"), raw, 0600); err != nil {
						t.Fatal(err)
					}
				}
				if scenario.restart && i == 2 {
					cfg = egressConfig{Codex: &codexSource{Home: directory, Store: "file"}, Capabilities: &capabilitySource{transport: &openaiControlFixture{plan: scenario.usagePlan}}}
				}
				err := cfg.synchronize(context.Background(), localState{Hive: server.URL}, "synthetic-lease", io.Discard, true)
				if err != nil && !(scenario.refuseRefresh && i == 1) {
					t.Fatalf("cycle=%d: %v", i, err)
				}
			}
			if !reflect.DeepEqual(requests, scenario.want) {
				t.Fatalf("Hive refresh_required sequence=%v; required=%v", requests, scenario.want)
			}
			stored, err := os.ReadFile(filepath.Join(directory, "auth.json"))
			if err != nil || string(stored) != string(raw) {
				t.Fatalf("maintenance without a task changed official credentials: %v", err)
			}
		})
	}
}

func TestOpenAIPlanRefreshIsBoundedByAuthorizationRevisionAndTime(t *testing.T) {
	credential := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "pro", ExpiresAt: time.Now().Add(8 * time.Hour)}
	revision := credential.metadata().CredentialRevision
	source := &capabilitySource{transport: &openaiControlFixture{plan: "free"}}
	if result := source.observe(context.Background(), credential, 1); result.Status != "unknown" {
		t.Fatalf("plan mismatch accepted: status=%s", result.Status)
	}
	now := time.Now()
	if !source.wantsRefresh(revision, now) || source.wantsRefresh("another-revision", now) {
		t.Fatal("plan refresh is not bound to the observed authorization revision")
	}
	source.askedRefresh(revision, now)
	if source.wantsRefresh(revision, now.Add(2*time.Hour)) {
		t.Fatal("the same token requested a second refresh")
	}
	credential.Secret.Token = "synthetic-refreshed-access"
	newRevision := credential.metadata().CredentialRevision
	source.observe(context.Background(), credential, 2)
	for _, at := range []struct {
		delta time.Duration
		want  bool
	}{{time.Hour - time.Nanosecond, false}, {time.Hour, true}, {time.Hour + time.Nanosecond, true}} {
		if got := source.wantsRefresh(newRevision, now.Add(at.delta)); got != at.want {
			t.Fatalf("refresh throttle at %s: got=%t required=%t", at.delta, got, at.want)
		}
	}
	source.transport = &openaiControlFixture{plan: "pro"}
	if result := source.observe(context.Background(), credential, 3); result.Status != "ready" || source.wantsRefresh(newRevision, now.Add(2*time.Hour)) {
		t.Fatalf("matching plans retained a refresh request: status=%s", result.Status)
	}
	// Missing single-window plan metadata is insufficient evidence of a plan
	// change, and a failed query must not reuse an earlier disagreement.
	credential.Plan = "free"
	source.transport = &openaiControlFixture{}
	if result := source.observe(context.Background(), credential, 4); result.Status != "unknown" || source.wantsRefresh(newRevision, now.Add(2*time.Hour)) {
		t.Fatalf("missing plan requested refresh: status=%s", result.Status)
	}
	source.transport = &openaiControlFixture{plan: "pro", fail: true}
	source.observe(context.Background(), credential, 5)
	if source.wantsRefresh(newRevision, now.Add(2*time.Hour)) {
		t.Fatal("failed usage query requested a refresh")
	}
	var absent *capabilitySource
	if absent.wantsRefresh(revision, now) {
		t.Fatal("disabled capability observation requested a refresh")
	}
}
