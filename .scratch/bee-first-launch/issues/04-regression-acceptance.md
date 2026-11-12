# 04: 真实前端回归与首次向导验收

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-ui/docs/desktop/first-launch-design.md

**Status:** in-progress

**Blocked by:** 02 — 首次配对持久化恢复故障证据；03 — 可信启动分流及跨绑定会话完成页

**What to build:** 运行并修复首次绑定门槛影响的真实前端回归。旧测试中首次未绑定浏览常规页的期望按新 spec 更新；非本次目标页的测试应使用可信已有绑定fixture而非绕过gate。补齐完成页/浏览器打开前过期/失败未知/no replay等缺口，执行 typecheck/build、Node 单测、受影响Playwright；记录自动/受控/真实系统边界。不要删除断言或通过假绑定掩盖首次场景。

**Acceptance:** 新验收矩阵可追踪；旧绑定恢复和账号/自动服务/设置诊断回归保持；新初始场景不放宽事务安全。

**Ownership:** desktop/tests及必要fixture；真实实现仅修复验证发现的本轮问题；新增docs/desktop/evidence/2026-11-12-first-launch/validation.md。

实现记录写在本票末尾：red→green证据、命令/结果、提交及限制；未实测系统路径不得宣称通过。
