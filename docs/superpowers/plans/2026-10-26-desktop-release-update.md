# Bee 桌面：安装、更新与发布验收实施计划（S3）

> **执行状态（2026-10-27）：** 用户将另开会话并行实施 S3，原会话仅负责 S1；不再等待 S1/S2 整份结束才开始。使用独立分支及工作树，基于包含 S1 已提交基础的 `feat/bee-desktop-p0`（此次调整时为 `6dd2f4b`）；原工作树尚未提交的 S1-T5 不在该基础内。先实施独立任务，按下列依赖同步 S1/S2 后续提交；复选框只记录有验证证据的完成项。

**目标：** 完整覆盖P1–P6，准备正式Bee安装包、签名更新、数据升级和八个原生目标组合的验收证据。

**架构：** 延用DMG/NSIS/AppImage与同次构建的内置Bee；Rust用官方updater读取受控HTTPS静态清单，先下载验签，再由用户确认退出安装。停止、配置格式和偏好复用S1/S2；单实例保护持续至实际App退出。

**技术栈：** 保持Go1.27.3、Tauri2.12.5、tauri-build2.7.4、Rust1.94（最低1.90）、React19.2.8/TS7.0.2/Vite8.2.4/Node24。新增Rust `tauri-plugin-updater = "=2.14.0"`；2026-10-26只读核对crates.io索引，其Tauri要求`^2.12`、Rust1.90，实际兼容在T2构建验证。无Hive更新服务。

**依据：** [已批准S3 spec](../specs/2026-10-26-desktop-release-update-design.md)、[S1公共契约/并行安排](2026-10-26-desktop-account-runtime.md)、[S2配置与体验](2026-10-26-desktop-diagnostics-experience.md)。保留旧证据，不将开发包结果改写为正式发布通过。

## 全局约束和外部输入

- 正式显示名Bee，沿用 `dev.tokhive.bee` 和现有数据路径；不移植Hive用户/资金功能，不改Hive，不加新包格式。官方AI客户端需独立安装。
- 三端八组合：macOS13+ arm64/x64；Win10 22H2与Win11 x64；Ubuntu22.04/24.04 x64/arm64。容器/Xvfb、Windows Server、较新macOS不能替代目标原生验收。
- 自动检查每日最多一次，手动可重试；检查/下载不是安装批准。用户确认退出后才安装，可能中断任务；不承诺排空、任务数或任意断电点自动回滚。
- 所有新迁移先保护原件；不覆盖CLI/官方登录、不在安装目录写账号状态。受控更新地址、公钥、渠道、版本由构建输入固定，前端不可改源或执行任意程序。
- 需要真实发布仓库/HTTPS资产地址、Developer ID/公证、Windows Authenticode、更新签名密钥及目标桌面环境；密钥通过受控构建环境接入，不写仓库、不索取聊天粘贴。缺资源时继续实现和候选包准备，准确保留未完成发布项。
- T1/T2可与S1账号实现、S2体验并行；T3需S1-T6和S2-T1的数据/退出实现，T4需S2设置页；T5用整合候选版本验收。S1负责唯一运行／恢复／退出实现，S2负责普通偏好和设置页；本会话消费接口，不复制这些实现。共用配置、锁文件、生命周期和CI注册点在独立工作树开发后逐项合并，不覆盖其他会话代码。
- 鉴权、签名、迁移和不可逆安装遵循`high-stakes-implementation-testing`。每任务先写下列失败用例，再实现、同命令复测至通过；修复错误不得掩盖失败环节。

## 文件职责和契约

| 文件 | 责任 |
| --- | --- |
| `desktop/scripts/prepare-release.mjs`、`verify-release.mjs` | T1：受控发布配置、App/Bee同源版本、资产清单及签名证据校验 |
| `desktop/src-tauri/src/updater.rs` / `updater_tests.rs` | T2：固定更新源、检查/下载/签名及状态 |
| `desktop/src-tauri/src/update_install.rs` / `update_install_tests.rs` | T3：用户确认后的冻结/持久化/回收/安装交接与启动恢复标记 |
| `desktop/src/system/updater.ts`、`features/settings/NativeUpdateControls.tsx` | T4：设置页状态、进度、确认与准确失败 |
| `desktop/scripts/verify-release-evidence.mjs`、`docs/desktop/release-validation.md`、`docs/desktop/release.md` | T5：八组合证据、发布说明与交付条件 |

