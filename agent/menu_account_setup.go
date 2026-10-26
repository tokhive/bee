package bee

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (m *managementMenu) configureAccounts() error {
	return m.configureAccountsWithNext(true)
}

func (m *managementMenu) configureAccountsWithNext(offerNext bool) error {
	m.page(m.text("Select supplied accounts", "选择供给账号"))
	fmt.Fprintf(m.out, m.text("Target configuration: %s\n", "目标配置：%s\n"), m.egressPath)
	before, e := configurationSnapshot(m.egressPath)
	if e != nil {
		return e
	}
	existing, e := existingEgress(m.ctx, m.egressPath)
	if e != nil {
		return e
	}
	if m.setup.proxy != nil && *m.setup.proxy != "" {
		if _, e = localConnectProxy(*m.setup.proxy); e != nil {
			return failCause("BEE-CONFIG-PROXY", e)
		}
	}
	home := m.setup.codexHome
	if home == "" && existing != nil && existing.Codex != nil {
		home = existing.Codex.Home
	}
	detected := []detectedAccount{}
	if m.setup.platform == "" || m.setup.platform == "openai" {
		detected = append(detected, detectCodexWithUI(m.ctx, home, m.ui))
	}
	if m.setup.platform == "" || m.setup.platform == "claude" {
		detected = append(detected, detectClaudeWithUI(m.ctx, m.setup.claudeDir, existing, m.ui))
	}
	chosen := []detectedAccount{}
	names := []string{}
	available := 0
	for _, found := range detected {
		fmt.Fprintln(m.out, "\n"+m.styled("1;36", platformName(found.platform)))
		if found.problem != nil {
			if m.setup.platform != "" {
				return found.problem
			}
			m.reportError(found.problem)
			continue
		}
		available++
		m.ui.status(m.out, "✅", "32", "Official sign-in detected", "已检测到官方登录")
		m.note(found.summary, found.summary)
		if m.setup.all {
			chosen = append(chosen, found)
			names = append(names, found.platform)
			continue
		}
		fmt.Fprintln(m.out, m.text("  1) Supply this account  2) Skip  0) Cancel selection", "  1) 供给此账号  2) 跳过  0) 取消本次选择"))
		n, e := m.choose(m.text("Select [0–2]: ", "请选择 [0–2]："), 2)
		if e != nil {
			return e
		}
		if n == 0 {
			return m.back()
		}
		if n == 1 {
			chosen = append(chosen, found)
			names = append(names, found.platform)
		}
	}
	if len(chosen) == 0 {
		if available == 0 {
			m.ui.status(m.out, "⚠️", "33", "No usable accounts detected. Existing configuration kept.", "未检测到可用账号，已有配置保持不变。")
			return nil
		}
		fmt.Fprintln(m.out, m.text("No accounts selected; existing configuration kept. Use pause to stop new work.", "没有选择账号，已有配置保持不变。需要停止接单时可使用暂停功能。"))
		return nil
	}
	fmt.Fprintf(m.out, m.text("Supply after saving: %s\n", "保存后的供给平台：%s\n"), strings.Join(names, ", "))
	if existing != nil {
		for _, p := range configuredPlatforms(existing) {
			present := false
			for _, n := range names {
				if p == n {
					present = true
				}
			}
			if !present {
				fmt.Fprintf(m.out, m.text("Will remove from supply: %s\n", "将从供给配置移除：%s\n"), p)
			}
		}
	}
	proxy := ""
	if existing != nil {
		proxy = existing.ConnectProxy
	}
	if m.setup.proxy != nil {
		proxy = *m.setup.proxy
	}
	if proxy == "" {
		proxy = m.text("None", "不使用")
	}
	m.field("HTTP CONNECT proxy after saving", "保存后的 HTTP CONNECT 代理", proxy)
	ok, e := m.confirm(m.text("Save this complete selection?", "保存以上完整供给选择？"))
	if e != nil || !ok {
		return e
	}
	current, e := configurationSnapshot(m.egressPath)
	if e != nil {
		return e
	}
	if !bytes.Equal(current, before) {
		return fmt.Errorf("%s changed during account selection; configuration was not overwritten", m.egressPath)
	}
	cfg := buildEgress(chosen, existing, m.setup.proxy)
	raw, e := json.MarshalIndent(cfg, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(m.egressPath), 0700); e != nil {
		return e
	}
	if e = writePrivateFile(m.egressPath, append(raw, '\n'), ".egress-*"); e != nil {
		return fmt.Errorf("save supply configuration %s: %w", m.egressPath, e)
	}
	if _, e = readEgress(m.ctx, m.egressPath); e != nil {
		return e
	}
	fmt.Fprintf(m.out, m.text("Configuration saved: %s\n", "配置已保存：%s\n"), m.egressPath)
	if !offerNext {
		fmt.Fprintln(m.out, m.text("These changes apply on the next start or restart.", "这些变更将在下一次启动或重启时应用。"))
		return nil
	}
	state, serviceErr := m.serviceState()
	if serviceErr == nil && state.ActiveState == "active" {
		fmt.Fprintln(m.out, m.text("The running process has not loaded this change yet.", "当前运行进程尚未加载此变更。"))
		if e = m.serviceAction("restart"); e != nil {
			return fmt.Errorf("configuration saved, application to the running process unconfirmed: %w", e)
		}
	} else {
		fmt.Fprintln(m.out, m.text("Apply on the next start. Restart any foreground or custom Bee process to apply it.", "下次启动时应用。前台或自定义服务需自行重启以加载变更。"))
	}
	return nil
}
func configurationSnapshot(path string) ([]byte, error) {
	info, e := os.Lstat(path)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("configuration %s mode=%s; expected a private regular file", path, info.Mode())
	}
	return os.ReadFile(path)
}
