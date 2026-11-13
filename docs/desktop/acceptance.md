# Bee 桌面当前验收状态

2026-11-05 增量：原生自动服务、按平台登录维护和恢复已进入逐票实施，当前证据见[实施验证](../../.scratch/bee-native-interface/implementation-validation.md)。受控原生组合测试不替代下列真实环境验收。

截至 2026-11-03 的原台账：正式四页、类型化接口和模拟预览已经存在；整体验收未完成。文档清理不改变任何测试结果或完成状态。每条通过结论必须绑定源码／包版本、运行环境和证据，不能累加不同版本的通过数量。

## 开发工作流

| 项目 | 当前状态 | 下一步 |
| --- | --- | --- |
| 统一正式 UI 入口 | 已增加 `dev:ui`，加载正式 NativeApp；入口专项 5 项通过 | 继续维护 mock 与 Client 同一契约 |
| 默认测试与 CI | 尚未完成；完整 TS 单测和独立 preview 配置未统一接入默认检查 | 按[当前计划](../superpowers/plans/2026-11-03-ui-development-workflow.md)第 2 项落实 |
| 真实关键流程闭环 | 部分子路径有证据，完整真实流程未完成 | 按同一计划第 3 项逐条验收 |

## 验证层次与入口

| 层次 | 验证对象 | 证据或执行入口 |
| --- | --- | --- |
| 页面与 mock | 当前四页和异常状态呈现 | [开发说明](../../desktop/README.md)、[场景目录](../../desktop/tests/fixtures/bee-preview/scenarios.mjs) |
| 跨层契约 | TS 调用、Rust 注册／参数、公开响应 | `desktop/tests/native-command-contract.test.ts`、`desktop/tests/diagnostics-contract.test.ts`（当前工作树中的独立测试，随对应实现提交） |
| 受控集成 | Go/Rust、HTTP fixture、合成凭据、进程生命周期 | 各模块测试及下列验证台账；不等于官方账号端到端 |
| 真实 App 与系统 | 配对、官方登录、贡献、恢复、菜单／托盘／通知／更新 | 需指定候选包、系统、账号和操作范围后逐路径记录 |

[76 项复合场景台账](interaction-clarity-validation.md#76-项场景索引)是业务验收索引；预览目录的场景数与复合场景数不是同一覆盖指标。存在场景、截图或测试文件不等于该路径已通过。

## 尚未完成的验收

- 两平台真实官方登录、接入、换号、上游受控请求，以及暂停阻止派发、停止后不可接单。
- 隔离 GUI 中的设备恢复全链路；创建结果未知且缺少 token 时的人工恢复闭环。
- 真实核心 DNS／TLS／超时／心跳／持续冲突、旧运行回执及同平台完整恢复变体。
- 最终候选包的退出、再次打开、代理应用和签名更新成功／失败路径。
- 三端真实菜单、托盘、权限、通知、自启、关窗找回、语言／日期数字、原生缩放和辅助技术。
- 全部复合异常布局及行为、对比度矩阵、键盘和焦点；不能用代表截图替代全部状态。
- macOS 13 双架构、Windows 10／11、Ubuntu 22.04／24.04 双架构的最终安装与系统集成；托管 runner 或 Xvfb 的通过不能替代相应真实桌面环境。

## 当前功能对应证据

- [账号与贡献](account-runtime-validation.md)、[诊断与系统体验](experience-validation.md)、[发布与更新](release-validation.md)。
- [交互验收台账](interaction-clarity-validation.md)、[交付缺口](../superpowers/reports/2026-11-03-desktop-interaction-clarity-delivery.md)。
- [设备在线验证](../superpowers/reports/2026-11-03-desktop-device-connection-verification.md)、[请求重试验证](../superpowers/reports/2026-11-03-desktop-request-retry-verification.md)、[按钮反馈验证](../superpowers/reports/2026-11-03-button-feedback.md)。

当前源码新增了 `runtime_enable_presence`，但 `smoke-accounts.mjs` / `smoke-experience.mjs` 的静态能力列表仍是 29 项，缺少该方法。它们需要在测试接入工作中同步；此处记录差异，不把旧 smoke 结果当作当前完整能力验证。
