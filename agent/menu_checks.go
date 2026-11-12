package bee

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

type menuCheckOptions struct {
	codex       codexSource
	claudeDir   *string
	claudeStore string
}

func (m *managementMenu) codexChecks() error {
	if m.checks.codex.Store == "" {
		m.checks.codex.Store = "file"
	}
	return m.loop(m.text("Codex checks", "Codex 检查"), []menuAction{
		{"Local sign-in · no network", "本地登录检查 · 不联网", func() error { return m.checkCodex(false) }},
		{"Official models and subscription limits · online", "官方模型与订阅额度 · 联网查询", func() error { return m.checkCodex(true) }},
		{"Directory and credential store", "目录与凭证存储", m.codexCheckOptions},
	})
}

func (m *managementMenu) codexCheckOptions() error {
	return m.loop(m.text("Codex check options", "Codex 检查选项"), []menuAction{
		{"Official client directory", "官方客户端目录", func() error {
			value, ok, err := m.pathInput(m.codexCheckSource().Home)
			if err != nil || !ok {
				return err
			}
			m.checks.codex.Home = value
			return m.back()
		}},
		{"Credential store", "凭证存储", func() error {
			m.field("Current store", "当前存储", m.checks.codex.Store)
			m.field("Keyring backend", "钥匙串后端", "direct")
			m.note("Direct keyring reading is supported on macOS. On Linux, keyring and auto report an unsupported-source error.", "直接读取钥匙串仅支持 macOS；Linux 的 keyring 和 auto 会报告来源不受支持。")
			for i, name := range []string{"file", "keyring", "auto"} {
				m.option(i+1, name)
			}
			m.option(0, m.text("Cancel", "取消"))
			n, err := m.choose(m.text("Select [0–3]: ", "请选择 [0–3]："), 3)
			if err != nil {
				return err
			}
			if n != 0 {
				m.checks.codex.Store = []string{"file", "keyring", "auto"}[n-1]
			}
			return m.back()
		}},
	})
}

func (m *managementMenu) codexCheckSource() codexSource {
	source := m.checks.codex
	if source.Home == "" {
		source.Home = os.Getenv("CODEX_HOME")
	}
	if source.Home == "" {
		if home, err := os.UserHomeDir(); err == nil {
			source.Home = filepath.Join(home, ".codex")
		}
	}
	if source.Store == "" {
		source.Store = "file"
	}
	source.KeyringBackend = "direct"
	return source
}

func (m *managementMenu) checkCodex(capabilities bool) error {
	m.page(m.text("Codex check", "Codex 检查"))
	source := m.codexCheckSource()
	m.field("Directory", "客户端目录", source.Home)
	m.field("Store", "凭证存储", source.Store)
	m.field("Keyring backend", "钥匙串后端", source.KeyringBackend)
	report, err := readCodexStatus(m.ctx, source, capabilities)
	if err != nil {
		return err
	}
	m.showSignIn(report)
	if snapshot, ok := report["capabilities"].(beewire.Capabilities); ok {
		m.showCapabilities(snapshot)
	}
	if reason, ok := report["capabilities_unknown_reason"].(string); ok {
		m.details(reason)
	}
	return nil
}

func (m *managementMenu) claudeChecks() error {
	if m.checks.claudeStore == "" {
		m.checks.claudeStore = defaultClaudeStore()
	}
	return m.loop(m.text("Claude Code checks", "Claude Code 检查"), []menuAction{
		{"Local sign-in · no network", "本地登录检查 · 不联网", func() error { return m.checkClaude("local") }},
		{"Official account identity · online", "官方账号身份 · 联网验证", func() error { return m.checkClaude("verify") }},
		{"Official models and subscription limits · online", "官方模型与订阅额度 · 联网查询", func() error { return m.checkClaude("capabilities") }},
		{"Directory and credential store", "目录与凭证存储", m.claudeCheckOptions},
	})
}

func (m *managementMenu) claudeCheckOptions() error {
	return m.loop(m.text("Claude Code check options", "Claude Code 检查选项"), []menuAction{
		{"Official client directory", "官方客户端目录", func() error {
			m.note("Omitted follows the environment; explicit empty selects the official default. Use the literal directory string.", "未指定时遵循环境；明确空值时使用官方默认目录。请输入目录原文。")
			value, ok, err := m.optionalInput(m.checks.claudeDir, "Directory", "目录")
			if err != nil || !ok {
				return err
			}
			m.checks.claudeDir = value
			return m.back()
		}},
		{"Credential store", "凭证存储", func() error {
			m.field("Current store", "当前存储", m.checks.claudeStore)
			m.field("Operating system", "操作系统", runtime.GOOS)
			m.option(1, "file (.credentials.json)")
			m.option(2, m.text("keychain · macOS only", "keychain · 仅 macOS"))
			m.option(0, m.text("Cancel", "取消"))
			n, err := m.choose(m.text("Select [0–2]: ", "请选择 [0–2]："), 2)
			if err != nil {
				return err
			}
			if n != 0 {
				m.checks.claudeStore = []string{"file", "keychain"}[n-1]
			}
			return m.back()
		}},
	})
}

