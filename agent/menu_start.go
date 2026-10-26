package bee

import (
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/tokhive/bee/logx"
)

func (m *managementMenu) starts() error {
	// Like bee start, the ordinary start action uses the adjacent egress.json.
	egress, explicit, service, serviceErr, fixed := m.egressPath, m.egressExplicit, m.service, m.serviceErr, m.setupTargetFixed
	defer func() {
		m.egressPath, m.egressExplicit, m.service, m.serviceErr, m.setupTargetFixed = egress, explicit, service, serviceErr, fixed
	}()
	m.egressPath, m.egressExplicit = defaultEgressPath(m.configPath), false
	m.setupTargetFixed = true
	m.refreshServiceTarget()
	m.page(m.text("Start Bee", "启动 Bee"))
	m.configurationPaths()
	state, err := m.serviceState()
	if err != nil && !errors.Is(err, errServiceUnavailable) {
		return err
	}
	background := err == nil
	if background {
		if state.ActiveState == "active" {
			m.ui.status(m.out, "✅", "32", "Bee is already running in the background.", "Bee 已在后台运行。")
			return m.back()
		}
		if state.ActiveState != "inactive" && state.ActiveState != "failed" {
			return fmt.Errorf("tokhive-bee ActiveState=%q; wait for a stable service state before start", state.ActiveState)
		}
		m.note("Bee will run in the background; closing this terminal will not stop it.", "将自动在后台运行；关闭终端后 Bee 仍会运行。")
	} else {
		m.note("No supported background service is available. Bee will run in this terminal; closing it or pressing Ctrl+C stops Bee.", "当前没有可用的后台服务，将在本终端运行；关闭终端或按 Ctrl+C 会停止 Bee。")
	}
	m.note("Would you like guidance before starting? Existing configuration will be kept.", "启动前是否需要引导配置？已有配置会保留。")
	m.option(1, m.text("Yes, complete missing configuration", "需要，引导补齐配置"))
	m.option(2, m.text("No, start with existing configuration", "不需要，使用已有配置启动"))
	m.option(0, m.text("Back", "返回上级"))
	choice, err := m.choose(m.text("Select [0–2]: ", "请选择 [0–2]："), 2)
	if err != nil {
		return err
	}
	if choice == 0 {
		return m.back()
	}
	if choice == 1 {
		ready, err := m.prepareStart()
		if err != nil || !ready {
			return err
		}
	}
	if !background {
		return m.runForeground(false)
	}
	if err := m.requirePairing(); err != nil {
		return err
	}
	if _, err := readEgress(m.ctx, m.egressPath); err != nil {
		return err
	}
	state, err = m.service.apply(m.ctx, "start")
	if err != nil {
		return err
	}
	m.printServiceState(state)
	m.ui.status(m.out, "✅", "32", "Bee is running in the background. You can close this terminal.", "Bee 已在后台运行，可以关闭终端。")
	return m.back()
}

func (m *managementMenu) prepareStart() (bool, error) {
	state, err := readState(m.configPath)
	if err != nil {
		return false, err
	}
	if state.Identity == nil {
		m.note("Pair this device", "设备配对")
		navigation := m.navigation
		if m.pair != nil {
			err = m.pair()
		} else {
			err = m.pairingWithNext(false)
		}
		if err != nil {
			return false, err
		}
		if m.navigation != navigation {
			return false, nil
		}
		if err = m.requirePairing(); err != nil {
			return false, err
		}
	}
	if _, err = os.Lstat(m.egressPath); os.IsNotExist(err) {
		m.note("Select supplied accounts", "选择供给账号")
		if m.configure != nil {
			err = m.configure()
		} else {
			err = m.accountSetup(false)
		}
		if err != nil {
			return false, err
		}
		if _, err = os.Lstat(m.egressPath); os.IsNotExist(err) {
			m.note("No supply configuration saved; Bee has not started.", "尚未保存供给配置，Bee 未启动。")
			return false, m.back()
		} else if err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	}
	if _, err = readEgress(m.ctx, m.egressPath); err != nil {
		return false, err
	}
	return true, nil
}

func (m *managementMenu) foreground() error {
	return m.runForeground(true)
}

func (m *managementMenu) runForeground(confirm bool) error {
	m.page(m.text("Foreground run", "前台运行"))
	if err := m.requirePairing(); err != nil {
		return err
	}
	state, err := m.readDevice()
	if err != nil {
		return err
	}
	m.field("Hive", "市场地址", state.Hive)
	m.configurationPaths()
	args := []string{"run", "--config", m.configPath}
	// Absence of the default file means presence only, exactly like bee run.
	if _, err = os.Lstat(m.egressPath); err == nil || m.egressExplicit {
		if _, err = readEgress(m.ctx, m.egressPath); err != nil {
			return err
		}
		args = append(args, "--egress-config", m.egressPath)
	} else if !os.IsNotExist(err) {
		return err
	} else {
		m.note("No supply configuration: Bee stays online without supplying accounts.", "没有供给配置：Bee 仅保持在线，不供给账号。")
	}
	m.note("This terminal stays occupied. Ctrl+C stops this foreground Bee and exits; run bee again to reopen the menu.", "本终端将持续运行 Bee。Ctrl+C 停止本次前台 Bee 并退出；再次输入 bee 可重新打开菜单。")
	if confirm {
		ok, err := m.confirm(m.text("Start foreground Bee now?", "现在启动前台 Bee？"))
		if err != nil || !ok {
			return err
		}
	}
	m.note("Runtime logs (original):", "运行日志（原文）：")
	previous := slog.Default()
	if logx.Readable(os.Stderr) {
		slog.SetDefault(slog.New(logx.Friendly(os.Stderr, slog.LevelWarn)))
	}
	defer slog.SetDefault(previous)
	if err = run(m.ctx, args, m.out); err != nil {
		return err
	}
	fmt.Fprintln(m.out, m.text("Foreground Bee stopped.", "本次前台 Bee 已停止。"))
	return m.ctx.Err()
}
