# Codex 登录扩展契约与评审样本

2026-11-10 更新：`authorize_progress`／`authorize_open` 已有 Go、bridge、Rust 注册和 TypeScript 生产实现，并按同实例 capability 使用。复合重新登录仍仅为契约。受控测试和未闭环项见 [实施记录](evidence/2026-11-10-openai-completion/README.md)；未执行真实官方账号、桌面和 Hive 联调。2026-11-06 的静态样本继续仅用于契约测试。

## 交付状态与兼容性

| 部分 | 当前状态 |
| --- | --- |
| `authorize_start`、`authorize_status`、`authorize_cancel` | 沿用 Go → 私有 bridge → Rust → TypeScript 请求和 operation 返回；本轮增加私有进度观测 |
| `account_snapshot({platform:"openai",refresh:true/false})` | 已实现的维护核对入口／后续读回；不是清理进程命令，详见恢复约定 |
| `authorize_progress`、`authorize_open` | **已实现和注册 capability**；只有当前实例声明支持才可调用；不包含 restart |
| `authorize_restart`、`authorize_restart_status`、`authorize_restart_cancel` | 本次定义的“一次重新登录”复合操作，**均未实现**；不由 UI 串 cancel／snapshot／start 代替 |
| [TypeScript 类型](../../desktop/src/system/codexLogin.contract.ts) | progress／open 有生产 client、严格 decoder 和原生实现；restart 仍仅契约 |
| [模拟返回](../../desktop/tests/fixtures/codex-login-contract.ts) | 静态、可导入的模拟信封；不是官方客户端返回，也不执行登录、取消、打开浏览器或账号写入 |

沿用 TypeScript 7 的现有类型、`AccountOperation`、`AccountError` 和 bridge 实例信封；不新增依赖。原生实现复用现有 Go authorizer 和 Rust/Tauri bridge。技术栈不变。

旧 mock 和现有 `AuthorizeClient` 继续使用原来的三个方法，不增加必填字段。扩展采用独立方法，是因为现有 Go/Rust/TS 解码器严格限制 `{operation}` 返回，直接给旧返回添加进度字段会破坏兼容性。真实接入时必须核对**同一管理实例**的对应 capability；一次重新登录需同时具备 restart／restart_status／restart_cancel，子登录的详细进度与安全打开另按各自 capability 解锁。`features.authorize.available=true` 只说明已有登录能力，不说明扩展已实现。评审样本只能在明确的 mock 环境使用。

本次主动作方向已变为**一次重新登录**：Bee 自动处理旧流程、停止证明、维护移交和新登录，不要求用户先执行“重新检查旧进程”。下文保留 account_snapshot 的准确语义和旧核对样本，供适配与诊断；它们不代表这一复合能力已经接通。

## 调用表

下表中的私有 bridge 参数是 Rust 发给 Go 的参数。Tauri 命令参数另列；TypeScript 扩展方法返回解包后的 `progress` 或 `open`。

