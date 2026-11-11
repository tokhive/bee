# 正式 UI mock 接口完整性审计

> 历史记录：2026-11-11 从 P0 工作区归档，正文保持当时结论，不代表当前 UI 状态。后续 mock 实现已随 `50e8a6b`、`48dce01` 进入 UI 分支。

审计日期：2026-11-04。目标工作树：`.worktrees/bee-desktop-p0`，分支：`feat/bee-desktop-p0`，源码基线：`eef0b6ce9b30e58fb0610827a93b69d6a8565380`。工作区另有并行修改；本审计只新增此报告，未修改产品代码或其他已有文件。

## 结论

概览、AI 账号、诊断和设置四页已有正式类型化接口及 Rust／Go 实现接线，可以直接复用现有 mock IPC 开发 UI。当前并非缺少一套页面后端接口；不必为 UI 再建独立业务 API 或假页面。

但 mock 的动态交互尚不完整：设置保存后回读、检测／登录完成、网络应用后诊断，以及部分连接与修订约束仍有可复现缺口。现有 76 个预览选项不能视为 76 条完整交互链。本轮类型检查、259 项 TS 单测通过；正式预览初次 57／61 通过，核查期间出现并行修正，重新执行后 **61／61 通过**。自动重试缺口已修正，其余 F2—F7 仍由当前 fixture 的内存复现确认。正式接口已接线与真实原生全流程验收通过是两个不同结论，本轮未执行后者。

## 范围与判断依据

- 正式预览入口是 `desktop/tests/fixtures/bee-preview/index.html` → `viewer.mjs` → `app.html` → `app.mjs:12-14`。先安装模拟 IPC，再加载正式 `src/main.tsx`；不是复制业务页面的独立演示 App。
- `fixture.mjs:38,58,80,166` 将共用 `native-accounts.mjs` 包装为场景 IPC。判断以当前 `desktop/src/system/` 的实际 Client 命令、解码器及状态协调器为准，结合 `desktop/README.md:3` 起的开发约定和 `docs/desktop/architecture.md:30` 起的同契约要求。
- 已核对 `docs/superpowers/plans/2026-11-03-ui-development-workflow.md`，以及概览／账号 UI、账号运行、设备连接分离、请求重试的当前规格。尤其设备连接规格明确替代“停止贡献即断线”的旧行为。
- mock 契约复现使用 Node 24.22.1 内存对象、fixture 和真实 TS Client／协调器；另执行现有 Chromium 正式预览测试。不启动 Bee／Hive、不读真实凭据、不修改真实账号／设备／系统状态。真实登录、OS 权限、生产更新本来就不由 mock 证明，这些固有边界不算接口缺陷。
- 文件标注采用仓库相对路径和一基行号。确定性“已复现”表示实际调用得到所列结果；“源码确认”表示由分发／条件分支直接证明；未在本审计执行的浏览器效果不声称已验证。

## 正式接口与实现位置

正式调用链为 `desktop/src/main.tsx:44-45` → `NativeApp` → `desktop/src/system/` Client／DTO 解码器 → Tauri invoke。原生命令集中注册于 `desktop/src-tauri/src/lib.rs:61-110`；业务命令经 `commands.rs`、`sidecar.rs` 到 `desktopbridge/server.go`。`cmd/bee/main.go:76-87` 实际构造设备、账号、运行、授权、诊断和网络服务，再交给 `RunWithExperience`，并非只声明接口。

