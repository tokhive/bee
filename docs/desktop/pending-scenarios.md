# 桌面端待确认场景

用于记录真实使用中发现、尚待用户确认的界面场景。记录不代表方案获批或功能已经实现；确认后再更新状态及处理结论。

## PENDING-001 · 启动时显示“正在读取 Bee…”

- 状态：方案已确认并实施；Bee／Hive 配套实现与隔离测试完成；部署、真实场景与原生窗口验收待闭合。
- 记录日期：2026-11-10（Asia/Shanghai）。
- 来源：用户测试 App 时提供的截图，并询问“正在读取 Bee 什么意思”。
- 页面：AI 账号。
- 证据：[原始截图](evidence/2026-11-10-startup-pending/bee-loading.png)。

### 已观察到的界面

- 页面主体显示“原生管理进程”和“正在读取 Bee…”，尚未显示账号卡片。
- 标题右侧显示“接入数量待确认”。
- 侧栏显示“尚未连接 Hive”和“贡献未启动或已中断”。
- 后续用户确认：App 持续停留在该页面数分钟，未进入账号页面。当时已明确存在长时间等待问题；后续诊断已确认恢复死循环，见下方结果。
- 本机只读检查：桌面进程已运行约 6 分钟；当次进程列表未发现该 App 的 Bee 后台子进程。此证据不能单独确定故障原因。

### 当前解释与问题

该提示表示桌面界面尚未取得本机 Bee 后台管理服务的就绪状态。本轮已通过正在运行的原生 App 的只读 `bridge_status`、`startup_status` 查询确认根因，见下方排查结果。

“原生管理进程”属于内部术语，“正在读取 Bee”没有明确说明正在做什么；侧栏信息也需核对是否把“尚未取得状态”表述成了确定的连接或贡献状态。

### 已确认的处理方式

2026-11-11 用户要求“实施”，确认默认自动连接管理后台、只读核对；安全且原运行意图有效时恢复，不能自动处理时显示具体阻塞与人工入口。采用紧凑“主标题＋一行真实子状态”，普通启动与故障恢复区分；10 秒慢提示，1／2／4 秒最多三次状态读取重试，一轮 60 秒，保留原生恢复 90 秒规则。

### 当前用户应对

- 旧版重启已实测无效，不再反复重启、修改凭证、删除配置或重新安装来试错。
- 新版核对并推进同一旧会话结束操作；Hive 尚未支持时明确要求先升级 Hive，仅保留“查看诊断”与本地导出。原任务排空中提供“继续恢复”，不换 ID 绕过未知。界面切页和查看详情不会触发恢复。
- 旧代隔离和退役证明已在隔离 Hive 中实现并提供配套补丁，尚未部署；真实账号仍未恢复。Hive 配套已在独立分支集成并完成跨进程隔离验证，下一步仍须部署验证，不将“管理已连接”解释为“服务已恢复”。

### 2026-11-10 排查结果：已确认恢复死循环

用户再次确认重启无效。当前原生 App 查询结果：

- `bridge_status.state = stopped`，后台已停止；并非仍在加载。
- `startup_status.state = blocked`，失败码 `OWNED_EXIT_UNCONFIRMED`。
- 自动恢复原始原因：`automatic recovery rejected: previous recovery guard is not clean; explicit start required`。
- 随后的停止检查失败：`stop cannot certify a prior unclean session: current_owner_proof=false; explicit start required`。
- 清理结果：`owned child cleanup=reaped; management unavailable until restart; startup remains blocked`。

因果链：上次运行遗留未确认干净的会话 → 自动恢复拒绝接管 → 启动失败清理无法证明旧会话已安全结束 → 结束本次管理子进程 → 需要显式恢复的入口随管理进程一起不可用 → 重启重复同一链路。

旧版界面还有独立错误：`NativeApp.tsx` 对所有未 ready 且没有 `native.error` 的情况都使用“正在读取 Bee…”；`stopped` 本身没有附带错误，业务启动错误在 `snapshot.startup.failure`，却被 `ready` 条件挡在页面之外。这解释了确定失败仍显示加载文案。

历史版源码定位：

- `agent/desktop_runtime_recovery.go`：`reserveRecoveryGuard` 拒绝自动接管旧保护记录。
- `agent/desktop_runtime.go`：停止流程不能为其他运行遗留的会话签发干净退出证明。
- `desktop/src-tauri/src/update_install.rs`：`verify_startup` 在恢复失败后调用清理。
- `desktop/src-tauri/src/runtime.rs`：`stop_failed_restore` 在停止未获确认后回收本次子进程。
- `desktop/src/app/NativeApp.tsx`：未 ready 状态的错误／加载展示分支。

