# Bee S2 诊断与设置 UI 阶段验收

日期：2026-10-28。依据：[UI 规格](../specs/2026-10-28-desktop-s2-ui-design.md)、[实施计划](../plans/2026-10-28-desktop-s2-ui.md)。

## 结论与范围

诊断 C「问题优先」及设置 B「分类页签」已在独立 S2 工作树落地。两个页面继续使用原有真实客户端、命令处理和异步防护，未增加业务轮询、IPC 或模拟成功。任务 1、2 已完成；任务 3 的浏览器功能、局部视觉与构建检查通过，**整个计划尚未完成**。

公共壳的暖银白主题仍依赖 S1 尚未提交的实现；本轮未复制这些脏文件，因此截图仍带 S2 已有公共壳。S2 原生窗口与本次页面的真实后端联调也尚未完成。以下浏览器截图中的状态来自已有 IPC 测试替身，不能作为真实 Hive、账号、网络或 OS 的验收证据。

工作根目录：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-s2`；分支：`feat/bee-desktop-s2`；实施基线：`035589a`。本轮已有提交：`a6d7014`（规格与计划）、`0e7eafe`（诊断页）、`0134919`（设置页）。本记录随阶段验证提交保存。原工作树、两个已有计时文件、S1 未提交文件均未改写；未合并、推送或发布。

## 已实现行为

- 诊断默认「检查结果」，另有「安全日志」。设备与各平台的问题优先展示；每项保留状态、原因、时间、安全证据和处理入口，同平台多个原因不丢失。未完成与通过项独立折叠。
- 只有已完成、非空且全部返回项为 pass 才显示全部通过。空报告、取消、skipped 和未确认项均不冒充正常。
- 运行、取消、重新运行、日志刷新／分页、导出范围与真实下载回执沿用原处理。切页签不启动诊断、不读取日志，运行中的页签往返仍只有一个诊断观察循环。
- 设置分为通用、网络与代理、通知与启动、关于，默认网络。草稿与测试结果在页签间保留；切换不重新查询网络、通知权限或自启状态。
- 网络宽窗为编辑／待应用与已保存／当前生效两栏，窄窗纵排。保存为实心主按钮，测试为次要按钮；危险重启保留独立确认，Escape／取消不执行应用。
- 应用版本取自构建清单；Bee 版本取自已验证 bridge 元数据，缺失时显示尚未读取。通知期望与权限、自启期望与系统登记分别呈现，不因切页请求权限。
- 公共样式继续复用现有变量、按钮、弹窗及 Radix；新增的页签样式由两页共享。未更改 NativeApp、账号／贡献 hooks、Go、Rust 或协议逻辑。

## 自动验证

使用 Node `24.22.1`。命令在工作根目录的 `desktop` 下执行；Node 路径为 `/Users/dayong/.nvm/versions/node/v24.22.1/bin`，没有升级依赖。

| 检查 | 实际结果 | 本机完整输出 |
| --- | --- | --- |
| `node --test tests/diagnostic-presentation.test.ts tests/diagnostics.test.ts tests/network.test.ts tests/preferences.test.ts tests/notifications.test.ts` | 24/24 通过 | [node.log](../../../.cache/s2-ui-verification/node.log) |
| `npm run typecheck` | 退出码 0 | [typecheck.log](../../../.cache/s2-ui-verification/typecheck.log) |
| `npm run build` | 退出码 0，Vite 构建完成 | [build.log](../../../.cache/s2-ui-verification/build.log) |
| `BEE_DEVICE_TEST_PORT=1433 npx --no-install playwright test --config playwright.device.config.ts` | 最后一次 69/69 通过，18.2 秒 | [playwright-final.log](../../../.cache/s2-ui-verification/playwright-final.log) |
| `git diff --check` | 无空白错误 | 终端结果 |

浏览器测试覆盖真实 NativeApp + 原有 IPC fixture：设备／账号／供给旧用例、单一协调观察、旧实例隔离、问题完整分区、空／取消／未完成、手动日志与 cursor、空日志与未读取的区分、旧筛选的迟到回包、旧网络观察不覆盖新刷新及输入、代理保存／生效分离、取消零应用与明确确认一次应用、偏好回读与旧结果隔离、通知拒绝、自启登记未知、版本未知、导出成功／失败／未知回执。

四种页面组合为 1440×1000 中文浅色／英文深色、860×600 英文浅色／中文深色；检查无横向溢出、操作可达、ArrowLeft／ArrowRight／Home／End、弹窗 Escape 及焦点返回。两页主按钮在悬停时的文字对比度均要求至少 4.5:1。语言切换后的保存提示也按新语言显示。

## 发现及修复

1. 新分类页签使旧测试无法直接找到语言控件。逐个补上「通用」入口，保留原有业务断言；管理实例替换后重新选择「General」核对已保存语言，未要求页签跨实例持久化。
2. 实际画面发现主按钮悬停继承旧全局弱背景，浅色文字对比度仅约 1.09:1。新增可复现失败断言后，在两页局部保留主按钮背景；明暗主题均通过对比度检查，没有改写公共按钮体系。
3. 配置摘要与关于的 dt 继承全局 25px 上边距，造成标签／值错行；局部清零后重截画面。诊断失败色在深色主题提高可读性。
4. 切换英文后保存提示仍显示中文；先取得失败断言，再将设置页提示保存为文案 key、在渲染时翻译。错误证据原文保持原样。
5. 最后一轮的旧 Hive 用例遇到测试时钟 `Cannot fast-forward to the past`：使用主进程的当前时间暂停页面时钟存在毫秒偏差。改为读取页面时间加 1 秒后暂停，保留所有旧实例回包断言；随后整组 69 项通过。

## 实际浏览与截图

使用 ego-browser TaskSpace 17 查看正式源码页面与所选原型，实际读取截图。正式页面由 S2 Vite `http://127.0.0.1:1435/` 提供，浏览器启动前注入已有测试 fixture；未给正式 App 增加预览入口。截图使用 CDP 固定视口并核对实际宽高；不采用最初跟随系统深色、尺寸不符的截图。