| 能力 | 前端接口与方法 | 原生／业务实现入口 |
| --- | --- | --- |
| 设备绑定与恢复 | `desktop/src/system/device.ts:18,83`：status、begin、open、context、recoveryPrepare／Confirm／Status／Open | `commands.rs:103,110,255,763,781`；`agent/desktop_device.go:55,328` 及 `desktop_device_recovery.go` |
| 账号来源、检测与接入／换号 | `desktop/src/system/accounts.ts:19,79`：defaults、snapshot、detect、action；invalidate 为本地失效操作 | `commands.rs:72-99`；`desktopbridge/server.go:297-325`；`agent/desktop_accounts.go:243,279,345` 及 selection／switch 模块 |
| 官方登录授权 | `desktop/src/system/authorize.ts:7,23`：start、status、cancel | `commands.rs:442-460`；`agent/desktop_authorize.go:64,132,144` |
| 贡献运行 | `desktop/src/system/runtime.ts:21,96`：snapshot、start、stop | `commands.rs:410-439`；`agent/desktop_runtime.go:75,109,339` |
| 平台接单与暂停 | `desktop/src/system/supply.ts:6,68`：status、setPaused | `commands.rs:119-136`；`desktopbridge/server.go:344-359`；`agent/desktop_supply.go:30,34` |
| 诊断、日志与报告 | `desktop/src/system/diagnostics.ts:98-99`：start、snapshot、cancel、logs、export、download 及上下文／会话订阅 | `commands.rs:508-562`；`diagnostics_native.rs`；`agent/desktop_diagnostics.go:81,143,162`。download 是前端协调 export 与交付回执，并非遗漏的第六条原生命令 |
| 网络与代理 | `desktop/src/system/network.ts:13,59`：snapshot、test、saveProxy、applySaved | `commands.rs:617-709`、`network.rs`、`experience.rs`；只读连通检测在 `agent/desktop_network.go:94` |
| 偏好设置 | `desktop/src/system/preferences.ts:8,51`：read、save | `commands.rs` 的 preferences_read／save；`preferences.rs` 私有文件保存 |
| 通知与自启 | `desktop/src/system/notifications.ts:17`：permission、enable、deliveryStatus、retry、autostartStatus、autostartSet | `commands.rs:464` 起的 autostart 命令及 `:565` 起的 notification 命令；`notifications.rs`、`autostart.rs` |
| 应用更新 | `desktop/src/system/updater.ts:20,87`：snapshot、check、download、install 及本地会话订阅 | `updater.rs`、`update_install.rs`；通过原生 updater 插件执行 |
| 桥状态与原生生命周期 | `desktop/src/system/bridge.ts:42,57`；`lifecycle.ts:6`；`main.tsx:45` 的 openHive | `commands.rs` 的 bridge／startup／hive 命令；`lifecycle.rs` 的 login_return_received／native_locale_sync |

计数口径：上述业务与设置命令 40 条，桥／启动／本地语言元数据 6 条，登录回执与 Hive 打开各 1 条，共 48 条。事件订阅和 Client 的本地协调方法不另计为原生命令。

两个容易误判的边界：

- `desktop/src/client/client.ts:4-9` 的 `BUSINESS_ADAPTER_UNAVAILABLE` 属历史 `BeeClient` 路径；当前原生与正式 mock 入口在 `main.tsx:44-45` 进入 `NativeApp`，使用上表 Client。不能据此断言正式四页没有业务接口。
- 当前构建明确不提供账号完整移除和账号快照里的 `system_notifications` 能力标志，见 `accounts.ts:72`；后者与设置页独立的系统通知接口有别。收益／资金也不属于当前桌面产品范围。它们不应被包装成待补 mock 的已承诺功能。

## 本轮实际验证

使用 Node 24.22.1，在 `desktop/` 执行以下现有检查；没有新增测试文件，也没有改动 fixture 来让检查通过。

| 检查 | 命令与结果 | 能证明的范围 |
| --- | --- | --- |
| TypeScript | `npm run typecheck`：通过 | 当前 TS 类型检查 |
| 全部 TS 单测 | `node --test --test-reporter=spec tests/*.test.ts`：259／259 通过，无跳过 | Client 解码、共享协调、错误证据、上下文与修订等现有测试；包含下行契约的 2 项，不重复加总 |
| 跨语言命令参数契约 | `node --test tests/native-command-contract.test.ts`：2／2 通过，输出 `Validated 48 registered commands against Rust signatures, including nested Serde input fields.` | 48 条命令的前端实发参数与 Rust 注册／Serde 字段一致；transport 立即抛 stopped，未执行原生或 mock 响应 |
| 正式预览，初次 | `BEE_E2E_PORT=28473 npm exec -- playwright test --config playwright.preview.config.ts --reporter=line`：57／61 通过，4 失败，退出码 1，59.2 秒 | Chromium 正式页面＋模拟 IPC；发现下表失败 |
| 正式预览，并行修正后复验 | `BEE_E2E_PORT=28791 npm exec -- playwright test --config playwright.preview.config.ts --output ../.cache/bee-preview/interface-audit-current --reporter=dot`：**61／61 通过**，退出码 0，46.6 秒；再次 typecheck 通过 | 当前 supplyReadError 提供结构化 503 证据；恢复测试分别断言状态标签和时间，完整序列已通过 |

初次正式预览失败明细（以下四项在复验中均已通过）：

| 失败项 | 本次观察与定位 |
| --- | --- |
| `supply-partial` | 期望“等待自动重试”，实际“核对已暂停，需先处理当前问题”；与 F1 的 Claude blocked 复现一致 |
| `check-waiting` | 等待自动重试场景实际 blocked；见 F1 |
| `check-retrying` | 重试中场景实际 blocked，无法进入预期后续读取；见 F1 |
| `automatic recovery traverses stale, failed, retrying and recovered states using read requests only` | 在 `preview-scenarios.spec.ts:76` 先失败：精确匹配“等待自动重试…”的断言遇到附带时间的文案，实际如“等待自动重试… 2026年11月4日 15:11:43”；后续完整恢复断言尚未执行。该序列第 2 次读取另有 F1 错误证据缺口，不能只改文案断言后便认定恢复已完成 |

