# Bee 桌面：AI 账号接入与贡献运行实施计划（S1）

> **执行状态（2026-10-27）：** 用户最新调整为三个会话分工：本会话仅执行 S1，继续使用 `executing-plans`；用户另开会话实施 S2、S3。复选框只记录有验证证据的完成项。S1-T1／T2／T3 已验证；T4 代码及自动验证完成，真实登录验收待授权测试环境；S1-T5／T6／T7 已通过自动验证；S1-T8 全量回归和本机隔离包验证通过。两平台真实官方登录及真实 Hive 受控贡献仍未验收，不标完整完成。详见[交付证据](../../desktop/account-runtime-validation.md)。

**目标：** 用户能从已有登录或官方登录接入两平台，真正贡献、维护授权、换号和重启恢复，完整交付 R1–R6。

**架构：** 在现有 `bee desktop` 管理子进程内运行现有 Go 核心；共享设备会话统一配置锁，账号状态保存用户意图及未决操作。Rust 仅监督 owned 子进程，React 消费 typed 快照，不从日志推断运行成功。

**技术栈：** Go 1.27.3、Tauri 2.12.5 / tauri-build 2.7.4、Rust 1.94（crate 最低 1.90）、React 19.2.8、TS 7.0.2、Vite 8.2.4、Node 24、Playwright 1.63.0；不新增服务或数据库。

**依据与状态：** [S1 spec](../specs/2026-10-26-desktop-account-runtime-design.md)于 2026-10-26 整体获批。产品源码基线 `a16f251`，三份 spec 初稿提交 `3da4bae`；执行从已整合本次文档的分支开始，不能重置已有清理。旧账号计划六个 Task、28/28 已完成，本计划承接真实接入与运行。

## 全局约束

- Bee 管本机账号和贡献，沿用设备配对／凭证；无 Hive 用户登录、资金、独立市场列表或 Hive 改造。Hive 网站完整性不阻塞交付。
- 首次检测和贡献须明确操作；换号成功后仍暂停；完整移除（3B）、等待任务退出（2B）暂缓。保护 CLI 配置和官方登录，不自动接管外部 Bee。
- 银白精工、中英文、最小窗口 860×600；macOS 13+ arm64/x64、Win10 22H2 / Win11 x64、Ubuntu 22.04 / 24.04 x64/arm64。S1 完成真实功能，S3 补目标平台发布证据。
- 官方登录使用已安装 Codex／Claude，固定命令；不收集密码、token，不在 stdout 混入日志。代理默认使用现有环境及空专用配置，不等待 S2。
- 风险重点是暂停／接入／confirm 的外部副作用、旧 worker 提交、配置锁与持久化失败。测试使用真实 HTTP/WS 替身和进程句柄，记录调用与磁盘状态；不能只把快照赋成成功。
- 下列新类型、文件、命令是实施契约，不表示已经存在。每任务先写所列失败用例并确认预期失败，再实现、运行同一命令至通过，最后只提交该任务明确路径。错误遵循 `fail-fast-with-evidence`，鉴权／迁移遵循 `high-stakes-implementation-testing`。

## 三份计划的执行分工（2026-10-27 更新）

用户最新指示覆盖此前三份 spec 串行安排：当前会话仅实施 S1；用户另开会话并行实施 [S2 诊断与体验](2026-10-26-desktop-diagnostics-experience.md) 和 [S3 安装更新](2026-10-26-desktop-release-update.md)。各会话使用独立分支及工作树，从包含 S1 已提交基础的 `feat/bee-desktop-p0` 分支建立，不能同时修改当前工作树。2026-10-27 此次调整时已提交基础为 `6dd2f4b`；当时 S1-T5 尚未提交，不得假定新工作树已经包含它。当前可集成的已提交基础已更新到 `636daa4`；T6 退出交接在 `73f3c54`，T7 原生页面在 `b4f9d8c`，账号运行快照修订同步修复在 `636daa4`。