| 用途 | 命令 | Tauri 参数 | 私有 bridge 参数 | result | 状态 |
| --- | --- | --- | --- | --- | --- |
| 发起一次登录 | `authorize_start` | `{request:{platform:"openai",source:{directory:null,store:"file"},expected_revision:0}}` | 上述 `request` 对象 | `{operation: AccountOperation}` | 已实现；revision 示例须替换为最新账号快照值 |
| 查询已有粗粒度结果 | `authorize_status` | `{operationId}` | `{operation_id}` | `{operation: AccountOperation}` | 已实现 |
| 查询本次详细进度与可执行动作 | `authorize_progress` | `{operationId}` | `{operation_id}` | `{progress: CodexLoginProgress}` | 已实现，需 authorize_progress capability |
| 再次打开本次官方登录页 | `authorize_open` | `{operationId}` | `{operation_id}` | `{open: CodexLoginOpenReceipt}` | 已实现，需 authorize_progress 和 authorize_open capability |
| 请求取消 | `authorize_cancel` | `{operationId}` | `{operation_id}` | `{operation: AccountOperation}` | 已实现；返回不代表清理完成 |
| 请求维护核对／读取核对结果 | `account_snapshot` | `{platform:"openai",refresh:true/false}` | 同 Tauri 参数 | `{account: AccountSnapshot}` | 已实现；true 可触发异步核对，false 读取当前快照，不启动核对 |
| 已清理后的底层新尝试 | `authorize_start` | 新 `request` | 新请求 | 新 `{operation}`、新 ID | 已有；复合重新登录内部复用其准入，UI 不自行串联 |
| 一次重新登录 | `authorize_restart` | `{request: CodexLoginRestartRequest}` | 上述 `request` 对象 | `{restart: CodexLoginRestartReceipt}` | 仅定义；固定受理回执，不代表旧流程已停止 |
| 查询复合操作 | `authorize_restart_status` | `{restartId}` | `{restart_id}` | `{restart: CodexLoginRestartProgress}` | 仅定义；按同一请求 ID 读回 |
| 取消复合操作 | `authorize_restart_cancel` | `{restartId}` | `{restart_id}` | 同 status | 仅定义；接受取消后仍完成必要停止／回收，不启动新登录 |

所有 operation ID 仍为 48 位小写 hex。现有 authorize_status/cancel 和 open 必须由当前管理实例拥有；progress 的历史只读例外见恢复约定。`source` 沿用现有目录与存储校验；示例使用 file，不扩大 keyring 或版本支持范围。UI 不传 URL、命令、回调地址、授权码、token 或任意程序路径。

返回保留现有外层 `{instance,result}`。未知 ID、其他归属 ID、被新尝试替换的旧 ID应拒绝，不附着到新的登录。实例重启后不能把持久化的旧 ID继续交给现有 authorize_status/cancel/open；按既有 `account_snapshot(platform,refresh=true)` 核对历史维护。

## 进度字段

`CodexLoginProgress` 的完整类型以 TypeScript 文件为准：

| 字段 | 含义 |
| --- | --- |
| `operation` | 原有 operation 格式，限定 `kind=authorize`、`platform=openai`。保留原 operation ID、revision 和结果错误，不将页面阶段写入公共 journal |
| `sequence` | 本 operation 内从 0 开始的非负 JS safe integer；任何可观察进度、动作许可或 blocker 改变均递增。独立于账号／operation revision，避免等待阶段不变的 revision 无法排序 |
| `phase` | 五个执行阶段之一，见下表；登录结果仍由 `operation.state/error` 表达 |
| `stop_reason` | null / cancelled / timed_out / failed；说明已触发取消、到期或失败。收尾期间可先有原因、operation 仍 running；不能提前伪造取消／超时终态 |
| `recheck_in_flight` | **已实现**：该原维护 ID的核对 worker 已获准且尚未结束；不是 refresh 请求的 loading，也不表示正在杀进程 |
| `actions.open` | 当前有经验证、属于本次且仍可使用的链接，后台允许打开 |
| `actions.cancel` | 当前允许请求取消；为 false 不能推出取消成功或登录成功 |
| `actions.retry` | 原尝试已收尾，且当前维护／并发等准入屏障允许重新发起。只是当前许可，下一次 start 仍做原子校验 |
| `actions.recheck` | **已实现**：允许调用既有 account_snapshot(openai,true) 核对该原维护；不保证核对能修复，不新增 recheck/cleanup 命令 |
| `actions.restart` | **仅定义**：允许受理下文的复合重新登录；旧停止尚未证明时也可由后台安全处理，不等于允许直接 start。与只允许清理后新尝试的 actions.retry 不同 |
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
- 主动作使用 actions.restart 与复合入口；actions.recheck 是保留的底层核对许可，不作为用户必须完成的前置工作。复合进行中禁止再次受理同平台新意图，重复请求按下文去重。

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

