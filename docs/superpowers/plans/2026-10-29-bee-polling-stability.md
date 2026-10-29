# Bee 后台轮询与操作状态分离修复计划

> 按用户本次明确要求，在现有隔离工作树内直接修复；使用 `executing-plans`、`test-driven-development` 和 `verification-before-completion` 逐项执行。此计划落实已有 UI 规格中“正常读取保持安静”和本次明确的按钮稳定要求，不新增交互、依赖或后端协议。

**目标：** 有效状态的后台刷新不切换按钮 disabled 或替换当前界面；用户操作、过期及失败恢复仍提供反馈并保持写入保护。

**架构：** 保留读取互斥和去重，将操作锁与读取锁分离。用户点击与读取重叠时，仅保留这一笔明确操作，等待读取结束后重新核对状态；同一操作不会重复提交，读取失败、来源变化、过期或管理进程更换时不继续写入。不重试账号／贡献／暂停写请求。

**技术栈：** 沿用 React 19.2.8、TypeScript 7.0.2、Node 24、Playwright 1.63.0；保留 Tauri API／CLI 2.12.4 与 Rust 壳 2.12.5，不增加依赖。

## 约束与验证矩阵

- 保留运行 2 秒／过渡 300 毫秒、供给 10 秒、账号操作 400 毫秒／恢复 10 秒的既有周期；不通过减少轮询、延迟渲染或 CSS 掩盖闪动。
- 供给有效期仍为 30 秒，候选到期、身份、generation、revision、管理进程实例与 source epoch 校验继续生效。
- 正常读取保留当前有效视图与按钮；错误在成功读取前保留，不在重试开始时短暂清空。
- 操作锁在点击时同步占用，涵盖等待读取、提交和读回；重复点击不排队第二笔操作。
- 不操作真实账号登录、接入、恢复或开始贡献；预览与自动回归使用模拟 IPC。原生重建／正常重启仅用于交付当前 UI。

## Task 1：复现与保护测试

文件：`desktop/tests/polling-stability.spec.ts`、`desktop/tests/supply.test.ts`、`desktop/tests/account-auto-read.spec.ts`、`desktop/playwright.device.config.ts`。

- [x] 添加受控延迟读取：运行按钮、供给暂停／恢复按钮、官方登录取消按钮在有效后台读取中保持可用；无重复加载提示。
- [x] 添加点击重叠验证：读取中点击，立即进入操作锁，读取结束后仅写一次；读取失败、过期、账号候选变化或组件卸载时不写入。
- [x] 执行 `BEE_E2E_PORT=1473 npx playwright test --config playwright.device.config.ts polling-stability.spec.ts`、`node --test desktop/tests/supply.test.ts`，记录修复前预期失败。

## Task 2：读取与操作状态分离

文件：`desktop/src/features/lifecycle/useRuntime.ts`、`desktop/src/features/accounts/useAccounts.ts`、`desktop/src/features/accounts/NativeAccountActions.tsx`、`desktop/src/features/accounts/NativeAccountDetails.tsx`、`desktop/src/features/accounts/NativeAccountList.tsx`、`desktop/src/features/supply/useSupply.ts`、`desktop/src/app/NativeApp.tsx`。

- [x] 运行状态保留后台读取状态，主按钮只消费操作状态；串行等待当前读取，重新校验后提交，失败继续只读恢复。
- [x] 供给按钮仅因操作锁或无效状态禁用；等待读取后核对新鲜度、失败和平台条件；等待结束及每平台 PUT 前检查账号／运行上下文版本，曾变化即取消。
- [x] 账号按钮绑定到 writeBusy；失败证据保留至成功；等待读取后核对账号和候选。同一登录 pending→running 仍可取消，终态或 operation ID 改变后不取消。
- [x] 配对轮询不切换正常等待页按钮，显式操作仍串行、去重；状态变化后不使用旧配对信息。
- [x] 重跑新增回归和既有设备、供给、账号、运行回归；覆盖晚到响应与实例隔离。

## Task 3：交付验证与记录

文件：现有 UI spec／决策记录、本计划和 UI 验证记录。

- [x] `node --test desktop/tests/supply.test.ts desktop/tests/nativeAccounts.test.ts desktop/tests/accountPresentation.test.ts desktop/tests/runtime.test.ts desktop/tests/authorize.test.ts`、完整设备 fixture、45 项预览回归、`npm --prefix desktop run build`、`git diff --check` 通过。
- [x] 检查正常后台读取、用户操作与失败重试的模拟页面；必要时使用 `ego-browser` 查看，保留原生完整验收缺口。
- [x] 重建原生包，正常退出旧进程后打开明确的新包路径，核对活动进程和原生窗口，不用构建通过替代运行核对。
- [x] 运行 `consistency-check`，更新规格、决策和验证记录，逐项填写本计划；保持真实业务未完成项，不将本次稳定性修复写成 S1 全部验收通过。

## 执行证据（2026-10-29）

- RED：运行、供给及登录取消按钮在受控延迟读取中禁用；供给 model 的正常读取时可写断言失败。初始记录在 `.cache/polling-stability/`。
- 连续读取恢复：相同错误和被拒绝旧快照未产生状态变化时，后续轮询可能停滞；读取完成计数驱动下一次调度。重复失败回归先失败，修复后进入完整通过：[日志](../../../.cache/polling-stability/retry-red.log)。
- 审查补充：等待供给操作未绑定账号身份，同一登录 pending→running 的取消被误拦。分别复现后修复；[账号等待 RED](../../../.cache/polling-stability/admission-red.log)、[恢复误写 RED](../../../.cache/polling-stability/resume-red.log)、[上下文 RED](../../../.cache/polling-stability/context-red.log)。正常时间戳及普通 revision 更新不会使供给上下文失效。
- 只读审查复查两项修复，未发现未解决问题，独立供给测试 25/25。未执行真实登录、接入或贡献动作。
- 完整设备回归：Node 35/35、Chromium 69/69；聚焦 Node 42/42（有交集）。日志为 `.cache/polling-stability/device-final.log` 与 `unit-final.log`。
- 浏览器实测：浅色 1118×738、深色 860×600，读取延迟 1.2 秒，按钮禁用／额外核对提示记录为空，没有横向溢出；失败恢复经过等待、重试、恢复，零写操作。证据为 `.cache/polling-stability/browser-checks.json` 和对应截图。
- 登录期间候选来源清空时，400 毫秒读取曾反复显示来源读取提示；`.cache/polling-stability/login-hint-red.log` 复现后修复，两处提示增加登录操作状态保护，审查复查通过，最终设备回归仍为 69/69。
- 最终七组预览 45/45、正式前端及 Tauri debug app 构建通过。正常退出旧进程后于 12:43:30 打开最新包，主／子 PID 34446／34577，原生 window ID 3628。初始加载收敛后每 1.1 秒采样，共 12 帧主按钮像素一致；初始加载记录独立保留，不混同后台稳定性证据。
- 规格、决策记录、实现和验证记录按五维一致性逐项核对；没有新增产品配置、依赖或协议。用户在修复验证后授权提交，本计划随源码一并提交，未推送或发布；原银白 UI 40/41 和真实业务验收缺口保持独立。
- `post-verification-check` 重读全计划：总计 12 项，原已勾选 8 项，本次按最终证据勾选 4 项，剩余 0 项。
