package logx

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestFriendlyLinesSayWhatToDo(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(Friendly(&out, slog.LevelInfo)).With("service", "bee")
	logger.Debug("hidden")
	logger.Info("ready: taking new work", "module", "sync", "platform", "OpenAI", "state", "ready")
	logger.Warn("Bee has no egress configuration", "module", "connect", "code", "BEE-SETUP-NEEDED", "fix", "run bee setup")
	logger.Error("bee stopped", "error", "not paired", "endpoint", "wss://hive.example")
	lines := strings.Split(strings.TrimRight(out.String(), "\n"), "\n")
	want := []string{
		"· openai: ready: taking new work",
		"! Bee has no egress configuration [BEE-SETUP-NEEDED]",
		"           fix: run bee setup",
		"✗ bee stopped: not paired  (endpoint=wss://hive.example)",
	}
	if len(lines) != len(want) {
		t.Fatalf("got %q", lines)
	}
	for i, line := range lines {
		if !strings.HasSuffix(line, want[i]) {
			t.Errorf("line %d: %q, want suffix %q", i, line, want[i])
		}
	}
}

func TestReadableOnlyForAQuietTerminal(t *testing.T) {
	if Readable(&bytes.Buffer{}) {
		t.Fatal("a buffer is not a terminal")
	}
}