核对的最小补充落在**尚未实现的 authorize_progress**：`recheck_in_flight` 和 `actions.recheck`，不改现有 AccountSnapshot/AuthorizeClient，不为查询新增清理命令。recheck_in_flight=true 必须绑定已受理的原维护 worker；worker 结束（包括失败）设为 false 并推进 sequence，即使原错误文案未变。checking 期间 open/cancel/retry/recheck/restart 全为 false。actions.recheck 要核对当前原记录、实例和平台准入；已有不可由该核对解除的 processCleanupErr 时应为 false，并保留 blocker。本次另增的 actions.restart 对应独立复合入口。

为了让新实例也能观察原维护，这里同时收窄定义一个**仅供 progress 的历史只读例外**：可查询当前已核验 Hive／用户／设备／平台 journal 中仍是当前维护记录的原 ID；它不是接管历史进程。只能返回该记录和恢复进度，open/cancel 必须 false；任意旧 ID、别的归属或已被新登录替换的记录仍拒绝。status/cancel/open 的现有拥有权规则不变。这项例外、两项新字段和 decoder 都仅定义，当前真实 bridge 尚不能提供。

既有核对的技术调用顺序（供适配与诊断，**不是本轮主动作**）：读 account snapshot 与（未来的）progress → actions.recheck=true 时提交一次 refresh=true → 以 progress.recheck_in_flight 观察受理／完成、以 refresh=false 取维护结果 → restored 且进程清理、设备与运行准入均确认、无 worker/blocker 时，未来 progress 才给 actions.retry=true → 取最新 account.revision 显式 start，生成新 ID。核对若快到未被轮询观察，可直接看到最新终态，不能要求必须看过 checking。历史 unknown 也只在原维护已恢复后允许这条底层新尝试路径，绝不把旧结果改写为成功或自动重放。下一节复合动作另定义不依赖有效旧凭据的安全移交。

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

底层另保留以下**待实现约定**，仍可由 `account_snapshot(refresh=true)` 发起纯核对，不增加通用清理命令：原 job 已结束执行、平台无冲突 worker/action 且原归属可核验时，允许为缓存 processCleanupErr 执行一次新的停止证明核对。未来 progress 只有在该能力实际实现后才可给 actions.recheck=true；它仍不是清理完成证明。核对必须取得**原 lease**，在 Unix 确认原 guardian 已完成原进程组清理和 Wait，在 Windows 确认原命名 Job 无活动进程，并重验原 ID、journal、设备／来源／runtime 归属及完整维护链。成功保存原 journal 后，才可在同一原 job／记录仍有效的条件下原子解除对应缓存，保留原超时／失败／取消结果；再次失败则保留具体 blocker、旧缓存和隔离屏障，等实际原因变化后再核对。不能仅将 phase 改成 restored 或清空错误。主动作的自动停止和安全移交属于下一节独立复合入口，不由此查询替代。

上述缓存重新证明、progress 的核对许可／在途状态与历史读回均**尚未实现**。当前缓存失败样本明确保留 recheck=false、retry=false，并指向等待原回收、原因修复和诊断；其余恢复成功样本以“不存在该缓存错误且全部准入通过”为前提，不能据此宣称缓存失败已恢复。

本轮事实核对绑定 ui 工作区的实现：[Snapshot 触发条件](../../agent/desktop_accounts.go)、[原维护恢复及缓存错误分支](../../agent/desktop_login_maintenance.go)、[原 ID 的 status/cancel](../../agent/desktop_authorize.go)、[Unix guardian](../../agent/desktop_authorize_unix.go)、[Windows Job 查询](../../agent/desktop_login_process_windows.go)、[runtime 恢复归属](../../agent/desktop_login_recovery.go)和 [Tauri 启动门禁](../../desktop/src-tauri/src/experience.rs)。本轮未修改这些后台文件。

## 一次重新登录：待实现的复合契约

这里的“重新登录”指重新发起官方登录，不是重启 App／runtime。仅扩展类型和静态样本；现有协议没有这一能力。前端不能通过 cancel → 轮询 → refresh → start 模拟同等保证：这些调用间没有连续占位、持久去重、旧树最终停止回执或安全维护移交，且可能被并发动作插入。新增的是一个复合操作及其异步查询／取消，不是通用 retry／kill 命令。

