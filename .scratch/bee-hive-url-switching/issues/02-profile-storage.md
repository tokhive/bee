# 02: 独立 Hive 数据目录、旧数据迁移与进程归属

**What to build:** App 为不同 Hive 使用独立私有目录，首次升级保留原记录，后台启动和恢复始终带固定归属。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 索引、迁移日志、备份及 Rust 恢复日志持久化，崩溃可继续；原始 origin／摘要不改写。
- [x] 旧程序在迁移后无法继续使用旧入口；已有旧 worker／不明记录不被自动清理。
- [x] 代理按 profile 路由，历史冲突局部阻塞；全局偏好保留。

**进度：** `aad3edd` 已无冲突合入 `cad1336`。合并后 Rust profile 17 项、固定启动归属 1 项及 Go 旧入口迁移拒绝测试通过。App 生命周期接线已由 05／06 完成；真实原生往返验收见 09，以上数字保留本票初次交付范围。
