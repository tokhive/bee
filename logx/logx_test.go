package logx

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
)

// capture swaps os.Stderr before Setup so the handler the test installs writes
// into the pipe, which is also what Stamp reads at call time.
func capture(t *testing.T) func() string {
	t.Helper()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stderr
	originalLogger := slog.Default()
	os.Stderr = write
	return func() string {
		os.Stderr = original
		slog.SetDefault(originalLogger)
		if err := write.Close(); err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(read)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
}

func TestModuleAllowlistKeepsOnlyListedModules(t *testing.T) {
	done := capture(t)
	t.Setenv("TOKHIVE_LOG_LEVEL", "debug")
	t.Setenv("TOKHIVE_LOG_MODULES", "sync, HTTP")
	Setup("bee", "")
	slog.Info("kept", "module", "sync")
	slog.Info("dropped", "module", "connect")
	slog.Info("dropped-untagged")
	Stamp("[bee-debug]", "egress", "dropped stamp")
	Stamp("[bee-debug]", "sync", "kept stamp")
	out := done()
	if !strings.Contains(out, `msg=kept`) || !strings.Contains(out, "kept stamp") {
		t.Fatalf("allowlisted lines missing: %q", out)
	}
	for _, dropped := range []string{"dropped", "dropped stamp", "dropped-untagged"} {
		if strings.Contains(out, dropped) {
			t.Fatalf("line survived the allowlist: %q in %q", dropped, out)
		}
	}
	if !strings.Contains(out, `service=bee`) {
		t.Fatalf("service tag missing: %q", out)
	}
}

func TestEmptyAllowlistKeepsEverything(t *testing.T) {
	done := capture(t)
	t.Setenv("TOKHIVE_LOG_MODULES", "")
	Setup("hive", "")
	slog.Info("kept", "module", "anything")
	if out := done(); !strings.Contains(out, `msg=kept`) {
		t.Fatalf("default allowlist suppressed a line: %q", out)
	}
}

func TestLevelSilencesDebugByDefault(t *testing.T) {
	done := capture(t)
	Setup("bee", "")
	slog.Debug("quiet")
	slog.Info("spoken")
	out := done()
	if strings.Contains(out, "quiet") {
		t.Fatalf("debug line at default level: %q", out)
	}
	if !strings.Contains(out, `msg=spoken`) {
		t.Fatalf("info line missing: %q", out)
	}
}

func TestLegacyDebugSwitchAsksForDebug(t *testing.T) {
	done := capture(t)
	t.Setenv("BEE_DEBUG", "1")
	Setup("bee", "BEE_DEBUG")
	slog.Debug("spoken")
	if out := done(); !strings.Contains(out, `msg=spoken`) {
		t.Fatalf("legacy switch did not enable debug: %q", out)
	}
}

func TestStampCarriesDateAndTime(t *testing.T) {
	done := capture(t)
	Stamp("[bee-debug]", "egress", "bridging to %q", "host")
	out := done()
	if !strings.Contains(out, "[bee-debug] bridging to \"host\"\n") {
		t.Fatalf("stamped line missing: %q", out)
	}
	if !strings.HasPrefix(out, "time=") || len(out) < 35 || out[9] != '-' || out[12] != '-' || out[15] != 'T' || !strings.Contains(out, " level=DEBUG [bee-debug] ") {
		t.Fatalf("line does not start with date-time and level: %q", out)
	}
}
