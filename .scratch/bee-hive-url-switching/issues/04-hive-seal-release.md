# 04: Hive 安全封存、取消和重新激活

**What to build:** 任务结束后可安全断开；等待时可取消；重连后可恢复，旧请求不能影响新操作。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 03 Hive 停止新派单并查询旧任务

**Status:** ready-for-agent

- [ ] seal 确认旧连接消失、推进 epoch，固定保存原回执。
- [ ] release 绑定原操作和当前身份／epoch／lease，取消先到时保留终结标记。
- [ ] 真实 PostgreSQL 和连接流程覆盖重复／并发、响应丢失及旧客户端。

**Hive issue:** https://github.com/tokhive/hive/issues/304
