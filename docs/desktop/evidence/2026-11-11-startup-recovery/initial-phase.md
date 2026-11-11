# Bee 启动恢复实施与验收记录

日期：2026-11-11（Asia/Shanghai）。用户已授权实施。仅在 `bee-desktop-ui` worktree 修改；保留共享工作区的其他会话改动，未提交 Git、未运行真实账号恢复。

## 交付结果与结论

已落实紧凑启动状态、真实阶段、停止后证据保留、Go 只读恢复资格、持久尝试记录、受控重连／重试、原操作核对和本地诊断导出。已构建 macOS ad-hoc 开发包：

`desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`

受控恢复与界面测试通过；**真实旧脏会话尚不能自动接管**。当前 Hive 没有提供旧 worker／远端准备保护退役证明，无法证明旧任务已安全结束。新版在本次贡献前明确阻塞，保留管理、核对和诊断；没有删除保护记录、改真实账号／设备配置或假设远端任务已经撤销。

打包后的隔离原生窗口启动／停止展示尚未验收，Windows／Linux 未实测。规格的完整发布门槛仍未满足；本记录交付实现和开发测试包，不宣称用户当前故障已经自动恢复。

## 行为与实现

| 用户行为／边界 | 最终行为及关键实现 |
| --- | --- |
| 打开 App | 唯一原生启动协调器连接后台，先 `runtime_inspect_recovery`；在本次预留、worker 和外部写入之前检查旧会话、未决操作与持久状态 |
| 干净状态且原意图运行 | 仍走现有严格 Restore 和新鲜 Hive 暂停核验；显式解暂停列表为空；符合条件的平台才准备并连接 |
| 原意图停止／较新 user_stop | 不自动开始贡献；仅恢复管理能力，明确未启动服务 |
| 脏保护、未决账号操作、损坏数据 | 保留原件与具体原因，贡献前拒绝，后台仍可查询；不套用已启动失败的清理路径 |
| 已提交恢复后失败 | 原有严格停止／回收与退出、升级 freeze 保留；清理未确认时仍回收 owned Child |
| 提交、崩溃与未知回执 | 先原子写 `desktop-startup-recovery.json`；持久 attempt、实例、绑定／网络／账号范围、原意图、原会话与 operation。未知只核对原 ID，跨实例证据不足继续阻塞 |
| 确定失败后人工重试 | 重新核验资格；新 attempt 关联前次，归档旧终态。成功后再次 retry 返回同一 ready 实例，不再 Restore |
| 启动中／停止／读取失败 | 紧凑标题和真实子状态；不靠定时器模拟进度；停止保留原失败。首次读取失败显示“状态待核对”，账号维护和账号控件保持受限 |
| 手动核对／晚到 ready | 读取失败独立显示；有效新状态清除读取错误，核验成功后立即继续账号读取，不等待下一次定时轮询 |
| 等待较长 | 同阶段 10 秒补充慢提示；纯状态读取按 1／2／4 秒最多重试三次，一轮 60 秒停止自动核对。原生恢复 90 秒规则保留，前端截止不取消后台操作 |
| 查看诊断 | 原始失败单层折叠，原查询失败不覆盖最初原因；后台不可用时可本地导出 App 保存的启动证据，无自动上传 |

相关源码：Go `agent/desktop_recovery_inspection.go`、`desktop_runtime*.go` 与 `desktopbridge/server.go`；Rust `startup_recovery.rs`、`experience.rs`、`update_install.rs`、`runtime.rs`、`sidecar.rs`；前端 `desktopState.ts`、`bridge.ts`、`StartupRecoveryNotice.tsx` 与 `NativeApp.tsx`。

## 已执行验证

