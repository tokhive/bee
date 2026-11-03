# Claude 官方登录修复与行内反馈实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `executing-plans` 按任务执行；需要委派独立任务时使用 `subagent-driven-development`。步骤使用 checkbox 跟踪。

**Goal:** Claude 的无效旧登录可通过官方客户端重新登录，用户在账号行持续看到真实进度、结果和有效恢复入口。

**Architecture:** Go 继续持有官方进程、来源校验和操作归属；macOS 原生终端通过本次私有管道承接官方交互。现有桥只传结构化状态，React 的账号模型保存行内确认与恢复上下文，列表负责展示。

**Tech Stack:** 沿用 Go 1.27.3、Tauri 2.12 系列、现有 Rust、React 19.2.8、TypeScript 7.0.2、Radix/Lucide/CSS、Node 24、Playwright 1.63.0；不新增依赖。

## 全局约束

- 依据[设计](../specs/2026-11-03-claude-inline-login-design.md)及相邻已确认决策记录；外观以用户确认的[独立预览](../../../../../design-previews/2026-11-03-claude-inline-login/prototype.html)为参照。
- 在现有 `feat/bee-desktop-p0` worktree 工作，保留已有全部修改；不重置文件，不自动重启正在使用的 Bee，不提交其他任务改动。
- 不删除、重建或直接修改用户钥匙串。不读取或记录真实 token 来排查字段。
- 不新增数据库、HTTP 服务、OAuth 库、PTY 库或 UI 依赖。
- 官方输入、合并输出与 supervisor 的退出码/生命周期管道分开；官方原文不进入 React、私有 JSON 协议、普通日志或磁盘文件。
- 登录成功只表示来源和账号核验通过；接入仍由用户确认，接入后保持暂停，不自动开始贡献。
- 不降低实例、修订、来源、权限、到期、套餐、scope 或官方身份校验，不用模拟 IPC 替代原生验收。
- 运行命令前将 Node 24 路径加入任务进程 PATH：`/Users/dayong/.nvm/versions/node/v24.22.1/bin`；不修改用户的 Shell 配置。
- 本计划只描述边界、接口、测试和顺序，不预写实现。完成计划后按 `global-conventions` 的 Plan 边界等待明确实施确认。

## Task 1：区分旧记录损坏与来源无法读取

**文件**

- 修改 `agent/claude.go`、`agent/desktop_account_sources.go`、`agent/desktop_authorize.go`。
- 新建 `agent/desktop_authorize_source.go`，只保存授权基线与比较逻辑，不持久化凭据。
- 扩展 `agent/claude_test.go`、`agent/desktop_accounts_test.go`、`agent/desktop_authorize_test.go`。

**接口与责任**

- 将现有原始来源读取和凭据解析分开；同一份原始读取同时提供来源/namespace、内容摘要和解析结果，避免两次读取组成不一致基线。
- `desktopAccountRead` 增加仅限内部的内容修订摘要；原有 token 修订保留，供最终一致性保护使用。
- `desktopAuthorizationBaseline` 保存本次来源、namespace、是否存在、原始内容摘要，以及解析成功时的原 token 修订；不包含原始 JSON 或令牌。
- 授权前读取失败仍返回具体 `DesktopAccountError`；只有来源缺失或原始读取成功的格式错误允许继续。
- `parseClaudeCredential` 分别报告结构、accessToken、expiresAt 的实际失败条件；不输出敏感字段值。

- [ ] 先补回归：旧 Claude JSON 结构损坏、accessToken 无效、expiresAt 无效均能越过启动前读取；权限拒绝和非普通文件均不能启动官方程序。用临时目录、合成原始内容和假来源，不访问真实钥匙串。
- [ ] 运行 `go test ./agent -run 'Test(ParseClaude|DesktopAuthorize|DesktopAccount)' -count=1`，确认新增测试因旧记录阻断或错误分类失败而变红；保存实际输出。
- [ ] 分离原始读取/解析并实现基线。保留 OpenAI auto 检测的既有行为；授权入口继续固定实际传给官方命令的来源，不能引入 fallback。
- [ ] 补同一命名空间的未改变、有效旧 token 未改变、来源替换及核验中再次变化测试。官方退出码为零仍必须通过已有 selectionSource/profile 和最终读回保护。
- [ ] 重跑上述 Go 测试，并执行 `go test -race ./agent -run 'Test(ParseClaude|DesktopAuthorize|DesktopAccount)' -count=1`。新测试及旧来源/命名空间/取消回归全部通过后完成本任务。

