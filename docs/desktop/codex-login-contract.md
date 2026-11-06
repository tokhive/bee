# Codex 登录扩展契约与评审样本

2026-11-06。本轮交付接口定义和静态模拟返回，供 UI 评审使用；暂缓完整后台实现和真实登录集成。不包含页面、按钮、文案或交互实现。

## 交付状态与兼容性

| 部分 | 当前状态 |
| --- | --- |
| `authorize_start`、`authorize_status`、`authorize_cancel` | 已有 Go → 私有 bridge → Rust → TypeScript 实现，本轮不改请求、返回或行为 |
| `account_snapshot({platform:"openai",refresh:true/false})` | 已实现的维护核对入口／后续读回；不是清理进程命令，详见恢复约定 |
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
| 请求维护核对／读取核对结果 | `account_snapshot` | `{platform:"openai",refresh:true/false}` | 同 Tauri 参数 | `{account: AccountSnapshot}` | 已实现；true 可触发异步核对，false 读取当前快照，不启动核对 |
| 清理后重试 | 复用 `authorize_start` | 新 `request` | 新请求 | 新 `{operation}`、新 ID | 不新增 retry 命令 |

所有 operation ID 仍为 48 位小写 hex。现有 authorize_status/cancel 和拟定的 open 必须由当前管理实例拥有；progress 的历史只读例外见恢复约定。`source` 沿用现有目录与存储校验；示例使用 file，不扩大 keyring 或版本支持范围。UI 不传 URL、命令、回调地址、授权码、token 或任意程序路径。

返回保留现有外层 `{instance,result}`。未知 ID、其他归属 ID、被新尝试替换的旧 ID应拒绝，不附着到新的登录。实例重启后不能把持久化的旧 ID继续交给现有 authorize_status/cancel/open；按既有 `account_snapshot(platform,refresh=true)` 核对历史维护。

## 进度字段

`CodexLoginProgress` 的完整类型以 TypeScript 文件为准：

| 字段 | 含义 |
| --- | --- |
| `operation` | 原有 operation 格式，限定 `kind=authorize`、`platform=openai`。保留原 operation ID、revision 和结果错误，不将页面阶段写入公共 journal |
| `sequence` | 本 operation 内从 0 开始的非负 JS safe integer；任何可观察进度、动作许可或 blocker 改变均递增。独立于账号／operation revision，避免等待阶段不变的 revision 无法排序 |
| `phase` | 五个执行阶段之一，见下表；登录结果仍由 `operation.state/error` 表达 |
| `stop_reason` | null / cancelled / timed_out / failed；说明已触发取消、到期或失败。收尾期间可先有原因、operation 仍 running；不能提前伪造取消／超时终态 |
| `recheck_in_flight` | **仅定义**：该原维护 ID的核对 worker 已获准且尚未结束；不是 refresh 请求的 loading，也不表示正在杀进程 |
| `actions.open` | 当前有经验证、属于本次且仍可使用的链接，后台允许打开 |
| `actions.cancel` | 当前允许请求取消；为 false 不能推出取消成功或登录成功 |
| `actions.retry` | 原尝试已收尾，且当前维护／并发等准入屏障允许重新发起。只是当前许可，下一次 start 仍做原子校验 |
| `actions.recheck` | **仅定义**：允许调用既有 account_snapshot(openai,true) 核对该原维护；不保证核对能修复，不新增 recheck/cleanup 命令 |
| `blocker` | 收尾／维护阻塞的具体 `AccountError`，没有则 null。保留原 `operation.error`，例如同时报告原超时和进程清理失败 |

同一实例与 ID 下，UI 使用最新 sequence，忽略更早返回；不同 ID不能比较 sequence。不同实例的返回不能混用。原 `operation.revision` 继续服从既有单调规则。暂不增加百分比、授权页是否已加载、剩余秒数或 `expires_at`：当前没有可靠证据支撑这些事实。

## 阶段与动作约束

| phase | 真实含义 | open | cancel | retry |
| --- | --- | --- | --- | --- |
| `starting` | 检查程序、版本、来源及暂停／隔离前置条件，或 CLI 尚未就绪 | false | 可为 true，以返回为准 | false |
| `waiting_authorization` | 受控 CLI 正在等待授权；不表示浏览器已打开 | 有可靠有效链接才 true；尚无链接时 false | 可为 true | false |
| `verifying` | CLI 已成功退出并完成该进程回收，正在重新读取来源、核验候选身份；不能凭退出码显示完成 | false | 可为 true，核验仍受取消保护 | false |
| `cleaning_up` | 取消／超时／失败后的进程回收或最终收尾未完成 | false | false；已接受取消不重复发起 | false |
| `finished` | 本次执行和进程回收已落定，结果见 operation；维护仍可能单独阻塞下一次登录 | false | false | 失败／取消或已恢复的历史 unknown，且无准入阻塞时可能 true |

