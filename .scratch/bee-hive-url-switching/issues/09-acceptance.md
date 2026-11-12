# 09: 两套 Hive 往返与故障验收

**What to build:** 用隔离 Hive 与原生 App 验证规格矩阵并记录直接证据，再完成双轴审查。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 07 取消、退出和重启继续原切换; 08 概览设备区的紧凑切换入口与真实反馈

**Status:** 验收证据已齐，最终双轴审查待完成

- [x] 生产 Rust 协调器管理固定 profile Go 子进程，真实 Hive/PG 推理、TEE、结算、unknown/unsettled、release 丢失重启及 A→B→A；独立 Linux 完整原生 App 首次 B 零账号、取消/退出/崩溃重启与预算保留通过。
- [ ] 最终审查核对迁移、来源变化、旧事件、提交崩溃点和能力不支持的证据范围；回归测试通过，未将全部故障注入声称为真实 GUI 实测。
- [x] Go race／Rust 350／TS 342／切换预览 10 项及生产前端构建通过，未实测范围已记录。

真实任务与结果：[验收报告](../../../docs/desktop/evidence/2026-11-12-hive-switch-acceptance/README.md)。真实 GUI：[原生记录](../../../docs/desktop/evidence/2026-11-12-hive-switch-native/README.md)。Bee 运行源码 `4a1c2fc`，Hive 测试 fixture `6f70276`；原生 GUI 源码 `9a254fb`。本票证据提交后交集成负责人完成全分支标准/规格双轴审查，不在这里提前宣称全项目完成。
