package bee

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tokhive/bee/beewire"
)

func (m *managementMenu) pairing() error {
	return m.pairingWithNext(true)
}

// Service actions own their next step; direct pairing can offer account setup.
func (m *managementMenu) pairingWithNext(offerNext bool) error {
	m.page(m.text("Device pairing", "设备配对"))
	state, err := readState(m.configPath)
	if err != nil {
		return fmt.Errorf("read device %s: %w", m.configPath, err)
	}
	reset := false
	if state.Credential != "" {
		fmt.Fprintf(m.out, m.text("Current Hive: %s\nDevice: %s\n  1) Validate / continue pairing\n  2) Pair again\n  0) Back\n", "当前 Hive：%s\n设备：%s\n  1) 验证 / 继续配对\n  2) 重新配对\n  0) 返回\n"), state.Hive, state.Name)
		n, e := m.choose(m.text("Select [0–2]: ", "请选择 [0–2]："), 2)
		if e != nil {
			return e
		}
		if n == 0 {
			return m.back()
		}
		reset = n == 2
		if !reset && state.Identity != nil {
			device, e := m.readDevice()
			if e != nil {
				return e
			}
			var identity beewire.Identity
			if e = call(m.ctx, httpClient(), device.Hive, "/api/bee/identity", "GET", device.Credential, nil, &identity); e != nil {
				return fmt.Errorf(m.text("Verify device (configuration kept): %w", "验证设备（已保留配置）：%w"), e)
			}
			fmt.Fprintf(m.out, m.text("Pairing valid: %s (%s)\n", "配对有效：%s（%s）\n"), identity.Name, identity.OwnerEmail)
			return nil
		}
	}
	var snapshot []byte
	if reset {
		snapshot, err = os.ReadFile(m.configPath)
		if err != nil {
			return err
		}
	}
	hive := state.Hive
	name := state.Name
	if state.Credential == "" || reset {
		for {
			prompt := m.text("Hive address (0 cancels)", "请输入 Hive 地址（0 取消）")
			if hive != "" {
				prompt += " [" + hive + "]"
			}
			a, e := m.line(prompt + ": ")
			if e != nil {
				return e
			}
			if a == "0" {
				return m.back()
			}
			if a == "" {
				a = hive
			}
			origin, e := hiveOrigin(a)
			if e != nil {
				m.reportError(e)
				continue
			}
			hive = origin
			break
		}
		value, e := m.line(m.text("Device name (Enter uses current name or hostname; 0 cancels): ", "设备名称（回车使用已有名称或主机名；0 取消）："))
		if e != nil {
			return e
		}
		if value == "0" {
			return m.back()
		}
		if value != "" {
			name = value
		}
		if name == "" {
			name, e = os.Hostname()
			if e != nil {
				return e
			}
		}
		summary := fmt.Sprintf(m.text("Pair device %q with %s?", "将设备 %q 配对到 %s？"), name, hive)
		if reset {
			summary += "\n" + m.text("The old device configuration will be backed up. Supplied account choices are kept. The matching local service will stop. Confirming replacement in Hive can deactivate another Bee.", "旧设备配置将备份，保留供给账号选择，并停止匹配的本机服务。在 Hive 网页确认替换可能停用另一台 Bee。")
		}
		ok, e := m.confirm(summary)
		if e != nil || !ok {
			return e
		}
	}
	if reset {
		service, e := m.serviceState()
		if e == nil && (service.ActiveState == "active" || service.ActiveState == "failed") {
			if _, e = m.service.apply(m.ctx, "stop"); e != nil {
				return e
			}
		} else if e == nil && service.ActiveState != "inactive" {
			return fmt.Errorf("service ActiveState=%q; wait before re-pairing", service.ActiveState)
		}
		path, e := m.backupDevice(snapshot)
		if e != nil {
			return e
		}
		fmt.Fprintf(m.out, m.text("Previous device configuration backed up to %s\n", "旧设备配置已备份至 %s\n"), path)
	}
	if err = m.pairDevice(hive, name, reset || state.Credential == ""); err != nil {
		return err
	}
	if !offerNext {
		return nil
	}
	if !fileExists(m.egressPath) {
		ok, e := m.confirm(m.text("Pairing complete. Select supplied accounts now?", "配对完成。现在选择供给账号？"))
		if e != nil {
			return e
		}
		if ok {
			if e = m.accountSetup(true); e != nil {
				return e
			}
		}
	}
	if service, e := m.serviceState(); e == nil && service.ActiveState != "active" && fileExists(m.egressPath) {
		if e = m.serviceAction("start"); e != nil {
			return e
		}
		current, e := m.serviceState()
		if e != nil {
			return e
		}
		if current.ActiveState != "active" {
			fmt.Fprintln(m.out, m.text("Pairing complete; the background service has not started.", "配对完成，后台服务尚未启动。"))
		}
		return nil
	}
	fmt.Fprintln(m.out, m.text("Pairing complete. Choose Start Bee to run in foreground or background.", "配对完成。请选择「启动 Bee」，使用前台或后台运行。"))
	return nil
}

func (m *managementMenu) backupDevice(snapshot []byte) (string, error) {
	unlock, e := lockState(m.configPath)
	if e != nil {
		return "", fmt.Errorf("lock device configuration %s: %w", m.configPath, e)
	}
	defer unlock()
	if _, e = readState(m.configPath); e != nil {
		return "", e
	}
	current, e := os.ReadFile(m.configPath)
	if e != nil {
		return "", e
	}
	if !bytes.Equal(current, snapshot) {
		return "", fmt.Errorf("%s changed during confirmation; configuration was not moved", m.configPath)
	}
	directory, e := os.MkdirTemp(filepath.Dir(m.configPath), "bee.json.backup.")
	if e != nil {
		return "", fmt.Errorf("create private backup: %w", e)
	}
	path := filepath.Join(directory, "bee.json")
	if e = os.Rename(m.configPath, path); e != nil {
		return "", fmt.Errorf("back up %s to %s: %w", m.configPath, path, e)
	}
	return path, nil
}
func (m *managementMenu) pairDevice(hive, name string, expectMissing bool) error {
	unlock, e := lockState(m.configPath)
	if e != nil {
		return e
	}
	defer unlock()
	state, e := readState(m.configPath)
	if e != nil {
		return e
	}
	if expectMissing && state.Credential != "" {
		return fmt.Errorf("%s was created by another operation; existing configuration kept", m.configPath)
	}
	if state.Credential == "" {
		state, e = newDeviceState(hive, name)
		if e != nil {
			return e
		}
		if e = saveState(m.configPath, state); e != nil {
			return e
		}
	}
	if state.Hive != hive {
		return fmt.Errorf("configuration Hive=%q; expected %q", state.Hive, hive)
	}
	valid, e := hiveOrigin(state.Hive)
	if e != nil {
		return e
	}
	state.Hive = valid
	if len(state.Credential) != 47 || !strings.HasPrefix(state.Credential, "bee_") {
		return errors.New("invalid credential length in device configuration")
	}
	ui := m.ui
	ui.installer = true
	return loginWithUI(m.ctx, httpClient(), m.configPath, state, m.out, ui)
}