func (m *managementMenu) checkClaude(mode string) error {
	m.page(m.text("Claude Code check", "Claude Code 检查"))
	store := m.checks.claudeStore
	if store == "" {
		store = defaultClaudeStore()
	}
	source, err := resolveClaudeStore(store, m.checks.claudeDir)
	if err != nil {
		return err
	}
	m.field("Directory", "客户端目录", source.directory)
	m.field("Store", "凭证存储", source.kind)
	if mode == "capabilities" {
		snapshot, err := readClaudeCapabilities(m.ctx, source.read, nil)
		if err != nil {
			return err
		}
		m.note("Official account identity verified.", "官方身份已验证。")
		m.showCapabilities(snapshot)
		return nil
	}
	report, err := readClaudeStatus(m.ctx, source.kind, source.read, mode == "verify", nil)
	if err != nil {
		return err
	}
	m.showSignIn(report)
	return nil
}

func (m *managementMenu) showSignIn(report map[string]any) {
	fields := []struct{ key, en, zh string }{
		{"source", "Source", "凭证来源"}, {"status", "Local status", "本地状态"},
		{"account_fingerprint", "Account fingerprint", "账号指纹"}, {"plan", "Plan", "订阅方案"},
		{"expires_at", "Expires at", "有效期至"}, {"validation", "Validation", "验证方式"},
		{"refresh_token_present", "Refresh token present", "持有刷新凭证"}, {"inference_scope", "Inference permission", "推理权限"}, {"profile_scope", "Profile permission", "身份查询权限"},
	}
	labels := map[string]string{
		"local_structure_only":      m.text("Local structure check only; no online identity verification", "仅本地结构检查；尚未在线验证身份"),
		"official_profile_verified": m.text("Official identity verified", "官方身份已验证"),
		"available":                 m.text("Available locally", "本地可用"), "expired": m.text("Expired", "已过期"),
		"missing_inference_scope": m.text("Missing inference permission", "缺少推理权限"), "unknown": m.text("Unknown", "未知"),
	}
	for _, f := range fields {
		value, ok := report[f.key]
		if !ok {
			continue
		}
		display := fmt.Sprint(value)
		if boolean, ok := value.(bool); ok {
			display = m.yesNo(boolean)
		} else if label, ok := labels[display]; ok {
			display = label
		}
		m.field(f.en, f.zh, display)
	}
}

func (m *managementMenu) showCapabilities(snapshot beewire.Capabilities) {
	status := snapshot.Status
	if label, ok := map[string]string{"ready": m.text("Available", "可用"), "unknown": m.text("Unknown", "未知"), "rate_limited": m.text("Rate limited", "查询被限流")}[status]; ok {
		status = label
	}
	m.field("Capabilities", "账号能力", status)
	m.field("Plan", "订阅方案", snapshot.Plan)
	m.field("Official client version", "官方客户端版本", snapshot.ClientVersion)
	m.field("Models", "可用模型", strings.Join(snapshot.Models, ", "))
	if !snapshot.ObservedAt.IsZero() {
		m.field("Observed at", "查询时间", snapshot.ObservedAt.Local().Format(time.RFC3339))
	}
	if snapshot.RetryAt != nil {
		m.field("Retry after", "可重试时间", snapshot.RetryAt.Local().Format(time.RFC3339))
	}
	for _, window := range snapshot.Windows {
		used := m.text("unknown", "未知")
		if window.UsedPercent != nil {
			used = fmt.Sprintf("%d%%", *window.UsedPercent)
		}
		scope := window.Scope
		if scope == "" {
			scope = m.text("all models", "全部模型")
		}
		m.note(fmt.Sprintf("Quota · %s · %ds · used %s · resets %s", scope, window.Seconds, used, window.ResetAt.Local().Format(time.RFC3339)), fmt.Sprintf("额度 · %s · %d 秒 · 已用 %s · 重置于 %s", scope, window.Seconds, used, window.ResetAt.Local().Format(time.RFC3339)))
	}
}
