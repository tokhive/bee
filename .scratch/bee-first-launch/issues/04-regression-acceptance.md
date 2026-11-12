# 04: 真实前端回归与首次向导验收

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-ui/docs/desktop/first-launch-design.md

**Status:** done

**Blocked by:** 02 — 首次配对持久化恢复故障证据；03 — 可信启动分流及跨绑定会话完成页

**What to build:** 运行并修复首次绑定门槛影响的真实前端回归。旧测试中首次未绑定浏览常规页的期望按新 spec 更新；非本次目标页的测试应使用可信已有绑定fixture而非绕过gate。补齐完成页/浏览器打开前过期/失败未知/no replay等缺口，执行 typecheck/build、Node 单测、受影响Playwright；记录自动/受控/真实系统边界。不要删除断言或通过假绑定掩盖首次场景。

**Acceptance:** 新验收矩阵可追踪；旧绑定恢复和账号/自动服务/设置诊断回归保持；新初始场景不放宽事务安全。

**Ownership:** desktop/tests及必要fixture；真实实现仅修复验证发现的本轮问题；新增docs/desktop/evidence/2026-11-12-first-launch/validation.md。

实现记录写在本票末尾：red→green证据、命令/结果、提交及限制；未实测系统路径不得宣称通过。

## 实施记录（2026-11-12）

- 功能 `03150b7`、回归 `170ecd2`，集成合并 `6e7ea4e`。补齐未知创建的原生 Hive 控制台入口，合并同一后台故障的重复 alert；初始门槛和已有绑定恢复分别验证。
- 实际 red→green：设备旧回归 367/24 → 393/0，预览 94/5 → 99/0；两处产品缺陷 2 red → 2 green。旧首次导航断言按已批准合同替代，普通页面使用可信绑定；未 skip 或假造 unbound→bound。
- 通过：335 unit、37 tooling、62 device Node、393 device Playwright、99 preview、typecheck/build、最终 13 integration＋3 preview-device 聚焦回归及 diff check。demo 仅验证 338 项发现正确，未冒充运行通过。
- root 全 agent race 通过（138.924s），无后续原生变更。真实 Hive／OS／Tauri 与断电边界未验，见 [正式验收记录](../../../docs/desktop/evidence/2026-11-12-first-launch/validation.md)；本地详细日志和报告位于 `/tmp/bee-first-launch-context/04-report.md`。
- 整分支双轴审查作为 implement-spec 最后收尾，在全部票据完成后执行，结果另记。
