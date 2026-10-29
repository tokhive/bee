# Bee 安装、更新与发布验证记录

更新日期：2026-10-29。当前状态：**待验收（pending），尚不具备八组合正式发布证据**。

本文件落实[已批准的 S3 设计](../superpowers/specs/2026-10-26-desktop-release-update-design.md)中的 P1–P6。代码和候选包准备、当前平台验证、八组合正式发布就绪分别记录。自动测试或构建通过不能填写真实安装验收为通过。

当前已同步 S1 的 owned 退出／恢复和原生贡献界面，以及 S2 最终提交 `2fdf13728e0fdf33173bbfac388ec1b87051df96` 的偏好、诊断／网络服务、分类设置页及公共壳；S3 将更新区接入“设置 → 关于”，消费真实退出、偏好与固定更新命令。S2 UI 完成的范围及其功能原生验收缺口见[原验收报告](../superpowers/reports/2026-10-28-desktop-s2-ui-verification.md)，不将 UI 完成等同于全部平台验收完成。S3 不复制另一套账号、偏好或退出逻辑。生产 HTTPS 更新地址、生产更新签名密钥、Developer ID／公证、Authenticode、授权测试账号及八组合原生桌面资源尚未提供。本轮没有发布或上传资产，也没有运行用户的官方客户端或贡献流量。

## 现有证据的适用范围

历史记录保留在 [P0 验证](p0-validation.md)、[P1 页面验收](../../desktop/docs/p1-acceptance.md)及 `evidence/`。历史 demo、ad-hoc 签名、浏览器、容器／Xvfb、Windows Server 或较新 macOS 结果只能证明其当时条件，不证明本次正式包及新功能。旧包截图不得给新候选的 P1–P6 打勾。

只有源码、构建模式、候选身份和相关包路径仍相符的证据才可复用。纯文档变更无须重新制造全部历史构建；一旦候选包或相关代码变化，须补对应证据。集成测试命令及实际结果由整合者补入本文件，未执行项保持待验证。

## 本机候选与自动验证补充（2026-10-28）

曾生成 macOS 15.7.7／arm64 的 ad-hoc 候选 `Bee_0.1.0_aarch64.dmg`（20,895,477 字节），源码 `10a1e6dcfd087fb677e7ad8f160ede5b39c4b117`，构建时工作树干净。App／包内 Bee 均为 0.1.0，DMG SHA-256 为 `1e1134b185f97999f97beac4ca017a3b13798a05292d9dd895c1a47a376dfe41`。旧候选现归档在本工作树 `.cache/desktop-release-10a1e6d-before-inline/`，未安装到 Applications，未上传。

[补充证据摘要](evidence/s3-2026-10-28-macos-arm64/native-summary.json)绑定了实际 manifest、来源和校验报告及日志。prepare-release 的实际 DMG 提取校验已通过，包内 Bee 来源／架构／版本与 App 签名封印相符；只读挂载同一 DMG 后，2 项包专用测试通过：封印接受原包并拒绝篡改副本，实际包内 Bee 完成 hello／ping／shutdown 并等待 owned 子进程回收。挂载点随后卸载，没有 GUI、真实账号或贡献流量。

| 自动验证 | 本轮结果 |
| --- | --- |
| Go 全量测试与 vet | 通过 |
| Rust 完整回归 | 105 通过，2 项包专用测试单独补跑后均通过 |
| 受控 updater 回归 | 14 通过，含临时真实签名／篡改、HTTP 状态正文、read timeout |
| S3 相关 Node | 180 通过，1 项 Windows 原生 PowerShell 用例在 macOS 明确跳过 |
| 原生页面夹具 | Node 19、Chromium 41 通过 |
| bridge／TypeScript／前端构建 | bridge 10 通过，typecheck 与 build 通过 |

这些结果是当前较新 macOS 上的历史补充证据，不填补 macOS 13 最低系统格，也不等于 Developer ID／公证、生产更新签名、两版本安装升级或正式发布就绪。本候选早于本次 S2 设置页与内联更新整合，不含最终界面；不可用其包内测试或截图证明新界面。首轮 Rust 与浏览器并行时两项 fixture 启动超时，避开负载后单线程完整回归通过，未放宽生产或 fixture deadline。

