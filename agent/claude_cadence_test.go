package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestClaudeIndependentReportIntervals(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
	var reports []map[string]json.RawMessage
	rejectMetadata := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/platforms/claude/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 3})
		case "/api/bee/maintenance":
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "claude", Status: "ready", Generation: 3}})
		case "/api/bee/platforms/claude/capabilities":
			var report map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
				t.Error(err)
			}
			reports = append(reports, report)
			if rejectMetadata {
				w.WriteHeader(409)
				io.WriteString(w, `{"error":{"code":"capability_metadata_required"}}`)
				return
			}
			w.WriteHeader(201)
		default:
			t.Error("unexpected request", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	models, usage := 0, 0
	unknown := false
	source := claudeSource{Capabilities: true, credential: credential, identity: identity, verifiedAt: time.Now(), read: func(context.Context) (claudeCredential, error) { return credential, nil }}
	source.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/models" {
			models++
			return claudeProfileResponse(200, claudeModelsFixture), nil
		}
		usage++
		if unknown {
			return claudeProfileResponse(200, `{}`), nil
		}
		raw, _ := json.Marshal(claudeQuotaFixture())
		return claudeProfileResponse(200, string(raw)), nil
	})
	state := localState{Hive: server.URL, Credential: "synthetic-bee"}
	sync := func(force bool) error {
		return source.synchronize(context.Background(), state, "lease", io.Discard, force)
	}
	due := func() {
		source.lastCapabilitySync = time.Now().Add(-5*time.Minute - time.Second)
		source.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
		source.capabilities.cachedAt = time.Now().Add(-5*time.Minute - time.Second)
	}
	check := func(count int, metadata bool) {
		t.Helper()
		if len(reports) != count {
			t.Fatalf("reports=%d want=%d", len(reports), count)
		}
		_, plan := reports[count-1]["plan"]
		_, model := reports[count-1]["models"]
		if plan != metadata || model != metadata {
			t.Fatalf("metadata presence plan=%v models=%v want=%v", plan, model, metadata)
		}
	}
	if err := sync(true); err != nil {
		t.Fatal(err)
	}
	check(1, true)
	source.lastCapabilitySync = time.Now().Add(-4 * time.Minute)
	source.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(1, true)
	due()
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(2, false)
	if models != 1 || usage != 2 {
		t.Fatalf("models=%d usage=%d", models, usage)
	}
	due()
	source.capabilities.metadataAt = time.Now().Add(-5 * time.Hour)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(3, true)
	if models != 2 || usage != 3 {
		t.Fatalf("models=%d usage=%d", models, usage)
	}
	due()
	rejectMetadata = true
	if err := sync(false); err == nil {
		t.Fatal("missing metadata accepted")
	}
	check(4, false)
	rejectMetadata = false
	source.lastCapabilityAttempt = time.Now().Add(-11 * time.Second)
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(5, true)
	// Unknown usage removes the server's ready snapshot; recovery must include metadata.
	due()
	unknown = true
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	unknown = false
	due()
	if err := sync(false); err != nil {
		t.Fatal(err)
	}
	check(7, true)
	if err := sync(true); err != nil {
		t.Fatal(err)
	}
	check(8, true)
}