每份计划内部继续按 Task 依赖实施。S2 可先做偏好、OS 适配、诊断和独立页面；S3 可先做发布构建、更新检查／下载／验签。S1 负责真实运行、账号状态、恢复与 `prepare_owned_exit` 的唯一实现；S2/S3 消费这些接口，不自行复制状态机。S2-T4／S3-T3 需同步 S1-T6 后集成；S2-T5 需 S1-T7，S3-T4 需 S2-T5。共用注册点、`NativeApp.tsx`、生命周期、依赖锁文件及协议文档在合并时逐项整合，不能覆盖其他会话实现；完整验收须使用整合后的代码。

## 文件职责及公共契约

| 文件 | 责任及生产者 |
| --- | --- |
| `agent/desktop_session.go`、`desktop_account_state.go` | T1：会话持锁、受保护 v2 状态、迁移与修订 |
| `agent/desktop_account_selection.go`、`desktop_account_switch.go` | T2/T5：接入、平台屏障、换号核对 |
| `agent/desktop_runtime.go`、`desktop_runtime_types.go`、`desktop_runtime_recovery.go` | T1/T3/T6：契约、真实循环、停止与恢复 |
| `agent/desktop_authorize.go`、`desktop_authorize_unix.go`、`desktop_authorize_windows.go` | T4：官方登录的独立进程生命周期 |
| `desktopbridge/runtime.go`、`authorize.go`；Rust `runtime.rs` / `runtime_protocol.rs`；TS `system/runtime.ts` / `authorize.ts` | T3/T4/T6：固定动作及跨语言校验；不新增通用 Shell 通道 |
| `desktop/src/features/accounts/NativeAccountActions.tsx`、`features/lifecycle/NativeRuntimeControls.tsx` | T7：真实操作与状态展示，主页面只组装 |

T1 在 `docs/desktop/bridge-protocol.md` 一次定义以下字段，Go/Rust/TS 共用 JSON fixture；`Platform` 复用 `openai | claude`，时间为 UTC RFC3339，数字修订为非负 JS 安全整数，未知状态拒绝解析。桥 envelope 的 `instance` 仍为管理进程实例；新增 `run_id` 为一次运行实例，不能混用。

| 契约 | 参数／返回及约束 |
| --- | --- |
| `DesktopNetworkConfig` | `revision: number, connect_proxy: string`；仅受信内部配置输入，默认 `{revision:0, connect_proxy:""}` |
| `DesktopOperation` | `id: string, kind: select/clear_selection/start/stop/confirm_change/authorize, platform: Platform|null, state: pending/running/reconciling/succeeded/failed/cancelled, revision: number, error: DesktopAccountError|null`；ID 不等于 Hive confirmation_id |
| `DesktopRuntimeSnapshot` | `run_id: string|null, revision, network_revision, observed_at, local, connection, platforms, operation, stop_receipt`；local为stopped/starting/running/stopping/failed，connection为disconnected/connecting/connected/reconnecting/rejected/occupied；platforms为按Platform索引的`{account:DesktopAccountSnapshot,supply:DesktopSupply|null,selection_revision:number}`，operation为DesktopOperation或null，stop_receipt为DesktopStopReceipt或null；不重新定义可接单判断 |
| `DesktopStartRequest` | `expected_revision, resume_platforms: Platform[]`；仅本次明确允许恢复的平台；内部重启恢复另由保存意图和新鲜暂停状态核对，不能假造一次用户开始操作 |
| `DesktopStopRequest` | `expected_revision, reason: user_stop/app_exit/update/network_change`；reason 由 Rust 固定入口生成，网页不能选择退出理由绕过停止意图 |
| `DesktopStopReceipt` | `workers_stopped: bool, intent_saved: bool, session_clean: bool`；只说明 Go 本机运行，不能替代 Rust 对管理子进程 wait/reap 的证明 |
| `DesktopRuntime` 方法 | `Snapshot(context.Context) (DesktopRuntimeSnapshot,error)`；`Start(context.Context,DesktopStartRequest) (DesktopOperation,error)`；`Stop(context.Context,DesktopStopRequest) (DesktopOperation,error)`；`ConfigureNetwork(context.Context,DesktopNetworkConfig) error`（仅停止时）；`Restore(context.Context) (DesktopOperation,error)`（只按已保存意图核验，不擅自恢复平台） |
| 固定桥动作 | `runtime_snapshot`、`runtime_start`、`runtime_stop`；Rust内部另用 `runtime_configure_network`、`runtime_restore` 调用上述ConfigureNetwork/Restore，前端不获得这两个原始入口，通用bridge_request仍保持白名单。长操作立即返回operation，后续快照查询；运行快照operation只指当前运行动作，平台动作分别在账号快照中。现有 `account_action` 返回快照新增可空 `operation`，`account_snapshot` 查询其进度 |
| 官方登录 | `DesktopAuthorizeRequest={platform, source:DesktopAccountSource, expected_revision}`；`authorize_start(request)` / `authorize_status({operation_id})` / `authorize_cancel({operation_id})` 返回 `DesktopOperation`；源目录只用于已核验官方命名空间，不接收程序或参数 |
| Rust 退出交接 | `prepare_owned_exit(reason: OwnedExitReason) -> Result<OwnedExitReceipt, BridgeError>`；reason 为 app_exit/update，receipt 为 `intent_saved, session_clean, child_reaped, config_lock_released` 四布尔值；冻结新写动作，保留 App 单实例锁至实际退出。S3 仅在四项成立时安装；普通退出即使保存失败仍回收并报告 |

