# 06: App 执行 A→B→A 的持久切换

**What to build:** 准备目标、等待旧任务、交接后台、提交当前 Hive 并解除目标停接；每个 Hive 恢复自己的账号选择。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 04 Hive 安全封存、取消和重新激活; 05 Bee 后台支持受限准备与安全交接

**Status:** done

- [x] 仅一笔切换；A 继续工作直到 B 预检成功，提交前 B 无接单。
- [x] journal 与索引提交窗口可核对，明确失败安全返回 A，成功后的账号故障留 B。
- [x] 所有关键阶段核验绑定版本、进程实例和 profile；离线证据充分才可离开。

实现提交 `9bd57cf`，命令测试 fixture 修复 `423feca`，包含集成提交 `1a23dec`。原生协调器测试使用实际 bundled Go 子进程及两个合成 HTTP/WS 服务，覆盖 A→B→A、原写请求丢响应后只查询、明确失败返回 A、源离线／已回收不重拉、索引提交窗口和终态普通重启。Go 完成准入标记保留历史 receipt，并要求后续 epoch 变化具备已完成的普通 session-retirement 证明。

验证：相关 Go race gate 全通过。Rust 首轮完整 lib 为 320 passed、17 failed、5 ignored；失败均在 sidecar 组，修复五处命令 fixture 的 CurrentBridge 注入后，以原 deadline、`--test-threads=2` 重跑完整 sidecar 组，52 passed、0 failed、1 ignored（199.13s）。其余模块沿用首轮通过结果；需要签名／原生／真实 Hive 环境的 ignored 项不计通过。

07 已完成取消／退出／预算／迟到事件及首次错误地址的安全修正，08 已完成正式交互；真实 Hive／Postgres／任务结算和原生验收见 09。以上保留本票初次交付数字，合成服务证据不代替真实验收。
