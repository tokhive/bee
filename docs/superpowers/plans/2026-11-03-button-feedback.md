# Bee 异步按钮反馈实施计划

> 执行方式：用户在中断后明确指示“继续，后续不要用子代理……直接用 executing-plans”。由主代理直接执行本计划，不使用子代理。此前“我觉得可以”仅表示认可方向，不视为书面 spec 批准。

**目标：** 完成两个按钮从点击到真实结果的反馈，并形成同类入口检查记录。
**架构：** 通知后台提供真实可重试数量及检查序号；设置页按操作保存就地反馈，复用现有状态隔离机制。
**技术栈：** 沿用设计列出的 React / Tauri / Rust / Playwright，不新增依赖。

## 全局约束

保留已有工作树改动和布局。系统检查只读。未知投递不重发。完整错误证据保留。中英文同步。只改本次相关文件，不提交混合工作树。

## Task 1：原生通知回执与恢复

文件：desktop/src-tauri/src/notifications.rs、notification_poll.rs、commands.rs 及对应测试。
接口：按 spec 的 notification_delivery_status 和 notification_retry 契约。
- [x] 覆盖无失败、明确拒绝、重复重试、未知提交、恢复清错及检查失败回归；接手时原生实现及测试已落盘，本轮直接审查并验证 GREEN，未追认此前 RED。
- [x] 从现有账本导出数量；重试返回数量，零项不改 revision；保留未知/已接受去重。
- [x] 分离读取错误和投递错误；成功读取仅清对应错误，接受/权威恢复清投递错误；推进检查序号。
- [x] 运行 `cargo test --lib notification`，检查失败证据和行为边界。

## Task 2：设置页就地反馈

文件：desktop/src/system/notifications.ts、features/settings/NativeSettingsPage.tsx、native-settings.css、i18n/en.ts、tests/notifications.test.ts、tests/native-experience.spec.ts、tests/fixtures/native-accounts.mjs。
消费：Task 1 的原生契约。沿用 draft / scope / read generation 防止过期响应。
- [x] 覆盖慢查询、双击、无变化、部分失败和重试结果；补充焦点、故障分类和跟踪期间防重试的回归，并验证 RED → GREEN。
- [x] 严格解码契约，执行中按钮文字及 aria-busy；结果固定在各按钮旁。
- [x] 系统检查汇总事实，通知重试跟踪真实后台结果；超长等待和读取失败提供明确继续入口。
- [x] 同步 fixture、英文与 CSS，验证 `node --test tests/notifications.test.ts`、`npm run typecheck` 和 native-experience 浏览器测试。

## Task 3：检查、审查与交付

文件：desktop/src/presentation/problems.ts、desktop/tests/problems.test.ts、本计划、设计及 docs/superpowers/reports/2026-11-03-button-feedback.md。
- [x] 检查概览、账号、诊断、设置、更新入口的异步按钮，记录已满足与待改入口，不宣称全 App 已修复。
- [x] 浏览器验证两个样板的正常、失败、恢复以及窄窗/主题/英文；记录真实 OS 验收限制。
- [x] 审查本次差异，运行必要回归，执行一致性检查并更新本计划状态。
