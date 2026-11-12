package bee

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMenuOptionsSwitchTargetAndResetEgress(t *testing.T) {
	m, _ := menuFixture(t, "")
	old := m.configPath
	m.egressPath = filepath.Join(t.TempDir(), "custom.json")
	s, _ := managedFixture(t)
	m.service = s
	target := filepath.Join(t.TempDir(), "another", "bee.json")
	m.in.Reset(strings.NewReader("1\n" + target + "\n0\n"))
	if err := m.options(); err != nil {
		t.Fatal(err)
	}
	if m.configPath != target || m.egressPath != defaultEgressPath(target) {
		t.Fatalf("targets: %s %s", m.configPath, m.egressPath)
	}
	if m.service.configPath != target || m.service.egressPath != m.egressPath {
		t.Fatal("stale service target")
	}
	for _, p := range []string{old, target} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("session selection wrote %s: %v", p, err)
		}
	}
}

func TestMenuOptionsCancelKeepsTarget(t *testing.T) {
	m, _ := menuFixture(t, "1\n0\n0\n")
	target := m.configPath
	if err := m.options(); err != nil {
		t.Fatal(err)
	}
	if m.configPath != target {
		t.Fatal(m.configPath)
	}
}

func TestMenuHelpWithoutDeviceOrNetwork(t *testing.T) {
	m, out := menuFixture(t, "1\n\n3\n\n0\n")
	if err := m.help(); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Ctrl+C", versionLine()} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %s: %s", want, out)
		}
	}
	if _, err := os.Stat(m.configPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuCommandHelpUsesRegisteredFlags(t *testing.T) {
	m, out := menuFixture(t, "")
	for _, command := range []string{"start", "run", "login", "setup", "status", "supply-status", "account-status", "pause", "resume", "confirm-account", "codex-status", "claude-status", "doctor"} {
		out.Reset()
		if err := m.commandHelp(command); err != nil {
			t.Fatal(command, err)
		}
		if !strings.Contains(out.String(), "Usage of bee "+command) {
			t.Fatal(command, out.String())
		}
	}
}
