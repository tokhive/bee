# Bee Linux 安装启动向导实施计划

> 执行方式：用户已批准推荐设计并要求实现；使用 executing-plans，在现有隔离 worktree 中逐项执行，不重复申请执行许可。

**目标：** 安装后引导用户完成配对、选择账号并启动 systemd 后台服务，更新现有两个 PR。

**设计依据：** `docs/superpowers/specs/2026-10-23-linux-install-wizard-design.md`。

**架构：** 沿用安装脚本、已有 login/setup 和系统服务。伪终端验证真实交互，外部下载、提权和服务命令继续隔离。

**技术栈：** POSIX sh、systemd 243+、Python 3.9+ 标准库、GitHub Actions、ShellCheck；无新增运行时依赖。

## 全局约束

- 延续安装身份、配置目录、校验和 unit 保护规则。
- 向导从控制终端交互，支持管道安装；无终端或 `BEE_INSTALL_INTERACTIVE=0` 时跳过。
- 首次启动默认是；活跃服务重启默认否；不强制选择账号、不杀前台进程。
- 失败停止并保留证据；服务实际 active 后才报告启动成功。
- 在 `feat/linux-autostart` 和 `docs/bee-linux-autostart` 分支增量提交，不合并 PR。

## Task 1：安装启动向导与回归测试

**文件：** `install.sh`、`scripts/test-install.py`。

- [ ] 扩展真实安装测试夹具：测试归档中的 Bee 支持并记录 login/setup，systemctl 支持实际状态和故障注入；用标准库伪终端执行 stdin 为脚本管道的 `/bin/sh`。
- [ ] 编写并运行首次安装交互测试，确认现有脚本缺少 login/setup/start 而失败：`python3 scripts/test-install.py InstallTest.test_terminal_install_pairs_sets_up_and_starts_service`。
- [ ] 实现控制终端入口、交互开关、默认答案、服务状态分支、已有 CLI 配对/账号设置和启动后的状态确认；不解析设备 JSON，不新增 CLI 协议。
- [ ] 覆盖已配置及未完成配对、拒绝/EOF、无终端及关闭开关、活跃服务重启选择、过渡/未知状态、命令失败、未实际 active、自定义路径；运行定向测试确认通过。
- [ ] 运行 `make test-install`、ShellCheck 与 `git diff --check`；修正真实失败后再进入文档。

## Task 2：说明、审查与 PR 更新

**文件：** `README.md`、独立仓库 `doc-site/docs/provider/install.mdx`，本 spec/plan/decision trace。

- [ ] 更新首次安装向导、已配对/运行状态、拒绝或无终端的手动路径、交互开关、升级默认不重启和失败恢复说明；清除旧的必需前台 Ctrl-C 步骤。
- [ ] 运行 `doc-site` 的 `npm run build` 和两个仓库的差异检查；检查完整 diff 与 spec 一致。
- [ ] 按 requesting-code-review 做针对本次安装向导的审查，核实并修复有效问题；完成最终验证、一致性和计划复选项核对。
- [ ] 提交并推送到已有 fork 分支，重写 Bee #20 和文档 #1 的 PR 说明，使其描述最终行为；检查 Linux CI，记录结果与真实未验证边界。