waiting_authorization 需要本次 CLI 已进入浏览器授权等待的可信信号；仅观察到进程存活不够，没有可靠阶段证据时保持 starting。waitingWithoutLink 表达已有等待信号但尚未取得可安全打开的完整链接，不承诺这个中间状态一定可被轮询观察到。

动作字段是后台在当前时刻的许可，前端不能仅根据 `phase` 推导按钮权限。具体约束：

- `actions.open=true` 只允许出现在 `waiting_authorization`，且 operation 仍 running、实例存活、未接受取消、未到管理端期限、URL 验证通过；尚未取链不立即失败，继续等待至官方退出或管理端期限。
- 发起取消或超时即撤销链接，进入收尾；同一 ID的重复取消只返回原操作，仍 pending/running 时可重复请求 cancel，不再次触发清理或核验。终态返回无法撤销已写入官方存储的凭据。
- **operation 结果终态不能单独当作可重试证明。** 例如进程回收失败时可保留 `operation.state=failed`，但 phase 仍为 cleaning_up，`blocker` 解释原因，retry 必须 false。不能释放旧受控进程的锁后盲目重启。
- `actions.retry=true` 要求 phase=finished、operation=failed/cancelled（或历史 unknown 且维护已恢复）、blocker=null、recheck_in_flight=false，且已确认旧进程清理和准入屏障。先读取最新账号快照，再用其 revision 和经确认的 source 调用 start；新请求产生新 ID。没有 automatic retry 或旧 start 请求重放。
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

## 超时、清理受阻与维护恢复

### 已实现入口的准确语义

TypeScript 调用 `accountClient.snapshot('openai',true)`；Tauri 和私有 bridge 都是 `account_snapshot`，参数 `{platform:"openai",refresh:true}`，返回 `{instance,result:{account:完整AccountSnapshot}}`。样本中的 accountReply 使用完整格式。该接口按当前核验归属的平台查原维护记录，**没有 operationId、force 或 kill 参数**；前端须将返回的 `login_maintenance.operation.id` 与正在展示的原操作比较，记录变化后重新读取上下文。

`refresh=false` 读取当前账号／维护快照，首次访问可能载入本地 journal，也会处理候选过期，但不启动维护核对或进程清理；这里的“只读”指不启动恢复／清理动作。`refresh=true` 还可能刷新 Hive 状态、核对先前未决的账号操作，并在以下前提成立时启动原登录维护 worker：维护存在且 can_recheck=true、平台没有 working、管理端与 authorizer 有效、无冲突 active action。账号／设备归属、原 guard、来源命名空间和运行归属仍会在 worker 中重新验证。

返回成功只证明本次 snapshot 调用成功，**不证明核对获准、进程已退出或维护已恢复**。平台忙时可直接返回旧快照；获准后也可先返回旧 blocked/can_recheck=true，再由后台更新。worker 使用 12 秒 context deadline，最终收尾和发布不保证恰在 12 秒内完成；之后用 `account_snapshot(...,refresh:false)` 读回，不把等待时长当作成功证据。不要用连续 refresh=true 轮询，否则前一个核对结束后可能又启动一次。准入失败可返回 `result.error.code=ACCOUNT_OPERATION_FAILED`；后台失败通常写入 `account.login_maintenance.error`。journal 载入失败还可能出现在 `account.authorization.error`（login_journal_unconfirmed），不能只看顶层调用是否成功。

核对先获取**原操作**的私有进程 guard；Unix 通过原锁确认，Windows 还查询原命名 Job 的 active processes=0。无法取得／查询时保持阻塞。核对随后验证设备归属、运行归属、原来源、暂停读回和候选；成功后会保存本地 journal、更新快照，并可能恢复同身份的本地维护 worker或隔离目标平台。这是**不重放外部登录／暂停写入的维护恢复**，不是完全无本地副作用的查询。它不会启动新官方登录，不向进程发送终止信号，不自动接入、换号或恢复接单。