## Task 2：让官方交互可见且可取消

**文件**

- 新建 `agent/desktop_authorize_terminal.go`、`agent/desktop_authorize_terminal_darwin.go`、`agent/desktop_authorize_terminal_other.go`、`agent/desktop_authorize_terminal_test.go`。
- 修改 `agent/desktop_authorize_unix.go`、`agent/desktop_authorize.go`、`agent/cli.go`，扩展 `agent/desktop_authorize_unix_test.go` 及 CLI 参数测试。

**接口与责任**

- 内部 CLI 入口 `desktop-login-terminal --endpoint <path>` 只连接本次私有端点并在原生终端转接字节；不接受平台、官方命令、环境、授权码或任意可执行参数。
- `runDesktopAuthorizationTerminal(ctx context.Context, command *exec.Cmd, onStarted func()) error` 建立本次受保护端点、启动固定 helper，最多等待 30 秒连接，然后调用同一个 owned supervisor；返回仅含安全阶段与退出状态的错误。
- 增加内部 `runDesktopAuthorizationObserved(ctx context.Context, command *exec.Cmd, onStarted func()) error`，在 supervisor 确已启动后通知阶段推进；现有 `runDesktopAuthorization(ctx, command)` 委托它并传入 nil，保持版本探测及旧调用接口。
- `runDesktopAuthorization` 保留 fd3 的退出状态和独立控制 stdin，新增 fd4 仅承接官方输入；官方命令仍以 argv 传递，固定脚本将 fd4 接入 child 后关闭额外 fd。
- macOS 使用 `open -a Terminal` 打开私有 `.command`；启动脚本只包含正确 shell quoting 的可信本机 Bee 路径及本次 endpoint。`open` 成功只说明启动请求已发出，不能推进至登录成功。
- 端点目录 0700、socket 0600、启动脚本 0700，使用满足 Unix socket 长度限制的本机临时路径。操作结束清理本次目录；绝不清理其他端点。
- 提示文本只在原生终端显示，原始输入输出不写文件。helper 断开、Ctrl-C、终端关闭、应用退出及超时都取消本次 owned group；关闭管道与 socket，回收进程后再 join 转接协程，避免背压卡死。
- Windows/其他系统保留现有明确适配边界；不得把 macOS 实现无条件用于其他平台。OpenAI 未证实需要该转接时沿用已有执行路径。

- [ ] 增加实际问答型合成子进程：输出提示，等待一行输入，校验后退出；另有非零退出、stdout 大量输出、持有 stdout 的子孙、永久等待等分支。使用注入的终端启动函数连接端点，测试不能弹出真实登录。
- [ ] 运行 `go test ./agent -run 'TestDesktopAuthorize(Terminal|Interactive|CleansOwned)' -count=1`，确认问答和断开回收测试在旧实现下失败。
- [ ] 实现私有终端转接、严格 helper 参数、macOS 固定启动和 fd4 接入；命令探测保持非交互且不启动终端。
- [ ] 覆盖取消前未连接、连接后断开、输出背压、正常退出、非零退出、取消/超时与外部无关进程并存；断言只有 owned group 被清理，临时目录已删除，秘密标记未出现在普通诊断/协议/临时文件。
- [ ] 运行上述测试及 `go test -race ./agent ./cmd/bee -run 'Test(DesktopAuthorize|RunCommand|CLI)' -count=1`；在 macOS 用无副作用合成程序实际打开 Terminal，完成输入、Ctrl-C 和关窗验证，记录观察结果。

## Task 3：让三层协议传递有证据的登录阶段

**文件**

- 修改 `agent/desktop_runtime_types.go`、`agent/desktop_authorize.go`，扩展 `agent/desktop_authorize_test.go`。
- 修改 `desktop/src-tauri/src/protocol.rs`、`desktop/src-tauri/src/protocol_tests.rs`、`desktop/src-tauri/src/authorize_protocol.rs`。
- 修改 `desktop/src/system/accounts.ts`、`desktop/src/system/authorize.ts`，扩展 `desktop/tests/nativeAccounts.test.ts`、`desktop/tests/authorize.test.ts`。
- 修改 `docs/desktop/bridge-protocol.md`，记录字段、兼容和安全边界。

**接口与责任**

