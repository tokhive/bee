# 09: 两套 Hive 往返与故障验收

**What to build:** 用隔离 Hive 与原生 App 验证规格矩阵并记录直接证据，再完成双轴审查。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 07 取消、退出和重启继续原切换; 08 概览设备区的紧凑切换入口与真实反馈

**Status:** ready-for-agent

- [ ] 真实任务、结算与派单竞争；A→B→A、首次 B 无账号、取消与重启。
- [ ] 迁移、来源变化、旧事件、提交崩溃点、能力不支持均有证据。
- [ ] 相关 Go／Rust／TS 测试与构建通过；未实测范围明确记录。
