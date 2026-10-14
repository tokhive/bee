package bee

import (
	"log/slog"
	"strings"
	"testing"
)

// Every line bee run prints carries a time and level, whether it went through
// notify or was written to the console directly.
func TestConsoleLinesCarryTimeAndLevel(t *testing.T) {
	var out strings.Builder
	c := newConsole(&out)
	notify(c, slog.LevelWarn, "connect", "connection lost; reconnecting", "retry_delay", "2s")
	c.Write([]byte("plain line\n"))
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines %q", lines)
	}
	for i, want := range []string{`level=WARN msg="connection lost; reconnecting" service=bee module=connect retry_delay=2s`, `level=INFO msg="plain line" service=bee module=console`} {
		if !strings.HasPrefix(lines[i], "time=") || !strings.Contains(lines[i], want) {
			t.Fatalf("line %d = %q, want %q", i, lines[i], want)
		}
	}
	var bare strings.Builder
	notify(&bare, slog.LevelWarn, "connect", "connection lost; reconnecting")
	if bare.String() != "connection lost; reconnecting\n" {
		t.Fatalf("one-shot output changed: %q", bare.String())
	}
}
