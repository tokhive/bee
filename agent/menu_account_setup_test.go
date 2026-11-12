package bee

import (
	"bytes"
	"context"
	"errors"
	"io"
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

func TestMenuAccountSaveSeparatesPersistenceFromServiceApplication(t *testing.T) {
	for _, scenario := range []string{"decline", "restart_failure", "restart_success"} {
		t.Run(scenario, func(t *testing.T) {
			t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
			fakeClaude(t, errors.New("not signed in"))
			input := "1\n1\n1\n"
			if scenario == "decline" {
				input = "1\n1\n0\n"
			}
			m, out := pairedMenu(t, input)
			s, calls := managedFixture(t)
			m.service = s
			previous := s.execute
			s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
				if n == "sudo" && scenario == "restart_failure" {
					return "", errors.New("exit 7: restart denied")
				}
				value, e := previous(c, n, a, i, o)
				return strings.ReplaceAll(value, "ActiveState=inactive", "ActiveState=active"), e
			}
			e := m.configureAccounts()
			if scenario == "restart_failure" {
				if e == nil || !strings.Contains(e.Error(), "configuration saved") || !strings.Contains(e.Error(), "restart denied") {
					t.Fatal(e)
				}
			} else if e != nil {
				t.Fatal(e)
			}
			if _, e := readEgress(m.ctx, m.egressPath); e != nil {
				t.Fatal(e)
			}
			if !strings.Contains(out.String(), "配置已保存") || !strings.Contains(out.String(), "尚未加载此变更") {
				t.Fatal(out.String())
			}
			for _, c := range *calls {
				if scenario == "decline" && strings.HasPrefix(c, "sudo ") {
					t.Fatal(c)
				}
			}
			if scenario == "restart_success" && !strings.Contains(out.String(), "服务操作已验证") {
				t.Fatal(out.String())
			}
		})
	}
}

func TestMenuGuidedAccountSelectionDoesNotOfferItsOwnRestart(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	fakeClaude(t, errors.New("not signed in"))
	m, out := pairedMenu(t, "1\n1\n")
	s, calls := managedFixture(t)
	m.service = s
	previous := s.execute
	s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
		v, e := previous(c, n, a, i, o)
		return strings.ReplaceAll(v, "ActiveState=inactive", "ActiveState=active"), e
	}
	if e := m.configureAccountsWithNext(false); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(out.String(), "操作：重启") {
		t.Fatal(out.String())
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
}
