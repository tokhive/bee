package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// officialHive records what a Bee registers and reports for official keys.
type officialHive struct {
	mu         sync.Mutex
	inbox      tee.InboxPublic
	registered []beewire.CredentialRegistration
	reports    map[string][]beewire.OfficialAPIStatus
}

func (h *officialHive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch r.URL.Path {
	case "/api/bee/credential-key":
		json.NewEncoder(w).Encode(h.inbox)
	case "/api/bee/credentials":
		var input beewire.CredentialRegistration
		json.NewDecoder(r.Body).Decode(&input)
		h.registered = append(h.registered, input)
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"status":"registered"}`)
	case "/api/bee/openai-api/status", "/api/bee/claude-api/status", "/api/bee/gemini-api/status":
		var input beewire.OfficialAPIStatus
		json.NewDecoder(r.Body).Decode(&input)
		h.reports[r.URL.Path] = append(h.reports[r.URL.Path], input)
		io.WriteString(w, `{"status":"reported"}`)
	default:
		http.NotFound(w, r)
	}
}

func TestClaudeAPISynchronization(t *testing.T) {
	inbox, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal(err)
	}
	hive := &officialHive{inbox: inbox.Public(), reports: map[string][]beewire.OfficialAPIStatus{}}
	server := httptest.NewServer(hive)
	defer server.Close()
	// The Claude listing is paged and names an older alias by its snapshot.
	var pages []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("X-Api-Key") != "sk-ant-platform" || r.Header.Get("Anthropic-Version") != "2023-06-01" || r.Header.Get("Authorization") != "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		pages = append(pages, r.URL.RawQuery)
		if r.URL.Query().Get("after_id") == "" {
			io.WriteString(w, `{"data":[{"id":"claude-opus-5-5"},{"id":"claude-unselected"}],"has_more":true,"last_id":"claude-unselected"}`)
			return
		}
		io.WriteString(w, `{"data":[{"id":"claude-haiku-4-5-20251001"},{"id":"claude-sonnet-4-5-not-a-date"}],"has_more":false,"last_id":"claude-sonnet-4-5-not-a-date"}`)
	}))
	defer upstream.Close()
	cfg := &egressConfig{
		Targets:    []string{"127.0.0.1:1"},
		InboxKeyID: "",
		ClaudeAPI:  &officialAPISource{KeyFile: writeKey(t, "sk-ant-platform", 0600), Models: []string{"claude-opus-5-5", "claude-haiku-4-5", "claude-sonnet-4-5"}, LocalURL: upstream.URL},
	}
	cfg.ClaudeAPI.platform = &claudeAPI
	if err := cfg.ClaudeAPI.validate(); err != nil {
		t.Fatal(err)
	}
	state := localState{Hive: server.URL, Credential: "device-secret", Identity: &beewire.Identity{ID: "device-1"}}
	var out strings.Builder
	if err := cfg.synchronizeClaudeAPI(context.Background(), state, "lease-1", &out, true); err != nil {
		t.Fatal(err)
	}
	if len(hive.registered) != 1 {
		t.Fatalf("registered %d times", len(hive.registered))
	}
	registration := hive.registered[0]
	if registration.ClaudeAPI == nil || registration.OpenAIAPI != nil || registration.ClaudeAPI.KeyFingerprint != fingerprint("sk-ant-platform") {
		t.Fatalf("registration: %+v", registration)
	}
	opened, provider, err := inbox.Open(registration.Envelope)
	if err != nil || provider != beewire.ProviderID("device-1") || opened.Header != "x-api-key" || opened.Scheme != "" || opened.Token != "sk-ant-platform" {
		t.Fatalf("envelope does not carry the key in x-api-key: %+v %v", opened.Header, err)
	}
	reports := hive.reports["/api/bee/claude-api/status"]
	if len(reports) != 1 || !reports[0].Ready || strings.Join(reports[0].Models, ",") != "claude-opus-5-5,claude-haiku-4-5" {
		t.Fatalf("report: %+v", reports)
	}
	if len(pages) != 2 || !strings.Contains(pages[1], "after_id=claude-unselected") {
		t.Fatalf("pages: %v", pages)
	}
	if len(hive.reports["/api/bee/openai-api/status"]) != 0 {
		t.Fatal("a Claude key reported as an OpenAI key")
	}
}

func TestGeminiAPISynchronization(t *testing.T) {
	inbox, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal(err)
	}
	hive := &officialHive{inbox: inbox.Public(), reports: map[string][]beewire.OfficialAPIStatus{}}
	server := httptest.NewServer(hive)
	defer server.Close()
	// Google names each model "models/<id>" and pages with a token.
	var pages []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models" || r.Header.Get("X-Goog-Api-Key") != "AIza-studio-key" || r.Header.Get("Authorization") != "" || r.URL.Query().Get("key") != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		pages = append(pages, r.URL.RawQuery)
		if r.URL.Query().Get("pageToken") == "" {
			io.WriteString(w, `{"models":[{"name":"models/gemini-4-neon"},{"name":"models/gemini-embedding-2"}],"nextPageToken":"page-2"}`)
			return
		}
		io.WriteString(w, `{"models":[{"name":"models/gemini-4-argon"},{"name":"models/gemini-4-argon-preview"}]}`)
	}))
	defer upstream.Close()
	cfg := &egressConfig{
		Targets:   []string{"127.0.0.1:1"},
		GeminiAPI: &officialAPISource{KeyFile: writeKey(t, "AIza-studio-key", 0600), Models: []string{"gemini-4-neon", "gemini-4-argon", "gemini-4-carbon"}, LocalURL: upstream.URL},
	}
	cfg.GeminiAPI.platform = &geminiAPI
	if err := cfg.GeminiAPI.validate(); err != nil {
		t.Fatal(err)
	}
	state := localState{Hive: server.URL, Credential: "device-secret", Identity: &beewire.Identity{ID: "device-1"}}
	var out strings.Builder
	if err := cfg.synchronizeGeminiAPI(context.Background(), state, "lease-1", &out, true); err != nil {
		t.Fatal(err)
	}
	if len(hive.registered) != 1 {
		t.Fatalf("registered %d times", len(hive.registered))
	}
	registration := hive.registered[0]
	if registration.GeminiAPI == nil || registration.ClaudeAPI != nil || registration.OpenAIAPI != nil || registration.GeminiAPI.KeyFingerprint != fingerprint("AIza-studio-key") {
		t.Fatalf("registration: %+v", registration)
	}
	opened, provider, err := inbox.Open(registration.Envelope)
	if err != nil || provider != beewire.ProviderID("device-1") || opened.Header != "x-goog-api-key" || opened.Scheme != "" || opened.Token != "AIza-studio-key" {
		t.Fatalf("envelope does not carry the key in x-goog-api-key: %+v %v", opened.Header, err)
	}
	reports := hive.reports["/api/bee/gemini-api/status"]
	if len(reports) != 1 || !reports[0].Ready || strings.Join(reports[0].Models, ",") != "gemini-4-neon,gemini-4-argon" {
		t.Fatalf("report: %+v", reports)
	}
	if len(pages) != 2 || !strings.Contains(pages[0], "pageSize=1000") || !strings.Contains(pages[1], "pageToken=page-2") {
		t.Fatalf("pages: %v", pages)
	}
	if len(hive.reports["/api/bee/openai-api/status"])+len(hive.reports["/api/bee/claude-api/status"]) != 0 {
		t.Fatal("a Gemini key reported as another platform's key")
	}
}

func TestGeminiAPIConfigNeedsItsTarget(t *testing.T) {
	cfg := &egressConfig{Targets: []string{"chatgpt.com:443"}, GeminiAPI: &officialAPISource{KeyFile: writeKey(t, "AIza-studio-key", 0600), Models: []string{"gemini-4-neon"}}}
	if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), "generativelanguage.googleapis.com:443") {
		t.Fatalf("missing target accepted: %v", err)
	}
	cfg.Targets = []string{"generativelanguage.googleapis.com:443"}
	if err := cfg.validate(); err != nil {
		t.Fatalf("Gemini API configuration rejected: %v", err)
	}
	if cfg.GeminiAPI.spec() != &geminiAPI {
		t.Fatal("gemini_api is not treated as a Gemini key")
	}
	empty := &egressConfig{Targets: []string{"generativelanguage.googleapis.com:443"}, GeminiAPI: &officialAPISource{KeyFile: cfg.GeminiAPI.KeyFile}}
	if err := empty.validate(); err == nil || !strings.Contains(err.Error(), "BEE-CONFIG-GEMINI-API") {
		t.Fatalf("empty model selection accepted: %v", err)
	}
}

func TestClaudeAPIConfigNeedsItsTarget(t *testing.T) {
	cfg := &egressConfig{Targets: []string{"chatgpt.com:443"}, ClaudeAPI: &officialAPISource{KeyFile: writeKey(t, "sk-ant-platform", 0600), Models: []string{"claude-opus-5-5"}}}
	if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), "api.anthropic.com:443") {
		t.Fatalf("missing target accepted: %v", err)
	}
	cfg.Targets = []string{"api.anthropic.com:443"}
	if err := cfg.validate(); err != nil {
		t.Fatalf("Claude API configuration rejected: %v", err)
	}
	if cfg.ClaudeAPI.spec() != &claudeAPI {
		t.Fatal("claude_api is not treated as a Claude key")
	}
	empty := &egressConfig{Targets: []string{"api.anthropic.com:443"}, ClaudeAPI: &officialAPISource{KeyFile: cfg.ClaudeAPI.KeyFile}}
	if err := empty.validate(); err == nil || !strings.Contains(err.Error(), "BEE-CONFIG-CLAUDE-API") {
		t.Fatalf("empty model selection accepted: %v", err)
	}
}
