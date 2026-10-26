# Bee 桌面 AI 账号管理实施计划

> **执行要求：** 使用 `subagent-driven-development` 或 `executing-plans` 逐任务实施，步骤用复选框跟踪。沿用相邻决策记录中例行确认自动处理并继续推进的授权；本次整份 spec 已由用户明确批准。新选型、扩大权限或 Hive 改造仍先更新 spec 并集中确认。

**目标：** 将原生账号页接通真实、只读的官方来源与 Hive 账号观察，准确显示身份、授权、额度、模型和功能依赖；为后续接入与运行管理保留完整验收边界。

**架构：** Go 负责读取官方来源、官方查询、Hive 查询和公开快照；Rust 只转发固定命令；React 展示同源快照并复用既有供给控制。可执行任务只覆盖当前有真实依赖的能力，运行管理尚未提供证据的接入／换号／撤销和完整移除不发送写请求。

**技术栈：** Go 1.27.3；Tauri 2.12.5、tauri-build 2.7.4、Rust 1.94（crate 最低 1.90）；React 19.2.8、TS 7.0.2、Vite 8.2.4；Node 24.22.1、Playwright 1.63.0；既有 Radix/Lucide/Tailwind、受保护文件、锁与原子替换。无新增依赖。

**依据：** [已批准 spec](../specs/2026-10-26-desktop-ai-accounts-design.md)、[决策记录](../specs/2026-10-26-desktop-ai-accounts-design-decision-trace.md)。工作目录 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`，分支 `feat/bee-desktop-p0`，起始 HEAD `cdf987c`，产品基线 `24aca16`，Hive 只读检查点 `a8e4e874`。以下文件路径均相对此 worktree。

## 全局约束

- 不改 Hive 源码、数据库或子模块；不覆盖 CLI、桌面设备配置或官方登录；不自动停止／接管外部 Bee。测试使用合成凭证与本地服务。
- OpenAI／Claude 两个平台，每个平台最多一个当前选择。候选、本地选择、Hive 已接入、真实运行和平台暂停分开表达；`paused=false` 不代表贡献中。
- D1：用户点击后才读取新来源；进入页面仅读取公开快照和默认路径，不打开凭证。D2：换号及同步成功后仍保持暂停，用户明确恢复。
- 来源目录只接受 null 或非空绝对路径，不超过 4096 UTF-8 字节，拒绝控制字符；固定文件名／Keychain 算法，不接受凭证正文、任意 URL／Shell。OpenAI 和 Claude 使用各自目录规则。
- 秘密只留 Go；公开 DTO、错误、日志、文件和前端不含 token、JWT、原始 API 正文、邮箱、confirmation_id 或连接 lease。返回公开指纹和受控套餐名，不编造名称。
- 快速操作共用 Go 12 秒总期限、桥 15 秒期限；官方观察也受同一 context 约束。禁止页面续期、写回官方来源或自动重放业务写入。
- 额度单位为百分比；100 以上原值可见，进度最多 100%，剩余最少 0；null/无效不变成 0。使用全部适用窗口，观察间隔 5 分钟、有效期 6 分钟、元数据缓存 5 小时，服从 retry_at。
- Hive account/capabilities/account 夹读核对指纹、generation、credential_revision；变化使整组未确认。Hive 读取的 unknown/失效原因不套报告入参校验器。
- 供给查询串行、成功后 10 秒刷新；超过 30 秒、核对中或失败时禁用旧状态写入。全部操作逐平台反馈，一个失败不回滚另一个、不掩盖部分结果。
- 界面沿用中英文、键盘／焦点、860×600 和深浅主题；生产构建与 demo 隔离。未验收 OS 不标通过，旧 P0/P1 缺口不自动关闭。

## 本批交付边界与后续依赖

管理 sidecar 的 ready/owned 只证明管理通信，不能证明贡献运行归属。当前没有桌面来源切换屏障、账号同步结果或“从未被运行使用”的可靠证明。因此本批不开放首次接入、换号确认或撤销本地选择；它们缺少的条件在下表保留，不能用 mock 通过当作产品能力。

| 功能 | 本批可执行交付 | 仍未完成的验收／开放条件 |
| --- | --- | --- |
| A01/A02 | 两平台卡片、手动来源、真实检测和公开状态 | 三端 Keychain／文件的原生证据逐端记录 |
| A03 | 说明官方授权适配未开放，用户可在官方客户端登录后重新检测 | 核验平台流程、应用身份、权限、完成检测与取消后修订 spec；不猜 OAuth |
| A04 | 候选核对和接入依赖提示，接入调用在任何副作用前拒绝 | 运行管理归属／未使用证据、prepared 持久记录、暂停确认、原子提交及读回 |
| A05 | 本地与官方身份、Hive 授权状态和恢复提示 | 运行期间续期、同步结果、官方客户端并发写回验证 |
| A06 | 官方候选／Hive 观测分别显示、完整额度与时效 | 真实账号与三端专项验收 |
| A07 | 账号模型、市场未知、当前接单条件独立显示 | 可信设备鉴权市场接口或获批桌面会话 |
| A08 | 与概览共用平台供给快照及控制，逐平台／全部反馈 | 账号变更未决和未来运行约束接入同一控制门禁 |
| A09 | Hive 当前／候选状态只读展示，拒绝虚构或接管确认 | owned 运行报告候选与同步、来源切换屏障、持久确认恢复；完成后仍暂停 |
| A10 | 完整移除能力未满足时拒绝且零副作用 | 实际停止新任务、在途收尾、凭证解除；本地撤销也须证明从未使用 |
| A11 | 应用内问题提醒与去重、恢复后再次提醒 | 全局系统通知及 OS 权限接入 |
| A12 | 重启不把历史／候选冒充已接入；持久通知去重 | 接入选择、removed 和未决操作的恢复随运行管理批次实现 |

本批 Task 全部通过只表示此表的可执行交付完成，不表示 A01–A12 全模块完成。后续依赖不能变成无条件执行步骤。

## 文件责任与共享契约

| 文件 | 责任 |
| --- | --- |
| `agent/desktop_accounts.go` | 服务生命周期、公开 DTO、进程内候选与快照、操作能力门禁 |
| `agent/desktop_account_sources.go` | 默认来源、参数校验、两平台只读适配 |
| `agent/desktop_account_observation.go` | 显式官方查询、缓存／冷却、查询前后来源一致性 |
| `agent/desktop_account_hive.go` | 已绑定设备的 Hive 夹读、公开映射和独立失败 |
| `agent/desktop_account_state.go` | 独立 `ai-accounts.json` 的受保护通知去重记录；不预建未来写操作状态机 |
| `desktopbridge/accounts_test.go` 与现有 `protocol.go/server.go` | 固定方法、严格参数与业务错误封装 |
| `desktop/src-tauri/src/commands.rs`、`sidecar.rs`、`protocol.rs`、`lib.rs` | typed Tauri 命令、能力握手和 15 秒边界 |
| `desktop/src/system/accounts.ts` | 精确解码、实例与来源版本失效、typed 客户端 |
| `desktop/src/features/accounts/NativeAccountsPage.tsx`、`NativeAccountDetails.tsx` | 真实卡片、来源编辑、详情、操作依赖提示 |
| `desktop/src/features/supply/useSupply.ts` | 将既有 SupplyPanel 的状态与串行轮询提升为共享模型，不另存暂停事实 |

新建 Go 测试与责任文件相邻。候选只在当前管理实例内存在，来源编辑、重新检测或实例切换使旧引用失效。候选记录只留来源描述、公开身份、授权版本摘要和观察缓存；每次官方查询重新读取凭证并在完成后清理原始字节。

固定接口（以 `context.Context` 为首参，所有方法均返回公开结果和 `error`）：

```go
NewDesktopAccounts(device *DesktopDevice) *DesktopAccounts
(*DesktopAccounts).Defaults(ctx context.Context) (DesktopAccountDefaults, error)
(*DesktopAccounts).Detect(ctx context.Context, request DesktopAccountDetectRequest) (DesktopAccountSnapshot, error)
(*DesktopAccounts).Snapshot(ctx context.Context, platform string, refresh bool) (DesktopAccountSnapshot, error)
(*DesktopAccounts).Action(ctx context.Context, request DesktopAccountActionRequest) (DesktopAccountSnapshot, error)
```

- `DesktopAccountDetectRequest`：`platform`（openai/claude）、`directory`（显式 null 或绝对路径）、`store`（OpenAI auto/file/keyring；Claude file/keychain）、`mode`（local/official）。official 为用户明确“检查账号”；local 绝不发官方网络请求。
- `DesktopAccountActionRequest`：`platform`、`revision`（非负安全整数）、`candidate_ref`（当前 Go 返回的随机引用）、`action`（select/confirm_change/remove/clear_selection）、`confirmed`（必须显式 true）。本批全部返回具体依赖错误；不提供后台已实现的假象。
- `DesktopAccountDefaults`：`platforms` 两项，每项 `platform/directory/default_store/stores`，存储能力逐项含支持布尔与原因；返回不打开凭证。
- `DesktopAccountSnapshot`：`platform/revision/candidate/selection/hive/authorization/capabilities/features/issues/checked_at`。各子域带 `state/observed_at/error`；未观察时间为 null；未知数据为 null，列表为数组。Go 定义 JSON tags 后 TS 精确对应，不使用 demo `Account` 强制转换。
- 候选：`reference/source/fingerprint/plan/expires_at/identity_verified/observed_at`；Claude local 无可信指纹时为 null，不能显示已核验。选择本批为未选择；Hive 的现有注册账号仍能独立显示，不自动归入本地选择。
- 能力：`origin`（official/hive）、`status/observed_at/metadata_observed_at/valid_until/retry_at/plan/windows/models`。模型为 `id/account_supported/market_open/accepting`，后两项没有证据时为 null。
- 错误：受控 `code/check/platform/message` 及公开 `evidence`，包含本次系统退出码／HTTP 状态／字段实际类型；未知正文、未知套餐／状态字符串不回显，保持原因链的安全证据。
- `features` 显式列出 detect/check/select/confirm_change/remove/clear_selection/authorize/system_notifications 的可用性与原因；这是能力事实，不是交付完成标记。

## Task 1: 两平台只读检测与可信公开快照

**文件：** 新 `agent/desktop_accounts.go`、`desktop_account_sources.go`、对应 `_test.go`；必要时只对 `agent/claude.go`、`codex.go` 的公开诊断补充安全证据，保持 CLI 行为。

**接口：** 产出上述构造器、DTO、Defaults、Detect(local)、Snapshot(refresh=false) 和拒绝副作用的 Action；消费既有 `codexSource`、`resolveClaudeStore`、凭证解析器和套餐白名单。

- [ ] 写风险表与失败测试 `TestDesktopAccountsDefaults`、`TestDesktopAccountsDetect`、`TestDesktopAccountsBlockedActions`；默认路径不读凭证、不联网、不创建账号文件；两平台有效／缺失／过期／权限拒绝／损坏／不支持；relative/control/4096/4097 字节、null 与空串、NFC 和命名空间；标记秘密不进入 DTO／错误／日志。
- [ ] 运行 `go test ./agent -run 'TestDesktopAccounts(Default|Detect|Blocked)' -count=1`，确认因新行为缺失失败。
- [ ] 实现检测：OpenAI 默认目录按 CODEX_HOME、用户目录选择；先显式 file，仅文件确实不存在且 macOS 才 keyring。不得直接调用现有 keyring 优先的 `codexSource{Store:"auto"}`；坏文件／权限拒绝／显式 store 不回退。Claude 保留自己的 namespace 规则。30 秒有效期边界、未知套餐和本地未核验身份准确表达。
- [ ] 实现实例内修订与候选引用；各平台隔离，重复检测废弃该平台旧引用与旧能力显示；身份及凭证版本未变时可复用 Task 2 的有效观察缓存，不能重写其观察时间。保存来源描述而非 token。Action 校验参数及引用后报告运行管理／解除依赖，证明任何被拒绝动作都不发 Hive 写、不落选择、不调用 setup/start。
- [ ] 运行前述测试及 `go test -race ./agent -run 'TestDesktopAccounts|TestCodex|TestClaudeStore' -count=1`，检查旧读取器回归；自检、任务审查并提交本任务。

## Task 2: 官方身份与额度观察

**文件：** 新 `agent/desktop_account_observation.go`、`desktop_account_observation_test.go`；扩展 Task 1 服务；必要时修改 `agent/claude_profile.go` 及对应测试，保留原调用接口。

**接口：** Detect(official) 使用同一来源输入；Snapshot 不触发官方查询。复用 `queryClaudeProfile`、`capabilitySource.observe`、`claudeCapabilitySource.observe`，只注入测试 transport/时钟，不开放 URL 或代理参数。

- [ ] 写失败测试 `TestDesktopAccountsOfficial`：Claude profile 才能确定指纹；OpenAI 本地验证与官方观察区分；查询前后换号／同号换 token 废弃结果；过期／scope 缺失不联网；原始文件字节／mtime 不变，未调用刷新接口。
- [ ] 写缓存与额度矩阵：5 分钟内复用、6 分钟过期、5 小时元数据刷新、429 与 retry_at、reset 过期、null、99/100/120%、单窗／双窗／Claude 专属窗口；人工核算 120% 显示原值、剩余 0；对照 `beewire/capabilities_test.go` 和 `agent/testdata/claude-usage-2026-10-11.json`。
- [ ] 运行 `go test ./agent -run 'TestDesktopAccountsOfficial' -count=1` 验证红灯；实现固定端点观察和每来源／指纹／凭证版本缓存。保留原 observed_at，不以重复读取刷新历史数据时效；失败不清除其他子域真实结果；错误呈现具体 HTTP／字段证据且不泄密。
- [ ] 运行 `go test -race ./agent -run 'TestDesktopAccountsOfficial|TestClaudeProfile|TestClaudeCapabilit|TestCodexCapabilit|TestOpenAI' -count=1`；检查确实执行目标测试，必要时按现存测试名补命令；自检、任务审查并提交。

## Task 3: Hive 账号夹读与持久提醒

**文件：** 新 `agent/desktop_account_hive.go`、`desktop_account_state.go` 及对应测试；必要时从 `desktop_supply.go` 抽取绑定纯核验供两路径复用，不改配对语义。

**接口：** Snapshot(refresh=true) 仅刷新 Hive GET，未绑定时保留本地检测；消费已绑定 `DesktopDevice`、`desktopCall` 和 `beewire.PlatformAccount/Capabilities`。固定查询 `/api/bee/identity`、`/api/bee/platforms/{platform}/account`、`/api/bee/platforms/{platform}/capabilities`。状态文件位于设备配置同目录 `ai-accounts.json`，版本 1，本批仅保存已验证归属下的通知去重状态；去重键严格为 Hive/owner/platform/指纹/问题类型，设备只作为归属核验字段。未来账号选择另按 Hive/owner/device/platform 隔离。

- [ ] 写失败测试 `TestDesktopAccountsHive`：未绑定可检测；撤销／owner-device-Hive 不匹配拒绝；account→capabilities→account 变化（指纹、generation、credential_revision 任一）整组未确认；confirmation_id 标记不外泄；unknown、quota_exhausted、rate_limited 与陈旧能力按 Hive 读取语义展示。
- [ ] 写失败测试 `TestDesktopAccountsState`：无文件、私密权限、symlink、未知版本／重复 JSON 字段、损坏不覆盖、原子写与读回失败；账号文件不会改设备／CLI／官方文件。`TestDesktopAccountsIssues` 覆盖 59/60 秒持续离线、反复刷新去重、恢复后复发、重启、归属／指纹隔离、无指纹时不合并为另一个账号。
- [ ] 运行 `go test ./agent -run 'TestDesktopAccounts(Hive|State|Issues)' -count=1` 验证红灯；实现夹读与各部分时间／失败。只映射受控公开字段，市场开放始终未知；未匹配本地选择不得显示已接入／桌面 owned。
- [ ] 实现受保护文件与提醒记录：沿用 `openRegularNoFollow/validatePrivateFile/writePrivateFile/lockState`，带版本及预期修订、原子替换后读回；固定设备配置→账号文件锁顺序，禁止嵌套调用再次获取同锁。写失败保留页面问题、提示去重存储未确认，不静默宣称持久化。只按明确恢复证据解除去重，读取失败不能当恢复。
- [ ] 运行 `go test -race ./agent -run 'TestDesktopAccounts|TestDesktop(Device|Supply)' -count=1`；自检、任务审查并提交。

## Task 4: Go 私有桥与 Rust typed 命令

**文件：** `desktopbridge/protocol.go/server.go`、新 `desktopbridge/accounts_test.go`、`cmd/bee/main.go`；`desktop/src-tauri/src/{commands,lib,protocol,protocol_tests,sidecar,sidecar_tests}.rs`、`desktop/tests/fixtures/bridge-child.mjs`。

**接口：** `account_defaults {}`、`account_detect {platform,directory,store,mode}`、`account_snapshot {platform,refresh}`、`account_action {platform,revision,candidate_ref,action,confirmed}`。成功分别 `result.defaults` 或 `result.account`；业务错误 `result.error`，代码 `ACCOUNT_OPERATION_FAILED`。保留现有 `RunWithDevices` 和旧能力组，可增加仅服务端注入 accounts 的运行函数；`cmd/bee` 明确构造同一设备实例与账号服务。

- [ ] Go 参数红灯：未知／重复／缺失／null／错类型、平台-store 组合、显式 false、超长路径和过时引用；业务失败后 ping 仍可用；旧设备／供给调用及旧能力组兼容。
- [ ] Rust 用真实 fixture 验证新增四命令的固定 method/params、请求期限、实例变化、出错后拒绝迟到结果；新完整能力组为现有六项后追加上述四项，不接受任意子集／额外方法。
- [ ] 实现 Go 严格参数解码与结构化分发；Rust 只接受 typed 参数，禁止扩大 generic `bridge_request`；Go 再校验一次。路径／引用与错误值不进入底层 shell 参数，不扩展权限或开放 arbitrary URL。
- [ ] 运行 `go test ./desktopbridge ./cmd/bee`；重建 native sidecar 后运行 `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml` 的相关协议／sidecar 测试；自检、任务审查并提交。

## Task 5: 真实账号页、详情与共享供给状态

**文件：** 新 `desktop/src/system/accounts.ts`、`desktop/src/features/accounts/NativeAccountsPage.tsx`、`NativeAccountDetails.tsx`、`desktop/src/features/supply/useSupply.ts`；更新 `SupplyPanel.tsx`、`NativeApp.tsx/main.tsx`、词典和必要 CSS；新 `desktop/tests/nativeAccounts.test.ts/native-accounts.spec.ts`，更新 supply 测试、`playwright.device.config.ts`、`package.json`。

**接口：** `AccountClient.defaults()/detect(request)/snapshot(platform,refresh)/action(request)` 与 Task 4 一一对应。NativeWorkspace 创建一份账号／供给状态模型并传给概览和账号页；切页不重建两套暂停状态，不因页面轮询调用 detect。保持 demo 页面和 client 的隔离。

- [ ] typed 客户端红灯覆盖全部响应字段、来源／归属／时间／百分比的错误值、未知键、实例变化／来源编辑／旧 Promise；敏感标记在测试返回中必须被拒绝或不进入公开视图，不能靠 `as Account` 绕过校验。
- [ ] 原生页面 fixture 红灯：首次进入只有 defaults/snapshot；点击后检测；高级来源 null/自定义、权限拒绝和官方未核验；Hive 离线不遮盖本地候选；刷新只是安全 GET；单／双／专属额度窗、120%、null、旧数据标记、市场未知、受限按钮原因和两平台独立失败。
- [ ] 实现原生卡片与详情复用既有视觉组件，当前／候选分别显示；接入、换号、移除和官方授权显示真实依赖，不能调用 demo 成功路径。提醒显示平台和问题，系统通知未开放且不弹 OS 授权。
- [ ] 将现有 SupplyPanel 状态上移：共用客户端、快照、busy/error 和串行轮询；页面显示作用范围、暂停不结束在途、恢复不启动运行；全部暂停／恢复逐项执行并保留每项结果，未知写结果只提供 GET 核对。账号未决门禁由同一模型提供，不能只禁账号页按钮。
- [ ] 运行 `node --test desktop/tests/nativeAccounts.test.ts desktop/tests/supply.test.ts`；在 `desktop` 运行 `npm run typecheck`、`npm run build`、`npm run build:demo`、`npm run test:device`；增加 native-accounts.spec.ts 到该脚本的 Playwright 集合。测试中英文、860×600、深浅主题、Tab/Escape/焦点返回、demo 不调用真实桥；自检、任务审查并提交。

## Task 6: 回归、证据与本批交付说明

**文件：** 新 `docs/desktop/ai-accounts.md`；同步 `docs/desktop/bridge-protocol.md`、`README.md`、本 plan；证据写 `docs/desktop/evidence/2026-10-26-ai-accounts/`。不把功能依赖勾成完成。

- [ ] 运行 Go 全量及 vet、TS 类型／构建／相关原生与 demo 页面、Rust 相关与既有桥回归；记录实际工具版本、源码和测试命令。验证使用已准备的 TEE 缓存；缺工具先处理，不能把未运行记为通过。
- [ ] 执行完整行为路径 final review（`affected-path-review`）；修复发现的问题并只补跑受影响验证，再走 `verification-before-completion`、`consistency-check`、`post-verification-check`。任务审查不代替本轮完整路径审查。
- [ ] 构建匹配当前源码的本机包并校验来源、签名、包内只读 defaults/snapshot；真实来源读取须用户点击，自动冒烟不读用户凭证。原生手工验证和其他 OS 可用环境分别记录；未取得证据明确未验收，不沿用旧包截图冒充。
- [ ] 写白话步骤：打开账号页→选择平台和来源→点击检测→按需检查账号→阅读本地／官方／Hive 三种事实；列明不能接入／贡献／换号／移除的具体依赖及下一步。保留现有分支和 worktree，不发布。
- [ ] 对照 A01–A12 更新本批覆盖矩阵和阻塞项，提交本批代码与证据，说明下一项是运行管理 spec 与其所需事实调查；只有本批 Task 全通过才勾完本 plan。

## 后续批次的进入条件（非本批执行任务）

1. **接入、运行同步与换号：** 先细化并批准运行管理 spec，给出 owned／external／unknown 证据、从未使用／停止且无同步的证明、来源切换屏障和只消费已核验修订号的运行入口。随后实施选择／removed／prepared 记录、暂停读回、同步与原操作核对。暂停或换号响应丢失不得重发；服务端已切换但本地失败保持暂停；同指纹但 generation 不符仍未确认。未满足前不编写假运行适配器开放按钮。
2. **官方授权：** 核验两平台实际首次授权、权限、存储、回调／完成检测、取消／过期和三端共存；真实适配产生新选型时先更新 spec，不能冒用官方应用身份。
3. **完整移除：** 需可验证的停止准入、在途收尾、凭证解除与查询原操作能力，才实施 prepared/quiescing/draining/detaching/completed/uncertain；paused/source-unavailable 不能替代。涉及 Hive 改造仍单独集中确认。
4. **逐模型市场与系统通知：** 分别等待设备鉴权可信读取接口、全局通知及 OS 权限；当前账户支持不推导市场开放，应用内提醒不冒充系统通知。
5. **真实联网：** 409/EOF/TLS 故障独立诊断复测，不放松身份／业务验证。真实官方登录／账号操作验收时，先交代工具、测试平台和可能的权限提示，不索要密码、验证码或 token。

## 计划自检

本 plan 以任务、接口、风险矩阵和验证命令落实已批准设计，不预写实现代码。任务之间的 DTO 只在共享契约定义一次；全部 A01–A12 均映射到本批或明确依赖，不通过砍需求宣称完整交付。尚未执行产品测试、尚无任务勾选。

计划文档一致性检查（2026-10-26）：

| 维度 | 结果 |
| --- | --- |
| 对话 | ✅ 已批准 spec、自动推进约定、不改 Hive、D1/D2 均沿用；未复活此前暂缓的后端方案。 |
| 文内 | ✅ 六任务与共享契约一致；本批完成与 A01–A12 完整交付分开；所有依赖保留。 |
| 跨文档 | ✅ spec、相邻 trace、外层备忘同步批准状态；无产品实现、PR 或接口调用方修改，实施传播检查留任务验证。 |
| 配置 | ✅ 版本与 go.mod/package.json/Cargo.toml 相符；Node 24.22.1 已安装，可显式选择；无新增环境变量、依赖或权限。 |
| 文档／源码 | ✅ 核对实际读取器、profile、额度、Hive 夹读接口、桥与原生页面；23 个 spec/plan 本地链接存在，无占位文本。 |

结论：计划文档可执行；完整账号功能仍有表列依赖，产品及三端验收均未据此宣称通过。
