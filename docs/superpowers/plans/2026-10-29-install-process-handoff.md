# 安装器手动进程接管实施计划

> 执行方式：在本会话按 executing-plans 逐任务实现，遵循 test-driven-development；已获用户批准继续实施，不重复请求设计批准。

**目标：** 安装器经确认停止同配置的手动 Bee，释放锁后完成 systemd 接管。

**架构：** 内部 Go 命令负责原生进程识别、确认与停止；POSIX 安装器仅在 login 的明确锁冲突后调用它并有限重试。身份核验与信号在同一 pidfd 生命周期内完成。

**技术栈：** 沿用 Go 1.27.3、golang.org/x/sys v0.48.0、POSIX sh、Python 3、systemd 243+；Linux 原生 /proc 与 pidfd，不新增运行时依赖。

## 全局约束

- 默认否，只有明确同意后发送 SIGTERM；拒绝/EOF/无终端不停止进程。
- 只接管同用户、同配置锁的 Bee run/start/菜单；身份不明、内核不支持、超时或锁变化时停止。
- 不删除配置或锁、不使用 SIGKILL、不批量结束进程；原始失败证据可见。
- 文档中文；不提交凭据，不扩张 active 服务重启与桌面菜单行为。

## Task 1：原生锁持有者识别与确认停止

**文件：** 新增 agent/install_handoff_linux.go、agent/install_handoff_other.go、agent/install_handoff.go、agent/install_handoff_linux_test.go；修改 agent/cli.go、cmd/bee/main.go、go.mod（现有 x/sys 改为直接依赖）。

**接口：** `installHandoff(ctx context.Context, args []string, out io.Writer) error`；取消用内部哨兵返回，CLI 转为退出码 3。Linux 执行函数接受 io.Reader 与等待时限供测试使用，生产固定 os.Stdin 与 10 秒。

- [x] 先写 Linux 子进程测试，覆盖真实 flock、确认/拒绝、错误身份与退出超时，运行 GOOS=linux GOARCH=arm64 go test -c ./agent，记录缺少实现导致的失败。
- [x] 实现 /proc/locks 唯一持有者解析、pidfd 身份固定、UID/build info/命令/cgroup 核验与确认；上下文取消和底层失败带 PID/路径等证据；非 Linux 明确拒绝。
- [x] Linux 容器运行原生测试，确认 pidfd_send_signal 只影响测试创建的目标；扩展锁变更、身份变化和输入 EOF 等边界用例。

## Task 2：安装向导衔接与文档

**文件：** 修改 install.sh、scripts/test-install.py、README.md、.github/workflows/ci.yml；必要时补 agent/install_ui.go 注释。

**接口：** `run_bee install-handoff --config "$config_path"` 返回 0 可有限重试，3 取消向导，其余退出并保留原始诊断。

- [x] 先写伪终端用例：原始 login 锁冲突后询问接管，中英文接受、拒绝/EOF、失败与旧版不支持；断言停止后 login 重试且仅一次、服务启动在其后，先运行观察失败。
- [x] 实现明确锁冲突分支、兼容提示与有限重试；重新保存配置快照，保留既有撤销配对恢复；不改变其他分支。
- [x] 安装器移除语言选择，默认使用英文且不跟随系统 locale；保留显式 BEE_LANG=zh，并更新中英文、终端 EOF 和 locale 回归及 README。
- [x] README 更新交互、取消与失败处理、pidfd/新发行版要求；运行 make test 和 shellcheck install.sh，原生 Linux 接管回归及 Linux/macOS 构建；CI 用独立 cgroup 的 Linux 容器运行真实进程用例，避免测试进程继承 runner service 导致被正确拒绝。
- [x] 请求独立代码审查并修复有效问题；核对设计、计划、代码、测试、README 一致，记录验证结果并勾选任务。

## 执行与验证记录

- TDD：新增 Linux 测试先因 handoffWithInput、ErrInstallHandoffCancelled 等实现缺失而编译失败；安装器新增中英文接管用例先复现 login 锁冲突后直接退出，再实现衔接并通过。
- 独立审查发现确认读取不响应取消、取消退出码可能让向导继续、user@ 前缀豁免过宽；均以真实 TTY 或元数据回归先复现失败再修复，复核无未解决 P1/P2。
- make test：69 项安装器回归通过（macOS 跳过 2 项 Linux 原生 systemd 检查），16 项菜单回归通过，go vet ./... 与 go test -race -timeout=600s ./... 通过。
- Linux arm64 原生：在 Ubuntu 24.04 非 root 容器中运行完整接管测试，真实 flock、pidfd、已替换并删除的旧可执行文件、TTY 接受/拒绝/EOF/Ctrl+C、锁变化、替代持有者、超时和上下文取消均通过；测试进程只停止本用例创建的目标。
- 独立故障注入：seccomp 令 pidfd_open 返回 ENOSYS，测试确认停止在询问与发信号前，旧 Bee 保持运行。
- shellcheck install.sh、git diff --check、CI YAML 解析、GOOS=linux GOARCH=arm64 go vet ./...、Linux amd64/arm64 构建均通过；macOS 构建由菜单回归与 make test 覆盖。
- 自动接管需要新 Bee 发行版；仅更新安装脚本、下载旧版资产时会保留诊断并提示手动停止。本次只修改本地代码，未发布发行版。
