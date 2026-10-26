package bee

import (
	"fmt"
	"os"

	"github.com/tokhive/bee/beewire"
)

func (m *managementMenu) status() error {
	m.page(m.text("Status", "运行状态"))
	m.field("Version", "程序版本", versionLine())
	m.field("Configuration", "设备配置", m.configPath)
	state, e := m.serviceState()
	if e != nil {
		m.serviceNotice(e)
	} else {
		m.printServiceState(state)
	}
	device, e := m.readDevice()
	if e != nil {
		return e
	}
	m.field("Hive", "市场地址", device.Hive)
	var identity beewire.Identity
	if e = call(m.ctx, httpClient(), device.Hive, "/api/bee/identity", "GET", device.Credential, nil, &identity); e != nil {
		m.note("Account readiness could not be queried because device verification failed.", "设备验证失败，账号接单状态暂时无法查询。")
		return e
	}
	m.ui.status(m.out, "✅", "32", "Device pairing verified", "设备配对有效")
	m.field("Device", "设备名称", identity.Name)
	m.field("Owner", "所属账号", identity.OwnerEmail)
	if !fileExists(m.egressPath) {
		fmt.Fprintln(m.out, m.text("No supplied accounts selected; choose Manage accounts.", "尚未选择供给账号，请进入账号管理。"))
		return nil
	}
	cfg, e := readEgress(m.ctx, m.egressPath)
	if e != nil {
		return e
	}
	for _, p := range configuredPlatforms(cfg) {
		a, err := readPlatformAccount(m.ctx, device, p)
		if err != nil {
			m.field("Platform", "供给平台", platformName(p))
			m.reportError(err)
			continue
		} else {
			m.printAccount(a)
		}
		if e = m.showPlatform(device, p); e != nil {
			m.reportError(e)
		}
	}
	return nil
}
func (m *managementMenu) showPlatform(device localState, p string) error {
	var supply beewire.PlatformSupply
	if e := call(m.ctx, httpClient(), device.Hive, "/api/bee/platforms/"+p, "GET", device.Credential, nil, &supply); e != nil {
		return e
	}
	if supply.Platform != p {
		return fmt.Errorf("Hive platform=%q; expected %q", supply.Platform, p)
	}
	ready := m.text("not taking work", "暂不可接单")
	if supply.Ready {
		ready = m.text("taking new work", "可以接收新任务")
	}
	icon, color := "⚠️", "33"
	if supply.Ready {
		icon, color = "✅", "32"
	}
	m.ui.status(m.out, icon, color, platformName(p)+": "+ready, platformName(p)+"："+ready)
	m.field("Manually paused", "手动暂停", m.yesNo(supply.Paused))
	for _, r := range supply.Reasons {
		fmt.Fprintf(m.out, "  %s %s\n", m.reason(r), m.styled("90", "["+r+"]"))
	}
	return nil
}
func (m *managementMenu) reason(r string) string {
	if m.ui.lang == "zh" {
		if zh, ok := map[string]string{
			"codex_authorization_rejected": "Codex 授权被上游拒绝", "claude_authorization_rejected": "Claude 授权被上游拒绝",
			"codex_source_unavailable": "等待官方 Codex 登录恢复", "claude_source_unavailable": "等待官方 Claude Code 登录恢复",
			"codex_confirmation_required": "OpenAI 账号已变更，等待确认", "claude_confirmation_required": "Claude 账号已变更，等待确认",
		}[r]; ok {
			return zh
		}
		if zh, ok := map[string]string{"manually_paused": "已手动暂停接单", "offline": "Bee 离线", "not_configured": "尚未注册账号，或市场未开放该平台", "concurrency_full": "已达到并发上限", "quota_exhausted": "账号额度已用尽", "rate_limited": "上游限流冷却中", "plan_not_configured": "管理员尚未配置套餐限制", "authorization_unavailable": "暂无有效的在线授权", "capabilities_unknown": "账号能力未知或已过期", "quota_unknown": "正在等待新的额度查询", "model_unavailable": "模型当前不可交易", "banned": "已被管理员禁用", "device_draining": "设备替换中，等待当前任务完成"}[r]; ok {
			return zh
		}
	}
	if label, ok := supplyReasonLabels[r]; ok {
		return label
	}
	return r
}
func (m *managementMenu) diagnostics() error {
	m.page(m.text("Diagnostics", "运行诊断"))
	egressPath := m.egressPath
	if _, err := os.Lstat(egressPath); os.IsNotExist(err) {
		egressPath = ""
	}
	report := diagnose(m.ctx, m.configPath, egressPath)
	labels := map[string]string{"pass": m.text("OK", "通过"), "warn": m.text("Warning", "提醒"), "fail": m.text("Failed", "失败"), "skip": m.text("Skipped", "跳过")}
	names := map[string]string{"device": m.text("Device", "设备配对"), "egress": m.text("Supply configuration", "供给配置"), "authorization": m.text("Authorization", "账号授权"), "hive": "Hive", "account": m.text("Account", "账号"), "supply": m.text("Supply", "接单")}
	for _, c := range report.Checks {
		name := names[c.Name]
		if name == "" {
			name = c.Name
		}
		if c.Platform != "" {
			name += " · " + platformName(c.Platform)
		}
		icon, color := "✅", "32"
		switch c.Status {
		case "warn":
			icon, color = "⚠️", "33"
		case "fail":
			icon, color = "❌", "31"
		case "skip":
			icon, color = "·", "90"
		}
		heading := name + " · " + labels[c.Status]
		m.ui.status(m.out, icon, color, heading, heading)
		if c.Status == "pass" {
			continue
		}
		if c.skipReason != "" {
			why := doctorSkipReasons[c.skipReason]
			m.note(why.en, why.zh)
		} else if c.err != nil {
			m.diagnosticError(c.err)
		} else if c.reason != "" {
			m.note(m.reason(c.reason), m.reason(c.reason))
			m.field("Reason code", "原因标识", c.Code)
			if m.ui.lang == "en" {
				m.next(c.Fix)
			} else {
				m.next(m.reasonFix(c.reason, c.Admin))
			}
			if m.reason(c.reason) == c.reason {
				m.details(c.Detail + "\n" + c.Fix)
			}
		} else {
			m.details(c.Detail + "\n" + c.Fix)
		}
	}
	if report.OK {
		m.note("No blocking problems found.", "检查完成，未发现阻断问题。")
	} else {
		m.note("Follow the steps above to resolve the failed checks.", "请根据上方原因和下一步处理未通过的检查。")
	}
	return nil
}

