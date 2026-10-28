package bee

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestMenuChecksLocalDoNotContactOfficialEndpoints(t *testing.T) {
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	http.DefaultTransport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		t.Fatalf("local check contacted %s", r.URL)
		return nil, nil
	})
	m, out := menuFixture(t, "")
	m.checks.codex = codexSource{Home: codexHome(t, time.Now().Add(time.Hour)), Store: "file", KeyringBackend: "direct"}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), claudeSample(time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	m.checks.claudeDir, m.checks.claudeStore = &dir, "file"
	if err := m.checkCodex(false); err != nil {
		t.Fatal(err)
	}
	if err := m.checkClaude("local"); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"本地结构检查", "账号指纹", "有效期"} {
		if !strings.Contains(out.String(), want) {
			t.Fatal(want, out.String())
		}
	}
	if strings.Contains(out.String(), "synthetic-") {
		t.Fatal("secret leaked")
	}
}

func TestMenuClaudeChecksOnlineIdentityAndCapabilities(t *testing.T) {
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	paths := []string{}
	http.DefaultTransport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		paths = append(paths, r.URL.Path)
		if r.Method != "GET" || r.URL.Host != "api.anthropic.com" {
			t.Fatal(r.Method, r.URL)
		}
		switch r.URL.Path {
		case "/api/oauth/profile":
			return claudeProfileResponse(200, claudeTestProfile), nil
		case "/v1/models":
			return claudeProfileResponse(200, claudeModelsFixture), nil
		case "/api/oauth/usage":
			raw, _ := json.Marshal(claudeQuotaFixture())
			return claudeProfileResponse(200, string(raw)), nil
		default:
			t.Fatal(r.URL)
			return nil, nil
		}
	})
	m, out := menuFixture(t, "")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), claudeSample(time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	m.checks.claudeDir, m.checks.claudeStore = &dir, "file"
	if err := m.checkClaude("verify"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "官方身份已验证") {
		t.Fatal(out.String())
	}
	out.Reset()
	if err := m.checkClaude("capabilities"); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 4 || !strings.Contains(out.String(), "已用") || !strings.Contains(out.String(), "模型") {
		t.Fatal(paths, out.String())
	}
	if strings.Contains(out.String(), "synthetic-") {
		t.Fatal("secret leaked")
	}
}

func TestMenuCodexCapabilitiesPreserveUnknownReason(t *testing.T) {
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	calls := 0
	http.DefaultTransport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return claudeProfileResponse(503, "upstream unavailable"), nil
	})
	m, out := menuFixture(t, "")
	m.checks.codex = codexSource{Home: codexHome(t, time.Now().Add(time.Hour)), Store: "file"}
	if err := m.checkCodex(true); err != nil {
		t.Fatal(err)
	}
	if calls == 0 || !strings.Contains(out.String(), "HTTP 503") || !strings.Contains(out.String(), "未知") {
		t.Fatal(calls, out.String())
	}
}

func TestMenuDiagnosticsJSONMatchesStructuredReport(t *testing.T) {
	m, out := menuFixture(t, "")
	if err := m.diagnosticsJSON(); err != nil {
		t.Fatal(err)
	}
	var got doctorReport
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err, out.String())
	}
	expected, _ := json.Marshal(diagnose(m.ctx, m.configPath, ""))
	actual, _ := json.Marshal(got)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal(string(actual), string(expected))
	}
}

func TestMenuCapabilitiesShowEveryQuotaWindow(t *testing.T) {
	m, out := menuFixture(t, "")
	used := 23
	m.showCapabilities(beewire.Capabilities{Status: "ready", Models: []string{"model-a"}, Windows: []beewire.QuotaWindow{{Scope: "sonnet", Seconds: 604800, UsedPercent: &used, ResetAt: time.Now().Add(time.Hour)}}})
	for _, want := range []string{"model-a", "sonnet", "23%", "604800"} {
		if !strings.Contains(out.String(), want) {
			t.Fatal(want, out.String())
		}
	}
}

func TestMenuCodexChecksShowOfficialModelsAndLimits(t *testing.T) {
	m, out := menuFixture(t, "")
	transport := &openaiControlFixture{plan: "pro"}
	m.checks.codex = codexSource{Home: codexHome(t, time.Now().Add(time.Hour)), Store: "file", transport: transport}
	if err := m.checkCodex(true); err != nil {
		t.Fatal(err)
	}
	if transport.models != 1 || transport.usage != 1 {
		t.Fatal(transport.models, transport.usage)
	}
	for _, want := range []string{"gpt-test-a", "gpt-test-b", "20%"} {
		if !strings.Contains(out.String(), want) {
			t.Fatal(want, out.String())
		}
	}
}

func TestMenuClaudeCheckOptionsKeepThreeDirectoryStates(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", "environment-namespace")
	m, _ := menuFixture(t, "")
	for _, tc := range []struct {
		input string
		want  *string
	}{
		{"1\n1\n0\n", nil},
		{"1\n2\n0\n", new(string)},
		{"1\n3\n custom namespace \n0\n", func() *string { value := " custom namespace "; return &value }()},
	} {
		m.in.Reset(strings.NewReader(tc.input))
		if err := m.claudeCheckOptions(); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(m.checks.claudeDir, tc.want) {
			t.Fatal(m.checks.claudeDir, tc.want)
		}
		if os.Getenv("CLAUDE_CONFIG_DIR") != "environment-namespace" {
			t.Fatal("environment mutated")
		}
	}
}

func TestMenuDiagnosticsExplicitMissingPathIsNotSkipped(t *testing.T) {
	m, out := menuFixture(t, "")
	m.egressExplicit = true
	if err := m.diagnosticsJSON(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "BEE-CONFIG-NOT-FOUND") || strings.Contains(out.String(), "Account checks show only") {
		t.Fatal(out.String())
	}
}
