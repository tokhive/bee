package bee

import (
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/tokhive/bee/beewire"
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
	ready, err := m.prepareStart()
	if err != nil || !ready {
		return err
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
	if state.Credential != "" {
		state, err = m.readDevice()
		if err != nil {
			return false, failCause("BEE-DEVICE-CONFIG", err)
		}
	} else if state.Identity != nil || state.Pairing != nil {
		return false, failf("BEE-DEVICE-CONFIG", "%s: credential is missing from saved pairing", m.configPath)
	}
	// Inspect both files before entering any flow that can change configuration.
	_, err = readEgress(m.ctx, m.egressPath)
	var problem *codedError
	missingSupply := errors.As(err, &problem) && problem.code == "BEE-CONFIG-NOT-FOUND"
	if err != nil && !missingSupply {
		return false, err
	}
	ready, err := m.prepareStartPairing(state)
	if err != nil || !ready {
		return false, err
	}
	if missingSupply {
		m.note("Supply configuration is missing. Select supplied accounts to continue.", "尚无供给配置，请选择供给账号后继续。")
		if m.configure != nil {
			err = m.configure()
		} else {
			err = m.accountSetup(false)
		}
		if err != nil {
			return false, err
		}
	}
	if _, err = readEgress(m.ctx, m.egressPath); err != nil {
		if errors.As(err, &problem) && problem.code == "BEE-CONFIG-NOT-FOUND" {
			m.note("No supply configuration saved; Bee has not started.", "尚未保存供给配置，Bee 未启动。")
			return false, m.back()
		}
		return false, err
	}
	return true, nil
}

func (m *managementMenu) prepareStartPairing(state localState) (bool, error) {
	reset := false
	if state.Identity != nil {
		m.ui.status(m.out, "⏳", "33", "Checking device pairing…", "正在验证设备配对…")
		var identity beewire.Identity
		err := call(m.ctx, httpClient(), state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity)
		if err == nil {
			return true, nil
		}
		var failure *apiFailure
		if !errors.As(err, &failure) || (failure.Status != 401 && failure.Status != 403) ||
			(failure.Code != "device_replaced" && failure.Code != "invalid_device_credential") {
			return false, fmt.Errorf(m.text("Verify device at %s (configuration kept): %w", "验证设备 %s（已保留配置）：%w"), state.Hive, hiveProblem(err))
		}
		p, _ := m.apiProblem(failure)
		m.ui.status(m.out, "⚠️", "33", p.cause, p.cause)
		m.field("Response", "响应信息", fmt.Sprintf("HTTP %d · %s", failure.Status, failure.Code))
		m.note("Pairing is no longer valid. Follow the steps to pair again; changes require confirmation.", "原配对已失效，接下来重新配对；确认后才会修改配置。")
		reset = true
	} else {
		m.note("Device pairing is missing or unfinished. Complete pairing to continue.", "设备尚未完成配对，接下来完成配对。")
	}
	navigation := m.navigation
	if err := m.pairingFlow(state, reset, false); err != nil {
		return false, err
	}
	if m.navigation != navigation {
		return false, nil
	}
	if err := m.requirePairing(); err != nil {
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
	m.note("Keep this terminal open. Press Ctrl+C to stop Bee and exit; run bee again to reopen the menu.", "请保持此终端打开。按 Ctrl+C 停止 Bee 并退出；再次输入 bee 打开菜单。")
	if confirm {
		ok, err := m.confirm(m.text("Start foreground Bee now?", "现在启动前台 Bee？"))
		if err != nil || !ok {
			return err
		}
	}
	m.ui.status(m.out, "⏳", "1;33", "Starting Bee…", "正在启动 Bee…")
	m.note("Runtime logs (original):", "运行日志（原文）：")
	console := newConsole(m.out)
	console.onConnected = func() {
		fmt.Fprintln(m.out)
		m.ui.status(m.out, "✅", "1;32", "Bee is running… (connected to Hive)", "Bee 持续运行中…（已连接 Hive）")
		fmt.Fprintln(m.out)
	}
	previous := slog.Default()
	if logx.Readable(os.Stderr) {
		slog.SetDefault(slog.New(logx.Friendly(os.Stderr, slog.LevelWarn)))
	}
	defer slog.SetDefault(previous)
	if err = run(m.ctx, args, console); err != nil {
		return err
	}
	fmt.Fprintln(m.out, m.text("Foreground Bee stopped.", "本次前台 Bee 已停止。"))
	return m.ctx.Err()
}
