package bee_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/beewire"
)

// officialStatusFixture writes a paired device whose egress configuration
// contributes only an official OpenAI key and an official Claude key.
func officialStatusFixture(t *testing.T, hive string) (config string) {
	t.Helper()
	directory := t.TempDir()
	config = filepath.Join(directory, "bee.json")
	state, _ := json.Marshal(map[string]any{
		"hive": hive, "name": "status", "credential": "bee_" + strings.Repeat("A", 43),
		"identity": beewire.Identity{ID: "device-1", Name: "status", OwnerEmail: "provider@example.com"},
	})
	openaiKey, claudeKey := filepath.Join(directory, "openai-api-key"), filepath.Join(directory, "claude-api-key")
	egress, _ := json.Marshal(map[string]any{
		"targets":    []string{"api.openai.com:443", "api.anthropic.com:443"},
		"openai_api": map[string]any{"key_file": openaiKey, "models": []string{"gpt-6-sol"}},
		"claude_api": map[string]any{"key_file": claudeKey, "models": []string{"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"}},
	})
	files := map[string][]byte{config: state, filepath.Join(directory, "egress.json"): egress, openaiKey: []byte("sk-platform-status\n"), claudeKey: []byte("sk-ant-status\n")}
	for path, raw := range files {
		if err := writePrivateFixture(path, raw); err != nil {
			t.Fatal(err)
		}
	}
	return config
}

func keyFingerprint(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// statusHive answers bee status's reads; an official platform it has no
// answer for is a Hive that predates the official key status.
type statusHive map[string]beewire.OfficialAPISupply

func (h statusHive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/api/bee/identity" {
		json.NewEncoder(w).Encode(beewire.Identity{ID: "device-1", Name: "status", OwnerEmail: "provider@example.com"})
		return
	}
	supply, ok := h[r.URL.Path]
	if !ok {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	json.NewEncoder(w).Encode(supply)
}

func runStatus(t *testing.T, hive statusHive) string {
	t.Helper()
	server := httptest.NewServer(hive)
	defer server.Close()
	var out bytes.Buffer
	if err := bee.Run(context.Background(), []string{"status", "--config", officialStatusFixture(t, server.URL)}, &out); err != nil {
		t.Fatalf("%v %s", err, out.String())
	}
	return out.String()
}

func statusLine(t *testing.T, output, name string) string {
	t.Helper()
	for _, line := range strings.Split(output, "\n") {
		if fields := strings.Fields(line); len(fields) > 0 && fields[0] == name {
			return line
		}
	}
	t.Fatalf("no %s line in:\n%s", name, output)
	return ""
}

// bee status reports each official key Hive sends work to, with its models,
// and says why one takes none.
func TestStatusReportsOfficialKeys(t *testing.T) {
	output := runStatus(t, statusHive{
		"/api/bee/claude-api/status": {Platform: "claude_api", KeyFingerprint: keyFingerprint("sk-ant-status"), Ready: true, Reasons: []string{},
			Models: []string{"claude-opus-5-5", "claude-sonnet-5-5"}, UnsoldModels: []string{"claude-haiku-4-5"}, DeniedModels: []string{}},
		"/api/bee/openai-api/status": {Platform: "openai_api", KeyFingerprint: keyFingerprint("sk-platform-status"),
			Reasons: []string{beewire.ReasonManuallyPaused, beewire.ReasonAPIKeyOutOfCredit}, Models: []string{}, DeniedModels: []string{"gpt-6-sol"}},
	})
	if !strings.Contains(output, "Supply:  openai_api, claude_api (egress.json)") {
		t.Fatalf("supply line:\n%s", output)
	}
	if line := statusLine(t, output, "claude_api"); !strings.Contains(line, "taking new work: claude-opus-5-5, claude-sonnet-5-5") {
		t.Fatalf("ready key: %q", line)
	}
	if !strings.Contains(output, "not sold by Hive: claude-haiku-4-5") {
		t.Fatalf("unsold models:\n%s", output)
	}
	line := statusLine(t, output, "openai_api")
	if !strings.Contains(line, "not taking work: paused in the console; out of credit") {
		t.Fatalf("refused key: %q", line)
	}
	if !strings.Contains(output, "refused by the vendor: gpt-6-sol") {
		t.Fatalf("denied models:\n%s", output)
	}
}

// A key Hive does not hold yet is not the one taking work, whatever Hive says
// about the key it does hold; a Hive that cannot answer says so.
func TestStatusOfficialKeyNotRegisteredOrUnknown(t *testing.T) {
	output := runStatus(t, statusHive{
		"/api/bee/claude-api/status": {Platform: "claude_api", KeyFingerprint: keyFingerprint("sk-ant-previous"), Ready: true, Reasons: []string{}, Models: []string{"claude-opus-5-5"}},
	})
	if line := statusLine(t, output, "claude_api"); !strings.Contains(line, "not taking work: Hive holds a different key") {
		t.Fatalf("another key: %q", line)
	}
	if line := statusLine(t, output, "openai_api"); !strings.Contains(line, "state unknown: this Hive does not report official API keys") {
		t.Fatalf("older Hive: %q", line)
	}
}
