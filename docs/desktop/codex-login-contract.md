# Codex 登录扩展契约与评审样本

2026-11-06。本轮交付接口定义和静态模拟返回，供 UI 评审使用；暂缓完整后台实现和真实登录集成。不包含页面、按钮、文案或交互实现。

## 交付状态与兼容性

| 部分 | 当前状态 |
| --- | --- |
| `authorize_start`、`authorize_status`、`authorize_cancel` | 已有 Go → 私有 bridge → Rust → TypeScript 实现，本轮不改请求、返回或行为 |
| `authorize_progress`、`authorize_open` | 本文定义的扩展，**尚未实现或注册为 capability**，不能向真实 bridge 调用来冒充已接通 |
| [TypeScript 类型](../../desktop/src/system/codexLogin.contract.ts) | 仅契约，无生产 client、decoder 或原生实现 |
| [模拟返回](../../desktop/tests/fixtures/codex-login-contract.ts) | 静态、可导入的模拟信封；不是官方客户端返回，也不执行登录、取消、打开浏览器或账号写入 |

沿用 TypeScript 7 的现有类型、`AccountOperation`、`AccountError` 和 bridge 实例信封；不新增依赖。后续原生实现沿用现有 Go authorizer 和 Rust/Tauri bridge。技术栈不变。

旧 mock 和现有 `AuthorizeClient` 继续使用原来的三个方法，不增加必填字段。两项扩展采用独立方法，是因为现有 Go/Rust/TS 解码器严格限制 `{operation}` 返回，直接给旧返回添加进度字段会破坏兼容性。真实接入时必须先核对**同一管理实例**握手 capabilities 同时提供这两项；`features.authorize.available=true` 只说明已有登录能力，不说明扩展已实现。评审样本只能在明确的 mock 环境使用。

## 调用表

下表中的私有 bridge 参数是 Rust 发给 Go 的参数。Tauri 命令参数另列；TypeScript 扩展方法返回解包后的 `progress` 或 `open`。

| 用途 | 命令 | Tauri 参数 | 私有 bridge 参数 | result | 状态 |
| --- | --- | --- | --- | --- | --- |
| 发起一次登录 | `authorize_start` | `{request:{platform:"openai",source:{directory:null,store:"file"},expected_revision:0}}` | 上述 `request` 对象 | `{operation: AccountOperation}` | 已实现；revision 示例须替换为最新账号快照值 |
| 查询已有粗粒度结果 | `authorize_status` | `{operationId}` | `{operation_id}` | `{operation: AccountOperation}` | 已实现 |
| 查询本次详细进度与可执行动作 | `authorize_progress` | `{operationId}` | `{operation_id}` | `{progress: CodexLoginProgress}` | 仅定义 |
| 再次打开本次官方登录页 | `authorize_open` | `{operationId}` | `{operation_id}` | `{open: CodexLoginOpenReceipt}` | 仅定义 |
| 请求取消 | `authorize_cancel` | `{operationId}` | `{operation_id}` | `{operation: AccountOperation}` | 已实现；返回不代表清理完成 |
| 清理后重试 | 复用 `authorize_start` | 新 `request` | 新请求 | 新 `{operation}`、新 ID | 不新增 retry 命令 |

所有 operation ID 仍为 48 位小写 hex，且必须由当前管理实例拥有。`source` 沿用现有目录与存储校验；示例使用 file，不扩大 keyring 或版本支持范围。UI 不传 URL、命令、回调地址、授权码、token 或任意程序路径。

返回保留现有外层 `{instance,result}`。未知 ID、其他实例 ID、被新尝试替换的旧 ID应拒绝，不附着到新的登录。实例重启后不能把持久化的旧 ID继续交给新 authorizer；按既有 `account_snapshot(platform,refresh=true)` 核对历史维护。

## 进度字段

`CodexLoginProgress` 的完整类型以 TypeScript 文件为准：

