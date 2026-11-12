package bee

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// These targets belong only to this menu session. Selecting a target never
// rewrites a service or changes environment variables used by other commands.
func (m *managementMenu) options() error {
	return m.loop(m.text("Advanced options", "高级选项"), []menuAction{
		{"Device configuration", "选择设备配置", m.selectConfig},
		{"Supply configuration (setup / run / doctor)", "选择供给配置（配置账号 / 直接运行 / 诊断）", m.selectEgress},
		{"Restore default paths", "恢复默认路径", func() error {
			m.configPath = defaultConfigPath()
			m.egressPath = defaultEgressPath(m.configPath)
			m.egressExplicit = false
			m.refreshServiceTarget()
			return m.back()
		}},
		{"Run existing configuration in foreground", "按现有配置前台运行", m.foreground},
	})
}

func (m *managementMenu) configurationPaths() {
	m.field("Device configuration", "设备配置", m.configPath)
	m.field("Supply configuration", "供给配置", m.egressPath)
	if m.egressPath != defaultEgressPath(m.configPath) {
		m.field("Start / status use", "启动 / 运行状态使用", defaultEgressPath(m.configPath))
	}
}

func (m *managementMenu) pathInput(current string) (string, bool, error) {
	m.field("Current path", "当前路径", current)
	value, err := m.rawLine(m.text("Path (Enter keeps current; 0 cancels): ", "路径（回车保持当前；0 取消）："))
	if err != nil {
		return "", false, err
	}
	if value == "0" {
		return "", false, m.back()
	}
	if value == "" {
		return current, true, nil
	}
	if strings.HasPrefix(value, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", false, fmt.Errorf("resolve home for %q: %w", value, err)
		}
		value = filepath.Join(home, value[2:])
	}
	path, err := filepath.Abs(value)
	return path, err == nil, err
}

func (m *managementMenu) selectConfig() error {
	path, ok, err := m.pathInput(m.configPath)
	if err != nil || !ok {
		return err
	}
	m.configPath, m.egressPath = path, defaultEgressPath(path)
	m.egressExplicit = false
	m.refreshServiceTarget()
	m.configurationPaths()
	return m.back()
}

func (m *managementMenu) selectEgress() error {
	if m.setupTargetFixed {
		m.field("Supply file fixed by this start action", "本次启动固定使用的供给配置", m.egressPath)
		return m.back()
	}
	m.note("Used by account setup, direct foreground run and diagnostics. Start Bee and status use egress.json beside the device file.", "用于账号配置、直接前台运行和诊断。启动 Bee 与运行状态使用设备文件旁的 egress.json。")
	path, ok, err := m.pathInput(m.egressPath)
	if err != nil || !ok {
		return err
	}
	m.egressPath, m.egressExplicit = path, true
	m.refreshServiceTarget()
	m.configurationPaths()
	return m.back()
}

func (m *managementMenu) refreshServiceTarget() {
	if m.service != nil {
		target := *m.service
		target.configPath, target.egressPath = m.configPath, m.egressPath
		m.service = &target
		return
	}
	m.service, m.serviceErr = newManagedService(m.configPath, m.egressPath, os.Stdin, m.out)
}