真正的终止仍由原 owned supervisor／guardian／Windows Job 生命周期执行。`authorize_cancel` 只向仍 pending/running 的原 job 请求取消；重复调用不是“再次清理”命令。Unix guardian 在观察失败时保留原 guard和 leader，继续核对／清理原组；UI 没有单独 force-cleanup 接口，也不得删 guard/journal 或按进程名查杀来制造“已退出”。

### UI 可依据的事实与最小补充

现有 `login_maintenance` 的 phase、can_recheck、error 和原 operation 继续复用：

| 观察 | 能确认什么／可调用什么 |
| --- | --- |
| blocked + can_recheck=true | 有原维护待核对；可显式提交 refresh=true，但不是当前 worker 的可用许可或启动确认 |
| reconciling | 核对链已进入来源／维护协调阶段；不等于所有更早阶段没有 worker，也不代表清理完成 |
| restored + can_recheck=false + error=null | 原进程停止证据及维护核对在该上下文中通过，原失败／超时／取消结果保留；再检查最新准入条件 |
| confirmation_required | 已读到不同身份，须走既有明确换号确认；继续核对不能代替确认，新登录保持受限 |
| blocked 或 authorization.error | 仍受阻，展示本次具体错误和下一步；不能把 HTTP/bridge 成功当成恢复成功 |

现有快照没有公开 working 或 recheck worker 的受理／完成回执。请求 loading 只可表示“正在提交核对请求”；它结束后不能声称后台核对已完成。仅观察 revision 增加也不够，Hive／候选刷新可能独立推进 revision。

`features.authorize.available` 等字段表示当前构建是否具备能力，不表示这次准入通过；维护阻塞不会自动把它们置 false。维护 journal 中的 operation 也可能落后于当前 owned operation，例如正在超时收尾时，前者仍是 authorizing／pending，后者已经 running。不要要求二者的 state/revision 时刻相等；先核对原 ID，再按各自语义读取。

最小补充仅落在**尚未实现的 authorize_progress**：增加 `recheck_in_flight` 和 `actions.recheck`，不改现有 AccountSnapshot/AuthorizeClient，不新增恢复命令。recheck_in_flight=true 必须绑定已受理的原维护 worker；worker 结束（包括失败）设为 false 并推进 sequence，即使原错误文案未变。checking 期间 open/cancel/retry/recheck 全为 false。actions.recheck 要核对当前原记录、实例和平台准入；已有不可由该核对解除的 processCleanupErr 时应为 false，并保留 blocker。

为了让新实例也能观察原维护，这里同时收窄定义一个**仅供 progress 的历史只读例外**：可查询当前已核验 Hive／用户／设备／平台 journal 中仍是当前维护记录的原 ID；它不是接管历史进程。只能返回该记录和恢复进度，open/cancel 必须 false；任意旧 ID、别的归属或已被新登录替换的记录仍拒绝。status/cancel/open 的现有拥有权规则不变。这项例外、两项新字段和 decoder 都仅定义，当前真实 bridge 尚不能提供。

调用顺序：读 account snapshot 与（未来的）progress → actions.recheck=true 时显式提交一次 refresh=true → 以 progress.recheck_in_flight 观察受理／完成、以 refresh=false 取维护结果 → restored 且进程清理、设备与运行准入均确认、无 worker/blocker 时，未来 progress 才给 actions.retry=true → 取最新 account.revision 显式 start，生成新 ID。核对若快到未被轮询观察，可直接看到最新终态，不能要求 UI 必须看过 checking。历史 unknown 也只在上述原维护已恢复后允许明确发起新尝试，绝不把旧结果改写为成功或自动重放。

### 再次受阻后的下一步与真实缺口

