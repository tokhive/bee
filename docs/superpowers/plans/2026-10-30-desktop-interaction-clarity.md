# Bee 桌面交互清晰化实施计划

> **执行要求：** 使用 `executing-plans` 在当前会话逐任务实施；若用户选择子代理方式，则使用 `subagent-driven-development`。按 `- [ ]` 跟踪任务，未获本计划执行确认前不修改产品代码。

**执行状态：** 2026-11-02 用户明确批准当前 spec 和 plan 全量实施，包含 11 月 1 日补充的启动恢复、设备重新绑定及首次配对保护；不追记为 10 月 29 日已经授权。当前逐任务执行，以下复选框及[验证台账](../../desktop/interaction-clarity-validation.md)记录实际进度。

**目标：** 落实方案 B 和视觉方案 1“清晰分区”，让用户理解当前能否接单、具体阻塞、可执行操作及操作结果，并能走通故障处理、绑定、账号接入到实际接单的流程，覆盖整个正式桌面 App。

**架构：** 在现有 Bee 核心、私有桥和 Hive 平台状态接口补齐真实原因，由共享呈现函数生成主状态和处理入口。复用四页导航及状态协调器，保留现有业务校验、读写边界和银白／shadcn 风格。

**技术栈：** 沿用 React 19.2.8、TypeScript 7.0.2、Vite 8.2.4、Node 24.x、Radix 1.8.1、Lucide 1.43.0、Tailwind 4.3.3、Tauri 2.12.5、Rust 最低 1.90、Go 1.27.3；以锁文件为准。不新增依赖、服务、数据库或路由库。

**依据：** [设计及本轮修订](../specs/2026-10-29-desktop-interaction-clarity-design.md)、[决策记录](../specs/2026-10-29-desktop-interaction-clarity-design-decision-trace.md)及[11 月 1 日实况报告](/Users/dayong/myspace/mywork/tokenhive/design-previews/2026-11-01-bee-interaction/usability/REPORT.md)。本文只定义实施接口、任务、顺序和验证，不重复设计说明，不预写完整实现。

**完整范围：** [全流程走查与76项场景矩阵](../reports/2026-11-01-desktop-full-scenario-review.md)为所有任务的验收索引。当前401组合只是其中一项；首次使用、日常操作、失败恢复、结果未知、导航与重启均需逐行登记。原12任务编号保留，新增缺口并入对应任务，不只补真实测试碰到的分支。

## 全局约束

- 未知不等于未绑定、零账号、断线或零额度；过期事实只可用于“上次确认”，不能支持可接单结论或写操作。
- 开始贡献不解除暂停；接入和换号完成后仍暂停；写入结果未知只查询，不重放写入。
- 失败以本次事实为依据，保留同一提示中的安全原始证据；不按英文整句猜测原因，不将故障一律归为代理错误。
- 自动读取、核心重连、用户主动诊断分开；只显示实际调度的重试时刻；沿用既有退避与恢复条件。
- 正式 NativeApp 可达路径覆盖中英文；日期数字使用 App 语言；品牌、代码、URL、账号标识及安全原文允许保持原文。
- 关键状态、原因和操作说明至少 12px，正文 13px，主状态 16px；主要区块留白 24px，关键按钮高度 32px，重要文字对比度至少 4.5:1。
- 验证 860×600 与常规尺寸、中英、明暗、长内容、键盘、减少动态效果和后台刷新稳定性。
- 布局与已有按钮位置尽量沿用原批准方案；方案1用于状态层级与提示。开始／停止保留运行摘要右侧；暂停／恢复及账号动作保留右侧额度区下方靠右，窄窗口按原响应式规则与额度同组。必要的位置变化须记录可用性原因及同尺寸前后对照。
- 不修改供给准入、资金、任务收尾、自动接管或自动换号规则；不新增持久化引导进度。
- 凭据明确撤销后的恢复必须由用户确认，复用 Hive 网页归属及替换确认；恢复事务需要受保护的本地持久化，它不是引导进度。恢复后贡献保持停止，旧账号选择与运行意图不自动迁移到新设备。
- 管理进程可通信不等于业务启动就绪；身份失败不封锁全部页面，开放本机读取不放宽 Hive 写入、二进制完整性或更新核验边界。
- 每任务只提交本任务文件，英文 Conventional Commits；文档中文。纯文案／字号调整用人工验收，不建立实现镜像测试。

**2026-11-02布局检查补充：** [布局报告](/Users/dayong/myspace/mywork/tokenhive/design-previews/2026-11-02-bee-layout-audit/README.md)已区分原型修正、旧组件问题和未画出的状态。T5修复用户换页后沿用旧滚动位置导致新页标题被顶部栏遮住，同时保持后台刷新不抢阅读位置；T6统一摘要/异常卡文字起点、右侧动作及24px间距；T7按三种尺寸和真实长文案验证账号两栏断点、右侧按钮和正式详情面板；T8/T9补齐完整设置/诊断/更新及异常画面；T10逐行补76项布局证据，包含展开后滚动、导航后标题可见、明暗/中英及焦点。未画出的场景不得以模板复用替代验收。此次仅原型与文档修订，不勾选任何实施任务。

## 工作区、顺序与验证约定

Bee 根目录 **B**：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`，当前分支 `feat/bee-desktop-p0`。Hive 根目录 **H**：`/Users/dayong/myspace/mywork/tokenhive/hive`。下文文件默认相对 B，`H:` 前缀相对 Hive 执行工作树。终端命令注明工作目录。

执行前读取适用 `AGENTS.md`，通过 `using-git-worktrees` 检查隔离：复用 B；Hive 改动在隔离工作树实施，并将 H 解释为其实际路径。执行前 B 的 `Makefile`、`desktop/README.md`、设计及决策记录等已有改动，计划／审查报告／原型等未跟踪文件均保留。2026-11-02 实查 H 原工作树干净，HEAD 为 `ae6573b`，有效 `bee` gitlink 为 `6fccf3b11a2a430075e4e23634eda4913e3ced08`；先前 `c270ba6` 脏引用记录已过时。Hive 实施工作树为 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/hive-desktop-interaction`。以有效子模块基线移植必要协议提交，不回退新版 TEE／CLI／账号修复，不修改 H 原树。

依赖顺序：T1 → T2；T3 可在 T1 后推进，T4 依赖 T3；新增 T4a 依赖 T4，T4b 依赖 T4a；T5 依赖 T2–T4b；T6、T7 依赖 T5；T8、T9 依赖 T4a、T5；T10 收口全部 12 个任务。保留原编号便于追踪，T4a／T4b 是本次真实测试暴露的必要补项。它们属于同一用户流程的数据和呈现链，保持一个计划，不能只完成页面部分即宣布交付。

每任务按“建立具体失败案例 → 确认业务断言失败 → 最小改动 → 定向验证 → 提交”执行。下列命令须实际选中测试；工具缺失、测试被跳过或只因编译错误失败均不算行为验证。默认命令前完成工程既有工具链、TEE 依赖及 sidecar 准备，不自行升级锁定版本。Go 定向测试使用合成账号和本地服务，不发起付费推理。

## 编号实施路线与每步通过条件

以下是现有12个任务的执行摘要，不另建一套任务；详细文件、接口和测试仍以下文对应任务为准。各步完成其定向验证，最后在同一最终版本做完整联调。

| 顺序／任务 | 实现结果 | 通过依据 |
| --- | --- | --- |
| 1／T1 | 统一 Go、Rust、TS 的供给原因契约 | 三层解码和兼容测试通过；未知／矛盾数据不能变成可接单 |
| 2／T2 | Hive 返回实际阻塞原因，Bee 完整传递 | 未接入、未注册、市场未开放及供给限制分别有事实；新旧三组合不改变准入结果 |
| 3／T3 | 提供真实连接失败、连接阶段及重试状态 | 注入 DNS、TLS、超时、拒绝、断线、同步失败；提示对应本次事实，旧运行结果不覆盖新状态 |
| 4／T4 | 统一错误说明、处理中状态和中英文呈现 | 已知错误显示本地化原因与对应操作；原始证据可查，未知原因不猜测，切语言同步更新 |
| 5／T4a | 启动核对受阻时仍能进入恢复页面 | 身份／网络失败时四页可达并可重查；Hive 写入、更新和二进制校验仍受保护 |
| 6／T4b | 走通首次绑定与失效设备重新绑定 | 网页确认、过期、写盘失败、响应丢失、重启逐项验证；请求次数正确，恢复后仍停止 |
| 7／T5 | 各页共享准确状态，分平台读取并保留恢复上下文 | 慢平台不拖住另一平台；未知不计零，旧数据不误报可用；跨页保留草稿且不重复提交 |
| 8／T6 | 用方案1落实概览和设备交互 | 能否接单、原因、主操作与真实状态一致；等待确认按钮、失败留白、断线和恢复路径可操作 |
| 9／T7 | 完整接通两平台账号、登录、换号及接单操作 | 读取→确认接入→暂停→开始→主动恢复逐步有回执；取消、超时、换号未知和额度阻塞有明确下一步 |
| 10／T8 | 设置与诊断失败后可继续原流程 | 代理保存／生效分别核对；草稿不丢；诊断读取失败后续查原报告；权限、日志和导出反馈真实 |
| 11／T9 | 完成更新、菜单、通知和退出重开的行为及语言 | 原生验证关窗／退出／停止差异、正常／异常重开、更新失败和重启核验；不自动解除暂停 |
| 12／T10 | 完成全链路与原生验收，交付可复核证据 | 76项及实施中新发现分支逐条通过，受控请求实际完成，必要平台／系统无待验项，最终检查通过 |