存储 v2 保留 `version/revision/entries` 中原提醒信息，增加按 Hive origin + owner + device 分组的 `selections`、`pending_operations`、`runtime_intent`、`session`。选择含 source 引用、fingerprint、generation、credential revision、selection revision；未决动作含原/目标身份与代次、执行阶段、Go 私有 confirmation_id；会话标记含 run_id、active/clean 和持久化确认。仅保存必要引用，不复制 token；迁移前受保护备份，未知版本及损坏原文件不能覆盖。

## Task 1（S1-T1）：统一配置归属、状态迁移和交接契约

**文件：** 新建上述 `desktop_session.go`、`desktop_runtime_types.go`、`agent/desktop_session_test.go`；修改 `agent/desktop_device.go`、`desktop_supply.go`、`desktop_account_hive.go`、`desktop_account_state.go`、`desktop_account_state_test.go`、`docs/desktop/bridge-protocol.md`；新建 `desktopbridge/testdata/runtime-contract.json`。

**输入／输出：** 复用 `lockState`、受保护原子文件工具和现有设备身份验证；输出共享会话与上述 DTO。`NewDesktopDevice()` 保持兼容，首次业务访问延迟取得会话；`Close()` 仅由管理进程最终退出调用。未实现功能不得提前在 hello 声称可用。

- [x] 写失败用例：hello/ping 零配置读取；设备／供给／账号共享一次锁；外部持锁拒绝写入；网络等待不占配置互斥锁；v1→v2 保留提醒；断电/写失败保留原件；重复键、未知版本、权限错误拒绝；scope 不得串用。
- [x] 运行 `go test ./agent ./desktopbridge -run 'TestDesktop(Session|AccountState)|Test.*Hello|Test.*Ping' -count=1`，确认失败来自新增不变量。
- [x] 实现会话和版本迁移，落盘公共契约 fixture；不启动贡献，不改变 CLI 的原文件及锁生命周期。
- [x] 重跑上述测试并运行 `go test -race ./agent -run 'TestDesktop(Session|AccountState|Supply)' -count=1`；预期全过、无数据竞争。
- [x] 精确提交本任务路径：`refactor(desktop): share owned device session and version account state`。

T1 验证：共享会话、严格 v2 迁移、Close 等待和未决状态回读测试通过；相关 Go race、go vet 与 diff 检查通过。审阅发现的大小写字段别名覆盖问题已用失败回归用例修复。

## Task 2（S1-T2）：确认选择并持久接入

**依赖：** T1。**文件：** 新建 `agent/desktop_account_selection.go`、`desktop_account_selection_test.go`；修改 `agent/desktop_accounts.go`、`desktop_account_sources.go`、`desktop_account_hive.go`、`desktopbridge/accounts.go`、`desktopbridge/accounts_test.go`、Rust `protocol.rs` / `protocol_tests.rs`、TS `system/accounts.ts` / `tests/nativeAccounts.test.ts`（立即同步新增operation字段，不等T7）。

**输入／输出：** 消费现有 `DesktopAccountActionRequest` 的 revision/candidate_ref/confirmed；实现 `select` 和本地未注册选择的 `clear_selection`，已注册完整移除继续明确不可用。输出持久选择和可查询 operation；不把选择当作注册或贡献。