| 本次证据／阻塞 | 可行下一步及边界 |
| --- | --- |
| 原 guard 仍持有、原 Job active>0、OS 进程观察失败 | 等待原 owner 的回收，读取具体错误并使用现有 diagnostics_start/diagnostics_export 排查，保留原 ID、check 和 evidence；条件变化且核对许可存在时再核对。snapshot 不会再 kill，也不保证多点几次能恢复 |
| **同实例 processCleanupErr 已缓存** | 当前 recheck 直接返回缓存错误，不重新取得 lease；即使 guardian 后来退出，同实例刷新也没有已实现的清除路径。必须标为真实后台缺口，actions.recheck=false、retry=false，并提供诊断路径；不能把“检查完再重登”写成已接通的能力 |
| source_missing、权限拒绝、invalid_credentials、原来源命名空间变化 | 保留具体 code/check/evidence；例如 file 缺失是 source_missing/read_file，不能改成笼统维护失败。进程停止核对通过后的来源问题，可由账号持有者恢复**原官方来源**的文件／权限／有效登录，再核对；账号变动仍需明确确认。原进程未确认停止时，不另开官方登录代替清理。不要删 guard/journal，或自动换目录绕过原记录 |
| Hive／身份查询网络失败、暂停读回失败 | 修复实际连接／代理／服务问题后再核对。若 GET paused=false，现有明确暂停动作可在自身准入允许时重新暂停并读回，再核对；recheck 本身不会重放暂停 PUT |
| 不同候选身份，confirmation_required | 使用既有 account_action(confirm_change)，传最新账号 revision、candidate_ref、confirmed=true，遵守其原准入；保持暂停。不是再次 start 或反复核对 |
| 设备绑定／原选择变化、未决账号操作、未知 runtime owner | 转对应已实现的设备／账号／运行恢复与诊断流程，先核对原归属；不得覆盖原 journal。runtime_restore 是 Rust 启动生命周期内部调用，不是前端清理按钮 |
| journal 不可读、损坏、原 guard 缺失 | 排查原文件权限和存储错误，保留原证据；不能由 UI 新建“干净”记录证明清理。确认原文件和上下文修复后才再核对，否则交诊断处理 |

**不把重启 App 当作本契约的修复承诺。** Unix 已有父进程死亡 EOF → guardian 回收与保锁保护；Windows 已有 owned Job 终止保护，但这些不证明任意 OS 故障下可立即干净退出。新实例仍须通过原 guard／Job、设备和 runtime 恢复屏障，旧进程或不明运行归属未确认时继续阻塞。不能靠重启自动解除暂停、重放登录或跳过清理。受控测试证明的父进程突死路径也不是三系统真实账号验收。

`runtime_start` 也不是通用清理出口：Tauri 启动门禁会拒绝 dirty／unowned runtime，startup_recheck 不会抹掉 dirty guard，runtime_stop 也不会替继承的 dirty session 签发干净退出证明。即使某次新 runtime run 重新核对了原 lease，它也没有清除旧 authorizer job 的进程清理错误缓存。不能以“点击开始”或 runtime_restore 替代原维护核对。

为避免把永久禁用重新登录当成设计终点，补充以下**待实现约定**，仍复用 `account_snapshot(refresh=true)`，不增加通用重试／清理命令：原 job 已结束执行、平台无冲突 worker/action 且原归属可核验时，允许为缓存 processCleanupErr 执行一次新的停止证明核对。未来 progress 只有在该能力实际实现后才可给 actions.recheck=true；它仍不是清理完成证明。核对必须取得**原 lease**，在 Unix 确认原 guardian 已完成原进程组清理和 Wait，在 Windows 确认原命名 Job 无活动进程，并重验原 ID、journal、设备／来源／runtime 归属及完整维护链。成功保存原 journal 后，才可在同一原 job／记录仍有效的条件下原子解除对应缓存，保留原超时／失败／取消结果；再次失败则保留具体 blocker、旧缓存和隔离屏障，等实际原因变化后再核对。不能仅将 phase 改成 restored 或清空错误。

上述缓存重新证明、progress 的核对许可／在途状态与历史读回均**尚未实现**。当前缓存失败样本明确保留 recheck=false、retry=false，并指向等待原回收、原因修复和诊断；其余恢复成功样本以“不存在该缓存错误且全部准入通过”为前提，不能据此宣称缓存失败已恢复。

本轮事实核对绑定 ui 工作区的实现：[Snapshot 触发条件](../../agent/desktop_accounts.go)、[原维护恢复及缓存错误分支](../../agent/desktop_login_maintenance.go)、[原 ID 的 status/cancel](../../agent/desktop_authorize.go)、[Unix guardian](../../agent/desktop_authorize_unix.go)、[Windows Job 查询](../../agent/desktop_login_process_windows.go)、[runtime 恢复归属](../../agent/desktop_login_recovery.go)和 [Tauri 启动门禁](../../desktop/src-tauri/src/experience.rs)。本轮未修改这些后台文件。

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
  codexLoginRecoveryExamples,
} from './tests/fixtures/codex-login-contract.ts';