### 请求、受理与重复点击

```ts
// Tauri；私有 bridge 参数是 request 对象本身。
{request:{
  request_id:"dddddddddddddddddddddddddddddddddddddddddddddddd",
  platform:"openai",
  previous_operation_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  source:{directory:"/mock/codex",store:"file"},
  expected_revision:13
}}
// 固定的受理回执；不代表停止完成或新进程已经创建。
{instance:"codex-login-contract-mock",result:{restart:{
  id:"dddddddddddddddddddddddddddddddddddddddddddddddd",
  platform:"openai",previous_operation_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  accepted:true
}}}
```

request_id 是调用方在首次发送前生成并保存的 48 位小写 hex，也是复合操作 ID，与旧／新登录 ID 都不同。完整请求（包括原 ID、source 和初始 expected_revision）在重发时不变。每次调用先核验当前 Hive／用户／设备／平台归属，再查该 scope 的幂等记录，最后才对首次受理执行 revision 和当前原记录准入检查，避免原操作自己推进 revision 后阻断合法重放。scope 不由 UI 提供或任意指定。

同 key、同参数返回**原固定受理回执**，不再停止或启动；最新状态另读 restart_status。同 key、不同参数返回仅定义的 AUTHORIZE_RESTART_REQUEST_CONFLICT。不同 key 的并发请求受同平台复合占位约束，返回 AUTHORIZE_RESTART_OPERATION_FAILED 并保留具体冲突证据，不排队暗中再启动一次。source 必须解析并固定到原命名空间；不能以换目录、换设备或换账号规避未决原操作。初始 revision 只用于受理，后台推进产生的新 revision 不要求用户重新点击；移交前仍原子重验用户选择和归属未变。受理回执不证明完整原证据已核验；后台 identify_previous 仍可能发现 journal 缺失并明确失败。

受理前须持久保存请求、原上下文及平台占位；准备新子操作时先持久预分配唯一新 ID和启动意图，再允许 spawn。同 key 的受理记录、查询、取消和占位需跨管理实例恢复，不能只存内存。响应丢失、提交不确定或重启后以原 key 查原记录，不生成新 key 绕过；若无法证明子登录是否启动，state=unknown，保留占位、核对同一子 ID，不自动再次 spawn。暂不定义让已用 key 可重新执行的 TTL：未决记录不得过期删除，已用标识须防迟到重放。以上持久化与恢复均待实现，当前 journal 不能直接提供这些保证。

顶层传输／业务错误也不自动等于“未受理”，须沿原 request_id 查明。只有明确证明受理前拒绝且没有业务执行，或已有确定的失败／取消并给出安全再次尝试许可，才可作为新的用户意图换 key。failure.error 应保留实际失败的 code/check/evidence，不能用统一 restart_failed 替换具体原因。

### 后台顺序与停止证明

| 原操作情况 | 复合动作的行为 |
| --- | --- |
| 原流程和受控树已证明结束 | 不再发送终止信号，核验原停止证据及当前准入后准备新登录 |
| 仍由本实例安全识别并控制 | 撤销 Bee 持有的旧链接，通过**原** controller／guardian／Job 停止，等待整树退出和回收，再继续；仅信号发送成功不够 |
| 历史结果 unknown，但原 journal／guard 与归属有效 | unknown 只表示旧登录结果未知。可自动核验旧停止证据；若仍活且没有安全控制通道，只等待原 owner 回收或具体失败，不能接管任意进程 |
| 原记录缺失、命名空间／身份／归属不明、没有可信控制或停止证据 | 在 identify_previous／confirm_stopped 返回具体错误，既不误杀也不启动；不能把这些情况说成“原登录未完成”或“停止失败” |

