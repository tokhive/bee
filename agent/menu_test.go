package bee

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func menuFixture(t *testing.T, input string) (*managementMenu, *bytes.Buffer) {
	t.Helper()
	out := &bytes.Buffer{}
	cfg := filepath.Join(t.TempDir(), "bee.json")
	return &managementMenu{ctx: context.Background(), in: bufio.NewReader(strings.NewReader(input)), out: out, ui: installUI{lang: "zh"}, configPath: cfg, egressPath: defaultEgressPath(cfg)}, out
}
func TestMenuNumericConfirmationDefaultsToCancel(t *testing.T) {
	for _, input := range []string{"\n", "0\n", "", "1"} {
		m, _ := menuFixture(t, input)
		ok, e := m.confirm("目标")
		if ok {
			t.Fatalf("%q authorized", input)
		}
		if input == "" || input == "1" {
			if !errors.Is(e, io.EOF) {
				t.Fatal(e)
			}
		}
	}
}
func TestMenuSharedReaderKeepsConsecutiveAnswers(t *testing.T) {
	m, _ := menuFixture(t, "wrong\n8\n2\n1\n")
	n, e := m.choose("选择", 3)
	if e != nil || n != 2 {
		t.Fatal(n, e)
	}
	ok, e := m.confirm("变更")
	if !ok || e != nil {
		t.Fatal(ok, e)
	}
}
func TestMenuLoopReturnsAfterFailureAndSwitchesLanguage(t *testing.T) {
	m, out := menuFixture(t, "1\n\n2\n0\n")
	count := 0
	e := m.loop("管理", []menuAction{{en: "Fail", zh: "失败", run: func() error { count++; return errors.New("evidence 7") }}, {en: "English", zh: "英文", run: func() error { m.ui.lang = "en"; return nil }}})
	if e != nil {
		t.Fatal(e)
	}
	if count != 1 || !strings.Contains(out.String(), "evidence 7") || !strings.Contains(out.String(), "English") {
		t.Fatal(out.String())
	}
}
func TestMenuEOFNeverRunsAction(t *testing.T) {
	m, _ := menuFixture(t, "")
	e := m.loop("管理", []menuAction{{en: "Action", zh: "动作", run: func() error { t.Fatal("ran"); return nil }}})
	if e != nil {
		t.Fatal(e)
	}
}

func TestMenuNestedReturnDoesNotConsumeNextAction(t *testing.T) {
	m, out := menuFixture(t, "1\n0\n2\n\n0\n")
	called := 0
	err := m.loop("管理", []menuAction{
		{"Accounts", "账号", m.accounts},
		{"Action", "动作", func() error { called++; return nil }},
	})
	if err != nil || called != 1 {
		t.Fatalf("action calls=%d error=%v\n%s", called, err, out)
	}
	if strings.Count(out.String(), "按回车返回") != 1 || strings.Contains(out.String(), "返回 / 退出") {
		t.Fatal(out.String())
	}
}

func TestMenuUnknownFailurePreservesEvidenceOutsideSummary(t *testing.T) {
	m, out := menuFixture(t, "1\n\n0\n")
	evidence := "custom failure: expected User=alice; got User=bob\nexit=7"
	if err := m.loop("管理", []menuAction{{"Action", "动作", func() error { return errors.New(evidence) }}}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "技术详情") || !strings.Contains(out.String(), "User=bob") || !strings.Contains(out.String(), "exit=7") {
		t.Fatal(out.String())
	}
}
func TestMenuServiceCancellationNeverMutates(t *testing.T) {
	m, _ := menuFixture(t, "4\n0\n0\n")
	s, calls := managedFixture(t)
	m.service = s
	if e := m.services(); e != nil {
		t.Fatal(e)
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
}

func TestMenuCanceledContextUnblocksTerminalRead(t *testing.T) {
	m, _ := menuFixture(t, "")
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	m.in = bufio.NewReader(r)
	ctx, cancel := context.WithCancel(context.Background())
	m.ctx = ctx
	done := make(chan error, 1)
	go func() { _, e := m.line(""); done <- e }()
	cancel()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
func TestMenuStatusRetainsLocalEvidenceWhenUnpaired(t *testing.T) {
	m, out := menuFixture(t, "")
	s, _ := managedFixture(t)
	m.service = s
	e := m.status()
	if e == nil || !strings.Contains(out.String(), "已停止") || !strings.Contains(out.String(), "已开启") {
		t.Fatalf("%v %s", e, out.String())
	}
}

func TestMenuStartResumesIncompletePairingBeforeServiceMutation(t *testing.T) {
	m, _ := menuFixture(t, "1\n")
	s, calls := managedFixture(t)
	m.service = s
	if e := saveState(m.configPath, localState{Hive: "https://hive.example", Credential: "bee_" + strings.Repeat("a", 43)}); e != nil {
		t.Fatal(e)
	}
	paired := false
	m.pair = func() error { paired = true; return io.EOF }
	if e := m.serviceAction("start"); !errors.Is(e, io.EOF) || !paired {
		t.Fatalf("pair=%t error=%v", paired, e)
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
}

func TestMenuLogElevationNeedsExplicitConfirmation(t *testing.T) {
	for _, answer := range []string{"0\n", "1\n"} {
		t.Run(strings.TrimSpace(answer), func(t *testing.T) {
			m, _ := menuFixture(t, answer)
			s, calls := managedFixture(t)
			m.service = s
			previous := s.execute
			s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
				v, e := previous(c, n, a, i, o)
				if n == "journalctl" {
					return "", fmt.Errorf("%w: not seeing messages from other users and the system", errJournalPermission)
				}
				return v, e
			}
			if e := m.logs(); e != nil {
				t.Fatal(e)
			}
			elevated := 0
			for _, c := range *calls {
				if strings.HasPrefix(c, "sudo ") {
					elevated++
					if c != "sudo journalctl -u tokhive-bee -n 50 --no-pager" {
						t.Fatal(c)
					}
				}
			}
			if (answer == "1\n" && elevated != 1) || (answer == "0\n" && elevated != 0) {
				t.Fatal(*calls)
			}
		})
	}
}
