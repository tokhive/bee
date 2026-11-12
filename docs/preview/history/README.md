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


## 20261110-171334 OpenAI 紧凑布局四方案（待评审）

- 时间：2026-11-10 17:13:34，Asia/Shanghai。来源：上一会话四方案草稿、用户提供的横向分组参考图与真实错误截图。
- 当前候选：[四方案](../openai-compact-options.html)；[冻结版本](20261110-171334-openai-compact-options/openai-compact-options.html)。左右分区、三列对齐、双层卡片、紧凑列表均待选择；唯一主预览不变，生产 UI 未修改。
- 修改前基线复用 [认可主预览快照](20261110-114533-openai-recovery-candidate/index.html)，本轮开始时已核对与当时 index.html 字节一致；交付检查时检测到其他会话更新主预览，本轮未覆盖该更新。此四方案为首次交付冻结，未将未交付草稿冒充认可版本。
- 场景直达：[正常](20261110-171334-openai-compact-options/openai-compact-options.html?scene=normal)、[缺凭证与历史额度](20261110-171334-openai-compact-options/openai-compact-options.html?scene=missing)、[额度耗尽](20261110-171334-openai-compact-options/openai-compact-options.html?scene=exhausted)、[未知](20261110-171334-openai-compact-options/openai-compact-options.html?scene=unknown)。省略参数默认缺凭证；聊天内通过 host Tweak 切换，独立文件通过 URL 切换，不另增控制面板。外观跟随系统，尺寸跟随窗口。
- 完整资源内联，可直接打开，无外部资源请求；源 fragment 同目录冻结。可从 docs/preview 运行 `python3 -m http.server 1494 --bind 127.0.0.1`，访问 `/history/20261110-171334-openai-compact-options/openai-compact-options.html`。
- Chrome 检查：四布局在 800/736/660/440/360/320px 的布局无横向内容溢出；展开一层详情、设置保存、键盘回车、暂停恢复确认、四状态切换、浅深外观已检查。host Tweak 面板本身由宿主提供，本地通过相同状态恢复事件检查场景渲染；独立文件四个 URL 起点另行验证。
- 本地模拟核验成功只解除凭证问题，保留历史额度，不伪造额度恢复；未知额度为 —。未验证真实登录、后台接口、供给或接单能力。

- 20261110-171341 Asia/Shanghai：紧凑调整前完整主预览，[快照](20261110-171341-before-openai-compact/index.html)。原认可基线。
- 20261110-171341 Asia/Shanghai：OpenAI 故障与正常态共用紧凑布局，已接入账号固定显示额度；方案已获用户认可，[交付快照](20261110-171341-openai-compact/index.html)。单文件内联资源，通过 HTTP 打开，保留 scene/theme/size 参数。当前入口仍为 ../index.html。

- 20261110-171805 Asia/Shanghai：本轮最终交付，[完整快照](20261110-171805-openai-compact-final/index.html)。修正 iframe 内紧凑样式与读取故障多余步骤；替代 171341 中间快照，保留中间版供追溯。


## 20261110-174750 紧凑列表完整 App 候选

- 时间：2026-11-10 17:47:50，Asia/Shanghai。用户选定“紧凑列表”，要求在主预览基础上输出完整 HTML；本次整合效果待评审，未替换唯一主入口。
- 当前候选：[完整 App](../compact-list-app.html)；冻结：[本轮版本](20261110-174750-compact-list-app/compact-list-app.html)。修改前基线复用 [20261110-171805-openai-compact-final](20261110-171805-openai-compact-final/index.html)，交付时主预览与该基线字节一致。
- 保留主预览 Bee 外壳、原场景与登录／换号／修复流程；账号总览统一为账号、状态、额度、操作四列，窄窗口分组排列。新增评审入口：`compact-missing`、`compact-normal`、`compact-exhausted`、`compact-unknown`。默认缺凭证，宽屏浅色；支持原有 `scene`、`theme`、`size` 参数。
- 错误详情仅一层，包含具体失败检查、系统结果、错误码和原始原因；缺凭证时保留历史额度，未知额度显示 —。核验成功保留原完成确认及接单选择，不伪造额度恢复。
- Chrome 已验证四状态×820/1080 两尺寸×浅深两外观，详情、设置输入保持、保存与完成、历史额度、重置、暂停恢复、Escape、切场景取消旧任务、首次登录入口。无脚本异常和外部网络请求。未执行真实登录或业务写入。
- HTML 及产品资源全部内联，可直接打开；历史目录另冻结对比所需的原主预览 `index.html`。当前候选的对比链接指向当前主预览，冻结版的同路径链接指向冻结基线。可从 docs/preview 使用 `python3 -m http.server 1496 --bind 127.0.0.1` 打开 `/compact-list-app.html`。

