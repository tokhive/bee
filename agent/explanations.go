package bee

import (
	"slices"
	"strings"

	"github.com/tokhive/bee/beewire"
)

// An explanation tells a person what a reason or error code means and what to
// do about it, in words for someone who does not run a terminal. The desktop
// app shows these; the codes themselves only appear as technical detail.
type explanation struct {
	Code string `json:"code"`
	// Category places a platform's state in one of the conclusions the app
	// shows: sharing, syncing, paused, waiting (recovers by itself), action
	// (the person can fix it), restricted (TokHive must), offline (the whole
	// Bee is) or error (a request failed).
	Category string `json:"category"`
	// Action is the button that fixes it, if any.
	Action string    `json:"action,omitempty"`
	Title  localized `json:"title"`
	Cause  localized `json:"cause"`
	Fix    localized `json:"fix"`
	// FixImport replaces Fix for an imported account, which no official
	// client on this machine can repair.
	FixImport *localized `json:"fix_import,omitempty"`
}

type localized struct {
	En string `json:"en"`
	Zh string `json:"zh"`
}

// Categories.
const (
	categorySharing    = "sharing"
	categorySyncing    = "syncing"
	categoryPaused     = "paused"
	categoryWaiting    = "waiting"
	categoryAction     = "action"
	categoryRestricted = "restricted"
	categoryOffline    = "offline"
	categoryError      = "error"
)

// Actions.
const (
	actionResume         = "resume"
	actionRelogin        = "relogin"
	actionReimport       = "reimport"
	actionConfirmSwitch  = "confirm_switch"
	actionRemoveAccount  = "remove_account"
	actionContactSupport = "contact_support"
	actionRepairBinding  = "repair_binding"
	actionRetry          = "retry"
	actionCheckNetwork   = "check_network"
)

func say(en, zh string) localized { return localized{En: en, Zh: zh} }

var explanations = map[string]explanation{}

func explain(code, category, action string, title, cause, fix localized) {
	explanations[code] = explanation{Code: code, Category: category, Action: action, Title: title, Cause: cause, Fix: fix}
}