已落实修复：停止后保留原始失败，以结构化只读检查在本次贡献副作用前拒绝旧脏会话，保留管理与诊断；符合资格的干净状态按原意图恢复。已提交后的失败仍走严格清理；暂停保持、未知结果不重放。后续已实现协议配套补丁，但尚未部署；最初脏保护诱因仍待查明。

本轮只读诊断未删除保护记录、未修改账号或设备配置、未发起贡献／接单写操作。尚未确认最初哪一次退出留下保护记录，不能把诱因猜测为用户强制退出。

### 确认与处理记录

- 处理方案：[启动阻塞与自动恢复方案](designs/2026-11-10-startup-recovery.md)，用户于 2026-11-11 明确要求实施，准入、记录、时间参数及尝试预算一并确认。
- 已交付紧凑启动状态、真实进度、安全分类、持久尝试、受控重连／重试、原操作核对与本地诊断；主预览新增 7 个场景并冻结历史。
- [实施与验收记录](evidence/2026-11-11-startup-recovery/README.md)：受控测试与打包通过；未执行真实账号恢复，隔离打包原生窗口及其他平台仍未验收。
- 继续保留本场景，直到远端证明依赖、真实场景验收和最初脏保护诱因有明确结论。实现落地不等于真实旧会话已恢复。

### 旧会话恢复配套实施（2026-11-11）

[补充设计](designs/2026-11-11-session-retirement.md)与[Hive 补丁](integrations/hive-session-retirement/README.md)已交付。先保存原结束请求，取得真实远端证明后才结束旧本地记录；普通 Restore 再次核验且保持暂停。73 项模拟 IPC 界面场景通过，新增 Hive 不支持与排空继续恢复分支；真实 PostgreSQL／HTTP 集成验证通过。后续已在 Hive 独立分支集成，真实 Rust → Go sidecar → Hive HTTP → PostgreSQL 五场景隔离验收通过（含恢复、丢失响应、中断再继续、冲突和退出竞争），见[联调摘要](evidence/2026-11-11-startup-recovery/native-hive-integration.txt)。真实部署、账号恢复及打包原生窗口仍待验收，保留此场景。

### 2026-11-12 · 设备重绑后的快照不一致（已修复）

用户已切换全新本地 Hive。原生窗口显示 `RUNTIME_REPLY_INVALID`，原因为 `startup progress operation differs from runtime operation`；本机后台已停止。日志中的启动记录先成功，随后旧凭证收到 401，设备重绑完成。全新 Hive 不会同时重置 Bee 本机状态。

隔离回归复现：重绑成功清空 `operation` 时仍保留旧 `startup_progress`；自动维护失败替换操作编号时也有同一缺口。修复提交 `72c6229` 在这两处同步结束旧进度；重绑结果未知或等待归属确认时保留原操作与进度，Rust 的严格校验继续拒绝不一致快照。

- 红测试：重绑完成后的旧进度残留、自动维护新操作携带旧进度，均在修复前失败。
- Go：`go vet ./agent ./desktopbridge` 与 `go test -race ./agent ./desktopbridge -run 'Test(DeviceRecovery|DesktopAutoService|DesktopRuntime|DesktopPresence|DesktopNative|Runtime)' -count=1 -timeout=600s` 通过（26.754 秒／1.511 秒）。
- Rust：`cargo +1.94 test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --lib runtime_protocol::tests::`，8 项通过，覆盖旧编号／空操作拒绝及合法快照接受。
- 本机开发包：由干净提交 `72c6229` 重建 sidecar 和 `Bee S1 Dev.app`；TypeScript／Vite 构建、ad-hoc 签名与 `codesign --verify --deep --strict` 通过，包内 Go 来源为该提交，`vcs.modified=false`。
- 原生窗口：重开修复包后确认 Hive 已连接、设备已绑定，启动记录为 `succeeded`；AI 账号页可打开，无该协议错误，当前 0 个账号接入。OpenAI 本机凭证缺失、Claude 登录待处理，属于后续账号接入状态。

本轮没有在真实设备上再次重绑或代用户登录；重绑的成功、结果未知与归属待确认路径由合成 Hive／临时目录测试覆盖。本次窗口检查不替代旧脏会话恢复及其他平台验收。
