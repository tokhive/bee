# Bee 桌面：诊断、网络与日常体验实施计划（S2）

> **执行状态（2026-10-27）：** 用户将另开会话并行实施 S2，原会话仅负责 S1；不再等待 S1 整份结束才开始。使用独立分支及工作树，基于包含 S1 已提交基础的 `feat/bee-desktop-p0`（此次调整时为 `6dd2f4b`）；原工作树尚未提交的 S1-T5 不在该基础内。按下列 Task 依赖开发，集成时同步 S1 后续提交；复选框只记录有验证证据的完成项。

**目标：** 完整交付E1–E6：四页原生导航、真实诊断、日志/脱敏导出、HTTP代理、偏好、通知、自启及窗口找回。

**架构：** 消费S1唯一真实运行状态和停止入口；Go复用doctor及网络核心，Rust负责本机偏好和OS适配，React用应用级协调器统一订阅。普通偏好与设备凭证、账号状态分开，不搬用demo存储。

**技术栈：** 沿用Go 1.27.3、Tauri 2.12.5、tauri-build 2.7.4、Rust 1.94（最低1.90）、React 19.2.8、TS 7.0.2、Vite 8.2.4、Node24、Playwright1.63.0。新增Rust `tauri-plugin-notification = "=2.7.0"`、`tauri-plugin-autostart = "=2.7.0"`，固定Cargo.lock；仅Rust封装，无需新增前端插件权限。

**依据：** [已批准S2 spec](../specs/2026-10-26-desktop-diagnostics-experience-design.md)、[S1计划及公共契约](2026-10-26-desktop-account-runtime.md)、[S3更新计划](2026-10-26-desktop-release-update.md)。2026-10-26只读核对crates.io两插件索引，均要求Tauri `^2.12`、Rust1.90；声明范围兼容现有版本，实际构建在T2验证，不升级框架。

## 全局约束和依赖

- Bee只管AI账号/贡献；无Hive用户登录、资金、市场、Hive改造；“打开Hive”仅当前保存canonical origin的根地址。四页为概览、AI账号、诊断、设置。
- 代理仅空值或无认证回环IP HTTP地址；Hive及官方客户端登录网络不由它控制。`HTTPS_PROXY`/`https_proxy`/`NO_PROXY`现有优先级保留；显示实际路径，不回显环境原文。
- 默认语言/主题跟随系统，自启关闭；通知开关与系统权限分开。关窗后台运行，明确退出仅回收owned Bee，不承诺任务排空。保持银白精工、中英文、860×600。
- 每Task先执行所列新增失败用例，再实现并复跑至通过；迁移、秘密、代理重启使用`high-stakes-implementation-testing`；错误保留失败环节和公开证据。所有命令从Bee工作树根执行。
- 按S1计划的最新会话分工执行：T1/T2可在S1-T1后独立开展；T3已有S1-T3基础，T4真实重启接通需S1-T6；T5主页面整合需S1-T7，T6为完整验收。S2版本展示先用现有桥，S3更新不是S2前置条件。S1运行／恢复／退出实现由S1维护；本会话消费接口，不复制状态机。共用注册点、生命周期和锁文件在独立工作树开发后逐项合并，不覆盖其他会话代码。

## 文件职责及跨任务契约

| 文件 | 责任 |
| --- | --- |
| `desktop/src-tauri/src/preferences.rs` / `preferences_tests.rs` | T1：当前OS用户普通偏好、受保护版本文件和代理草稿 |
| `desktop/src-tauri/src/notifications.rs` / `autostart.rs` / `notifications_tests.rs` / `autostart_tests.rs` | T2：OS权限、去重发送、实际启动登记 |
| `agent/desktop_diagnostics.go`、`desktopbridge/diagnostics.go` | T3：脱离CLI全局日志器的真实检查 |
| `desktop/src-tauri/src/diagnostic_log.rs`、`desktop/src/system/diagnostics.ts` | T3：白名单日志、分页、报告契约 |
| `agent/desktop_network.go`、`desktopbridge/network.go`、`desktop/src/system/network.ts` | T4：代理校验、路径测试、修订和重启应用 |
| `desktop/src/system/desktopState.ts`、`features/diagnostics/NativeDiagnosticsPage.tsx`、`features/settings/NativeSettingsPage.tsx` | T5：一个应用级协调器及原生页面 |

