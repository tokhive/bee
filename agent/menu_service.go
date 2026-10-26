package bee

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

func (m *managementMenu) printServiceState(s serviceState) {
	active, boot := s.ActiveState, s.UnitFileState
	if m.ui.lang == "zh" {
		if label := map[string]string{"active": "运行中", "inactive": "已停止", "failed": "运行失败", "activating": "正在启动", "deactivating": "正在停止", "reloading": "正在重新加载"}[active]; label != "" {
			active = label
		}
		if label := map[string]string{"enabled": "已开启", "disabled": "已关闭", "masked": "已屏蔽", "enabled-runtime": "仅本次运行启用"}[boot]; label != "" {
			boot = label
		}
	}
	color := "33"
	if s.ActiveState == "active" {
		color = "32"
	} else if s.ActiveState == "failed" {
		color = "31"
	}
	m.field("Service", "后台服务", m.styled(color, active))
	m.field("Boot startup", "开机自启", boot)
}
func (m *managementMenu) services() error {
	if _, e := m.serviceState(); e != nil {
		m.page(m.text("Background service", "后台服务"))
		m.serviceNotice(e)
		return nil
	}
	actions := []menuAction{}
	for _, a := range []struct{ op, en, zh string }{{"start", "Start Bee", "启动 Bee"}, {"stop", "Stop Bee", "停止 Bee"}, {"restart", "Restart Bee", "重启 Bee"}, {"enable", "Enable boot startup", "开启开机自启"}, {"disable", "Disable boot startup", "关闭开机自启"}} {
		op := a.op
		actions = append(actions, menuAction{a.en, a.zh, func() error { return m.serviceAction(op) }})
	}
	return m.loop(m.text("Background service", "后台服务"), actions)
}
func (m *managementMenu) serviceAction(op string) error {
	state, e := m.serviceState()
	if e != nil {
		return e
	}
	if op == "start" || op == "restart" {
		if e = m.requirePairing(); e != nil {
			m.reportError(e)
			if m.pair == nil {
				return e
			}
			ok, err := m.confirm(m.text("Pair the device now?", "现在进入设备配对？"))
			if err != nil || !ok {
				return err
			}
			if err = m.pair(); err != nil {
				return err
			}
			if err = m.requirePairing(); err != nil {
				return err
			}
		}
		if _, e = os.Stat(m.egressPath); e != nil {
			if !os.IsNotExist(e) {
				return e
			}
			if m.configure == nil {
				return fmt.Errorf("supply configuration missing: %s; choose Manage accounts", m.egressPath)
			}
			ok, err := m.confirm(m.text("Select supplied accounts now?", "现在选择供给账号？"))
			if err != nil || !ok {
				return err
			}
			if err = m.configure(); err != nil {
				return err
			}
			if _, err = os.Stat(m.egressPath); err != nil {
				return err
			}
		}
		if _, e = readEgress(m.ctx, m.egressPath); e != nil {
			return e
		}
	}
	label := op
	if m.ui.lang == "zh" {
		if zh := map[string]string{"start": "启动 Bee", "stop": "停止 Bee", "restart": "重启 Bee", "enable": "开启开机自启", "disable": "关闭开机自启"}[op]; zh != "" {
			label = zh
		}
	}
	summary := fmt.Sprintf(m.text("Target: tokhive-bee (%s), configuration %s\nAction: %s", "目标：tokhive-bee（%s），配置 %s\n操作：%s"), m.service.username, m.configPath, label)
	if op == "stop" || op == "restart" {
		summary += "\n" + m.text("This may interrupt current work.", "此操作可能中断当前任务。")
	}
	if op == "enable" || op == "disable" {
		summary += "\n" + m.text("This changes startup at boot; it does not start or stop Bee now.", "这只改变下次开机行为，不会立即启动或停止 Bee。")
	}
	ok, e := m.confirm(summary)
	if e != nil || !ok {
		return e
	}
	state, e = m.service.apply(m.ctx, op)
	if e != nil {
		return e
	}
	m.printServiceState(state)
	m.ui.status(m.out, "✅", "32", "Service operation verified.", "服务操作已验证。")
	return nil
}
func (m *managementMenu) logsAndDoctor() error {
	return m.loop(m.text("Logs and diagnostics", "日志与诊断"), []menuAction{{"Recent 50 service log lines", "最近 50 行服务日志", m.logs}, {"Run diagnostics", "运行诊断", m.diagnostics}})
}
func (m *managementMenu) logs() error {
	m.page(m.text("Service logs", "服务日志"))
	if _, e := m.serviceState(); e != nil {
		m.serviceNotice(e)
		return nil
	}
	m.note("Service logs below are shown in their original language.", "以下服务日志保留原始语言。")
	e := m.service.logs(m.ctx, false)
	if e == nil {
		return nil
	}
	lower := strings.ToLower(e.Error())
	if !errors.Is(e, errJournalPermission) && !strings.Contains(lower, "permission") && !strings.Contains(lower, "access denied") {
		return e
	}
	m.reportError(e)
	ok, err := m.confirm(m.text("Read these logs once with administrator access?", "是否仅本次使用管理员权限读取日志？"))
	if err != nil || !ok {
		return err
	}
	return m.service.logs(m.ctx, true)
}

func (m *managementMenu) requirePairing() error {
	state, e := m.readDevice()
	if e != nil {
		return e
	}
	if state.Identity == nil {
		return errors.New(m.text("Pairing is unfinished; continue pairing before starting Bee.", "设备配对尚未完成，请继续配对后再启动 Bee。"))
	}
	return nil
}