| 20261110-180055 | 用户明确认可概览并要求合入主预览：状态优先双卡、淡化设备信息、移除空顶底栏与重复管理入口；新增概览导航，保留全部账号场景。修改前快照 20261110-174750-compact-list-app | 合入过程留版；最终联动版见后续记录 | [过程冻结版](20261110-180055-approved-overview/index.html) |


## 20261110-180104 状态旁错误详情浮层

- 时间：2026-11-10 18:01:04，Asia/Shanghai。用户同意“状态旁信息图标 + 点击浮层”；本次只更新紧凑列表候选，完整 App 整合仍待评审，未修改认可主入口。
- 当前：[候选](../compact-list-app.html)；[冻结版本](20261110-180104-compact-list-error-popover/compact-list-app.html)。修改前复用 [上一轮完整候选](20261110-174750-compact-list-app/compact-list-app.html)，修改前已核对字节一致。
- 移除错误状态下的整行“查看错误详情”，改为状态后的 ⓘ；点击显示平铺证据，保留列表主原因与修复按钮。支持外部点击、关闭按钮、Esc 和键盘焦点返回；窄于 760px 的 App 窗口使用底部详情面板。
- Chrome 验证：展开不改变行高（宽屏缺凭证行 143px）；无嵌套详情、无重复修复操作；键盘打开与 Esc、外部点击、关闭按钮、主题与尺寸、600px 面板、切场景、重置及设置入口通过，无运行时错误。真实业务未涉及。
- 完整资源内联，可直接打开；对比基线 index.html 同目录冻结。启动方式与参数沿用上一轮。

| 20261111-022040 | 概览最终合入版：接单选择、额度与账号页共享模拟状态，前往处理定位账号，应用导航往返；原 227 个账号入口保留，新增 2 个概览入口 | 已认可概览；仅静态模拟，未验收真实接口 | [最终主预览快照](20261111-022040-approved-overview-final/index.html) |


## 20261111-112027 紧凑列表与错误浮层纳入主预览（已认可）

- 时间：2026-11-11 11:20:27，Asia/Shanghai。用户明确同意紧凑列表和状态旁 ⓘ 浮层，并授权按验证、纳入主预览、同步设计、实现与打包顺序推进。
- 修改前复用 [20261111-022040-approved-overview-final](20261111-022040-approved-overview-final/index.html)。在当前主预览上合入账号布局，保留最新认可概览及全部原场景；补齐概览读取新额度结构的适配。
- [当前主预览](../index.html) · [认可冻结版](20261111-112027-approved-compact-list/index.html)。已认可的是布局与交互，不代表已有业务缺口闭合。旧候选和冻结版本保持原样。
- 验证 55 个失败场景入口 × 两尺寸 × 两外观，共 220 次；具有错误证据的场景检查浮层打开和 Esc 焦点返回，无脚本异常；概览摘要与额度保留。冻结版的旧版对照链接指向同目录 baseline.html，所有资源内联。

- 20261111-120139（Asia/Shanghai）：启动恢复场景加入前的完整单文件快照，沿用此前已认可内容。[打开](./20261111-120139-before-startup-recovery/index.html)。

- 20261111-120139（Asia/Shanghai）：按 2026-11-11 已确认启动恢复方案加入 7 个紧凑状态起点；可核对阻塞、查看诊断和下载模拟记录；原账号场景保留。方案已认可；初版可独立展示，归档内的旧版对照链接存在相对路径缺口，保留原文件，见下方验收版。[完整单文件](./20261111-120139-startup-recovery/index.html?scene=startup-blocked)。

## 20261111-121407 启动恢复验收版

- 方案已认可；已检查主预览及历史版的准备阶段、后台连接失败 → 旧会话阻塞、只读核对、诊断入口与模拟导出。浅深色和紧凑尺寸沿用本轮验证。
- [主预览](../index.html?scene=startup-blocked) · [完整冻结版](20261111-121407-startup-recovery-verified/index.html?scene=startup-blocked)。内联资源；对照文件 baseline.html、before-startup.html 一并冻结，旧归档不改写。
- 本轮 7 个启动起点保留原账号场景。静态预览不证明实际恢复成功；实际实现与验证边界见[验收报告](../../desktop/evidence/2026-11-11-startup-recovery/README.md)。


## 20261111-144208 概览向已固定的 AI 账号页对齐

