# 03: 可信启动分流及跨绑定会话完成页

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-ui/docs/desktop/first-launch-design.md

**Status:** ready-for-agent

**Blocked by:** 01 — 首次设置向导的完整界面

**What to build:** 将01向导接入 NativeApp。集中 actual route admission 覆盖通知/内部/侧栏；配置未知/失败不误判首次；首次事务续接；已绑定/凭据恢复沿用原工作区；session tracker位于绑定 revision remount 之上；完成页精确关联同事务/新上下文，持久化后可信回执成功才完成；不额外轮询。诊断与必要修复在 gate 中可达且返回保留草稿，自动账号读取仅现有页面 active。使用 spec 已确认 React/bridge seams 做 TDD。

**Acceptance:** 首次成功跨 revision 停完成页→用户导航；重启已绑定到概览；未知/损坏/首次事务/旧绑定恢复正确分流；通知不能绕过；旧作用域回执不污染；无额外 begin/restore/account writes。

**Ownership:** desktop/src/app/NativeApp.tsx；必要新 system/firstLaunch.ts；必要 coordinator 最小事实适配；desktop/tests/first-launch*.test.ts、first-launch-integration.spec.ts；必要 bridge fixture 支持。01组件 API适配可改；不扩大已定UI。

实现记录写在本票末尾：red→green证据、命令/结果、提交及限制；未实测系统路径不得宣称通过。