后台顺序为 identify_previous → 必要时 stop_previous → confirm_stopped → prepare_new → start_new。原树已停止时跳过 stop_previous。确认须包括原 lease、Unix 原 guardian 的整组清理及 Wait 回执／Windows 原 Job 的无活动进程与 root 回收，并确认受控执行者已不能继续写凭据；job.done、锁过期、旧 PID消失或取消返回均不能单独证明。当前 job 没有保留原树 controller 和最终完成回执，Windows 历史恢复只有查询，因此“再次安全停止”仍是明确实现缺口。禁止按名称／旧 PID／PGID 查杀，禁止新建 guard 冒充原证明。

停止后重新读取实际来源，记录已发生的凭据变化，不能把取消解释成从未写入。prepare_new 继续核验设备 binding、原选择 fingerprint/generation/revision、无未决账号写、runtime 归属、原 source 命名空间、Hive 暂停读回与目标 worker drain。旧进程占用可以释放，但复合占位必须连续保留，直到新 owned job 原子接管，防止两个登录穿插。

**不能机械复用完整 recoverLoginMaintenance 作为唯一移交前提。** 它要求旧凭据可读且有效，而新登录本来允许 source_missing／invalid_credentials。待实现的内部安全移交须在旧停止、原 scope／命名空间、暂停和隔离已证明后，允许这两类旧凭据内容问题交给新官方登录修复；不能把原目录／命名空间无法确认也解释成可忽略的内容缺失。权限拒绝、目录／存储变化、归属／选择冲突仍阻止启动。移交必须保留旧终态与停止证据并关联新 ID，不能将未恢复的旧凭据伪写成 restored，不能借覆盖旧 journal 解除屏障。现有 fresh journal 只允许替换 restored 记录，故这里还需要明确的新内部持久化过渡，不修改原 AccountLoginMaintenance 公共枚举来冒充已支持。

新登录沿用已有固定程序／版本／存储准入和候选核验，产生一个新 ID及独立 state/PKCE；旧的 failed／timeout／cancelled／unknown 结果保持，未结束的旧操作只按其真实收尾结果更新。旧 ID不得附着到新进程；当前 Start 会删同平台旧 jobs，未来复合操作必须在替换前另存原结果／证据。不得自动接入、换号或解除暂停。进程停止证明只覆盖 Bee 的原受控树，不保证独立官方客户端或用户自行运行的写入者也停止；keyring 等外部存储的迟到写入屏障尚未验证，不能仅据进程退出宣称该存储已安全隔离。本次样本仅使用 file；真实 capability 须按实际存储能力验证后开放。

另一个准入缺口是 CLI 的端口冲突行为：它在绑定常用 loopback 端口失败时会主动请求该端口的 /cancel，不能借“启动新 CLI”去清理旧流程，也不能因此干扰不属于本次原流程的 listener。未来 prepare_new/start_new 必须有经验证的隔离／启动策略，证明不会取消未知归属的 listener；启动前探测一次端口空闲不足以消除竞争。当前还没有已验证的禁用冲突取消或隔离端口适配，因此不能宣称这一复合 capability 已安全可用；不能满足时须在相应环节具体失败。

### 进度、取消和再次尝试

CodexLoginRestartProgress 使用独立 workflow state/stage，不新增 AccountOperation.kind；previous_operation 与 new_operation 保持原 operation 格式。previous_stop=unknown/confirmed 单独表达原树停止证据，不能从旧 operation.state=unknown 推导是否仍活。failure={stage,error} 保留本次失败环节及具体 AccountError，旧 operation.error 不被覆盖。查询返回仍包在 `{instance,result:{restart:...}}`，只接受当前已核验 scope 的原请求 ID。

未来严格 decoder 须检查当前 instance、请求 ID／平台、同实例的单调 sequence、旧／复合／新 ID区分及字段关系；出现新子时必须已有非空原 operation 与 confirmed 停止证明，且不得继续给复合 cancel 许可。类型定义和静态断言不代替这一运行时验证。

