# Bee S2 诊断与设置 UI 实施计划

> **面向执行者：** 按用户已选的 `executing-plans` 逐任务执行并保留审阅检查点；用户已于 2026-10-28 明确要求继续，当前按本计划实施。步骤使用复选框跟踪。

**目标：** 将已完成的真实 S2 功能整理为诊断 C「问题优先」和设置 B「分类页签」，采用 Bee 已确认的银白精工 + shadcn/ui 外观。

**架构：** 保留两个原生页面的客户端、状态所有权、异步防护及命令处理，只调整呈现、局部分组与布局。直接使用现有 Radix Tabs，共用一份局部页签样式；诊断分组使用无副作用的展示函数，不重新实现业务判断。公共壳由 S1 已有工作提供，不复制其未提交文件。

**技术栈：** 沿用 React 19.2.8、TypeScript 7.0.2、Vite 8.2.4、radix-ui 1.8.1、lucide-react 1.43.0、Tailwind 4.3.3、Tauri API 2.12.4、Node 24.x 和 Playwright 1.63.0；不增加依赖。

## 全局约束

- 设计依据：[S2 UI 规格](../specs/2026-10-28-desktop-s2-ui-design.md)、[S2 功能规格](../specs/2026-10-26-desktop-diagnostics-experience-design.md)、[用户决策](../specs/2026-10-26-desktop-diagnostics-experience-design-decision-trace.md)。本计划只落实已选布局。
- 工作根目录固定为 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-s2`，分支 `feat/bee-desktop-s2`，审阅基线 `035589a`。除特别注明，命令在其 `desktop` 目录执行，文件路径均相对工作根目录。
- 不修改主工作区或 `bee-desktop-p0`，不重写 S1 账号／贡献逻辑，不改 Go／Rust、IPC 协议、网络策略、存储及 S3 更新。
- 诊断只能手动触发；日志只能明确刷新／加载更多才读；代理保存与确认应用分离。权限查询、进页和切页签不申请系统权限。
- 保留现有 `scope/current`、请求序号、修订与实例隔离、偏好回读、下载回执；页面未完成／未知／取消不能显示全部正常。
- 不把原型示例数据、预览场景开关、模拟权限或模拟成功带入正式 App。
- C／B 预览用于内容组织；最终配色采用最新 shadcn 暖银白变量，公共壳沿用已批准的 24px 页面标题、178px 侧栏、52px 顶栏及约 29px 内容留白，不复刻两份布局预览的旧冷灰变量和 57px 顶栏。
- 正常验收尺寸 1440×1000，最小尺寸 860×600；覆盖明暗、中英、键盘及弹窗。纯样式不增加镜像式单元测试。
- S1 公共壳仍有未提交改动。只使用 S2 已有公共 API 和变量；最终窗口视觉验收需等 S1 可审阅提交正式同步后完成，未同步时明确记录差异。
- 每任务验证通过后只提交本任务的明确文件，保留已有计时文件及其它改动；不使用 `git add .`，不自动合并或推送。

## S1 集成检查点与分工

当前 S1 HEAD 为 `9e2bc77`，新公共壳和账号 UI 尚未提交。以下策略已随本计划获继续实施授权；当前源提交尚未形成，先推进 S2 局部页面。

| 区域 | 来源与合并方式 |
| --- | --- |
| AppShell、tokens、全局样式、`components/ui.tsx` | S1 唯一实现；形成可审阅提交后优先同步，S2 页面复用，不另外制作相同基础组件 |
| 诊断、日志、设置页与局部 CSS | S2 实现；S1 当前没有修改这些正式页面 |
| `NativeApp.tsx`、账号／运行／供给 hooks | 在 S2 真实接线基础上逐段引入 S1 新 UI 与自动读取，不以任一边整文件覆盖 |
| `en.ts`、Playwright 配置、共享 spec／决策记录 | 合并双方增量；保留原生与 demo 分组、双方测试、端口配置和最新用户决定 |
| ConfirmDialog 危险样式 | S2 在既有组件上加可选参数，缺省兼容；集成后复用 S1 基础按钮，不建立第二套弹窗 |

执行任务 1 前，先只读运行 `git cherry -v feat/bee-desktop-s2 feat/bee-desktop-p0` 并核对新增提交 diff。当前已发现两笔 patch 等价：S1 `b4f9d8c` 对应 S2 `3b788ca`，S1 `636daa4` 对应 S2 `d9e9ca4`；其它相近提交包含 S2 网络适配等差异，不能仅凭标题或加减号判断是否缺失。S1 已有逻辑不重复实现，实际缺失修复按明确增量集成。

特别检查：S1 `useAccounts(..., autoRead)` 与 S2 `useAccounts(..., coordinated)` 的第五参数含义已分叉；`useRuntime`、`useSupply` 也需保留 S2 coordinated 模式。同步时只适配既有功能的调用与观察边界，保留单一 `createDesktopState` 协调器、实例／修订隔离和 S1 已确认的自动读取／核对，不另建轮询者。若源提交仍未形成或适配尚未完成，记录阻塞项，不以复制脏文件临时补齐。

## 文件职责与执行顺序

| 文件 | 职责 |
| --- | --- |
| 新建 `desktop/src/styles/section-tabs.css` | 两页面共用的局部 Radix 页签样式；不改变 AppShell 或全局 tokens |
| 新建 `desktop/src/features/diagnostics/presentation.ts` | 只按已有 status/platform 分区，不发命令、不推导账号或运行状态 |
| 修改 `desktop/src/features/diagnostics/NativeDiagnosticsPage.tsx`、`native-diagnostics.css` | C 版、日志页签、真实报告与回执的呈现 |
| 修改 `desktop/src/features/settings/NativeSettingsPage.tsx`、`native-settings.css` | B 版四页签、网络双栏、系统状态与版本 |
| 修改 `desktop/src/components/ConfirmDialog.tsx` | 向后兼容的可选危险确认样式，沿用现有焦点与确认处理 |
| 修改 `desktop/src/i18n/en.ts` | 两页新增文案的英文映射，证据原文保持原样 |
| 新建 `desktop/tests/diagnostic-presentation.test.ts` | 分组完整覆盖、原对象与多原因保留 |
| 修改 `desktop/tests/native-experience.spec.ts` | 适配页签与折叠，验证切换、草稿、确认及视觉边界 |
| 仅集成时修改 `desktop/src/app/NativeApp.tsx`、`desktop/src/features/accounts/useAccounts.ts`、`desktop/src/features/lifecycle/useRuntime.ts`、`desktop/src/features/supply/useSupply.ts`、`desktop/playwright.config.ts`、`desktop/playwright.device.config.ts` | 保留双方已有能力的接线与测试配置；不新写 S1 业务；S1 其它原有文件随已审阅源提交集成 |
| 按用例需要修改 `desktop/tests/fixtures/native-accounts.mjs` | 复用原生契约的可控失败／空日志／未知状态，不引入 App 模拟逻辑 |
| 新建 `docs/superpowers/reports/2026-10-28-desktop-s2-ui-verification.md` | 测试结果、真实原生证据、截图、公共壳同步情况及未完成项 |

页面任务不修改 `NativeApp.tsx` 的业务接线或创建第二套客户端；跨分支集成仅允许上表所述的兼容适配。以下接口与断言用于固定任务边界，不在计划内预写完整 JSX／CSS。

### 任务 1：诊断 C 版与安全日志页签

**文件：** 新建 `presentation.ts`、`section-tabs.css`、`diagnostic-presentation.test.ts`；修改诊断页面、局部 CSS、`en.ts` 及 `native-experience.spec.ts`。

**接口：** 消费 `DiagnosticCheck`、`DiagnosticReport` 和现有 `DiagnosticsClient`；页面 props 保持 `{client,onNavigate,instance,networkRevision,runId?}`。产出的纯展示接口如下，供本任务页面和测试共用：

```ts
import type {DiagnosticCheck} from '../../system/diagnostics.ts';
export interface CheckSections {
  issues: {device: DiagnosticCheck[]; openai: DiagnosticCheck[]; claude: DiagnosticCheck[]};
  unfinished: DiagnosticCheck[];
  passed: DiagnosticCheck[];
}
export function partitionChecks(checks: readonly DiagnosticCheck[]): CheckSections;
```

- [ ] **1. 写分组失败测试。** 在新测试中构造设备 fail、OpenAI fail + warning、Claude skipped 和 pass；断言每项只出现一次、同平台多个原因不丢失、输入及 evidence 不变、空数组返回空分区。关键断言：

```ts
const groups = partitionChecks(checks);
const output = [...groups.issues.device, ...groups.issues.openai,
  ...groups.issues.claude, ...groups.unfinished, ...groups.passed];
