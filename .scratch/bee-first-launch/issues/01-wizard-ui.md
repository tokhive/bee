# 01: 首次设置向导的完整界面

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-ui/docs/desktop/first-launch-design.md

**Status:** done

**Blocked by:** None

**What to build:** 新增 FirstLaunchWizard 组件，使用受控 props 消费真实 DeviceView/DeviceContext/RefreshStatus、故障及回调。包含填写、等待、确认/保存、未知/过期/错误、完成页；复用已确认主题、错误详情圆圈叹号。不得增加轮询或调用原生 API；配对动作完全通过回调。组件测试在真实 React 页面边界以 Playwright 执行（添加独立 fixture 和匹配现有 device config 的 .spec.ts）。组件只负责展示与用户动作，顶层启动门槛由03处理。

**Acceptance:** 表单 URL/名称按现有协议校验、焦点和重复提交；返回原有效网址复制及失败；到期仍等服务端；异常操作许可与实际 phase 一致；保存续存、错误 popover 键盘/Escape；完成页导航不自动授权；窄窗浅深色。

**Ownership:** desktop/src/features/device/FirstLaunchWizard.tsx；该组件独立 CSS；desktop/tests/first-launch-wizard.spec.ts；独立组件 fixture；必要专用 i18n 文案文件（优先现有机制，若改共享 zh/en 留明确记录）。不修改 NativeApp/desktopState/旧测试。

实现记录写在本票末尾：red→green证据、命令/结果、提交及限制；未实测系统路径不得宣称通过。

## 实现与验收

- 实现 `0e5bc0b`，后续 `ccf85bb`、`2b5b47c`、`b0ddb73`；合并至集成 `ab015b8`。
- 14 项真实 React／Playwright 组件测试通过；正常 device 测试入口已纳入新测试。typecheck、build 通过（后续局部修正分别重跑组件测试及 typecheck）。
- 红绿覆盖字段校验、重复提交、原网址／复制故障、本地到期等待、保存续存、阶段动作、详情键盘、可信完成条件、中文／英文与窄窗主题。
- root 浏览器复查修正继承 dt 间距及原生仅错误码／消息时的叹号入口；Hive 显示名称变化允许，但不同 ID／归属／事务身份阻止完成。
- 组件 fixture 不证明实际原生浏览器打开或真实 Hive，入口集成由03、总验收由04负责。
