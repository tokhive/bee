package bee

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
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
			if evidence["target_origin"] != server.URL || evidence["remote_code"] != code || evidence["failure_kind"] != "http_rejected" || !strings.Contains(evidence["response_body"].(string), "upstream maintenance") {
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

func TestDesktopRequestRetryCategoriesUseTypedEvidence(t *testing.T) {
	for _, tc := range []struct {
		name  string
		cause error
		code  string
	}{
		{"timeout", context.DeadlineExceeded, "timeout"},
		{"temporary_dns", &net.DNSError{Err: "temporary", IsTemporary: true}, "dns_temporary"},
		{"permanent_dns", &net.DNSError{Err: "not found", IsNotFound: true}, "dns_failed"},
		{"reset", fmt.Errorf("read: %w", syscall.ECONNRESET), "connection_closed"},
		{"eof", io.EOF, "connection_closed"},
		{"unexpected_eof", io.ErrUnexpectedEOF, "connection_closed"},
		{"wrapped_unexpected_eof", &url.Error{Op: "Get", URL: "https://hive.example/api/bee/identity", Err: fmt.Errorf("read response: %w", io.ErrUnexpectedEOF)}, "connection_closed"},
		{"refused", syscall.ECONNREFUSED, "connection_refused"},
		{"tls", x509.UnknownAuthorityError{}, "tls_failed"},
		{"text_is_not_evidence", errors.New("timeout connection reset"), "unknown_failure"},
		{"eof_text_is_not_evidence", errors.New("unexpected EOF"), "unknown_failure"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := desktopRequestFailure(localState{Hive: "https://hive.example"}, "/api/bee/identity", "device_identity", tc.cause, 0, nil)
			var failure *DesktopFailure
			if !errors.As(err, &failure) || failure.Code != tc.code {
				t.Fatalf("got %v, want code %s", err, tc.code)
			}
		})
	}
}

func TestDesktopHTTPTruncatedResponseCanRecoverWithoutReplaying(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.Close()
			io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 128\r\n\r\n{\"id\":")
			return
		}
		io.WriteString(w, `{"id":"recovered"}`)
	}))
	defer server.Close()
	state := localState{Hive: server.URL}
	var output map[string]string
	err := desktopCall(context.Background(), state, "/api/bee/identity", http.MethodGet, "", nil, &output)
	var failure *DesktopFailure
	if !errors.Is(err, io.ErrUnexpectedEOF) || !errors.As(err, &failure) || failure.Code != "connection_closed" || failure.Details.Evidence["failure_kind"] != "connection_closed" {
		t.Fatalf("truncated HTTP response must retain typed EOF and be retryable: %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("HTTP helper replayed the request: requests=%d; required=1", requests.Load())
	}
	if err := desktopCall(context.Background(), state, "/api/bee/identity", http.MethodGet, "", nil, &output); err != nil || output["id"] != "recovered" || requests.Load() != 2 {
		t.Fatalf("fresh read did not recover: output=%v requests=%d error=%v", output, requests.Load(), err)
	}
}

func TestDesktopAccountFailureRetainsHTTPObservationTime(t *testing.T) {
	err := desktopHTTPFailure(localState{Hive: "https://hive.example"}, "/api/bee/identity", "device_identity", http.MethodGet, time.Now(), io.ErrUnexpectedEOF, 0, nil, "")
	request := err.(*DesktopFailure)
	failure := hiveAccountError("openai", "identity", err)
	if failure.Evidence["observed_at"] != request.Details.ObservedAt {
		t.Fatalf("account failure lost HTTP observation time: actual=%q required=%q", failure.Evidence["observed_at"], request.Details.ObservedAt)
	}
}

func TestDesktopHTTPRetryAfterIsPreservedOnlyForRateLimit(t *testing.T) {
	for _, tc := range []struct {
		value  string
		status int
		valid  bool
	}{
		{"45", 429, true}, {time.Now().UTC().Add(time.Minute).Format(http.TimeFormat), 429, true},
		{"-1", 429, false}, {"1.5", 429, false}, {"2147483648", 429, false}, {"untrusted", 429, false}, {"45", 503, false},
	} {
		t.Run(fmt.Sprint(tc.status)+tc.value, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Retry-After", tc.value)
				w.WriteHeader(tc.status)
				w.Write([]byte(`{"error":{"code":"unavailable"}}`))
			}))
			defer server.Close()
			state := localState{Hive: server.URL}
			for _, supply := range []bool{false, true} {
				var err error
				if supply {
					_, err = desktopSupplyCall(context.Background(), state, "openai", nil)
				} else {
					var output any
					err = desktopCall(context.Background(), state, "/api/bee/identity", http.MethodGet, "", nil, &output)
				}
				var failure *DesktopFailure
				if !errors.As(err, &failure) {
					t.Fatalf("missing failure: %v", err)
				}
				_, present := failure.Details.Evidence["retry_after_seconds"]
				if present != tc.valid {
					t.Fatalf("Retry-After evidence=%v want present=%t", failure.Details.Evidence, tc.valid)
				}
				if failure.Details.Evidence["method"] != "GET" || failure.Details.Evidence["phase"] != "http_error" || failure.Details.Evidence["elapsed_ms"] == "" {
					t.Fatalf("missing phase timing: %v", failure.Details.Evidence)
				}
				if err := failure.Details.Validate(); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestAccountHiveFailureRetainsRetryClassification(t *testing.T) {
	cause := desktopHTTPFailure(localState{Hive: "https://hive.example"}, "/api/bee/identity", "device_identity", http.MethodGet, time.Now(), &apiFailure{Status: 429, Code: "rate_limited"}, 429, nil, "45")
	failure := hiveAccountError("openai", "identity", cause)
	if failure.Code != "rate_limited" || failure.Evidence["http_status"] != "429" || failure.Evidence["retry_after_seconds"] != "45" || failure.Evidence["failure_kind"] != "http_rejected" {
		t.Fatalf("account dropped safe retry facts: %+v", failure)
	}
}

func TestDesktopHTTPDiagnosticsRecordSafeStageTimes(t *testing.T) {
	var events []DesktopDiagnosticEvent
	ctx := WithDesktopRequestDiagnostics(context.Background(), func(event DesktopDiagnosticEvent) { events = append(events, event) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		w.Write([]byte(`{"error":{"code":"unavailable","message":"token=SECRET"}}`))
	}))
	defer server.Close()
	var out any
	_ = desktopCall(ctx, localState{Hive: server.URL}, "/api/bee/identity", http.MethodGet, "SECRET", nil, &out)
	if len(events) != 2 || events[0].Code != "request_http_started" || events[1].Code != "request_http_failed" || events[1].Evidence["http_status"] != "503" || events[1].Evidence["failure_kind"] != "http_rejected" {
		t.Fatalf("events=%+v", events)
	}
	for _, event := range events {
		raw, _ := json.Marshal(event)
		if strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), "response_body") {
			t.Fatalf("private event: %s", raw)
		}
	}
}