- [x] 写 HTTP 调用账本用例：核验候选→保存意图→暂停 PUT→GET 确认→原子保存；暂停响应丢失只查询；候选变化／device owner 改变／保存失败不继续；首次选择不启动运行、不发授权同步；未选平台零读取。
- [x] 运行 `go test ./agent ./desktopbridge -run 'TestDesktopAccount(Selection|Action)' -count=1`，先确认预期失败。
- [x] 实现异步动作及按平台串行门；重启恢复选中来源但保留“待开始”；追加平台时通过 T3 的平台屏障接线，T3 未接通前不允许假报运行中热切换成功。
- [x] 重跑上述测试，再运行 `go test -race ./agent -run 'TestDesktopAccount' -count=1`、Rust协议测试及`node --test desktop/tests/nativeAccounts.test.ts`；两平台隔离、旧检测回执不能覆盖新选择。
- [x] 提交本任务路径：`feat(desktop): persist confirmed account selection while paused`。

T2 验证：Go 账号/桥相关 race 与 vet、13 项 Rust 协议测试、19 项 sidecar 测试（签名包专用项仍按原约定另验）、6 项 TS 账号测试及 typecheck 通过。两项审阅缺陷均先复现再修复并复核。Rust 使用本机完整的 `+1.94` 工具链（实际 1.94.0）；同版本 `1.94.0` 别名安装缺 Cargo，未改变项目版本。

## Task 3（S1-T3）：运行真实贡献循环及结构化状态

**依赖：** T1/T2。**文件：** 新建 `agent/desktop_runtime.go`、`desktop_runtime_test.go`、`desktopbridge/runtime.go`、`runtime_test.go`、`desktop/src-tauri/src/runtime_protocol.rs`、`desktop/src/system/runtime.ts`；修改 `agent/client.go`、`cli.go`、`setup.go`、`authorization_workers.go`、`egress.go`、`cmd/bee/main.go`、共享桥接注册点及 `desktop/src-tauri/src/protocol_tests.rs`；新建 `desktop/tests/runtime.test.ts`。

**输入／输出：** 实现公共 Runtime 接口，复用 `connect`、`buildEgress`、实际 relay 和每平台维护循环。从真实连接／同步分支产生结构化状态；CLI 保持原日志和重连行为，桌面首次 409 单独阻断。管理 ready 不代表 runtime running。