初次失败 trace／上下文位于 `.cache/bee-preview/playwright/` 的相应测试目录；复验使用独立目录 `.cache/bee-preview/interface-audit-current/`，其中 `.last-run.json` 为 passed。当前内存复现输出在 `.cache/bee-preview/interface-audit-current-memory.log`。TS 单测原始输出保留于本机临时日志 `/var/folders/6p/7_k4z27j63l2p6bbs1p4yhc80000gn/T/bee-mock-audit-unit-5ychs_l1.log`。未运行 Rust／Go 全量测试或真实原生验收。

## mock 命令清单

下表覆盖当前 Rust 注册的 48 条前端命令；参数形状来自真实 Client，不能将 Go 私有桥额外方法误计为页面漏实现。mock 明细行号以初次审计的 `eef0b6c` 版本为准；并行修正在 fixture 第 63 行加入 4 行 supplyReadError，后续位置相应后移 4 行。F1 已修正，其余分支内容未改。

| 正式 Client／命令 | 当前参数与预期返回 | mock 状态及入口 |
| --- | --- | --- |
| `bridge_status` | 无参数 → ready/starting/failed/stopped，ready 带 metadata.instance | 共用第 20、30 行；预览第 82 行覆盖两种管理进程场景 |
| `bridge_pending_requests` | 无参数 → `{instance,requests}` | 共用第 30 行，可由 `window.pendingRequests` 注入；预览没有命名中的请求／settled 场景 |
| `bridge_request` | `{method:'ping'}` → `{protocol:1,id,instance,result:{alive:true}}` | **未单独实现**，落入共用第 102、119 行账号兜底；见 F6 |
| `startup_status`、`startup_recheck` | 无参数 → `{state,failure,instance,binding_revision,network_revision,observed_at,revision}` | 共用第 33 行；预览第 83 行 blocked 固定结果，不随修复／重查改变 |
| `device_context` | 无参数 → `{result:{context}}`，或带正 binding_revision 的本地读取错误 | 共用第 32 行；预览第 89-94 行，支持 unconfigured 和恢复后的身份 |
| `device_status`、`device_begin`、`device_open` | 无参数／`{hive,name}`／无参数 → `{result:{device}}`；恢复 open 返回 recovery | 预览第 105-119 行可 pending→人工批准→bound；begin 忽略传入 hive/name，使用场景固定值 |
| `device_recovery_prepare`、`device_recovery_confirm`、`device_recovery_status` | 无参数／`{operationId,expectedRevision,decision}`／无参数 → `{result:{recovery}}` 或业务错误 | 预览第 95-104 行；confirm 校验 ID／revision，有人工批准入口；阶段／decision 限制未完整模拟，见 F7 |
| `account_defaults` | `{}` → `{instance,result:{defaults}}` | 共用第 101 行，提供两平台来源和 supported 标志 |
| `account_detect`、`account_snapshot` | `{request:{platform,directory,store,mode}}`／`{platform,refresh}` → `{instance,result:{account}}` | 共用第 103-119 行本有检测转换；**预览第 138-142 行覆盖后只读原快照**，见 F3 |
| `account_action` | `{request:{platform,revision,candidate_ref,action,confirmed}}` → 账号快照及 operation | 共用第 106-112 行，检查 revision，更新选择并暂停；支持外部 `actionPending/actionUnknown`，不模拟完整异步同步屏障 |
| `authorize_start`、`authorize_status`、`authorize_cancel` | `{request:{platform,source,expected_revision}}`／`{operationId}`／`{operationId}` → `{instance,result:{operation}}` | 共用第 92-99 行；running、取消未知、外部完成开关；预览快照绕开完成推进，且各平台复用同一 operation ID，见 F3 |
| `runtime_snapshot`、`runtime_start`、`runtime_stop` | `{}`／`{request:{expected_revision,resume_platforms}}`／`{expectedRevision}` → runtime／operation envelope | 共用第 86-90 行；预览第 120-136 行。开始／停止立即 succeeded，未知开始后读持续失败；修订、网络与连接分离有缺口，见 F4、F5、F7 |
| `supply_status`、`supply_set_paused` | `{platform}`／`{platform,paused}` → `{result:{supply}}` 或业务错误 | 共用第 100 行；预览第 63-79、143-164 行。平台暂停可操作；初次缺失的重试错误证据已补齐并复验通过，见 F1 更新；连接场景一致性仍见 F5 |
| `preferences_read`、`preferences_save` | `{}`／`{request:{expected_revision,preferences}}` → `{preferences,error}` | 共用第 51-55 行；预览第 81 行每次读取覆写语言／主题，见 F2、F7 |
| `network_snapshot`、`network_test`、`network_save_proxy`、`network_apply_saved` | `{}`／`{proxy}`／`{proxy,origin,expectedRevision}`／`{confirmed:true}` → 网络快照、固定三项测试 envelope 或偏好快照 | 共用第 67-73 行；测试固定三项成功；支持保存失败，应用后网络修订未同步到预览 runtime，见 F4、F7 |
| `notification_permission`、`notification_enable` | `{}` → prompt/granted/denied | 共用第 56-57 行；预览第 85 行固定 denied；enable 回 granted 后未保存权限供下次读取，见 F2 |
| `notification_delivery_status`、`notification_retry` | `{}` → 五字段送达快照／`{retryable_count}` | 共用第 58-64 行，可外部注入错误／计数／未知回执；重试转 pending，不自行重发 |
| `autostart_status`、`autostart_set` | `{}`／`{enabled}` → `{desired,registered,error}` | 共用第 65-66 行始终按 desired 登记成功；预览第 86 行只读固定失败，未演练修复后的回读 |
| `diagnostics_start`、`diagnostics_snapshot`、`diagnostics_cancel` | `{}`／`{id}`／`{id}` → `{instance,result:{report}}` | 共用第 75-84 行；预览第 88 行覆盖运行／完成／读失败，固定报告内容；cancel 后不会被 diagnostics-running 场景保留为 cancelled |
| `diagnostic_logs`、`diagnostics_export` | `{query:{cursor,limit,module,platform,level}}`／`{reportId,includeLogs}` → 日志页／导出对象 | 共用第 82、85 行；预览第 44、87 行支持下载未知；日志固定一条并模拟游标，不代表真实日志过滤完备 |
| `update_snapshot`、`update_check`、`update_download`、`update_install` | `{}`／`{}`／`{}`／`{request:{operation_id,expected_revision,confirmed}}` → update snapshot | 共用第 37-46 行能 idle→available→verified→stopping；预览第 84 行对所有 update 命令固定返回当前场景状态，不能在 update-verified 场景演练安装推进 |
| `hive_open` | `{}` → void | 共用第 74 行只记 `openedHive`，不打开真实网站，符合隔离边界 |
| `login_return_received` | 无参数 → boolean | **未单独实现**，落入账号兜底；见 F6 |
| `native_locale_sync` | `{request:{locale,revision,sequence}}` → null | 共用第 47 行已有明确 null 回执；不应再把它登记为缺少命令 |

