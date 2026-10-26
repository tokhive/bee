package bee

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/tokhive/bee/logx"
)

func (m *managementMenu) starts() error {
	return m.loop(m.text("Start Bee", "启动 Bee"), []menuAction{
		{"Guided setup and start", "引导配置并启动", m.guidedStart},
		{"Run existing configuration in foreground", "按现有配置前台运行", m.foreground},
		{"Start background service", "启动后台服务", func() error {
			if _, err := m.serviceState(); err != nil {
				m.serviceNotice(err)
				m.next(m.text("Choose Start Bee → Run existing configuration in foreground.", "选择「启动 Bee → 按现有配置前台运行」。"))
				return nil
			}
			return m.serviceAction("start")
		}},
	})
}

func (m *managementMenu) guidedStart() error {
	// bee start always uses egress.json beside the selected device file.
	egress, explicit, service, fixed := m.egressPath, m.egressExplicit, m.service, m.setupTargetFixed
	defer func() {
		m.egressPath, m.egressExplicit, m.service, m.setupTargetFixed = egress, explicit, service, fixed
	}()
	m.egressPath, m.egressExplicit = defaultEgressPath(m.configPath), false
	m.setupTargetFixed = true
	m.refreshServiceTarget()
	m.page(m.text("Guided setup and start", "引导配置并启动"))
	m.configurationPaths()
	state, err := readState(m.configPath)
	if err != nil {
		return err
	}
	if state.Identity == nil {
		m.note("[1/3] Pair this device", "[1/3] 设备配对")
		navigation := m.navigation
		if m.pair != nil {
			err = m.pair()
		} else {
			err = m.pairingWithNext(false)
		}
		if err != nil {
			return err
		}
		if m.navigation != navigation {
			return nil
		}
		if err = m.requirePairing(); err != nil {
			return err
		}
	}
	if _, err = os.Lstat(m.egressPath); os.IsNotExist(err) {
		m.note("[2/3] Select supplied accounts", "[2/3] 选择供给账号")
		if m.configure != nil {
			err = m.configure()
		} else {
			err = m.accountSetup(false)
		}
		if err != nil {
			return err
		}
		if _, err = os.Lstat(m.egressPath); os.IsNotExist(err) {
			m.note("No supply configuration saved; Bee has not started.", "尚未保存供给配置，Bee 未启动。")
			return m.back()
		} else if err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err = readEgress(m.ctx, m.egressPath); err != nil {
		return err
	}
	m.note("[3/3] Choose how to run Bee", "[3/3] 选择运行方式")
	m.option(1, m.text("Foreground · Ctrl+C stops this Bee and exits", "前台运行 · Ctrl+C 停止本次 Bee 并退出"))
	m.option(2, m.text("Background service · returns to menu after starting", "后台服务 · 启动后返回菜单"))
	m.option(0, m.text("Back", "返回上级"))
	choice, err := m.choose(m.text("Select [0–2]: ", "请选择 [0–2]："), 2)
	if err != nil {
		return err
	}
	switch choice {
	case 1:
		return m.foreground()
	case 2:
		return m.serviceAction("start")
	default:
		return m.back()
	}
}

func (m *managementMenu) foreground() error {
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
	ok, err := m.confirm(m.text("Start foreground Bee now?", "现在启动前台 Bee？"))
	if err != nil || !ok {
		return err
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