## 如何判定功能完整

1. **范围闭合：** 用“已确认能力／正式入口／实际状态分支 → 场景ID → 实现任务 → 验收证据”双向追踪；已有76项是起点，新增动作、枚举或前置条件必须补入矩阵。反查全部入口和分支不能存在无人实施、无法操作或没有验证的项。范围沿用 spec，不扩展到收益、资金等已排除能力。
2. **行为闭合：** 每条用户路径都检查前置条件、读取／提交、进度、成功、失败、未知结果及恢复后继续。按实际副作用追加双击、导航、响应丢失、写盘失败、重启及旧回调断言；只读恢复不得重放写入，恢复后不得擅自接入账号或解除暂停。确需管理员处理的分支，指引必须对应真实可用且验证过的操作；只有泛化提示不算完成。
3. **证据分层：** 核心／契约测试证明状态和写入边界，正式组件测试证明交互，真实 Bee＋Hive＋官方客户端及原生壳证明实际链路。三层各有职责，不能用截图、测试总数、编译成功或模拟IPC取代真实结果。沿用既有账号运行验收，在专用验收环境和账号的明确请求范围内，各平台完成可追踪的受控请求，核对 Hive→本 Bee→官方上游→返回；暂停后不再派发新请求，停止后不可继续接单。Hive ready 本身不证明请求能完成。
4. **证据可复核：** 在 T10 的 `docs/desktop/interaction-clarity-validation.md` 按场景及必要子用例登记：需求／入口、场景ID、任务、Bee/Hive提交及工作区差异、OS／客户端版本／环境、前置与输入、实际操作、预期及实际结果、脱敏日志／测试断言／截图或原生回执、结论及未通过原因。支持“通过／失败／待验／有依据的不适用”，空白和跳过不能算通过；最终构建或依赖版本改变时重验受影响项。
5. **交付门槛：** 12任务完成，全部必要场景有与最终版本对应的通过证据，现有两项预览失败及所有发现的问题已验证关闭，没有未解决的功能阻塞、重复写入、错误接单结论或必要真实路径待验，才可声明本次范围功能完整。缺少真实账号、目标OS、签名更新包或可行恢复协议时如实保留缺口；配对创建响应丢失且无token的人工处理路径也须验证，否则不算整体完成。

## 一次定义的接口

### A. Hive 详细原因选项

现有 GET／PUT `/api/bee/platforms/{platform}` 增加请求选项 `reason_detail=1`，无此参数保持旧响应语义。新 Bee 的 GET、PUT 和 PUT 后 GET 均携带该参数；PUT JSON 仍只有 `paused`。旧 Hive 会忽略该查询参数并返回原契约；不因旧码或传输失败自动重放 PUT。

响应仍为 `{platform, paused, ready, reasons}`，不增加字段。新增原因仅在详细请求下返回；`beewire.SupplyReasons()` 和默认网页／CLI 原因集合保持旧语义，新增 `DetailedSupplyReasons() []string` 返回旧、新码并集，供新桌面校验使用。

| 新原因码／Go 常量 | 必须有的事实；呈现职责 |
| --- | --- |
| `account_not_registered`／`ReasonAccountNotRegistered` | Hive 对应平台账号记录确实不存在；表示未完成 Hive 注册，不证明本机未接入 |
| `market_not_open`／`ReasonMarketNotOpen` | Hive 全局市场在该平台无符合现有发布／价格／协议条件的可交易模型；不能仅从设备绑定模型子集为空推出 |
| `supply_not_enabled`／`ReasonSupplyNotEnabled` | 该设备无有效静态供给且平台动态供给未配置；由管理员处理 |
| `supply_device_restricted`／`ReasonSupplyDeviceRestricted` | 同一所有者的平台静态绑定实际指向其他设备，阻止当前设备动态供给 |
| `account_not_admitted`／`ReasonAccountNotAdmitted` | 当前账号指纹明确不在动态供给允许集合中；不回传他人指纹或允许集合 |

继续使用现有 `model_unavailable` 表示市场已开放但该账号／供给没有可用模型；`authorization_unavailable` 保留其“无可用加密授权”的确切含义，只有账号同步事实明确时才说“正在同步”。其他现有码保持语义。

细分只解释原判断，不改变准入：保留全部独立阻塞，对原 `not_configured`、`model_unavailable` 和 `authorization_unavailable` 分支收集可证明的上述事实；多项同时成立可同时返回。市场全局未开放可细分原模型不可用；本次业务确实依赖账号注册时，才将缺少记录作为注册阻塞，不能阻断原本不依赖动态注册的静态供给。默认响应继续原分支及原原因，不向原本 ready 的路径添加展示性阻塞。详细响应与默认响应的 `paused`、`ready` 一致；原因去重，`ready == (reasons.length == 0)`，`paused == reasons.includes('manually_paused')`。不能细分的原阻塞保留原码，不猜测。新模式增加查询失败时返回失败，不把读不到解释当作业务结论。

Hive 保留 `PlatformSupply(ctx, identity, platform, paused)` 作为旧入口；新增同参数的 `PlatformSupplyDetailed`，两者共用一次暂停事务与状态判断，通过内部详细选项选择原因。控制器只按单个 `reason_detail=1` 选择新入口；未知值／重复该参数在任何写入前返回 400，不扩大其他查询参数的校验范围。

### B. 真实连接观察

保留 `RuntimeSnapshot.connection`，新增必填可空字段 `connection_detail`。Go 名 `DesktopConnectionDetail`，Rust／TS 对应 `ConnectionDetail`，JSON 字段一致：

- `failure: ConnectionFailure | null`；失败包含 `code`、`stage`、`occurred_at`、`message`、`evidence: Record<string,string>`。
- `code` 固定为 `dns_failed | tls_failed | connection_refused | timeout | http_rejected | connection_closed | synchronization_failed | ownership_unconfirmed | unknown_failure`。
- `stage` 固定为 `connect | heartbeat | synchronize`；时间为 UTC RFC3339；`message` 保留经过脱敏的原始原因链。
- `evidence` 只允许 `target_origin`、`path`、`http_status`、`remote_code`、`response_body`、`owned_session`、`consecutive_conflicts`；值来自实际失败，字段和长度沿用现有私有协议的限额，不允许凭证和完整敏感响应。
- `retry: 'idle' | 'attempting' | 'scheduled' | 'halted'`，以及 `next_retry_at: string | null`；仅 scheduled 允许且必须带实际定时器的计划时刻，已过期的快照时间不据此自行重试。

`connectObserved` 的观察回调由 `func(string)` 改为 `func(DesktopConnectionObservation)`，后者含 `Connection string`、`Detail *DesktopConnectionDetail`，桌面通过 `connectionObserved(run string, observation DesktopConnectionObservation)` 接收。CLI 的 nil 观察者行为不变。使用现有错误类型和实际 HTTP 响应分类，不解析日志或整句英文。详情跟随外层 run_id／revision；等待和下一次尝试保留最近失败，确认连接后清除，主动停止清除，旧运行回调拒收。

### C. 结构化失败与呈现

复用已有 `AccountError`、诊断和网络检查结构。对仍仅返回 `{code,message}` 的私有 `protocolError`／Rust `BridgeError`／TS `BridgeError`，增加可选 `details`：`{check:string, observed_at:string, evidence:Record<string,string>}`。旧的无详情错误仍可解析；有详情时字段、时间和证据严格校验。固定安全证据键为 `target_origin,path,http_status,remote_code,response_body,source_type,actual,required`；不将任意异常对象序列化为 evidence。

Go 新增 `DesktopFailure`（Code、Message、Details、内部 Cause，支持 Unwrap），仅在当前缺失机器原因的设备／供给请求边界使用；现有账号错误保留原类型。错误码使用上述真实网络分类及现有领域码；调用环节放在 details.check，不用通用包装覆盖具体失败。Rust 通过 `BridgeError::with_details` 构造有证据的失败，原 `new` 返回无详情错误；所有 struct literal／解码器同步适配。正文安全限额沿用协议原有限额，超限明确报告实际长度与限额，不声称保留了完整正文。

新增 `desktop/src/system/failures.ts`：`normalizeFailure(cause: unknown, check: string): UiFailure`，`UiFailure = {code:string, check:string, observedAt:string|null, evidence:Record<string,string>, message:string}`。适配已知结构；无结构信息只保留已知环节及安全原文。系统状态保存 UiFailure，不在 catch 时压平成字符串，不储存已翻译文案。

