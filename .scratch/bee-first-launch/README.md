# Bee 首次启动向导

2026-11-12。用户明确授权 implement-spec，spec见 ../../docs/desktop/first-launch-design.md。跟踪器沿用 docs/agents/issue-tracker.md 的本地Markdown规则。

依赖：01 → 03 → 04；02 → 04。初始前沿01、02；各票独立worktree，integration branch codex/bee-first-launch，review baseline 14e639a（合同来源55ef816；保留同期已有文档提交）。无远程issue/PR。

- [01 首次设置向导的完整界面](issues/01-wizard-ui.md)：done；Blocked by None
- [02 首次配对持久化恢复故障证据](issues/02-initial-recovery-evidence.md)：done；Blocked by None
- [03 可信启动分流及跨绑定会话完成页](issues/03-startup-integration.md)：done；Blocked by 01 — 首次设置向导的完整界面
- [04 真实前端回归与首次向导验收](issues/04-regression-acceptance.md)：done；Blocked by 02 — 首次配对持久化恢复故障证据；03 — 可信启动分流及跨绑定会话完成页

最终双轴审查已完成：Standards 2 项、Spec 2 项均在 `6c1d7f2` 修复，并由原审查者限定复核关闭；集成合并 `50dcfc4`。验证结果及人工／系统未实测边界见 [验收记录](../../docs/desktop/evidence/2026-11-12-first-launch/validation.md)；审查结论见 [双轴报告](../../docs/desktop/evidence/2026-11-12-first-launch/review.md)。原 Ego taskspace 115 已不存在，新增人工复查尚待恢复浏览器验证条件；不将该环境问题改写为产品验收通过。
