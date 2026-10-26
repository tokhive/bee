# Bee 中英文安装交互实施计划

> 执行：用户已确认完整交互样例并要求继续。沿用当前隔离 worktree，使用 subagent-driven-development 协作完成 Go 文案与安装器，不重复申请已确认方案的执行许可。

**目标：** 中英文完整配置启动流程，统一分割线、图标、状态和结果，更新已有两个 PR。

**设计依据：** `docs/superpowers/specs/2026-10-26-install-ui-design.md`。

**技术栈：** 现有 POSIX sh、Go 1.27.3、Python 3.9+、systemd 243+、ShellCheck、GitHub Actions、Docusaurus；不增加运行时依赖。

## 全局约束

- `BEE_LANG=zh|en`；未指定时交互安装先选语言，非交互按首个非空 LC_ALL/LC_MESSAGES/LANG 判断，zh 前缀为中文，其余英文。
- `BEE_INSTALL_UI=1` 只传给安装器调用的 login/setup，用于省去重复的前台启动引导与配对 INFO 日志；不修改持久配置或 unit 环境。
- 普通终端可有颜色、emoji、40 字符横线；非终端或 TERM=dumb 使用 ASCII、无 ANSI/emoji，非空 NO_COLOR 仅关闭颜色。
- 配置步骤固定 1/3、2/3、3/3；active 服务仅确认重启；失败停止并保留原始诊断；实际 active 才显示成功。
- 首次配置默认是、重启默认否、每个账号单独确认；无效回答重新询问，EOF 不自动授权。
- 沿用 sudo true、身份、配置和迁移保护；旧二进制继续工作但自身文案可能为英文，完整双语需要新版二进制。

## Task 1：Bee 配对与账号选择双语输出

**文件：** `agent/install_ui.go`（新增小型文案/状态辅助）、`agent/cli.go`、`agent/setup.go`，对应 Go 测试。

**接口：** 消费 BEE_LANG、BEE_INSTALL_UI、TERM、NO_COLOR；CLI 参数、返回错误、配置内容及认证业务接口沿用现有定义。

- [x] 编写中英文配对输出、中文账号选择、安装器上下文、无效输入/EOF 的行为测试，确认缺少功能而失败。
- [x] 用局部辅助函数统一语言与状态输出；翻译正常配对提示、摘要、账号发现与逐项确认；保留原始诊断。安装器上下文去掉重复 INFO/前台启动提示。
- [x] 验证 `go test ./agent`，报告红绿测试证据并审查本任务 diff。

## Task 2：安装器菜单与完整三步展示

**文件：** `install.sh`、`scripts/test-install.py`、`README.md`。

**接口：** 安装器选择语言后给 login/setup 设置 BEE_LANG 和 BEE_INSTALL_UI=1；不用新 CLI 参数，不读取/解析配置 JSON。

- [x] 增加伪终端语言菜单、中文已有配置三步、失败证据、纯文本/NO_COLOR 测试；原回归通过 BEE_LANG=en 保持可定位。
- [x] 在单文件安装器中集中中英文文案与终端呈现；从控制终端读取语言；完整输出安装结果、配置三步、拒绝/升级/失败分支和对应后续命令。
- [x] 更新 README 的语言开关、终端表现、三步流程与旧发布版兼容说明；运行 `make test-install`、ShellCheck、差异检查并审查。

## Task 3：文档、整体验证与 PR

**文件：** `doc-site/docs/provider/install.mdx`，本 spec/plan/trace。

- [x] 同步安装指南；运行 `npm run build`、`make test`、ShellCheck、差异检查；检查实际伪终端输出及 Go 配对/账号输出衔接。
- [x] 针对本次双语安装交互做审查，修复有效问题，完成一致性和计划复核。
- [x] 提交并推送已有 fork 分支，更新 Bee #20 和文档 #1 的标题/说明，检查最新 Linux CI；记录旧 release 不能提供完整新文案的边界。

## 本地验证记录

- `make test`：安装器 52 项测试中 50 项通过，2 项 Linux 原生检查在 macOS 跳过；`go vet ./...` 与 `go test -race -timeout=600s ./...` 全部通过。
- ShellCheck、`git diff --check`、文档站 `npm run build` 通过。
- 真实伪终端转录已核对英文首次配置、中文已有配置、拒绝重启、启动失败；菜单、三步顺序、最终结果、NO_COLOR/纯文本降级有回归覆盖。Go 使用本地测试服务和合成凭证验证双语配对及逐账号选择；安装器断言给 login/setup 传递所选语言。
- Task 1 和 Task 2 的规格/质量审查通过。审查发现的旧测试英文断言受环境语言影响已修复，`BEE_LANG=zh go test ./agent -run '^TestSetupWritesWhatBeeRunAccepts$' -count=1` 通过。
- 尚未进行真实云服务器重启实测。旧 release 能运行但不具备新的 Go 文案；完整双语需要包含本次修改的新二进制，未发布 release。

## 远程验证与一致性复核

- Bee 实现提交 `0e11383` 的 [Linux CI](https://github.com/tokhive/bee/actions/runs/40264897322) 通过：52 项安装测试全部通过，包含 systemd unit 校验和开机目标链接检查；ShellCheck、Go vet、race 测试通过。
- 文档提交 `f42fbd1` 的 [构建 CI](https://github.com/tokhive/doc-site/actions/runs/40264900175) 通过。
- 已推送 fork 分支，并更新 [Bee #20](https://github.com/tokhive/bee/pull/20) 与 [文档 #1](https://github.com/tokhive/doc-site/pull/1) 的标题及说明。
- 会话一致性：沿用已确认的双语、三步、默认确认和服务语义，没有恢复被否决方案。
- 文档内部一致性：spec/plan 的步骤、语言和发布边界一致；中英文等义文案与实际输出相符。
- 跨产物一致性：代码、调用方、README、指南、PR 描述与计划一致；语言环境只传给 login/setup。
- 配置一致性：没有新增持久配置；BEE_LANG、NO_COLOR 的用法和默认值已记录，内部 BEE_INSTALL_UI 不写入 unit。
- 文档与行为一致性：服务 active 与 Hive/账号状态分别检查，旧 release 不能提供新 Go 文案的限制已明确。
- 计划复核：共 9 项，复核前已勾选 7 项，本次确认并勾选 2 项，未完成 0 项。
