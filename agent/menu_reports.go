package bee

import (
	"fmt"
	"github.com/tokhive/bee/beewire"
)

func (m *managementMenu) status() error {
	fmt.Fprintf(m.out, m.text("Bee: %s\nConfiguration: %s\n", "Bee：%s\n配置：%s\n"), versionLine(), m.configPath)
	state, e := m.serviceState()
	if e != nil {
		fmt.Fprintf(m.out, m.text("Background service unavailable: %v\n", "后台服务不可用：%v\n"), e)
	} else {
		m.printServiceState(state)
	}
	device, e := m.readDevice()
	if e != nil {
		return e
	}
	fmt.Fprintf(m.out, "Hive: %s\n", device.Hive)
	var identity beewire.Identity
	if e = call(m.ctx, httpClient(), device.Hive, "/api/bee/identity", "GET", device.Credential, nil, &identity); e != nil {
		return fmt.Errorf("Hive identity query: %w", e)
	}
	fmt.Fprintf(m.out, m.text("Device: %s\nOwner: %s\n", "设备：%s\n所属账号：%s\n"), identity.Name, identity.OwnerEmail)
	if !fileExists(m.egressPath) {
		fmt.Fprintln(m.out, m.text("No supplied accounts selected; choose Manage accounts.", "尚未选择供给账号，请进入账号管理。"))
		return nil
	}
	cfg, e := readEgress(m.ctx, m.egressPath)
	if e != nil {
		return e
	}
	for _, p := range configuredPlatforms(cfg) {
		if e = m.showPlatform(device, p); e != nil {
			fmt.Fprintf(m.out, "%s: %v\n", p, e)
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
	fmt.Fprintf(m.out, "%s: %s\n", p, ready)
	fmt.Fprintf(m.out, m.text("  Manually paused: %t\n", "  手动暂停：%t\n"), supply.Paused)
	for _, r := range supply.Reasons {
		fmt.Fprintf(m.out, "  [%s] %s\n", r, m.reason(r))
	}
	return nil
}
func (m *managementMenu) reason(r string) string {
	if m.ui.lang == "zh" {
		if zh, ok := map[string]string{"manually_paused": "已手动暂停接单", "offline": "Bee 离线", "not_configured": "尚未配置供给账号", "concurrency_full": "已达到并发上限", "quota_exhausted": "账号额度已用尽", "rate_limited": "上游限流冷却中", "plan_not_configured": "管理员尚未配置套餐限制", "authorization_unavailable": "暂无有效的在线授权", "capabilities_unknown": "账号能力未知或已过期", "quota_unknown": "正在等待新的额度查询", "model_unavailable": "模型当前不可交易", "banned": "已被管理员禁用", "device_draining": "设备替换中，等待当前任务完成"}[r]; ok {
			return zh
		}
	}
	if label, ok := supplyReasonLabels[r]; ok {
		return label
	}
	return r
}
func (m *managementMenu) diagnostics() error {
	report := diagnose(m.ctx, m.configPath, m.egressPath)
	labels := map[string]string{"pass": m.text("OK", "通过"), "warn": m.text("WARN", "警告"), "fail": m.text("FAIL", "失败"), "skip": m.text("SKIP", "跳过")}
	names := map[string]string{"device": m.text("Device", "设备"), "egress": m.text("Supply configuration", "供给配置"), "authorization": m.text("Authorization", "账号授权"), "hive": "Hive", "account": m.text("Account", "账号"), "supply": m.text("Supply", "接单")}
	for _, c := range report.Checks {
		name := names[c.Name]
		if name == "" {
			name = c.Name
		}
		fmt.Fprintf(m.out, "[%s] %s %s", labels[c.Status], name, c.Platform)
		if c.Code != "" {
			fmt.Fprintf(m.out, " [%s]", c.Code)
		}
		fmt.Fprintln(m.out)
		if c.Status != "pass" {
			fmt.Fprintf(m.out, "  %s\n", c.Detail)
			if c.Fix != "" {
				fmt.Fprintf(m.out, m.text("  Fix: %s\n", "  修复建议（原始诊断）：%s\n"), c.Fix)
			}
		}
	}
	if report.OK {
		fmt.Fprintln(m.out, m.text("No problems found.", "检查通过，未发现问题。"))
	} else {
		fmt.Fprintln(m.out, m.text("Problems found; follow the evidence and fixes above.", "发现问题，请根据上面的诊断与修复建议处理。"))
	}
	return nil
}