共用声明文件 `desktop/tests/fixtures/native-accounts.d.mts:1-2` 将账号及场景描述为 `unknown`／`Record<string,unknown>`；因此 TypeScript 编译通过本身不证明 fixture 字段或状态转换与真实 Client 一致，仍需运行时契约断言。

## 已确认缺口与修正记录

### F1．自动重试错误证据缺失（并行修正后已复验通过）

- **初次等级／确定性：高；已复现。** 初次 `fixture.mjs:62` 的 `businessError` 只有 code/message；第 148、153、158 行用 `SUPPLY_OPERATION_FAILED` 和英文 “HTTP 503” 描述可恢复读取失败，没有 `details.evidence.failure_kind/http_status`。
- **初次结果：** 真实 `createDesktopState`、`createSupplyClient` 读取 `check-waiting`、`check-retrying` 后，OpenAI 的 `supplyRefresh.state='blocked'`；`supply-partial` 的 Claude 也为 blocked。三者 `UiFailure.evidence={}`、`observedAt=null`。
- **原因：** `desktop/src/system/desktopState.ts:43-50` 使用 `evidence.failure_kind ?? code` 和结构化 HTTP 状态决定重试；不解析 message。`SUPPLY_OPERATION_FAILED` 不在临时错误白名单。
- **当前状态：** 核查期间的并行修改在 fixture 第 63-66 行加入 supplyReadError，提供 `failure_kind=http_rejected`、`http_status=503`，并替换三个失败分支；恢复测试也单独断言标签／时间。主审未修改这两个源码文件。当前内存脚本三项均得到 `supplyRefresh.state='scheduled'` 且证据完整；正式预览 61／61 通过。此项保留为修正记录，不计作未解决缺口。

### F2．预览写入成功后的回读未反映模拟状态