assert.equal(output.length, checks.length);
assert.equal(new Set(output).size, checks.length);
assert.ok(checks.every(check => output.includes(check)));
assert.equal(groups.issues.openai.length, 2);
assert.deepEqual(checks, before);
```

- [ ] **2. 验证失败。** 执行 `node --test tests/diagnostic-presentation.test.ts`，预期因展示函数尚不存在失败；之后实现该纯分区函数，仅依照 `fail/warning/skipped/pass` 和 `platform` 分组，保持组内报告顺序。
- [ ] **3. 为新页面行为写失败用例并运行。** 在 `native-experience.spec.ts` 中验证两个页签、检查区默认选中、取消／空报告／skipped 不显示全部通过；进入与切换均不调用 `diagnostics_start` 或 `diagnostic_logs`。运行 `BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts native-experience.spec.ts`，预期新页签断言失败。
- [ ] **4. 整理诊断 JSX。** 使用 `Tabs`，默认 `checks`，另一值 `logs`；样式使用共用 `section-tabs` 前缀。保留现有组件顶层的所有状态、effect、run/loadLogs/exportReport 与上下文 guard；Tab 内容卸载不卸载状态所有者，不新增切页 effect。运行按钮、取消、导出位于检查页操作区；日志刷新位于日志页。
- [ ] **5. 呈现真实 C 版。** 需要处理区显示设备与连接、OpenAI、Claude 的非空问题组；每项保留原因、状态、观察时间、安全证据和 `next_action` 导航。`unfinished` 与 `passed` 放下方独立折叠区并显示实际数量；运行／取消／完成说明始终可见。只有 `completed`、非空且全部已返回检查为 pass 才表达全部通过，不以“问题区为空”判断。用现有译文映射与原始 code 兜底，不新增业务原因推断。
- [ ] **6. 保留日志和真实导出。** 增加当前范围“是否已读取”的页面状态，在 filter/context 变化时清除，明确区分未读、读取中、读取为空和失败；其写入同样受原 `current()` 和 `logRequest` 校验。保留八类模块、原生 cursor、截断、导出范围及 `downloadPayload()` 回执；长证据换行。补全新增英文，不翻译证据字段值。
- [ ] **7. 适配已有测试并验证。** `completeReport()` 与返回诊断页的 Hive 断言先展开通过区；日志用例先选择「安全日志」，保持现有命令／分页／导出／旧实例断言。执行下列命令，预期全部通过，不能通过删除旧边界断言获得成功：

```bash
node --test tests/diagnostic-presentation.test.ts tests/diagnostics.test.ts
npm run typecheck
BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts native-experience.spec.ts
```

- [ ] **8. 审阅并提交本任务。** 在工作根目录运行 `git diff --check`；只暂存本任务已验证文件，提交 `refactor(desktop): 整理问题优先诊断与日志页签`，展示检查点后进入下一任务。

### 任务 2：设置 B 版分类页签与网络双栏

**文件：** 修改设置页面、局部 CSS、`ConfirmDialog.tsx`、`en.ts` 与 `native-experience.spec.ts`；复用任务 1 的 `section-tabs.css`。

**接口：** 沿用 `NativeSettingsPageProps`、`NetworkClient.snapshot/test/saveProxy/applySaved(true)`、`PreferencesClient.save/read` 和 `notificationsClient` 的既有方法。内部页签值为 `general | network | system | about`，默认 `network`；不增加持久化字段。ConfirmDialog 只增加 `destructive?: boolean`，缺省为 false，现有调用方保持原样。

- [ ] **1. 适配旧设置用例并补失败断言。** 语言／外观测试先点「通用」，通知／自启先点「通知与启动」。新增断言：默认网络、四页签齐全、往返不丢代理输入或测试结果；切页不增加 network_snapshot、notification_permission、autostart_status、notification_delivery_status，也不发 notification_enable/autostart_set；关于分别显示构建 App 版本和 bridge Bee 版本，缺失 Bee 版本显示尚未读取。
- [ ] **2. 验证失败。** 执行 `BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts native-experience.spec.ts`，预期设置页签断言失败；保留偏好保存失败回退、旧读取不能覆盖新保存等原有用例。
- [ ] **3. 重排为四页签。** 将当前普通偏好拆入通用、系统控件拆入通知与启动；关于承载当前 Hive 和两个版本，关窗找回说明留在通知与启动。`saved/network/proxy/draftOrigin/permission/autostart/test` 和所有 refs、effects、handlers 继续在当前父组件，依赖数组不加入页签值。跨页签的全局失败和保存回执在页签内容之外保留可见，局部系统失败在对应页签呈现。
- [ ] **4. 整理网络双栏及动作层级。** 左侧显示适用范围、编辑／保存／测试、测试结果和待应用提醒；右侧显示已保存／当前生效和四类流量路径。保存使用 `primary`，测试描边，刷新弱化；保留未配对 origin 输入与草稿。空／未知路径显示原状态，表单不新增代理解析器或网络调用。
- [ ] **5. 标明危险重启动作。** 现有 ConfirmDialog 的新可选值只控制确认按钮 class，S2 局部 CSS 提供危险实心样式，并兼顾 portal 不在页面 DOM 子树内的情况；调用处传 `destructive`，入口为危险描边。保留现有描述、busy、焦点和 `applySaved`，取消零应用命令，确认只调用一次 `applySaved(true)`。
- [ ] **6. 使用真实版本和译文。** App 版本来自现有构建清单，Bee 版本仍使用既有 `version` prop；不新增 IPC 或假版本。新增和移动文案全部通过 `t()`，`en.ts` 补全；错误证据保留原文。构建版本的导入为：

```ts
import {version as appVersion} from '../../../package.json';
```

- [ ] **7. 补全并验证保存／应用测试。** 有效代理保存后，断言旧生效配置仍显示；打开重启弹窗再取消，`network_apply_saved` 仍为零；再次明确确认才增加一次且参数 `confirmed:true`。权限拒绝与登记未知分别显示，内部切页绝不申请权限。运行：

```bash
node --test tests/network.test.ts tests/preferences.test.ts tests/notifications.test.ts tests/diagnostics.test.ts
npm run typecheck
BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts native-experience.spec.ts
```

- [ ] **8. 审阅并提交本任务。** 在工作根目录执行 `git diff --check`，只暂存本任务文件，提交 `refactor(desktop): 整理分类设置与代理对照布局`，保留检查点。

### 任务 3：功能回归、视觉对照与真实原生联调

**文件：** 修改 `native-experience.spec.ts`，必要时扩展既有 `native-accounts.mjs` fixture；新建验收记录。除发现局部 UI 缺陷外，不扩大正式代码改动范围。

**接口：** 使用真实 NativeApp + 已有 IPC fixture，不引入 demo 模式；fixture 命令保持 `diagnostics_*`、`diagnostic_logs`、`network_*`、`preferences_*` 与现有通知／自启契约。

- [ ] **1. 补齐必要边界。** 复用 fixture 包装原 invoke，分别提供设备问题、多平台多原因、取消／skipped、未知路径、空日志和失败系统状态。断言问题／未完成／通过完整覆盖，切页不新增诊断和日志读取、运行中切页不增加轮询者，晚到日志和网络结果不覆盖新范围；继续保留原生下载成功／失败／未知测试。
- [ ] **2. 验证键盘及窄窗口。** 在既有 native-experience 测试内增加 ArrowLeft／ArrowRight、Home／End 与选中态断言；弹窗 Escape 关闭并将焦点返回入口。对 1440×1000、860×600 两尺寸检查关键操作可见、网络窄屏纵排及无横向溢出。不要为每个 CSS 值写断言。横向边界断言示例：

```ts
expect(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
)).toBe(true);
```

- [ ] **3. 运行相关回归和构建。** 在 desktop 目录运行，预期全部通过；不修改未涉及的后端，不重跑无关全仓测试：

```bash
node --test tests/diagnostic-presentation.test.ts tests/diagnostics.test.ts tests/network.test.ts tests/preferences.test.ts tests/notifications.test.ts
npm run typecheck
npm run build
BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts
```

- [ ] **4. 实际浏览并对照截图。** 使用 `ego-browser` 检查正式页面与已选原型同尺寸画面：内容位置对照诊断 C、日志、设置 B 四页签和代理确认弹窗；公共壳、暖银白颜色、字号及按钮对照最新 shadcn/ui 与 S1 规格。覆盖 light/dark、中文／英文与窄窗口。截图放工作树 `.cache/s2-ui-verification/`，在验收记录列出真实路径、步骤与差异。对照侧栏、字号、边框、间距、按钮层级、长证据及焦点，修复局部差异后只重跑受影响验证。
- [ ] **5. 完成 S1 增量集成并验证。** 任务 1 前若公共 UI 提交已就绪，提前按本计划集成检查点同步；本步骤核对最终源提交和补丁去重记录。S2 工作树提交本轮文件后再引入源提交，保留原工作树不写入。逐段处理 NativeApp／hooks，合并双方文案、测试配置和文档；保留 S1 自动读取、S2 统一观察和全部真实接线。集成后运行任务 3 的完整前端验证，加跑源提交带入的 `node --test tests/accountPresentation.test.ts tests/supply.test.ts` 和 `BEE_DEVICE_TEST_PORT=1433 npx playwright test --config playwright.device.config.ts account-auto-read.spec.ts`，并重新截图；Git 没有文本冲突不等于行为兼容。若源提交仍未形成或共享入口尚未适配，记录缺失项，页面任务可验证但整个窗口验收保持未完成，不得勾选本步骤。通过后形成单独集成提交，记录源提交与结果，供后续合入共同主线使用，不自动覆盖或合并回 S1。
- [ ] **6. 真实原生联调。** 从当前 S2 工作树启动原生 App，确认所连 bridge/instance 和版本属于本次构建；主动执行诊断、取消／重新运行、手动日志、实际导出并核对保存回执、代理只读测试、语言和主题保存。测试代理使用已知可用的本机配置，保留或恢复已有值，不为视觉验收启动贡献或执行代理重启。通知、自启复用仍有效的原生证据，仅查询已有状态，不反复申请权限或更改系统登记；若发现本轮新增行为风险，补针对性证据并如实记录。
- [ ] **7. 完成验收记录。** 写清命令与实际结果、两份原型的对照截图、真实原生回执、公共壳同步提交及未完成项。修复过的问题保留失败证据，不能把 fixture 通过写成真实 OS／网络已通过；公共壳未同步则本任务继续未完成。
- [ ] **8. 验证收尾并提交。** 运行 `git diff --check`，按 `verification-before-completion` 核实证据；全部任务完成后执行 `consistency-check`，核对本计划与规格／决策／实际代码，勾选实际完成步骤。只暂存本任务与验收记录，提交 `test(desktop): 验证诊断与分类设置界面`。随后按 `finishing-a-development-branch` 交付，不自动合并、推送或清理原工作树。

## 送审自检（文档阶段）

- 规格第 1–3、6–7 节：全局约束、文件职责与任务 3；第 4 节：任务 1；第 5 节：任务 2。两页已选方案均有实现与验收步骤。
- 计划只描述尚未执行的正式 UI 工作；所有任务复选框保持未完成，不用原型测试代替正式 App 验收。
- 版本、客户端方法、命令和现有测试路径已按当前 S2 源码核对；新文件及新接口已标明。
- 公共壳依赖明确列为最终验收条件，没有将未同步样式伪装成已完成，也没有授权修改其他会话的未提交工作。
- 两份 S2 布局预览与最新 shadcn 的颜色／壳尺寸差异已在规格中说明；正式视觉按最新优先级执行。历史原生验收未完成项不因本轮文档送审而被抹去。
- S1 共享入口／hooks 的实际接口分叉、等价补丁去重和文案／测试配置重叠已写入集成检查点；集成只适配既有能力，不重复实现 S1 逻辑。