| 返回 | 允许的判断 |
| --- | --- |
| pending/running | 编排中，禁止再次点击；actions.restart=false。stage 说明正在识别、停止、证明、移交或准备新登录 |
| succeeded + 新 operation | 新子登录已持久受理并接管占位，不表示官方授权完成；以后按新 ID 的 progress/status/open/cancel 处理 |
| failed + failure.stage/error | 停在具体环节，保持必要隔离。actions.restart=true 仅表示可以用新 key 显式再发一次完整编排，不允许直接跳到 start；false 表示先等原回收、修复实际原因或诊断 |
| unknown | 复合执行结果未查清；以原 key／原子 ID继续核对，不误说成旧进程停止失败，不允许新 key 绕过 |
| cancelled | 已接受取消并完成必要回收／持久收尾，没有受理新登录；不承诺回滚已写凭据或恢复接单 |

restart_cancel 的 actions.cancel=true 截止于**持久提交新子登录启动意图之前**。接受后先保存 cancel_requested=true，阻止 start_new，即使仍须继续原树清理；取消等待中仍 running，清理失败则 failed，不能先报 cancelled。新子启动意图与取消在同一占位内串行：若取消先获准，不得启动；若子启动先提交，复合取消不再受理，返回最新状态和已分配的新 ID（cancel_requested=false）。此后取消登录使用既有 authorize_cancel(new ID)，也须等待新树停止；不得显示复合取消成功来掩盖仍活的新流程。终态复合操作不被迟到取消改写。

失败后的安全再次尝试由后台根据本次证据计算 actions.restart，不是“任何失败均可重试”。例如已证明未创建新子而程序暂不可用，修复后可用新 key；原记录缺失／归属不明、停止无法证明、spawn 结果不明或写入完成状态不明时不能直接再发。安全重试也不保证成功，不设自动无限重试。用户只触发重新登录，内部核对和必要停止由 Bee 负责；不可修复时仍保留诊断／原因修复出口。

停止与核对须使用有界等待；具体期限留待后台实现配置与验证，本契约不虚构到期时间。等待耗尽返回实际停留环节及未取得的证明，禁止启动新子，必要的 guardian 清理和隔离仍保留，不能因编排等待结束就释放未证明安全的占用。

### 旧浏览器页与已发生的凭据写入

受理复合动作时撤销 Bee 内旧链接的 open 许可；这只是不再提供／复用链接，**不等于关闭浏览器、撤销网页授权或服务端请求**。绑定的 0.162.1／0.163.0 普通新登录会生成新 state/PKCE，旧 /auth/callback 命中新 listener 时因 state 不匹配而拒绝，不兑换旧 code、不写旧凭据。但 /success 与 /cancel 没有 state 校验：旧页面刷新可能让复用同一端口的新 CLI 提前成功退出或取消。不能承诺旧页面对新流程完全无影响，也不能把 exit 0 当成新授权成功；仍须核验本次来源变化和候选身份，无法核实就具体失败。

CLI 在 process_request 内兑换和保存凭据时不会被外层取消通知立即抢占，保存早于成功页面／CLI 退出。完整回收只能证明旧受控本地执行者不能再继续写，不能回滚此前落盘或撤销已发服务端请求。新 CLI 启动还会尝试 logout_with_revoke，撤销失败可继续本地删除；因此也不承诺原凭据在新登录失败／取消后保持原样。该机制不按旧页面 state 撤销待完成网页授权，也不退出浏览器账号会话。停止后与新登录结束后都需按实际来源核验，外部存储的未决写不能被当成已消失。

可复用的已有实现是原取消／guardian／Job、guard 查询、绑定／暂停／隔离与新登录校验；仍缺复合命令和严格 decoder、持久去重／占位、原 controller 完成回执、安全维护移交、取消与子启动提交的串行及故障恢复。旧浏览器的无状态路由隔离也未经 Bee 集成验证。这些限制不通过重启 App／runtime 消除，本轮不实现上述后台能力。

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
  codexLoginRestartExamples,
} from './tests/fixtures/codex-login-contract.ts';