## 关于内联整合验证（2026-10-28）

已导入 S2 的已提交依赖：本分支 `61cc66c` 对应 S2 `eee5a07` 的只读诊断／网络服务，`79d8f1e` 对应 S2 `bdfbb84` 的诊断及日常体验。合并时保留 S1 accountWorkers 修复，统一 updater／notification／autostart 插件和固定命令注册；S2 网络配置完成后再由 S3 启动核验调用 S1 恢复，不重复恢复运行。

按用户已确认的“关于内联”布局，正式设置页只显示一次版本；每个更新状态对应一个主要按钮，发布说明及错误详情折叠。安装先打开确认框，默认取消，支持 Escape 及关闭后焦点恢复；只有“退出并安装”才提交已验签回执。安装失败的未知结果不自动重放，先读取状态，再由用户重新检查更新取得新回执。页面接入、失败恢复和升级启动网络回归均先复现失败再修复，独立审阅发现已关闭。

以下命令在本工作树使用 Node 24.22.1、Rust 1.94 执行，均退出 0；日志保存在本工作树 `.cache/`，不会作为正式签名或八组合附件使用。

| 命令／范围 | 结果 | 本地日志 |
| --- | --- | --- |
| `npm --prefix desktop run test:device` | 基础 Node 25、Chromium 63 通过 | `s3-inline-device-final.log` |
| `node --test desktop/tests/desktopState.test.ts desktop/tests/network.test.ts desktop/tests/notifications.test.ts desktop/tests/updater.test.ts` | 24 通过 | `s3-inline-node-final.log` |
| `npm --prefix desktop run test:bridge` | 11 通过 | 执行输出已核对 |
| `npm --prefix desktop run build`（含 typecheck） | 通过 | `s3-inline-build-final.log` |
| `cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml -- --test-threads=1` | 177 通过、2 项包专用项 ignored；另 network contract 27 通过 | `s3-inline-rust-final.log` |
| 扩展的真实 Tauri 下载命令／临时签名测试 | 1 通过（在完整 Rust 回归后补跑受影响项） | `s3-inline-native-ipc.log` |
| `go test ./agent ./desktopbridge`／`go vet ./agent ./desktopbridge` | 通过；其他 Go 路径复用上轮全量证据 | `s3-inline-go.log`／`s3-inline-vet.log` |

浏览器与手动预览使用正式页面组件、模拟 IPC，已核对浅／深主题、确认框、取消、按钮悬停对比度及 320px 内容宽度无横向溢出。`node desktop/scripts/preview-update.mjs` 启动 `http://127.0.0.1:1434/__s3-updater-preview`，刷新重置模拟状态；该页面不会实际下载、安装、登录或贡献。

原生接口补充测试通过真实 Tauri 命令处理器调用 `update_snapshot`／`update_download`，从临时 HTTP 源下载真实签名资产并核验签名／摘要，观察 available→downloading→verified。窗口宿主是 MockRuntime；只有异步轮询限时 5 秒，未给所有同步 socket／IPC 调用声明统一限时。没有调用实际安装器，也未使用生产更新源，不能替代真实原生 GUI 的两版本安装升级验收。

### 整合后的本机候选

源码 `a34d9345e55db885f0754905417063bef2ea8ccd` 在干净工作树重建候选，包含当时的 S2 设置页和“关于内联”更新接线，早于 S2 最终分类 UI。该轮产物为本工作树 `.cache/desktop-release/Bee_0.1.0_aarch64.dmg`，21,687,841 字节，SHA-256 `23a89f321eb8b2196c721b94c886433a4cb6d6f9a8a55fbaa35fbe82bcacade2`；App／Bee 均为 0.1.0，macOS 15.7.7／arm64，ad-hoc 签名。该历史包不能证明下述最终 S2 UI 已打包。

`node desktop/scripts/prepare-release.mjs --mode candidate --build` 退出 0，内含实际 DMG 提取、App／Bee 架构／版本／提交及签名封印校验。同一 DMG 再以只读方式挂载，设置 `BEE_TEST_APP_BUNDLE` 后运行两项包专用测试，退出 0、2 项通过：签名封印接受原包并拒绝篡改副本，包内真实 Bee 完成握手／ping／shutdown 并回收 owned 子进程。随后卸载挂载点。[新候选证据摘要](evidence/s3-2026-10-28-inline-macos-arm64/native-summary.json)保存对应来源、manifest、校验报告和日志摘要。

