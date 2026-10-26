package bee

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMenuAccountSelectionCancelDoesNotWrite(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	fakeClaude(t, errors.New("not signed in"))
	m, out := menuFixture(t, "1\n0\n")
	if e := m.configureAccounts(); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(m.egressPath); !os.IsNotExist(e) {
		t.Fatal(e)
	}
	if !strings.Contains(out.String(), "保存后的供给平台") {
		t.Fatal(out.String())
	}
}
func TestMenuAccountSelectionSavesPrivateConfiguration(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	fakeClaude(t, errors.New("not signed in"))
	m, out := menuFixture(t, "1\n1\n")
	if e := m.configureAccounts(); e != nil {
		t.Fatal(e)
	}
	cfg := writtenEgress(t, m.egressPath)
	if cfg["codex"] == nil {
		t.Fatal(cfg)
	}
	if !strings.Contains(out.String(), "配置已保存") || !strings.Contains(out.String(), "下次启动") {
		t.Fatal(out.String())
	}
	if strings.Contains(out.String(), "synthetic-refresh-secret") {
		t.Fatal("secret leaked")
	}
}
func TestMenuAccountSelectionNoAccountsKeepsOldConfiguration(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	fakeClaude(t, errors.New("not signed in"))
	m, _ := menuFixture(t, "1\n1\n")
	if e := m.configureAccounts(); e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(m.egressPath)
	m.in.Reset(strings.NewReader("2\n"))
	if e := m.configureAccounts(); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(m.egressPath)
	if !bytes.Equal(before, after) {
		t.Fatal("configuration cleared")
	}
}