func init() {
	// Reasons Hive gives for not sending work.
	explain(beewire.ReasonManuallyPaused, categoryPaused, actionResume,
		say("Paused", "已暂停"),
		say("You paused sharing, so this account takes no new requests.", "你暂停了共享，这个账号不会接新的请求。"),
		say("Choose Start sharing when you want it to take work again.", "想继续共享时，点“开始共享”。"))
	explain(beewire.ReasonBanned, categoryRestricted, actionContactSupport,
		say("Stopped by TokHive", "TokHive 暂停了共享"),
		say("TokHive has stopped sharing for this account.", "TokHive 暂停了这个账号的共享。"),
		say("Contact TokHive support and give them the account number.", "请联系 TokHive 客服，并提供账号编号。"))
	explain(beewire.ReasonDeviceDraining, categoryWaiting, "",
		say("Switching computers", "正在切换电脑"),
		say("Your TokHive account is being moved to another computer. This one finishes the requests it has and then stops.", "你的 TokHive 账号正在换绑到另一台电脑，这台电脑处理完手头的请求后就会停止。"),
		say("Nothing to do here. The other computer takes over automatically.", "这里不用操作，另一台电脑会自动接手。"))
	explain(beewire.ReasonOffline, categoryOffline, actionCheckNetwork,
		say("Not connected", "未连接"),
		say("TokHive cannot reach this computer right now.", "TokHive 现在连不上这台电脑。"),
		say("Keep Bee running and check this computer's network.", "请保持 Bee 运行，并检查这台电脑的网络。"))
	explain(beewire.ReasonNotConfigured, categoryRestricted, actionContactSupport,
		say("Not available on TokHive", "TokHive 暂不支持"),
		say("TokHive has no account registered for this platform, or does not offer it.", "TokHive 上没有这个平台的账号记录，或者暂不提供这个平台。"),
		say("If you just added the account, wait a few minutes. Otherwise contact TokHive support.", "如果刚添加账号，请等几分钟；否则请联系 TokHive 客服。"))
	explain(beewire.ReasonModelUnavailable, categoryAction, actionRelogin,
		say("Plan not supported", "套餐暂不支持"),
		say("None of the models TokHive offers can run on this account's plan.", "TokHive 提供的模型在这个账号的套餐下都用不了。"),
		say("Check the account's plan in the official app. If it should qualify, contact TokHive support.", "请在官方客户端确认账号的套餐；如果套餐应该支持，请联系 TokHive 客服。"))
	explain(beewire.ReasonAuthorizationUnavailable, categorySyncing, "",
		say("Syncing", "正在同步"),
		say("TokHive has not received a usable authorization from this computer yet.", "TokHive 还没收到这台电脑发来的可用授权。"),
		say("Keep Bee running; this usually clears within a few minutes. If it stays, sign in again in the official app.", "请保持 Bee 运行，通常几分钟内恢复；如果一直这样，请在官方客户端重新登录。"))
	explain(beewire.ReasonCapabilitiesUnknown, categorySyncing, "",
		say("Syncing", "正在同步"),
		say("Bee is reading this account's models and quota.", "Bee 正在读取这个账号的模型和额度。"),
		say("Nothing to do. It usually takes 1 to 3 minutes.", "不用处理，通常需要 1 到 3 分钟。"))
	explain(beewire.ReasonRateLimited, categoryWaiting, "",
		say("Cooling down", "正在冷却"),
		say("The platform is limiting how fast this account can be used.", "平台正在限制这个账号的使用频率。"),
		say("Nothing to do. Sharing resumes when the cooldown ends.", "不用处理，冷却结束后会自动恢复共享。"))
	explain(beewire.ReasonQuotaUnknown, categorySyncing, "",
		say("Checking quota", "正在读取额度"),
		say("Bee could not read this account's quota yet and is trying again.", "Bee 暂时没读到这个账号的额度，正在重试。"),
		say("Nothing to do. Keep Bee running.", "不用处理，请保持 Bee 运行。"))
	explain(beewire.ReasonQuotaExhausted, categoryWaiting, "",
		say("Quota used up", "额度已用完"),
		say("This account has used all of its quota for the current window.", "这个账号当前时间窗口的额度已经用完。"),
		say("Nothing to do. Sharing resumes when the quota resets.", "不用处理，额度重置后会自动恢复共享。"))
	explain(beewire.ReasonPlanNotConfigured, categoryRestricted, actionContactSupport,
		say("Plan not set up on TokHive", "TokHive 尚未支持这个套餐"),
		say("TokHive has not set up sharing for this account's plan yet.", "TokHive 还没有为这个套餐配置共享。"),
		say("Contact TokHive support and give them the account number.", "请联系 TokHive 客服，并提供账号编号。"))
	explain(beewire.ReasonConcurrencyFull, categoryWaiting, "",
		say("Busy", "正在满负荷工作"),
		say("This account is already handling as many requests as its plan allows.", "这个账号正在处理的请求已经达到套餐允许的上限。"),
		say("Nothing to do. It takes new work as current requests finish.", "不用处理，手头请求完成后就会接新的。"))
	explain(beewire.ReasonAccountNotRegistered, categorySyncing, "",
		say("Syncing", "正在同步"),
		say("Bee has not registered this account with TokHive yet.", "Bee 还没把这个账号登记到 TokHive。"),
		say("Keep Bee running; it usually takes a few minutes.", "请保持 Bee 运行，通常需要几分钟。"))
	explain(beewire.ReasonMarketNotOpen, categoryWaiting, "",
		say("Not open yet", "暂未开放"),
		say("TokHive has no model on sale for this platform right now, so there is nothing for this account to serve.", "TokHive 目前没有上架这个平台的模型，所以这个账号暂时没有可接的单。"),
		say("Nothing to do. Sharing starts by itself once TokHive puts a model on sale.", "不用处理，TokHive 上架模型后会自动开始共享。"))
	explain(beewire.ReasonSupplyNotEnabled, categoryRestricted, actionContactSupport,
		say("Not accepted on TokHive", "TokHive 暂不接受"),
		say("TokHive does not accept shared subscriptions for this platform yet.", "TokHive 暂时不接受这个平台的订阅共享。"),
		say("Contact TokHive support if you think this is wrong.", "如有疑问，请联系 TokHive 客服。"))
	explain(beewire.ReasonSupplyDeviceRestricted, categoryRestricted, actionContactSupport,
		say("Set up differently on TokHive", "TokHive 另有配置"),
		say("TokHive has a different setup for your account on this platform, so this computer does not share it.", "TokHive 为你的账号在这个平台上做了单独配置，所以这台电脑不共享它。"),
		say("Contact TokHive support.", "请联系 TokHive 客服。"))
	explain(beewire.ReasonAccountNotAdmitted, categoryRestricted, actionContactSupport,
		say("Account not accepted", "账号未获准共享"),
		say("TokHive only accepts certain accounts on this platform, and this one is not among them.", "TokHive 在这个平台只接受部分账号，这个账号不在其中。"),
		say("Contact TokHive support and give them the account number.", "请联系 TokHive 客服，并提供账号编号。"))
	for _, p := range []struct{ prefix, name, app, login string }{
		{"codex", "ChatGPT", "Codex", "codex login"},
		{"claude", "Claude", "Claude Code", "claude"},
		// Bee keeps this sign-in itself, so signing in again is its own command.
		{"antigravity", "Google", "Antigravity", "bee antigravity-login"},
	} {
		explain(p.prefix+"_source_unavailable", categoryAction, actionRelogin,
			say("Sign-in unavailable", "读取不到登录"),
			say("Bee cannot read the "+p.app+" sign-in on this computer. You may have signed out.", "Bee 读取不到这台电脑上 "+p.app+" 的登录，可能已经退出登录。"),
			say("Open a terminal, run "+p.login+" and sign in to the same account. Bee picks it up by itself.", "打开终端运行 "+p.login+"，重新登录同一个账号，Bee 会自动识别。"))
		explain(p.prefix+"_authorization_rejected", categoryAction, actionRelogin,
			say("Sign-in expired", "登录已失效"),
			say(p.name+" rejected this account's sign-in. It has usually expired.", p.name+" 拒绝了这个账号的授权，通常是登录已失效。"),
			say("Open a terminal, run "+p.login+" and sign in to the same account again.", "打开终端运行 "+p.login+"，重新登录同一个账号。"))
		explain(p.prefix+"_confirmation_required", categoryAction, actionConfirmSwitch,
			say("Different account signed in", "客户端换了账号"),
			say(p.app+" is now signed in to a different account than the one being shared.", p.app+" 现在登录的账号和正在共享的不是同一个。"),
			say("Choose Use new account to share it, or remove this account.", "点“改用新账号”开始共享新账号，或者删除这个账号。"))
		explain(p.prefix+"_account_in_use", categoryAction, actionRemoveAccount,
			say("Used by someone else", "已被他人使用"),
			say("This "+p.name+" account is already shared from another TokHive account.", "这个 "+p.name+" 账号已被另一个 TokHive 账号使用。"),
			say("Use a different account, or ask the other person to release it in TokHive.", "你可以换用其他账号，或请对方在 TokHive 中释放它。"))
	}
	for _, code := range []string{"codex_source_unavailable", "codex_authorization_rejected", "claude_source_unavailable", "claude_authorization_rejected"} {
		e := explanations[code]
		e.FixImport = &localized{"Sign in again on the computer the file came from, export the credential file again and import it here.", "在导出文件的那台电脑上重新登录，重新导出凭证文件后，在这里重新导入。"}
		explanations[code] = e
	}

	// Errors from reading a sign-in on this computer.
	explain("BEE-SETUP-CODEX-NOT-FOUND", categoryAction, actionRelogin,
		say("Codex not signed in", "没有检测到 Codex 登录"),
		say("Bee found no Codex sign-in on this computer.", "Bee 在这台电脑上没有找到 Codex 的登录。"),
		say("Install Codex, open a terminal, run codex login and sign in to your ChatGPT subscription, then check again.", "安装 Codex，打开终端运行 codex login 登录你的 ChatGPT 订阅账号，然后重新检测。"))
	explain("BEE-CODEX-SOURCE", categoryAction, actionRelogin,
		say("Codex sign-in unreadable", "读取不到 Codex 登录"),
		say("Bee cannot use the Codex sign-in on this computer. It must be a ChatGPT sign-in, not an API key.", "Bee 用不了这台电脑上的 Codex 登录。必须是 ChatGPT 账号登录，不能是 API Key。"),
		say("Open a terminal, run codex login and sign in with your ChatGPT account, then check again.", "打开终端运行 codex login，用 ChatGPT 账号登录，然后重新检测。"))
	explain("BEE-CODEX-EXPIRED", categorySyncing, "",
		say("Renewing sign-in", "正在续期登录"),
		say("The Codex sign-in has expired; TokHive renews it while Bee is connected.", "Codex 登录已过期，Bee 连上 TokHive 后会自动续期。"),
		say("Keep Bee running. If it does not recover, run codex login again.", "请保持 Bee 运行；如果一直没恢复，请重新运行 codex login。"))
	explain("BEE-CLAUDE-SOURCE", categoryAction, actionRelogin,
		say("Claude Code not signed in", "没有检测到 Claude Code 登录"),
		say("Bee cannot read a Claude Code sign-in on this computer.", "Bee 在这台电脑上读取不到 Claude Code 的登录。"),
		say("Install Claude Code, open a terminal, run claude and sign in to your subscription, then check again. On a Mac, allow Bee when macOS asks about the keychain.", "安装 Claude Code，打开终端运行 claude 登录你的订阅账号，然后重新检测。Mac 上系统询问钥匙串权限时，请选择“始终允许”。"))
	explain("BEE-CLAUDE-EXPIRED", categoryAction, actionRelogin,
		say("Claude Code sign-in expired", "Claude Code 登录已过期"),
		say("The Claude Code sign-in has expired.", "Claude Code 的登录已经过期。"),
		say("Open Claude Code once so it renews the sign-in.", "打开一次 Claude Code，让它自动续期。"))
	explain("BEE-CLAUDE-SCOPE", categoryAction, actionRelogin,
		say("Sign-in cannot be shared", "这个登录不能用于共享"),
		say("This Claude Code sign-in lacks a permission sharing needs.", "这个 Claude Code 登录缺少共享所需的权限。"),
		say("Run claude and sign in again with your subscription account.", "运行 claude，用订阅账号重新登录。"))
	explain("BEE-CLAUDE-UNSUPPORTED", categoryAction, actionRelogin,
		say("Sign-in store not supported", "不支持这种登录存储"),
		say("Bee was told to read Claude Code's sign-in from a store this system does not have.", "Bee 被设置为从一个这台电脑没有的位置读取 Claude Code 登录。"),
		say("Remove this account and add it again.", "删除这个账号后重新添加。"))
	explain("BEE-ANTIGRAVITY-SOURCE", categoryAction, actionRelogin,
		say("Google not signed in", "没有检测到 Google 登录"),
		say("Bee has no Google sign-in for Antigravity on this computer.", "Bee 在这台电脑上没有 Antigravity 的 Google 登录。"),
		say("Open a terminal, run bee antigravity-login and sign in to your Google account, then check again.", "打开终端运行 bee antigravity-login 登录你的 Google 账号，然后重新检测。"))
	explain("BEE-ANTIGRAVITY-SIGNIN", categoryAction, actionRelogin,
		say("Google sign-in expired", "Google 登录已失效"),
		say("Google no longer accepts the saved sign-in. You may have removed access or changed the password.", "Google 不再接受已保存的登录，可能是你撤销了授权或修改了密码。"),
		say("Open a terminal, run bee antigravity-login and sign in again.", "打开终端运行 bee antigravity-login，重新登录。"))
	explain("BEE-ANTIGRAVITY-EXPIRED", categorySyncing, "",
		say("Renewing sign-in", "正在续期登录"),
		say("The Google sign-in has expired; TokHive renews it while Bee is connected.", "Google 登录已过期，Bee 连上 TokHive 后会自动续期。"),
		say("Keep Bee running. If it does not recover, run bee antigravity-login again.", "请保持 Bee 运行；如果一直没恢复，请重新运行 bee antigravity-login。"))
	explain("BEE-ANTIGRAVITY-TIER", categoryAction, actionRemoveAccount,
		say("Plan not supported", "套餐暂不支持"),
		say("This Google account's Antigravity plan is not one that can be shared.", "这个 Google 账号的 Antigravity 套餐暂时不能共享。"),
		say("Use a personal Google account on the free plan, Google AI Pro or Google AI Ultra.", "请换用免费版、Google AI Pro 或 Google AI Ultra 的个人 Google 账号。"))
	explain("import_unsupported", categoryError, actionRelogin,
		say("Cannot be imported", "不支持导入"),
		say("A Google account has no credential file to import; Bee signs in to it directly.", "Google 账号没有可导入的凭证文件，Bee 需要直接登录。"),
		say("Open a terminal on this computer, run bee antigravity-login, then add the account from its sign-in.", "在这台电脑上打开终端运行 bee antigravity-login，然后从本机登录添加账号。"))
	explain("login_scope", categoryAction, actionRelogin,
		say("Sign-in cannot be shared", "这个登录不能用于共享"),
		say("This Claude Code sign-in lacks a permission sharing needs.", "这个 Claude Code 登录缺少共享所需的权限。"),
		say("Run claude and sign in again with your subscription account, then check again.", "运行 claude，用订阅账号重新登录，然后重新检测。"))

	// Refused imports.
	explain("import_unreadable", categoryError, actionReimport,
		say("File cannot be read", "文件读取失败"),
		say("Bee cannot open the file you chose.", "Bee 打不开你选择的文件。"),
		say("Check the file still exists and choose it again.", "请确认文件还在，然后重新选择。"))
	explain("import_invalid", categoryError, actionReimport,
		say("Not a credential file", "不是有效的凭证文件"),
		say("This file is not a usable sign-in for this platform. Codex uses auth.json; Claude Code uses .credentials.json.", "这个文件不是这个平台可用的登录。Codex 用的是 auth.json，Claude Code 用的是 .credentials.json。"),
		say("Choose the right file for this platform.", "请选择这个平台对应的文件。"))
	explain("import_scope", categoryError, actionReimport,
		say("Sign-in cannot be shared", "这个登录不能用于共享"),
		say("This sign-in lacks a permission sharing needs.", "这个登录缺少共享所需的权限。"),
		say("Sign in again in Claude Code with your subscription account, then export the file again.", "在 Claude Code 中用订阅账号重新登录，然后重新导出文件。"))
	explain("import_expired", categoryError, actionReimport,
		say("Sign-in expired", "登录已过期"),
		say("This sign-in has expired and cannot be renewed.", "这个登录已经过期，而且无法续期。"),
		say("Sign in again, then export the file again.", "请重新登录，然后重新导出文件。"))

	// Refused requests.
	explain("platform_has_account", categoryError, actionRemoveAccount,
		say("Account already added", "已添加账号"),
		say("This version shares one account per platform.", "当前版本每个平台支持一个账号。"),
		say("Remove the current account first.", "请先删除已有账号。"))
	explain("pause_unconfirmed", categoryError, actionRetry,
		say("Could not pause", "暂停失败"),
		say("TokHive did not confirm the pause, so nothing was changed.", "TokHive 没有确认暂停，所以什么都没变。"),
		say("Check the network and try again.", "请检查网络后重试。"))
	explain("supply_unconfirmed", categoryError, actionRetry,
		say("Could not change sharing", "操作失败"),
		say("TokHive did not confirm the change, so sharing is as it was.", "TokHive 没有确认这次操作，共享状态保持不变。"),
		say("Check the network and try again.", "请检查网络后重试。"))
	explain("hive_unavailable", categoryError, actionRetry,
		say("Cannot reach TokHive", "无法连接 TokHive"),
		say("Bee could not get an answer from TokHive.", "Bee 没有收到 TokHive 的回应。"),
		say("Check the network and try again.", "请检查网络后重试。"))
	explain("confirmation_unconfirmed", categoryError, actionRetry,
		say("Could not switch account", "换号失败"),
		say("TokHive did not confirm the switch.", "TokHive 没有确认换号。"),
		say("Check the network and try again.", "请检查网络后重试。"))
	explain("no_pending_switch", categoryError, "",
		say("Nothing to confirm", "没有需要确认的换号"),
		say("TokHive is not waiting for an account switch on this platform.", "TokHive 目前没有在等这个平台的换号确认。"),
		say("Nothing to do.", "不用处理。"))
	explain("not_paired", categoryError, actionRepairBinding,
		say("Not linked to TokHive", "还没有绑定 TokHive"),
		say("This computer is not linked to a TokHive account.", "这台电脑还没有绑定 TokHive 账号。"),
		say("Link it to your TokHive account first.", "请先绑定 TokHive 账号。"))

	// The device and the connection.
	explain("BEE-HIVE-UNREACHABLE", categoryOffline, actionCheckNetwork,
		say("Cannot reach TokHive", "无法连接 TokHive"),
		say("Bee cannot connect to TokHive. The network may be down, or TokHive may be briefly unavailable.", "Bee 连不上 TokHive，可能是网络断了，也可能是 TokHive 暂时不可用。"),
		say("Check the network. If you use a proxy, set it in Settings. Bee keeps retrying.", "请检查网络；如果需要代理，请在设置里填写。Bee 会自动重试。"))
	explain("BEE-HIVE-CREDENTIAL", categoryAction, actionRepairBinding,
		say("Link no longer valid", "绑定已失效"),
		say("TokHive no longer accepts this computer's link.", "TokHive 不再接受这台电脑的绑定。"),
		say("Link this computer to your TokHive account again.", "请重新绑定这台电脑。"))
	explain("BEE-DEVICE-REPLACED", categoryAction, actionRepairBinding,
		say("Linked to another computer", "账号已绑定到另一台电脑"),
		say("Your TokHive account was linked to another computer, so this one stopped.", "你的 TokHive 账号绑定了另一台电脑，所以这台已停止。"),
		say("Link this computer again if you want it to share instead.", "如果想改用这台电脑共享，请重新绑定。"))
	explain("BEE-HIVE-ERROR", categoryError, actionRetry,
		say("TokHive error", "TokHive 出错"),
		say("TokHive answered with an unexpected error.", "TokHive 返回了意外的错误。"),
		say("Try again later. If it keeps happening, export a diagnostic report and contact TokHive support.", "请稍后重试；如果一直出现，请导出诊断报告并联系 TokHive 客服。"))
	explain("BEE-DEVICE-CONFIG", categoryError, actionContactSupport,
		say("Settings file damaged", "设置文件损坏"),
		say("Bee cannot use its saved link to TokHive.", "Bee 无法使用保存的绑定信息。"),
		say("Export a diagnostic report and contact TokHive support. Do not delete Bee's files.", "请导出诊断报告并联系 TokHive 客服，不要删除 Bee 的文件。"))
	for _, code := range []string{"pairing_rejected", "pairing_expired", "pairing_failed"} {
		explain(code, categoryError, actionRepairBinding,
			say("Linking did not finish", "绑定没有完成"),
			say("TokHive ended the linking before it was confirmed.", "绑定在确认前就被 TokHive 结束了。"),
			say("Start linking again.", "请重新开始绑定。"))
	}
}