没有安装到 Applications、启动该候选 GUI、调用安装器、使用真实账号或发布。候选缺少生产更新输入、更新资产签名及正式平台签名／公证；浏览器截图只证明页面布局，不证明该包已完成原生 GUI 验收。两个候选均为 0.1.0，不能冒充两个版本的升级证据。

## S2 最终分类 UI 接入（2026-10-29）

本轮使用真实 merge 导入 S2 `2fdf137`，其中实现整合提交为 `3d908fc`，S1 公共壳／概览／账号快照为 `27f5360`，包含官方慢查询期限修复 `dd8ef64`。保留 S2 唯一协调器与真实客户端，未导入其他工作树的未提交修改，也未另写 S1/S2 模块。共享启动点继续执行 S2 网络初始化 → S3 启动核验 → S1 唯一恢复；签名、安装回执、退出冻结与停止保护保持原 S3 实现。

按已确认的“关于内联”方案，将更新区接入 S2 的“关于”页签，复用 S1 公共壳和 S2 设置样式。App／Bee 版本一致时只展示一次；核心版本未读到或不一致时保留诊断提示。普通页签切换不重读系统状态或丢代理草稿；更新区重挂载只读取原生更新快照，不自动发起检查、下载或安装。中英／明暗、窄窗布局及取消／Escape／焦点返回均已复核。独立合并审阅未发现 Critical／Important 问题。

| 命令／范围 | 实际结果 | 本工作树 `.cache/` 日志 |
| --- | --- | --- |
| `npm --prefix desktop run test:device` | Node 33、Chromium 97 通过 | `s3-final-s2-device-green.log` |
| `npm --prefix desktop run build` | typecheck／build 通过；既有主 chunk 大小提示保留 | `s3-final-s2-build-green.log` |
| `cargo test --offline --locked --manifest-path desktop/src-tauri/Cargo.toml -- --test-threads=1` | 177 通过、2 包专用项 ignored；network contract 27 通过 | `s3-final-s2-rust-green.log` |
| `go test ./...`／`go vet ./...` | 通过 | `s3-final-s2-go.log`／`s3-final-s2-vet.log` |
| `node --test desktop/tests/*.test.ts desktop/tests/*.test.mjs` | 首轮 301 通过、1 平台项跳过、1 TEE 下载因 GitHub clone 120 秒超时失败；包含 bridge／tooling | `s3-final-s2-node.log` |
| `node --test desktop/tests/tee-real.test.mjs` | 从本机固定源码缓存独立复制后复验：2 通过，固定归档及篡改拒绝均核对 | `s3-final-s2-tee-real.log` |

TEE 复验仍使用固定提交 `a687f86d781e825c04c1d84d75b41bba5d862254`，归档 SHA-256 为 `4bc9caad3ad2ce5de01b9983a750cee6380098fc308333c30c098fbf8e7bad38`，未跳过完整性检查或更换依赖版本。Rust 首轮因包内 Bee 来源仍指向旧提交被 build.rs 拒绝，按正常流程重建 Bee 后完整回归通过，未绕过来源约束。

手动预览仍为 `http://127.0.0.1:1434/__s3-updater-preview`。预览等待模拟 bridge／设备就绪再导航，避免初始实例切换重置页签；刷新直接进入“关于”。实测中文浅色 1440×1000、英文深色 860×600 无横向溢出；安装框默认取消，Escape／取消后焦点返回主按钮，`update_install` 调用为零。截图为 `.cache/s3-final-s2-about-light.png`、`s3-final-s2-dialog-light.png`、`s3-final-s2-about-dark-en-860.png`、`s3-final-s2-dialog-dark-en-860.png`，均属正式组件／模拟 IPC 布局证据。此处不替代真实原生 GUI 安装升级；T4 最后联调项、T5 八组合仍未完成。

## 八组合原生矩阵