const waiting = structuredClone(codexLoginExamples.waitingWithLink);
// waiting.result.progress 为 CodexLoginProgress；不会打开任何网页。
const openFailure = structuredClone(codexLoginOpenExamples.launcherFailed);
const recovery = structuredClone(codexLoginRecoveryExamples.recheckRequested);
// recovery.request 只是请求描述；accountReply 是既有格式，可能仍为旧 blocked。
// progressReply 使用仅定义的扩展格式，不代表真实 bridge 已支持。
const restart = structuredClone(codexLoginRestartExamples.stoppingPrevious);
// receiptReply 是固定受理；progressReply.result.restart 才是编排状态。
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

新复合样本 `codexLoginRestartExamples` 全部**仅定义**，不执行请求，不证明进程／端口／凭据隔离已实现。每项含请求描述、同一个固定 receiptReply 和独立 progressReply；旧 ID是 a×48，复合 ID是 d×48，新子 ID是 e×48。它们是替代场景，不是重发后依次执行的脚本。

| 场景 | 静态含义 |
| --- | --- |
| stoppingPrevious | 后台正在停止原受控流程，禁止重复点击；可请求取消整个编排 |
| confirmingStopped | 已请求停止，尚无正面停止证明，不创建新子 |
| startingAfterStop | 原树已停止，尚未提交新子启动；也适用于原本就已停止而直接准入的路径 |
| newLoginStarted | 安全移交后受理新 ID；附子登录 starting 进度，旧超时保持，尚未授权成功 |
| stopBlocked | OS 权限拒绝导致无法观察原组，停止证据未知；不声称仍活，也不启动 |
| unidentifiedPrevious | 原 journal 缺失，原 operation=null、停止未知；属于识别失败，不是假定原登录未完成或 kill 失败 |
| unknownHistoryStopped | 原登录结果仍 unknown，但停止已证明后受理新子；不把原结果改成成功 |
| startRejectedSafeRetry | 程序缺失，已证明未创建新子；修复程序后可用新 request_id 再次显式发起 |
| launchOutcomeUnknown | 新子 ID已持久保存但启动结果未知，只能核对同一子，不重放启动、不换 key 绕过 |
| cancelledBeforeNew | 取消已接受，旧树已回收，未受理新子；不保证此前凭据未写入或被回滚 |

## 官方事实与未决验证

