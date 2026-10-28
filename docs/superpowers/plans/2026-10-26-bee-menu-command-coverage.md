# Bee 菜单完整命令覆盖实施计划

> **执行方式：** 使用 `executing-plans` 在当前会话逐任务执行；用户已批准设计并要求不使用子代理。

**目标：** 九项主菜单覆盖全部既有命令及实际支持的参数，提供清晰的双语前台启动与后台管理流程。

**架构：** 沿用 managementMenu、共享输入读取器、结构化业务函数和安全服务检查。会话选项不修改环境或持久化偏好；写入仍经过展示、确认和既有并发保护。

**技术栈：** Go 1.27.3、标准库、现有 ANSI/installUI、Python 3 PTY、systemd 243+、现有 CI；无新增依赖。

## 全局约束

- 依据已批准的 `../specs/2026-10-26-bee-menu-command-coverage-design.md`，不扩张命令语义。
- 中文 spec/plan/报告，英文提交与 PR；双语菜单，JSON/协议值/原始诊断保留原文。
- start/status 使用设备文件旁的 egress.json；自定义 egress 仅用于 setup/run/doctor 和精确匹配的服务目标。
- 前台复用配置锁和 signal context；Ctrl+C 退出整个程序；不自动停止其他进程。
- Claude 目录与代理保留未指定、明确空值、明确值三态；取消和 EOF 不执行未确认的写操作。
- 自动测试只用合成凭证和服务，不接触真实账号。

## Task 1：会话目标、主菜单和帮助

文件：修改 `agent/menu.go`、`agent/start.go`；新增 `agent/menu_options.go`、`agent/menu_help.go`、`agent/menu_coverage_test.go`。

- [x] 先写测试：切换设备配置重置关联 egress 和服务目标；取消不变；帮助/版本在未配对时可用。
- [x] 运行 `go test ./agent -run 'TestMenu.*(Options|Help|Target)' -count=1`，确认缺失功能导致失败。
- [x] 实现九项主菜单、当前目标显示、会话路径选择、独立帮助与版本；修正 CLI --config 的适用范围说明。
- [x] 运行上述测试，核对配置路径不会落盘或修改进程环境。

## Task 2：前台引导和直接运行

文件：新增 `agent/menu_start.go`、`agent/menu_start_test.go`；修改 `agent/menu_pairing.go`；直接复用 `agent/cli.go` 的 run 分派，无需修改其命令逻辑。

- [x] 先写测试：直接运行不创建账号配置；引导沿用默认 egress；取消不运行；锁冲突阻止连接；自定义设备名称实际用于配对。
- [x] 运行 `go test ./agent -run 'TestMenu.*(Foreground|Guided|Pair)' -count=1`，确认失败。
- [x] 实现三个启动动作；复用 run 的锁和连接逻辑，配对/选择账号显式沿用菜单语言，运行日志标为原文；引导完成缺失配对/配置后选择运行方式；Ctrl+C 通过既有 context 退出。
- [x] 运行对应回归；失败保留具体路径及原始原因，不把取消当成功启动。

## Task 3：完整账号配置和独立状态查询

文件：修改 `agent/menu_account_setup.go`、`agent/menu_accounts.go`、`agent/menu_reports.go`；新增 `agent/menu_setup_options.go`；扩展相关测试。

- [x] 先写测试：账号请求失败不阻断独立供给请求；平台过滤、全选、客户端目录、代理保持/设置/清空；取消不写；自定义配置不会改变 status/start 默认目标。
- [x] 运行 `go test ./agent -run 'TestMenu.*(Account|Supply|Setup|Proxy|Status)' -count=1`，确认新增行为失败。
- [x] 实现配置选项与全部合适账号选择；保持快照复查、私有文件写入、重启单独确认和 pending fingerprint 复查。
- [x] 运行上述测试和原有 setup 测试。

## Task 4：专项检查、参数参考和诊断 JSON

文件：新增 `agent/menu_checks.go` 及测试；修改 `agent/codex.go`、`agent/claude.go`、`agent/claude_capabilities.go`、`agent/menu_service.go`、`agent/menu_reports.go`。

- [x] 先写合成凭证/HTTP 测试：本地检查不联网、在线身份/模型/额度查询、目录三态和存储选择、帮助选项实际注册、诊断 JSON 与 CLI 数据一致。
- [x] 运行 `go test ./agent -run 'TestMenu.*(Check|JSON|Help)|TestCodexStatus|TestClaude' -count=1`，确认新增行为失败。
- [x] 抽取结构化检查结果供 CLI JSON 和菜单双语视图共用；保留读取后复查授权；专项选项仅在用户选择动作后请求官方接口。
- [x] 实现 JSON 诊断、双语说明及各命令原始参数帮助；运行对应回归。

## Task 5：真实终端、文档和交付

文件：修改 `scripts/test-menu.py`、`README.md`、配套 `doc-site/docs/provider/install.mdx`；新增完成报告。

- [x] 更新九项菜单 PTY 导航，添加合成 Hive 从未配置到前台运行、已有配置直接运行、Ctrl+C 退出、EOF、语言和颜色降级回归。
- [x] 运行 `make test`、`shellcheck install.sh`、`git diff --check`、`make build` 和 doc-site `npm run build`；修复真实失败。
- [x] 按 spec 命令/参数覆盖表逐项核验实现，更新 README、配套文档和完成报告。
- [x] 使用 verification-before-completion 和 consistency-check 核对结果，勾选全部已完成步骤；不调用子代理审查。
- [x] 提交并推送现有分支，更新 PR #22 英文说明及文档 PR；检查 Linux CI 通过，重建本地二进制，提供手动测试入口。