- [x] 建本地 HTTP/WS Hive 与上游替身：开始前零注册；明确开始后实际握手、同步、转发受控请求；只有身份/代次/credential revision/run_id 匹配才能按 resume_platforms 恢复；一个平台失败另一个可运行；停止等待 worker 结束；首次409不抢占，已有会话短断网退避重连、持续冲突转需处理。
- [x] 运行 `go test ./agent ./desktopbridge -run 'TestDesktopRuntime' -count=1`，确认真实请求账本及生命周期断言失败。
- [x] 将已有循环提取为可观测受控入口，不嵌套调用 CLI setup/run；构造仅包含已选择来源的 egress；实现每平台 worker 取消/等待/修订屏障，接通 T2 的追加和来源切换。开始前持久写 active 标记；Stop 即使意图写失败也取消 worker；父管道断开同样回收。
- [x] 三语言接线和 fixture 校验后运行上述测试、`go test -race ./agent ./desktopbridge`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml runtime`、`node --test desktop/tests/runtime.test.ts`；CLI 回归不得改变。握手能力只在真实服务实现后公布。
- [x] 提交本任务路径：`feat(desktop): run owned contribution loop with structured state`。

T3 验证：真实本机 HTTP／WS／TEE／CONNECT 替身覆盖同步、加密上传、转发、慢暂停重连、持续409、来源切换、平台部分失败及停止。完整 `go test -race ./agent ./desktopbridge ./relay`、Go vet、Node 24.22.1 下 TS 测试及 typecheck 通过。Rust 全量61项通过、2项签名包专用项按原约定另验；唯一沙箱套接字失败获准在沙箱外重跑后通过，新增运行协议/原生命令5项通过。两轮运行时审阅及协议审阅的缺陷均有失败回归和修复复核。此阶段不声称完成真实官方账号登录或真实流量验收。

## Task 4（S1-T4）：两平台官方登录入口

**依赖：** T1；按用户已确认的顺序在 T3 后实施，注册共享文件由当前执行者统一处理。**文件：** 新建文件职责表列出的三份 `desktop_authorize` Go文件、`agent/desktop_authorize_test.go`、`desktopbridge/authorize.go`、`authorize_test.go`、`desktop/src/system/authorize.ts`、`desktop/tests/authorize.test.ts`；修改 `agent/desktop_account_sources.go` 与共享命令注册点。

**输入／输出：** 实现上述 authorize 三动作；固定 `codex login`、`claude auth login --claudeai`，支持的安装路径、客户端版本和官方命名空间记录到 `docs/desktop/ai-accounts.md`。需要官方交互界面的版本由适配器打开可操作界面；不让用户自行输入命令来冒充完成。

- [x] 进程替身用例：未安装／版本不支持／命名空间不匹配、启动失败、等待、退出0但身份未变、错误退出、取消/超时、取消后迟到结果、启动两个请求、App退出；标记授权 URL 和 stdout 秘密不得进入协议/日志；只终止本次句柄及其受控子树，不终止既有客户端。
- [x] 运行 `go test ./agent ./desktopbridge -run 'TestDesktopAuthorize' -count=1`，确认失败；实测先只读版本/help，不自动登录真实账号。
- [x] 实现受控进程适配、版本能力检查、来源重新核验和取消；启动前提示官方当前登录可能变化；成功只成为待接入候选，不自动选择/恢复。登录网络沿用官方客户端自身设置。
- [x] 重跑 Go 测试及 `node --test desktop/tests/authorize.test.ts`，通过 Rust typed 命令/回执测试与 Windows 交叉编译。
- [ ] 用用户明确授权的两平台测试登录完成原生验证，并记录实际版本/OS/取消行为，不能以 help 输出替代；目前未运行真实登录，随 T8 保留验收缺口。
- [x] 提交本任务路径：`feat(desktop): launch and verify official account login`。

T4 自动验证：Go 登录／账号／桌面管理相关 race 测试及 Go vet 通过；Node 24 下登录／账号／运行时共12项、TypeScript检查通过；Rust 授权协议和真实 typed invoke 共2项通过。Windows amd64测试程序交叉编译通过，未作Windows原生登录。独立审阅复现并修复最终凭证修订变化、目录链接切换／auto回退、候选失败发布、进程组回收时序、遗留子孙及可执行路径泄露；Windows先观察进程退出、清理Job再等待输出。Mac实际仅探测 Codex 0.162.1／Claude 2.1.153 的version/help，没有真实账号授权或流量。

## Task 5（S1-T5）：授权维护、换号与未知结果核对

**依赖：** T2/T3。**文件：** 新建 `agent/desktop_account_switch.go`、`desktop_account_switch_test.go`；修改 `agent/desktop_accounts.go`、`desktop_account_hive.go`、`accounts.go`、`authorization_workers.go`、`refresh.go`、`claude_refresh.go` 及相应既有测试。

**输入／输出：** `confirm_change` 消费持久 operation 与既有 Hive pending/confirmation_id；复用已有续期日记及并发写回。T3 worker 屏障守住 source/selection/credential revision；不发明 Hive 幂等接口。

- [x] 写调用账本与磁盘故障用例：同身份token更新不是换号；官方并发写入不被覆盖；Keychain不支持写回；换号暂停失败；pending变化；confirm成功但回包丢失/本地写失败；指纹相同代次不同；停止/重启后核对；另一平台不被堵住。
- [x] 运行 `go test ./agent -run 'TestDesktopAccountSwitch|Test.*Refresh|Test.*Confirm' -count=1`，新增危险分支先失败。
- [x] 实现持久阶段推进：暂停读回→核对来源/pending→同一confirmation_id提交→查询指纹/代次→提交本地修订→同步→保持暂停。未知响应只核对，不自动重复POST；中途换候选保留未决且拒绝恢复。原worker越过屏障后不得再提交旧授权。
- [x] 重跑上述测试及 `go test -race ./agent -run 'TestDesktopAccountSwitch|Test.*Synchronization|Test.*Refresh' -count=1`，验证真实HTTP副作用次数及续期回归。
- [x] 提交本任务路径：`feat(desktop): reconcile account changes and authorization maintenance`。

T5 验证：OpenAI／Claude 真实本机 HTTP／WS 调用账本覆盖确认丢包、代次／pending 变化、停止前置竞态、真实目录写权限失败、同身份 token 更新及管理服务重开；临时连接首次409不重试、禁止 relay、Close 等待回收通过。相关账号／运行时／续期／同步／双平台 Go race、Go vet 和12项 TS测试通过。审阅发现的停止后继续、确认后新 revision 卡住及 cleanup 状态孤儿均已有回归修复；复用既有续期并发写保护与 Keychain 能力限制，未修改 Hive。

## Task 6（S1-T6）：重启恢复、明确停止与退出交接

**依赖：** T3/T5。**文件：** 新建 `agent/desktop_runtime_recovery.go`、`desktop_runtime_recovery_test.go`、`desktop/src-tauri/src/runtime.rs`、`runtime_tests.rs`；修改 `cmd/bee/main.go`、`desktop/src-tauri/src/sidecar.rs`、`lifecycle.rs`、`lib.rs`、`sidecar_tests.rs`、`lifecycle_tests.rs`。

**输入／输出：** 实现 `Restore` 和 Rust `prepare_owned_exit`；S2复用停止/网络重启，S3复用完整退出receipt。用户停止保存不运行；正常退出保留此前意图但结束活动会话；异常上次退出必须明确恢复。

- [x] 写真实子进程/配置重开测试：首次不开启；正常重开核验后恢复；主动暂停/换号暂停/用户停止保持；损坏、401/403、撤销阻断；会话active/停止保存失败不自动重启；旧instance回执丢弃；外部Bee存活；本App子进程超时只能终止自己且必须wait/reap。
- [x] 运行 `go test ./agent -run 'TestDesktopRuntimeRecovery' -count=1` 和 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml runtime`，确认失败。
- [x] 接入启动恢复、冻结写动作和退出协议；等待本机worker不是等待Hive任务。保存失败仍回收但receipt如实；退出前不释放App单实例锁；子进程意外退出清除旧成功状态，禁止自动崩溃重启循环。
- [x] 重跑上述测试及 Rust `sidecar` / `lifecycle` 过滤测试；新增同一配置锁在进程退出后可被新进程取得的断言。
- [x] 提交本任务路径：`feat(desktop): preserve runtime intent and verify owned shutdown`。

