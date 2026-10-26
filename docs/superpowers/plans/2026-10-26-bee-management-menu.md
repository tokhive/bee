# Bee 数字交互管理菜单实施计划

> 执行方式：使用 executing-plans，由主代理在当前会话直接按任务串行实现和自审；用户明确要求不使用子代理。用户已要求“清理 worktree 后再继续 Bee 功能”，据此继续执行，不重复请求实施许可。计划只落实已确认设计，不预实现生产代码。

**目标：** 裸 `bee` 在交互终端提供双语数字管理菜单，完成状态、配对、账号、服务、诊断和语言操作。
**架构：** 菜单持有一次会话的共享输入和语言；业务调用复用现有结构化数据与校验，系统服务操作由严格校验目标的适配器负责。安装器与已有 CLI 保持兼容。
**技术：** 现有 Go 1.27.3、标准库、systemd 243+、Python 3 PTY、Go 测试、ShellCheck，不新增依赖。
**设计：** `docs/superpowers/specs/2026-10-26-bee-management-menu-design.md`。

## 全局约束

- 只有无参数 bee 且标准输入、输出均为交互终端时进入菜单；无终端输出帮助，不读取答案。
- 共享读取器不丢连续答案；0 返回/取消，主菜单 0 退出；空确认、EOF 不授权，Ctrl-C 取消前台动作且不发出后台停止操作。
- 菜单正常文案及业务报告支持 zh/en，NO_COLOR 和 TERM=dumb 沿用；原始错误、外部日志保留诊断证据，秘密不输出。
- 仅控制属于当前用户、配置与可执行路径匹配的安装器托管 tokhive-bee 系统服务；匹配无法证明就停止，提供实际证据及手动管理指引。
- 开机自启 enable/disable 与立即 start/stop 分开；所有服务操作后核实状态，不把 active 当作 Hive 或账号可接单。
- 本地配对恢复需明确确认、原生配置锁、确认期间文件未变、0700 唯一目录及私有备份；失败保留旧备份与新进度。
- 账号变更预览后确认，不确认另一份待确认记录；修改供给配置与运行进程应用分开；远端写入不确定不自动重试。
- 原 CLI 参数、JSON 和前台运行语义兼容；默认配置路径；macOS 不增加后台服务实现；不发布 release，不合并 PR。

## 文件与接口边界

- `agent/managed_service.go` 与测试：检查托管服务、固定参数执行、状态校验和有限日志。
- `agent/menu.go`、`menu_reports.go`、`menu_service.go` 与对应测试：输入/语言/导航以及状态、诊断、服务和日志操作。
- `agent/menu_pairing.go`、`menu_accounts.go` 与对应测试：明确授权后的业务向导；按需小幅抽取 `cli.go`、`setup.go`、`accounts.go`、`supply.go` 的结构化操作，避免复制业务实现。
- `scripts/test-menu.py`：真实终端入口/取消/输出验证；`Makefile` 和现有 CI 纳入。
- `README.md`、`doc-site/docs/provider/install.mdx`：公开入口、平台及发布边界。

### Task 1：托管系统服务适配器

**文件：** 新增 `agent/managed_service.go`、`agent/managed_service_test.go`；必要的纯解析 helper 可放 `agent/managed_unit.go` 与测试。

**对外接口（包内）：** `serviceState` 包含 `LoadState, ActiveState, UnitFileState string`；`newManagedService(configPath, egressPath string, in io.Reader, out io.Writer) (*managedService, error)`；方法 `inspect(context.Context) (serviceState, error)`、`apply(context.Context, string) (serviceState, error)`、`logs(context.Context, bool) error`。不可用平台/未安装提供可 errors.Is 判断的 `errServiceUnavailable`；调用者保留实际错误。服务对象可在测试中注入执行器、平台及用户信息，生产路径不得以测试环境变量绕过校验。

