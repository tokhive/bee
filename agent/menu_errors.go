package bee

import (
	"errors"
	"fmt"
	"strings"
)

// Only stable codes and typed failures are translated. External diagnostics
// remain verbatim so an unfamiliar failure still carries its evidence.
var menuProblemsZH = map[string]problem{
	"BEE-DEVICE-NOT-PAIRED":          {"这台 Bee 尚未完成设备配对", "返回主菜单，选择「设备配对」，并在 Hive 网页确认。"},
	"BEE-DEVICE-REPLACED":            {"这台设备已被另一台 Bee 替换，旧配对凭证已撤销", "返回主菜单，选择「设备配对 → 重新配对」。"},
	"BEE-DEVICE-CONFIG":              {"设备配置无法使用", "已保留文件。根据下方详情修正 JSON、路径或访问权限（chmod 600），然后重新启动。"},
	"BEE-HIVE-CREDENTIAL":            {"Hive 拒绝了当前设备的配对凭证", "检查 Hive 地址；设备已删除或被替换时，选择「设备配对 → 重新配对」。"},
	"BEE-HIVE-UNREACHABLE":           {"无法连接 Hive", "检查网络、Hive 地址和 Hive 服务状态。"},
	"BEE-HIVE-ERROR":                 {"Hive 返回了错误", "根据错误码处理；持续失败时，将错误码和发生时间提供给 Hive 管理员。"},
	"BEE-CODEX-SOURCE":               {"无法读取 Codex 登录信息", "运行 codex login 完成官方登录；检查供给配置中的 codex.home 和 codex.store，再重新检测。"},
	"BEE-SETUP-CODEX-NOT-FOUND":      {"未找到 Codex 官方配置目录", "先运行 codex login；使用自定义目录时检查 CODEX_HOME。"},
	"BEE-CODEX-EXPIRED":              {"Codex 访问令牌已过期", "保持 Bee 在线以等待 Hive 调度刷新；仍未恢复时运行 codex login 重新登录。"},
	"BEE-CLAUDE-SOURCE":              {"无法读取 Claude Code 登录信息", "运行 claude 完成官方登录；macOS 上需解锁钥匙串并允许访问。自定义目录请检查 claude.config_dir。"},
	"BEE-CLAUDE-UNSUPPORTED":         {"当前平台不支持 Claude Code 钥匙串", "将 claude.store 设为 file，或重新选择供给账号。"},
	"BEE-CLAUDE-SCOPE":               {"Claude Code 登录信息缺少 user:inference 权限", "运行 claude，使用订阅账号重新登录。"},
	"BEE-CLAUDE-EXPIRED":             {"Claude Code 访问令牌已过期", "打开 Claude Code 续期，或启用 claude.refresh；运行中的 Bee 会自动同步。"},
	"BEE-CONFIG-NOT-FOUND":           {"尚未找到供给配置文件", "选择「供给账号 → 重新选择供给账号」。"},
	"BEE-CONFIG-NOT-REGULAR":         {"供给配置不是普通文件", "使用文件本身的路径，不能使用目录或符号链接。"},
	"BEE-CONFIG-PERMISSIONS":         {"其他用户可以读取或修改供给配置", "对下方文件运行 chmod 600，仅允许运行 Bee 的用户访问。"},
	"BEE-CONFIG-UNREADABLE":          {"无法读取供给配置", "检查文件所有者和读取权限。"},
	"BEE-CONFIG-TOO-LARGE":           {"供给配置超过 64 KiB", "移除不属于供给配置的内容。"},
	"BEE-CONFIG-SYNTAX":              {"供给配置的 JSON 语法错误", "根据下方行列位置修正 JSON。"},
	"BEE-CONFIG-UNKNOWN-FIELD":       {"供给配置包含无法识别的字段", "修正字段拼写或移除该字段。"},
	"BEE-CONFIG-FIELD-TYPE":          {"供给配置的字段类型错误", "根据下方详情使用正确的数据类型。"},
	"BEE-CONFIG-TRAILING-DATA":       {"供给配置的 JSON 对象后还有额外内容", "文件中仅保留一个 JSON 对象。"},
	"BEE-CONFIG-NO-TARGETS":          {"供给配置缺少上游地址", "在 targets 中设置供给平台的上游地址。"},
	"BEE-CONFIG-TOO-MANY-TARGETS":    {"供给配置超过 16 个上游地址", "只保留实际供给平台需要的地址。"},
	"BEE-CONFIG-TARGET-FORMAT":       {"上游地址不符合 host:port 格式", "使用精确地址，例如 chatgpt.com:443。"},
	"BEE-CONFIG-TARGET-MISSING":      {"供给配置缺少该平台的上游地址", "将下方所示地址加入 targets。"},
	"BEE-CONFIG-NO-SOURCE":           {"供给配置未指定账号来源或静态凭证", "重新选择供给账号，或添加 codex / claude 配置。"},
	"BEE-CONFIG-STATIC-MIXED":        {"官方账号来源不能与静态凭证混用", "移除 credential；codex 和 claude 可以同时配置。"},
	"BEE-CONFIG-STATIC-CREDENTIAL":   {"静态凭证不完整或格式错误", "检查 token、header、scheme，或使用官方账号来源。"},
	"BEE-CONFIG-INBOX-KEY":           {"inbox_key_id 缺失或不是 64 位十六进制标识", "静态凭证需填写经独立渠道验证的 TEE 收件箱公钥标识。"},
	"BEE-CONFIG-PROXY":               {"代理地址不符合本地 HTTP 代理要求", "使用 http://127.0.0.1:端口，或移除 connect_proxy 并设置 HTTPS_PROXY。"},
	"BEE-CONFIG-CAPABILITIES-SOURCE": {"capabilities 需要官方 Codex 账号来源", "添加 codex，或移除 capabilities；Claude 使用 claude.capabilities。"},
	"BEE-CONFIG-CAPABILITIES-URL":    {"capabilities.local_url 不是本地 HTTP 地址", "移除 local_url，该选项仅用于本地测试。"},
	"BEE-CONFIG-CLAUDE-STORE":        {"claude.store 配置值无效", "macOS 使用 keychain，Linux 使用 file，或重新选择供给账号。"},
	"BEE-SETUP-MANUAL":               {"现有供给配置包含菜单无法管理的设置", "手动修改配置，或通过 bee setup --egress-config 在其他位置创建配置。"},
	"BEE-SETUP-NEEDED":               {"尚未配置供给账号", "选择「供给账号 → 重新选择供给账号」，保存后重启 Bee。"},
}