macOS 必须包含 13.x 最低支持版本的原生验收；新系统不能填补这一格。Windows 必须是桌面工作站系统。Linux 必须在真实 X11／Wayland 桌面完成安装后的操作，容器与 Xvfb 不能替代。

| 证据 ID | OS／架构 | 安装格式 | P1–P6 | 缺口 |
| --- | --- | --- | --- | --- |
| `macos-13-arm64` | macOS 13.x／arm64 | DMG | 待验收 | 原生桌面、正式签名／公证、整合候选、授权账号 |
| `macos-13-x64` | macOS 13.x／x64 | DMG | 待验收 | 原生桌面、正式签名／公证、整合候选、授权账号 |
| `windows-10-22h2-x64` | Windows 10 22H2／x64，build 19045 | NSIS | 待验收 | 工作站、Authenticode、WebView2、整合候选、授权账号 |
| `windows-11-x64` | Windows 11／x64，build ≥22000 | NSIS | 待验收 | 工作站、Authenticode、WebView2、整合候选、授权账号 |
| `ubuntu-22.04-x64` | Ubuntu 22.04／x64 | AppImage | 待验收 | 原生桌面、签名更新资产、整合候选、授权账号 |
| `ubuntu-22.04-arm64` | Ubuntu 22.04／arm64 | AppImage | 待验收 | 原生桌面、签名更新资产、整合候选、授权账号 |
| `ubuntu-24.04-x64` | Ubuntu 24.04／x64 | AppImage | 待验收 | 原生桌面、签名更新资产、整合候选、授权账号 |
| `ubuntu-24.04-arm64` | Ubuntu 24.04／arm64 | AppImage | 待验收 | 原生桌面、签名更新资产、整合候选、授权账号 |

## 可执行证据入口

从仓库根目录运行 Node 24：

```sh
node --test desktop/tests/release-evidence.test.mjs
node desktop/scripts/verify-release-evidence.mjs --evidence docs/desktop/release-validation.md
```

第二条命令目前必须非零退出并显示 pending 和具体缺口。只有八组合、每格 P1–P6、两个配套候选及全部附件齐全时才通过完整性门槛。校验器不会联网、发布、安装、启动 App 或读取签名私钥。

Markdown 内必须且只能包含下方这种明确标记的 JSON 围栏。也可将同一对象保存为 `.json` 文件后传给 `--evidence`；不自动猜测旁边的文件。附件路径相对该证据文件所在目录解析；附件必须全部位于该目录或其普通子目录，拒绝绝对路径、`..` 上级目录、附件及中间目录的符号链接。工具核对词法路径与 `realpath` 均在允许根目录内，不读取目录外附件。所有 SHA-256 均核对本地实际文件字节。记录附件修改后必须重算其引用摘要。空文件、缺文件、摘要不符、身份不符立即失败。

```json bee-release-evidence
{
  "schema_version": 1,
  "status": "pending",
  "blockers": [
    "最终 S1/S2 原生验收及真实 GUI 两版本安装升级未完成",
    "未提供生产 HTTPS 更新地址、发布渠道和正式候选版本",
    "未提供生产更新签名、macOS Developer ID/公证、Windows Authenticode 受控构建凭据",
    "没有两个配套正式签名候选及完整包摘要、签名工具输出",
    "八组合原生桌面安装/升级与 P1–P6 记录尚未齐备",
    "未提供明确授权的 OpenAI/Claude 测试账号及贡献流量操作范围"
  ],
  "candidate": null,
  "previous_candidate": null,
  "release_notes": null,
  "rows": [
    { "id": "macos-13-arm64", "status": "pending" },
    { "id": "macos-13-x64", "status": "pending" },
    { "id": "windows-10-22h2-x64", "status": "pending" },
    { "id": "windows-11-x64", "status": "pending" },
    { "id": "ubuntu-22.04-x64", "status": "pending" },
    { "id": "ubuntu-22.04-arm64", "status": "pending" },
    { "id": "ubuntu-24.04-x64", "status": "pending" },
    { "id": "ubuntu-24.04-arm64", "status": "pending" }
  ]
}
```

## 完整证据对象契约（版本 1）