- [x] 写风险矩阵与 RED 测试：平台不支持、服务未安装、用户/二进制/配置不匹配、非托管/链接 unit、未知覆盖、锁定/过渡状态、sudo 拒绝、命令失败、启动未 active、enable 不 start、disable 不 stop、日志 50 行无 pager、特殊路径不会执行 shell 内容。
- [x] 实现只读探测与匹配校验。读取 systemctl 的实际属性并检查安装器 unit；不得依赖模糊字符串包含来证明 ExecStart 参数一致。可对首版不能可靠识别的覆盖返回具体不支持错误，不能静默忽略。独立依据为 install.sh 实际生成的 unit 和 Linux systemd 原生验证。
- [x] 实现允许列表 start/stop/restart/enable/disable，逐次重新验证目标，必要时仅提权该命令；透传当前终端供 sudo 使用。动作后查询与期望状态一致才成功，结果未知说明再次查询。日志受同一目标验证保护，无隐式提权。
- [x] 运行 `go test ./agent -run 'TestManaged' -count=1`、`go test ./agent`，自审、提交，并提供 RED/GREEN 命令及实际输出。任务自审同时验证规格和质量。

### Task 2：数字菜单框架、只读报告与服务交互

**文件：** 新增 `agent/menu.go`、`menu_reports.go`、`menu_service.go` 及测试；按需调整 `install_ui.go`；本任务不接裸 bee 入口，Task 4 一次接通全部动作。

**消费：** Task 1 的 managedService 接口及现有 `localState`、`readState`、`diagnose`、`httpClient/call`、`beewire` 类型。
**产出：** `managementMenu` 持有 `ctx context.Context`、`in *bufio.Reader`、`out io.Writer`、`ui installUI`、`configPath, egressPath string`、`service *managedService`；公共包内方法 `text(en,zh string) string`、`line(prompt string) (string,error)`、`choose(prompt string,max int) (int,error)`、`confirm(summary string) (bool,error)`、`status() error`、`services() error`、`logsAndDoctor() error`、`language() error`。导航使用简单 `menuAction`（双语名称与 `func() error`），不要创建泛化工作流框架。函数名可在报告说明必要改动，但消费者必须同步。

- [x] 写 RED 测试验证双语数字选择、越界重问、默认取消、EOF、连续答案不丢、主菜单循环/返回、颜色规则、操作失败后可返回，不在菜单退出时停止服务。
- [x] 实现共享输入和语言；不要在循环中重复包装 buffered reader，不用全局 Setenv 切换语言；所有提示可取消。
- [x] 实现状态、诊断与服务/日志子菜单。状态分别获取本地和远端结果，未配对给指引；诊断复用 diagnose 避免 doctor 修改全局 logger；正常栏目/结果本地化，具体原始故障保留。每次服务变化展示目标和影响后数字确认；缺配置时返回明确向导指引，Task 4 接入可选继续入口。
- [x] 实现服务变更后的状态展示、开机自启独立提示、权限失败和未知状态处理；读取日志失败时只对权限原因提供明确的单次 sudo 确认，不自动提升。
- [x] 运行 `go test ./agent -run 'TestMenu' -count=1`、`go test ./agent`，自审提交和任务自审；给 Task 3 提供实际接口说明。

### Task 3：设备配对与账号管理向导

**文件：** 新增 `agent/menu_pairing.go`、`menu_accounts.go` 与测试；按需修改 `cli.go`、`setup.go`、`accounts.go`、`supply.go` 及相关测试。允许拆 `menu_account_setup.go` 保持单一职责。

**消费：** Task 2 的 managementMenu 会话及 Task 1 的服务接口；现有配置锁、私有原子写入、官方登录发现、Hive API 类型。
**产出：** `(*managementMenu).pairing() error`、`(*managementMenu).accounts() error`；可供启动流程调用的配置动作。账号/配对渲染复用显式传入的 installUI；原 CLI wrapper 从环境创建 UI，菜单不通过解析 stdout 或设置全局环境重用命令。