新增 `desktop/src/presentation/problems.ts`：`presentFailure(failure: UiFailure, locale: 'zh'|'en'): PresentedProblem`。结果含 `summary, impact, details` 文本与 `action: NavigationTarget|null`；只有已证实的原因才提供处理入口。已有稳定 code／check／evidence 生成说明，原始原因在同一提示的详情里。已知错误不得只显示英文原文，未知错误不得假造翻译后的具体原因。

### D. 共享状态与目标导航

扩展现有 `desktop/src/app/navigation.ts`（保留四页导航定义）：`NavigationTarget = {page:'overview'|'accounts'|'diagnostics'|'settings', section?:'runtime'|'connection'|'device'|'account'|'source'|'network'|'notifications'|'appearance'|'about', platform?:'openai'|'claude'}`。由固定页面／section 对应表校验，禁止无效组合；设置类别与当前四页签名称对齐。`RecoveryContext = {from:NavigationTarget, target:NavigationTarget}` 只保存当前会话的一次返回关系，不建立持久化流程栈。

设置目标对应现有页签：network → network，notifications → system，appearance → general，about → about；不重命名页签。NativeApp 持有 `navigate(target: NavigationTarget)`、`returnFromRecovery()`、设置草稿与账号来源草稿；已有运行／账号模型继续拥有提交和核对上下文。页面收到 target 后只展开／滚动／聚焦，不自动发起诊断、提交或登录。实例或绑定变化清除失效操作上下文，不能把旧错误带到新实例。

新增 `desktop/src/presentation/desktopStatus.ts`：`deriveDesktopStatus(snapshot: DesktopSnapshot, now: number): DesktopPresentation`。字段为 `kind`（`loading|unconfirmed|failed|rejected|occupied|unbound|pairing|starting|stopping|no_accounts|stopped|connecting|disconnected|paused|ready|blocked`）、`severity`（`neutral|info|warning|error|success`）、`readyPlatforms`／`blockedPlatforms`（平台数组）、`problem:UiFailure|null`、`primaryTarget:NavigationTarget|null`、`preparationStep:'bind'|'confirm_device'|'connect_account'|null`；具体平台阻塞仍从原始 snapshot 读取，不复制另一套事实。文案在渲染时按 locale 生成；kind 按 spec §3 优先级选择，完整四步说明仅在 preparationStep 非 null 时显示。只读事实派生，不承担提交或重试。

`DesktopSnapshot` 保留业务事实，错误字段改为 UiFailure／null；新增 `refresh:{state:'idle'|'reading'|'scheduled'|'blocked', nextRetryAt:string|null, lastConfirmedAt:string|null}`。时间来自现有协调器真实调度，既有错误／epoch／revision 屏障决定有效性；不另造任意 TTL。正常刷新保留有效事实，失败保留上次事实并显式标记不可用；共享失败和单平台失败分开。

同一 refresh 结构按共享事实及 `accountRefresh[platform]`／`supplyRefresh[platform]` 分别记录；初次部分完成即可发布已确认事实，不等所有平台结束。沿用现有期限与单一协调器，独立平台不互相串行阻塞；同一操作所需的设备／runtime／账号身份一致性仍是写前条件。报告过期后当前实现可能尚在等待下一次协调器读取，应显示真实 scheduled 状态；只有实际读请求发出才改为 reading，不为匹配预览额外建轮询器。

### E. 启动检查、本机上下文和诊断事实

保留真实 `BridgeStatus` 表达管理进程／协议状态；新增独立 `StartupStatus`：`state:'checking'|'ready'|'blocked'`、`failure:UiFailure|null` 及当前实例、绑定、网络版本上下文。原生层保留原始 BridgeError，进入 TS 后统一归一化；以 Tauri `startup_status` 查询和现有状态事件机制传递，不并入 bridge 连接状态。Tauri `startup_recheck` 仅重新核对设备和必要启动前置条件，串行执行并拒收旧上下文结果；不重启、不重新执行运行意图恢复。原有启动顺序和更新完整性核验保持单一所有者，不把失败标志直接清成 ready。

新增只读私有方法 `device_context`：返回校验后的已保存 origin、设备名称、上次 owner/device 标识、绑定上下文 revision 或明确未配置／损坏错误；不访问 Hive、不返回凭据。保存记录只用于解释上次绑定及生成固定同源控制台入口，不能作为 verified identity。`device_status` 中的 `result.error` 先按接口 C 处理，再做可信范围校验；不得被 `NETWORK_DEVICE_SCOPE` 覆盖。

本机候选读取复用 `DesktopAccounts.Detect(local|official)`；身份受阻时不得借 `Snapshot(refresh=true)` 启动旧未决写入 worker。官方登录保留本机运行停止、revision、操作互斥和更新保护检查。恢复、账号选择、开始贡献、恢复接单各自执行核心前置校验，不能用 UI 的 enabled 作为授权依据。

诊断沿用 report 的 instance、run_id、network_revision 及每项 observed_at；新增 `binding_revision`，与 device_context 使用 DesktopSession 内同一单调修订号，绑定内容变化即更新，采集期间变化使该报告失效。Go／Rust／TS 严格解码、导出及 fixture 同步；只接受同一上下文中较新的事实。共享问题摘要可采用明确的设备拒绝证据，诊断通过不能替代启动重查、WebSocket 连接或平台 ready。`device_replaced` 已确认时，账号数据未知不覆盖该具体阻塞；绑定更换立即隔离旧诊断结果。

### F. 用户确认的设备恢复及共同配对保护

新增私有桥方法 `device_recovery_prepare`、`device_recovery_confirm`、`device_recovery_status`；Tauri 同名命令和 Go／Rust／TS 严格解码同步登记。prepare 核对条件并创建本地待确认记录，不调用创建配对；confirm 接收 `operation_id`、`expected_revision` 和 `decision:'begin_pairing'|'adopt_owner'|'renew_expired'`，只允许对应阶段；status 查询已有事务并推进已授权流程：网页已批准后首次兑换、查询未知结果和本地保存，不另建配对或重放兑换。首次待确认以及不同 owner 的确认阶段，重启都不能代替用户确认。

公开 `DeviceRecoveryView` 包含 `operation_id`、`revision`、`phase`、安全的旧／新身份摘要、`pairing`（公开 code、同源 verification_url、expires_at 或 null）、`failure`（接口 C 或 null）。phase 为 `awaiting_confirmation|creating|creation_unknown|pending|draining|redeeming|redemption_unknown|awaiting_owner_confirmation|saving|completed|expired|blocked`。不暴露配对 token 或新旧凭据；URL 仅在既有显式打开命令中使用，不进入日志。对已记录接受的相同 operation_id／expected_revision／decision 重复请求只返回事务现状；其他过时 revision、阶段不符或冲突事务明确拒绝。

在固定桌面配置目录新增私有 `bee-desktop-recovery.json`，沿用安全目录、0600、严格解码和原子写入；不向共用 CLI 的 `localState` schema 塞恢复字段。记录包含版本、操作 ID、revision、阶段、原绑定身份／修订、新凭据、创建／兑换已尝试标记、已取得的配对 token、待保存的新身份、用户已确认的归属和已接受的确认请求标识。通过 `DesktopSession` 进程锁及同一操作互斥保护设备替换、账号写入与运行启动；不持有普通状态 mutex 等待网络。

创建／兑换前先持久化尝试标记。响应未知仅查询原配对／新凭据身份；未取得 token 的创建结果未知保留阻塞并指向 Hive 侧核对和导出，不承诺现有协议没有的查回能力。只有 Hive 确认过期且没有未决兑换时，`renew_expired` 才能保存新一代配对凭据并由用户发起新请求。旧活动配置在新身份验证和必要 owner 确认完成前保留；新配置已保存但恢复记录未完成时，重启核对新身份并补齐本地收尾，不能回退或再兑换。

新设备作用域从停止状态开始；旧选择、未决账号操作、运行意图和代理应用状态不迁移。旧未决操作应先按原机制核对；不能核对时显示具体阻塞，不能为了重绑清除它们。三个 recovery 命令只服务凭据恢复，共同持久化保护也用于首次配对；不新增通用任务框架或 Hive 幂等服务。

首次配对仍由 `device_begin` 进入，三个 recovery 方法仅用于凭据恢复。首次配对共享同一持久化提交保护：记录增加 `purpose:'initial_pairing'|'credential_recovery'`，首次配对的原绑定为空；已有设备配置／CLI schema不变。两种目的都在创建／兑换前保存尝试，不能由 Status/Begin 重放结果未知的 POST。旧记录的 redeeming 视为未决；旧残留缺少创建标记时不能假定未发送。只有明确未提交的业务拒绝可按该条件继续，不能将 approved 查询当作未知兑换可重试的证据。对应 spec §4.2，不扩大自动重绑资格。