const waiting = structuredClone(codexLoginExamples.waitingWithLink);
// waiting.result.progress 为 CodexLoginProgress；不会打开任何网页。
const openFailure = structuredClone(codexLoginOpenExamples.launcherFailed);
const recovery = structuredClone(codexLoginRecoveryExamples.recheckRequested);
// recovery.request 只是请求描述；accountReply 是既有格式，可能仍为旧 blocked。
// progressReply 使用仅定义的扩展格式，不代表真实 bridge 已支持。
```

样本含 starting、waitingWithoutLink、waitingWithLink、verifying、cancelling、cleanupBlocked、cancelled、failed、timedOutCleaning、timedOut、succeeded、retryBlocked；open 样本含 opened、launcherFailed、linkUnavailable。样本是独立场景，不是按列举次序发生的同一次登录。`instance=codex-login-contract-mock` 明确区别真实子进程。模拟驱动可选择场景并返回克隆；不能注入生产 capability 或声称已经执行原生动作。

恢复样本提供完整 accountReply 和拟议 progressReply，均保留原 ID：

| 场景 | 评审含义 |
| --- | --- |
| timedOutEnding | 已到管理端期限，原登录仍在收尾；不是已退出，retry/recheck 均 false |
| endingBlocked | 原停止证明核对受阻；没有同实例缓存 processCleanupErr 时，可请求再核对 |
| cachedCleanupFailure | 同实例已缓存进程清理错误，现有 refresh 无法解除；不可伪造可恢复许可 |
| recheckRequested | 附既有命令和参数，立即返回仍可为旧 blocked；只表示提交，不表示受理或完成 |
| rechecking | 拟议 recheck_in_flight=true，所有动作 false；维护可为 reconciling |
| readyToLogin | 旧进程停止、原维护恢复且其他准入均已核验，拟议 retry=true；原超时结果保留，不自动 start |
| stillBlocked | 原停止证明通过，但原 file 来源缺失；保留 source_missing/read_file，修复原来源后可再核对 |

恢复能力字段在各样本保持一致；模拟来源 `/mock/codex`、指纹、候选和时间均为合成数据，不读取真实账号。readyToLogin 不承诺这些冻结时间下的候选在任意未来时刻有效，真实重登必须取得最新 revision 并重新准入。

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

在 `bee-desktop-ui/desktop` 执行现有 `npm run typecheck`，以及对嵌套 fixture 显式执行 TS7 严格类型检查，均通过。`node --test tests/authorize.test.ts` 的 2 项现有接口测试通过。12 个进度、3 个打开结果和本次补充的 7 个恢复样本，经原有 `decodeAuthorizeValue`、`decodeAccountError`、`decodeAccountReply` 与动作／阶段／错误一致性检查通过。恢复样本另核对了原 ID和超时结果不变、提交不等于受理、能力字段稳定、source_missing 证据和缓存失败许可。这些证据只证明契约样本及旧接口兼容性，不证明扩展原生实现。

在 ui 工作区根目录运行以下 3 项既有 Go 测试通过：TestDesktopLoginMaintenanceUnknownPauseOnlyRechecksOriginalProcess、TestDesktopLoginMaintenanceReadOnlyRepairDischargesOnlyConfirmedJournalFailure、TestDesktopLoginMaintenanceRecoveryPreservesFailedCancelledAndTimedOutLogin（`go test ./agent -run '^TestDesktopLoginMaintenance(UnknownPauseOnlyRechecksOriginalProcess|ReadOnlyRepairDischargesOnlyConfirmedJournalFailure|RecoveryPreservesFailedCancelledAndTimedOutLogin)$' -count=1 -timeout=90s`）。它们覆盖原维护只核对、不重放外部登录／暂停写、已确认 journal 修复只解除存储错误，以及保留原失败／取消／超时结果；不能证明拟议的缓存错误解除或 progress 已实现。没有新增实现测试。

只读独立核对发现的打开错误命名不一致、取消样本提前进入终态已修正：清理中的取消／超时保持原 operation running，用 stop_reason 说明原因；最终取消保留 authorization_cancelled 错误。没有修改或运行 UI 页面、预览和真实账号流程。

本次恢复续补的独立核对还修正了 source_missing 被泛化、维护 journal 提前进入 reconciling、能力字段被当成动态准入，以及 12 秒被误写成完成保证的问题。最终三文件复核无重大语义矛盾；未解决项明确保留在“再次受阻后的下一步与真实缺口”。
