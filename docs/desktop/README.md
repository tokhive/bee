# Bee 桌面文档

只维护当前有效的产品、接口、设计及配套验收文档。各功能的最新规格可以有不同日期；日期较早不代表已被其他功能的新文档替代。产品行为变化时原地更新对应规格，不再另存相互冲突的旧版本。

| 需要了解的内容 | 入口 |
| --- | --- |
| 页面开发、mock、构建与测试 | [desktop/README](../../desktop/README.md) |
| 产品范围和四页需求 | [产品需求](product.md) |
| 分层、接口职责与权限 | [架构](architecture.md) |
| 设备绑定与恢复 | [使用说明](device-pairing.md) |
| 账号接入、官方登录与贡献 | [使用及数据说明](ai-accounts.md)、[运行规格](../superpowers/specs/2026-10-26-desktop-account-runtime-design.md) |
| 原生自动服务与恢复 | [当前行为与接口](native-auto-service.md)、[逐票实施记录](../../.scratch/bee-native-interface/README.md) |
| 账户页目标交互：历史前端 mock 阶段 | [to-spec 规格](auto-service-design.md)、[验收记录](evidence/2026-11-04-account-ui-review/auto-service-validation.md)（该阶段只证明前端＋有状态 mock；当前原生进展见上一项） |
| 暂停／恢复与接单原因 | [供给说明](supply-control.md) |
| TS／Rust／Go 接口 | [私有桥协议](bridge-protocol.md) |
| 概览与账号布局 | [UI 规格](../superpowers/specs/2026-10-27-desktop-overview-accounts-ui-design.md) |
| 诊断与设置 | [功能规格](../superpowers/specs/2026-10-26-desktop-diagnostics-experience-design.md)、[UI 规格](../superpowers/specs/2026-10-28-desktop-s2-ui-design.md) |
| 状态与操作引导 | [交互规格](../superpowers/specs/2026-10-29-desktop-interaction-clarity-design.md)、[按钮反馈](../superpowers/specs/2026-11-03-button-feedback-design.md) |
| 设备在线与贡献分离 | [连接规格](../superpowers/specs/2026-11-03-desktop-device-connection-design.md) |
| 超时保活与自动重试 | [重试规格](../superpowers/specs/2026-11-03-desktop-request-retry-design.md) |
| 安装、更新与发布 | [发布说明](release.md)、[发布规格](../superpowers/specs/2026-10-26-desktop-release-update-design.md) |
| 完成情况、当前计划和真实验收缺口 | [验收状态](acceptance.md) |
| 已发现的问题与截图 | [问题备忘](issue-memo.md) |

规格规定行为，计划记录尚待完成的工作，验证报告记录指定版本的实际结果。与当前验收相关的报告和原始证据保留其原始版本与结论，不作为 UI 开发入口，也不由文档清理改写为通过。
