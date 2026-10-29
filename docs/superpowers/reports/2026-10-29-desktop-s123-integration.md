# Bee S1／S2／S3 分支整合记录

日期：2026-10-29。用户授权先将 S3 合入 S2，再将 S2 合入 S1；保留三个分支和工作树。

## 来源与合并方式

| 来源 | 合并前分支 | 完整提交 |
| --- | --- | --- |
| S1 | `feat/bee-desktop-p0` | `9e349ba87d0df5d135d008aa54b74c1570dfc348` |
| S2 | `feat/bee-desktop-s2` | `2fdf13728e0fdf33173bbfac388ec1b87051df96` |
| S3 | `feat/bee-desktop-s3` | `f7547575f2e29e715b778912c4036720b4cff93e` |

S3 已通过 `b7b49da` 包含上述 S2，因此第一步在 S2 使用 `--ff-only`，没有重复导入补丁。随后在 S2 以真实 merge 整合 S1 的后台控件稳定性修复 `0451da6` 和一键构建 `9e349ba`，验证后由 S1 快进接收该整合结果。S3 分支与工作树保留原状态。

操作目录为 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-s2`。合并前 S1／S2 均没有已跟踪文件的未提交改动，各有两个未跟踪计时文件；已记录 SHA-256，保持原样，不暂存、不 stash、不提交。初始分支、状态和文件摘要见本工作树 `.cache/s123-merge-20261029/before.json`。

## 冲突解决与职责

七个内容冲突位于 `NativeApp.tsx`、`useAccounts.ts`、`useRuntime.ts`、`useSupply.ts`、两份 Playwright 配置及 `account-auto-read.spec.ts`，逐段兼容双方行为。

- 保留 S2 唯一 `createDesktopState` 协调器。普通业务快照每 10 秒读取，待处理账号／运行操作为 400 毫秒，设备等待遵循返回间隔。协调模式的 hooks 不另开业务快照轮询；S1 独立实现的 2 秒运行周期不作为第二套调度。
- 读取锁与用户操作锁分离。有效数据在后台读取期间保持按钮可用；点击时立即去重，等待读取后核对最新 revision、候选、来源、实例及相关上下文，再提交一次。
- 供给读取可能晚于账号读取完成，等待供给时发起的明确修改会在提交前再经中央协调器核对身份；相关账号或运行上下文变化则取消。失败仍只读恢复，不重发未知写入。过期按钮点击会在拒绝提交时更新页面提示。
- 保留 `runtime.stalled`、旧实例／旧来源回执隔离、逐平台失败、来源自动读取和官方观察。
- 已确认的运行、账号及官方登录／取消回执，将 revision 下限交给唯一协调器；随后读回低于该下限时保留具体 actual／required 证据，运行回退停止自动核对，账号回退按平台限制操作。原始读取错误继续保留；新原生实例重置旧实例的下限，不增加独立轮询。
- 供给点击同步观察中央当前状态，覆盖 React effect 尚未接纳新读取的时间窗口。排队前置读取失败会取消操作并保留错误，不产生未处理 rejection；成功 PUT 后读回失败也不能因接纳同一份旧供给快照而重新放行，须经新的成功读取恢复。
- 保留诊断 C「问题优先」、设置 B「分类页签」、持久偏好和真实下载回执。诊断和安全日志仍主动触发，代理保存与明确应用仍分离。
- S3 的“关于内联”更新、固定命令、验签及唯一退出／恢复实现沿用已提交代码。本次冲突解决没有修改 Go／Rust 实现；S1 的 `make app` 与构建文档原样纳入。
- 测试配置同时保留更新和后台稳定性用例。测试专用场景继续使用正式组件与模拟 IPC，修正过时的管理实例标识和偏好初始化，不进入正式 App 数据路径。

## 本次验证

以下命令均在整合工作副本执行，退出码为 0。日志位于本工作树 `.cache/s123-merge-20261029/`；历史各版本的原生证据继续独立保留。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `BEE_DEVICE_TEST_PORT=1433 npm --prefix desktop run test:device` | Node 43／43，Chromium 126／126 | `device-merged-final.log` |
| `node --test desktop/tests/*.test.ts desktop/tests/*.test.mjs` | 314 通过，1 项 Windows PowerShell 平台用例跳过；与上行 Node 有交集 | `node-merged-final.log` |
| `npm --prefix desktop run build` | typecheck 与正式前端构建通过 | `build-merged-final.log` |
| `go test ./...` | 7 个包通过 | `go-test-final.log` |
| `go vet ./...` | 通过 | `go-vet.log` |
| `node desktop/scripts/build-bee.mjs` | 按当前来源构建测试用内置 Bee | `build-bee.log` |
| `RUSTUP_TOOLCHAIN=1.94 cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml -- --test-threads=1` | 主库 177 通过、2 项签名包专用用例 ignored；network contract 27 通过 | `rust-online.log` |
| `git diff --check` | 通过 | 提交前核验 |

追加回归覆盖后台读取期间一次／重复点击、最新 revision、候选变化／读取失败取消、同 revision 失败恢复、替换账号时取消等待中的恢复接单、过期按钮拒绝写入、官方登录取消及旧实例回执。最终审查补齐供给 effect 延迟、排队设备读取失败、PUT 后设备读回失败、运行开始／停止与账号／登录／取消回执版本回退，以及错误链保留和新实例下限重置。

失败和复验保留原记录：控件稳定性和账号等待行为先复现失败，见 `runtime-red-formal.log`／`hooks-red.log`；过期按钮反馈在 `device-1.log` 复现，修复后完整设备回归通过。Go 首轮有一个 owned 登录子进程启动超时，未改期限或源码，隔离用例通过后全量复验通过。Cargo 初次命中不完整的 `1.94.0` 安装，改用已安装的 `1.94`；离线缓存缺少 updater 依赖后按锁文件联网补齐，没有修改版本或跳过验证。前端保留既有主 chunk 超过 500 kB 提示，Rust network contract 保留既有未使用代码警告。

审查新增缺陷分别先在 `review-supply-red.log`、`review-account-preflight-red.log`、`review-receipts-red-formal.log`、`review-authorize-red-formal.log`、`review-error-chain-red.log` 复现，再经上述最终完整回归通过。首次停止回归未点击确认、首次登录回归未关闭弹窗，均属于测试入口修正，不作为功能失败证据。成功供给 PUT 后设备读回失败的旧快照问题来自 S2 存量底座，本次为保证合并后的写入／读回约束一并修复，不误标为合并新增。

只读审查者复查四类修复及直接受影响路径，最终结论为可以合并，没有剩余 Critical、Important 或 Minor 问题；同时核对最终验证日志。

## 一致性核对

- ✅ 会话：按 S3 → S2 → S1 整合，保留三个分支／工作树及原计时文件；沿用已批准布局、按钮层级和功能约束，没有恢复已否定方案。
- ✅ 文档内部：来源提交、冲突范围、最终测试数量与历史失败对应；源码整合、既有原生包和正式发布边界分别标明，术语与结论一致。
- ✅ 跨文件：单一协调器、读写锁分离、等待后复验符合规格与轮询补充计划；两个回执回调已核对所有定义／调用方，写回顺序与当前实例校验一致；提交内容与本记录对应，没有修改外部 DTO 或 Go／Rust 实现。
- ✅ 配置：普通 10 秒／未决 400 毫秒的中央调度保留；两份测试配置分别包含／排除新增 IPC fixture，S3 更新用例也保留。没有新增产品依赖、环境项或配置模板；`make app` 与 S1 构建文档一致。
- ✅ 文档与实现：最终自动测试与构建有本轮退出 0 的日志，原文件摘要已核对；旧原生包及跨平台验收缺口继续明确保留，不把合并当作重建或发布。

结论：本次整合无未解决的一致性问题；既有原生／发布验收缺口不由此次源码合并关闭。

## 构建与验收边界

本轮交付是源码整合，没有重建、安装或切换原生 App，没有登录、接入、开始真实贡献或调用安装器，也没有推送或发布。测试用 Bee 来源为 S3 `f754757` 加整合工作副本状态，不宣称它是干净 merge 提交的新发布包。

S2 先前的 `Bee S2 Dev.app` 与 S3 `b7b49da` 候选 DMG 继续绑定各自历史来源，不能当作本次整合版本。后续在整合提交执行 `make app` 才会得到包含本次兼容修复的新开发包。

通知横幅／点击、拒绝路径、真实安装位置、跨平台、生产签名／公证和两版本原生升级等缺口仍以 [S2 功能验收](../../desktop/experience-validation.md) 和 [S3 发布验收](../../desktop/release-validation.md) 为准；源码合并与自动测试通过不等同于正式发布就绪。