截图根目录为 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-s2/.cache/s2-ui-verification/`。目录及测试日志为本机验证产物，不属于发布包。

| 对象 | 截图 |
| --- | --- |
| 最新 shadcn/ui 明／暗参考 | [浅色](../../../.cache/s2-ui-verification/reference-shadcn-light.png)、[深色](../../../.cache/s2-ui-verification/reference-shadcn-dark.png) |
| 已选布局原型 | [诊断 C](../../../.cache/s2-ui-verification/reference-diagnostics-C-light.png)、[设置 B](../../../.cache/s2-ui-verification/reference-settings-B-light.png) |
| 诊断问题优先 | [中文浅色 1440](../../../.cache/s2-ui-verification/diagnostics-light-1440.png)、[英文深色 1440](../../../.cache/s2-ui-verification/diagnostics-dark-en-1440.png)、[英文深色 860](../../../.cache/s2-ui-verification/diagnostics-dark-en-860.png) |
| 安全日志 | [中文浅色](../../../.cache/s2-ui-verification/logs-light-1440.png)、[英文深色窄窗](../../../.cache/s2-ui-verification/logs-dark-en-860.png) |
| 网络与代理 | [中文浅色 1440](../../../.cache/s2-ui-verification/settings-network-light-1440.png)、[英文深色 1440](../../../.cache/s2-ui-verification/settings-network-dark-en-1440.png)、[英文深色 860](../../../.cache/s2-ui-verification/settings-network-dark-en-860.png)、[窄窗滚动查看路径](../../../.cache/s2-ui-verification/settings-paths-dark-en-860.png) |
| 其余设置页签 | [通用](../../../.cache/s2-ui-verification/settings-general-light-1440.png)、[通知与启动](../../../.cache/s2-ui-verification/settings-system-light-1440.png)、[关于](../../../.cache/s2-ui-verification/settings-about-light-1440.png) |
| 代理危险确认 | [确认弹窗](../../../.cache/s2-ui-verification/settings-confirm-light-1440.png) |

局部对照结论：页签、问题优先分组、折叠位置、网络双栏、保存／测试／危险按钮的主次关系与已选布局一致；正式页直接呈现每个真实检查项，没有照搬原型中合并推断的平台结论。证据在原位展开，长字段换行，窄窗通过纵向滚动到达下方路径与操作。

公共壳差异仍存在：S2 当前全局浅色侧栏 `#f2f3f5`、深色 paper `#222426`、顶栏 57px、标题 23px；目标分别采用 S1 暖银白变量、52px 顶栏和 24px 标题。S2 不在局部页面另复制这些 tokens、侧栏和基础组件。**局部布局验收通过，不表示最终暖银白整窗验收通过。**

## S1 集成与真实原生限制

最终只读核对 S1 HEAD 仍为 `9e2bc77`。`AppShell.tsx`、tokens、app.css、NativeApp、账号／贡献 hooks 等仍有未提交修改，`components/ui.tsx`、新概览、账号展示及自动读取测试尚未跟随源提交形成可审阅快照。因此本轮没有集成新公共壳，也没有改动 S1 工作树。

集成继续按计划执行：等 S1 提交后先核对增量与 patch 等价记录，再在 S2 工作树逐段适配 NativeApp／hooks，保留 S1 自动读取与 S2 单一协调器，不以整文件覆盖。`useAccounts` 第五参数 autoRead／coordinated 的分叉、文案与 Playwright 配置重叠仍需处理；这属于接线合并，不是重新实现 S1 业务。

本机实际运行的 PID 33046 指向 `bee-desktop-p0/desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app/Contents/MacOS/bee-desktop`，PID 33053 是其 sidecar。S2 使用相同应用标识／单实例规则；为保护该运行实例，本轮未终止、替换或把它当成本次 S2 构建。未启动 S2 主窗口，未声称本轮已取得真实诊断、代理测试或下载回执。

此前[原生验收记录](../../desktop/experience-validation.md)继续有效，且其通知可见性／点击等未验项目保持未完成。本轮未重复申请系统权限、切换自启登记、开始贡献或应用代理重启；ego 浏览器 fixture 的相关命令审计为零。

后续仍须完成：S1 可审阅提交同步及增量适配；集成后全部前端与自动读取测试；暖银白整窗重新截图；从本次 S2 原生窗口执行手动诊断、取消／重跑、日志、实际导出、只读网络测试及偏好保存。上述条件未满足前，不执行全计划完成声明或合并收尾。