官方文档说明 `codex login` 走浏览器授权，也说明可以使用 CLI 打印的地址；见 [OpenAI 官方认证文档](https://learn.chatgpt.com/docs/auth)。本轮查阅文档、核对本机 `codex-cli 0.162.1` 的 version/help，并绑定公开源码快照：

- [0.162.1 CLI 登录输出](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/login.rs#L120)：登录服务器启动后无条件向 stderr 打印本次 auth_url。
- [默认及打开逻辑](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L194)：默认尝试 `webbrowser::open`，结果被忽略，调用早于 CLI 打印。不能把“未拿到链接”等同于自动打开失败。
- [授权地址及回调](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L77)：默认 issuer 为 auth.openai.com，路径 /oauth/authorize；回调为 loopback /auth/callback，常用 1455、备用 1457。后续须验证精确官方 origin/path、参数唯一性和实际回调，保留官方生成的 PKCE/state，不自行拼 URL。
- [CLI 等待循环](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L225) 没有可用于本契约的固定到期时间。Bee 已有管理端总期限 10 分钟，版本/help 各 5 秒；不能把这些写成授权服务保证的链接过期时间。
- `rust-v0.163.0` 对应 `83086188ae0614bd882818ff1aa23f3194962012`；以上 CLI 登录和 server 文件与 0.162.1 快照逐字相同。此证据不推广至所有未来 patch，也不扩大现有版本适配范围。

本次只读核对补充的一次重新登录事实，同样绑定上述两个逐字一致的版本快照：

- [新 state/PKCE 与 listener 绑定](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L178)、[旧 state 拒绝](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L364)以及 [PKCE 兑换](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/oauth/client.rs#L58)：证明正常新尝试的客户端绑定，不证明服务端已撤销旧授权。
- [无 state 的 /success、/cancel](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L509)和 [端口冲突主动 /cancel](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L620)：不能承诺旧页面失效，也不能用新 CLI 的端口竞争代替原树控制。
- [取消等待循环](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L230)与 [先保存再成功跳转](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs#L419)：取消申请不证明没有写入。
- [启动前 logout_with_revoke](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/login.rs#L126)、[本地删除与撤销](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/auth/manager.rs#L994)及 [撤销 token 的选择](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/auth/revoke.rs#L55)：不等于撤销待完成网页授权或退出浏览器会话。

当前 Go 实现将 Codex stdout/stderr 丢弃，还没有取链／进度／安全打开逻辑。后续须实现并验证：有界流式 stderr 解析及校验、无链接等待、打开失败后再开、重复打开不重启、取消／超时即时撤销链接、完整进程清理后重试、陈旧 ID和实例保护、最终候选核验及暂停规则、跨 Go/Rust/TS 严格契约校验。

本轮**没有启动真实 `codex login`、没有生成真实登录链接或完成真实账号授权**；没有证明跨系统实际输出、opener 行为、取链时序或安全打开集成已通过。普通 CLI help 未见禁用 opener／机器可读输出参数；`BROWSER` 等环境变量能否可靠关闭自动打开仍未证实，暂不作为契约前提。当前仅交付静态模拟，原始 UI 会话可基于上述字段继续评审。

## 本轮验证

在 `bee-desktop-ui/desktop` 执行现有 `npm run typecheck`，以及对嵌套 fixture 显式执行 TS7 严格类型检查，均通过。`node --test tests/authorize.test.ts` 的 2 项现有接口测试通过。12 个进度、3 个打开结果和本次补充的 7 个恢复样本，经原有 `decodeAuthorizeValue`、`decodeAccountError`、`decodeAccountReply` 与动作／阶段／错误一致性检查通过。恢复样本另核对了原 ID和超时结果不变、提交不等于受理、能力字段稳定、source_missing 证据和缓存失败许可。这些证据只证明契约样本及旧接口兼容性，不证明扩展原生实现。

在 ui 工作区根目录运行以下 3 项既有 Go 测试通过：TestDesktopLoginMaintenanceUnknownPauseOnlyRechecksOriginalProcess、TestDesktopLoginMaintenanceReadOnlyRepairDischargesOnlyConfirmedJournalFailure、TestDesktopLoginMaintenanceRecoveryPreservesFailedCancelledAndTimedOutLogin（`go test ./agent -run '^TestDesktopLoginMaintenance(UnknownPauseOnlyRechecksOriginalProcess|ReadOnlyRepairDischargesOnlyConfirmedJournalFailure|RecoveryPreservesFailedCancelledAndTimedOutLogin)$' -count=1 -timeout=90s`）。它们覆盖原维护只核对、不重放外部登录／暂停写、已确认 journal 修复只解除存储错误，以及保留原失败／取消／超时结果；不能证明拟议的缓存错误解除或 progress 已实现。没有新增实现测试。

只读独立核对发现的打开错误命名不一致、取消样本提前进入终态已修正：清理中的取消／超时保持原 operation running，用 stop_reason 说明原因；最终取消保留 authorization_cancelled 错误。没有修改或运行 UI 页面、预览和真实账号流程。

本次恢复续补的独立核对还修正了 source_missing 被泛化、维护 journal 提前进入 reconciling、能力字段被当成动态准入，以及 12 秒被误写成完成保证的问题。最终三文件复核无重大语义矛盾；未解决项明确保留在“再次受阻后的下一步与真实缺口”。

本次“一次重新登录”续补重新通过 npm typecheck、嵌套 fixture 的 TS7 严格检查和 2 项旧 authorize 接口测试；12 个登录进度、3 个打开结果、7 个维护核对及新增 10 个复合样本均通过既有 operation/error/account decoder 与静态不变量检查。新增样本核对了固定受理回执、三个 ID分离、停止证明先于新子、unknown 结果与停止分离、取消提交边界和失败后安全再次尝试。没有新增后台实现测试，也未重跑上轮 Go 测试；上轮结果不能用于宣称复合命令、持久去重、端口隔离或取消竞争已经实现。独立只读复核无重大语义矛盾。