// explainCode returns the explanation for code, or a general one for a code
// this Bee does not know, so the app always has something to show.
func explainCode(code string) explanation {
	if e, ok := explanations[code]; ok {
		return e
	}
	return explanation{Code: code, Category: categoryError, Action: actionRetry,
		Title: say("Something went wrong", "出现问题"),
		Cause: say("Bee reported a problem it has no description for.", "Bee 报告了一个没有说明的问题。"),
		Fix:   say("Try again. If it keeps happening, export a diagnostic report and contact TokHive support.", "请重试；如果一直出现，请导出诊断报告并联系 TokHive 客服。")}
}

// ExplanationCatalog is the answer to GET /v1/explanations, for stand-ins of
// the control interface such as the desktop app's mock Bee.
func ExplanationCatalog() any {
	return map[string]any{"explanations": allExplanations()}
}

// allExplanations is the whole catalog in code order.
func allExplanations() []explanation {
	list := make([]explanation, 0, len(explanations))
	for _, e := range explanations {
		list = append(list, e)
	}
	slices.SortFunc(list, func(a, b explanation) int { return strings.Compare(a.Code, b.Code) })
	return list
}

// sharingState is the one conclusion the app shows for a platform.
type sharingState struct {
	State string `json:"state"`
	// Reason is the code that decided it; the rest are in the supply.
	Reason string `json:"reason,omitempty"`
}

// categoryRank orders conclusions: what the person must fix first, then what
// TokHive must, then what clears by itself, then a pause they chose.
var categoryRank = map[string]int{categoryAction: 0, categoryRestricted: 1, categoryOffline: 2, categoryWaiting: 3, categorySyncing: 4, categoryPaused: 5, categoryError: 6}

// sharingOf turns Hive's view of a platform into one conclusion.
func sharingOf(supply beewire.PlatformSupply) sharingState {
	best, reason := "", ""
	for _, code := range supply.Reasons {
		category := explainCode(code).Category
		if best == "" || categoryRank[category] < categoryRank[best] {
			best, reason = category, code
		}
	}
	switch {
	case best != "":
		return sharingState{State: best, Reason: reason}
	case supply.Paused:
		return sharingState{State: categoryPaused, Reason: beewire.ReasonManuallyPaused}
	case supply.Ready:
		return sharingState{State: categorySharing}
	}
	return sharingState{State: categorySyncing}
}
