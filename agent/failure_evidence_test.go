package bee

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHiveFailurePreservesResponseEvidence(t *testing.T) {
	for _, body := range []string{`{"error":{"code":"tee_unavailable","message":"TEE inbox public key not configured"}}`, `upstream unavailable: connection refused`} {
		t.Run(body[:8], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503); io.WriteString(w, body) }))
			defer server.Close()
			err := call(context.Background(), server.Client(), server.URL, "/api/bee/maintenance", "POST", "synthetic-device-secret", nil, nil)
			if err == nil || !strings.Contains(err.Error(), body) || !strings.Contains(err.Error(), "503") {
				t.Fatalf("missing response evidence: %v", err)
			}
			var api *apiFailure
			if !errors.As(err, &api) || api.Status != 503 {
				t.Fatalf("lost typed API failure: %v", err)
			}
		})
	}
}

func TestHiveFailureRedactsEchoedSecrets(t *testing.T) {
	const secret = "fixture-bearer-value"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		io.WriteString(w, `{"error":{"code":"tee_unavailable","message":"dial refused, credential=`+secret+`","access_token":"other-fixture-secret"}}`)
	}))
	defer server.Close()
	err := call(context.Background(), server.Client(), server.URL, "/api/bee/maintenance", "POST", secret, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "dial refused") {
		t.Fatalf("lost failure cause: %v", err)
	}
	for _, secret := range []string{secret, "other-fixture-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatal("secret leaked")
		}
	}
}

func TestOfficialTransportPreservesSafeCauseAndType(t *testing.T) {
	cause := &net.DNSError{Err: "no such host", Name: "chatgpt.com", IsNotFound: true}
	transport := &officialObservationTransport{base: claudeTransport(func(*http.Request) (*http.Response, error) { return nil, cause })}
	req, _ := http.NewRequest("GET", "https://chatgpt.com/backend-api/codex/models", nil)
	_, err := transport.RoundTrip(req)
	var dns *net.DNSError
	if !errors.As(err, &dns) || !strings.Contains(err.Error(), "no such host") {
		t.Fatalf("lost network evidence: %v", err)
	}
}

func TestFailureEvidenceSanitizesStructuredAndPlainResponses(t *testing.T) {
	for _, body := range []string{
		`{"error":{"message":"dial refused","details":{"refresh_token":"refresh-MARKER","private_key":"key-MARKER","email":"person-MARKER@example.com"}}}`,
		`dial refused; password=pass-MARKER; url=https://user:pass-MARKER@proxy.example/connect?token=query-MARKER`,
		"dial refused; login=/Users/person-MARKER/.codex/auth.json",
	} {
		safe := safeResponseBody([]byte(body))
		if strings.Contains(safe, "MARKER") || !strings.Contains(safe, "dial refused") {
			t.Fatalf("unsafe or lost evidence: %q", safe)
		}
	}
}
func TestHiveFailureBoundsResponseAndRecordsTruncation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(502)
		fmt.Fprint(w, "gateway upstream timeout "+strings.Repeat("x", 70000))
	}))
	defer server.Close()
	err := call(context.Background(), server.Client(), server.URL, "/api/bee/maintenance", "POST", "", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "gateway upstream timeout") || !strings.Contains(err.Error(), "truncated:") || len(err.Error()) > 32768 {
		t.Fatalf("missing bounded evidence: bytes=%d err=%.200s", len(err.Error()), err)
	}
}

func TestFailureEvidenceRetainsCodeAndNumberPrecision(t *testing.T) {
	body := `{"error":{"code":"stale_reseller_key","message":"key expired","revision":9007199254740993}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(409); io.WriteString(w, body) }))
	defer server.Close()
	err := call(context.Background(), server.Client(), server.URL, "/api/bee/maintenance", "POST", "", nil, nil)
	var api *apiFailure
	if !errors.As(err, &api) || api.Code != "stale_reseller_key" || !strings.Contains(err.Error(), "9007199254740993") {
		t.Fatalf("lost recovery code or exact evidence: %v", err)
	}
}

func TestFailureEvidenceSanitizesIncompleteSecrets(t *testing.T) {
	for _, body := range []string{
		`upstream failed; {"refresh_token":"secret-MARKER`,
		`upstream failed; cookie="session-MARKER; other=value`,
		"upstream failed; -----BEGIN PRIVATE KEY-----\nsecret-MARKER",
		`upstream failed; client_secret='secret-MARKER`,
		`upstream failed; https://user:secret@proxy.example/connect?private=URL-MARKER`,
	} {
		safe := safeResponseBody([]byte(body))
		if strings.Contains(safe, "MARKER") || !strings.Contains(safe, "upstream failed") {
			t.Fatalf("unsafe incomplete evidence: %q", safe)
		}
	}
}
