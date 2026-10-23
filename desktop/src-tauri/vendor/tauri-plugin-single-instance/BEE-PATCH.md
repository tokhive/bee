# Bee 本地修补（P0，尚未三端验收）

来源为官方 `tauri-plugin-single-instance 2.5.4` crate，SHA256：
`561cd99484561bc39c954768e7b41a66cebbe1ac3d9d081c34361f740c489e2c`。
保留上游 MIT / Apache-2.0 许可证。版本不伪装成新上游发布。

macOS 的原实现先返回 setup，再在异步任务中 bind；bind 失败仅记录日志并继续，通知与清理也没有原子边界。Bee 在原生桥创建前要求唯一实例，因此保留此源码并作本地修补：

- 用当前用户独占、no-follow、单链接的 0600 文件锁串行化通知/清理/绑定；10 秒锁等待失败即停止启动，不删除锁文件，避免锁 inode 更换。
- 在 setup 中完成实际 socket bind，失败传回 Tauri，不放行 App/Bee setup；只清理由当前用户持有的 stale socket。
- 给转发设置 64 KiB 上限、2 秒读写期限和接收确认；第二实例收到确认才成功退出。诊断不包含参数/回跳 URL。
- socket 权限为 0600；endpoint 和锁名包含当前 UID，避免不同 OS 用户互相阻塞。启动锁只串行化注册；主实例另持有生命周期锁，直到 App state 释放。即使 listener 失效，也不放行第二个管理进程。
- 移除插件在 `RunEvent::Exit` 提前删除 endpoint 的回调；App 先 stop/reap owned Child，再显式调用 `destroy`。不按进程名查杀。

`startup_lock.rs` 与根工程 `src/singleton_tests.rs` 已做 RED→GREEN：锁独占、释放、拒绝 symlink/公开权限文件，以及实际插件注册失败阻止后续 setup。当前沙箱同时禁止 TCP 与 Unix socket bind，正向投递/并发冷启动仍须原生环境验证，不能据此勾选任务 5 全部验收。

Windows 修补：已有 mutex 时有界等待有效 HWND，超时、NULL handle、转发失败或未确认接收均返回错误，不再继续 App setup；只在确认投递后退出第二实例。原生 handle 采用幂等释放，窗口 callback allocation 由 state 持有，创建失败与显式退出不会重复释放。纯策略的 4 项测试已 RED→GREEN；Win32 adapter 尚未在 Windows 编译/运行，不能据策略测试宣称原生通过。

Linux 修补：session builder、D-Bus 注册或转发失败均阻止 App setup；成功取得名字后，先获取含 UID 的当前用户生命周期文件锁，再暴露 callback，避免旧 bus 断开后出现第二个管理进程。使用与 macOS 相同的 no-follow/所有者/权限检查。两种失败 session 地址通过真实 Linux adapter、zbus 与 MockRuntime 隔离子进程测试 RED→GREEN；这不是 Linux 原生正向 D-Bus/桌面验收。

三端均由 App 在 owned Child 回收后显式释放系统入口；真实 stubborn child 的回归先复现释放时仍为 Ready，再修为 Stopped。Windows/Linux 原生编译及正向单实例、回跳、托盘与退出矩阵仍是任务 5 缺口。上游可满足 Bee 不变量并通过原生矩阵后，应优先移除此本地副本，恢复 registry 依赖。

P0 不启用此插件的 `deep-link` feature；不注册 deep-link 运行时插件。回跳只通过原生事件/转发参数即时提取 bool。bundler 的开发协议配置单独保留。
