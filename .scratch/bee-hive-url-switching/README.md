# Bee 按 URL 切换 Hive

用户已批准规格并明确直接 implement-spec，不编写实施计划。此处为既有本地跟踪器要求的任务依赖图。

集成分支：Bee `codex/bee-hive-url-switching`；Hive `codex/hive-url-switching`（独立 Git 仓库各保留一条集成分支）。

测试边界已随规格确认：公开协议／真实数据库准入、Go 后台与 Rust 命令、正式 UI／原生生命周期、两个隔离 Hive；不重复询问。

依赖：01→03→04；01+02→05；04+05→06；06→07、08；07+08→09。

当前执行：01–06 已实现并合入，07 取消／退出／预算与归属恢复已实现，08 正式紧凑界面正在实施，09 等待正式 UI 合入后完成整体验收。06／07 已完成相关 Go race gate 和 Rust 分组验证，真实 Hive／Postgres／任务结算及原生验收仍归 09。Hive 草稿 PR [#307](https://github.com/tokhive/hive/pull/307) 已更新到完整服务端生命周期，尚未完成 Bee 整体交互和整体验收。Hive 父议题 [#302](https://github.com/tokhive/hive/issues/302)，03→[#303](https://github.com/tokhive/hive/issues/303)，04→[#304](https://github.com/tokhive/hive/issues/304)。

- [01 共享安全切换协议与地址判定](issues/01-protocol.md)
- [02 独立 Hive 数据目录、旧数据迁移与进程归属](issues/02-profile-storage.md)
- [03 Hive 停止新派单并查询旧任务](issues/03-hive-drain.md)
- [04 Hive 安全封存、取消和重新激活](issues/04-hive-seal-release.md)
- [05 Bee 后台支持受限准备与安全交接](issues/05-backend-handoff.md)
- [06 App 执行 A→B→A 的持久切换](issues/06-coordinator.md)
- [07 取消、退出和重启继续原切换](issues/07-recovery.md)
- [08 概览设备区的紧凑切换入口与真实反馈](issues/08-interface.md)
- [09 两套 Hive 往返与故障验收](issues/09-acceptance.md)