func (m *managementMenu) diagnosticError(err error) {
	// The row above already carries severity, including non-blocking warnings.
	if e, ok := err.(*codedError); ok {
		if p, known := m.catalogProblem(e.code); known {
			m.note(p.cause, p.cause)
			m.field("Error code", "错误标识", e.code)
			if e.cause != nil {
				m.reportCause(e.cause)
			} else {
				m.details(e.detail)
			}
			m.next(p.fix)
			return
		}
	}
	m.details(err.Error())
}

func (m *managementMenu) reasonFix(reason string, admin bool) string {
	if admin {
		return "请联系 Hive 管理员处理套餐、模型或禁用状态。"
	}
	switch reason {
	case "manually_paused":
		return "选择「供给账号 → 恢复接单」。"
	case "offline":
		return "启动 Bee，并检查与 Hive 的连接。"
	case "not_configured":
		return "选择供给账号并重启 Bee；已配置时，请向管理员确认市场是否开放该平台。"
	case "codex_confirmation_required", "claude_confirmation_required":
		return "选择「供给账号 → 确认账号变更」，检查待确认的账号。"
	case "codex_authorization_rejected", "codex_source_unavailable":
		return "运行 codex login 恢复官方登录，等待 Bee 同步。"
	case "claude_authorization_rejected", "claude_source_unavailable":
		return "运行 claude 恢复官方登录，等待 Bee 同步。"
	case "device_draining":
		return "等待当前任务和结算完成。"
	case "concurrency_full":
		return "等待当前任务完成以释放并发名额。"
	case "quota_exhausted":
		return "等待账号额度恢复。"
	case "rate_limited":
		return "等待上游限流冷却结束。"
	case "model_unavailable":
		return "检查官方账号的套餐；套餐符合要求时，向管理员确认市场开放的模型。"
	case "authorization_unavailable":
		return "检查官方账号登录状态和 Bee 连接，等待授权同步。"
	case "capabilities_unknown", "quota_unknown":
		return "保持 Bee 在线并启用能力上报，等待能力或额度查询更新。"
	}
	return ""
}
