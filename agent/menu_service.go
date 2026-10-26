package bee

import (
	"fmt"
	"os"
	"strings"
)

func (m *managementMenu) printServiceState(s serviceState) {
	fmt.Fprintf(m.out, m.text("Service: %s\nBoot startup: %s\n", "后台服务：%s\n开机自启：%s\n"), s.ActiveState, s.UnitFileState)
}
func (m *managementMenu) services() error {
	if _, e := m.serviceState(); e != nil {
		return e
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
		if _, e = m.readDevice(); e != nil {
			fmt.Fprintln(m.out, e)
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
			if _, err = m.readDevice(); err != nil {
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
	}
	summary := fmt.Sprintf(m.text("Target: tokhive-bee (%s), configuration %s\nAction: %s", "目标：tokhive-bee（%s），配置 %s\n操作：%s"), m.service.username, m.configPath, op)
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
	fmt.Fprintln(m.out, m.text("Service operation verified.", "服务操作已验证。"))
	return nil
}
func (m *managementMenu) logsAndDoctor() error {
	return m.loop(m.text("Logs and diagnostics", "日志与诊断"), []menuAction{{"Recent 50 service log lines", "最近 50 行服务日志", m.logs}, {"Run diagnostics", "运行诊断", m.diagnostics}})
}
func (m *managementMenu) logs() error {
	if _, e := m.serviceState(); e != nil {
		return e
	}
	e := m.service.logs(m.ctx, false)
	if e == nil {
		return nil
	}
	fmt.Fprintln(m.out, e)
	lower := strings.ToLower(e.Error())
	if !strings.Contains(lower, "permission") && !strings.Contains(lower, "access denied") {
		return e
	}
	ok, err := m.confirm(m.text("Read these logs once with administrator access?", "是否仅本次使用管理员权限读取日志？"))
	if err != nil || !ok {
		return err
	}
	return m.service.logs(m.ctx, true)
}
