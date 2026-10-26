package bee

import (
	"errors"
	"flag"
	"fmt"
)

func (m *managementMenu) help() error {
	return m.loop(m.text("Help and version", "帮助与版本"), []menuAction{
		{"How to use Bee", "使用说明", func() error {
			m.page(m.text("How to use Bee", "使用说明"))
			m.note("Start Bee → Guided setup pairs the device, selects accounts and chooses foreground or background operation.", "启动 Bee → 引导配置并启动：完成设备配对、选择供给账号，再选择前台或后台运行。")
			m.note("Direct foreground run uses existing configuration; without a supply file, Bee connects without supplying accounts.", "按现有配置前台运行：使用已有配置；没有供给配置时，仅保持在线，不供给账号。")
			m.note("Ctrl+C stops this foreground Bee and exits. Run bee again to reopen the menu.", "Ctrl+C 停止本次前台 Bee 并退出程序；再次输入 bee 可重新打开菜单。")
			m.note("A background service keeps running after you exit this menu. Boot startup requires the Linux installer service.", "后台服务在退出菜单后继续运行。开机自启需要 Linux 安装脚本配置的服务。")
			m.note("Session options select paths without saving preferences. Every write asks for confirmation; 0 goes back or cancels.", "高级选项只选择本次会话的路径，不保存偏好。写操作会先确认；0 返回或取消。")
			m.note("CLI aliases: help / -h / --help; version / --version. All subcommands keep their existing options.", "命令别名：help / -h / --help；version / --version。各子命令保留原有参数。")
			return nil
		}},
		{"Commands and options", "命令与参数参考", m.commandReference},
		{"Program version", "程序版本", func() error { m.field("Version", "程序版本", versionLine()); return nil }},
	})
}

func (m *managementMenu) commandReference() error {
	commands := []struct{ name, en, zh string }{
		{"start", "Guided foreground start", "引导前台启动"}, {"run", "Run existing configuration", "按现有配置运行"},
		{"login", "Pair device", "设备配对"}, {"setup", "Select supplied accounts", "选择供给账号"},
		{"status", "Status", "运行状态"}, {"supply-status", "Supply status", "接单状态"},
		{"account-status", "Registered account", "已登记账号"}, {"pause", "Pause supply", "暂停接单"},
		{"resume", "Resume supply", "恢复接单"}, {"confirm-account", "Confirm account change", "确认账号变更"},
		{"codex-status", "Codex checks", "Codex 检查"}, {"claude-status", "Claude Code checks", "Claude Code 检查"},
		{"doctor", "Diagnostics", "诊断"},
	}
	actions := make([]menuAction, 0, len(commands)+1)
	for _, c := range commands {
		actions = append(actions, menuAction{c.name + " · " + c.en, c.name + " · " + c.zh, func() error { return m.commandHelp(c.name) }})
	}
	actions = append(actions, menuAction{"Full CLI help", "完整命令帮助", func() error { fmt.Fprint(m.out, usage); return nil }})
	return m.loop(m.text("Commands and options", "命令与参数参考"), actions)
}

func (m *managementMenu) commandHelp(command string) error {
	m.page("bee " + command)
	m.note("Original CLI option reference follows. It does not execute this command.", "以下为命令原始参数参考，不会执行此命令。")
	err := run(m.ctx, []string{command, "-h"}, m.out)
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
	return err
}
