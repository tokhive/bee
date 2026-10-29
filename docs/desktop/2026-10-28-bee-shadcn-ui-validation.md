# Bee shadcn/ui 实施与验证记录

日期：2026-10-28；提交整理：2026-10-29。代码基线 `9e2bc77`，分支 `feat/bee-desktop-p0`。用户已于 10 月 29 日明确要求提交代码；本记录随源码提交，不包含推送或发布。各节保留当次执行时的事实，当前原生启动证据及未完成验收见文末。

依据：[界面 spec](../superpowers/specs/2026-10-27-desktop-overview-accounts-ui-design.md)、[用户决策](../superpowers/specs/2026-10-27-desktop-overview-accounts-ui-design-decision-trace.md)、[实施计划](../superpowers/plans/2026-10-28-desktop-silver-ui.md)。业务以正式 spec 为准，三方案比较仅提供 `variant=shadcn` 视觉参考。

## 交付范围

- 正式 `NativeApp` 接入共享账号列表、运行摘要和三列设备摘要；四项导航、紧凑按钮与约 430px 详情面板遵循已批准布局。
- 复用 React、Radix、Lucide 与 CSS 变量，对照仓库已有 shadcn Button、Badge、Progress 适配。浅色主按钮深色实心，深色主按钮浅色实心；次要动作描边或弱化，银白底色和琥珀点缀保留；未新增依赖。
- 供给报告正常读取安静；过期自动核对，失败每 10 秒重试并显示进度，不提供手动重新核对按钮。设备区的只读设备核对入口仍属独立配对流程。
- 账号页自动读取来源；按指纹匹配身份、套餐和额度，未知不显示为 0%，120% 保留原值、仅图形封顶。全部额度窗口和失败原因保留。
- 接入、换号与官方登录仍确认；开始使用空恢复列表，恢复平台不启动贡献，换号后仍暂停。未知写结果只能由新的明确快照确认，不能自动重放写入。
- 来源访问失败保留诊断，重进账号页再读一次，避免重复系统授权提示；诊断页保留运行、授权、账号和供给原始错误证据。

本轮文件集中在 `desktop/src/app/`、`components/`、`features/accounts/`、`features/overview/`、`features/lifecycle/`、`features/supply/`、`features/device/`、样式和词典，以及相关测试和本版文档。未修改 Go、Rust 或 IPC DTO。工作树原有 `agent/`、`src-tauri/sidecar.rs`、`main.tsx`、历史文档与旧原型修改保留，不属于本轮新改动。

## 自动验证

使用 Node 24.22.1。以下从实施工作树执行；旧演示测试命令从 `desktop/` 执行。`BEE_E2E_PORT` 仅为本机测试端口覆盖，native fixture 默认 1421，旧演示默认 1420；CI 不设时保持原值。本轮使用 1467／1469 避免占用已有开发服务器。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `node --test desktop/tests/supply.test.ts desktop/tests/nativeAccounts.test.ts desktop/tests/accountPresentation.test.ts desktop/tests/runtime.test.ts desktop/tests/authorize.test.ts` | 35/35，通过 | [unit-tests.log](../../.cache/desktop-silver-ui/unit-tests.log) |
| `BEE_E2E_PORT=1467 npm --prefix desktop run test:device` | 28 个 Node 测试和 50 个 Chromium fixture 测试通过；Node 与上行有交集 | [device-tests.log](../../.cache/desktop-silver-ui/device-tests.log) |
| `BEE_E2E_PORT=1469 npx playwright test --config playwright.config.ts p0-shell.spec.ts onboarding-overview.spec.ts accounts.spec.ts` | Chromium／Firefox／WebKit 共 102/102，通过；验证共享壳影响 | [demo-tests.log](../../.cache/desktop-silver-ui/demo-tests.log) |
| `npm --prefix desktop run typecheck` | 退出 0 | [typecheck.log](../../.cache/desktop-silver-ui/typecheck.log) |
| `npm --prefix desktop run build:demo` | 退出 0 | [build-demo.log](../../.cache/desktop-silver-ui/build-demo.log) |
| `npm --prefix desktop run build` | 退出 0；最终 dist 为正式入口构建 | [build.log](../../.cache/desktop-silver-ui/build.log) |
| `git diff --check` | 退出 0 | 工作树差异检查 |

