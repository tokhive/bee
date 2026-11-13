# 概览后台核对布局稳定实施计划

> 执行方式：使用 `subagent-driven-development` 完成一个聚焦任务，由主代理独立复核、验收。用户已在本会话批准方案并要求实施，无需再次确认。

**目标：** 业务状态不变时，连续多轮核对不改变卡片高度、按钮位置、滚动位置和键盘焦点。

**方案：** 沿用唯一协调器及现有刷新状态；展示层区分首次无数据、后台刷新、用户主动核对与实际写操作。后台读取保留上次仍有效的事实，手动核对在原按钮图标内反馈，首次加载使用接近正式结构的静态骨架。真实失败与过期继续显示具体原因、历史数据与时间，错误保留至对应读取成功。

**技术栈：** 沿用 React 19.2.8、TypeScript 7.0.2、现有 CSS/Radix/lucide 图标及 Playwright 1.63.0；验证使用项目缓存 Node 24.22.1，原生包沿用 Rust 1.94 与 Tauri 2。无新增依赖。

## 全局约束

- 只处理概览核对反馈及其共用展示组件，保持既有分区、配色、字号和操作位置。
- 不改变协调器 10 秒普通轮询、2 秒配对轮询、400 毫秒进行中操作轮询及其现有适用条件。
- 保持实例、binding revision、网络 revision、操作回执屏障、过期和失败时的写入保护；后台有效刷新本身不撤销仍有效事实。
- 用户主动核对与写操作继续防重复；错误重试不静默清空失败，也不自动重放写操作。
- 中文、英文、浅色、深色及 860×600 都应可用；加载反馈不增加轮询播报噪声，动画尊重 reduced motion。
- 保留当前 worktree 所有已有修改，包括前一任务的重新绑定参数修复。不开新 worktree，不提交、不推送。
- 不以真实绑定、替换、接入账号、贡献或接单作为测试副作用；原生验收仅允许只读观察与核对。

## Task 1：稳定概览核对展示并验证

**文件与职责：**
- `desktop/src/app/NativeApp.tsx`：区分用户核对、实际操作与首次加载；传递明确展示状态。
- `desktop/src/features/device/DevicePairingPage.tsx`：后台刷新保持设备摘要稳定，手动核对原位反馈，首次读取骨架。
- `desktop/src/features/accounts/AccountDisplay.tsx`、`NativeAccountList.tsx`、`NativeAccountActions.tsx`：仅按测试证据调整首次占位和失败重试提示布局，保留现有有效数据与错误语义。
- `desktop/src/styles/app.css`、必要的 `desktop/src/i18n/en.ts`：尺寸稳定的反馈和骨架，复用现有 token。
- `desktop/tests/overview-refresh-stability.spec.ts`（新增）、`desktop/playwright.device.config.ts`：隔离 fixture 的布局回归，涵盖不同读取阶段。
- `desktop/tests/polling-stability.spec.ts`、`desktop/tests/device.spec.ts`、`desktop/tests/device-recovery.spec.ts`、`desktop/tests/native-experience.spec.ts`：既有动作、恢复、可访问性回归。

**接口边界：** `DesktopSnapshot.busy` 仍表示共享读取进行中；不把它直接当作用户操作锁。页面展示状态在应用层推导，既有状态/事务类型及 IPC 契约保持不变。

- [x] 读取相关组件及测试，运行既有 polling-stability 基线。
- [x] 先添加失败测试：已绑定、无有效设备 view 但有已保存上下文/恢复事务的普通后台轮询；分别阻塞 device、recovery、account/supply 读取并测量几何、滚动和焦点，多轮不变；手动核对保持按钮尺寸且有进度；首次无数据骨架仅在初次出现；失败重试保留错误和历史数据，成功后恢复；过期期间仍禁止依赖有效状态的写入。
- [x] 运行新增用例，确认因现有布局/反馈问题失败，记录红灯证据。
- [x] 按已确认方案实施最小修复；手动检查在后台读取时仍可正确衔接，状态保护不得通过隐藏错误或禁用所有入口替代。
- [x] 运行 typecheck、相关 Node 测试和上述 Playwright 回归；按测试证据修复，独立复核需求与质量。
- [x] 主代理检查中英文/明暗/小窗口画面、布局稳定和焦点；构建并校验 macOS 开发包。真实 App 只做只读核对，保留在途业务。
- [x] 更新本计划的证据与核对结果，完成 verification-before-completion、consistency-check、post-verification-check。

