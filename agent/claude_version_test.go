package bee

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Tests do not ask whatever claude happens to be installed here.
func init() {
	claudeVersion = func(context.Context) string { return defaultClaudeClientVersion }
}

func TestLocalClaudeVersion(t *testing.T) {
	directory := t.TempDir()
	install := func(output string) {
		t.Helper()
		script := "#!/bin/sh\nprintf '%s\\n' '" + output + "'\n"
		if err := os.WriteFile(filepath.Join(directory, "claude"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", directory)
	if got := localClaudeVersion(context.Background()); got != defaultClaudeClientVersion {
		t.Fatalf("no claude on PATH = %q, want the default", got)
	}
	install("2.1.400 (Claude Code)")
	if got := localClaudeVersion(context.Background()); got != "2.1.400" {
		t.Fatalf("installed release = %q, want 2.1.400", got)
	}
	install("claude: command failed")
	if got := localClaudeVersion(context.Background()); got != defaultClaudeClientVersion {
		t.Fatalf("unrecognised output = %q, want the default", got)
	}
}

func TestClaudeReportsItsReleaseAndRelistsOnChange(t *testing.T) {
	release := "2.1.303"
	claudeVersion = func(context.Context) string { return release }
	t.Cleanup(func() { claudeVersion = func(context.Context) string { return defaultClaudeClientVersion } })
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	listed := 0
	transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/models" {
			listed++
			return claudeProfileResponse(200, claudeModelsFixture), nil
		}
		return claudeProfileResponse(200, `{"five_hour":{"utilization":10,"resets_at":"`+time.Now().Add(time.Hour).UTC().Format(time.RFC3339)+`"},"seven_day":{"utilization":10,"resets_at":"`+time.Now().Add(24*time.Hour).UTC().Format(time.RFC3339)+`"}}`), nil
	})
	source := claudeCapabilitySource{}
	observe := func(sequence int64, want string, wantListed int) {
		t.Helper()
		got, err := source.observe(context.Background(), credential, "synthetic-account", sequence, transport)
		if err != nil || got.Status != "ready" || got.ClientVersion != want || !got.ValidFor("claude", time.Now()) {
			t.Fatalf("observation %d = %s with %q, want ready with %q (%v, %s)", sequence, got.Status, got.ClientVersion, want, err, source.failure)
		}
		if listed != wantListed {
			t.Fatalf("models listed %d times after observation %d, want %d", listed, sequence, wantListed)
		}
	}
	observe(1, "2.1.303", 1)
	observe(2, "2.1.303", 1)
	// An upgraded client is reported at once, with fresh metadata.
	release = "2.1.400"
	observe(3, "2.1.400", 2)
}