| 字段 | 含义 |
| --- | --- |
| `operation` | 原有 operation 格式，限定 `kind=authorize`、`platform=openai`。保留原 operation ID、revision 和结果错误，不将页面阶段写入公共 journal |
| `sequence` | 本 operation 内从 0 开始的非负 JS safe integer；任何可观察进度、动作许可或 blocker 改变均递增。独立于账号／operation revision，避免等待阶段不变的 revision 无法排序 |
| `phase` | 五个执行阶段之一，见下表；登录结果仍由 `operation.state/error` 表达 |
| `stop_reason` | null / cancelled / timed_out / failed；说明已触发取消、到期或失败。收尾期间可先有原因、operation 仍 running；不能提前伪造取消／超时终态 |
| `actions.open` | 当前有经验证、属于本次且仍可使用的链接，后台允许打开 |
| `actions.cancel` | 当前允许请求取消；为 false 不能推出取消成功或登录成功 |
| `actions.retry` | 原尝试已收尾，且当前维护／并发等准入屏障允许重新发起。只是当前许可，下一次 start 仍做原子校验 |
| `blocker` | 收尾／维护阻塞的具体 `AccountError`，没有则 null。保留原 `operation.error`，例如同时报告原超时和进程清理失败 |

同一实例与 ID 下，UI 使用最新 sequence，忽略更早返回；不同 ID不能比较 sequence。不同实例的返回不能混用。原 `operation.revision` 继续服从既有单调规则。暂不增加百分比、授权页是否已加载、剩余秒数或 `expires_at`：当前没有可靠证据支撑这些事实。

## 阶段与动作约束

| phase | 真实含义 | open | cancel | retry |
| --- | --- | --- | --- | --- |
| `starting` | 检查程序、版本、来源及暂停／隔离前置条件，或 CLI 尚未就绪 | false | 可为 true，以返回为准 | false |
| `waiting_authorization` | 受控 CLI 正在等待授权；不表示浏览器已打开 | 有可靠有效链接才 true；尚无链接时 false | 可为 true | false |
| `verifying` | CLI 已成功退出并完成该进程回收，正在重新读取来源、核验候选身份；不能凭退出码显示完成 | false | 可为 true，核验仍受取消保护 | false |
| `cleaning_up` | 取消／超时／失败后的进程回收或最终收尾未完成 | false | false；已接受取消不重复发起 | false |
| `finished` | 本次执行和进程回收已落定，结果见 operation；维护仍可能单独阻塞下一次登录 | false | false | 仅失败／取消且无准入阻塞时可能 true |

waiting_authorization 需要本次 CLI 已进入浏览器授权等待的可信信号；仅观察到进程存活不够，没有可靠阶段证据时保持 starting。waitingWithoutLink 表达已有等待信号但尚未取得可安全打开的完整链接，不承诺这个中间状态一定可被轮询观察到。

动作字段是后台在当前时刻的许可，前端不能仅根据 `phase` 推导按钮权限。具体约束：

- `actions.open=true` 只允许出现在 `waiting_authorization`，且 operation 仍 running、实例存活、未接受取消、未到管理端期限、URL 验证通过；尚未取链不立即失败，继续等待至官方退出或管理端期限。
- 发起取消或超时即撤销链接，进入收尾；同一 ID的重复取消是幂等核对，不重新启动任何进程。终态返回无法撤销已写入官方存储的凭据。
- **operation 结果终态不能单独当作可重试证明。** 例如进程回收失败时可保留 `operation.state=failed`，但 phase 仍为 cleaning_up，`blocker` 解释原因，retry 必须 false。不能释放旧受控进程的锁后盲目重启。
- `actions.retry=true` 要求 phase=finished、operation=failed/cancelled、blocker=null，且已确认旧进程清理和准入屏障。先读取最新账号快照，再用其 revision 和经确认的 source 调用 start；新请求产生新 ID。没有 automatic retry 或旧 start 请求重放。
- 双击／并发 start 仍受现有同平台 busy、revision、维护和设备恢复屏障保护，最多一个 owned 登录。查询与 open 都不能调用 start。

主要转换：`starting → waiting_authorization → verifying → finished`；任一未完成阶段取消／失败／超时后可经 `cleaning_up → finished`。前置检查失败可直接 finished；官方快速完成时轮询可以跳过中间阶段。未取到链接但 CLI 已完成时可直接 verifying，不能虚构等待链接。清理异常保留 cleaning_up 与 blocker；维护异常可在 finished 保留 blocker，继续禁止重试，通过既有账号维护核对恢复。