**T4b／T6 实施对接说明（2026-11-02）：** 为让首次配对也呈现同一持久化事务阶段，`DeviceView` 增加可选 `recovery:DeviceRecoveryView`，仅公开首次配对事务；既有 pending／draining／expired／bound 状态保持并按需附带该安全视图，其他事务阶段用 `state:"pairing"` 且必须带合法 recovery。三层校验 state／phase／identity／pairing 的一致性，首次仍只走 device_begin／device_status，不调用凭据恢复 prepare。`redeeming`／`redemption_unknown` 只能说明兑换已尝试、待新凭据身份核对；`saving` 表示新身份已验证且必要归属已确认，等待本机保存／读回，不由界面从 message 猜测更细阶段。此说明落实 T6 已要求的首次配对全过程呈现，不新增 Hive 协议或自动恢复资格。
凭据恢复的网页打开沿用原生 `device_open`，新增客户端 `recoveryOpen():Promise<DeviceRecoveryView>` 消费严格 `{recovery}` 返回；首次 `open()` 继续原 DeviceView 契约。原生按当前有效本机 context 验证固定同源网址，仅对真实 pending／draining 配对打开，不接收页面任意 URL。打开失败保留原事务与公开手动网址，不创建新配对。


## T1：供给原因的跨层契约

**文件：** 修改 `beewire/supply_reasons.go`、`agent/desktop_supply.go`、`desktop/src-tauri/src/runtime_protocol.rs`、`desktop/src-tauri/src/diagnostics_protocol.rs`、`desktop/src-tauri/src/diagnostic_log.rs`、`desktop/src/system/supply.ts`、`desktop/src/system/diagnostics.ts`、`docs/desktop/supply-control.md`；测试 `beewire/supply_reasons_test.go`、`agent/desktop_supply_test.go`、`desktopbridge/supply_test.go`、`desktop/src-tauri/src/diagnostics_protocol_tests.rs`、`desktop/tests/supply.test.ts`、`desktop/tests/diagnostics.test.ts`。

**输入／输出：** 落实接口 A 的枚举与 `DetailedSupplyReasons()`，暂不改变默认请求。所有桌面入口接受已定义细分原因，其他未知、重复、跨平台原因和矛盾布尔值仍拒绝。

- [x] 增加具体反例：新原因被旧桌面解码器拒绝；重复新原因、Claude 配 Codex 原因、ready=true 带阻塞、paused 与原因不符均拒绝。明确默认 `SupplyReasons()` 不新增元素。
- [x] 运行 B：`go test ./beewire ./agent ./desktopbridge -run 'Supply|Reason' -count=1`；B/desktop：`node --test tests/supply.test.ts tests/diagnostics.test.ts`，确认预期断言失败。
- [x] 同步上述注册表和白名单；为新码补齐 ExplainReason，使已有诊断不会因码未知而丢弃原因；默认 SupplyReasons 和旧请求仍不产生新码，不改变旧网页／CLI 输出。搜索其他原因消费者，补齐 Rust 的相同反例。
- [x] 重跑定向测试；B：`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`；B/desktop：`npm run typecheck`，均须通过。
- [x] 提交 `feat(protocol): define detailed desktop supply reasons`，记录协议提交 SHA 供 T2 使用。

## T2：Hive 按真实条件细分原因，Bee 显式请求

**文件：** H 修改 `hive/internal/controller/supply_control.go`、`hive/internal/service/platform_control.go`、`hive/internal/service/supply_control.go`、`hive/internal/service/dynamic_supply.go`、`docs/bee-supply.md` 和 `bee` gitlink；H 测试 `hive/internal/integration/supply_control_test.go`、`hive/internal/integration/dynamic_supply_test.go`、`hive/internal/service/dynamic_supply_unit_test.go`；B 修改／测试 `agent/desktop_supply.go`、`agent/desktop_supply_test.go`。

**依赖／输出：** T1；实现接口 A 的 `PlatformSupplyDetailed` 及所有桌面 GET／PUT 的选项，HTTP DTO 不变。

- [x] 在 Hive 隔离树引入 T1 协议提交；记录旧 gitlink 与新 SHA，确认已有子模块变化未丢失。先增加数据库集成案例：未注册、无市场模型、无供给配置、其他设备静态绑定、指纹不准入、账号无可用模型、授权不可用；每例比较有／无选项的 ready 与 paused。
- [x] 覆盖两项原因共存、静态供给无需动态注册的既有路径、暂停且还有阻塞、目录模型全部关闭／价格不完整、市场已有模型但当前设备无绑定模型。不能将所有 nil supply 都当成账号缺失或市场关闭。
- [x] 使用现有账号记录、目录和供给选择条件解释原阻塞；从同一判断收集原因，避免复制一套准入逻辑。读原因失败仍失败关闭，暂停事务只执行一次。参数非法／重复时在写入前拒绝。
- [x] Bee 请求加入选项。使用 httptest 覆盖旧 Hive 忽略选项、原 `not_configured`、新原因、未知原因、PUT 响应丢失后仅 GET；对 PUT 次数作断言。
- [x] H：先 `make db`，再 `TEST_DATABASE_URL='postgres://hive:hive_local_dev@127.0.0.1:55432/hive?sslmode=disable' go test -race ./hive/internal/service ./hive/internal/integration -run 'Test(BeePlatform|BeePause|DetailedSupply|DynamicSupply|ProviderSelfOnboarding)' -count=1 -timeout=300s -v`。使用仓库本地测试库和逐测试 schema；不接生产 DSN。新测试统一 `TestDetailedSupply` 前缀，不能全部 SKIP。
- [x] B：`go test -race ./agent -run 'DesktopSupply' -count=1`。失败案例先红后绿，默认调用与旧测试均通过后分别提交 `feat(hive): explain desktop supply blockers on request`、`feat(desktop): request detailed supply reasons`。

## T3：连接失败、退避与恢复的真实观察

**文件：** 修改 `agent/client.go`、`agent/desktop_runtime.go`、`agent/desktop_runtime_types.go`、`agent/desktop_runtime_sync.go`、`desktop/src-tauri/src/runtime_protocol.rs`、`desktop/src/system/runtime.ts`、`desktopbridge/testdata/runtime-contract.json`、`docs/desktop/bridge-protocol.md`；新增 `agent/desktop_connection.go`、`agent/desktop_connection_test.go`；测试 `agent/desktop_runtime_test.go`、`agent/desktop_runtime_recovery_test.go`、`desktopbridge/runtime_test.go`、`desktop/src-tauri/src/runtime_tests.rs`、`desktop/tests/runtime.test.ts`。

**输入／输出：** 接口 B；所有生成运行快照的真实服务、测试和预览 fixture 同步新字段，包括 `desktop/tests/fixtures/native-accounts.mjs` 和 `desktop/tests/fixtures/bee-preview/fixture.mjs`。私有 sidecar 与桌面一同构建，不引入通用版本协商。