不得将上述 pending 改为 ready 来绕过缺口。以下字段均来自真实候选或验收运行；可参考 `desktop/tests/release-evidence.test.mjs` 的结构，但其中临时文件和签名文案只是校验器测试夹具，绝不能作为发布证据。

顶层 `status` 为 `ready`、`blockers` 为空才进入校验。`candidate` 和 `previous_candidate` 均包含下表字段，App 和内置 Bee 版本必须相同；旧候选版本必须低于新候选，两个候选使用同一渠道、更新源和生产更新公钥。两个版本的源码提交分别记录，不把旧版提交伪装成新版。

| 候选身份字段 | 要求 |
| --- | --- |
| `version`、`bee_version` | 明确的语义版本，App／Bee 配套 |
| `source_revision` | 完整 40 或 64 位小写源码提交 SHA；包含实际整合的 S1/S2/S3 |
| `build_mode` | 必须为 `production`；demo／e2e／开发包不通过 |
| `channel` | 非空且由受控构建固定的发行渠道 |
| `update_endpoint` | 无嵌入凭据的生产 HTTPS 更新地址，不能是本地测试源 |
| `updater_public_key_sha256` | 生产更新公钥的 64 位小写 SHA-256，不含秘密 |

顶层 `release_notes` 指向正式候选对应的中文发布说明。所有附件引用均为 `{ "path": "相对路径", "sha256": "64位小写摘要", "kind": "类型" }`；`kind` 使用下文规定值，不接受 URL 代替本地可核验附件。原始签名输出不得删掉失败环节；包含日志时先按 S2 脱敏规则移除凭据。

`rows` 必须恰好包含矩阵八个 ID，无重复、无替换。每行包含 `id`、`status: "passed"`、`environment`、`candidate`、`previous_candidate`、`native_identity`、`acceptance`。

### 原生身份

`environment` 包含 `os`（`macos`／`windows`／`ubuntu`）、真实 `version`、`arch`（`x64`／`arm64`）、`execution: "native-desktop"`、`container: false`、`emulated: false`、`display`。macOS 使用 `aqua`；Windows 使用 `windows`，另填数值 `windows_build` 和工作站 `windows_product_type: 1`；Ubuntu 使用 `x11` 或 `wayland`。Windows 版本使用产品版本 `10.0` 或 `11.0`，内核 build 另填，避免 Windows 11 的 NT 10.0 混淆。

`native_identity` 是 `kind: "native-identity"` 的 JSON 附件，字段包括 `schema_version: 1`、`ok: true`、候选绑定字段和完全相同的 `environment`。候选绑定字段为 `source_revision`、`version`、`build_mode`、`installer_sha256`、`update_asset_sha256`。此摘要由原生操作者依据 `ci-native-evidence.mjs` 原始输出及真实桌面观测整理，原始输出也须作为 P1 的 `native-log` 附件保留；摘要本身不能把容器改称原生。

### 每行的两个候选工件

每个 `candidate`／`previous_candidate` 工件对象包含：

| 字段 | 必需内容 |
| --- | --- |
| `identity` | 与顶层相应候选的全部身份字段逐项相同 |
| `os`、`arch` | 与该行目标相同 |
| `installer` | `format` 为 `dmg`／`nsis`／`appimage`；`file` 引用实际安装包，kind 为 `package` |
| `update_asset` | `format`：macOS 为 `app.tar.gz`，Windows 为 `nsis`，Linux 为 `appimage`；`file` 引用对应更新资产，kind 为 `package` |
| `bundled_bee` | `version`、`source_revision` 与相应候选一致；`file` 为从该包核对的 Bee，kind 为 `binary` |
| `signatures.updater` | `verified: true`、`scope: "production"`、匹配的 `public_key_sha256`、`proof` 为 kind `native-log` 的签名验证输出 |
| `signatures.platform` | macOS／Windows 必填：`verified: true`、`scope: "production"`、非空 `identity`、`kind` 为 `developer-id`／`authenticode`、`proof` 为 kind `native-log` |
| `signatures.notarization` | macOS 必填：`verified: true`、`stapled: true`、`proof` 为 kind `native-log`，保留公证及票据核验输出 |

