# Bee 桌面银白布局与账号交互实施计划

> **执行代理：** 使用 `executing-plans` 与 `subagent-driven-development` 在当前会话逐项实施和审查；用户已明确授权修订计划后开始修改正式 App。以下复选框用于记录执行结果。

**目标：** 将已确认的银白布局及 shadcn/ui 组件方向落实到真实桌面入口，完整保留设备、贡献与账号能力，并让过期核对和失败重试自动完成。

**架构：** 沿用 `NativeApp` 的设备、运行、账号和共享供给模型。将概览与账号页组合到同一套账号行中，复用现有动作和 Radix 弹层；自动重试只调用读取接口，不重放写入。

**技术栈：** 沿用 React 19.2.8、TypeScript 7.0.2、Vite 8.2.4、Radix 1.8.1、Lucide 1.43.0、Tailwind 4.3.3；Tauri 前端 API／CLI 2.12.4、Rust 壳 2.12.5；Node 24.x；不新增依赖。

**状态：** 2026-10-28 首轮实施完成 36/37 项；用户反馈后追加的 4 项视觉纠偏现已完成，合计 40/41 项。首轮行为路径复审已通过，当前视觉结果以文末纠偏证据为准；Tauri 原生窗口验收待补。

**2026-10-29 交付更新：** 用户明确要求提交代码，按内容分组提交相关源码与文档。已正常退出仍在运行的旧 App，启动 `Bee S1 Dev.app`，核对新主／子进程路径并查看深色原生窗口截图；仅证明新版 UI 已实际打开，不勾选 Task 5 的完整原生验收。账号来源读取失败与贡献未启动的真实状态记录在[验证记录](../../desktop/2026-10-28-bee-shadcn-ui-validation.md#原生包启动纠正2026-10-29)，不是 S1 全部验收通过。

## 依据与边界

- 规格：[概览与 AI 账号界面](../specs/2026-10-27-desktop-overview-accounts-ui-design.md)；[用户决策](../specs/2026-10-27-desktop-overview-accounts-ui-design-decision-trace.md)。未定的产品交互先简短讨论，不自行重画方案。
- 固定视觉基准：[2026-10-22 原型](../../../../../docs/ui/bee-silver-2026-10-22/preview.html)；已批准功能布局：[2026-10-28 预览](../../../../../docs/ui/2026-10-28-bee-silver-current-ui-prototype.html)。两者及文末用户确认的视觉纠偏共同决定布局；组件视觉采用 [三方案对比的 shadcn 版本](../../../../../docs/ui/2026-10-28-bee-theme-comparison.html?variant=shadcn)，源码参考 [bee-theme-prototype](../../../../../docs/ui/bee-theme-prototype/)。比较原型不改变业务交互。
- 主目标为 `desktop/src/app/NativeApp.tsx` 的真实入口。`OverviewPage.tsx` 属于旧演示入口，修改它不能替代真实入口验收；演示数据不得进入正式入口。
- 范围为公共壳、概览、AI 账号及详情。诊断、设置继续可达，业务内容不重做。去掉收益导航，不为这次改版清理整套历史收益代码或演示客户端。
- 浅色背景 `#f7f8fa`、侧栏 `#f7f6f3`、正文 `#2c2b28`、分隔线 `#eae7e1`、强调 `#ba8d49`；系统字体正文 13px、辅助信息 10–12px、页面标题 24px；侧栏 178px、顶栏 52px、主内容左右留白 29px；详情约 430px、确认弹窗约 400px。深色沿用现有原型变量；最小窗口 860×600。
- 复用 Bee 现有组件与 Radix 语义，对照 Hive／比较原型的 Button、Badge、Progress 适配 shadcn/ui 风格。保留银白底色与克制琥珀点缀；浅色主按钮深色实心，深色主按钮浅色实心，次要操作描边或弱化；不新增依赖。
- 保留中英文、键盘焦点、Escape、滚动与原生标题栏。正式应用不带网页预览外框、场景选择器或仿制窗口按钮。
- 保留管理进程实例、账号 revision、来源失效、写入不确定状态和供给新鲜度保护。过期、失败、未知不能显示旧的可接单结论；后台核对成功前不得重新开放被保护的写入。
- 供给读取沿用现有 10 秒间隔、30 秒报告新鲜度。失败后按读取间隔重试，不自旋，不重放 `supply_set_paused`、`account_action`、`runtime_start`、`runtime_stop` 或官方登录。
- 不修改 Go、Hive、IPC DTO、账号协议或贡献进程；官方读取的 10 分钟超时上限、缓存及 `retry_at` 继续生效。平台报告核对与官方额度读取不是同一种请求。
- 不新增 Claude、换号或买家请求的真实线上验收。对应界面与模拟回归仍须覆盖；不使用本机真实凭证进行浏览器测试。

## 执行位置与现状

实施根目录：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`，当前分支 `feat/bee-desktop-p0`，计划基准提交 `9e2bc77`。执行前按 `using-git-worktrees` 核对并复用合适的隔离工作区。

该目录已有其他任务的未提交修改，包括 `agent/`、`desktop/src-tauri/src/sidecar.rs`、`desktop/src/main.tsx`、历史规格和计划。执行前记录状态；不回退、覆盖或整体暂存。旧 `desktop/src/prototype/accounts-ui/` 是未提交草图，本次已批准参考为上面的 HTML，不直接移植其模拟逻辑。

默认 shell 当前使用 Node 26，执行检查时须切换项目支持的 Node 24。优先使用已有 `/Users/dayong/.nvm/versions/node/v24.22.1/bin`，先核验版本；不要为本任务升级依赖。以下命令从实施根目录运行。

## 文件与职责

| 文件 | 改动与职责 |
| --- | --- |
| `desktop/src/features/supply/useSupply.ts` | 保留共享模型和写入保护，增加只读失败重试与可展示的核对状态 |
| `desktop/src/features/accounts/useAccounts.ts` | 在账号页自动读取来源、接入后读取额度，保留 revision、来源与操作隔离 |
| 新 `desktop/src/features/accounts/accountPresentation.ts` | 纯展示映射：已选择身份、匹配的套餐/额度/到期时间与接单状态；不发请求 |
| 新 `desktop/src/features/accounts/NativeAccountList.tsx` | 概览和账号页共用的紧凑列表；按页面开放对应动作 |
| `desktop/src/features/accounts/NativeAccountsPage.tsx` | 账号页组合、自动读取触发与详情入口 |
| `desktop/src/features/accounts/NativeAccountDetails.tsx`、`NativeAccountActions.tsx` | 右侧详情、凭证来源、已有登录/接入/换号/撤销动作及确认 |
| 新 `desktop/src/features/overview/NativeOverviewPage.tsx` | 组合运行摘要、设备摘要、共享账号列表 |
| `desktop/src/features/lifecycle/NativeRuntimeControls.tsx` | 原型运行摘要和单个主按钮，开始不恢复平台，停止仍确认 |
| `desktop/src/features/lifecycle/useRuntime.ts` | 运行状态读取失败后自动核对，保留不确定写入和实例隔离 |
| `desktop/src/features/device/DevicePairingPage.tsx` | 已绑定及等待确认的三列摘要，保留首次配对与过期配对流程 |
| `desktop/src/app/NativeApp.tsx`、`navigation.ts`、`desktop/src/components/AppShell.tsx` | 接线、四项导航、去面包屑、真实侧栏摘要 |
| `desktop/src/components/DetailSheet.tsx`、`desktop/src/styles/app.css`、`tokens.css` | 复用弹层语义，限定目标页面样式，复用 shadcn/ui 组件风格、原型尺寸与响应式 |
| `desktop/src/i18n/en.ts`、`zh.ts` | 新呈现文案及可访问名称；动态账号、网址不经翻译 |
| `desktop/tests/` 与 `docs/desktop/account-runtime-validation.md` | 更新已改变的交互断言，保留保护性回归与验证证据 |

## Task 1：供给报告自动核对与失败自动重试

**文件：** 修改 `desktop/src/features/supply/useSupply.ts`、`SupplyPanel.tsx`、`desktop/tests/supply.test.ts`、`supply.spec.ts`；增加所需中英文文案。

**接口：** 保留 `createSupplyModel(client)`、`SharedSupply`、`read()`、`write(platform, paused)`、`canWrite(platform, paused?)`。`SupplyState` 在现有 `views/errors/busy/now` 外增加 `operation: 'idle' | 'read' | 'write'`、`activePlatform: SupplyPlatform | null`、`retryAt: number | null`；用于区分正常后台读取、过期核对、失败等待和执行中的重试。

- [x] 更新模型与浏览器用例：读取失败后 10 秒再次 GET；连续失败继续按间隔 GET；不重复 PUT；一个平台失败不清空另一平台的新鲜结果；慢请求不重叠。
- [x] 增加新鲜读取不闪烁、报告在请求中超过 30 秒后收起旧结论、过期时自动读取的检查；保留按钮点击时实时检查时间，不能仅依赖定时器更新的 `now`。
- [x] 运行 `node --test desktop/tests/supply.test.ts`，确认新增行为断言在修改模型前失败。修改调度：每轮读取结束后安排下一轮，错误也安排只读重试；到期触发与已有请求合并。清理页面停用、卸载和实例更换后的定时器及晚到结果。
- [x] 更新旧 `SupplyPanel` 的进度呈现以便独立验收：正常读取安静；过期请求显示「核对中…」；失败后分别显示「等待自动重试…」「重试中…」；成功收起。删除手动核对入口，保留底层原始诊断证据。
- [x] 更新 `supply.spec.ts` 中“失败停止轮询”“显式 GET 才恢复”“任何读取都隐藏新鲜结果”的旧断言；保留实例隔离、未知设备不发 IPC、过期不能写、平台类型校验等断言。
- [x] 运行 `node --test desktop/tests/supply.test.ts`；在 `desktop` 运行 `npx playwright test --config playwright.device.config.ts supply.spec.ts`。预期全部通过，无未执行的目标用例；自检并记录本任务改动；保留已有脏工作区，整体验证后再整理提交。

## Task 2：自动账号读取与共用账号行

**文件：** 修改 `useAccounts.ts`、`NativeApp.tsx`、`NativeAccountsPage.tsx`；新建 `accountPresentation.ts`、`NativeAccountList.tsx`、`desktop/tests/accountPresentation.test.ts`；更新 `desktop/tests/native-accounts.spec.ts` 及 `fixtures/native-accounts.mjs` / `.d.mts`。

**接口：** `useAccounts` 增加末尾可选参数 `autoRead = false`，由真实入口传入 `page === 'accounts'`；保留 `AccountsModel` 已有 `edit/detect/refresh/action/authorize/cancelAuthorize`。`NativeAccountList` 接收 `{context: 'overview' | 'accounts'; accounts: AccountsModel; runtime: RuntimeModel; supply?: SharedSupply}`。展示映射导出 `accountPresentation(snapshot: AccountSnapshot | undefined, dirty: boolean, now: number)`，结果含 `identity: string | null`、`plan: string | null`、`expiresAt: string | null`、`windows: AccountWindow[]`、`quotaState: 'unknown' | 'current' | 'stale'`。

- [x] 为展示映射新增有意义的单元用例：候选与选择指纹不同不能显示为当前账号；缺失观察不显示 0%；保留 120% 原值，进度条只对绘制值封顶；多个 scope/窗口不丢失；到期或 reset 后不能显示为当前额度。
- [x] 绑定数据来源：身份取 `selection.fingerprint` 的前缀。候选指纹匹配选择且来源未脏时，才可使用候选的授权到期/套餐和对应官方观察；Hive 指纹匹配选择时可使用其观察。两者都可用时优先新鲜的官方观察，缺失或不匹配时显示未知，不借用另一账号的数据。
- [x] 账号页进入并取得默认来源后自动读取已有登录。目录编辑保留输入草稿，失焦时提交来源并自动读取；存储方式选定后自动读取。来源更换使旧结果失效，但不会自动接入、换号或恢复平台。StrictMode、离开重进和晚到响应不能重复启动同一来源请求或覆盖新来源。
- [x] 接入后后台读取必要的官方信息，尊重现有缓存、`retry_at`、进行中的操作和 10 分钟读取上限；同一来源/账号未变化且观察仍有效时不重复触发官方读取。概览只消费已有快照；不能在概览新增模型目录请求。官方读取失败、无登录或需要系统授权时保持对应未知状态，不做密集读取或反复弹授权框。
- [x] 账号快照读取失败、账号写入结果不确定或操作处于 `reconciling` 时，复用 `read(platform, true, operationId?)` 每 10 秒自动核对；正常 pending/running 操作继续每 400 毫秒读取缓存。合并进行中的请求，未获得能确认结果的新快照前仍保持 `uncertain`。不得自动重放账号动作或官方登录，也不能用 runtime 的旁路观察清除账号写入不确定状态。
- [x] 实现共享列表的身份、套餐、所有原因和额度分组；OpenAI 优先 5 小时、7 日，其余窗口保留。平台供给状态来自同一 `SharedSupply`，读取中且报告仍有效时保留有效结论；过期或失败收起结论。尚无报告用「状态待确认」，过期/失败用「状态待更新」。
- [x] 在概览和账号页中按 `runtime.view.local === 'running'` 决定是否展示分平台暂停/恢复；禁用规则仍来自 `model.canWrite`、设备错误与账号待确认状态。未接入平台不显示暂停/恢复。
- [x] 运行 `node --test desktop/tests/accountPresentation.test.ts desktop/tests/nativeAccounts.test.ts`、`npm --prefix desktop run typecheck`；在 `desktop` 运行 `npx playwright test --config playwright.device.config.ts native-accounts.spec.ts`。更新旧手动检测断言，保留来源竞争和账号隔离断言；自检并记录本任务改动；保留已有脏工作区，整体验证后再整理提交。

## Task 3：公共壳与真实概览按原型重排

**文件：** 修改 `AppShell.tsx`、`navigation.ts`、`NativeApp.tsx`、`NativeRuntimeControls.tsx`、`useRuntime.ts`、`DevicePairingPage.tsx`、`app.css`；新建 `NativeOverviewPage.tsx`；更新 `desktop/tests/device.spec.ts`、`native-runtime.spec.ts` 及本任务文案。

**接口：** `NativeOverviewPage` 接收现有设备视图与 `begin/refresh/open` 回调，以及 `AccountsModel`、`RuntimeModel`、可选 `SharedSupply`。运行入口使用 `runtime.start([])`；停止沿用 `runtime.stop()`。公共壳只消费已有真实设备/连接摘要，不自行读取。

- [x] 先更新浏览器行为断言：开始请求的 `resume_platforms` 必须为 `[]`，开始后没有自动恢复写入；停止必须经确认，说明可能中断任务；失败或过渡状态不能误显已连接或开放不安全操作。
- [x] 移除开始前的恢复勾选。将运行摘要改为左侧图标/标题/说明、下方 Bee/Hive 状态、右侧唯一开始/停止按钮。保留现有过渡、失败、未知及不确定结果保护，不将管理进程在线当作贡献运行。
- [x] 运行状态读取失败后复用现有 `runtime.refresh()` 的只读路径自动核对，沿用普通 2 秒/过渡 300 毫秒的调度条件，失败时使用普通间隔；成功确认前保留写入保护。移除正常运行摘要中的手动核对按钮，不自动再次发送开始或停止请求。
- [x] 将已绑定设备改为名称、归属邮箱、Hive 三列；等待确认时改为配对码、有效期、网址及打开动作三列。复用已校验的 `verification_url`，不拼出原型示例网址；保留首次配对表单、旧设备 draining、配对过期及已有错误恢复流程；不展示设备 ID。
- [x] 用新概览组件组合运行区、设备区和 Task 2 列表，替换真实入口中原有三个孤立板块。移除重复平台供给面板，页面中每个平台只出现一行。
- [x] 导航改为四项，去掉「工作空间」面包屑；顶栏设备标识、真实侧栏信息、既有设置/诊断可达性保留。共享壳移除收益入口时处理旧演示页可能残留的 `earnings` 选中值，避免找不到当前导航项导致崩溃。
- [x] 落实 shadcn/ui 按钮、标签、细额度条与输入框；主操作在明暗主题都保持高对比，次要操作描边或弱化。沿用已有 CSS 变量，限定目标组件样式，修正后置通用 `.account-row` / `.finance` 规则覆盖原型列宽的问题。设备三列保留分隔线；860px 下允许文本换行，账号额度组下移。
- [x] 在 `desktop` 运行 `npx playwright test --config playwright.device.config.ts device.spec.ts native-runtime.spec.ts`；运行 `npm --prefix desktop run typecheck`。预期设备流程、开始/停止、恢复保护与未知状态用例通过；自检并记录本任务改动；保留已有脏工作区，整体验证后再整理提交。

## Task 4：账号动作与右侧详情收敛到已批准交互

**文件：** 修改 `NativeAccountsPage.tsx`、`NativeAccountList.tsx`、`NativeAccountActions.tsx`、`NativeAccountDetails.tsx`、`DetailSheet.tsx`、`app.css`、中英文词典；更新 `native-accounts.spec.ts`、`native-runtime.spec.ts`。

**接口：** `NativeAccountActions` 保留现有 `accounts/platform/runtime` 输入，增加 `placement: 'row' | 'detail'` 控制入口位置；仍调用现有账号动作。`NativeAccountDetails` 改为接收 `{accounts: AccountsModel; platform: AccountPlatform; runtime: RuntimeModel; supply?: SharedSupply}`，复用 Task 2 展示映射与来源草稿处理。

- [x] 无登录时行尾显示「登录 OpenAI/Claude」，已有候选未接入时显示「接入」，已接入后去掉读取类按钮；右侧箭头始终提供「平台名 详情」名称。真实登录与接入仍确认，不能用自动读取代替确认。
- [x] 详情只展示身份前缀、套餐、授权到期、全部额度窗口重置，以及默认展开的凭证读取方式。未知到期明确写未知；隐藏模型、代次、双观察区、原始诊断码等未批准内容。底层证据保留，不改传输解码器为无信息的错误。
- [x] 详情提供换号、重新登录、符合现有 `clear_selection` 可用条件的取消接入。换号确认明确列出当前账号和目标账号；成功后仍暂停。已注册账号不显示完整移除或把它包装成取消接入。
- [x] OpenAI 显示自动/文件/钥匙串，Claude 显示文件/钥匙串；仅将中文标签映射到已有 `auto/file/keyring/keychain` 值。沿用默认目录、不支持平台提示和官方登录可取消路径。
- [x] 页面和详情显示同一核对/重试进度，无手动「重新核对」。供给重试使用 Task 1 调度；账号操作的不确定结果继续通过已有只读快照核对，不能把来源读取成功当作写入成功，不能自动再次提交接入/换号。
- [x] 保留 Radix 模态语义、焦点约束、Escape 和关闭后返回触发入口；自动刷新不得抢焦点或覆盖输入草稿。确认弹窗使用约 400px 的对话框，详情使用约 430px 的右侧面板。
- [x] 在 `desktop` 运行 `npx playwright test --config playwright.device.config.ts native-accounts.spec.ts native-runtime.spec.ts`；运行 `npm --prefix desktop run typecheck`。断言恢复不调用 `runtime_start`、换号后暂停、不确定写入不重放、详情键盘往返和来源更新；自检并记录本任务改动；保留已有脏工作区，整体验证后再整理提交。

## Task 5：整体验证、视觉对照与交付

**文件：** 更新 `desktop/tests/supply.spec.ts`、`native-accounts.spec.ts`、`native-runtime.spec.ts`、`device.spec.ts`、相关演示壳回归及 `docs/desktop/account-runtime-validation.md`；截图存入 `.cache/desktop-silver-ui/`，记录文件名、逻辑窗口尺寸、主题、场景和数据来源。

- [x] 复核所有旧断言：取消的手动检测、全局恢复、模型详情及收益导航应改为新行为检查；来源失效、晚到响应、管理进程更换、owner 隔离和未确认写入等保护用例不得整段删除。
- [x] 运行 `node --test desktop/tests/supply.test.ts desktop/tests/nativeAccounts.test.ts desktop/tests/accountPresentation.test.ts desktop/tests/runtime.test.ts desktop/tests/authorize.test.ts`，以及 `npm --prefix desktop run typecheck`、`npm --prefix desktop run build`、`npm --prefix desktop run build:demo`、`npm --prefix desktop run test:device`。预期全部通过，记录执行数量，不用浏览器预览通过替代这些结果。
- [x] 对公共壳影响到的演示页面执行既有定向回归，在 `desktop` 运行 `npx playwright test --config playwright.config.ts p0-shell.spec.ts onboarding-overview.spec.ts accounts.spec.ts`；仅调整与已批准共享壳变化相关的预期。
- [x] 用 `ego-browser` 实看真实页面组件的 fixture 版本，对照已批准布局 HTML 和 shadcn/ui 视觉参考：概览、AI 账号、详情，浅/深色，1280×900 外层中的 1118×738 应用画布与 860×600 应用画布。分别检查侧栏、标题、运行摘要、三列设备、账号分组、额度条、按钮和面板；自动化几何断言不能替代截图审阅。
- [x] 验证状态路径：未绑定/等待确认/已绑定；未接入/已接入但停止/运行；正常后台核对无提示；过期核对；连续失败后的等待和重试；恢复成功后收起。验证平台报告核对全程没有手动按钮，失败期间不显示旧的可接单结论。
- [ ] 在本机原生壳检查标题栏、窗口最小尺寸、抽屉滚动和焦点；使用测试数据或现有非写入状态，不自动登录、接入、开始真实贡献。其他系统的原生证据缺失要在报告注明，不能把 Chromium fixture 结果说成三端原生通过。
- [x] 更新验证文档，区分纯函数/fixture/浏览器视觉/本机原生证据；附最终文件范围与已知限制。运行 `verification-before-completion`，再做 `consistency-check` 和 `post-verification-check`，逐项填写本计划。
- [x] 按全局约定对全部任务的最终改动执行 `affected-path-review`，修复确认的问题并仅重跑受影响检查。完成后按用户选定方式提交或整理交付，不自动合并或发布。

## 完成条件与计划自检

| 已批准要求 | 落实任务 |
| --- | --- |
| 保留数据边界、自动过期核对与失败重试 | Task 1、2、4 |
| 窄侧栏、单主按钮、三列设备、四项导航 | Task 3 |
| 紧凑账号行、身份/套餐/全部原因与额度 | Task 2、3、4 |
| 开始不恢复、停止确认、分平台暂停/恢复 | Task 1、3、4 |
| 自动读取、官方登录、接入、换号、取消未注册选择 | Task 2、4 |
| 右侧详情、授权到期、重置、默认展开来源 | Task 4 |
| 中英文、明暗主题、最小窗口、键盘、原生壳 | Task 3、4、5 |

计划只拆分已确认设计，没有新增产品功能、依赖或协议。正式执行若发现现有契约无法完整提供已批准信息，应先给出具体缺口并简短确认，不自行扩展后端或改变交互。

## 2026-10-28 执行证据与未完成项

- Task 1–4：实现和任务审查通过。供给模型、账号展示映射、自动读取、真实概览、三列设备、共享账号行、动作与详情均已接线；没有新增依赖或修改后端协议。
- Task 5 已执行部分：35 个聚焦 Node 测试、`test:device` 的 28 个 Node 测试及 50 个 Chromium fixture 用例、共享壳 Chromium／Firefox／WebKit 的 102 个用例通过；Node 用例之间有交集。typecheck、正式 build、demo build 和 diff 检查通过。
- 首轮视觉记录（历史）：概览／AI 账号／详情 × 浅／深主题 × 1280×900／860×600 共 12 张截图；未完成与 shadcn 参考的同尺寸、同状态直接对照，不能据此宣称视觉已还原。当前结果由文末纠偏及验证记录补充。
- 最终 affected-path review 发现两项 P2：reconciling 未刷新后端、失败来源 DTO 未记为可重试。4 个新增回归 RED→GREEN，完整 hook suite 12/12；原审阅者已复核关闭。证据见[验证记录](../../desktop/2026-10-28-bee-shadcn-ui-validation.md)。
- 首轮唯一未勾选项：Task 5 本机原生壳标题栏、最小窗口、滚动和焦点验收。本会话缺少原生窗口操作工具，现有 App 启动包含真实状态恢复且没有现成原生 fixture 模式；本轮没有执行该项。860×600 配置和浏览器验证不能替代原生运行证据。后续在可控测试状态下补验，不据此阻塞已授权的代码与文档交付。
- 首轮 post-verification-check（历史）：检查项总数 37；收尾前勾选 0，本次按证据勾选 36，剩余 1 项及原因如上。代码与文档仍为未提交修改，没有合并或发布。

## 用户反馈后的视觉纠偏（2026-10-28）

已确认两处布局调整，按修订 spec 执行；沿用现有依赖，不修改业务 hooks 或协议。

- [x] 对齐正式壳的概览标题、字体、灰色与边框色、紧凑间距和窗口内滚动；去除概览副标题，保持原生语义与入口。
- [x] 共享账号行改为身份／额度两列、动作在额度下方；对齐运行及账号状态图标；窄窗口保留全部内容和操作。
- [x] 为交付预览提供与参考相同的画布尺寸、运行中 fixture 和停用／运行切换；同条件截图并排核对浅深色和 860×600。
- [x] 运行受影响浏览器回归、typecheck、正式构建；记录实际差异与验证边界，更新一致性记录。


本轮证据：已与 shadcn 参考进行 1118×738、运行中、相同 OpenAI 额度的浅深色并排对照；标题、运行区、设备区与首个账号行起点一致。完整业务文案导致行高和滚动宽度有少量差别，860×600 按已批准规则将额度下移。概览、账号与详情两种主题的正常／窄窗口截图、滚动与焦点结果见[当前验证记录](../../desktop/2026-10-28-bee-shadcn-ui-validation.md#用户反馈后的视觉纠偏2026-10-28当前结果)。

重新执行 native fixture（28 Node＋50 Chromium）、共享壳回归（102 个三浏览器用例）、typecheck、demo／正式 build 及差异检查，均通过。当前交付入口提供运行／停止、主题和窗口切换，仅使用模拟 IPC。首轮原生壳验收仍未执行，保持未勾选。

本次 post-verification-check：总数 41；复核前已勾选 36，本轮新增勾选 4；仍未勾选 1（Task 5 原生壳验收，原因同上）。代码与文档未提交或发布。
