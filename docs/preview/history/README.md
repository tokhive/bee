# Bee App 预览历史

[唯一主预览](../index.html) · [维护说明](../README.md)

所有时间为 Asia/Shanghai（UTC+08:00）。冻结 HTML 与依赖只追加；评审与确认记录在本索引维护。

| 版本 | 来源与内容 | 评审状态与范围 | 固定 HTML |
| --- | --- | --- | --- |
| 2026-11-05 15:06:44 | 从旧账户页评审目录迁入；轻量步骤候选与旧场景列表 | 历史候选，未整体认可，不代表当前基线 | [打开](20261105-150644-compact-steps/accounts-preview.html) |
| 2026-11-05 17:00:52 | 从旧评审目录迁入；首次接入、故障恢复、可接单三场景 | 已认可本轮三场景呈现；不代表真实业务验收 | [打开](20261105-170052-three-account-flows/accounts-steps-prototype.html) |
| 2026-11-05 17:29:04 | 将已认可三场景原样纳入全 App 固定主入口 | 已认可的初始主预览；覆盖范围见维护说明 | [打开](20261105-172904-approved-app-baseline/index.html) |
| 2026-11-05 17:48:42 | 从三场景主预览生成；接通主动重新登录、身份比较、显式换号及保持暂停流程，修复操作焦点 | 待评审；新增两起点与流程交互尚未认可，主预览未更新 | [打开](20261105-174842-relogin-change-draft/draft.html?scene=relogin-different) |
| 20261106-104056 | 复用现有外壳，仅新增额度等待预览：接单开关独立于额度、详情及可直接选择的子场景；修改前复用 20261105-174842 完整快照 | 部分认可：额度等待场景已认可；其余候选不因此认可 | [打开](20261106-104056-quota-waiting-draft/draft.html?scene=quota-known-allowed) |
| 2026-11-06 10:47:43 | 仅将认可的额度等待及子场景交互合入三场景主预览；保留原有场景 | 已认可：额度等待页面与交互，不代表真实业务验收 | [打开](20261106-104743-approved-quota/index.html?scene=quota-known-allowed) |

| 2026-11-09 12:09:04 | OpenAI 108 个索引条目整合为 200 个共享视图子场景；数字步骤、接单选择保留、主界面／详情分工、设置保存与未知结果边界；修改前复用 20261106-104056 的相同完整快照。本版单文件，无外部依赖 | 待评审：仅草稿，未更新唯一主预览；不代表接口缺口闭合或真实业务验收 | [打开](20261109-120904-openai-scenarios-draft/draft.html?scene=onboarding) |

| 2026-11-09 17:53:05 | 仅调整首次登录到接入准备的连续呈现：四步保留编号、步骤区固定、状态与按钮区预留空间；新增 11 个保留首次登录来源的子场景。修改前复用 20261109-120904 完整快照；本版无外部依赖 | 待评审：先看首次登录效果，其他流程及两个设计文档未同步，主预览未更新 | [打开](20261109-175305-first-login-continuity/draft.html?scene=onboarding) |

## 确认与迁入记录

- 本会话用户看过三场景预览后回复“可以，接下来做什么？”，随后明确要求长期维护主预览、确认后更新、历史分别保存，并明确“整个 app 就一个”。据此将三场景呈现作为初始主预览，未将其他旧场景或页面标为认可。
- 两份旧快照均从 UI worktree 的 `docs/desktop/evidence/2026-11-04-account-ui-review/history/` 完整复制，保留原文件名和依赖；原资料保留供旧链接回看，不再作为主入口。
- 新主预览与认可的三场景 HTML 内容相同；此前该原型的登录、接入、自动核验、暂停保留、完成隐藏及场景切换已通过浏览器检查。本次整理不改变交互。
- 启动方法见[维护说明](../README.md)；服务根目录为 `docs/preview`，历史地址为 `/history/<版本目录>/<HTML 文件名>`。

- 2026-11-05：用户要求只在 worktree 整理。主预览与冻结版本已归入本 worktree 的 `docs/preview/`；文件内容保持一致，复用已有认可快照。原 Bee 主工作区未修改。

- 2026-11-05 17:48:42：本轮修改前核对主预览与 `20261105-172904-approved-app-baseline/index.html` 字节一致，复用该完整快照。交付稿冻结于 `20261105-174842-relogin-change-draft/draft.html`，内联全部资源，无外部依赖。五个起点仅为本轮局部覆盖，不将旧版建议清单标为已实现。

- 2026-11-06：用户查看额度等待 HTML 后明确回复“同意，将这个场景落盘”。据此仅纳入额度等待，未纳入 draft 中重新登录／换号的其他改动。更新前复用三场景基线完整快照；局部合入后保存新的主预览快照。

