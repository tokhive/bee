package bee

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexFileFailureIdentifiesCheckAndPath(t *testing.T) {
	dir := t.TempDir()
	for _, path := range []string{filepath.Join(dir, "auth.json"), dir} {
		_, err := readCodexFile(path)
		var detail *credentialError
		if !errors.As(err, &detail) || !strings.Contains(err.Error(), path) {
			t.Fatalf("%s: %v", path, err)
		}
		want := "missing"
		if path == dir {
			want = "regular"
		}
		if detail.kind != want {
			t.Fatalf("got %q want %q", detail.kind, want)
		}
	}
}
func TestClaudeFailureSeparatesTokenFromExpirationWithoutLeaking(t *testing.T) {
	for _, tc := range []struct {
		token   string
		expires int64
		kind    string
	}{
		{"", 42, "token_missing"}, {"synthetic-secret\n", 42, "token_format"}, {"synthetic-secret", 0, "expiry"},
	} {
		_, err := parseClaudeCredential([]byte(fmt.Sprintf(`{"claudeAiOauth":{"accessToken":%q,"expiresAt":%d}}`, tc.token, tc.expires)))
		var detail *credentialError
		if !errors.As(err, &detail) || detail.kind != tc.kind {
			t.Fatalf("wanted %s: %v", tc.kind, err)
		}
		m, out := menuFixture(t, "")
		m.reportError(failCause("BEE-CLAUDE-SOURCE", err))
		if strings.Contains(out.String(), "synthetic-secret") || !strings.Contains(out.String(), "claude") {
			t.Fatal(out.String())
		}
		if tc.kind == "expiry" && !strings.Contains(out.String(), "expiresAt=0") {
			t.Fatal(out.String())
		}
	}
}
func TestMenuFailedDetectionDoesNotSuggestAnAccountWasSkipped(t *testing.T) {
	t.Setenv("CODEX_HOME", t.TempDir())
	fakeClaude(t, errors.New("synthetic-store-denied: exit=9"))
	m, out := menuFixture(t, "")
	if err := m.configureAccounts(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "未检测到可用账号") || !strings.Contains(out.String(), "exit=9") || strings.Contains(out.String(), "codex login 或 claude") {
		t.Fatal(out.String())
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
