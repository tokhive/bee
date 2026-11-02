package bee

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopFailurePreservesHTTPFactsAndTypedCause(t *testing.T) {
	for _, status := range []int{401, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			code := "unavailable"
			if status == 401 {
				code = "device_replaced"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte(`{"error":{"code":"` + code + `","message":"upstream maintenance; token=TOP_SECRET; https://hive.example/failure?secret=URL_SECRET"}}`))
			}))
			defer server.Close()
			state := localState{Hive: server.URL, Credential: "TOP_SECRET"}
			var output any
			err := desktopCall(context.Background(), state, "/api/bee/identity", "GET", state.Credential, nil, &output)
			if err == nil {
				t.Fatal("expected HTTP failure")
			}
			var api *apiFailure
			if !errors.As(err, &api) || api.Status != status || api.Code != code {
				t.Fatalf("typed cause lost: %v", err)
			}
			raw, _ := json.Marshal(err)
			var value map[string]any
			json.Unmarshal(raw, &value)
			if value["code"] != code {
				t.Fatalf("machine reason lost: %s", raw)
			}
			details, ok := value["details"].(map[string]any)
			if !ok || details["check"] != "device_identity" {
				t.Fatalf("check lost: %s", raw)
			}
			evidence, _ := details["evidence"].(map[string]any)
			if evidence["target_origin"] != server.URL || evidence["remote_code"] != code || !strings.Contains(evidence["response_body"].(string), "upstream maintenance") {
				t.Fatalf("HTTP evidence lost: %s", raw)
			}
			if strings.Contains(string(raw), "TOP_SECRET") || strings.Contains(string(raw), "URL_SECRET") {
				t.Fatalf("secret leaked: %s", raw)
			}
			var roundtrip struct {
				Details *DesktopFailureDetails `json:"details"`
			}
			if err := json.Unmarshal(raw, &roundtrip); err != nil || roundtrip.Details == nil {
				t.Fatalf("projected production failure cannot be decoded: %v; raw=%s", err, raw)
			}
		})
	}
}

func TestDesktopFailureSupplyPreservesRemoteRejection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		w.Write([]byte(`{"error":{"code":"unavailable","message":"maintenance"}}`))
	}))
	defer server.Close()
	_, err := desktopSupplyCall(context.Background(), localState{Hive: server.URL, Credential: "secret"}, "openai", nil)
	var api *apiFailure
	if !errors.As(err, &api) || api.Status != 503 {
		t.Fatalf("supply HTTP cause missing: %v", err)
	}
	raw, _ := json.Marshal(err)
	if !strings.Contains(string(raw), `"check":"supply_read"`) || !strings.Contains(string(raw), "maintenance") {
		t.Fatalf("supply evidence missing: %s", raw)
	}
}

func TestDesktopFailureDetailsRejectInvalidAndDuplicateEvidence(t *testing.T) {
	good := `{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"http_status":"503"}}`
	var details DesktopFailureDetails
	if err := json.Unmarshal([]byte(good), &details); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		`{"check":"device_identity","observed_at":"2026-02-30T00:00:00Z","evidence":{}}`,
		`{"check":"device_identity","observed_at":"2099-01-01T00:00:00Z","evidence":{}}`,
		`{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"token":"secret"}}`,
		`{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"actual":"Bearer SECRET"}}`,
		`{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{},"unknown":true}`,
		`{"check":"device_identity","check":"supply_read","observed_at":"2026-10-30T12:00:00Z","evidence":{}}`,
		`{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"actual":"one","actual":"two"}}`,
	} {
		if err := json.Unmarshal([]byte(bad), &details); err == nil {
			t.Fatalf("unsafe details accepted: %s", bad)
		}
	}
}

func TestDesktopFailureOversizedResponseReportsObservedLength(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		w.Write([]byte(strings.Repeat("x", 65537)))
	}))
	defer server.Close()
	var out any
	err := desktopCall(context.Background(), localState{Hive: server.URL}, "/api/bee/identity", "GET", "", nil, &out)
	if err == nil || !strings.Contains(err.Error(), "65537") || !strings.Contains(err.Error(), "65536") {
		t.Fatalf("observed response limit omitted: %v", err)
	}
}

func TestDesktopFailureWithoutRemoteCodeStillHasValidDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	var output any
	err := desktopCall(context.Background(), localState{Hive: server.URL}, "/api/bee/identity", "GET", "", nil, &output)
	var failure *DesktopFailure
	if !errors.As(err, &failure) {
		t.Fatal("missing structured failure")
	}
	if e := failure.Details.Validate(); e != nil {
		t.Fatal(e)
	}
}