- **等级／确定性：中；已复现。** `fixture.mjs:81` 每次 `preferences_read` 都将语言和主题重写为 URL 参数；默认是 zh/light。`createPreferencesClient` 的真实读写入口在 `preferences.ts:53-57`。
- **复现：** `settings-general` 读取 revision=0；保存 en/dark 返回 en/dark/revision=1；再次 read 返回 zh/light/revision=1。相同修订出现不同内容，设置页或初始化回读可覆盖刚保存的选择。
- **相关固定替身：** 共用 `native-accounts.mjs:56-57` 默认 permission→prompt、enable→granted、再次 permission→prompt；没有保存成功授权后的模拟权限。设置系统场景第 85-86 行也持续返回 denied／自启读取失败，用户动作后无法演练成功回读。后者属于场景恢复覆盖不足，不是声称真实 OS 操作应由浏览器完成。
- **现有测试边界：** `native-experience.spec.ts:59-69,98-110` 检查共用 fixture 的保存失败／迟到读取，但没有加载 bee-preview 的第 81 行包装，不能覆盖此回归。

### F3．账号检测和登录完成在正式场景入口被固定快照截断，跨平台登录还复用操作 ID

- **等级／确定性：中；已复现。** `fixture.mjs:138-142` 对 detect 和 snapshot 直接返回 `w.accounts[p]`，忽略检测请求的 directory/store/mode/refresh，也绕过共用 `finishLogins`。共用原本在 `native-accounts.mjs:15-17,90,105,113-116` 更新候选、修订及登录结果。
- **检测复现：** `account-empty` 对 OpenAI 调用 `detect({directory:'/tmp/other-source',store:'keyring',mode:'official'})`，返回仍为 `source_missing/source=null/revision=1`，与调用前相同。检测来源编辑／重新核对无法在此入口产生新的模拟事实。
- **登录复现：** `confirm-login` 调用 authorize.start，再按共用测试约定设置 `window.loginComplete=true`，随后真实 runtime.snapshot/account.snapshot 仍读到 `operation.state='running'`、`candidate.state='source_missing'`；额外直调 authorize.status 才读到 succeeded/available。`useAccounts.ts:149-152` 在共享协调器存在时不调用该额外 status；开始动作也按 `useAccounts.ts:225` 交给协调器刷新。因此不是仅缺少真实登录条件，而是模拟完成开关与正式读取路径断开。
- **操作 ID 复现：** 同一个 AuthorizeClient 先开始并取消 OpenAI 登录，再开始 Claude 登录，失败为 `AUTHORIZE_REPLY_INVALID: operation platform differs from request`。共用第 14 行所有 authorize 都返回 `'d'.repeat(48)`，而 `authorize.ts:24-29` 正确禁止同 ID 跨平台。现有单平台场景不能发现顺序跨平台操作的问题。
- **影响：** 静态候选／确认框可评审，完整“登录完成→成为候选→接入”及来源修复流程无法直接在正式预览完成。真实凭据正确性仍是另一个验收层级。

### F4．应用网络后，网络与运行／诊断上下文修订不一致

- **等级／确定性：中；已复现。** 共用 `native-accounts.mjs:72` 增加 `w.networkRevision`；预览 `fixture.mjs:136` 却把 runtime.network_revision 固定为 0，其独立 runtime revision 也不变。
- **复现：** `stopped` 保存回环代理后 applySaved(true)：network.effective_revision=1，而真实 RuntimeClient.snapshot().network_revision=0。共用诊断报告第 77 行使用 w.networkRevision，因此后续报告可带 1，与共享 runtime 的 0 冲突。
- **进一步实证：** 以上 apply 后，以实际 runtime.network_revision/run_id 初始化真实 DiagnosticsClient 并 start()，实际抛出 `DIAGNOSTICS_REPLY_INVALID: report network revision differs from current context`。
- **影响：** 无法正确演练网络切换后运行／诊断缓存失效及重新核验；`diagnostics.ts:110` 严格比较报告 network revision，`desktopState.ts:179,246` 也使用该修订限定上下文。设置执行应用后确实会刷新运行状态，见 `NativeSettingsPage.tsx:190-195`。

### F5．设备在线与贡献分离没有同步进入正式预览，部分连接失败还返回可接单