- 时间：2026-11-11 14:42:08，Asia/Shanghai。已认可范围：保留分页面、AI 账号页不变、概览采用账号页风格、精简摘要和收紧需处理统计；本次按确认内容落实。
- 修改前复用 [完整基线](20261111-121407-startup-recovery-verified/index.html)，已核对与改动前主预览字节一致；未覆盖其他会话的紧凑列表及启动恢复内容。
- [当前概览](../index.html?scene=overview-attention&page=overview) · [完整冻结版](20261111-144208-overview-account-style/index.html?scene=overview-attention&page=overview)。所有产品资源内联；baseline.html 与 before-startup.html 随同冻结，历史对照不依赖当前文件。
- 概览采用账号页导航、字体、颜色、卡片和按钮规范；减少重复说明。需处理排除暂停、额度等待、自动重连及自动核对。原有导航仅补齐目标平台参数转交，不重做流程，账号页自身代码保持原样。
- 验证：14 个计数场景、处理定位／返回焦点、两平台暂停恢复、两尺寸 × 两主题和启动阻塞隔离；冻结页独立打开。仅静态模拟，不涉及正式实现或真实账号。


## 20261111-145858 Claude 同步 OpenAI 紧凑账号布局

- 时区：Asia/Shanghai；评审状态：**待评审**。
- 修改前：[完整草稿](20261111-145548-before-claude-sync/draft.html?scene=claude-first-login-failed)；[当时主预览基线](20261111-145548-before-claude-sync/index.html?scene=compact-normal&page=accounts)，同时冻结其旧版对照依赖。
- 交付：[完整 Claude 草稿](20261111-145858-claude-compact-sync/draft.html?scene=claude-compact-normal&theme=light&size=wide)。资源内联，可独立打开；未更新 index.html。
- 同步账号／状态／额度／操作四列、未知与历史额度标记、错误证据浮层和步骤展示；保留 Claude 终端登录差异，新增 4 个紧凑布局起点。
- 验证范围见预览 README 的本轮记录；HTML 交互不代表真实登录或业务验收。


## 20261111-150658 Claude 方案确认纳入主预览

- 时区：Asia/Shanghai；状态：**已认可**，依据：用户“更新到主预览吧”。认可范围为 20261111-145858 的 Claude 同步方案；此前该条“待评审”状态由本记录更新，冻结 HTML 不改写。
- 修改前复用 [完整主预览](20261111-145548-before-claude-sync/index.html)，已确认与本轮修改前字节一致。
- [累计主预览完整快照](20261111-150658-approved-claude/index.html?scene=claude-compact-unknown&theme=light&size=narrow)：保留原有 240 个起点，加入 220 个 Claude 起点及必要的主入口导航连接。
- 同目录冻结 baseline.html、before-startup.html、claude-baseline.html，旧版对照入口不依赖当前草稿。
- 验证范围见预览 README；仅静态模拟，主入口路径不变。

- 20261111-153542-before-session-retirement：安全结束旧会话前的完整主预览，含 OpenAI／Claude 及启动原场景；来源为当前主预览与其冻结对照依赖；状态：已认可（本轮修改前）。[打开 HTML](20261111-153542-before-session-retirement/index.html)。

- 20261111-154454-session-retirement：新增 Hive 尚不支持恢复、等待原任务结束两个分支；继续恢复后回到正常账号布局，保留原账号暂停选择；来源为主预览局部同步；状态：待评审（已授权实施，视觉未另行确认）。[打开 HTML](20261111-154454-session-retirement/index.html?scene=startup-draining)。


## 20261112-145209-first-launch-wizard 首次启动设备绑定向导

- 时区：Asia/Shanghai；状态：**待评审**（文本方案已确认，HTML 视觉待评审）。
- 修改前草稿复用 [完整旧草稿](20261111-145858-claude-compact-sync/draft.html)，主预览基线复用 [完整主预览](20261111-154454-session-retirement/index.html)，两者均已核对字节一致。
- [本轮完整快照](20261112-145209-first-launch-wizard/draft.html?scene=setup-form)；同目录 before-setup.html 为修改前主预览，baseline.html、before-startup.html、claude-baseline.html 为冻结对照依赖。产品资源全部内联。
- 来源：当前累计主预览，新增 17 个向导状态和 2 个绑定后入口；保留原有 462 个场景。已认可主入口未变。
- 本轮验证及模拟边界见预览 README 的首次启动记录。


## 20261112-150523-setup-error-clarity 向导错误详情与等待文案

- 时区：Asia/Shanghai；状态：**待评审**。来源：用户要求叹号详情、明确自动等待及改进“核对设备”表述。
- 修改前复用 [上一轮完整快照](20261112-145209-first-launch-wizard/draft.html?scene=setup-open-failed)，已确认与修改前草稿字节一致。
- [本轮完整快照](20261112-150523-setup-error-clarity/draft.html?scene=setup-open-failed)，含 before-setup.html、baseline.html、before-startup.html、claude-baseline.html 冻结对照依赖；原有归档未改写。
- 验证五类错误浮层、键盘及焦点、浅深色／窗口切换、切场景关闭、继续绑定路径及历史版独立打开；481 个场景保留。仅静态模拟，未修改正式 App 或主预览。