- [x] 注入具体 DNS、TLS、拒绝连接、超时、HTTP 401／403／409／503、心跳失败和同步失败；验证分类来自错误类型／响应，包含安全原始原因，不能通过日志字符串恢复事实。
- [x] B：`go test ./agent ./desktopbridge -run 'DesktopConnection|DesktopRuntime|RuntimeContract' -count=1`；B/desktop：`node --test tests/runtime.test.ts`，确认新增断言失败。
- [x] 改造观察回调和严格 DTO，保留原重连次数／退避算法；从实际 pause 定时器记录 next_retry_at。请求取消属于主动停止时不制造连接报警；真实断线没有底层错误时只说明连接结束，不猜原因。
- [x] 覆盖 run A 失败迟到、run B 已连接、停止中回调、恢复后错误清除、退避期间错误保留、401／403停止重试及既有409所有权规则。检查 supply 清空与 local 状态未被文案改造改变。
- [x] 重跑定向测试，并运行 B：`go test -race ./agent ./desktopbridge -run 'DesktopConnection|DesktopRuntime|RuntimeContract' -count=1`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`；更新运行契约 fixture 后 TS 解码测试通过。
- [x] 提交 `feat(desktop): expose observed connection failures and retries`。

## T4：保留结构化失败，统一本地化呈现

**文件：** 新增 `agent/desktop_failure.go`、`agent/desktop_failure_test.go`、`desktop/src/system/failures.ts`、`desktop/src/presentation/problems.ts`、`desktop/src/components/ProblemNotice.tsx`、`desktop/tests/problems.test.ts`；修改 `desktop/src/app/navigation.ts`（先扩展类型）、 `agent/desktop_device.go`、`agent/desktop_supply.go`、`desktopbridge/protocol.go`、`desktopbridge/server.go`、`desktop/src-tauri/src/protocol.rs`、`desktop/src-tauri/src/network_protocol.rs`、`desktop/src-tauri/src/runtime_protocol.rs`、`desktop/src/system/{bridge,device,supply,accounts,network,notifications,preferences,updater}.ts`、`desktop/src/i18n/{index,zh,en}.ts`、`docs/desktop/bridge-protocol.md`。同步这些协议对应的现有 Go／Rust／TS 测试。

**依赖／输出：** T3 错误分类；接口 C。新增 `ProblemNotice({problem:PresentedProblem,onNavigate})`，在原区域显示原因、影响、动作、可展开详情。结构化错误在系统层保存，页面渲染时翻译。

- [x] 建立反例：503设备核对失败在中文下显示具体事实、目标和原文；401/device_replaced 不降级为 NETWORK_DEVICE_SCOPE 或“结果未确认”；所选文件缺失不说全机无登录，权限失败不说未找到；未知码不猜原因；切换语言立即更新已有错误；敏感令牌／URL秘密参数不进入详情。
- [x] B：`go test ./agent ./desktopbridge -run 'DesktopFailure|DesktopDevice|Supply' -count=1`；B/desktop：`node --test tests/problems.test.ts tests/device.test.ts tests/supply.test.ts`，确认新增断言失败。
- [x] 在丢失原因的设备／供给请求边界保留 typed cause、HTTP实际状态及安全响应，桥上逐层透传 details；保留现有领域码和错误链。用 errors.As 回归既有 apiFailure 判断，不能因新包装破坏配对过期、设备撤销或结果未知分支。扩展解析器时拒绝未知详情键和不安全 evidence；无 details 的既有错误仍有效。
- [x] 同步 Rust struct literal、各 TS 解码器及错误归一化，去掉仅为UI而拼接后丢弃结构的处理。现有 AccountError 不迁移协议；按已有 code/check/evidence 接入相同呈现组件。
- [x] 为已知原因提供中英词条和真实动作映射；新增显式 locale 的时间／数字格式函数。检查参数遗漏和词条两端对齐，不用“包含拉丁字母”判定翻译失败。
- [x] 重跑上述命令及 B：`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`；B/desktop：`npm run typecheck`。提交 `feat(desktop): preserve failure evidence in localized feedback`。

## T4a：启动受阻时保留必要操作与同会话重查

**文件：** 修改 `desktop/src-tauri/src/{experience,commands,lib,sidecar,update_install,protocol,diagnostics_protocol}.rs`、`agent/{desktop_device,desktop_accounts,desktop_session,desktop_diagnostics}.go`、`desktopbridge/{protocol,server}.go`、`desktop/src/system/{bridge,device,accounts,diagnostics}.ts`、`desktop/src/app/NativeApp.tsx`；同步现有设备／账号／更新／诊断测试、诊断导出与 fixture，以及 `desktop/src-tauri/src/{sidecar,protocol}_tests.rs`；新增 `desktop/src-tauri/src/experience_tests.rs`、`desktop/tests/startup-recovery.test.ts`。

**依赖／输出：** T4；接口 E。先完成协议、操作边界和原生恢复能力，页面的完整状态接入由 T5／T6 收口。

- [x] 用已保存绑定、device_status.result.error=401/device_replaced、管理进程 Ready 和 runtime stopped 建立失败案例；断言本机上下文可读、四页仍可挂载，Hive 写入及运行启动仍拒绝。补充未绑定、损坏记录、桥不可用和待更新完整性失败，避免放宽硬性保护。
- [x] B：`go test ./agent ./desktopbridge -run 'DesktopDevice|DesktopAccounts|DeviceContext' -count=1`；`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`；B/desktop：`node --test tests/startup-recovery.test.ts tests/device.test.ts`，确认新增行为断言先失败。
- [x] 分离真实 bridge 状态与业务启动检查，先透传设备错误再使用可信身份；实现只读 device_context 和受校验的固定控制台打开入口。梳理命令门禁：允许本机读取、诊断、语言外观及符合原条件的官方登录；接入、换号、开始贡献、恢复接单和有身份范围的代理应用继续校验。
- [x] 实现 startup_recheck，同一上下文串行重查、更新结果；不调用自动运行恢复，不绕过 update_install／sidecar 完整性门禁。验证反复点击、旧请求迟到、网络配置变化、设备恢复后同会话解锁；确认仅启动时允许的恢复最多执行一次。
- [x] 为本机设备上下文和诊断增加同一 binding_revision，补齐严格协议及既有 fixture；验证采集中更换绑定后旧报告不能被重新标为新绑定结果。B：`go test ./agent ./desktopbridge -run 'DesktopDiagnostics|Diagnostic' -count=1`；B/desktop：`node --test tests/diagnostics.test.ts`。
- [x] 重跑以上定向测试和 B/desktop：`npm run typecheck`；提交 `fix(desktop): keep recovery available during startup checks`。

## T4b：设备恢复与所有配对路径的持久化保护

**文件：** 新增 `agent/desktop_device_recovery.go`、`agent/desktop_device_recovery_test.go`；修改 `agent/{desktop_device,desktop_session,desktop_accounts,desktop_account_persistence,desktop_runtime}.go`、`desktopbridge/{protocol,server}.go`、`desktop/src-tauri/src/{commands,lib,sidecar,protocol,experience}.rs`、`desktop/src/system/device.ts`、`docs/desktop/bridge-protocol.md`；测试 `desktopbridge/device_test.go`、`desktop/src-tauri/src/{sidecar,protocol}_tests.rs`、`desktop/tests/device.test.ts`。不修改 Hive 的配对／替换协议。

**依赖／输出：** T4a；接口 F 和 spec §4.1–4.2，矩阵 D01–D09。复用现有网页确认和轮询语义，恢复路径单独处理旧身份被撤销；首次配对修正相同的未知写入边界，不能把现有 Begin／Status 已能调用等同于无需检查。

- [x] 先覆盖允许的401领域码及明确拒绝条件：普通401、403、503、占用、配置损坏、贡献未停止、worker 未退出、旧账号／设备写入未决；在核心层验证，即使绕过按钮也不能执行恢复。
- [x] B：`go test ./agent ./desktopbridge -run 'DesktopDevice|DeviceRecovery|DesktopSession' -count=1`；B/desktop：`node --test tests/device.test.ts`，确认新增契约及行为断言失败；新测试统一使用 DeviceRecovery 名称便于选中。
- [x] 实现单个受保护恢复记录、严格协议和互斥，创建及兑换前先持久化；取消确认不请求 Hive，重复点击／重启继续原事务。采用新身份前验证固定 Hive、新凭据和用户归属确认，首次配对继续沿用既有网页归属确认规则。
- [x] 用本地 Hive 协议服务及崩溃点注入覆盖创建响应丢失、token 保存失败、兑换响应丢失、远端成功后原子保存失败、配置已落盘而事务未收尾、轮询过期和旧回调迟到；逐步断言请求次数，无自动重建、重复兑换或回退旧凭据。
- [x] 将上述保护复用到首次配对：增加“创建已发但无token，再次Begin”“已redeeming而轮询仍approved，再次Status／重启”请求计数反例；分别检查明确 device_draining 拒绝、当前未决与已确认过期。迁移旧记录时无法证明未提交则保留阻塞，首次有效创建／兑换仍各执行一次。
- [x] 覆盖不同 owner 确认、同 owner 新 device 隔离、旧账号未决操作阻塞、运行／代理意图不迁移；完成后真实本机状态仍 stopped，账号必须重新接入。记录损坏及写盘失败保留可诊断事实，不清空继续。
- [x] B：`go test -race ./agent ./desktopbridge -run 'DesktopDevice|DeviceRecovery|DesktopSession' -count=1`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`；B/desktop：`node --test tests/device.test.ts`、`npm run typecheck`。提交 `feat(desktop): recover revoked device credentials with confirmation`。

## T5：主状态派生、刷新事实和恢复导航

**文件：** 新增 `desktop/src/presentation/desktopStatus.ts`、`desktop/tests/desktopStatus.test.ts`；修改 `desktop/src/app/navigation.ts`、`desktop/src/system/desktopState.ts`、`desktop/src/app/NativeApp.tsx`、`desktop/src/features/accounts/useAccounts.ts`、`desktop/tests/desktopState.test.ts`、`desktop/tests/polling-stability.spec.ts`；新增 `desktop/tests/recovery-navigation.spec.ts`，加入 `desktop/playwright.device.config.ts` 且从 `desktop/playwright.config.ts` 默认演示套件排除。

**依赖／输出：** T2–T4b；接口 C–F。沿用 T4 的 NavigationTarget 类型，本任务补全目标校验与导航行为。

**实施范围补充（2026-11-02）：** 为落地已批准的真实分平台读取，补齐 `desktop/src/system/supply.ts` 的同平台队列与直接消费者；原生传输核对发现 `desktop/src-tauri/src/sidecar.rs` 和 `desktopbridge/server.go` 均逐条等待回复，TS 并发不能证明原生独立读取。T5 须补固定平台读取方法的有界并发与对应测试，保持非并发操作屏障、每请求期限、严格ID／instance、单响应writer、退出取消及join/reap。不得全命令并发、增加管理进程或放宽写入保护；具体必要文件与最终验证记录在任务报告，T5整体审查通过前不推进T6。导航最小消费者包括既有AppShell／DetailSheet／概览／账号详情与列表／设置／诊断及useRuntime、useSupply；T6–T8仍负责完整呈现，主要按钮位置不变。

