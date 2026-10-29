# Bee 分组场景预览实施计划

> 执行代理：使用 subagent-driven-development，按任务实施和审查。用户已确认七组场景和完整核对恢复过程，继续执行，不重复请求批准。

**目标：** 在现有正式组件预览中提供七组 39 个场景及可重放的自动恢复过程。

**架构：** 复用 native-accounts fixture，以局部 IPC 适配生成合法快照；正式页面自行渲染状态。外层选择器用单一场景目录，内层通过正式按钮导航和打开弹窗；换场景重建 iframe，隔离定时器和模拟状态。

**技术栈：** 沿用 JavaScript ES modules、React 19.2.8、Vite 8.2.4、Playwright 1.63.0 和 Node 24；不新增依赖。

## 全局约束

- 规格：../specs/2026-10-27-desktop-overview-accounts-ui-design.md 文末场景补充；七组范围已获用户批准。
- 使用 /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0 现有隔离工作区，保留其他修改。10 月 28 日预览交付时未提交；10 月 29 日用户明确要求提交，按内容分组保存源码与文档，不推送或发布。
- 不修改正式业务组件、hook、协议、后端或现有 native-accounts.mjs；新代码位于预览 fixture，两个旧 .cache URL 兼容。
- 保留正常画布、明暗主题和 860×600；分组选择器、重置和观察说明位于 App 外。
- 不使用真实凭证或发起外部请求；设备网页确认由 fixture 模拟，官方登录仍经正式确认。
- 自动核对使用正式 hook 的 10 秒重试；过期/失败不得呈现旧可接单，重试不重放写入。
- 暂停字段与 manually_paused 原因一致；ready 当且仅当 reasons 为空；DTO 经过现有严格解码。

## Task 1：场景目录与模拟响应

文件：新增 desktop/tests/fixtures/bee-preview/scenarios.mjs、fixture.mjs。

接口：scenarios 导出 scenes 数组，元素为 {id,group,label,description,page,action?}；page 为 overview 或 accounts，action 为 start-unknown、login、select、stop、change、clear、detail 或未设置。getScene(id) 返回匹配项或 running。fixture 导出 async installPreviewFixture(id)，在正式入口加载前安装模拟 IPC。

- [x] 目录包括以下稳定 ID：device-unbound/device-pending/device-expired/device-bound/device-error；stopped/runtime-starting/running/runtime-stopping/runtime-disconnected/runtime-unknown；account-reading/account-empty/account-candidate/account-selected/account-error/account-expired/account-change；supply-ready/supply-paused/supply-blocked/supply-partial；check-background/check-expired/check-waiting/check-retrying/check-recovered/check-sequence；quota-normal/quota-unknown/quota-expired/quota-multiple/quota-over；confirm-login/confirm-select/confirm-stop/confirm-change/confirm-clear/account-detail。共 39 项，自动恢复过程包含于核对组。
- [x] 复用已有 fixture 的账户动作、登录取消等行为；预览种子不让自动 detect 覆盖待评审状态，选中信息与额度指纹必须一致。绑定、连接、暂停及账号状态在逻辑上相容；单平台错误不污染另一平台。
- [x] 稳定场景保持可查看；核对场景通过供给读取成功／失败／延迟及 checked_at 驱动。完整过程与重试中沿用正式间隔，重置重新开始；拒绝无效响应的错误不作为预期业务失败。
- [x] 对目录及关键状态执行浏览器检查；覆盖真正 NativeApp 的解码、禁用与状态渲染；记录结果后进入任务审查。

## Task 2：选择器、说明与正式交互入口

文件：新增 desktop/tests/fixtures/bee-preview/index.html、app.html、viewer.mjs、app.mjs、viewer.css；修改 desktop/.cache/bee-shadcn-review.html、bee-shadcn-app.html 为兼容入口。

接口：viewer 从 scenes 构建 optgroup；URL 参数保持 scene/theme/size。内层在 import('/src/main.tsx') 前 await installPreviewFixture(scene.id)，通过正式导航及按钮打开场景目标；完成后设置 window.__beePreviewReady=true，异常显示具体失败步骤。可给外层发送 {type:'bee-preview-phase',scene,phase}，外层只接受同源且 source 为当前 iframe 的消息。

- [x] 保持指定 shadcn 外观画布；七组选择、场景说明、重置按钮可用，主题和尺寸切换保留 scene；未知 scene 安全回落 running。
- [x] 账号场景自动进入 AI 账号页；确认场景通过已有按钮打开真实对话框（只打开，不自动确认写操作）；runtime-unknown 只允许触发模拟开始以形成不确定状态。账号详情默认打开来源设置。
- [x] 旧 URL 继续可用，新维护代码存入 fixture 路径；每次切换换 iframe 文档隔离旧响应，默认运行中＋浅色＋参考尺寸。

## Task 3：验证、审查与一致性

文件：新增 desktop/playwright.preview.config.ts、desktop/tests/preview-scenarios.spec.ts；更新 docs/desktop/2026-10-28-bee-shadcn-ui-validation.md。

- [x] 先对现有只有两个场景的入口运行场景分组／选择回归并记录失败；随后检查全部场景合法渲染、预期文案、真实确认按钮与写入次数；自动恢复过程检查过期保护、等待、重试、成功及无重放写入。
- [x] Node 24 执行 BEE_E2E_PORT=1471 npx playwright test --config playwright.preview.config.ts；npm run typecheck；npm run build；git diff --check。场景修改只影响 fixture，不无理由重跑既有 152 个业务测试。
- [x] 用 ego-browser 实看分组选择、代表场景与完整恢复过程；浅深色、860×600、确认弹窗和页面滚动；保存截图并打开可交互预览。
- [x] 子代理审查本轮预览路径和规格覆盖，修复有效问题。执行 verification-before-completion、consistency-check、post-verification-check，更新证据和所有复选框；原生壳验收不计入本预览计划。

## 完成证据

2026-10-28：11/11 项完成。39 场景加 6 项交互回归共 45/45 通过；typecheck、正式 build 和 diff 检查退出 0。ego-browser 已实看明暗主题、860×600、确认弹窗、滚动、重置及完整自动恢复。审查发现的换号身份额度混用已通过两条 RED→GREEN 回归修复并复审关闭。

证据：[验证记录](../../desktop/2026-10-28-bee-shadcn-ui-validation.md)、[审查报告](../../../.superpowers/sdd/preview-scenes-review.md)。一致性检查已核对规格／决策／目录／测试和链接，未发现本增量未解决的差异。保持当前工作树与预览服务，按 10 月 29 日用户要求提交源码与文档，不推送或发布。此前银白 UI 计划的原生 Tauri 验收仍独立待办。