| 契约 | 类型、生产者与消费者 |
| --- | --- |
| `DesktopPreferences` | T1：`version:1, revision:number, language:system/zh/en, theme:system/light/dark, notifications_enabled:bool, autostart_desired:bool, proxies:ProxyPreference[]`；每个proxy为`origin:string, device_scope:string|null, connect_proxy:string`，null仅未配对草稿；不存设备凭证 |
| 偏好操作 | Rust `preferences_read() -> PreferencesSnapshot` / `preferences_save({expected_revision,preferences}) -> PreferencesSnapshot`；snapshot含已保存值和安全错误，不将OS登记状态冒充偏好；T5消费 |
| OS操作 | `notification_permission() -> granted/denied/prompt`；`notification_enable() -> permission`仅用户触发；`autostart_set({enabled:bool}) -> AutostartSnapshot` / `autostart_status()`，snapshot含desired/registered/error；T2生产，T5消费 |
| `DesktopDiagnosticReport` | T3：`id, instance, run_id, network_revision, started_at, finished_at|null, state:running/completed/cancelled, checks:DiagnosticCheck[]`；check为`id, platform|null, status:pass/warning/fail/skipped, observed_at, code, evidence:Record<string,string>, next_action`；next_action仅页内导航枚举，不是任意命令 |
| 诊断动作 | `diagnostics_start()`返回report；`diagnostics_snapshot({id})`及`diagnostics_cancel({id})`返回已有结果；不因切页重跑；检查入口接受S1可信会话/选择/网络，不接受任意配置路径 |
| 日志/导出 | `diagnostic_logs({cursor:null|string,limit:1..200,module:null|string,platform:null|Platform,level:null|string})`返回`entries,next_cursor,truncated`；`diagnostics_export({report_id,include_logs:bool})`返回白名单报告，由现有download完成回执确认保存；报告最多5MiB，截断显式说明 |
| 网络 | `NetworkSnapshot={saved_revision,effective_revision,saved_proxy,effective_proxy,paths,pending_restart,error}`；paths分别为relay/official/hive/official_login安全摘要；`network_test({proxy})`只测试本机代理及固定官方只读端点，`network_apply_saved()`仅经明确停止重启确认调用；T4生产，T5消费 |
| 应用级状态 | TS `createDesktopState(deps): {subscribe(listener):()=>void; refresh():Promise<void>; dispose():void}`；deps为现有桥/账号/供给client及S1 runtime client，公开值为现有快照组合，不复制运行状态机。T5接管页级轮询，通知调度位于Rust/Go后台，不依赖WebView是否持续计时 |

桥新增字段需同S1在Go/Rust/TS严格校验，沿用instance、修订、时间与1MiB帧限制；大日志分页、报告分片或在Rust组装，不把5MiB报告塞进一帧。Go结构化日志进入专用诊断通道，stdout只传协议。

## Task 1（S2-T1）：普通偏好和代理草稿持久化

**依赖：** S1-T1确认scope/版本规则。**文件：** 新建上述preferences模块、`desktop/src/system/preferences.ts`、`desktop/tests/preferences.test.ts`；修改Rust注册点。普通配置位于现有用户配置目录的`desktop-preferences.json`，不放安装目录。

**输出：** preferences_read/save契约；新文件默认值与spec一致；升级备份和原子替换策略供S3使用，不读demo localStorage。

- [ ] 写失败用例：首次默认、保存回读、重启、修订冲突、损坏/未知版本/重复键/文件权限、原子替换失败保留原件；origin/设备隔离，未配对代理草稿配对后核验关联、不复制其他device设置；秘密字段一律拒绝。
- [ ] 运行 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml preferences` 和 `node --test desktop/tests/preferences.test.ts`，确认预期失败。
- [ ] 实现版本文件、保护/备份和原子读写；偏好schema为上述version1；OS实际状态单独查询，不能保存成功就宣称自启注册成功。
- [ ] 重跑测试；检查任何失败均保留上次已保存值，S3可在无设备配对时迁移普通偏好。
- [ ] 提交本任务路径：`feat(desktop): persist native preferences and scoped proxy drafts`。

## Task 2（S2-T2）：系统通知与当前用户自启适配

**依赖：** T1；真实问题接线在T5，不因此推迟OS适配。**文件：** 新建上述notification/autostart模块；修改 `desktop/src-tauri/Cargo.toml`、`Cargo.lock`、`capabilities/default.json`、`src/lib.rs`、`src/lifecycle.rs`；新增 `desktop/tests/notifications.test.ts`，修改 `agent/desktop_account_state.go` 的通知送达字段时由S1负责人整合。

**输入／输出：** 固定版本插件；Rust内部通知只接收平台/问题/处理页枚举。沿用已有问题首次出现/恢复及持续离线阈值，将“应用内已提醒”与“OS提交已接受”独立记录；无法证明用户看见时不声称已读。

- [ ] 写适配器用例：明确启用才请求权限；拒绝/关闭只保留应用内提醒；同一问题切页/重开/进程恢复不重复；发送失败不记成功、不持续重试；问题恢复后再出现可提醒；点击仅导航；自启登记失败/查询失败不假报成功。
- [ ] 运行 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml notifications`、同命令过滤`autostart`，以及 `node --test desktop/tests/notifications.test.ts`，确认失败。
- [ ] 加入精确插件版本并由单一负责人更新锁文件；实现当前用户自启及后台启动标志、OS权限查询和固定通知。Tauri capability不授予前端任意shell/fs/通知正文；无管理员或系统服务。
- [ ] 重跑测试及 `cargo check --locked --manifest-path desktop/src-tauri/Cargo.toml`；本机验证允许/拒绝通知、自启登记及关闭；托盘不可用时显窗，启动只调用S1恢复规则。
- [ ] 提交本任务路径：`feat(desktop): add native notifications and user autostart`。

