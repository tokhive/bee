package bee

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// These are public errors returned by Hive ae6573b's Bee controllers,
// service/{accounts,connection,credential_maintenance,relay,capability_report,
// supply_events}.go and middleware/{response,security}.go. They intentionally
// exclude errors belonging only to browser, reseller or administrative routes.
func TestDesktopPreservesHiveBeeErrorContract(t *testing.T) {
	for _, scenario := range []struct {
		code   string
		status int
		path   string
	}{
		{"device_connected", 409, "/api/bee/agent"},
		{"forbidden", 403, "/api/bee/agent"},
		{"invalid_content_type", 415, "/api/bee/maintenance"},
		{"invalid_json", 400, "/api/bee/maintenance"},
		{"invalid_platform", 400, "/api/bee/platforms/unknown/account"},
		{"invalid_pause", 400, "/api/bee/platforms/openai"},
		{"invalid_confirmation", 400, "/api/bee/platforms/openai/account/confirm"},
		{"account_changed", 409, "/api/bee/platforms/openai/account/confirm"},
		{"invalid_lease", 400, "/api/bee/platforms/openai/account/source"},
		{"stale_connection", 409, "/api/bee/maintenance"},
		{"invalid_maintenance", 400, "/api/bee/maintenance"},
		{"tee_unavailable", 503, "/api/bee/credential-key"},
		{"stale_maintenance", 409, "/api/bee/maintenance"},
		{"invalid_authorization", 400, "/api/bee/credentials"},
		{"invalid_codex_authorization", 400, "/api/bee/credentials"},
		{"invalid_claude_authorization", 400, "/api/bee/credentials"},
		{"invalid_envelope", 400, "/api/bee/credentials"},
		{"codex_account_changed", 409, "/api/bee/credentials"},
		{"codex_authorization_rejected", 409, "/api/bee/credentials"},
		{"claude_confirmation_required", 409, "/api/bee/credentials"},
		{"claude_authorization_rejected", 409, "/api/bee/credentials"},
		{"invalid_capabilities", 400, "/api/bee/platforms/openai/capabilities"},
		{"stale_account", 409, "/api/bee/platforms/openai/capabilities"},
		{"capability_metadata_required", 409, "/api/bee/platforms/openai/capabilities"},
		{"stale_observation", 409, "/api/bee/platforms/openai/capabilities"},
		{"invalid_events", 400, "/api/bee/events"},
	} {
		code := scenario.code
		t.Run(code, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(scenario.status)
				kind := "invalid_request_error"
				if scenario.status == 403 {
					kind = "permission_error"
				} else if scenario.status >= 500 {
					kind = "server_error"
				}
				json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": "Hive rejected the operation", "type": kind, "param": nil}})
			}))
			defer server.Close()
			state := localState{Hive: server.URL, Credential: "synthetic-device-credential"}
			var output any
			err := desktopCall(context.Background(), state, scenario.path, http.MethodGet, state.Credential, nil, &output)
			var api *apiFailure
			var failure *DesktopFailure
			if !errors.As(err, &api) || api.Code != code || api.Status != scenario.status || !errors.As(err, &failure) || failure.Details.Evidence["remote_code"] != code {
				t.Fatalf("Hive public error lost: want=%q error=%v", code, err)
			}
			if err := failure.Details.Validate(); err != nil {
				t.Fatalf("Hive public error rejected by desktop contract: %v", err)
			}
			observation := observedConnectionFailure(api, nil, state, "/api/bee/maintenance", "synchronize")
			if observation.Evidence["remote_code"] != code {
				t.Fatalf("Hive synchronization evidence lost: want=%q actual=%+v", code, observation)
			}
		})
	}
}

func TestDesktopHiveConnectionConflictPreservesRealRemoteCode(t *testing.T) {
	// Hive service/connection.go returns this before upgrading an occupied
	// device. Exercise the WebSocket handshake response, not an invented code.
	response := &http.Response{StatusCode: http.StatusConflict, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"device_connected","message":"device already connected or Hive is shutting down","type":"invalid_request_error","param":null}}`))}
	failure := observedConnectionFailure(errors.New("WebSocket upgrade rejected"), response, localState{Hive: "https://hive.example"}, "/api/bee/agent", "connect")
	if failure.Evidence["remote_code"] != "device_connected" || failure.Evidence["http_status"] != "409" {
		t.Fatalf("Hive connection conflict lost: %+v", failure)
	}
}

func TestDesktopHiveUnknownErrorCodesRemainPrivate(t *testing.T) {
	for _, code := range []string{"new_unreviewed_error", "bee_syntheticcredential", "Bearer secret", "device_connected\nsecret"} {
		if got := safeCode(code); got != "unrecognized_code" {
			t.Fatalf("unreviewed remote code escaped: got=%q", got)
		}
	}
}