签名输出必须覆盖该候选的安装包、包内原生应用和对应更新资产，记录工具、实际身份／公钥、被验文件摘要及结果。SHA-256 只能核对文件，不能代替签名。测试密钥、临时身份、自签／ad-hoc 结果可另存测试目录，不得写为 production。

每个签名 `proof` 指向 kind `native-log` 的结构化 JSON 验证报告，不接受仅写“已签名”的文本。报告包含 `schema_version: 1`、`verified: true`、`scope: "production"`、`signature_kind`（`updater`／`platform`／`notarization`）、候选绑定字段、`bundled_bee_sha256`、非空 `tool`，以及 kind `native-log` 的 `raw_output` 原始工具输出附件。`updater` 报告另填 `public_key_sha256`；`platform` 报告另填匹配的 `signing_identity`；`notarization` 报告另填 `stapled: true`。这些字段必须与该候选工件一致，旧包的验证日志不能移作新包证明。结构化报告可由真实工具输出整理，原始输出必须保留供审阅，不得在没有实际验签时生成通过报告。

### 安装后的验收 JSON

`acceptance` 为 `kind: "acceptance"` 的 JSON 附件，包含 `schema_version: 1`、真实 ISO 8601 `recorded_at`、实际 `installed_path`、候选绑定字段、与该行一致的 `environment`、`official_clients` 和 `cases`。`official_clients.openai`／`.claude` 均填实际官方客户端 `name` 和 `version`，记录受支持来源及权限结果，不保存账号 token。

`cases` 必须包含 P1–P6，每项均有 `status: "passed"`、候选绑定字段、非空 `evidence` 附件数组及如下步骤。P1–P5 至少有一个 `native-log`；截图可作为 kind `screenshot` 的补充，不能单独证明运行、登录或恢复。P6 至少有一个 kind `document` 的发布材料附件。每一步为 `{ "status": "passed", "actual": "实际操作、观察及核验结果" }`，不接受空文本或仅将总标题写成通过。

| 验收项 | 必需步骤键及内容 |
| --- | --- |
| P1 | `install` 普通用户安装、`start` 安装路径启动、`bundled_bee_source` 包内 Bee 来源、`no_automatic_contribution` 首启不自动贡献、`preserve_existing_config` 保留配置、`preserve_external_bee` 不终止外部 Bee |
| P2 | `platforms.openai`／`.claude` 各自完整填写：`existing_login`、`official_login`、`select_account`、`explicit_contribution`、`pause`、`resume`、`switch_account_stays_paused`、`offline`、`restart_recovery` |
| P3 | `doctor`、`log_export`、`proxy`、`language_theme`、`autostart`、`notifications`、`close_and_reopen`、`permission_denied`、`export_failure`；Linux 记录托盘存在／不存在时窗口找回 |
| P4 | `check`、`download`、`verify_signature`、`confirm_exit`、`owned_stop`、`install`、`new_version_start`、`pairing_preserved`、`account_selection_preserved`、`pause_preserved`、`preferences_preserved`、`pending_actions_reconciled`、`runtime_recovered` |
| P5 | `wrong_signature`、`wrong_platform`、`wrong_architecture`、`interrupted_download`、`disk_failure`、`permission_failure`、`duplicate_install`、`child_reap_failure`、`old_app_new_config`；每一步另填 `data_preserved: true`、`no_false_success: true` 并在 actual 说明旧包／原数据及实际停止状态 |
| P6 | `release_notes`、`supported_platforms`、`installation`、`update`、`official_clients`、`known_limitations`、`package_checksums`、`signing_evidence` |

除 P2 外步骤放在 `steps` 中。P4 另有 `previous`，包含旧候选 `source_revision`、`version`、`installer_sha256` 和 `update_asset_sha256`，必须与该行 `previous_candidate` 相同。P4 的新版本绑定须与当前候选相同；安装器返回成功不能代替新版本实际启动及恢复证据。

### 官方来源与 Linux 托盘的必需子场景

P2 另须有 `source_coverage.openai` 和 `source_coverage.claude`，不能用“正常文件登录已通过”的总述代替。每个平台包含下表四项；这里的来源支持范围依据 S1 当前公开能力：文件来源三端支持，OpenAI `keyring`／Claude `keychain` 仅 macOS 支持。来源能力变化时须同步实现、证据契约和本矩阵，不能仅将必需项改为不适用。