| 契约 | 内容与调用者 |
| --- | --- |
| 发布配置 | `BEE_RELEASE_VERSION`、`BEE_RELEASE_CHANNEL`、`BEE_UPDATE_ENDPOINT`、`BEE_UPDATER_PUBLIC_KEY`为构建输入；生产只能受控HTTPS，精确映射版本/渠道/平台/架构/包格式。签名秘密使用Tauri/签名工具既有CIsecret输入，不能进入配置输出 |
| `UpdateSnapshot` | `operation_id:null|string, revision:number, state:idle/checking/current/available/downloading/verified/stopping/installing/failed, current_version, target_version:null|string, checked_at:null|string, downloaded_bytes:number, total_bytes:null|number, release_notes:null|string, error:null|BridgeError`；发布说明纯文本，unknown进度不归100% |
| Rust固定命令 | `update_snapshot()`、`update_check()`、`update_download()`返回快照；`update_install({operation_id,expected_revision,confirmed:true})`启动安装流程并返回可观察状态。参数不包含URL/程序路径；重复、迟到、跨operation请求拒绝 |
| 持久更新状态 | Rust内部 `desktop-update-state.json`，version1，保存last_auto_check和pending_update（from/to版本、渠道、阶段、目标摘要），原子受保护写入；不与S1/S2配置混存，不含密钥。用于每日节流和下一次启动确认，不新增通用任务框架 |
| 停止输入 | S1 `prepare_owned_exit(OwnedExitReason::Update)`；仅receipt的intent_saved/session_clean/child_reaped/config_lock_released全部成立才进入installer，App singleton仍持有 |
| 恢复证据 | 新版本确认内置Bee来源/协议、S1/S2文件迁移与读取、未决动作核对及运行意图恢复；只有这些检查通过才清除pending_update并显示更新完成。损坏/不支持版本保持停止及可诊断错误 |

更新插件的原生下载、签名和安装API必须在T2对准确版本验证；不能绕过验签自行执行下载内容。生产配置单独生成到忽略的构建输出，测试公钥/本地源永不写入正式包。

## Task 1（S3-T1）：正式命名、同源打包与签名流水线

**文件：** 新建上述prepare/verify脚本、`desktop/tests/release.test.mjs`；修改 `desktop/src-tauri/tauri.conf.json`、`build.rs`、`src/build_source.rs`、`desktop/scripts/build-bee.mjs`、`.github/workflows/release.yml`、`desktop.yml`、`desktop-hosted-macos.yml`、`desktop-hosted-windows.yml`、`desktop-hosted-linux.yml`；共享文件集中合并。

**输入／输出：** 沿用现有包生成和来源证据；补生产模式及受控构建变量，版本一致校验覆盖package.json、Cargo与Tauri发布输入。输出到被忽略的 `.cache/desktop-release/`：候选包/manifest/签名及哈希记录，不自动上传公开资产。

- [x] 写失败用例：正式包仍含Dev/demo；App/Bee版本/架构/提交不一致；PATH上的同名Bee；endpoint非HTTPS/缺公钥；Windows非当前用户安装配置；签名/公证证据缺失不能标正式；卸载不删除用户配置。
- [x] 运行 `node --test desktop/tests/release.test.mjs desktop/tests/tooling.test.mjs`，确认新增约束失败。
- [x] 实现prepare/verify脚本和发布模式接线；正式Bee名称/标题，标识和数据路径不变。扩展现有CI的构建/签名/公证步骤；敏感值只从CI受控secret读入，输出仅身份摘要和校验结果，开发构建仍可无生产密钥。
- [x] 重跑测试及当前平台受控候选构建；运行 `node desktop/scripts/verify-release.mjs --artifacts .cache/desktop-release`检查包内Bee与来源。CI配置准备不等于远端签名已执行。
- [x] 提交本任务路径：`build(desktop): prepare matched production bundles and signing`（`1b0a8bd`）。

T1 自动测试与审阅已通过，提交 `1b0a8bd`；macOS 15.7.7／arm64 候选 DMG 已构建并通过包校验，同一 DMG 内真实 Bee 的封印／篡改检测及握手／回收 2 项测试通过，见 `docs/desktop/release-validation.md` 补充证据；不能替代 macOS 13 或正式签名／公证。

## Task 2（S3-T2）：受控检查、下载及签名验证

**依赖：** T1发布输入；可不等S1运行实现。**文件：** 新建上述updater模块、`desktop/tests/update-manifest.test.mjs`；修改 `desktop/src-tauri/Cargo.toml`、`Cargo.lock`、`src/lib.rs`、`capabilities/default.json`及T1发布脚本。