## 验证命令

在 worktree 的 `desktop` 目录，将 `../.cache/toolchains/node-v24.22.1-darwin-arm64/bin` 放在 PATH 首位。

```sh
npm run typecheck
node --test tests/device.test.ts tests/desktopState.test.ts tests/supply.test.ts tests/nativeAccounts.test.ts
BEE_DEVICE_TEST_PORT=1436 npm run test:e2e -- --config playwright.device.config.ts tests/overview-refresh-stability.spec.ts tests/polling-stability.spec.ts tests/device.spec.ts tests/device-recovery.spec.ts tests/native-experience.spec.ts --reporter=line
RUSTUP_TOOLCHAIN=1.94 APPLE_SIGNING_IDENTITY=- npm run tauri -- build --debug --bundles app --ci --config '{"productName":"Bee S1 Dev"}' -- --locked
```

## 执行证据

证据目录：`.superpowers/sdd/overview-refresh-2026-11-03/`。

- `task-1-report.md` 与 `own-production.patch`：本任务实施和精确差异，保留并行进入的恢复弹窗修改作为上下文。
- `task-review.md`：独立任务评审 Spec compliant、Quality Approved，生产代码无发现；仅记录既有验证环境和构建提示。
- `final-review.md`：最终整合复核 Approved，无阻断发现。
- `baseline.log`：既有 polling-stability 24/24。
- `red-confirmed.log`：8项失败准确复现30px位移、手动进度缺失及首次骨架缺失；原有账号行为通过，故未改账号展示组件。
- `typecheck-final.log` 与 `node-final.log`：类型检查通过，85/85 Node测试通过。
- `playwright-isolated-final.log`：135项中130项通过，5项来自并行进入的恢复弹窗焦点测试；其修复进入后，`affected-final.log` 的设备31项及新增概览17项全部通过（48/48），其余已通过且未受影响的87项未重复运行。共享artifact目录冲突已通过本任务独立输出目录解决。
- `root-qa.md`：主代理中英文、明暗、1280×720及860×600人工检查；恢复等待场景多轮核对后几何、滚动高度和焦点保持相同。
- `native-build-final.log`：最终macOS开发包构建 exit 0，随后 `codesign --verify --deep --strict --verbose=2` 通过。保留原有大chunk、dead-code和未配置公证提示。
- 原生窗口存在外部操作，已保留用户当前会话；没有验证新版重启后的原生画面，新开发包下次启动生效。全部模拟界面测试不触发真实绑定或账号写入。

## 收尾核对

- ✅ 会话一致性：实现与已批准方案一致，未恢复被排除的全局忙碌提示；沿用指定worktree并保留所有已有修改，没有提交或推送。
- ✅ 纵向一致性：本计划、实施报告和验收记录对首次加载、后台刷新、手动核对及真实失败的描述一致。
- ✅ 横向一致性：实现与计划匹配，新增 checking/initialLoading 经 NativeOverviewPage 透传到设备区，调用方类型检查通过；没有新增IPC契约，无PR或提交描述需要同步。
- ✅ 配置一致性：仅注册新增Playwright测试，无新增依赖、生产配置或环境变量；验证端口和独立输出目录已记录。
- ✅ 文档一致性：最终测试、人工验收、构建和签名记录与实际结果一致；保留新版原生画面未重启验证边界，无需修改API或README。
- Post-verification：共7个任务勾选项，核对前6项已完成，本次补勾1项，剩余0项。两轮独立评审均通过，既有环境/构建提示记录为非阻断事项。
- 自建1437预览服务已停止，临时预览标签页已关闭，窗口尺寸覆盖已恢复；当前用户App会话保持原状。