## Task 3（S2-T3）：真实诊断、滚动日志与脱敏导出

**依赖：** S1-T3真实状态；可先提取纯检查和日志测试。**文件：** 新建上述diagnostics/log模块及 `agent/desktop_diagnostics_test.go`、`desktopbridge/diagnostics_test.go`、`desktop/src-tauri/src/diagnostic_log_tests.rs`、`desktop/tests/diagnostics.test.ts`；修改 `agent/doctor.go` / `doctor_test.go`、`desktop/src-tauri/src/diagnostics.rs`、`desktop/src/features/diagnostics/report.ts`、共享协议/命令注册点。

**输入／输出：** doctor检查消费S1共享会话/选择，不读取默认bee.json；复用现有download完成回调输出正式名称报告。日志每份5MiB、最多3份；白名单事件含时间/级别/模块/平台/公开码及安全证据。

- [ ] 写HTTP账本用例：诊断只读，无配对/续期/暂停/同步/启动写入；运行中不重取配置锁；未选来源不读；DNS/TLS/401/409/限流、取消/超时保留部分检查；CLI全局logger不被桌面修改。
- [ ] 写日志/报告用例：标记Authorization/Cookie/token/confirmation_id/完整指纹/个人路径及模型输入输出经过普通错误和stderr仍不可见；轮转边界、分页/报告上限、真实下载成功/取消/失败、未知检查不变通过。
- [ ] 运行 `go test ./agent ./desktopbridge -run 'Test.*Doctor|TestDesktopDiagnostics' -count=1`、Rust过滤`diagnostic_log`、`node --test desktop/tests/diagnostics.test.ts`，确认新增用例失败。
- [ ] 提取doctor纯检查，保留CLI包装行为；实现异步检查、结构化白名单日志、Rust分页/组装与下载确认。未经处理stderr仅用于管理故障，禁止直接导出；不新增上传入口。
- [ ] 重跑上述测试及 `go test -race ./agent ./desktopbridge`；验证原生导出实际产生可读且脱敏的文件，再提交：`feat(desktop): expose real diagnostics and bounded safe reports`。

## Task 4（S2-T4）：接通代理配置、路径验证和显式重启应用

**依赖：** T1、S1-T3/T6；保存普通偏好与生效必须分开。**文件：** 新建上述network模块及 `agent/desktop_network_test.go`、`desktopbridge/network_test.go`、`desktop/tests/network.test.ts`；修改 `agent/connect_proxy.go` / `connect_proxy_test.go`、`desktop_account_observation.go`、`desktop_accounts.go`、Rust runtime/commands集成点。

**输入／输出：** T1代理字段→核心 `localConnectProxy` → S1 `ConfigureNetwork`；官方查询/续期共用 `officialTransport`，运行relay使用同一已生效revision。保存时只更新saved，运行中保持effective直到明确重启。

- [ ] 用本地CONNECT代理、官方HTTP替身、Hive替身记录请求：空值、IPv4/IPv6回环合法；SOCKS/远程host/localhost非显式IP/认证/路径/查询/非法端口拒绝；环境代理优先和NO_PROXY生效；Hive及官方登录不被专用字段改写。
- [ ] 写修订与生命周期用例：保存失败/测试失败保留旧值；保存运行配置显示待重启；重启前确认中断；停止不可信则拒绝应用；暂停/未决换号保持；旧transport/cache结果不覆盖新revision；未配对草稿可做官方只读测试。
- [ ] 运行 `go test ./agent ./desktopbridge -run 'Test.*Proxy|TestDesktopNetwork' -count=1`、`node --test desktop/tests/network.test.ts`，确认失败。
- [ ] 实现测试与实际应用入口：停owned运行→核验停止→ConfigureNetwork→清理缓存→按保存意图核验恢复；不把重启当成恢复所有平台的新授权。供给新鲜读回与S1恢复规则一致。
- [ ] 重跑上述测试及 `go test -race ./agent -run 'TestDesktopNetwork|TestDesktopAccount' -count=1`；通过HTTP实际路径证明代理已接通，再提交：`feat(desktop): apply scoped loopback proxy with explicit restart`。