以下日志为本 worktree `.cache/startup-stall/` 中的本次运行结果。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| `go test -race ./agent ./desktopbridge` | agent 140.317s、bridge 2.250s 通过；最终元数据变更另跑下面的风险用例 | [go-race.log](../../../../.cache/startup-stall/go-race.log) |
| `go test -race ./agent ./desktopbridge -run 'DesktopRecovery\|DesktopRuntimeRecovery\|DesktopRuntimeRunsRealSynchronizationRelayAndStop'` | 通过；clean／stopped／user_stopped／pending／dirty_guard／active／corrupt，核对保护和账号文件字节、零外部写与零新增运行操作 | [go-risk-final.log](../../../../.cache/startup-stall/go-risk-final.log) |
| `RUSTUP_TOOLCHAIN=1.94 cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --tests` | 299 单测通过、4 个需显式运行的原生测试 ignored；76 个独立合约通过 | [rust-final.log](../../../../.cache/startup-stall/rust-final.log) |
| `node --test desktop/tests/startup-recovery.test.ts desktop/tests/native-command-contract.test.ts` | 10 通过；核对 52 个注册命令与 Rust 入参，并验证失联证据、旧实例拒绝、首次读取失败和恢复后继续读取 | [node-final.log](../../../../.cache/startup-stall/node-final.log) |
| `npm --prefix desktop run typecheck` | 通过 | [typecheck-final.log](../../../../.cache/startup-stall/typecheck-final.log) |
| `BEE_DEVICE_TEST_PORT=1432 npm exec -- playwright test --config ../.cache/startup-stall/playwright.config.mts native-experience.spec.ts --workers 2`（在 desktop 运行） | 71 通过；真实生产 React，模拟 IPC，系统 Chrome。含紧凑状态、60 秒截止、查询、焦点、诊断及首次读取失败后的继续路径 | [ui-final.log](../../../../.cache/startup-stall/ui-final.log) |
| `native_auto_service_through_real_go_transport_and_controlled_hive -- --ignored --nocapture` | Rust → 生产 Go transport → 受控 Hive 通过；2 次连接、4 次 relay 探测、0 次 relay 失败；两平台暂停最终均保持 true | [native-final.log](../../../../.cache/startup-stall/native-final.log) |
| Tauri debug App 打包 | 正式前端 build 与原生编译、ad-hoc 签名通过；包名 Bee S1 Dev.app，约 77.19 MiB；没有启动 | [app-final.log](../../../../.cache/startup-stall/app-final.log) |
| `codesign --verify --deep --strict` | 最终包通过，详见签名记录 | [签名与来源](build-verification.txt) |

受控原生集成使用显式临时目录和 `.cache/startup-stall/agent-native.test`，不使用真实设备与账号；`resume_writes=1` 是该集成在恢复前的显式允许步骤，自动恢复不解除暂停。

发现并补上的回归均先出现失败：恢复成功后再次 retry 原先会变为 blocked；首次启动状态读取失败原先仍访问账号维护；核对成功原先未立即继续账号读取。对应 [retry-red](../../../../.cache/startup-stall/retry-red.log)、[startup-read-red](../../../../.cache/startup-stall/startup-read-red.log)、[continuation-red](../../../../.cache/startup-stall/startup-continuation-red.log)，最终用上述通过结果覆盖。

构建命令（仓库根）：

```sh
APPLE_SIGNING_IDENTITY=- RUSTUP_TOOLCHAIN=1.94 npm --prefix desktop run tauri -- build --debug --bundles app --ci --config '{"productName":"Bee S1 Dev"}' -- --locked
```

## 界面与主预览

- [浅色阻塞 · 860×600](blocked-light-860.png)
- [深色单层详情 · 860×600](blocked-dark-details-860.png)
- [英文深色详情 · 860×600](blocked-dark-english-details-860.png)
- [首次读取失败 · 浅色 860×600](startup-read-failed-light-860.png)
- [导出的模拟启动诊断](startup-diagnostics-synthetic.json)：来自生产 React 与模拟 IPC，不是真实账号的诊断。

Ego 浏览器验证真实生产 React 的紧凑状态、一个主错误、诊断导出、明暗／英文、最小窗口及首次读取失败 → 手动核对 → 回到账号页；核对前无账号控件和维护请求。主预览验证准备阶段直接停留、后台连接失败 → 旧会话阻塞、只读核对、诊断及模拟导出；现有账号场景保留。

[唯一主预览](../../../preview/index.html?scene=startup-blocked) · [最终冻结版](../../../preview/history/20261111-121407-startup-recovery-verified/index.html?scene=startup-blocked) · [历史索引](../../../preview/history/README.md)。初版归档内原有旧版对照链接的相对路径缺口保留在旧文件；最终冻结版一并保存所需 baseline／before-startup 对照文件。

## 影响路径自审

按 affected-path-review 从输入追踪到副作用与展示，包含未改动的准入、保护与清理代码：