T6 验证：Go Runtime／AccountSwitch／Supply 与桥、命令子进程 race 测试及 vet 通过；Rust runtime 8项、sidecar 23项和 lifecycle 5项通过，签名包专用项留 T8 原生构建后执行。真实子进程证明停止仍持有配置锁、退出后第二进程可取得；未配对停止、调用方取消、排队冻结、错误operation回执及外部进程存活均验证。独立审阅复现的停止意图被覆盖、历史异常会话被洗白、恢复预留前后保存失败均已有回归；独立 runtime-session 标记保护账号文件故障。首次一项Node启动100ms测试抖动，增加至400ms（仍短于800ms业务响应）后通过。

## Task 7（S1-T7）：把真实闭环接到原生账号及概览

**依赖：** T2–T6。**文件：** 新建上述两份 Native 组件；修改 `desktop/src/app/NativeApp.tsx`、`desktop/src/system/accounts.ts`、`desktop/src/system/lifecycle.ts`、`desktop/src/i18n/zh.ts`、`en.ts`、`desktop/tests/nativeAccounts.test.ts`、`native-accounts.spec.ts`、`desktop/playwright.device.config.ts`；新增 `desktop/tests/native-runtime.spec.ts`。

**输入／输出：** 消费同一运行/账号/供给快照；S2 接手应用级订阅前沿用现有协调点，不为每页创建runtime。S1便能独立操作开始、停止、登录、接入、换号；保留真实账号模型/额度，不新增收益或市场入口。