结果含义：

| operation | 解释 |
| --- | --- |
| pending / running | 未完成；以 phase 和 actions 判定本次可操作项 |
| succeeded | 既有来源、修订及候选核验链成功；不是已接入、已恢复接单或在线身份已核验的承诺 |
| cancelled | 沿用既有“受控进程回收后取消才成为终态”语义；仍结合 phase/actions 判断维护与下一次许可 |
| failed + `authorization_timeout` | 管理端登录总期限到达后的结果；不新增 timed_out operation 枚举。到期但仍在清理时以 stop_reason=timed_out 表达，operation 可仍 running；须完成清理才允许重试 |
| failed + 其他 error | 具体失败，按 error.code/check/evidence 处理 |
| unknown | 沿用既有中断历史的未知结果语义；不能转成成功或直接重放登录，回读账号维护状态 |

完成后读取既有 `account_snapshot`，使用真实 `candidate`、`selection`、`authorization`、`login_maintenance` 判断后续业务。首次登录仅产生候选，接入需明确确认；同号主动重登保持暂停；异号需明确确认换号。`candidate.identity_verified` 的现有语义不变，OpenAI 本地结构核验不能表述为已在线核实身份。此契约不增加自动接入／恢复接单动作。

## 安全打开与错误

`authorize_open` 只打开后台为当前 operation 临时持有的完整官方 URL。查询结果和打开结果都不返回 URL；原始 stderr、PKCE、state、授权码、token 不写入 bridge、日志、journal、快照或样本。取消、超时、CLI 退出、实例关闭和新尝试替换都使旧链接失效。调用时必须再次核对许可，不能依赖 UI 上一帧的 open=true。

重复 open 复用本次链接，不重新运行 `codex login`。拟沿用系统打开器的有界等待（至多 5 秒）；`opened=true` 仅表示本次系统启动器成功返回，不证明浏览器加载、用户授权或登录成功。CLI 自己的首次自动打开结果不可由当前公开输出可靠推断，不能为它虚构 success/failure。

打开失败返回 `{opened:false,error,progress}`，其中 progress 是当前最新值。启动器失败且本次链接仍有效时保留 open=true，可以再次打开；并发取消或期限到达后返回 open=false。错误和其他字段都不得包含链接。

| 错误 | 当前状态／语义 |
| --- | --- |
| operation.error: `client_missing`、`client_version_unsupported`、`client_capability_missing` 等 | 已有错误；具体失败发生在程序、版本或能力检查 |
| operation.error: `authorization_process_failed` | 已有错误；CLI 非零退出，保留安全退出证据，不能转发原始输出 |
| operation.error: `authorization_timeout` / `authorization_cancelled` | 已有错误；分别是管理端期限／取消；phase 和 retry 独立说明收尾 |
| operation.error: `authorization_source_unchanged`、`source_changed`、`authorization_candidate_unconfirmed` 等 | 已有错误；退出成功后的来源／候选核验失败 |
| open.error: `authorization_browser_open_failed` | **仅定义**；check=`browser_opener`，安全说明本次启动失败、退出状态或超时，进程结果不因此改为登录失败 |
| open.error: `authorization_link_unavailable` | **仅定义**；check=`authorization_link`，本次未取得有效链接或已撤销；evidence 只用现有允许字段（例如 confirmed=false），message 安全说明当前 phase 和本次拒绝条件 |
| progress.blocker | **字段仅定义**；沿用具体账号／维护错误形状；保留原登录失败，另说明未清理或维护未恢复，不能用通用“登录失败”替换 |
| `{result:{error:{code:"AUTHORIZE_OPERATION_FAILED",message}}}` | 已有 bridge 业务失败信封；未知／非当前实例 ID等没有合法 progress 可返回的情况继续拒绝。输入解码和传输错误沿用原桥语义，不包装为打开失败 |