- **等级／确定性：中；已复现、规格确认。** 预览 `fixture.mjs:136` 由 local 推导 connection：stopped 一律 disconnected；supply 第 67 行仅 local 非 running 或 runtime-disconnected 时加入 offline。
- **复现：** `runtime-no-accounts` 与 `recovery-completed` 都得到 stopped/disconnected，没有提供“已绑定、无账号或停止贡献，但 connected”的正式目录场景。反向地，`runtime-rejected`、`runtime-occupied`、`runtime-connecting` 都返回 OpenAI supply.ready=true、reasons=[]。
- **依据：** 当前设备连接规格 `2026-11-03-desktop-device-connection-design.md:75-78,88-100` 要求无账号也自动在线、停止后恢复在线、新设备恢复后自动连接。ready 与 connection 是不同事实，但连接受拒／占用／尚在连接时不能由模拟数据凭空证明当前可接单。
- **影响：** 页面可能仍有正式状态门禁避免显示错误成功；本审计没有把字段矛盾直接升级为已证实的 GUI 误呈现。但该 mock 无法验证新连接生命周期，且可能让部分页面只看 supply 的实现漏检。`native-runtime.spec.ts:313-330` 另行手动覆写了 stopped+connected/reconnecting/rejected/occupied，说明相关组件已有专项测试，缺口在日常预览目录和基础模型同步。

### F6．未知命令不拒绝，两个真实命令还收到账号返回值

- **等级／确定性：中；已复现。** 共用 `native-accounts.mjs:37,75,86,92,100` 按前缀处理；第 102、119 行对剩余命令无白名单检查，最终返回账号 envelope。
- **复现：** `invoke('unknown_command',{})`、`bridge_request`、`login_return_received` 都 resolve `{instance,result:{account:undefined}}`。`update_nonexistent` resolve idle 更新快照；`runtime_nonexistent` resolve runtime；`diagnostics_nonexistent` resolve report；`supply_nonexistent({platform:'openai'})` resolve supply。
- **实际影响分层：** `bridge.ts:81` 的 ping 当前只作类型断言，`bridgeMonitor.ts:43-45` 只 await 后即标 alive，错误返回值会被当作 ping 成功；这会掩盖管理桥检查缺陷。`lifecycle.ts:18` 只接受严格 true，账号对象不会误报登录返回，但也无法演练正确的 boolean receipt 或登录返回通知。其余未知命令属于契约漂移的防线缺口：有严格 decoder 的 Client 通常会拒绝错误形状，不能概括为所有未知命令都会造成产品业务成功。

### F7．部分写命令缺少当前契约的前置条件，失败覆盖依靠外部改写

- **等级／确定性：中；已复现／源码确认。** 共用 preferences_save 第 52-55 行和 network_save_proxy 第 68-70 行没有比较 expected revision；预览 runtime_start/stop 第 120-130 行不检查 expected revision、已选账号或 resume_platforms。设备 begin 不保存输入；recovery confirm 第 99-100 行只检查 ID／修订，将所有非 adopt_owner 决策当作 pending，没有按当前 phase 限制 decision。
- **复现：** 同一 revision=0 的旧偏好对象连续两次 save 都成功，第二次返回 error=null/revision=2；`stopped` 场景 runtime revision=1 时 start(expected_revision=0) 仍返回 succeeded/revision=2。
- **影响：** 当前 Client 会验证字段类型，但不会替代后端对实际最新修订／阶段的判断。模拟“过期确认、未选账号、修订冲突、网络应用失败”等路径时必须另写 interceptor，日常场景无法证明这些保护；不能因 mock 接受某参数就认定真实实现也接受。
- **已有有限保护：** 共用 account_action 第 107 行会检查 revision，update_install 第 42 行也检查 operation/revision；因此不是整个 mock 完全不校验。现有专项测试对旧实例、旧修订、未发送写请求等有独立替身，见下表。

## 场景与测试实际覆盖

