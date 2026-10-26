# 安装器旧配对恢复实施计划

> 用户已批准上述恢复流程；在现有隔离 worktree 继续实现和更新既有 PR。按 executing-plans 执行，测试与审查不重复请求已授权工作的许可。

**目标：** v0.0.6 旧凭证遭拒绝后能经用户确认恢复配对，保留账号选择。
**设计：** `docs/superpowers/specs/2026-10-26-install-repair-design.md`。
**技术：** POSIX sh、Linux flock/systemd、Python 伪终端、现有 ShellCheck/Go/CI/Docusaurus。

## 约束

- 只识别已知完整错误行；其他登录失败停止并保留原始诊断/退出码。
- 恢复默认否，EOF 不授权；询问 Hive 地址后才停止服务和移走旧配置。
- flock 保护配置移动，锁内拒绝文件变化；唯一私有目录保留原设备配置，供给配置不变。
- 新配对仍要网页确认；失败保留新配对状态及旧备份，不输出运行成功。
- 中英文、三步流程和旧二进制兼容要求沿用。

## Task 1：兼容恢复与回归

文件：`install.sh`、`scripts/test-install.py`、`README.md`、`doc-site/docs/provider/install.mdx`。

- [x] 扩展已有伪终端夹具，复现 v0.0.6 的已绑定凭证错误；编写接受/拒绝/EOF、配置与供给保留以及失败和竞争矩阵，运行定向测试确认 RED。
- [x] 抽出第 1 步配对函数，实现已知错误识别、默认否确认、锁内备份及继续配对；翻译所有新增用户文案，沿用原诊断及退出码。
- [x] 更新 README/指南和已有设计的恢复分支说明，运行安装回归、ShellCheck、差异检查及文档构建；审查本任务并修复有效问题。
- [x] 更新既有两个 PR，检查 Linux CI，完成一致性与计划复核并记录证据。

## 验证记录

- RED：新增中文恢复与拒绝/默认否/EOF 测试在原脚本上失败，输出与用户 v0.0.6 报错一致，在第 1 步退出，未提供恢复确认。
- GREEN：`python3 scripts/test-install.py` 共 64 项，62 项通过，2 项 Linux 原生检查在 macOS 跳过；ShellCheck、`sh -n`、差异检查和文档站构建通过。
- 真正控制终端由临时测试夹具提供；当前文件系统沙箱阻止安装器打开 /dev/tty 时会跳过向导，因此 PTY 回归在获准的沙箱外运行，下载/sudo/systemctl 均为模拟工具，未操作真实服务或凭证。
- 规格及质量审查未发现阻塞项。两处新增中文失败操作标签已修复；中文成功恢复及备份失败实际转录再次通过，备份失败原退出码 8 和旧配置均保留。
- 缺少 flock 的回归夹具已兼容 sha256sum/shasum，单项复核通过。Linux CI 将使用原生 flock 与 systemd 检查。
- Linux CI 修正：将 shell 文件检查改为显式 if，通过 ShellCheck；缺少 flock 的隔离 PATH 夹具补入 GNU tar 所需的 gzip，单项回归通过。
- [Bee Linux CI](https://github.com/tokhive/bee/actions/runs/40269390226) 在 05c36db 全部通过：64 项安装回归无跳过，包含 Linux 原生 flock 和 systemd 检查；ShellCheck、go vet、go test -race 均通过。
- [文档站 CI](https://github.com/tokhive/doc-site/actions/runs/40268854522) 在 0bb9041 通过；Bee #20、文档 #1 均已更新恢复行为与验证证据。未合并或发布 release，也未进行真实云服务器重启测试。
- 一致性复核：会话决策与默认否授权边界一致；恢复 spec/计划内部一致；实现、测试及 PR 描述一致；配置路径、锁与旧 CLI 参数一致；README 和安装指南的恢复行为及发布兼容边界一致。未发现本次恢复范围内的矛盾。
- 计划复核：共 4 项，复核前已完成 3 项，本次补记 1 项，未完成 0 项。