- Go `DesktopOperation.Phase string` 使用 `json:"phase,omitempty"`；只允许 authorize 的 `starting | waiting_official | verifying`。
- TS `AccountOperation.phase?: 'starting'|'waiting_official'|'verifying'`；账号快照及 authorize 回包复用同一个严格 operation 校验。
- Rust `AccountOperation` 增加可选 phase，同样校验归属和枚举；runtime operation 的非 authorize 字段不能混入此阶段。
- 创建 operation 时 starting；owned 官方进程确已启动后 waiting_official；官方进程成功退出且准备来源复核时 verifying。每次改变同时推进账号/operation 修订；终态以现有 state 为准。
- 无 phase 的旧回包可接受，但只能显示已有 state 所能证明的粗粒度进度。

- [ ] 先为三层添加阶段序列及非法输入测试：合法枚举、未知阶段、非 authorize 携带阶段、旧回包、错误 operation ID/平台和修订下降。
- [ ] 分别执行 `go test ./agent -run TestDesktopAuthorize -count=1`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml authorize`、`node --test desktop/tests/authorize.test.ts desktop/tests/nativeAccounts.test.ts`，记录新增测试的预期失败。
- [ ] 加入可选阶段及严格校验、真实阶段推进和协议文档。不得把探测开始误报为官方进程已启动，也不得因退出码为零直接生成 succeeded。
- [ ] 重跑以上测试，再执行 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml protocol`。确认既有账号、运行快照和未知字段拒绝测试保持通过。

## Task 4：落实确认预览及恢复入口

**文件**

- 新建 `desktop/src/features/accounts/NativeAccountLogin.tsx` 和只负责展示决策的 `accountLoginPresentation.ts`。
- 修改 `NativeAccountList.tsx`、`NativeAccountDetails.tsx`、`NativeAccountActions.tsx`、`useAccounts.ts`、`accountPresentation.ts`、`desktop/src/styles/app.css`、`desktop/src/i18n/en.ts`。
- 扩展 `desktop/src/presentation/problems.ts`、`desktop/tests/problems.test.ts` 和 `desktop/tests/fixtures/native-accounts.mjs`；新增 `desktop/tests/accountLoginPresentation.test.ts`，扩展 `desktop/tests/native-accounts.spec.ts`、`desktop/tests/account-auto-read.spec.ts`。

**接口与责任**

- `useAccounts` 持有按平台的确认草稿及显式恢复上下文；草稿记录账号/来源/运行戳。页面切换只卸载展示组件，不丢失流程。
- `NativeAccountActions` 的 authorize 入口打开行内草稿；接入、换号和取消接入继续沿用原确认行为。详情内启动登录先关闭详情并定位账号行。
- `NativeAccountLogin` 只使用模型与已核验快照展示阶段和按钮，不另起轮询或官方请求。行内区域占账号网格整行，保持原按钮位置、银白样式和紧凑层级。
- 重新核验调用既有 `detect(platform,'official')`；重新读取使用对应来源检测。保存本次显式恢复的身份和修订，成功展示必须依据这次检测结果，不能反复展示旧 authorize.error，也不能仅凭 candidate 非空声称身份已核验。
- 取消未知、提交未知只核对原操作，保留 operation ID；未知状态不提供重复登录副作用。
- 登录失败由行内区域持有；列表/详情里的通用 operation/candidate 错误按同一 code/check/message/evidence 去重。其他来源或供给失败仍正常展示。

- [ ] 先加浏览器失败用例：点击登录后出现行内确认且无新模态；继续后立即有启动反馈；切页返回保留 operation；详情启动会回到行内区域。现有实现应因对话框路径或阶段缺失失败。
- [ ] 增加成功和恢复行为：网络核验失败→重新核验只发 detect、不增加 authorize_start；无效旧记录→重新登录；取消→检查当前登录；确认上下文改变→本次未提交；未知取消→只查同一 ID。
- [ ] 实现模型、单一行内展示、上下文保护、具体错误/按钮、英文与 CSS。重试完成后显示本次真实结果，禁用态给出实际限制。
- [ ] 在仓库根运行 `node --test desktop/tests/accountLoginPresentation.test.ts desktop/tests/problems.test.ts desktop/tests/authorize.test.ts desktop/tests/nativeAccounts.test.ts`；在 `desktop/` 目录运行 `npx playwright test --config playwright.device.config.ts native-accounts.spec.ts account-auto-read.spec.ts`。
- [ ] 用浏览器检查 1000×700 与最低 860×600、键盘操作、确认取消后的焦点、状态播报及减少动画；对照批准预览检查等待、成功和失败三个截图。OpenAI 登录、接入及换号回归保持通过。

