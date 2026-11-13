# Bee 按 URL 切换 Hive

用户已批准规格并明确直接 implement-spec，不编写实施计划。此处为既有本地跟踪器要求的任务依赖图。

集成分支：Bee `codex/bee-hive-url-switching`；Hive `codex/hive-url-switching`（独立 Git 仓库各保留一条集成分支）。

测试边界已随规格确认：公开协议／真实数据库准入、Go 后台与 Rust 命令、正式 UI／原生生命周期、两个隔离 Hive；不重复询问。

依赖：01→03→04；01+02→05；04+05→06；06→07、08；07+08→09。

当前状态：01–09 均已完成，真实任务／两套 Hive／Linux 原生 App 验收及最终双轴审查已完成；审查发现均已修复。验证范围和限制见[最终交付记录](../../docs/desktop/evidence/2026-11-13-hive-switch-final-review/README.md)。Hive PR [#307](https://github.com/tokhive/hive/pull/307) 承载服务端、最终 Bee 依赖及验收证据；合并时关闭父议题 [#302](https://github.com/tokhive/hive/issues/302) 与子议题 [#303](https://github.com/tokhive/hive/issues/303)、[#304](https://github.com/tokhive/hive/issues/304)，当前不提前关闭。

- [01 共享安全切换协议与地址判定](issues/01-protocol.md)
- [02 独立 Hive 数据目录、旧数据迁移与进程归属](issues/02-profile-storage.md)
- [03 Hive 停止新派单并查询旧任务](issues/03-hive-drain.md)
- [04 Hive 安全封存、取消和重新激活](issues/04-hive-seal-release.md)
- [05 Bee 后台支持受限准备与安全交接](issues/05-backend-handoff.md)
- [06 App 执行 A→B→A 的持久切换](issues/06-coordinator.md)
- [07 取消、退出和重启继续原切换](issues/07-recovery.md)
- [08 概览设备区的紧凑切换入口与真实反馈](issues/08-interface.md)
- [09 两套 Hive 往返与故障验收](issues/09-acceptance.md)
