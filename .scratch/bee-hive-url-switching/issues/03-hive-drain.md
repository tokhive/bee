# 03: Hive 停止新派单并查询旧任务

**What to build:** Hive 接受设备临时停接请求，保留旧连接和任务，不改用户暂停选择，并准确报告等待原因。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 01 共享安全切换协议与地址判定

**Status:** implemented

- [x] 数据库持久化原操作；与最终准入锁一致，begin 与并发派单有确定归属。
- [x] 能力和状态查询；包含执行、未知终止、未结算；数据库实测。
- [x] 设备替换／退役互斥，不因超时自动解除。

已合入 Hive `b2942e9`；真实数据库、隧道与派单竞争定向 race 通过（48.576 秒），合入检查通过。完整回归中的 Linux 专用入口和一次注册超时另行记录，不计为全部通过。最终双 Hive 验收仍待 09。

**Hive issue:** https://github.com/tokhive/hive/issues/303
