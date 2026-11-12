# 07: 取消、退出和重启继续原切换

**What to build:** 用户取消和退出意图被保存；崩溃后核对原操作，不重复写入或丢失配对子事务。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 06 App 执行 A→B→A 的持久切换

**Status:** ready-for-agent

- [ ] 取消与提交串行；未知保持占位，已成功不能改成取消成功。
- [ ] 主动退出可继续等待／取消并退出；意外崩溃继续，重启不刷新预算。
- [ ] 2 秒查询／60 秒观察／最多三次失败重试；旧响应与通知带归属。