- [x] 表驱动测试覆盖 spec §3 顺序，包括共享失败压住旧成功、单平台失败不压住另一平台可接单、全部暂停仍保留其他阻塞、已有账号停止、准备提示收起、无数据计数待确认；补充当前401＋stopped＋source_missing组合，账号未知不能覆盖同一绑定下明确的设备拒绝。
- [x] B/desktop：`node --test tests/desktopStatus.test.ts tests/desktopState.test.ts`，确认新增断言失败；修改协调器只记录实际调度，失败保留旧信息和不可信标记，明确 blocked 时不再声称自动核对。
- [x] 针对矩阵 S01/A01/P01/P03，先复现 account-reading 与 check-sequence：阶段性发布共享事实，隔离两平台慢请求；过期立即禁止旧报告写入，但只显示实际读取／等待调度。保留每请求期限、唯一协调器与revision屏障；断言不重复查询、不以旧成功解锁写操作。
- [x] NativeApp 使用独立 bridge／startup 状态，不再用单一 ready 隐藏概览和账号页；建立受校验目标与单次返回上下文，保留来源／设置草稿，已提交操作继续由原模型核对。实现目标存在后聚焦和返回发起入口，普通轮询不重复聚焦。
- [x] 接入带上下文的诊断事实，401更新当前问题摘要但HTTP成功不改为已连接／ready；较旧结果、旧绑定／网络版本结果拒收。设备恢复后回读新状态并显示剩余账号问题，不直接变成可接单。
- [x] 浏览器场景断言“账号来源错误 → 设置目标 → 返回”保留平台和草稿；“接入结果未知 → 离开／返回”PUT 次数不增加；实例变化清除旧操作；导航到诊断不启动诊断。
- [x] 增加设置草稿“设置 → 概览／诊断／账号 → 设置”往返，保留未保存输入且保存／应用次数为0；绑定变化隔离旧草稿。只覆盖设置内部页签切换不足以通过 C01。
- [x] B/desktop：`node --test tests/desktopStatus.test.ts tests/desktopState.test.ts`；`npx playwright test --config playwright.device.config.ts recovery-navigation.spec.ts polling-stability.spec.ts`；`npm run typecheck`。预期目标正确、无重复写入、无焦点抢占。
- [x] 提交 `feat(desktop): unify readiness state and recovery navigation`。

## T6：概览与设备绑定流程

**文件：** 修改 `desktop/src/components/AppShell.tsx`、`desktop/src/features/overview/NativeOverviewPage.tsx`、`desktop/src/features/lifecycle/NativeRuntimeControls.tsx`、`desktop/src/features/device/DevicePairingPage.tsx`、`desktop/src/app/NativeApp.tsx`、`desktop/src/styles/{app,tokens}.css`、`desktop/src/i18n/{zh,en}.ts`；测试 `desktop/tests/device.spec.ts`、`desktop/tests/native-runtime.spec.ts`；预览 `desktop/tests/fixtures/bee-preview/{scenarios,fixture,app}.mjs`。

**依赖／输出：** T4b 恢复接口、T5 DesktopPresentation 和 NavigationTarget；在原批准布局上落实方案 1“清晰分区”的状态与提示，概览与侧栏同一状态来源，停止贡献入口沿用真实可用性及右侧位置。静态 interaction-prototype.html 仅作视觉参考，其偏离原布局的按钮位置须纠正，不复制固定503／重连状态到产品。

**实施所需的恢复观察接线：** 当前协调器尚未查询凭据恢复事务，且无事务与读取失败共用通用错误。T6可在现有 `desktopState.ts`／直接测试中接入 `recoveryStatus`，由唯一协调器维持恢复查询；并定点修改 `agent/desktop_device_recovery.go`／直接测试，以稳定 `DEVICE_RECOVERY_NONE` 区分成功查询后的无凭据恢复事务，保留损坏、锁冲突和绑定不符的真实失败。确认提交不能吞成无事务成功；不增加命令、DTO体系或独立poller。恢复查询本身完成新绑定保存时，同轮核对最新绑定上下文并隔离旧作用域，不能等待下一次定期刷新才失效旧操作；恢复后仍不自动接入、开始或解除暂停。`recoveryError` 必须同步接入现有 `desktopStatus.ts`／直接测试与共享动作门禁，不能在恢复查询失败、身份读取独立成功时仍显示可接单或通过账号刷新唤醒旧写入；保留可信本机停止、登录与取消能力。

**独立审查接线补充：** 常规无事务查询还须最小修正 `desktop/src-tauri/src/experience.rs`／直接测试：仅 status-only 的稳定 `DEVICE_RECOVERY_NONE` 不修改原启动门禁、修订和网络范围，其他真实失败及更新／完整性保护保持。完成的历史恢复记录不占用下一次用户确认恢复入口，历史完成提示不得覆盖之后的账号／运行事实。

- [x] 扩充正式组件场景：初次读取、确认未绑定、网页等待、过期、设备核对失败、停止、首次连接、断线退避、身份拒绝、占用、双平台部分可用。先验证旧“贡献已启动”和布尔“Hive 未连接”会导致断言失败。
- [x] 概览接入共享主状态及轻量四步说明，只在缺少绑定／账号时展示；绑定完成后去实际下一步，正常暂停与断线不重放引导。
- [x] 配对主按钮高对比，次操作复制码／网址各有成功与失败反馈；剩余时间由 expires_at 计算，到期切换动作；打开网页失败保留请求与手动网址，不重新生成配对码。
- [x] 按 D03–D07 分别呈现 pending、draining、正在兑换、身份待回读、保存失败和未知结果；到期先核对，再按核心确认结果决定重新生成可用性。首次绑定也使用真实恢复结果，不仅给新重绑流程增加这些提示。
- [x] 设备核对失败保留已知设备与表单草稿，禁止回退成未绑定；设备表单／错误卡与运行区留24px空白。连接详情展示实际失败、重试状态和已有检查入口，不提供不存在的一键重启或绑定地址编辑。
- [x] 设备失效时展示匹配的重新绑定确认、网页等待、重查、保存失败及结果未知；取消弹窗不请求，导航／重启不重复提交。跨 owner 采用新绑定需明确确认；完成后指向账号准备，贡献仍停止。控制台与重新检查设备入口在可恢复启动错误下可用，禁用操作给出具体前置条件。
- [x] B/desktop：`npx playwright test --config playwright.device.config.ts device.spec.ts native-runtime.spec.ts`；`npm run typecheck`。人工检查长网址、最小窗口、主按钮、复制反馈及中英布局；截图留待 T10 汇总。
- [x] 提交 `feat(desktop): guide device setup and connection recovery`。

## T7：AI 账号、平台接单和额度

**文件：** 修改 `desktop/src/features/accounts/{NativeAccountsPage,NativeAccountList,NativeAccountActions,NativeAccountDetails,AccountDisplay}.tsx`、`desktop/src/features/accounts/{accountPresentation,useAccounts}.ts`、`desktop/src/features/supply/SupplyPanel.tsx`、`desktop/src/i18n/{zh,en}.ts`；测试 `desktop/tests/{accountPresentation,nativeAccounts,supply}.test.ts`、`desktop/tests/{native-accounts,account-auto-read,supply,polling-stability}.spec.ts`。

**依赖／输出：** T2细分供给事实、T4失败呈现、T5导航；保持账号动作与运行控制分工。

**实施所需的最小错误生产者补齐：** 当前官方登录的版本不支持、帮助能力缺失、namespace不符、超时和启动失败仍被压成 `authorization_unconfirmed`。T7 可定点修改 `agent/desktop_authorize.go` 及对应测试，沿用 `AccountError` 输出实际稳定原因与安全证据，保留原始错误链；不改变登录、超时、取消及迟到核验规则。先核源并建立行为 RED，再运行覆盖该路径的 Go 定向测试，不从英文 message 猜原因。

- [x] 为来源读取中、未找到、所选文件缺失、缺客户端、权限不足、过期、候选改变、已找到未接入、接入／换号完成和结果未知建立场景；已知一个平台、另一个未知时计数不得显示确定总数。身份受阻时可读本机候选、调整来源草稿及按前置条件官方登录，接入按钮仍说明需先恢复设备。
- [x] B/desktop：`node --test tests/accountPresentation.test.ts tests/nativeAccounts.test.ts tests/supply.test.ts`，先确认新增断言失败，再替换固定的“接入和换号仍需确认”为按阶段出现的说明与动作。
- [x] 接入、换号、官方登录的确认分别说明目标账号、暂停影响及官方客户端登录变化；保留当前／目标标识。无邮箱只显示账号标识；未接入不展示无意义套餐标签，已接入但套餐未知说待确认。
- [x] 遍历 A01–A08、L01–L06、W01–W06 的主要按钮，按实际 features.reason／本地前置条件展示禁用说明和定位动作；候选过期、运行中登录、未决操作、提交时revision变化均不能无解释。官方登录测试覆盖缺客户端／版本不支持、退出成功但来源不符、超时／取消未知／迟到成功；取消接入仅限未注册选择。
- [x] 本地未选择显示“尚未接入 {平台} 账号”；本地已选择但 Hive 未注册显示注册未完成及实际同步事实；只有 market_not_open 才显示“Hive 尚未开放 {平台} 模型交易”。旧 not_configured 明说 Hive 未提供更具体原因；管理员问题不提供反复登录／恢复的假修复入口。
- [x] 额度未知／过期／耗尽分别展示，旧值标时间；保留全部窗口、重置时刻及超过100%的真实数值。问题去重不丢独立阻塞，暂停／恢复按钮及账号动作保持原右侧额度区下方靠右与原动作顺序；窄窗口与额度同组，不照搬方案1预览中的左对齐位置。
- [x] 按 P04–P08 遍历所有旧原因、五个新增原因及两平台专属原因，逐项断言具体影响和实际处理对象；管理员／等待型问题不提供无效登录或恢复按钮。旧Hive、多个原因、暂停叠加其他阻塞分别验收。
- [x] 来源详情保持默认展开；修改来源／完成授权后恢复自动读取，读取失败原位给准确入口，不新增日常“检测账号”按钮。身份受阻时用本机读取路径，不启动旧写操作；新设备重新读取后要求重新确认接入。离开再返回不丢失核对，不自动接入或恢复接单。
- [x] 重跑单元测试；B/desktop：`npx playwright test --config playwright.device.config.ts native-accounts.spec.ts account-auto-read.spec.ts supply.spec.ts polling-stability.spec.ts`。提交 `feat(desktop): clarify account setup and platform availability`。