- [x] 写浏览器契约用例：管理ready但未运行；已选择待开始；开始两个平台部分成功；登录返回待核验；换号成功仍暂停；请求未知不可重提；旧instance/revision不覆盖；平台问题各自显示；未知额度不归零；退出提示可能中断任务。
- [x] 运行 `node --test desktop/tests/runtime.test.ts desktop/tests/authorize.test.ts desktop/tests/nativeAccounts.test.ts` 和 `npm --prefix desktop run test:device`，新页面用例必须被配置收集且先失败。
- [x] 实现真实动作、处理中/待核对状态和四层展示，禁止以永远disabled的按钮算交付；共享页面编辑由集成负责人串行进行。
- [x] 重跑上述命令及 `npm --prefix desktop run typecheck`、`npm --prefix desktop run build`；检查中英文、860×600键盘操作和错误证据脱敏。
- [x] 提交本任务路径：`feat(desktop): expose complete native account contribution flow`。

T7 验证：20项 Node 账号／设备／供给测试、29项完整浏览器用例及新增2项针对性用例、13项账号／运行／登录客户端测试通过；typecheck、构建及换号 Go race 通过。新增最小窗口英文键盘操作、确认未提交才允许继续；独立审阅发现的已完成登录清除后续来源编辑、写受理前来源可编辑均已回归修复并复核。未知写结果仍只允许核对，换号完成保持暂停。

## Task 8（S1-T8）：完整功能验收及交付证据

**依赖：** T1–T7。**文件：** 修改 `desktop/scripts/smoke-accounts.mjs`、`docs/desktop/ai-accounts.md`、`docs/desktop/bridge-protocol.md`；新增 `docs/desktop/account-runtime-validation.md`；所发现缺陷在所属Task路径修复，不以文档标记代替代码。

- [x] 跑 `go test ./...`、`go vet ./...`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`、`npm --prefix desktop run test:bridge`、`npm --prefix desktop run test:device`、`npm --prefix desktop run build`，只补受新变更影响的验证，不重复无关历史包。
- [ ] 用 `node desktop/scripts/build-bee.mjs` 构建当前主机内置Bee，按既有原生构建脚本启动；至少一套可用原生环境完成两平台登录/接入、真实Hive握手及受控贡献、暂停/恢复、换号、断网、退出/重启。真实账号/流量需已有明确授权；缺失时准备完整测试步骤，准确列为未完成验收，继续其他任务。
- [x] 在证据中记录源码、App/Bee版本、OS/架构、官方客户端版本、操作和结果；检验CLI配置及未授权官方来源无变动、无秘密进入前端/日志。当前主机通过不替代S3八组合。
- [x] 完成 `verification-before-completion`、`consistency-check`、`post-verification-check`；只有每项有证据才勾选，真实环境阻塞不能标“完整完成”。提交文档：`docs(desktop): record account runtime acceptance`。

最终整体审阅补修：运行快照中的较新账号修订现在同步到账号模型，打开确认弹窗期间的后台更新不再让提交长期使用旧修订；旧快照、来源编辑及未知写门禁仍受保护。失败回归（期望5／实际3）、完整33项浏览器通过及独立专项复核记录在验收证据中。

T8 自动与隔离验证：Go 7包／vet、Rust 68项及打包后2项签名包专项、10项桥接、最终20项 Node／33项浏览器、13项 typed客户端、typecheck／构建均通过。当前 `636daa4` 已构建 macOS arm64 ad-hoc 开发包；包内18项能力、首次恢复保持停止、完整停止回执、子进程回收及 CLI／官方来源 canary 未变通过。真实官方登录及实际 Hive／上游流量仍无明确授权测试环境，保留 T4 和 T8 两项真实验收复选框；可复现步骤已记录，不把缺口转成 S2 待办。

| Spec验收 | 实施／证明 |
| --- | --- |
| R1 检测选择及保存 | T1/T2/T7/T8 |
| R2 真实贡献及归属 | T3/T6/T7/T8 |
| R3 两平台官方登录 | T4/T7/T8 |
| R4 维护与换号 | T5/T7/T8 |
| R5 断网/重启/停止退出 | T3/T5/T6/T8 |
| R6 真实展示及无秘密 | T1/T3/T7/T8 |

完成后用户应能实际接入并贡献，而非只有可查看账号。S2补体验，S3补正式安装更新及目标平台证据；不得把本计划的核心功能改称下一批依赖。