## Task 5：定位修订阻断并保持完整性保护

**文件**

- 测试：`desktop/tests/desktopState.test.ts`、`desktop/tests/nativeAccounts.test.ts`、`desktop/tests/account-auto-read.spec.ts`；源码限于已绑定的 `desktop/src/system/desktopState.ts` 和 `desktop/src/features/accounts/useAccounts.ts`。证据指向这两个文件之外时先说明具体新增范围，再修订计划。
- 证据保存在 `docs/desktop/evidence/2026-11-03-claude-inline-login/`，内容只含方法、实例、修订和请求开始/结束顺序，不含官方原文、完整路径或凭据。

**接口与责任**

- 保留 `actual >= confirmed floor` 的所有校验；不能把读取前保存的 runtime 修订改写成本次 account_snapshot 的 actual。
- 用可控 promise/barrier 复现 runtime 观察、自动来源检测、recordReceipt 和 account_snapshot 的真实顺序，区分实际旧回包和错误证据改写。
- 若证明来源检测与中央读取缺少协调，仅修复该协调；真正的修订下降仍须保持 blocked。若证据不够，继续定位，不能猜测后放行。

- [ ] 给原生已观察的 130/131 错误补安全时间线，先找到 actual 的来源；构造与时间线一致的失败测试，确认当前实现确实失败。
- [ ] 为并发读取、独立平台、未知写回执、实例切换和真正修订下降补行为断言。若本次错误由底层失败引起，断言保留原失败及真实回包证据。
- [ ] 只修复测试与时间线证明的根因；保留现有 revision floor、确认戳及未知结果禁止重复提交的约束。
- [ ] 在仓库根执行 `node --test desktop/tests/desktopState.test.ts desktop/tests/nativeAccounts.test.ts`，在 `desktop/` 目录跑 `npx playwright test --config playwright.device.config.ts account-auto-read.spec.ts polling-stability.spec.ts native-accounts.spec.ts`；新实例、低修订和迟到结果保护均保持通过。

## Task 6：构建、原生验收与交付

**文件**

- 更新 `docs/desktop/ai-accounts.md`、`docs/desktop/account-runtime-validation.md`、`docs/desktop/acceptance.md`；新增 `docs/superpowers/reports/2026-11-03-claude-inline-login.md`，记录实际运行结果和未验项。

- [ ] 运行 `go test -race -timeout=600s ./agent ./desktopbridge ./cmd/bee`、`go vet ./agent ./desktopbridge ./cmd/bee`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`、`node --test desktop/tests/*.test.ts` 和 `npm --prefix desktop run build`。按失败定位回归，不扩大到无关重构。
- [ ] 在仓库根运行现有 `make app`，生成 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`。该目标会检查工具、准备内置组件、安装锁定依赖并构建 ad-hoc 签名开发包，不会自动启动或退出 App。
- [ ] 保留用户正在运行的 Bee；新包构建后展示可审阅的差异和可启动产物。在用户明确允许切换应用后再退出旧进程并启动新包，不靠强杀处理旧 revision 或登录状态。
- [ ] 原生使用合成程序验证 Terminal 行交互和 owned 取消；随后准备实际 Claude 登录。真实账号授权由用户在官方界面完成，Bee 再核验并显示实际结果；没有完成这一步就明确记录未验收。
- [ ] 执行受影响路径审查及 verification-before-completion → consistency-check → post-verification-check，修正发现的问题并复验必要路径；全部已证实项目勾选，外部未验项单列，不把模拟通过算作真实授权通过。
- [ ] 更新验收文档和交付报告，包含具体失败原因、操作入口、测试输出/截图、支持平台与未验范围；只提交本任务已审阅文件，提交说明使用英文。

## 规格覆盖自检

| 设计要求 | 负责任务 |
| --- | --- |
| 旧记录无效可重新登录、来源与身份保护 | Task 1 |
| 官方终端交互、owned 回收及无秘密泄露 | Task 2 |
| 可证明的登录阶段及三层协议 | Task 3 |
| 批准的行内 UI、切页保留、有效恢复及去重 | Task 4 |
| 130/131 定位与修订保护 | Task 5 |
| 构建、原生交互、真实授权与回归证据 | Task 6 |
