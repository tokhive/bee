# Bee 启动配置自动检查实施计划

> 执行要求：使用 executing-plans，由主代理直接逐项实施，不使用子代理。设计已于 2026-10-27 获用户批准。

**目标：** 选择“启动 Bee”即自动检查配置、补齐缺失项并启动，保留所有写配置确认及损坏保护。

**架构：** 沿用 starts / prepareStart、配对引导和账号选择；普通启动验证已配对身份，复用配对确认及备份。高级前台和系统服务规则保留。

**技术栈：** 沿用 Go ≥1.27.3、标准库、现有 systemd 管理、Python 3 PTY、Make 与现有 CI，无新增依赖。

## 全局约束

- spec：docs/superpowers/specs/2026-10-26-bee-menu-command-coverage-design.md，启动交互段为本次批准范围。
- 完整配置零额外启动问题；缺失自动补齐；损坏停止保留；只对 Hive 明确拒绝引导重配对。
- 配对、账号保存和重置确认保留；不访问真实用户账号或操作真实服务。
- 中文 spec/plan/report，英文 commit/PR，沿用当前工作树并更新现有 PR，不合并发布。

## Task 1：自动补齐配置与身份恢复

文件：agent/menu_start.go、agent/menu_pairing.go、agent/menu.go、agent/state.go、agent/egress.go、agent/menu_errors.go、agent/problems.go；相关 menu_start、menu_auto_start、menu_pairing 测试及新增 menu_start_configuration_test.go。
接口：保留 starts() error、prepareStart() (bool,error)；提取共享配对执行流程供主菜单和启动自动续配/重配调用。

- [x] 添加行为测试：完整配置零输入、缺失引导及取消、未完成续配、明确拒绝确认与备份、断网/未知拒绝保留、损坏证据、官方登录缺失仍启动、服务已运行。
- [x] 运行 go test ./agent -run 'TestMenu(Start|Guided|Foreground|Pair)' -count=1，确认新增行为失败。
- [x] 去除引导选择；先检查本地配置；自动验证/续配；复用确认备份流程，修正取消后的继续启动，补齐具体错误信息和中英修复指引。
- [x] 相同定向测试转绿，并自查锁、配置保留与前台生命周期。

## Task 2：真实终端交互与文档

文件：scripts/test-menu.py、README.md、agent/menu_help.go、配套 doc-site/docs/provider/install.mdx。

- [x] 调整 PTY 输入和合成 Hive 响应，验证完整配置直接连接、缺失自动引导、取消返回；高级仅在线继续覆盖，中英文及终端降级保持。
- [x] 同步帮助、README 与文档站，去除过时引导提问，说明损坏保护、重配确认及官方登录恢复。
- [x] 运行 make test、shellcheck install.sh、make build；文档站运行 npm run build。macOS 跳过的 Linux 安装器场景在推送后由 Linux CI 验证。

## Task 3：交付前核对

- [x] verification-before-completion、consistency-check、post-verification-check，记录结果及局限。

## 验证后交付动作

实现任务完成后提交并推送 Bee 与文档站，更新现有英文 PR，附合成 Hive 的真实终端录制。推送后确认最新 Linux CI，构建包含最终提交标识的本地 bin/bee，并报告测试方法。远端结果记录在 PR 与最终回复，避免在包含自身提交动作的文件中提前声明交付完成。
