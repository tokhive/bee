package bee

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

type menuAction struct {
	en, zh string
	run    func() error
}
type managementMenu struct {
	ctx                    context.Context
	in                     *bufio.Reader
	out                    io.Writer
	ui                     installUI
	configPath, egressPath string
	service                *managedService
	serviceErr             error
	configure              func() error
	pair                   func() error
}

func (m *managementMenu) text(en, zh string) string { return m.ui.text(en, zh) }
func (m *managementMenu) line(prompt string) (string, error) {
	if err := m.ctx.Err(); err != nil {
		return "", err
	}
	fmt.Fprint(m.out, prompt)
	type answer struct {
		s string
		e error
	}
	ch := make(chan answer, 1)
	// Only one read is outstanding. A signal may cancel a terminal read; the
	// menu then exits, without starting another reader or touching a service.
	go func() { s, e := m.in.ReadString('\n'); ch <- answer{s, e} }()
	select {
	case <-m.ctx.Done():
		return "", m.ctx.Err()
	case a := <-ch:
		if a.e != nil {
			return "", a.e
		}
		return strings.TrimSpace(a.s), nil
	}
}
func (m *managementMenu) choose(prompt string, max int) (int, error) {
	for {
		a, e := m.line(prompt)
		if e != nil {
			return 0, e
		}
		n, e := strconv.Atoi(a)
		if e == nil && n >= 0 && n <= max {
			return n, nil
		}
		fmt.Fprintf(m.out, m.text("Enter a number from 0 to %d.\n", "请输入 0 到 %d 之间的数字。\n"), max)
	}
}
func (m *managementMenu) confirm(summary string) (bool, error) {
	fmt.Fprintln(m.out, summary)
	for {
		a, e := m.line(m.text("  1) Confirm  0) Cancel [0]: ", "  1) 确认  0) 取消 [0]："))
		if e != nil {
			return false, e
		}
		switch a {
		case "1":
			return true, nil
		case "", "0":
			return false, nil
		default:
			fmt.Fprintln(m.out, m.text("Enter 1 or 0.", "请输入 1 或 0。"))
		}
	}
}
func (m *managementMenu) rule(major bool) {
	line := "----------------------------------------"
	if m.ui.terminal {
		line = "────────────────────────────────────────"
		if major {
			line = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
		}
	}
	fmt.Fprintln(m.out, "\n"+line)
}
func (m *managementMenu) loop(title string, actions []menuAction) error {
	for {
		if e := m.ctx.Err(); e != nil {
			return e
		}
		m.rule(true)
		fmt.Fprintln(m.out, title)
		m.rule(false)
		for i, a := range actions {
			fmt.Fprintf(m.out, "  %d) %s\n", i+1, m.text(a.en, a.zh))
		}
		fmt.Fprintln(m.out, m.text("  0) Back / Exit", "  0) 返回 / 退出"))
		m.rule(false)
		n, e := m.choose(m.text("Select: ", "请输入选项："), len(actions))
		if errors.Is(e, io.EOF) {
			return nil
		}
		if e != nil {
			return e
		}
		if n == 0 {
			return nil
		}
		e = actions[n-1].run()
		if errors.Is(e, io.EOF) {
			return io.EOF
		}
		if errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
			return e
		}
		if e != nil {
			m.ui.status(m.out, "❌", "31", fmt.Sprintf("Operation failed: %v", e), fmt.Sprintf("操作失败：%v", e))
		}
		if _, e = m.line(m.text("\nPress Enter to return...", "\n按回车返回…")); errors.Is(e, io.EOF) {
			return nil
		} else if e != nil {
			return e
		}
	}
}
func (m *managementMenu) language() error {
	fmt.Fprintln(m.out, "  1) 简体中文\n  2) English\n  0) 返回 / Back")
	n, e := m.choose("请选择语言 / Choose language: ", 2)
	if e != nil {
		return e
	}
	if n == 1 {
		m.ui.lang = "zh"
	} else if n == 2 {
		m.ui.lang = "en"
	}
	return nil
}
func (m *managementMenu) readDevice() (localState, error) {
	state, err := readState(m.configPath)
	if err != nil {
		return state, err
	}
	if state.Credential == "" {
		return state, errors.New(m.text("Not paired; choose Pair with Hive.", "尚未配对，请选择设备配对。"))
	}
	origin, err := hiveOrigin(state.Hive)
	if err != nil {
		return state, err
	}
	state.Hive = origin
	if len(state.Credential) != 47 || !strings.HasPrefix(state.Credential, "bee_") {
		return state, fmt.Errorf("device credential in %s has invalid format", m.configPath)
	}
	return state, nil
}
func (m *managementMenu) serviceState() (serviceState, error) {
	if m.serviceErr != nil {
		return serviceState{}, m.serviceErr
	}
	if m.service == nil {
		return serviceState{}, errServiceUnavailable
	}
	return m.service.inspect(m.ctx)
}

func runManagement(ctx context.Context, out io.Writer) error {
	ui, e := newInstallUI(out)
	if e != nil {
		return e
	}
	config := defaultConfigPath()
	if config == "" {
		return errors.New("cannot locate device configuration directory")
	}
	m := &managementMenu{ctx: ctx, in: bufio.NewReader(os.Stdin), out: out, ui: ui, configPath: config, egressPath: defaultEgressPath(config)}
	m.service, m.serviceErr = newManagedService(m.configPath, m.egressPath, os.Stdin, out)
	m.pair = func() error { return m.pairingWithNext(false) }
	m.configure = func() error { return m.configureAccountsWithNext(false) }
	if os.Getenv("BEE_LANG") == "" {
		if e = m.language(); errors.Is(e, io.EOF) {
			return nil
		} else if e != nil {
			return e
		}
	}
	title := "Bee · " + buildVersion()
	if ui.terminal {
		title = "🐝 " + title
	}
	e = m.loop(title, []menuAction{
		{"View status", "查看运行状态", m.status},
		{"Pair / re-pair with Hive", "配对 / 重新配对 Hive", m.pairing},
		{"Manage supplied accounts", "管理供给账号", m.accounts},
		{"Manage background service", "管理后台服务", m.services},
		{"Logs and diagnostics", "查看日志与诊断", m.logsAndDoctor},
		{"Change language / 语言", "切换语言 / Language", m.language},
	})
	if errors.Is(e, io.EOF) {
		return nil
	}
	return e
}
