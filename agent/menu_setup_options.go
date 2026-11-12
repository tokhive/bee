package bee

type menuSetupOptions struct {
	platform, codexHome string
	claudeDir, proxy    *string
	all                 bool
}

func (m *managementMenu) accountSetup(offerNext bool) error {
	fixed := m.setupTargetFixed
	m.setupTargetFixed = fixed || !offerNext
	defer func() { m.setupTargetFixed = fixed }()
	for {
		m.page(m.text("Select supplied accounts", "选择供给账号"))
		m.configurationPaths()
		platform := platformName(m.setup.platform)
		if platform == "" {
			platform = m.text("Both platforms", "两个平台")
		}
		m.field("Platforms", "检测平台", platform)
		m.field("Codex directory", "Codex 目录", m.setup.codexHome)
		m.field("Claude directory", "Claude 目录", m.optionalValue(m.setup.claudeDir))
		m.field("Proxy selection", "代理选项", m.optionalValue(m.setup.proxy))
		m.option(1, m.text("Choose accounts individually", "逐个选择账号"))
		m.option(2, m.text("Select all usable accounts", "选择全部可用账号"))
		m.option(3, m.text("Configuration options", "修改配置选项"))
		m.option(0, m.text("Back", "返回上级"))
		n, err := m.choose(m.text("Select [0–3]: ", "请选择 [0–3]："), 3)
		if err != nil {
			return err
		}
		switch n {
		case 0:
			return m.back()
		case 3:
			if err = m.setupOptions(); err != nil {
				return err
			}
		default:
			m.setup.all = n == 2
			return m.configureAccountsWithNext(offerNext)
		}
	}
}

func (m *managementMenu) setupOptions() error {
	actions := []menuAction{
		{"Supply file", "供给配置文件", m.selectEgress},
		{"Platforms to detect", "检测的平台", func() error {
			m.option(1, "OpenAI (Codex)")
			m.option(2, "Claude Code")
			m.option(3, m.text("Both", "两者"))
			m.option(0, m.text("Cancel", "取消"))
			n, err := m.choose(m.text("Select [0–3]: ", "请选择 [0–3]："), 3)
			if err != nil {
				return err
			}
			if n != 0 {
				m.setup.platform = []string{"openai", "claude", ""}[n-1]
			}
			return m.back()
		}},
		{"Codex directory", "Codex 官方客户端目录", func() error {
			value, ok, err := m.optionalInput(&m.setup.codexHome, "Codex directory", "Codex 目录")
			if err != nil || !ok {
				return err
			}
			m.setup.codexHome = ""
			if value != nil {
				m.setup.codexHome = *value
			}
			return m.back()
		}},
		{"Claude Code directory", "Claude Code 官方客户端目录", func() error {
			m.note("Omitted follows existing settings/environment; explicit empty selects the official default. Use the literal directory string.", "未指定时沿用已有设置或环境；明确空值时使用官方默认目录。请输入目录原文。")
			value, ok, err := m.optionalInput(m.setup.claudeDir, "Claude directory", "Claude 目录")
			if err != nil || !ok {
				return err
			}
			m.setup.claudeDir = value
			return m.back()
		}},
		{"HTTP CONNECT proxy", "本地 HTTP CONNECT 代理", func() error {
			m.note("Use a loopback HTTP proxy, such as http://127.0.0.1:7890. Omitted keeps the saved proxy; explicit empty removes it.", "使用本机 HTTP 代理，例如 http://127.0.0.1:7890。未指定时保留已保存的代理；明确空值会清除代理。")
			value, ok, err := m.optionalInput(m.setup.proxy, "Proxy", "代理")
			if err != nil || !ok {
				return err
			}
			if value != nil && *value != "" {
				if _, err = localConnectProxy(*value); err != nil {
					return failCause("BEE-CONFIG-PROXY", err)
				}
			}
			m.setup.proxy = value
			return m.back()
		}},
	}
	if m.setupTargetFixed {
		actions = actions[1:]
	}
	return m.loop(m.text("Account configuration options", "账号配置选项"), actions)
}

func (m *managementMenu) optionalValue(value *string) string {
	if value == nil {
		return m.text("Not specified · keep existing / use environment", "未指定 · 沿用已有设置或环境")
	}
	if *value == "" {
		return m.text("Explicit empty · override existing / environment", "明确空值 · 覆盖已有设置或环境")
	}
	return *value
}

// A pointer distinguishes omission from an explicit empty CLI flag. Claude's
// keychain namespace uses the exact directory string, so do not clean it.
func (m *managementMenu) optionalInput(current *string, en, zh string) (*string, bool, error) {
	m.field(en, zh, m.optionalValue(current))
	m.option(1, m.text("Leave unspecified", "不指定"))
	m.option(2, m.text("Explicit empty value", "明确设置为空"))
	m.option(3, m.text("Set a value", "输入具体值"))
	m.option(0, m.text("Cancel", "取消"))
	n, err := m.choose(m.text("Select [0–3]: ", "请选择 [0–3]："), 3)
	if err != nil {
		return nil, false, err
	}
	switch n {
	case 0:
		return nil, false, m.back()
	case 1:
		return nil, true, nil
	case 2:
		empty := ""
		return &empty, true, nil
	default:
		value, err := m.rawLine(m.text("Value (0 cancels): ", "请输入值（0 取消）："))
		if err != nil {
			return nil, false, err
		}
		if value == "0" {
			return nil, false, m.back()
		}
		return &value, true, nil
	}
}
