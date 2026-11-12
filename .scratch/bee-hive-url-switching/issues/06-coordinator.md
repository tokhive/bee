# 06: App 执行 A→B→A 的持久切换

**What to build:** 准备目标、等待旧任务、交接后台、提交当前 Hive 并解除目标停接；每个 Hive 恢复自己的账号选择。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 04 Hive 安全封存、取消和重新激活; 05 Bee 后台支持受限准备与安全交接

**Status:** ready-for-agent

- [ ] 仅一笔切换；A 继续工作直到 B 预检成功，提交前 B 无接单。
- [ ] journal 与索引提交窗口可核对，明确失败安全返回 A，成功后的账号故障留 B。
- [ ] 所有关键阶段核验绑定版本、进程实例和 profile；离线证据充分才可离开。