`open.error` 描述一次打开请求；`operation.error` 描述本次登录结果；`blocker` 描述收尾／准入阻塞，三者不相互覆盖。所有对象均采用明确字段，未来实现须补严格 decoder；当前类型定义本身不是运行时校验器。

## 模拟返回的直接使用

从现有 Vite 评审环境导入样本，无需真实 bridge：

```ts
import {
  codexLoginExamples,
  codexLoginOpenExamples,
} from './tests/fixtures/codex-login-contract.ts';

const waiting = structuredClone(codexLoginExamples.waitingWithLink);
// waiting.result.progress 为 CodexLoginProgress；不会打开任何网页。
const openFailure = structuredClone(codexLoginOpenExamples.launcherFailed);
```

样本含 starting、waitingWithoutLink、waitingWithLink、verifying、cancelling、cleanupBlocked、cancelled、failed、timedOutCleaning、timedOut、succeeded、retryBlocked；open 样本含 opened、launcherFailed、linkUnavailable。样本是独立场景，不是按列举次序发生的同一次登录。`instance=codex-login-contract-mock` 明确区别真实子进程。模拟驱动可选择场景并返回克隆；不能注入生产 capability 或声称已经执行原生动作。

## 官方事实与未决验证

官方文档说明 `codex login` 走浏览器授权，也说明可以使用 CLI 打印的地址；见 [OpenAI 官方认证文档](https://learn.chatgpt.com/docs/auth)。本轮查阅文档、核对本机 `codex-cli 0.162.1` 的 version/help，并绑定公开源码快照：

- [0.162.1 CLI 登录输出](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/login.rs#L120)：登录服务器启动后无条件向 stderr 打印本次 auth_url。
- [默认及打开逻辑](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L194)：默认尝试 `webbrowser::open`，结果被忽略，调用早于 CLI 打印。不能把“未拿到链接”等同于自动打开失败。
- [授权地址及回调](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L77)：默认 issuer 为 auth.openai.com，路径 /oauth/authorize；回调为 loopback /auth/callback，常用 1455、备用 1457。后续须验证精确官方 origin/path、参数唯一性和实际回调，保留官方生成的 PKCE/state，不自行拼 URL。
- [CLI 等待循环](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L225) 没有可用于本契约的固定到期时间。Bee 已有管理端总期限 10 分钟，版本/help 各 5 秒；不能把这些写成授权服务保证的链接过期时间。
- `rust-v0.163.0` 对应 `83086188ae0614bd882818ff1aa23f3194962012`；以上 CLI 登录和 server 文件与 0.162.1 快照逐字相同。此证据不推广至所有未来 patch，也不扩大现有版本适配范围。

当前 Go 实现将 Codex stdout/stderr 丢弃，还没有取链／进度／安全打开逻辑。后续须实现并验证：有界流式 stderr 解析及校验、无链接等待、打开失败后再开、重复打开不重启、取消／超时即时撤销链接、完整进程清理后重试、陈旧 ID和实例保护、最终候选核验及暂停规则、跨 Go/Rust/TS 严格契约校验。

本轮**没有启动真实 `codex login`、没有生成真实登录链接或完成真实账号授权**；没有证明跨系统实际输出、opener 行为、取链时序或安全打开集成已通过。普通 CLI help 未见禁用 opener／机器可读输出参数；`BROWSER` 等环境变量能否可靠关闭自动打开仍未证实，暂不作为契约前提。当前仅交付静态模拟，原始 UI 会话可基于上述字段继续评审。

## 本轮验证

在 `bee-desktop-ui/desktop` 执行现有 `npm run typecheck`，以及对嵌套 fixture 显式执行 TS7 严格类型检查，均通过。`node --test tests/authorize.test.ts` 的 2 项现有接口测试通过。12 个进度和 3 个打开结果样本经原有 `decodeAuthorizeValue` 及动作／阶段／错误一致性检查通过；这些证据只证明契约样本及旧接口兼容性，不证明扩展原生实现。

只读独立核对发现的打开错误命名不一致、取消样本提前进入终态已修正：清理中的取消／超时保持原 operation running，用 stop_reason 说明原因；最终取消保留 authorization_cancelled 错误。没有修改或运行 UI 页面、预览和真实账号流程。
