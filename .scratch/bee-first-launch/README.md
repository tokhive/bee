# Bee 首次启动向导

2026-11-12。用户明确授权 implement-spec，spec见 ../../docs/desktop/first-launch-design.md。跟踪器沿用 docs/agents/issue-tracker.md 的本地Markdown规则。

依赖：01 → 03 → 04；02 → 04。初始前沿01、02；各票独立worktree，integration branch codex/bee-first-launch，review baseline 14e639a（合同来源55ef816；保留同期已有文档提交）。无远程issue/PR。

- [01 首次设置向导的完整界面](issues/01-wizard-ui.md)：done；Blocked by None
- [02 首次配对持久化恢复故障证据](issues/02-initial-recovery-evidence.md)：done；Blocked by None
- [03 可信启动分流及跨绑定会话完成页](issues/03-startup-integration.md)：in-progress；Blocked by 01 — 首次设置向导的完整界面
- [04 真实前端回归与首次向导验收](issues/04-regression-acceptance.md)：ready-for-agent；Blocked by 02 — 首次配对持久化恢复故障证据；03 — 可信启动分流及跨绑定会话完成页
