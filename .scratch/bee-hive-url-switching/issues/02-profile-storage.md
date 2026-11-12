# 02: 独立 Hive 数据目录、旧数据迁移与进程归属

**What to build:** App 为不同 Hive 使用独立私有目录，首次升级保留原记录，后台启动和恢复始终带固定归属。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] 索引、迁移日志、备份及 Rust 恢复日志持久化，崩溃可继续；原始 origin／摘要不改写。
- [ ] 旧程序在迁移后无法继续使用旧入口；已有旧 worker／不明记录不被自动清理。
- [ ] 代理按 profile 路由，历史冲突局部阻塞；全局偏好保留。