## Task 5（S2-T5）：应用级协调、四页体验及窗口找回

**依赖：** T1–T4、S1-T7。**文件：** 新建上述desktopState及两页组件、`desktop/tests/desktopState.test.ts`、`native-experience.spec.ts`；修改 `desktop/src/app/NativeApp.tsx`、`desktop/src/system/device.ts`、`bridge.ts`、`desktop/src-tauri/src/navigation.rs` / `commands.rs` / `lifecycle.rs`、i18n中英文、`desktop/playwright.device.config.ts`。若需拆分主页面只抽取本次职责，保留demo历史演示。

**输入／输出：** 唯一应用级快照协调，不重建runtime；Rust后台问题调度在窗口隐藏时继续，应用内与OS去重分别记录。安全外链由保存origin构造，不接受前端任意URL。

- [ ] 写原生路由模拟用例：切页不新增轮询/同步/通知；旧instance和network_revision丢弃；进入诊断不自动跑检查；设置保存反馈、系统语言/主题变化、关闭通知不关闭问题；四页无资金依赖；Hive链接只有正确origin根路径且无秘密。
- [ ] 写生命周期用例：托盘/Dock/任务栏/第二次启动找回同一窗口；Linux无托盘不会留下无法找回后台；自启不初次贡献、不解除暂停；退出停owned而外部Bee仍活着。
- [ ] 运行 `node --test desktop/tests/desktopState.test.ts desktop/tests/preferences.test.ts desktop/tests/diagnostics.test.ts desktop/tests/network.test.ts`、`npm --prefix desktop run test:device`，确认新native-experience用例收集且先失败。
- [ ] 完成四页、日志筛选、导出范围确认、代理saved/effective说明、OS权限/登记状态和版本展示；更新功能由S3接入，同步最小窗口和中英文。由集成负责人一次替换主页面协调点并删除旧重复轮询。
- [ ] 重跑上述测试、`npm --prefix desktop run typecheck`、`npm --prefix desktop run build`和Rust `lifecycle` / `navigation` 测试；提交：`feat(desktop): integrate native diagnostics and daily experience`。

## Task 6（S2-T6）：完整日常体验验收

**依赖：** T1–T5。**文件：** 新建 `docs/desktop/experience-validation.md`；修改 `docs/desktop/bridge-protocol.md`、`docs/desktop/ai-accounts.md`、`desktop/scripts/smoke-accounts.mjs`；新增 `desktop/scripts/smoke-experience.mjs`（复用已有原生fixture及证据格式）。

- [ ] 跑 `go test ./...`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`、`npm --prefix desktop run test:device`、`npm --prefix desktop run test:bridge`、`npm --prefix desktop run build`；沿用相同源码已有通过结果，只有新变更/失败才补跑。
- [ ] 在当前可用原生环境实际操作doctor、HTTP代理、日志查看/导出、语言主题重开、通知允许/拒绝、自启启停、关窗找回及退出；保存文件和系统登记独立检查，浏览器模拟不算OS证据。
- [ ] 记录E1–E6结果、源码/包/OS、未验证平台与所需步骤；S3复用仍有效的安装路径证据。缺平台不阻塞其他功能开发，但不能将未测项勾为完成。
- [ ] 执行 `verification-before-completion`、`consistency-check`、`post-verification-check`，提交：`docs(desktop): record diagnostics and experience acceptance`。

| Spec验收 | 实施／证明 |
| --- | --- |
| E1 四页及安全Hive入口 | T5/T6 |
| E2 真实诊断 | T3/T5/T6 |
| E3 日志和脱敏导出 | T3/T5/T6 |
| E4 HTTP代理实际路径 | T1/T4/T5/T6 |
| E5 偏好和系统状态 | T1/T2/T5/T6 |
| E6 后台通知/窗口/退出 | T2/T5/T6及S1-T6 |

完成后用户能自行查明常见不能贡献原因、调整网络、保存偏好并在后台使用Bee；doctor、代理、持久化与OS适配不能留成下一批。
