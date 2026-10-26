# Bee 菜单完整命令覆盖核验

## 交付范围

本次在既有 PR #22 上补齐命令能力。用户已批准 spec；执行方式为主代理直接使用 executing-plans，没有使用子代理。主菜单有九个入口，保留双语、颜色、图标及纯文本降级。

## 命令覆盖

| 命令 | 菜单入口 | 实现 |
| --- | --- | --- |
| start | 启动 Bee → 引导配置并启动 | menu_start.go：缺失配对与账号选择，再选择前台/后台 |
| run | 启动 Bee → 按现有配置前台运行 | menu_start.go：复用 cli.go 的 run，配置锁及信号退出保持一致 |
| login | 设备配对 | menu_pairing.go：Hive、设备名称、配对继续/重配对及备份 |
| setup | 供给账号 → 选择供给账号 | menu_account_setup.go、menu_setup_options.go |
| status | 运行状态 | menu_reports.go，固定读取设备文件旁的 egress.json |
| account-status | 供给账号 → 已登记账号 | menu_accounts.go，独立账号请求 |
| supply-status | 供给账号 → 接单状态 | menu_accounts.go，独立供给请求 |
| pause / resume | 供给账号 → 暂停/恢复接单 | 沿用平台选择与写入确认 |
| confirm-account | 供给账号 → 确认账号变更 | 保留展示完整指纹、确认 ID 及提交前复查 |
| codex-status | 供给账号 → Codex 检查 | 本地登录、官方模型与订阅额度；共用 readCodexStatus |
| claude-status | 供给账号 → Claude Code 检查 | 本地登录、在线身份、模型与订阅额度；共用结构化检查函数 |
| doctor | 日志与诊断 → 运行诊断 / 查看诊断 JSON | 同一 diagnose 返回结构；JSON 保持既有字段 |
| help / -h / --help / 子命令 -h | 帮助与版本 → 使用说明 / 命令与参数参考 | 原始注册参数由各命令 -h 输出，无业务执行 |
| version / --version | 帮助与版本 → 程序版本 | 无配对与网络前置条件 |

## 参数覆盖

| 参数 | 处理与边界 |
| --- | --- |
| --config | 高级选项选择设备路径；同步重置关联 egress 及服务匹配目标，不写偏好或环境 |
| --egress-config | 高级选项、账号配置选项、诊断路径；仅 setup/run/doctor 使用；start 引导期间固定默认文件 |
| --hive / --name | 配对流程输入；已有身份变更 Hive 走明确重配对和备份 |
| --platform | 平台数字选择；配置时检测单个平台或两者 |
| --account-fingerprint | 从实际待确认账号展示完整值并复查后确认 |
| --codex-home | 账号配置与 Codex 检查中的目录选择 |
| --claude-config-dir | 账号配置与 Claude 检查中的三态选择；保留目录原文，包括首尾空格 |
| --store | Codex file/keyring/auto；Claude file/keychain；显示平台限制 |
| --keyring-backend | 固定展示当前唯一实现 direct |
| --connect-proxy | 保持 / 设置 / 清除，复用本机 HTTP CONNECT 校验；保存前显示最终代理 |
| --capabilities / --verify | 专项检查中的独立联网动作；本地检查不联网 |
| --json | 输出 diagnose 的完整原始 JSON |
| --yes | 一次选择全部可用账号，最终仍展示完整供给选择并确认；CLI 参数保持原义 |

## 关键验证

- 配置切换与服务目标同步、取消无落盘、默认与显式供给路径、配置锁冲突。
- 首次配对名称、引导取消、引导固定 egress；真实 PTY 从未配置到配对、选择账号、连接合成 Hive，再 Ctrl+C 退出。
- 真实 PTY 按已有配置连接；无供给文件保持在线、不创建账号配置；Ctrl+C 不回到菜单。
- 平台筛选、全选、代理三态、Claude 目录三态和原文保留、账号选择取消与私有文件保存。
- 账号失败不阻断供给的独立入口；综合状态也继续查询供给。
- 合成 Codex/Claude 本地检查、身份验证、模型额度查询、未知状态原始原因；保留既有授权复读及 CLI JSON 测试。
- 无配对帮助/版本、全部子命令参数帮助、诊断 JSON、中英文切换、NO_COLOR、TERM=dumb、EOF。

完整安装器测试已执行 64 项，macOS 通过 62 项，2 项原生 systemd 测试交由 Linux CI。最终目录原文修复后重新执行 Go vet/race 与 PTY，全部通过（13 项 PTY）；ShellCheck、make build、两仓库 git diff --check 及文档站 npm run build 通过。Linux CI 已在 74ab6a6 上通过（run 40308322705），包含全部 64 项安装器测试、13 项 PTY 和 Go vet/race；文档 CI run 40308328440 通过。收尾补充了 macOS 引导后台启动的能力提示，全部菜单 race 回归、go vet 和构建再次通过；PR checks 提供后续提交的完整 CI 结果。

本次增量不修改 Makefile 或 CI workflow；现有 make test 已包含安装器、PTY、Go vet/race，Linux CI 调用同一目标并运行 ShellCheck。

## 手动测试

在此工作树执行 `make build`，然后在终端运行 `./bin/bee`。先检查九项入口，再测试「启动 Bee → 引导配置并启动」和「按现有配置前台运行」。前台 Ctrl+C 退出整个 Bee；重新输入命令打开菜单。

高级选项可选择临时设备配置测试首次配置，或选择已有设备文件测试直接运行。默认无供给文件时仅保持在线；明确指定不存在的供给文件则报错。检查账号选项的全选、代理三态、目录三态，以及帮助和诊断 JSON。

Linux 后台功能只控制用户、可执行文件和配置都匹配的安装器服务。源码二进制路径与已安装路径不同会拒绝服务操作；完整测试后台功能需把构建产物用于对应安装路径。此变更不发布 release，重新下载旧 release 的安装脚本不会获得新菜单。

## 一致性检查

- ✅ 会话：完整命令覆盖、前台退出语义及不使用子代理均符合用户确认；没有恢复用户拒绝的方案。
- ✅ 文档内部：本 spec、plan、报告的默认路径、三态参数和前后台语义一致。
- ✅ 实现与计划：全部实现任务有对应代码和测试；CLI 检查函数的调用方同步更新；PR 描述按最终范围更新。
- ✅ 配置：不新增环境变量、持久化偏好或依赖；平台限制和现有配置默认值一致；服务匹配检查未放宽。
- ✅ 文档与代码：README、配套安装页和菜单实际入口一致，明确未发布 release 和 macOS 服务限制。

计划复核：21 项步骤均已完成。保留工作树用于手动测试和 PR 后续修改；没有合并或发布 release。