覆盖未绑定、等待确认、已绑定、停止／运行、暂停／恢复、过期／失败／恢复、账号来源隔离、管理进程实例隔离、确认与焦点、完整诊断证据等路径。浏览器 fixture 调用真实页面和 hook，以模拟 IPC 替代真实账号和 Hive，不证明真实官方授权或贡献流量。

## 审查与修复

最终行为路径审查追踪了页面、hook、TS client、Rust 转发和 Go 账号核对入口，发现并关闭两项 P2：

1. `reconciling` 只读缓存无法推进后端核对。改为每 10 秒刷新快照，正常 pending／running 保持 400ms 缓存轮询；核对不重新提交账号动作。
2. 权限失败由后端返回有效失败 DTO，被误判为读取成功。现在保留无来源的 `candidate.error` 证据，页面重进后重试一次。

新增 4 个用例先失败、修复后通过，完整 hook suite 12/12 通过：[RED](../../.cache/desktop-silver-ui/recovery-red.log)、[GREEN](../../.cache/desktop-silver-ui/recovery-green.log)。最终审阅者聚焦复核通过，详见[报告](../../.superpowers/sdd/silver-final-review.md)。其他任务审查记录位于同一目录。本轮部分纯展示测试与实现同期添加，不宣称所有用例均有独立的实现前 RED。

## 首轮视觉检查（历史，已由下文纠偏覆盖）

使用 ego-browser 查看真实 NativeApp 的 fixture 版本，设置页切换明暗主题。所有截图按记录的逻辑窗口尺寸和 DPR 1 截取；数据为示例，`owner@example.test`、`hive.example`、身份前缀及额度不代表真实账号。

| 页面 | 浅色 1280×900 | 深色 1280×900 | 浅色 860×600 | 深色 860×600 |
| --- | --- | --- | --- | --- |
| 概览 | [截图](../../.cache/desktop-silver-ui/overview-light-1280.png) | [截图](../../.cache/desktop-silver-ui/overview-dark-1280.png) | [截图](../../.cache/desktop-silver-ui/overview-light-860.png) | [截图](../../.cache/desktop-silver-ui/overview-dark-860.png) |
| AI 账号 | [截图](../../.cache/desktop-silver-ui/accounts-light-1280.png) | [截图](../../.cache/desktop-silver-ui/accounts-dark-1280.png) | [截图](../../.cache/desktop-silver-ui/accounts-light-860.png) | [截图](../../.cache/desktop-silver-ui/accounts-dark-860.png) |
| 右侧详情 | [截图](../../.cache/desktop-silver-ui/detail-light-1280.png) | [截图](../../.cache/desktop-silver-ui/detail-dark-1280.png) | [截图](../../.cache/desktop-silver-ui/detail-light-860.png) | [截图](../../.cache/desktop-silver-ui/detail-dark-860.png) |

首轮逐图查看了正式页面的侧栏、标题、运行摘要、设备三列、账号分组、额度条和按钮，但没有与指定 shadcn 页面做同尺寸、同状态的直接对照，遗漏了副标题、三列账号布局、字体继承和颜色差异。这批截图只证明当时的页面呈现，不能证明已还原参考。860px 下账号额度移到下一层，内容纵向滚动，无横向溢出；详情宽 430px，可滚动到[底部动作](../../.cache/desktop-silver-ui/detail-dark-860-bottom.png)。Escape 关闭后，焦点回到「OpenAI 详情」入口。浅色主按钮深色、深色主按钮浅色，次要操作描边。

## 验证边界与待办

本轮没有执行 Tauri 原生窗口验收。当前会话没有可用的原生窗口操作工具；已确认配置最小尺寸为 860×600，但配置值不能证明系统标题栏、真实窗口限制、WebView 滚动和焦点行为。原生启动路径会调用 `restore_when_ready`，也没有现成的原生 fixture 模式；本轮未为 UI 验证启动真实账号或贡献。计划保留该项未勾选，后续在可控测试状态下补验。旧原生截图与本轮 Chromium／WebKit 结果均不能替代这项证据。

未新增真实 Claude、换号、买家请求或跨平台原生验收；这些不属于本轮已批准范围。当前浏览器层的明暗主题与窄窗口验证已完成。

## 本轮使用的 skills

- 约定与执行：`global-conventions`、`using-superpowers`、`executing-plans`、`using-git-worktrees`、`subagent-driven-development`、`superpowers-decision-trace`。
- 界面与浏览器：`frontend-design`、`ego-browser`。
- 实现与问题定位：`test-driven-development`、`high-stakes-implementation-testing`、`systematic-debugging`、`fail-fast-with-evidence`。
- 审查与收尾：`requesting-code-review`、`affected-path-review`、`verification-before-completion`、`consistency-check`、`post-verification-check`。