## T8：设置与诊断的具体反馈、定位和返回

**文件：** 修改 `desktop/src/features/settings/NativeSettingsPage.tsx`、`desktop/src/features/diagnostics/{NativeDiagnosticsPage.tsx,presentation.ts}`、`desktop/src/features/diagnostics/native-diagnostics.css`、`desktop/src/system/{network,diagnostics,preferences,notifications}.ts`、`desktop/src/app/NativeApp.tsx`、`desktop/src/styles/section-tabs.css`、`desktop/src/i18n/{zh,en}.ts`；测试 `desktop/tests/{network,diagnostics,diagnostic-presentation,preferences,notifications}.test.ts`、`desktop/tests/{native-experience,recovery-navigation}.spec.ts`。

**依赖／输出：** T4/C、T4a/E 与 T5/D；设置仍四页签、默认网络，诊断仍用户主动运行。

**实施所需的最小失败阶段补齐：** 主控已核 `desktop/src-tauri/src/network.rs::apply_saved_with_restore` 的 observe／stop／configure／配置回读／restore 失败原样返回同一 BridgeError，仅凭 NetworkSnapshot 的 revision 不能证明失败阶段。T8 可在该文件及直接既有 Rust 测试中，为实际失败分支里缺少 details 的原错误补固定 `details.check` 与真实观测时间（network_observe／network_stop／network_configure／network_configure_readback／network_restore）；原 code／message 和已有 details／安全证据保留。不改变停止、配置、Restore 或门禁行为，不新增 DTO 或放宽解码。

**真实诊断数据接线补充：** 主控核实 Hive 身份失败的既有报告可能使用 `next_action=diagnostics`；`invalid_device_credential` 以 `code=http_rejected` 加安全 `server_code` 传递。T8须在具体已证原因之后才使用通用目标提示，并定点修改 `desktop/src/system/desktopState.ts`／`desktop/tests/desktopState.test.ts`，使同上下文、新观测的 Hive/null平台/GET `/api/bee/identity`、HTTP401及明确凭据失效领域码可供现有恢复资格判断使用；原code、时间和安全证据保留。其他状态、路径、平台、缺失证据或pass不得升级为凭据撤销；不改桥DTO、Go或启动门禁。正式诊断返回概览与返回原检查的功能回归须覆盖真实生产者形状，导航不发送恢复写入。

- [x] 建立保存成功但未应用、应用失败、测试上游成功但 Hive 不可达、通知偏好开启但 OS 拒绝、自启期望与登记不一致、诊断部分未完成、日志导出结果未知场景，断言不能统一显示成功。
- [x] 条件式解释本机代理，显示实际测试目标和当前／待生效配置；失败保留输入。网络应用涉及停止时沿用原确认，不能只改文字就绕过运行前置条件。
- [x] 通知期望与系统授权并列；拒绝时给实际系统设置路径，应用内问题仍保留。自启说明既有恢复意图和手动暂停边界。
- [x] 诊断“安全证据”改为“检查详情”，“核对诊断”改为“运行详情”；保留全部检查、未知、过滤和导出。处理入口准确定位概览绑定区／账号平台／设置页签，错误恢复后可返回；不因进入或返回诊断页自动执行检查。
- [x] 复现 G02 的单次 diagnostics_snapshot 失败；保留原报告ID和读取失败状态，提供重新读取原报告并按真实策略恢复查询，断言 diagnostics_start 仍为1、无需离页重进。继续覆盖开始／取消回执未知、报告已终态或上下文变化；无报告ID不伪造可查询动作，明确仍未知及可用日志／管理进程恢复路径。
- [x] 按 N03–N06 核对保存、停止、应用、恢复、权限与系统登记各自回执；网络应用部分失败／响应丢失后只读当前状态，不自动重复停止重启。草稿和错误在修复返回后保留。
- [x] 将本机记录完整与远端身份有效分别命名；device_replaced 和 source_missing 在主提示中给出最具体原因和入口。设置在远端身份未知时显示上次绑定／待核对，不误标“尚未配对”；诊断返回概览后使用同上下文的新事实，焦点落实际目标而非 BODY。
- [x] B/desktop：`node --test tests/network.test.ts tests/diagnostics.test.ts tests/diagnostic-presentation.test.ts tests/preferences.test.ts tests/notifications.test.ts`；`npx playwright test --config playwright.device.config.ts native-experience.spec.ts recovery-navigation.spec.ts`，确认实际保存／权限／导出回执驱动反馈。
- [x] 提交 `feat(desktop): make settings and diagnostics recovery actionable`。

## T9：更新、原生菜单、通知与语言收口

**文件：** 修改 `desktop/src/features/settings/NativeUpdateControls.tsx`、`desktop/src/system/{updater,lifecycle,notifications}.ts`、`desktop/src-tauri/src/{lib,lifecycle,notifications,notification_poll,updater,update_install}.rs`、`desktop/src/i18n/{index,zh,en}.ts`；测试 `desktop/tests/{updater,lifecycle,notifications}.test.ts`、`desktop/tests/native-updater.spec.ts`、`desktop/src-tauri/src/{lifecycle,notifications,updater,update_install}_tests.rs`。

**依赖／输出：** T4已知错误与原文详情、T5返回上下文；不扩展系统操作能力或通知授权范围。

- [x] 覆盖更新检查、下载、签名验证、启动安装、重启后核验各阶段失败；失败和结果未知分别提示，只有真实确认回执显示完成。
- [x] 回归 T4a 后更新 hold／verify 及 sidecar 完整性边界：身份检查受阻可处理不代表未验证二进制可运行；设备重查和恢复完成均不得再次执行启动恢复或自动开始贡献。
- [x] 清楚区分暂停接单、开始／停止贡献、关闭窗口、退出 Bee、退出并安装；关闭确认窗不撤销已提交动作，停止／退出的任务中断影响保留。无可用原生入口时给真实菜单指引，不伪造按钮。
- [ ] 按 U01–U05/X01–X04 分别验证正常退出重开、明确停止后重开、不洁会话、停止保存失败、第二次启动、通知／登录返回、安装失败及升级后迁移；每条恢复判断对应真实意图和回执，不以同一“恢复正常”提示替代。
- [ ] 逐路径检查正式 App 的按钮、禁用原因、空态、进度、确认窗、托盘、菜单、系统通知、日期及数字；已有状态随语言切换。更新发布说明标识来源，不将上游英文伪称为中文版本。
- [x] B/desktop：`node --test tests/updater.test.ts tests/lifecycle.test.ts tests/notifications.test.ts`；`npx playwright test --config playwright.device.config.ts native-updater.spec.ts native-experience.spec.ts`；B：`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`。对已知错误与必要技术原文分别断言。
- [x] 提交 `fix(desktop): localize native actions and update outcomes`。


### 原生有效语言的最小接线（主控核源）

主控核实现有 `commands.rs::preferences_save` 只执行 `store.save`；`lib.rs` 在读取偏好前安装固定中文菜单，通知 poll 可早于 WebView 获取 System 的实际 `navigator.language`。T9 可在既有 `NativeApp.tsx`／`i18n/index.ts`／`system/bridge.ts` 及原生 `commands.rs`／`preferences.rs`／`lifecycle.rs`／`lib.rs` 做必要接线：复用已保存偏好 revision 和 App 有效 zh/en，仅传语言元数据，不增加依赖、翻译服务、偏好 schema 或持久化文件。

可信读取／保存的偏好 revision 才能同步；拒收旧 revision 及与显式语言不符的请求。System 同 revision 的多次语言变化不能由迟到旧请求覆盖。首次实际有效语言未知时不提交通知，也不写 attempted 或消耗 retry；已有 ledger／权限／通知 identity／重试规则保持。同步失败保留具体错误和实际可恢复路径，不能静默永久停发。只对新提交通知取当时有效语言，切语言不重发历史通知；菜单同步不触发 Restore、Start 或授权。先行为 RED 后最小实现，报告写明初始与保存后菜单／System 同步顺序和验证范围。