| 层级 | 源码证据 | 已覆盖／尚未证明 |
| --- | --- | --- |
| 场景目录及查看器 | `scenarios.mjs:1-20`；`viewer.mjs:4-16` | 76 项、10 组；主题／窄窗／重置通过重新加载 iframe。场景存在不代表状态转换完整。未知场景 ID 第 21 行回落 running 是选择器默认行为，与未知 IPC 命令接受应区别对待 |
| 正式预览场景测试 | `preview-scenarios.spec.ts:12-37,138-146` | 40 个主场景＋15 个补充场景做文案、pageerror、REPLY_INVALID 和部分写命令零调用断言；只有候选等个别场景继续确认操作 |
| 选择器及跨页 | 同文件第 39-69、149-155 行 | 检查 76 option、10 group、confirm-change 主题／尺寸保持；两个无账号场景零写；英文详情与设置导航。没有逐项执行全部 76 场景 |
| 少数完整模拟交互 | 同文件第 72-135 行 | 自动恢复序列、首次配对人工批准、接入暂停、两种换号清空旧额度；未包含登录完成、代理应用后的诊断、语言／主题保存回读或顺序跨平台登录 |
| 设备恢复专项 | `device-recovery.spec.ts:10-49`；由 `playwright.device.config.ts:5` 选择 | 9 个未决事务场景跨四页零写、撤销凭据→用户确认→外部批准→新 owner 明确确认、绑定撤销＋来源缺失组合；弥补一部分 preview suite 未直接提到的恢复场景 |
| 账号／运行专项 | `native-accounts.spec.ts:14-54,146-179`；`native-runtime.spec.ts:293-330` | 共用替身测试登录失败、取消未知、来源失败／恢复、已证实未发送写请求、闲置在线与连接失败；大量通过 test.addInitScript 额外改写 invoke，不能自动证明 bee-preview 包装保留相同行为 |
| 诊断／设置专项 | `native-experience.spec.ts:25-47,59-69,86-110,113-130` | 四页共享读取、日志筛选参数、偏好失败／迟到读、通知重试、匹配下载回执；主体使用共用 fixture，无预览包装 |
| Client 与跨语言参数契约单测 | `native-command-contract.test.ts:18-60,62-122` | 从 Rust registry／Serde 源码提取字段，执行真实 Client 发出参数后立即抛 stopped；检查 48 条命令均有样本。**不执行 mock handler，不校验 mock 响应或转换** |
| fixture 直接契约抽查 | `diagnostics.test.ts:102-115` | 共用 fixture 的 instance、runtime、preferences、diagnostics start→snapshot 和事件订阅隔离；没有安装 bee-preview fixture |
| 其他解码／协调单测 | `nativeAccounts.test.ts:6-69`、`desktopState.test.ts:21-68,98-122,184-216`、network/preferences/notifications/updater/diagnostics 单测 | 覆盖 DTO 拒绝、实例／修订、重试门控、迟到回复及上下文；多为测试内独立数据。它们能证明正式 Client／协调器防线，不等于目录里的每个 mock 响应有效 |
| tooling | `tooling.test.mjs:21-324` | 工具链、TEE、构建来源、目标架构／最低系统等。没有 `bee-preview` 或 native-accounts 命令完备断言，不能由 tooling 通过推断 UI mock 完整 |

静态对照：preview-scenarios.spec.ts 直接出现 56 个目录 ID；其余 20 个未出现：`device-loading`、`device-draining`、`device-awaiting-confirmation`、`device-creating`、`device-creation-unknown`、`device-redeeming`、`device-redemption-unknown`、`device-saving`、`device-recovery-confirm`、`recovery-pending`、`recovery-draining`、`recovery-creation-unknown`、`recovery-redemption-unknown`、`recovery-owner`、`recovery-saving`、`recovery-completed`、`device-revoked-source-missing`、`runtime-connecting`、`runtime-rejected`、`runtime-occupied`。这只是该文件覆盖边界，不表示整个测试仓库对它们完全没有测试。

`preview-scenarios.spec.ts:10` 的 writes 集合只有 account_action、authorize_start、supply_set_paused、runtime_start、runtime_stop；不能把该文件所有“零写”断言读成也证明 device_begin／recovery_confirm／preferences_save／network_apply_saved／update_install 未调用。选择器专项第 68 行和设备恢复专项第 9 行使用更广的局部列表。

## 可复现内存检查

在仓库根执行以下脚本。它只创建普通 JS window/location 对象，并使用真实 Client；不需要 Vite、浏览器、Bee 或 Hive。审计实际使用 `/Users/dayong/.nvm/versions/node/v24.22.1/bin/node`，输出 node=v24.22.1，进程退出码 0。