## 首轮一致性核对（历史，视觉结论不足）

- ❌ 视觉：首轮未做同尺寸、同状态直接对照，遗漏布局和字体差异；原“shadcn 视觉一致”结论撤回。自动核对重试与平台暂停规则未发现冲突，未带回手动供给核对、全局恢复或模型详情。
- ✅ 文档内部：spec、决策记录和计划明确视觉参考与业务依据的关系；实施状态与验收边界一致。
- ✅ 跨文件：正式 NativeApp 调用新共享组件；参数和状态传播到全部调用点；后端既有刷新语义与自动恢复一致。没有 PR，本轮文件范围见上文。
- ✅ 配置：沿用现有依赖和主题变量；原生最小尺寸未改；测试端口覆盖已记录，默认配置保持可用。
- ✅ 文档：根目录视觉原型 README 指向正式 spec、trace、plan；S1 历史记录明确标注本次 UI 的覆盖关系。
- ❌ 原生验收：本轮 Tauri 窗口检查尚缺，未用浏览器结果代替。

历史结论修正：首轮业务验证有效，视觉还原结论依据不足；原生壳验收缺口继续保留。当前视觉证据见下文。


## 用户反馈后的视觉纠偏（2026-10-28，当前结果）

本次按用户明确确认的 shadcn 页面统一：概览去副标题、账号改为身份／额度两列，动作在额度下方。标题、运行与设备区域的留白、字体继承、暖灰色、状态图标、25px 账号按钮及深色弱化面板同步修正。页面主体在窗口内滚动，侧栏、顶栏与页脚保持位置。自动核对、暂停和账号操作的 hook／协议没有在这轮视觉修正中变更。

