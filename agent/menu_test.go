package bee

import (
	"bufio"
	"bytes"
	"context"
	"errors"
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
	if e == nil || !strings.Contains(out.String(), "inactive") || !strings.Contains(out.String(), "enabled") {
		t.Fatalf("%v %s", e, out.String())
	}
}