```sh
/Users/dayong/.nvm/versions/node/v24.22.1/bin/node --input-type=module <<'EOF'
import {installPreviewFixture} from './desktop/tests/fixtures/bee-preview/fixture.mjs';
import {createAccountClient} from './desktop/src/system/accounts.ts';
import {createAuthorizeClient} from './desktop/src/system/authorize.ts';
import {createRuntimeClient} from './desktop/src/system/runtime.ts';
import {createDeviceClient} from './desktop/src/system/device.ts';
import {createPreferencesClient} from './desktop/src/system/preferences.ts';
import {createNetworkClient} from './desktop/src/system/network.ts';
import {createNotificationsClient} from './desktop/src/system/notifications.ts';
import {createSupplyClient} from './desktop/src/system/supply.ts';
import {createDesktopState} from './desktop/src/system/desktopState.ts';
import {createDiagnosticsClient} from './desktop/src/system/diagnostics.ts';
async function scene(id) {
  globalThis.window={parent:{postMessage(){}}};
  globalThis.location={origin:'http://preview.test',search:''};
  await installPreviewFixture(id);
  const invoke=window.__TAURI_INTERNALS__.invoke;
  return {invoke,instance:(await invoke('bridge_status')).metadata.instance};
}
console.log('node',process.version);
let {invoke,instance}=await scene('account-empty');
let account=createAccountClient(invoke,instance);
console.log('detect', (await account.detect({platform:'openai',
  directory:'/tmp/other-source',store:'keyring',mode:'official'})).candidate);
for(const cmd of ['bridge_request','login_return_received','unknown_command',
  'update_nonexistent','runtime_nonexistent','diagnostics_nonexistent','supply_nonexistent']) {
  const value=await invoke(cmd,cmd==='bridge_request'?{method:'ping'}:cmd==='supply_nonexistent'?{platform:'openai'}:{});
  console.log('dispatch',cmd,Object.keys(value),value.result&&Object.keys(value.result));
}
({invoke,instance}=await scene('settings-general'));
const preferences=createPreferencesClient(invoke),old=(await preferences.read()).preferences;
console.log('save',await preferences.save(0,{...old,language:'en',theme:'dark'}));
console.log('read',await preferences.read());
console.log('stale save',await preferences.save(0,{...old,language:'en',theme:'dark'}));
({invoke,instance}=await scene('stopped'));
const network=createNetworkClient(invoke);
await network.saveProxy({proxy:'http://127.0.0.1:7890',origin:'https://hive.example',expectedRevision:0});
console.log('network', (await network.applySaved(true)).effective_revision);
console.log('runtime network', (await createRuntimeClient(invoke,instance).snapshot()).network_revision);
const runtime=await createRuntimeClient(invoke,instance).snapshot();
try {await createDiagnosticsClient(invoke,instance,runtime.network_revision,runtime.run_id,1).start();}
catch(e){console.log('diagnostics after apply',e.message);}
const notifications=createNotificationsClient(invoke);
console.log('permission',await notifications.permission(),await notifications.enable(),await notifications.permission());
console.log('stale start',await createRuntimeClient(invoke,instance).start({expected_revision:0,resume_platforms:['openai']}));
for(const id of ['runtime-no-accounts','recovery-completed','runtime-rejected','runtime-occupied','runtime-connecting']) {
  ({invoke,instance}=await scene(id));
  const r=await createRuntimeClient(invoke,instance).snapshot();
  const s=(await invoke('supply_status',{platform:'openai'})).result.supply;
  console.log('runtime/supply',id,r.local,r.connection,s.ready,s.reasons);
}
({invoke,instance}=await scene('confirm-login'));
account=createAccountClient(invoke,instance);
const authorize=createAuthorizeClient(invoke,instance);
const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:1});
window.loginComplete=true;
console.log('login shared', (await createRuntimeClient(invoke,instance).snapshot()).platforms.openai.account.operation.state,
  (await account.snapshot('openai',false)).candidate.state);
await authorize.status(login.id);
console.log('login extra status',(await account.snapshot('openai',false)).operation.state);
try {await authorize.start({platform:'claude',source:{directory:null,store:'file'},expected_revision:1});}
catch(e){console.log('cross-platform login',e.message);}
for(const id of ['check-waiting','check-retrying','supply-partial']) {
  ({invoke,instance}=await scene(id));
  const bridge={status:()=>invoke('bridge_status'),onStatus:async()=>()=>{},
    pendingRequests:()=>invoke('bridge_pending_requests')};
  const model=createDesktopState({bridge,device:createDeviceClient(invoke),
    runtime:i=>createRuntimeClient(invoke,i),accounts:i=>createAccountClient(invoke,i),
    supply:b=>createSupplyClient(invoke,b),intervalMs:100000,random:()=>1});
  model.subscribe(()=>{});
  await new Promise(resolve=>setTimeout(resolve,20));
  await model.refresh();
  const state=model.getSnapshot(),p=id==='supply-partial'?'claude':'openai';
  console.log('gate',id,state.supplyRefresh[p],state.supplyErrors[p]);
  model.dispose();
}
EOF
```

当前关键输出：detect 仍 source_missing；preferences save=en/dark/rev1、read=zh/light/rev1、旧 revision 再 save 成功 rev2；network=1、runtime network=0、后续诊断报 DIAGNOSTICS_REPLY_INVALID；permission=prompt/granted/prompt；旧 revision 的 runtime start=succeeded；三种连接异常 supply ready=true；login shared=running/source_missing，extra status=succeeded；cross-platform login=AUTHORIZE_REPLY_INVALID。F1 修正后，三项 gate=scheduled，包含 failure_kind=http_rejected、http_status=503；初次缺证据时为 blocked。

## 后续范围

以上问题集中在测试替身／预览状态机、响应契约与场景断言，不能据此判断正式 Go／Rust 能力未实现。若后续修复，应同步实际 Client 调用、mock 参数与响应、代表性的成功／失败／恢复转换，保持已确认的正式页面入口及隔离边界；不以本次审计自行扩大到真实账号、设备或系统写操作。
