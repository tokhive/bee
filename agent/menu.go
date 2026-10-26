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
	egressExplicit         bool
	setupTargetFixed       bool
	setup                  menuSetupOptions
	checks                 menuCheckOptions
	service                *managedService
	serviceErr             error
	configure              func() error
	pair                   func() error
	depth, navigation      int
}

func (m *managementMenu) text(en, zh string) string { return m.ui.text(en, zh) }
func (m *managementMenu) line(prompt string) (string, error) {
	value, err := m.rawLine(prompt)
	return strings.TrimSpace(value), err
}

func (m *managementMenu) rawLine(prompt string) (string, error) {
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
		return strings.TrimSuffix(strings.TrimSuffix(a.s, "\n"), "\r"), nil
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
			return false, m.back()
		default:
			fmt.Fprintln(m.out, m.text("Enter 1 or 0.", "请输入 1 或 0。"))
		}
	}
}
func (m *managementMenu) loop(title string, actions []menuAction) error {
	m.navigation++
	m.depth++
	defer func() { m.depth-- }()
	for {
		if e := m.ctx.Err(); e != nil {
			return e
		}
		if m.depth == 1 {
			m.page("")
			m.field("Device configuration", "设备配置", m.configPath)
		} else {
			m.page(title)
		}
		for i, a := range actions {
			m.option(i+1, m.text(a.en, a.zh))
		}
		fmt.Fprintln(m.out)
		back := m.text("Back", "返回上级")
		if m.depth == 1 {
			back = m.text("Exit", "退出")
		}
		m.option(0, back)
		n, e := m.choose(fmt.Sprintf(m.text("\nSelect [0–%d]: ", "\n请选择 [0–%d]："), len(actions)), len(actions))
		if errors.Is(e, io.EOF) {
			return nil
		}
		if e != nil {
			return e
		}
		if n == 0 {
			return nil
		}
		navigation := m.navigation
		e = actions[n-1].run()
		if errors.Is(e, io.EOF) {
			return io.EOF
		}
		if errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
			return e
		}
		if e != nil {
			m.reportError(e)
		}
		if e == nil && navigation != m.navigation {
			continue
		}
		if _, e = m.line(m.text("\nPress Enter to return...", "\n按回车返回…")); errors.Is(e, io.EOF) {
			return nil
		} else if e != nil {
			return e
		}
	}
}
func (m *managementMenu) language() error {
	m.page(m.text("Language", "语言"))
	m.option(1, "简体中文")
	m.option(2, "English")
	m.option(0, m.text("Back", "返回上级"))
	n, e := m.choose("请选择语言 / Choose language: ", 2)
	if e != nil {
		return e
	}
	if n == 1 {
		m.ui.lang = "zh"
	} else if n == 2 {
		m.ui.lang = "en"
	}
	return m.back()
}
func (m *managementMenu) readDevice() (localState, error) {
	state, err := readState(m.configPath)
	if err != nil {
		return state, err
	}
	if state.Credential == "" {
		return state, fail("BEE-DEVICE-NOT-PAIRED", m.configPath)
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
	m.checks.codex.Store, m.checks.codex.KeyringBackend = "file", "direct"
	m.checks.claudeStore = defaultClaudeStore()
	m.pair = func() error { return m.pairingWithNext(false) }
	m.configure = func() error { return m.accountSetup(false) }
	if os.Getenv("BEE_LANG") == "" {
		if e = m.language(); errors.Is(e, io.EOF) {
			return nil
		} else if e != nil {
			return e
		}
	}
	e = m.loop("", []menuAction{
		{"Start Bee", "启动 Bee", m.starts},
		{"Status", "运行状态", m.status},
		{"Device pairing", "设备配对", m.pairing},
		{"Supplied accounts", "供给账号", m.accounts},
		{"Background service", "后台服务", m.services},
		{"Logs and diagnostics", "日志与诊断", m.logsAndDoctor},
		{"Advanced options", "高级选项", m.options},
		{"Help and version", "帮助与版本", m.help},
		{"Change language", "切换语言", m.language},
	})
	if errors.Is(e, io.EOF) {
		return nil
	}
	return e
}