| 路径 | 核对内容／证据 |
| --- | --- |
| App setup → StartupGate → Go inspection | 所有真实启动先 hold；设备与 lifecycle 锁内只读核验；阻塞在预留之前；继承脏会话测试证明无 Restore／Stop 调用且管理仍 ready |
| inspection → journal → Restore → worker／Hive | instance、binding、network、previous_run、account_revision、intent、operation 逐项保持；Go 原预留重复验证；暂停不由历史 resume 列表覆盖 |
| unknown → observe → terminal／retry | 仅同实例原 start operation 可结算；新实例不能重放；终态不可变、下一次关联与归档。缺少外部退役证明的情况保持阻塞 |
| reconnect → owned Child → exit／update | 旧子进程须先回收；pending tracker 不丢弃；verified LaunchSpec；新退出 freeze 不被 stop 通道重置清除；相关竞态测试通过 |
| failure → status/event → TS decode → 页面 | 原始错误保留；读取错误独立；新实例拒绝旧事件；阶段和计数严格解码；首次读取失败阻止维护，核验成功立即继续读取；人工焦点返回 |
| 本地证据 → 导出 | 生产诊断脱敏呈现，不写远端；截图与导出使用合成数据；不会把管理连接成功当作旧会话恢复成功 |

自审修复了成功后重复 retry、启动前误触发账号读取及首次读取失败的漏报／继续问题。当前无尚未修复的本轮具体代码发现；下列验证和协议缺口继续保留。

## 已知未通过／未覆盖项目

1. **真实旧会话接管**：缺少 Hive 的 worker／准备保护退役证明；不能用重启、普通 start、锁或删除保护文件代替。最初哪一次退出留下脏保护仍未知。
2. **打包原生窗口与其他平台**：没有安全隔离的生产配置入口；本轮未启动会读取真实账号且可能恢复接单的新 App。浏览器 UI、受控真实 Rust／Go transport、包构建和验签不能替代原生窗口验收。Windows／Linux 未运行。
3. **完整 Cargo 默认目标**：裸 `cargo test` 编译既有 `examples/experience_probe.rs` 时存在生命周期／授权模块引入及 BridgeError、DiagnosticReport、通知适配器接口漂移，见 [rust-all.log](../../../../.cache/startup-stall/rust-all.log)。本轮验证通过范围为 `--lib --tests` 与实际 App，不宣称默认全目标通过。
4. **其他账号 UI 套件**：扩展运行 native-runtime／recovery-navigation 时，有测试仍用旧账号 region 和“接入”按钮定位，共享工作区已采用紧凑列表，运行未通过并已停止，见 [ui-related.log](../../../../.cache/startup-stall/ui-related.log)。本轮不覆盖其他会话的账号 UI；最终 native-experience 全部通过。
5. **生产发布**：开发包仅 ad-hoc 签名，未作正式签名、公证和完整干净安装验收。

## 一致性检查

- ✅ 会话：当前结论与已确认的自动优先、紧凑状态、暂停保持、未知不重放一致。
- ✅ 会话：没有恢复已否定的清空保护、循环重启、人工点击替代安全证明方案。
- ✅ 会话：仅当前 worktree、保留其他改动、未触碰真实账号与设备配置、未提交。
- ✅ 纵向：规格、计划、待确认场景与本记录均区分“实现落地”和“真实旧会话已接管”。
- ✅ 纵向：ready、恢复资格、阶段、百分比／计数及未知结果的语义一致。
- ✅ 横向：实现对应计划任务；远端协议依赖与原生窗口缺口没有被勾选为验收通过。
- ✅ 横向：没有 PR／commit；本交付说明对应本轮启动路径，其他账号 UI 改动明确排除。
- ✅ 横向：新增命令、能力、Go／Rust／TS 字段及受影响调用者同步；52 命令参数合约通过。
- ✅ 配置：未增加运行环境变量、服务、数据库或依赖；私有记录路径与文档一致。
- ❌ 环境覆盖：Windows／Linux 和隔离打包原生窗口未验收。
- ✅ 文档：README、桥接扩展、规格、场景、主预览与本记录按实际行为同步，已列出默认 Cargo 示例及其他 UI 套件缺口。

结论：已知缺口已记录；本次实现和受控验证可交付，完整发布验收尚未通过。