此前预览直接占满浏览器，并默认停止状态，指定参考则有固定画布、处于运行中；这使比较条件也不一致。[预览入口](http://127.0.0.1:1421/.cache/bee-shadcn-review.html?scene=running&theme=light&size=normal)使用正式 NativeApp 和现有 IPC fixture，视觉纠偏时提供运行／停止、明暗主题、参考尺寸／860×600 三项切换；后续已扩展为下文七组场景。示例账号和贡献动作仅修改 fixture；不是原生窗口，也没有读取真实凭证。

### 与参考的直接对照

两边均使用运行中、OpenAI 可接单、5 小时已用 3%、7 日已用 2% 的场景。正常画布均为 1118×738、DPR 1；参考页外层为 1280×900，裁取其 app-frame。截取、测量后检查图像，不能仅依据数值认定视觉通过。

- [浅色并排对照](../../.cache/desktop-silver-ui/correction-compare-light.png)：左侧指定 shadcn 参考，右侧正式组件。
- [深色并排对照](../../.cache/desktop-silver-ui/correction-compare-dark.png)：排列相同。
- [几何测量原始记录](../../.cache/desktop-silver-ui/visual-correction-geometry.json)。

以下位置以各自应用画布左上角为原点，明暗两主题一致：

| 检查点 | shadcn 参考 | 正式组件 |
| --- | --- | --- |
| 侧栏／顶栏 | 178px／52px | 178px／52px |
| 概览标题起点 | x=207，y=77 | x=207，y=77 |
| 运行区 | y=131.20，高 97 | y=131.20，高 97 |
| 设备区 | y=228.20，高 109 | y=228.20，高 109 |
| 第一账号行 | y=390.70，高 139.5 | y=390.70，高 138 |
| 暂停按钮 | 66×25，y=489.20 | 66×25，y=487.70 |

当前仍有明确差异：正式页保留 16 位身份前缀、完整 Hive 地址、读取状态和真实操作原因；Claude 行因此比参考高 17px，此场景主区域出现滚动条，可用内容宽度比参考少 11px。正式壳没有原型伪窗口控制点、工作台面包屑和演示状态标签，品牌及导航顶部位置随原生壳不同。未为截图删掉业务信息，也不宣称像素完全相同。

### 明暗主题、窄窗口与详情

| 页面 | 浅色 1118×738 | 深色 1118×738 | 浅色 860×600 | 深色 860×600 |
| --- | --- | --- | --- | --- |
| 概览 | [截图](../../.cache/desktop-silver-ui/production-running-matched.png) | [截图](../../.cache/desktop-silver-ui/production-running-dark.png) | [截图](../../.cache/desktop-silver-ui/correction-overview-light-860.png) | [截图](../../.cache/desktop-silver-ui/correction-overview-dark-860.png) |
| AI 账号 | [截图](../../.cache/desktop-silver-ui/correction-accounts-light-1118.png) | [截图](../../.cache/desktop-silver-ui/correction-accounts-dark-1118.png) | [截图](../../.cache/desktop-silver-ui/correction-accounts-light-860.png) | [截图](../../.cache/desktop-silver-ui/correction-accounts-dark-860.png) |
| 详情 | [截图](../../.cache/desktop-silver-ui/correction-detail-light-1118.png) | [截图](../../.cache/desktop-silver-ui/correction-detail-dark-1118.png) | [截图](../../.cache/desktop-silver-ui/correction-detail-light-860.png) | [截图](../../.cache/desktop-silver-ui/correction-detail-dark-860.png) |

窄窗口分别对照 [浅色参考](../../.cache/desktop-silver-ui/reference-running-light-860.png) 和 [深色参考](../../.cache/desktop-silver-ui/reference-running-dark-860.png)。参考仅将宿主画布设为 860×600，应用自身 CSS 保持原值；正式版本按已批准窄窗口规则保留 178px 侧栏、额度下移，并不复制参考的 163px 侧栏与两列额度。全部原因及操作可纵向滚动到达，没有横向溢出。详情宽 430px，滚动到底部后可见重新登录／取消接入；运行中重新登录保持禁用，并显示先停止贡献的原因。Escape 在两主题下均返回「OpenAI 详情」触发按钮。

底部证据：[浅色](../../.cache/desktop-silver-ui/correction-narrow-light-contact.png)、[深色](../../.cache/desktop-silver-ui/correction-narrow-dark-contact.png)；[浏览器测量与焦点记录](../../.cache/desktop-silver-ui/visual-correction-browser-checks.json)。外层三个选择器已实测，停止＋深色＋窄窗口组合的 iframe 为 860×600；交付恢复为运行中＋浅色＋参考尺寸。

### 本轮重新执行的检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| native fixture 回归 | 28 个 Node、50 个 Chromium 用例通过 | [日志](../../.cache/desktop-silver-ui/visual-correction-device-tests.log) |
| 共享壳回归 | Chromium／Firefox／WebKit 共 102 个用例通过 | [日志](../../.cache/desktop-silver-ui/visual-correction-demo-tests.log) |
| typecheck | 退出 0 | [日志](../../.cache/desktop-silver-ui/visual-correction-typecheck.log) |
| demo build／正式 build | 均退出 0，最终 dist 是正式入口 | [demo](../../.cache/desktop-silver-ui/visual-correction-build-demo.log)、[正式](../../.cache/desktop-silver-ui/visual-correction-build.log) |
| 差异格式检查 | `git diff --check` 退出 0 | 本轮命令输出 |

本轮后续只补调面板、页脚和次要按钮颜色，重新截图并构建；不为颜色重复运行已通过的行为测试。原有 35 项聚焦测试与最终行为审查属于首轮证据，没有将其计为本轮重跑。原生 Tauri 窗口验收仍未执行。

### 当前一致性检查清单

- ✅ 会话：落实用户本次确认的无副标题及额度下方操作；保留自动核对、失败重试和平台暂停规则，未恢复被拒绝的手动供给核对或全局恢复。
- ✅ 文档内部：spec 前文的旧布局优先级和“额度在中间”已纠正；辅助字号、运行／账号按钮高度与当前实现一致。首轮视觉结论明确标为历史并纠正，不与当前对照混用。
- ✅ 跨文件：spec、决策记录、实施计划与 AppShell／NativeAccountList／CSS 对应；概览与账号页共同使用同一账号行。此次没有接口签名或协议变更，没有 PR。
- ✅ 配置：主题变量同时覆盖显式浅色、显式深色及系统深色；沿用依赖、860×600 原生最小尺寸和原有测试端口覆盖。外层预览参数仅属于 .cache fixture，不进入正式入口。
- ✅ 文档与代码：运行 32px／账号操作 25px、178px 侧栏、52px 顶栏、430px 详情与源码和截图对应；原型 README 继续指向本 worktree 的正式 spec／trace／plan。
- ❌ 已知验收缺口：Tauri 原生标题栏、窗口限制、WebView 滚动与焦点未实测；只报告浏览器结果，不以浏览器或旧截图替代。

当前计划共 41 项，原有 36 项有证据，本轮追加 4 项已完成，剩余 1 项原生验收及原因已记录。此次补充使用 `brainstorming` 确认两处布局差异；浏览器、验证及一致性技能沿用前文清单。

## 七组场景预览（2026-10-28，当前入口）

用户确认补齐场景后，按[场景计划](../superpowers/plans/2026-10-28-bee-preview-scenarios.md)增加 39 个场景。外层提供分组选择、独立明暗主题和窗口尺寸、场景说明与重置；URL 保留 scene/theme/size。当前[预览入口](http://127.0.0.1:1421/.cache/bee-shadcn-review.html?scene=running&theme=light&size=normal)兼容原地址，维护代码位于 desktop/tests/fixtures/bee-preview/。两个 .cache HTML 只保留入口结构并引用维护代码。

| 选择器分组 | 数量 | 内容 |
| --- | --- | --- |
| 设备绑定 | 5 | 未绑定、等待网页确认、过期、已绑定、核对失败 |
| 贡献运行 | 6 | 停止、启动中、运行中、停止中、连接断开、开始结果未确认 |
| AI 账号 | 7 | 读取中、没有登录、候选、已接入、读取失败、授权过期、候选变化 |
| 接单条件 | 4 | 满足条件、手动暂停、多原因阻塞、单平台异常 |
| 自动核对 | 6 | 安静后台核对、报告过期、等待、重试中、已恢复、完整恢复过程 |
| 额度报告 | 5 | 正常、未知、过期、多窗口、超过 100% |
| 确认与详情 | 6 | 登录、接入、停止、换号、取消接入确认和来源详情 |

全部内容由正式 NativeApp 渲染。确认场景只打开正式弹窗；runtime-unknown 为演示未确认结果，仅触发一次模拟开始。设备确认、账号动作和贡献操作只改变内存 fixture。本增量没有修改正式组件、hook、协议、基础 native-accounts fixture 或后端，也未提交、发布或触发真实授权与贡献。

自动恢复先显示剩余约 1.5 秒有效的报告，过期读取等待 1 秒后失败，沿用正式 10 秒间隔，再模拟 3 秒读取后恢复。ego-browser 实测依次出现「核对中…」「等待自动重试…」「重试中…」，成功后 App 内提示收起；全程约 15.5 秒。过期及失败不显示旧可接单结论，操作禁用；重置重新开始，切换场景会隔离旧响应。单独的重试中场景也需先等待正式重试间隔。

确认接入后，fixture 的暂停标志立即为 true，开始贡献保持该标志；正式共享供给模型在下一次 10 秒读取周期更新暂停按钮。原用例的 5 秒等待不足，改为等待新的供给读取后检查按钮，未更改正式调度或掩盖暂停字段。页面在这段间隔可能保留前次供给报告的原因和按钮文案，此处记录现有刷新行为。

### 验证与审查证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 实现前分组选择回归 | 原入口没有七组，预期失败 | [RED](../../.cache/desktop-silver-ui/preview-scenes-red.log) |
| 全场景与交互回归 | Chromium 45/45，通过；39 场景及 6 项交互检查 | [日志](../../.cache/desktop-silver-ui/preview-scenes-tests.log) |
| 换号身份隔离回归 | 2 项先失败，修复后进入上述全量通过 | [RED](../../.cache/desktop-silver-ui/preview-scenes-identity-red.log) |
| typecheck／正式 build | 均退出 0 | [类型检查](../../.cache/desktop-silver-ui/preview-scenes-typecheck.log)、[构建](../../.cache/desktop-silver-ui/preview-scenes-build.log) |
| 差异格式检查 | git diff --check 退出 0 | 本轮命令输出 |
| 行为路径审查 | 1 项 P2 已修复并复查关闭 | [报告](../../.superpowers/sdd/preview-scenes-review.md) |

执行环境为 Node 24.22.1；从 desktop/ 执行 BEE_E2E_PORT=1471 npx playwright test --config playwright.preview.config.ts、npm run typecheck、npm run build。预览配置默认端口 1471，与已有 1421 预览服务隔离；没有新增产品配置或依赖。39 个场景经过正式 DTO 解码并验证预期文案与无意外写入；额外覆盖选择器、完整恢复、配对、接入后暂停和两条换号路径。本次正式组件未变，不重复计入此前 152 项浏览器回归。

审查发现换号 fixture 只更新候选指纹，保留了旧授权与额度。已将新候选授权归属统一、清空未核对的新身份额度，确认前旧选择保持不变；用户确认后仍暂停且额度未知。两条换号回归验证只提交一次账号动作，旧额度不转移到新身份。

### 实际页面检查

通过 ego-browser 查看并逐图检查如下结果。浅色主按钮深色实心，深色主按钮浅色实心；860×600 页面无横向溢出，账号区域纵向滚动，弹窗文字和操作完整可见。

- [浅色参考尺寸](../../.cache/desktop-silver-ui/preview-scenes-light.png)
- [深色 860×600](../../.cache/desktop-silver-ui/preview-scenes-dark-narrow.png)及[滚动到底部](../../.cache/desktop-silver-ui/preview-scenes-dark-narrow-scrolled.png)
- [浅色窄窗口停止确认](../../.cache/desktop-silver-ui/preview-scenes-confirm-light-narrow.png)、[深色窄窗口换号确认](../../.cache/desktop-silver-ui/preview-scenes-confirm-dark.png)
- [等待自动重试](../../.cache/desktop-silver-ui/preview-scenes-retry.png)、[恢复成功](../../.cache/desktop-silver-ui/preview-scenes-recovered.png)

重置后外层阶段回到「报告有效」；从挂起的核对场景切到停止确认后，阶段提示清空。最终页面保留运行中＋浅色＋参考尺寸，供用户继续查看。截图包括外层预览工具栏；正常 iframe 为 1118×738，窄窗口为 860×600。

### 本增量一致性清单

- ✅ 会话：七组场景、独立主题和尺寸、完整自动恢复对应用户批准；保留 shadcn 外观、自动重试和暂停规则，没有恢复被拒绝的手动供给核对。
- ✅ 文档内部：spec 当前评审入口已指向正式组件预览；早期原型明确标为历史。视觉纠偏的两场景入口与当前 39 场景按时间区分，恢复过程与说明一致。
- ✅ 跨文件：spec、决策记录、计划、39 项目录和测试逐项对应；账号身份与额度归属、paused/reasons、ready/reasons 和严格 DTO 解码一致。没有产品接口变更或 PR；本增量范围如上。
- ✅ 配置：继续使用既有依赖；测试端口默认 1471、可用既有 BEE_E2E_PORT 覆盖。旧新预览入口引用相同模块，scene/theme/size 默认值和实际结果一致；无需新增环境模板。
- ✅ 文档与代码：浏览器测试数量、真实 10 秒重试、截图尺寸、模拟操作边界与实现和日志一致；所有证据链接可定位。

本预览计划 11/11 项完成。此前银白 UI 计划仍为 40/41，唯一未完成的 Tauri 原生窗口验收保持独立；本次没有以浏览器结果代替原生证据。

## 原生包启动纠正（2026-10-29）

用户指出打开的 App 仍为旧 UI 后，核查发现活动主进程 PID 33046 自 10 月 27 日 17:00:20 运行，路径属于 `Bee Dev.app`；其子进程为 PID 33053。新构建的 `Bee S1 Dev.app` 当时没有运行。两个包的 identifier 均为 `dev.tokhive.bee`，现有单实例处理会将再次启动转为显示旧进程窗口。此前构建通过及包内 sidecar smoke 通过，不足以证明新 UI 已在活动原生窗口中显示；交付时未验证活动进程，相关口头结论纠正。

通过系统正常退出事件关闭旧 App，确认主、子进程均退出，再用新包绝对路径启动。11:40:17 启动的新主进程为 PID 40237，子进程为 PID 40280，两者路径均属于 `Bee S1 Dev.app`。包内可执行文件 SHA-256 与本次构建的 [artifact.json](../../.cache/s1-current-app-2026-10-29/artifact.json) 一致。

系统屏幕捕获权限检查通过后，按新主进程所属 window ID 3393 截取了[实际原生窗口](../../.cache/s1-current-app-2026-10-29/native-window.png)，并逐图查看。窗口外框为 1000×700，当前为深色主题；已显示新版无副标题概览、突出主按钮、设备三列摘要和共享账号列表。当前宽度触发源码 `max-width:1000px` 的窄布局，额度移到身份下方。本次截图确认新 UI 实际打开；没有执行原生明暗主题切换、860×600 最小尺寸、滚动或弹窗焦点的完整验收，银白 UI 计划仍为 40/41。

实际页面同时显示官方账号来源读取失败（`source_missing`，`not_found:true`）与启动前置条件失败，贡献未启动。该结果属于当前真实状态，不是预览中的 running 场景，也不证明 S1 全部业务验收通过。本次未执行账号重新登录、接入、平台恢复或手动开始贡献。

## 提交前核对（2026-10-29）

按用户“提交代码”的指令整理已有改动，分为官方账号读取超时修正、正式 UI 与场景预览、历史范围与执行状态文档。旧布局草图仅在开发模式 `?prototype=accounts` 可达；正式 App 使用 `NativeApp`，七组预览继续通过模拟 IPC 渲染同一套正式组件。两个 `desktop/.cache/*.html` 是维护代码的兼容入口，随预览一起保存；根目录 `.cache/` 中的构建包、截图、日志和临时计时文件不纳入提交。

本轮源码未新增修改，重新执行以下检查，全部命令退出 0：

| 检查 | 结果 | 本机日志 |
| --- | --- | --- |
| 聚焦 Node 测试 | 35/35 | [unit.log](../../.cache/commit-2026-10-29/unit.log) |
| `npm --prefix desktop run test:device` | Node 28/28、Chromium 50/50；Node 与上行有交集 | [device.log](../../.cache/commit-2026-10-29/device.log) |
| 七组场景回归 | Chromium 45/45 | [preview.log](../../.cache/commit-2026-10-29/preview.log) |
| 公共壳定向回归 | Chromium／Firefox／WebKit 102/102 | [demo.log](../../.cache/commit-2026-10-29/demo.log) |
| Go 账号与能力检查 | `go test -race ./agent -run 'TestDesktopAccount\|Test.*Capabilit\|TestOpenAI' -count=1 -timeout=180s` 通过 | [go-test.log](../../.cache/commit-2026-10-29/go-test.log) |
| Rust sidecar 测试 | 21 通过，1 个签名包专用测试按既有定义忽略；48 个其他模块测试未选中 | [rust-test.log](../../.cache/commit-2026-10-29/rust-test.log) |
| 演示与正式构建 | 两者均通过内置 TypeScript 检查与 Vite 构建，最终 dist 为正式版本 | [演示](../../.cache/commit-2026-10-29/build-demo.log)、[正式](../../.cache/commit-2026-10-29/build.log) |

提交前一致性核对：

- ✅ 会话：shadcn 视觉、无概览副标题、额度下方操作、自动核对与失败重试、开始不恢复平台，与已确认决定一致。
- ✅ 文档内部：明确区分历史未提交状态和 10 月 29 日提交授权，旧手动检测规则由后续 UI 规格接替。
- ✅ 跨文件：正式组件、自动读取 hook、严格 IPC 解码、预览目录和测试对应；此前审查问题已关闭，本次未改写产品协议。
- ✅ 配置：测试默认端口与覆盖值、正式／演示入口、Node 版本和 Tauri 前后端实际版本一致，无新增产品环境项或依赖。
- ✅ 文档与代码：预览 11/11、银白 UI 40/41 的计数保留；新原生截图只证明新版启动，完整原生窗口验收和真实业务验收仍有缺口，不因提交标为完成。

## 后台轮询稳定性修复（2026-10-29）

本次仅修复正式 App 的读取与操作反馈，不改已批准布局、颜色、轮询间隔或后端协议。对应[补充计划](../superpowers/plans/2026-10-29-bee-polling-stability.md)及既有 UI spec 的 10 月 29 日确认。

原先运行快照、供给读取和账号轮询共用按钮操作状态，正常读取会反复禁用按钮，形成明暗闪动。现将内部读取与显式操作锁分开：正常读取保留有效界面，点击时立即去重，已有读取完成后核对当前状态并最多发送一次。读取失败、候选过期、身份／Hive generation／运行上下文改变、页面卸载及管理进程更换时，不继续相应的等待写入；错误保留至成功核实，只重新读取，不重放写入。

读取结束显式推进下一次轮询，避免相同失败或被拒绝旧快照没有引起渲染依赖变化而停止重试。审查补齐两项：供给等待操作绑定每平台账号／运行上下文版本，曾变化后恢复也不放行旧点击；同一官方登录 pending→running 仍可取消，终态或替换登录不取消。登录期间候选来源被清空时，也不再因 400 毫秒轮询反复显示来源读取提示；该路径[先复现失败](../../.cache/polling-stability/login-hint-red.log)，修复后纳入最终 69 项设备回归。审查者复查通过，独立供给 model 25/25；未扩大为线上账号或完整原生验收。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 聚焦 Node | 42/42 通过 | [日志](../../.cache/polling-stability/unit-final.log) |
| 设备及正式页面 fixture | Node 35/35、Chromium 69/69 通过；Node 与上行有交集 | [日志](../../.cache/polling-stability/device-final.log) |
| 七组预览场景 | Chromium 45/45 通过 | [日志](../../.cache/polling-stability/preview-final.log) |
| 正式前端及原生构建 | TypeScript／Vite、Tauri debug app 均退出 0，最终包签名验证通过 | [前端](../../.cache/polling-stability/build-web.log)、[原生](../../.cache/polling-stability/build-app-final.log) |
| 新增缺陷 RED | 连续失败停轮询、等待恢复作用于新账号、登录状态转换误拦已复现 | [连续失败](../../.cache/polling-stability/retry-red.log)、[恢复误写](../../.cache/polling-stability/resume-red.log)、[取消误拦](../../.cache/polling-stability/admission-red.log) |
| 页面实测 | 浅色 1118×738、深色 860×600，无横向溢出；延迟读取时主按钮与暂停按钮保持可用，无额外加载提示 | [测量](../../.cache/polling-stability/browser-checks.json)、[浅色](../../.cache/polling-stability/light-normal.png)、[深色](../../.cache/polling-stability/dark-narrow.png) |
| 自动失败恢复 | 依次等待重试、重试中、恢复，恢复后提示收起；全程零业务写入 | [等待状态](../../.cache/polling-stability/retry-waiting.png) |

测试使用 Node 24.22.1，设备端口 1473、预览端口 1471。没有新增依赖或产品配置；两个 Playwright 配置分别包含／排除正式 IPC fixture 测试，避免误跑旧演示模式。共享页面壳和视觉样式未改，本轮未重复运行此前已通过的 102 项共享壳回归。

原生交付先按当前 revision 重建 sidecar，再构建 `Bee S1 Dev.app`；首次沿用旧 sidecar 被源码 revision 校验拒绝后，已通过正式构建脚本重新生成，未绕过校验。最终 12:43:30 正常重启，主进程 PID 34446、子进程 PID 34577 均来自该包绝对路径，旧进程已退出，其他 S2 App 未操作。[包哈希与来源](../../.cache/polling-stability/artifact.json)记录构建时的基线和工作区修改；验证时本轮修复尚未提交，用户随后授权提交，本记录随修复源码一并提交，未推送或发布。

已按本 App window ID 3628 截取并查看[最终原生窗口](../../.cache/polling-stability/native-steady-0.png)。当前深色 1000×700、贡献未运行，来源读取错误按真实状态保留。首次采样包含初始快照加载和运行状态收敛，按钮随真实状态改变，不计作正常轮询稳定证据；保留[首轮记录](../../.cache/polling-stability/native-bootstrap-stability.json)。状态稳定后每 1.1 秒截取一次，共 12 帧，跨多轮读取主按钮像素一致：[采样结果](../../.cache/polling-stability/native-stability.json)。此项仅证明当前状态的按钮稳定；没有进行真实登录、接入、贡献或完整原生明暗／最小尺寸／焦点验收，原银白 UI 计划仍为 40/41。

本次一致性核对：

- ✅ 会话：正常后台读取保持稳定；仅显式操作、过期和失败恢复反馈；去重、状态校验和自动只读恢复保留。未恢复手动供给核对、全局恢复或被拒绝布局，符合现有 UI 决策。
- ✅ 文档内部：spec、补充计划和本节对正常读取、操作锁、30 秒供给有效期及失败恢复的描述一致；历史检查按日期保留，不混为本轮重跑或完整验收。
- ✅ 跨文件：按钮调用、hook、最新 revision、候选引用、供给上下文版本和 IPC／后端校验对应。所有调用方适配新增内部状态，无产品 DTO 变更；本轮修改范围与记录一致，没有 PR。
- ✅ 配置：正常轮询周期、依赖、主题和原生最小尺寸未改；两个测试配置包含／排除新 fixture，默认端口和 BEE_E2E_PORT 覆盖继续对应，无新增环境项需要模板。
- ✅ 文档与实现：测试数量、明暗／窄窗口浏览器结果、实际原生包进程及按钮采样均有证据。原生完整验收和真实业务验收缺口明确保留；验证时未提交与随后用户授权提交的时点明确区分。

一致性结论：本次修复无未解决冲突；既有完整验收缺口保持独立，不以本轮结果代替。