**T9 执行记录（2026-11-03）：** 实施与独立审查／有限复审已通过（ce2b542＋3b0b747，C/I/M=0/0/2）。上述已勾项限核心／协议及正式组件任务验证；两项未勾原生逐路径验收转 T10 按资源缺口登记。原完整 Rust230＋2ignored与修后notification27为各自真实范围，当前最终完整Cargo仍须在T10按新HEAD重建sidecar后运行。真实Linux通知、U/X、签名升级等不因任务实现通过而勾完成。

## T10：完整流程、协议组合与桌面验收

**文件：** 修改 `desktop/tests/fixtures/bee-preview/scenarios.mjs`、`desktop/tests/preview-scenarios.spec.ts`、`desktop/tests/recovery-navigation.spec.ts`、`docs/desktop/{bridge-protocol,supply-control,account-runtime-validation}.md`；新增 `desktop/tests/device-recovery.spec.ts`（登记到 device 套件并从默认演示套件排除）、`docs/desktop/interaction-clarity-validation.md`；截图和日志放 `docs/desktop/evidence/2026-10-30-interaction-clarity/`，记录实际执行时间；H 更新 `docs/bee-supply.md` 及最终 `bee` gitlink。

**依赖／输出：** T1–T9；交付证据对应最终两个仓库提交，区分模拟浏览器、真实核心／Hive和原生壳结果。

- [x] 将76项矩阵作为验收台账，逐行登记最终提交、测试环境、断言／截图／原生回执、状态和未通过原因。当前测试基线为 TS 105通过、正式浏览器126通过、预览43通过2失败；两失败单独重跑仍失败。修复失败的行为或场景时序契约后再验，不能删断言或只对当前401截图验收。

- [ ] 更新预览为正式组件和实际 DTO；场景覆盖 spec §9 每行及用户最初列举的问题，不用静态截图冒充真实行为。增加当前已保存绑定＋401/device_replaced＋stopped＋所选OpenAI文件缺失组合，同一场景的概览／账号／诊断／设置事实一致；删除原型固定503、固定重连等与场景无关的结论。补全860×600／1000×700／常规尺寸、中英／明暗和长错误；交互用代表性路径，避免无意义笛卡尔积测试。
- [x] B：`go vet ./...`、`go test -race -timeout=600s ./...`；B/desktop：`node --test tests/*.test.ts`、`npm run build`、`npx playwright test --config playwright.device.config.ts`、`npx playwright test --config playwright.preview.config.ts`；B：`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib`。保留输出，不因此前任务已绿而跳过最终受影响集成验证。
- [x] H 在最终 Bee gitlink 下运行 T2 的数据库集成命令，并增加实际 HTTP 三组合：新 Bee／新 Hive、旧请求／新 Hive、新 Bee／旧响应处理器。校验选择详细原因不会改变准入，旧请求仍可被旧严格解码器解析；后者使用固定旧 schema 回归 fixture，禁止为了兼容放宽现行校验。
- [ ] 用本地测试 Hive 和独立测试状态目录运行真实核心，复现连接拒绝、503、401／403、409、断线退避／恢复与暂停保留；校验可见原因来自该次失败，真实事件覆盖旧 run 迟到。合成账号测试不发送真实模型请求。
- [ ] 在本地 Hive 和隔离桌面状态中完成真实设备恢复：撤销测试凭据 → 四页可达且原因明确 → 本机确认 → Hive 网页确认／替换确认 → 身份回读有效且贡献仍停止。覆盖重复点击、重启续查、创建／兑换未知和本地保存失败，核对实际请求次数；不把 UI 模拟成功当作恢复回执。
- [ ] 使用明确用于验收的真实官方账号，继续修复所选登录来源 → 确认接入且暂停 → 开始贡献仍暂停 → 用户恢复平台接单 → Hive 实际报告 ready。沿用既有 `docs/desktop/account-runtime-validation.md` 的受控请求验收，在专用环境及明确请求范围内分别验证两平台实际请求经本 Bee 到达官方上游并返回，再验证暂停阻止新派发、停止后不可继续接单；记录脱敏关联证据，不仅截取 ready。核对全链路无旧账号迁移、自动接入或自动解除暂停；测试 Hive 需具备对应平台市场／准入条件。缺账号或平台条件则明确记录未完成的环节，不用合成候选冒充全链路通过；不得隐式重绑用户当前设备、替换其他 Bee 或恢复真实接单。
- [ ] 当前故障之外，分别真实走通首次配对到接单、网络中断恢复、官方登录／取消、换号未知结果核对、代理应用部分失败后继续、诊断读取失败恢复、正常／异常退出重开和更新失败／重启核验。两平台及目标OS差异单独记录；未验证项留待验，不能用39个预览代表全部路径通过。
- [ ] 使用 `ego-browser` 检查正式页面、恢复入口、键盘焦点、Escape、对比度、溢出、滚动与无闪烁，按 `web-design-guidelines` 复核。关键截图包括等待网页确认、设备核对失败间距、断线原因、凭据撤销及确认重绑、启动受阻的账号页面、所选文件缺失、恢复后剩余问题和双平台部分可用；导航到诊断及返回后焦点落到目标。
- [ ] 同尺寸、同主题、同状态对照原批准方案与正式组件，逐项核对页面分区、设备信息顺序、贡献按钮、账号动作及详情入口的位置；暂停／恢复保持右侧且与额度同组。对必要移动记录实际可用性原因，不以预览已改变位置作为理由。
- [ ] 使用工程现有打包／原生验收入口验证 macOS 壳的菜单、托盘、通知拒绝、关闭窗口与退出、更新确认及实际失败反馈；真实平台操作写明环境和回执。Linux／Windows 若本机无法运行，使用既有对应 CI／原生验收证据；未执行的路径标明阻塞，不将模拟或编译结果写成原生通过。
- [x] 文档写入协议参数、细分原因、操作边界、验证命令和结果，保留日志脱敏。T2 后若 Bee 还有契约改动，Hive 子模块指向包含全部契约的最终提交后重跑受影响联调；不覆盖 H 原工作树的已有 gitlink 变化。
- [x] 执行 `verification-before-completion`，再做全分支 `affected-path-review`（由 global-conventions 明确要求）、`consistency-check`；发现问题修复后只重跑受影响验证。按执行技能完成检查项核对与 `finishing-a-development-branch`，记录未完成原生路径，不将有阻塞的整体验收勾为完成。
- [x] 证据与文档提交 `test(desktop): verify interaction clarity and recovery paths`；未经授权不推送、发布、部署或合并。

**2026-11-03当前核对：** 产品最终修复 `843e3ff`、证据 `8153658`，Hive `87e3233`／gitlink `ab8140a`；完整全分支审查的两项Important经统一修复和原审查者有限复审关闭，当前未关闭C/I/M=0/0/0。实现与代码审查通过不等于整体验收。92项复选框中原勾76，本次按证据新勾6，合计82；余10项逐条原因见[实施与验收交接](../reports/2026-11-03-desktop-interaction-clarity-delivery.md)。76复合场景继续按所验子路径登记，不整行勾通过；真实资源缺口和本轮未执行的补充项分别保留。未经授权不推送、发布、部署或合并，保留现有分支/worktree。

## 送审自检与覆盖索引

| 设计范围（含本轮待审修订） | 实施／验证落点 |
| --- | --- |
| spec §1–2 保留导航和业务边界 | 全局约束、T5–T10 |
| §3 状态优先级、未知、单平台隔离 | T3、T5、T6、T7 |
| §3.3 启动受阻时本地能力与硬性保护 | 接口 E、T4a、T5、T7、T9、T10 |
| §3.4 分阶段读取、慢平台隔离与动作禁用原因 | 接口 D、T5、T7；矩阵 S/A/P/C |
| §4 轻量准备提示与设备流程 | T5、T6 |
| §4.1 人工重绑、持久化、身份与运行隔离 | 接口 F、T4b、T6、T10 |
| §4.2 首次配对同等未知结果保护 | 接口 F、T4b、T6；矩阵 D01–D09 |
| §5 账号、计数、来源与额度 | T7 |
| §6 原因、恢复、兼容、真实重试与诊断共享 | 接口 A–F、T1–T5、T8、T10 |
| §7 设置、诊断、导航、更新、系统操作 | T5、T8、T9 |
| §8 语言、布局、可访问性 | T4、T6–T10 |
| §9 全链路验收 | T10；任务内先覆盖具体反例 |
| 全场景而非当前故障的充分性 | 76项矩阵逐行登记；T1–T10各自承担落点 |

11 月 1 日送审时尚未执行产品任务；当时走查测试结果不能算作修改后验收。11 月 2 日用户批准后开始实施，当前实际完成项以任务复选框和验证台账为准。文档送审核对设计覆盖、接口一致、文件／命令入口和已有改动保护，不把未来验收写成已通过。现有 Hive 无法查回创建响应丢失后的配对 token，这一分支必须如实保留结果未知及人工处理指引，不能因其余恢复路径通过就标记该分支可自动恢复。