- [x] 写 RED 测试：首次/继续配对、只读验证不拿运行锁、显式重新配对（有效与失效均需确认）、取消不修改、服务停止失败、同一配置锁冲突、文件变化/链接、0700/0600 备份、重配对失败保留及供给配置逐字保留。
- [x] 抽取最小的现有配对操作以传递 UI 和避免重写协议；生成新凭证沿用已有长度/名称/来源校验，新的开始必须经确认。备份前原生锁和重读；成功后可选择账号配置或启动，默认取消；所有失败立即停止动作。
- [x] 写 RED 账号矩阵：读取官方登录、逐项数字选择、完整列表与删除项预览、最终取消无落盘、保留高级字段/拒绝手写配置、没有选择不清空；保存后的立即/稍后应用及失败状态。
- [x] 复用发现和构建供给配置逻辑，CLI 的 y/n 不变。保存前检查当前供给配置仍与选择时一致，避免覆盖已观察到的并发变更；原子私有写入。仅在用户确认后重启匹配服务，输出保存/应用两个结果。
- [x] 写 RED 并实现平台状态、暂停/恢复与确认账号变更。确认页面绑定待确认指纹和 ConfirmationID，提交前重读必须一致；远端结果不确定展示原始错误并指引查询，不重试。复用结构化动作，保持原 CLI 格式与暂停状态。
- [x] 运行 `go test ./agent -run 'TestMenu(Pair|Account|Supply)|TestLogin|TestSetup|TestAccount|TestSupply' -count=1`、`go test ./agent`；自审提交和任务自审，报告全部新测试及原 CLI 兼容结果。

### Task 4：接入裸命令、终端验收与文档

**文件：** 修改 `agent/cli.go`、`start.go`、菜单导航/测试；新增 `scripts/test-menu.py`；修改 `Makefile`、必要的 CI、`README.md` 与文档站安装指南。

**消费：** Tasks 1–3 的全部菜单动作。
**产出：** 裸 bee 完整用户入口；菜单回归纳入 make test 与 Linux CI。

- [ ] 真正 PTY 写入口 RED：裸 bee 应出现菜单，当前仅帮助则失败；非终端裸命令/显式 help 保持帮助；数字切换语言、嵌套返回、EOF/Ctrl-C、安全取消、快速连续输入、TERM=dumb/NO_COLOR。测试必须操作真实新二进制，不用 fake Bee 替代入口。
- [ ] 仅在 stdin/stdout 终端条件满足时接 runManagement；初始化语言和服务对象失败不能阻止其他可用菜单（展示准确不可用原因）。接齐六项及退出；服务启动缺配置时提供配对/选择账号向导，完成后重新询问启动。
- [ ] 增加独立 Linux 校验：从 install.sh 现有测试夹具实际产生的 unit 验证服务适配器接受正确目标、拒绝不匹配；保留原生 systemd-analyze/systemctl --root 检查；不操作生产服务。Makefile 和 CI 执行菜单 PTY 回归。
- [ ] 实际查看中英文终端输出，自审提示顺序与结果；更新 README 与安装指南，解释菜单/子命令、平台限制、退出菜单、保存与应用、自启与启动，以及需要新二进制 release。配套文档 PR #1 尚未合并，保留其安装功能说明后追加菜单说明。
- [ ] 运行 `make test`、ShellCheck、`git diff --check`、文档构建；所有任务自审完成后做主代理全分支审查、修复有效问题、最终验证与一致性/计划复核。按已有 PR 授权提交新的 Bee 功能 PR，不重开已合并 #20，不自动合并或发布。

## 基线及进度

- 已删除旧手工 worktree bee-linux-autostart，保留 feat/linux-autostart 提交引用，并把 spec/审查记录保存到 `.worktree-archives/bee-linux-autostart-2026-10-26`。
- 新 worktree：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-management-menu`；分支 feat/bee-management-menu；基线 7f6025d（Bee #20 合并提交）。菜单 spec 已迁移为 0147747。
- 原生工具因当前会话目录不是 Git 仓库而无法创建，attach 也确认手工 worktree 不受原生管理，采用 Git 创建/清理方式；未影响其他 worktree。
- 基线 make test：安装器 64 项中 62 通过、2 项 Linux 原生检查在 macOS 跳过；go vet 与 go test -race 通过。
- 设计—任务覆盖：入口/通用交互→2/4；状态→2；配对→3；账号→3；服务→1/2/4；日志诊断→1/2；发布和验收→4。所有任务沿用全局约束。
