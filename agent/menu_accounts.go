package bee

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/tokhive/bee/beewire"
)

func (m *managementMenu) platform() (string, error) {
	fmt.Fprintln(m.out, "  1) OpenAI (Codex)\n  2) Claude\n  0) "+m.text("Back", "返回"))
	n, e := m.choose(m.text("Platform: ", "请选择平台："), 2)
	if n == 0 || e != nil {
		return "", e
	}
	return []string{"openai", "claude"}[n-1], nil
}
func (m *managementMenu) accounts() error {
	return m.loop(m.text("Supplied accounts", "供给账号"), []menuAction{
		{"View accounts and supply", "查看账号与接单状态", m.accountStatus},
		{"Select supplied accounts", "重新选择供给账号", m.configureAccounts},
		{"Pause new work", "暂停接单", func() error { return m.changeSupply(true) }},
		{"Resume new work", "恢复接单", func() error { return m.changeSupply(false) }},
		{"Confirm account change", "确认账号变更", m.confirmAccount},
	})
}
func (m *managementMenu) printAccount(a beewire.PlatformAccount) {
	labels := map[string]string{"not_configured": m.text("No registered account", "尚未注册账号"), "ready": m.text("Authorization synchronized", "授权已同步"), "source_unavailable": m.text("Waiting for official sign-in recovery", "等待官方账号登录恢复"), "confirmation_required": m.text("Account change needs confirmation", "账号变更等待确认"), "authorization_rejected": m.text("Authorization rejected", "授权被拒绝")}
	label := labels[a.Status]
	if label == "" {
		label = a.Status
	}
	fmt.Fprintf(m.out, m.text("Platform: %s\nAccount: %s\nConfirmed fingerprint: %s\nPending fingerprint: %s\n", "平台：%s\n账号状态：%s\n当前账号指纹：%s\n待确认账号指纹：%s\n"), a.Platform, label, a.AccountFingerprint, a.PendingFingerprint)
}
func (m *managementMenu) accountStatus() error {
	p, e := m.platform()
	if e != nil || p == "" {
		return e
	}
	state, e := m.readDevice()
	if e != nil {
		return e
	}
	a, e := readPlatformAccount(m.ctx, state, p)
	if e != nil {
		return e
	}
	m.printAccount(a)
	return m.showPlatform(state, p)
}
func (m *managementMenu) changeSupply(paused bool) error {
	p, e := m.platform()
	if e != nil || p == "" {
		return e
	}
	state, e := m.readDevice()
	if e != nil {
		return e
	}
	summary := fmt.Sprintf(m.text("Resume new work for %s? Other readiness requirements still apply.", "恢复 %s 的新任务接单？仍需满足其他接单条件。"), p)
	if paused {
		summary = fmt.Sprintf(m.text("Pause new work for %s? This does not stop Bee or other platforms.", "暂停 %s 接收新任务？这不会停止 Bee 或其他平台。"), p)
	}
	summary += "\nHive: " + state.Hive
	ok, e := m.confirm(summary)
	if e != nil || !ok {
		return e
	}
	result, e := updatePlatformSupply(m.ctx, httpClient(), state, p, paused)
	if e != nil {
		return e
	}
	fmt.Fprintf(m.out, m.text("Hive confirmed manual pause=%t for %s.\n", "Hive 已确认手动暂停状态：%t，平台：%s。\n"), result.Paused, p)
	// Query the final state separately; clearing pause alone does not imply ready.
	return m.showPlatform(state, p)
}
func (m *managementMenu) confirmAccount() error {
	p, e := m.platform()
	if e != nil || p == "" {
		return e
	}
	state, e := m.readDevice()
	if e != nil {
		return e
	}
	observed, e := readPlatformAccount(m.ctx, state, p)
	if e != nil {
		return e
	}
	fmt.Fprintln(m.out, "Hive: "+state.Hive)
	m.printAccount(observed)
	if observed.Status != "confirmation_required" || observed.PendingFingerprint == "" || observed.ConfirmationID == "" {
		fmt.Fprintln(m.out, m.text("No pending account change.", "没有待确认的账号变更。"))
		return nil
	}
	ok, e := m.confirm(m.text("Confirm the displayed pending account? Manual pause state will be kept.", "确认切换到上面显示的待确认账号？手动暂停状态将保留。"))
	if e != nil || !ok {
		return e
	}
	a, e := confirmAccountSnapshot(m.ctx, state, observed)
	if e != nil {
		return e
	}
	m.printAccount(a)
	fmt.Fprintln(m.out, m.text("Hive confirmed the switch; waiting for Bee to synchronize authorization.", "Hive 已确认账号切换，等待 Bee 同步授权。"))
	return nil
}
func confirmAccountSnapshot(ctx context.Context, state localState, observed beewire.PlatformAccount) (beewire.PlatformAccount, error) {
	p := observed.Platform
	decoded, e := hex.DecodeString(observed.PendingFingerprint)
	if e != nil || len(decoded) != 32 {
		return observed, errors.New("invalid pending account fingerprint; query account status again")
	}
	current, e := readPlatformAccount(ctx, state, p)
	if e != nil {
		return current, e
	}
	if current.Status != "confirmation_required" || current.PendingFingerprint != observed.PendingFingerprint || current.ConfirmationID == "" || current.ConfirmationID != observed.ConfirmationID {
		return current, fmt.Errorf("pending account changed or expired for %s; query and confirm the displayed account again", p)
	}
	return submitAccountConfirmation(ctx, state, p, observed.PendingFingerprint, observed.ConfirmationID)
}