| 2026-11-09 18:02:32 | 首次登录增加停留的成功完成态、四步全绿及“完成”按钮；区分允许接单／保持暂停／额度等待，新增 3 个入口。修改前复用 20261109-175305 完整快照；完整单文件无外部依赖 | 已认可：仅首次登录连续流程与完成确认；2026-11-09 已同步设计文档。其他流程未整体认可，主预览暂未合入，不代表真实接单验收 | [打开](20261109-180232-first-login-completion/draft.html?scene=first-success) |

| 20261109-181751-before-flow-comparison | 独立新版制作前完整 draft，保留既有工具栏改动 | 修改前对比留版；首次流程已认可，其他范围未整体认可 | [旧版](20261109-181751-before-flow-comparison/draft.html?scene=intake-candidate-allowed) |
| 2026-11-09 18:20:12 | 独立连续流程新版：接入、重登、读取修复、换号的连续步骤与完成确认；冻结新旧两份完整 HTML | 已认可：2026-11-09 用户确认新版并要求落盘；后续已纳入主预览，仅静态模拟 | [新版](20261109-182012-continuous-flows-comparison/flow-comparison.html?scene=intake-candidate-allowed) · [旧版](20261109-182012-continuous-flows-comparison/draft.html?scene=intake-candidate-allowed) |

| 2026-11-09 18:40:32 | 将已认可连续流程新版纳入唯一主预览，同步设计记录与场景清单；冻结目录包含旧版对比文件 | 已认可界面与交互；真实登录与接口能力未据此验收 | [主预览冻结版](20261109-184032-approved-continuous-flows/index.html?scene=intake-candidate-allowed) |

| 2026-11-09 18:45:18 | 状态详情按新增信息展示：正文直接说明暂停条件，去掉重复折叠；保留有效错误证据、核对记录与细分进度。冻结主预览、对比页及旧版 | 已按确认建议修改；静态模拟，不代表真实接口验收 | [打开](20261109-184518-concise-state-details/index.html?scene=intake-retry-paused) |

| 20261110-114533（Asia/Shanghai） | 本轮恢复候选修改前的完整认可主预览；旧对照稿取自 Git HEAD | 认可基线原样冻结，非新增认可 | [打开](20261110-114533-openai-recovery-before/index.html) |
| 20261110-114533（Asia/Shanghai） | 复用认可外壳，新增重试耗尽、四种 60 秒结果核对结束及归属缺失候选；只读核实仍未知 | 待评审；未覆盖或更新主预览，未宣称 Q1 已闭环 | [候选](20261110-114533-openai-recovery-candidate/openai-recovery-candidate.html?scene=candidate-retries) |

## 20261110-115235 Claude 终端登录与共用流程（待评审）

- 时间：2026-11-10，Asia/Shanghai。
- 来源：已确认 Claude 差异文本、最新已认可 OpenAI 主预览；仅更新工作草稿，不更新主入口。
- 修改前：[完整草稿](20261110-114307-before-claude-draft/draft.html) · [当时主预览](20261110-114307-before-claude-draft/index.html)。包含原有未提交工具栏调整，按修改前工作状态归档，非新增认可记录。
- 交付：[Claude 等待登录](20261110-115235-claude-terminal-review/draft.html?scene=claude-first-login-wait) · [终端打开失败](20261110-115235-claude-terminal-review/draft.html?scene=claude-first-login-failed) · [完整流程](20261110-115235-claude-terminal-review/draft.html?scene=claude-onboarding)。评审状态：待评审。
- 新增 216 个 Claude 入口，沿用共用账号流程；macOS 终端等待、启动失败与窗口定位引导差异化。历史文件独立内联，可在预览根目录使用现有本地 HTTP 服务打开。
- 验证与真实业务边界见上级 README 的 Claude 专项；固定延时仅模拟外部结果。

- 20261110-171341 Asia/Shanghai：紧凑调整前完整主预览，[快照](20261110-171341-before-openai-compact/index.html)。原认可基线。
- 20261110-171341 Asia/Shanghai：OpenAI 故障与正常态共用紧凑布局，已接入账号固定显示额度；方案已获用户认可，[交付快照](20261110-171341-openai-compact/index.html)。单文件内联资源，通过 HTTP 打开，保留 scene/theme/size 参数。当前入口仍为 ../index.html。
- 20261110-171805 Asia/Shanghai：本轮最终交付，[完整快照](20261110-171805-openai-compact-final/index.html)。修正 iframe 内紧凑样式与读取故障多余步骤；替代 171341 中间快照，保留中间版供追溯。
