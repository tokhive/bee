# 安装器手动 Bee 进程接管设计

## 目标与已确认交互

用户已批准：安装向导验证已有配对时，如同一配置被手动启动的 Bee 占用，展示 PID、当前用户和配置路径，询问是否停止并转由 systemd 后台运行，默认否。提示当前任务会被中断。同意后发送 SIGTERM，等待旧进程退出、配置锁释放，再继续配对验证、供给检查和服务启动。拒绝或 EOF 保留旧进程并结束向导。

无法确认身份、停止超时、锁被另一进程接管时，停止并报告实际证据，提示手动处理。禁止删除配置/锁文件、按进程名批量结束进程或升级为 SIGKILL。

## 技术与实现边界

沿用 Go 1.27.3、POSIX sh、Python 3 伪终端回归、systemd 243+ 和现有 golang.org/x/sys v0.48.0，不新增运行时依赖。Linux 原生 /proc 负责定位 flock 持有者；pidfd 固定进程身份并发送信号，内核不支持时退回手动处理。这些是已批准交互的实现选择。

新增安装器内部命令 `bee install-handoff --config PATH`，仅 Linux 支持；语言沿用 BEE_LANG。它自己完成确认，避免 shell 将 PID 在不同命令之间传递。仅在已有 login 明确报告配置锁冲突后调用。旧发行版不支持该命令时保留原始错误，并提示手动停止旧进程；普通安装和 active 服务重启分支不受影响。

安装器和 Bee 进程默认直接使用英文，不再展示语言选择，也不根据系统 locale 切换语言。保留显式 `BEE_LANG=zh` 中文设置。安装器把语言传给 login、setup 和 install-handoff。Bee 管理菜单仍可在当前会话中切换语言，不写入服务或账号配置。

## 身份与时序

1. 以 O_NOFOLLOW 打开现有锁文件，使用 flock 核对真实占用，不把文件存在当作占用。
2. 按设备号和 inode 在 /proc/locks 中找出唯一排他 FLOCK 持有者；持有者必须是当前用户的真实 Bee 可执行程序（Go build info 的命令路径），并处于 run/start 或交互菜单入口。systemd service cgroup 中的进程要求手动管理；仅豁免当前 UID 的标准 user.slice/user-UID.slice/user@UID.service 用户管理器祖先，其下的自定义 .service 仍拒绝。
3. 打开 pidfd 后再次验证锁归属、用户、可执行程序和运行命令；确认前显示 PID、用户 UID、配置路径，不输出完整命令行或凭据。
4. 用户同意后重新核对身份和锁归属，使用 pidfd_send_signal 发送 SIGTERM。轮询等待最多 10 秒；确认读取和退出等待均响应上下文取消；取消返回退出码 3，安装器不继续。超时或底层检查失败立即停止，不发送 SIGKILL。
5. 退出后复核锁文件 inode 未变且可获得排他锁。占用已更换时失败。随后安装器重新保存配置快照，只重试 login 一次，后续仍走既有锁与服务验证。
6. 拒绝/EOF 返回明确的取消结果，安装器正常结束向导而不启动服务；其他失败保留具体诊断和退出状态。无终端或关闭交互的安装不进入接管。

## 验证矩阵

Linux 原生锁与真实 Bee 子进程：同意停止、拒绝/空输入/EOF 保留、退出后锁释放；非 Bee、其他 UID、错误命令、service cgroup、身份/锁变化、pidfd 不支持、停止超时和重新占锁均不误发信号。使用原生 /proc 锁记录交叉检查定位逻辑。

安装器伪终端：中英文同意、拒绝/EOF、旧版本兼容、接管失败保留原始证据、login 最多重试一次、重试前快照更新、后续撤销配对恢复仍能继续；active 服务、非交互、binary-only 分支不调用内部命令。

验证命令：make test、shellcheck install.sh；Linux 容器运行交叉编译测试二进制，覆盖真实 pidfd 和 /proc 行为。CI 的 runner 属于 systemd service 时，原生子进程用例在 make test 中明确说明跳过原因，并由独立 cgroup 的容器步骤完整运行。README 同步交互及新发行版要求。