**输入／输出：** 插件2.14.0与上述快照；固定GitHub Release HTTPS静态清单和资产，支持三个包格式/所有目标架构。测试用临时签名密钥和隔离测试构建，只公开测试公钥。

- [x] 构造受控清单/资产：无更新、可更新、错版本/渠道/系统/架构、重定向到非受控源、签名错误、下载断开、大小/空间失败、重复请求/迟到进度、恶意发布说明；检查/下载不得停止Bee；跨重启每日节流、手动可重试。
- [x] 运行 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml updater`、`node --test desktop/tests/update-manifest.test.mjs`，确认失败。
- [x] 固定插件和锁文件，实施原生检查/下载/验签及有界进度；使用生产受控源和测试注入隔离。T1生成清单按实际updater schema验证，每个资产有真实更新签名，哈希不替代签名。不得在下载完成时调用安装。
- [x] 重跑上述测试及 `cargo check --locked --manifest-path desktop/src-tauri/Cargo.toml`；用临时密钥实际签名小型测试资产验证成功/篡改拒绝，不能只mock验签布尔值。
- [x] 提交本任务路径：`feat(desktop): check and verify controlled signed updates`（`e58ed85`）。

T2：14 项 updater 回归通过，含真实临时签名、篡改／错版本拒绝、停滞下载超时和 HTTP 错误限长；`cargo check --locked` 通过。五项审阅发现均修复并复审关闭；Linux AppImage 分支和 Windows 权限仍需原生执行。

## Task 3（S3-T3）：更新退出交接和数据升级恢复

**依赖：** T2、S1-T6、S2-T1。**文件：** 新建上述update_install模块、`agent/desktop_upgrade_test.go`；修改 `desktop/src-tauri/src/runtime.rs`、`sidecar.rs`、`lib.rs`、`lifecycle.rs`、`agent/desktop_account_state.go`、Rust preferences与测试（数据格式变更由各自负责人整合）。

**输入／输出：** 消费已验签operation及S1退出receipt；S1账号v2、S2偏好v1的版本/迁移是唯一依据。持久更新标记不改变用户贡献意图和未决confirm身份。

- [x] 写真实子进程/文件用例：用户未确认无副作用；确认后冻结新动作；未决confirm原样保存；停止写失败、worker/reap/锁释放失败阻止安装；第二实例在交接至App退出前仍被挡住；外部Bee不被杀；取消保持旧App，已停后安装失败显示实际停止。
- [x] 写升级用例：旧提醒v1/新账号v2/普通偏好/配对保留，保护备份、迁移写失败原件不变；新版先核验包内Bee及数据后恢复；换号暂停/用户停止保持；不支持新格式的旧程序明确拒绝，不静默重置。原子边界故障注入覆盖写前、rename前后、退出前后。
- [x] 运行 `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml update_install`、`go test ./agent -run 'TestDesktopUpgrade|TestDesktopAccountState|TestDesktopRuntimeRecovery' -count=1`，确认新用例失败。
- [x] 实现退出/安装交接与下次启动标记核对；下载和验签必须先完成。复用S1停止并实际reap管理子进程，App单实例锁直到真正退出才释放；保存失败继续回收但不安装。安装失败保留数据与可信旧包恢复指引，不许宣称自动回滚。
- [x] 重跑测试和Rust `sidecar` / `lifecycle` / `preferences` 回归；提交：`feat(desktop): coordinate safe update exit and data recovery`（`a6f419d`）。

T3：Go 全量测试及 vet 通过，完整 Rust 单线程回归 105 通过、2 项签名包专用项 ignored；11 项更新安装／恢复用例均通过。三项 P1 已修复并复审通过。首轮并行负载下两项 fixture 启动超时原日志保留，未改 deadline；单线程完整复验通过。

## Task 4（S3-T4）：原生设置页更新操作与进度

**依赖：** T2/T3、S2-T5。**文件：** 新建上述updater.ts/NativeUpdateControls、`desktop/tests/updater.test.ts`、`native-updater.spec.ts`；修改 `desktop/src/features/settings/NativeSettingsPage.tsx`、i18n中英文、`desktop/playwright.device.config.ts`和共享固定命令注册点。

**输入／输出：** 消费UpdateSnapshot，后台检查在Rust调度，手动按钮可重试；S2版本展示扩展为更新状态。用户“退出并安装”是唯一安装确认。

- [x] 页面用例：后台检查失败仍可贡献；下载/验证分别显示；未知大小不编百分比；可重试而不重启应用；说明可能中断任务；无可信任务数不显示无任务；重复安装/旧回执拒绝；安装失败保持真实停止状态；发布说明按文本展示。
- [x] 运行 `node --test desktop/tests/updater.test.ts` 和 `npm --prefix desktop run test:device`，新native-updater用例被收集并先失败。
- [ ] 完成页面与固定命令接线，禁止前端任意更新源/文件路径/HTML；新版本未完成配置和运行核验前，不显示更新成功。
- [ ] 重跑上述测试及 `npm --prefix desktop run typecheck`、`npm --prefix desktop run build`；原生受控更新源验证可观察进度和用户确认，再提交：`feat(desktop): expose verified update installation in settings`。

T4 独立控件与严格客户端已通过审阅：Node 7 项、当前整合页面 Node 19 项／Chromium 41 项通过，typecheck／build 通过。独立控件已提交 `fede56d`，生产设置页接入等待 S2-T5 的已提交实现；不复制 S2 设置页，不将测试夹具视为生产联调完成。

## Task 5（S3-T5）：八组合安装升级验收及发布材料

**依赖：** S1-T8、S2-T6、S3-T1–T4；若S1/S2仅有环境缺口，代码继续整合，但不得跳过缺口宣称正式发布。**文件：** 新建上述证据校验脚本、`desktop/tests/release-evidence.test.mjs`、两份release文档；修改 `desktop/scripts/ci-native-evidence.mjs`、`smoke-linux-appimage.mjs`、现有hosted工作流。

- [x] 给证据校验写失败用例：缺OS组合、错架构/源码/构建模式、未签名、旧包截图、容器冒充原生、任一主流程空缺即不通过；运行 `node --test desktop/tests/release-evidence.test.mjs`，先失败再实现。
- [x] 整合后运行 `go test ./...`、`go vet ./...`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`、`npm --prefix desktop run test:device`、`npm --prefix desktop run test:bridge`、`npm --prefix desktop run test:tooling`、`npm --prefix desktop run build`；复用相同源码已有证据，只对集成影响/失败补跑。
- [ ] 生成同一候选版本的各目标包；mac拖入Applications、Windows普通用户NSIS/WebView2、Linux真实桌面AppImage逐项安装。两平台官方登录/来源权限、明确贡献、暂停恢复、换号暂停、断网重启，及诊断/代理/导出/通知/自启/窗口找回使用真实安装路径验证。
- [ ] 对DMG对应mac更新资产、NSIS、AppImage分别用两个同源签名候选版本实测检查→下载→验签→确认退出→安装→新版本数据与运行核验；另实测错签名/错架构/断网/磁盘权限/重复安装/回收失败/旧程序拒绝新格式。只用用户授权测试账号/流量；临时签名结果标测试，不替代正式签名。
- [ ] 八组合逐格记录OS版本/架构、源码、App/Bee/官方客户端版本、包哈希/签名、公证、操作/实际结果及缺口；缺机器或密钥列出具体资源和接入位置，继续完成能做的候选产物与文档。无证据保持未勾选，不删平台来过关。
- [ ] 编写`docs/desktop/release.md`的安装/更新步骤、官方客户端前置、包校验、支持矩阵、已知限制；不宣传资金/移除/等待任务退出。执行 `node desktop/scripts/verify-release-evidence.mjs --evidence docs/desktop/release-validation.md`，所有P1–P6及八组合完整才可判正式发布就绪。
- [ ] 执行 `verification-before-completion`、`consistency-check`、`post-verification-check`；提交文档和证据校验：`docs(desktop): record signed release readiness and native coverage`。准备完成的公开资产及说明供审阅，使用届时明确发布授权执行上传；没有该授权不发布。

T5 证据校验与发布材料已提交 `927502c`，校验器 95 项通过。实际发布矩阵保持 pending；无正式签名／机器／账号证据的项目不勾选。

| Spec验收 | 实施／证明 |
| --- | --- |
| P1 安装与来源 | T1/T5 |
| P2 真实账号贡献主流程 | S1-T8、T5 |
| P3 日常桌面功能 | S2-T6、T5 |
| P4 签名更新及数据恢复 | T2/T3/T4/T5 |
| P5 失败不破坏/不假报 | T1/T2/T3/T4/T5 |
| P6 发布资料 | T1/T5 |

“代码和候选包完成”“当前平台已验证”“八组合正式发布就绪”分别据证据报告。只有最后一项满足才能称本spec完整交付；环境/签名资源不足不妨碍推进其余实现，也不能以此隐藏未完成项。