func (m *managementMenu) catalogProblem(code string) (problem, bool) {
	if m.ui.lang == "zh" {
		p, ok := menuProblemsZH[code]
		return p, ok
	}
	p, ok := problems[code]
	return p, ok
}

func (m *managementMenu) reportError(err error) {
	// Keep wrappers visible as context, without painting an entire error chain red.
	for {
		if _, ok := err.(*codedError); ok {
			break
		}
		if _, ok := err.(*credentialError); ok {
			break
		}
		child := errors.Unwrap(err)
		if child == nil {
			break
		}
		prefix := strings.TrimSuffix(err.Error(), child.Error())
		if prefix != "" {
			m.details(strings.TrimSuffix(prefix, ": "))
		}
		err = child
	}
	switch e := err.(type) {
	case *apiFailure:
		p, ok := m.apiProblem(e)
		if !ok {
			p = problem{m.text("Hive request failed", "Hive 请求失败"), m.text("Check the response code below.", "请根据下方响应码排查。")}
		}
		m.ui.status(m.out, "❌", "31", p.cause, p.cause)
		m.field("Response", "响应信息", fmt.Sprintf("HTTP %d · %s", e.Status, e.Code))
		m.next(p.fix)
	case *codedError:
		p, ok := m.catalogProblem(e.code)
		if !ok {
			m.unknownError(err)
			return
		}
		m.ui.status(m.out, "❌", "31", p.cause, p.cause)
		m.field("Error code", "错误标识", e.code)
		if e.cause != nil {
			m.reportCause(e.cause)
		} else {
			m.details(e.detail)
		}
		m.next(p.fix)
	case *credentialError:
		m.reportCause(e)
	default:
		m.unknownError(err)
	}
}
func (m *managementMenu) unknownError(err error) {
	m.ui.status(m.out, "❌", "31", "This operation could not be completed.", "本次操作未完成。")
	m.details(err.Error())
}
func (m *managementMenu) reportCause(err error) {
	// These sentinels name stable failures; their full meaning is translated,
	// while any wrapper carrying extra evidence falls through to original details.
	var text bilingualText
	switch err {
	case errClaudeFileMissing:
		text = bilingualText{"Claude Code sign-in file was not found; check the login and claude.config_dir.", "未找到 Claude Code 登录文件；请检查登录状态及 claude.config_dir。"}
	case errClaudeFileUnavailable:
		text = bilingualText{"Cannot read the Claude Code sign-in file; it must be a regular file readable by this user.", "无法读取 Claude Code 登录文件；它必须是当前用户可读取的普通文件。"}
	case errClaudeKeychainMissing:
		text = bilingualText{"The Claude Code Keychain entry was not found; check the configuration directory, sign-in and permissions.", "未找到 Claude Code 钥匙串条目；请检查配置目录、登录状态及系统权限。"}
	case errClaudeKeychainUnavailable:
		text = bilingualText{"Cannot read the Claude Code Keychain; check permissions and unlock the Keychain.", "无法读取 Claude Code 钥匙串；请检查系统权限并解锁钥匙串。"}
	}
	if text.en != "" {
		m.note(text.en, text.zh)
		return
	}

	switch e := err.(type) {
	case *credentialError:
		p := credentialProblems[e.kind]
		m.note(p.en, p.zh)
		if e.detail != "" {
			m.field("Evidence", "具体信息", e.detail)
		}
		if e.cause != nil {
			m.details(e.cause.Error())
		}
	case *apiFailure:
		p, ok := m.apiProblem(e)
		if ok {
			m.note(p.cause, p.cause)
		}
		m.field("Response", "响应信息", fmt.Sprintf("HTTP %d · %s", e.Status, e.Code))
	default:
		m.details(err.Error())
	}
}
func (m *managementMenu) apiProblem(e *apiFailure) (problem, bool) {
	code := map[string]string{"device_replaced": "BEE-DEVICE-REPLACED", "invalid_device_credential": "BEE-HIVE-CREDENTIAL"}[e.Code]
	if code != "" {
		return m.catalogProblem(code)
	}
	en, zh, fixEN, fixZH := "", "", "", ""
	switch e.Code {
	case "device_exists":
		en, zh, fixEN, fixZH = "This account already has a Bee", "此账号已有一台 Bee", "Review replacement in the Hive web console.", "请到 Hive 网页检查并确认是否替换。"
	case "device_draining":
		en, zh, fixEN, fixZH = "The old Bee is finishing its work", "旧 Bee 正在完成任务和结算", "Wait for the old Bee to finish.", "请等待旧 Bee 完成任务。"
	case "replacement_pending":
		en, zh, fixEN, fixZH = "Another Bee is already waiting for replacement", "已有另一台 Bee 正在等待替换", "Check the pending replacement in Hive.", "请到 Hive 网页查看待处理的替换。"
	case "pairing_expired":
		en, zh, fixEN, fixZH = "The pairing code has expired", "配对码已过期", "Choose Device pairing and continue pairing.", "选择「设备配对」，继续配对以获取新配对码。"
	case "pairing_redeemed":
		en, zh, fixEN, fixZH = "The pairing code has already been used", "配对码已使用", "Check the device identity in Hive.", "请到 Hive 网页检查设备身份。"
	case "rate_limited":
		en, zh, fixEN, fixZH = "Hive is limiting requests", "请求过于频繁，Hive 已限流", "Try again later.", "请稍后再试。"
	default:
		return problem{}, false
	}
	return problem{m.text(en, zh), m.text(fixEN, fixZH)}, true
}

// Unsupported platforms are a capability notice, not an operation failure.
func (m *managementMenu) serviceNotice(err error) {
	if errors.Is(err, errServiceUnavailable) && m.service != nil && m.service.platform != "linux" {
		platform := m.service.platform
		if platform == "darwin" {
			platform = "macOS"
		}
		m.field("Background service", "后台管理", fmt.Sprintf(m.text("%s is not supported", "%s 暂不支持"), platform))
		m.note("Choose Start Bee to run automatically in the foreground.", "请选择「启动 Bee」，将自动前台运行。")
		return
	}
	if errors.Is(err, errServiceUnavailable) {
		m.ui.status(m.out, "ℹ️", "36", "No supported managed system service is available.", "当前没有可用的受管理系统服务。")
		m.next(m.text("Run install.sh on Linux, or choose Start Bee for foreground operation.", "在 Linux 上运行安装脚本配置服务，或选择「启动 Bee」使用前台运行。"))
		m.details(err.Error())
		return
	}
	m.reportError(err)
}