| 字段 | 必需结构及证明 |
| --- | --- |
| `file` | `store: "file"`、`applicability: "required"`、`steps.read`／`.permission_denied`／`.corrupt` 各有 passed 和非空 actual，以及包含原始观测的 `evidence` 数组（至少一个 native-log） |
| `keychain` | OpenAI 的 `store: "keyring"`，Claude 的 `store: "keychain"`。macOS 必须 `applicability: "required"`，同样填写 read／permission_denied／corrupt 三步骤和原生 evidence；Windows／Ubuntu 为 `applicability: "not_applicable"`，必须有具体 `reason` 和来源能力原生 evidence，不得将未实现／未测误写为不适用 |
| `source_switch` | `status: "passed"`、非空 `actual`、不同的 `from`／`to` 来源命名空间，以及原生 evidence；非 macOS 可核对两个受支持文件命名空间的切换，不伪造 Keychain 支持 |
| `unsupported_storage` | 通常为 `applicability: "required"`、passed、非空 actual、`does_not_report_logged_out: true` 和原生 evidence，证明不支持的存储方式被准确显示为不支持而非未登录。Windows／Ubuntu 的不支持 Keychain 场景必须实测；macOS 若对应客户端／原生入口没有可触发的不支持来源模式，才可填 `applicability: "not_applicable"`，但仍须具体 reason 和客户端能力／入口的原生 evidence |

每个子场景必须显式列出自己的证据引用，相关观测可位于同一完整原生会话日志。所有引用继续受候选绑定与目录／摘要规则约束；不能仅解析自由文本推断“应该覆盖了”。

Ubuntu 的 P3 另须 `tray_scenarios.present` 和 `tray_scenarios.absent`，分别记录有托盘和无托盘时关窗后找回窗口。每项为 `{ "status": "passed", "actual": "实际桌面、操作及窗口找回结果", "evidence": [...] }`，每个 evidence 至少有一个 native-log。单个 `close_and_reopen` 步骤不能替代这两个分支。此两分支约束不用于 macOS／Windows。

本工具检查结构、覆盖范围、文件摘要和身份一致性，不调用平台签名工具，也不能判断手工记录是否真实。因此完整性通过后，发布负责人仍须核对签名工具原始输出、原生运行记录和授权范围。只有真实证据同时满足 P1–P6 才能判定正式就绪；工具通过不产生外部发布授权。

## 集成验证与资源接入

整合者应记录候选完整提交、各命令、退出码与日志路径：`go test ./...`、`go vet ./...`、`cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml`、`npm --prefix desktop run test:device`、`npm --prefix desktop run test:bridge`、`npm --prefix desktop run test:tooling`、`npm --prefix desktop run build`。本次整合结果及复用范围见上表；后续候选变化仍需补对应验证，不将历史源码的结果套到新包。

| 缺少资源 | 接入位置及剩余动作 |
| --- | --- |
| S1/S2 原生验收 | 必需实现已导入；补真实安装位置的 owned 退出、配置／偏好迁移、诊断及贡献主流程证据 |
| 生产版本／渠道／HTTPS 地址／更新公钥 | 受控构建输入 `BEE_RELEASE_VERSION`、`BEE_RELEASE_CHANNEL`、`BEE_UPDATE_ENDPOINT`、`BEE_UPDATER_PUBLIC_KEY`；先确认公开资源，不允许前端改源 |
| 更新签名私钥 | 构建环境 Tauri 更新签名 secrets，仅在受控 CI 接入，不写仓库、不在聊天粘贴 |
| Developer ID／公证及 Authenticode | 相应原生签名任务的受控 secrets／证书存储；补签名、公证和票据验证输出 |
| 八组合原生桌面 | 对应真实系统和 CPU 的 runner／桌面会话；补普通用户安装、官方来源权限与升级记录 |
| 授权测试账号／流量 | 用户明确测试账号、工具／权限、允许贡献范围后操作；不索取密码或 token |
| 发布授权 | 候选资产和中文说明准备齐全后，按届时明确授权上传；本轮无上传授权 |
