# S2 诊断、网络与日常桌面体验验收记录

日期：2026-10-28，更新：2026-10-29。范围：[S2 设计](../superpowers/specs/2026-10-26-desktop-diagnostics-experience-design.md)、[S2 计划](../superpowers/plans/2026-10-26-desktop-diagnostics-experience.md)。

## 当前结论

S2 普通偏好、系统适配器、只读诊断、安全日志、代理编排和四页界面已实现，真实 S1 接口已接入。**S2 尚未完整验收。** 系统通知允许回调异常／拒绝、可见投递和点击、安装路径及跨平台窗口矩阵仍缺实际证据；本轮主 App 诊断、导出、网络只读和偏好保存重开已有实际操作结果。浏览器替身、包构建和 Rust fake OS 测试不替代这些项目。

实施位于独立分支 `feat/bee-desktop-s2` 和工作树 `.worktrees/bee-desktop-s2`。T1 提交为 `95057e4`，诊断／网络 Go 基础为 `eee5a07`，后续 S2 原生适配与界面集成提交为 `bdfbb84`。共享命令、启动顺序和主页面需要同时编译，因此 T2–T5 本次合为一次集成提交。原 `bee-desktop-p0` 工作树仅作只读同步依据，其未提交修改不复制、不清理。先用契约替身推进，随后同步 S1 的 `09b8d8a`、`73f3c54`、`b4f9d8c`、`636daa4`；S2 分支对应提交为 `2651e73`、`7e66387`、`3b788ca`、`d9e9ca4`。S1 自身真实账号／Hive 闭环的未验项目沿用其[验收记录](account-runtime-validation.md)，不由 S2 模拟补齐。

## 2026-10-29 S1 集成及 UI 原生增补

通过真实 merge `3d908fc` 集成 S1 已提交源快照 `27f5360`，保留唯一公共壳和状态协调器；S1 后续未提交的轮询稳定性修复未复制或重写。本轮以诊断 C「问题优先」和设置 B「分类页签」完成整窗暖银白 UI，浏览器 87/87、Node 60/60、Rust 148 通过／2 ignored、Go 定向、typecheck／build 通过。详细命令、截图与证据见 [UI 验收记录](../superpowers/reports/2026-10-28-desktop-s2-ui-verification.md)。下文 2026-10-28 环境与自动验证表保留为历史证据，本节和 E1–E6 表反映增补后的当前边界。

原生主包为 S2 工作树的 `Bee S2 Dev.app`，对应实现 `3d908fc`，Bee `dev+3d908fc0f1d3-dirty`（dirty 为未提交文档）。本地 ad-hoc 重签后严格校验通过，最终包内 Bee SHA256 为 `a3bfa5a20d1bca5a2265e2db086e83119bad78357b088efa2249460e06cf6db0`；签名后只读协议 smoke 为 14 通过、1 项按 macOS UserConfigDir 限制跳过，未重定向 HOME。

- 从真实主窗口主动运行、取消并重新运行诊断，得到 16 项：2 fail／1 warning／3 pass／10 skipped，当前贡献未运行及 OpenAI 来源缺失如实显示。日志由明确刷新读取，没有自动诊断或启动贡献。
- “检查＋日志”导出首次受 macOS Downloads 目录确认阻塞，UI 按 30 秒显示未确认；允许目录访问后独立读回 7442 字节、16 checks／21 logs。先核对首文件，再明确导出仅检查，实际完成回执与 3675 字节、16 checks／0 logs 一致。原始证据在 `.cache/s2-native-ui/export-*.json`，两份实际报告保留 Downloads；目录访问与通知权限分别处理。
- 现有空代理配置的两官方只读端点返回 HTTP 401；临时回环 HTTP CONNECT 透传服务又实际转发三次 CONNECT，两个真实 HTTPS 端点经本机代理返回 HTTP 401。该工具不伪造应答，只允许固定两个目标；原生表单仅测试未保存草稿，保存／生效代理仍为空，未执行贡献重启，临时服务已关闭。[代理核对](../../.cache/s2-native-ui/network-proxy-verification.json)。
- 将语言／主题从 system／system 保存为 en／light，正常退出重开后仍显示 English／Light，随后恢复 system／system。主 App 只查询通知权限与自启登记，未再次申请、发送通知或改登记；主 App 与旧 probe 的 bundle ID 不同，不混用其权限结果。
- S1／S2 使用相同应用标识，等待另一会话结束且确认贡献未运行后，按正常退出／启动顺序轮换；结束时确认 S2 owned 主子进程消失，再恢复原 S1 包窗口。未改写原工作树或 S1 的现有包。

本轮覆盖主 App 的实际操作，未替代代理保存后真实停止／重启、官方授权与 Hive 完整闭环或通知可见性／点击及跨平台验收。

## 实现和边界

- S1 继续唯一负责 Start／Stop／ConfigureNetwork／Restore、账号选择、维护、换号与 owned 退出。S2 的网络控制器只编排这些接口，保持暂停和未决操作，不实现第二套恢复状态机。
- 启动先核验偏好、当前设备 scope 和已保存代理，再调用 S1 Restore。未完成该顺序时，前端写操作及后台通知受启动门禁约束。
- `desktop-preferences.json` 仅保存普通偏好及按 origin／device scope 隔离的代理；`notification-delivery.json` 独立记录 OS 投递结果。账本先持久化 attempted，再调用 OS；未知回执不盲重发。
- 后台通知从 S1 的固定问题事实读取持久去重／恢复语义；Rust 后台调度独立于 WebView。希望接收、系统允许、OS 接受分别核对，OS 接受不表示用户已读。
- 原生通知插件桌面端不能提供本设计要求的真实权限及提交确认，因此保留精确插件依赖，同时由 Rust 封装固定的 macOS UNUserNotificationCenter、Windows ToastNotifier 和 Linux DBus 适配。前端没有任意通知正文、Shell 或文件系统入口。
- doctor 只读共享会话、已选择来源及固定端点；不配对、不续期、不启动、不暂停。网络测试只证明可达性。专用代理只接受无认证回环 HTTP IP，环境代理与 NO_PROXY 策略保留，Hive 和官方客户端登录继续使用其原有网络环境。
- 日志采用固定字段／值白名单、每份 5 MiB、最多 3 份；报告总上限 5 MiB，并显式标注截断。原始 stderr 不进入公开错误状态、日志或导出；管理故障仍保留原失败检查、退出状态和 stderr 字节／截断统计。
- 四页由单一应用协调器共享观察。诊断和日志读取需要明确操作；切页不重复执行业务动作。导出先确认范围、再等匹配的真实下载回执，失败及未确认不会显示成功。

## 环境与构建

| 项目 | 本轮环境／产物 |
| --- | --- |
| 系统 | macOS 15.7.7（24G720），arm64 |
| 工具链 | Go 1.27.3、Rust/Cargo 1.94.0（本机命令用 `+1.94`）、Node 24.22.1 |
| 壳／页面 | Tauri 2.12.5、React 19.2.8、TS 7.0.2、Vite 8.2.4；原锁文件基础上固定 notification/autostart 2.7.0 |
| TEE | 固定 `a687f86d781e825c04c1d84d75b41bba5d862254` |
| 开发包 | `desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`；本地 debug/ad-hoc，未发布、未公证 |
| 已验证包内 Bee | `dev+bdfbb846d695-dirty`；源码实现提交 `bdfbb846d695d36c88d7b42d2a4f9b2d647ee44f`；签名后 SHA256 `b64e8f7309e0149b9732e34cd64d085bdd94f622e506f4a262baba69cb8d7cbd`。dirty 来自尚未提交的验收文档；包在该实现提交后重建 |
| 原生隔离探针 | 源码提交 `c1aa451`；独立 ID `dev.tokhive.bee.s2-probe`，只使用专用临时偏好／账本和合成报告；不创建 Bridge、不访问用户 Bee 配置或官方来源 |

## 自动验证证据

Go 源码在既有全量／race 结果之后未变，沿用相同源码结果；本轮新增 Rust／TS 修复分别补跑受影响验证。需要本机监听的 Go、Playwright 和 macOS 单实例 IPC 测试在沙箱外执行；沙箱的 EPERM 不作为通过证据。

| 检查 | 已取得结果及限制 |
| --- | --- |
| `go test ./...` | 本分支同一 Go 源码此前全量通过，agent 71.169 秒 |
| `go test -race ./agent ./desktopbridge` | 通过：agent 75.380 秒、desktopbridge 2.427 秒；[原始结果](evidence/2026-10-28-s2/go-race.log) |
| Rust `--lib --test network_contract` | 148 项库测试、27 项网络／偏好契约测试通过；2 项签名包专用测试单独执行 |
| Rust 签名包测试 `--lib -- --ignored` | 重建并签名后 2 项通过：包 seal／篡改拒绝及包内 Bee 握手／ping／回收；[结果](evidence/2026-10-28-s2/bundle-tests.log) |
| S2／runtime／authorize Node 测试 | 37 项通过：协调、偏好、诊断、代理、通知及 S1 typed clients；[结果](evidence/2026-10-28-s2/node.log) |
| `npm run test:bridge` | 11 项通过 |
| `npm run test:device` | Node 前置测试及 Playwright 53/53 通过；覆盖四页、日志、导出回执、通知失败重试、偏好迟到成功／失败、代理草稿、未知写保护，以及旧实例 account/runtime/Hive 成功和失败回包；[结果](evidence/2026-10-28-s2/device.log) |
| `npm run typecheck`、`npm run build` | 最终 TS 修复后通过；源码提交后重新生成开发包 |
| `tauri build --debug --bundles app` | 实现提交后本机开发包生成通过，ad-hoc 签名及 `codesign --verify --deep --strict` 通过；未启动带真实用户配置的主应用 |
| 包内真实 sidecar smoke | 14 项通过、1 项按 macOS 隔离限制显式跳过；[结果](evidence/2026-10-28-s2/sidecar-smoke.json) |

sidecar smoke 不重定向 HOME。macOS 的 Go UserConfigDir 不能通过 XDG_CONFIG_HOME 隔离，因此本机仅调用无设备读取的固定 envelope／内存快照和参数拒绝路径；不调用需要用户设备配置的 doctor／通知观察。Linux／Windows 分支支持临时 UserConfigDir，但本次未实际运行这两个分支。

已补红绿证据的集成问题包括：开发版本 `dev+12hex[-dirty]` 在 Rust／TS 导出元数据中被错误拒绝；原 stderr 尾部可能泄露秘密；初始偏好读取的迟到成功／失败覆盖新版保存结果；旧实例的成功回包刷新新实例；管理进程启动失败时本机安全日志整页隐藏。测试分别先观察到真实失败，再修复并重跑。账号测试最初的等待位置错误也已修正，随后观察到迟到成功导致额外读取的实际失败，再补归属检查。

## macOS 隔离探针实测

探针复用生产 preferences、autostart、notifications、diagnostic_log 模块，使用独立 bundle ID 与 `.cache/s2-experience-probe` 专用状态目录，不创建 Bridge、不读取设备／官方来源、不重定向 HOME。原始回执位于该目录各次 `state-runN/evidence.json`；下面结果来自 `state-run3`，前 26 条属于 PID 83047，同一目录保留证据后重启的通知提交属于 PID 47417。可共享的[原生回执](evidence/2026-10-28-s2/native-probe.json)替换了测试目录及 blob URL，省略重复报告正文；[实际保存的合成报告](evidence/2026-10-28-s2/native-synthetic-report.json)保持原文件字节。

- 偏好保存后用新 Store 回读一致，再恢复初始语言／主题；安全白名单日志实际写入三条，按 2＋1 分页。
- 真实自启登记 `false→true→false`，随后恢复初始 false；精确 probe plist 不存在，未操作 Bee 的启动项。
- 真实 WebView Blob 下载收到 `Finished=true`，独立读回 1237 字节且逐字节一致；取消路径返回 `Requested=false`、目标未生成，WebKit 未发送 Finished；只读 0500 测试目录的写入收到真实 `Finished=false`，目标不存在。先前目录目标导致无完成回调的失败尝试保留，不计通过。
- 用户明确选择允许通知，但该次申请回调返回 `UNErrorDomain code=1`（`NotificationsNotAllowed`）。因 enable 报错，probe 偏好仍 false，随后两次提交按钮没有调用 OS 投递，不能解释为系统隐藏横幅。用户再次点击只读查询后，**同一进程真实权限为 granted**；不把回调错误吞掉，也不将其归因为用户拒绝。回调与后续系统状态不一致的原因仍未确认。
- 保存原始回执并重启探针，以 `--notification-smoke` 先核对实际权限 granted，再启用专用测试偏好并仅提交一次固定通知。此模式代码不调用权限申请 API；若查询不是 granted 立即停止。seq29–31 取得实际 granted、保存 revision6 以及原生提交 `accepted/error=null`。横幅可见与点击尚未确认，不能据 accepted 勾为通过；未改生产权限逻辑以忽略此前 NSError。

上述下载使用探针限定目标 hook，不代表系统保存对话框测试；报告输入为合成白名单事实，不代替实际设备 doctor。OS 接受通知、可见横幅及用户点击分别记录，不能互相替代。

## E1–E6 验收状态

| 编号 | 已有证据 | 尚缺的真实环境证据 |
| --- | --- | --- |
| E1 四页及 Hive | 原生路由 fixture、共享观察、旧实例保护；本次真实 WebView 的诊断／设置页签及正常退出重开 | 安装路径中的实际 Hive 外部浏览器打开及其余窗口矩阵 |
| E2 真实诊断 | Go HTTP／TLS 替身账本覆盖只读、401/409/429、取消、超时；本次主 App 主动 doctor、取消／重跑及真实 16 项结果 | 隔离测试用户／授权测试设备下的离线、TLS／409、超时及服务端账本矩阵 |
| E3 日志与导出 | 私有文件、轮转、分页、秘密标记及 5 MiB 上限；探针取消／写失败；本次主 App 两种导出范围、首次未确认与后续真实成功、实际文件读回 | 主 App 安装路径取消／写失败及其余 E2 场景报告矩阵 |
| E4 代理 | CONNECT／TLS 替身账本、环境优先级和 NO_PROXY、S1 停止恢复契约；本次主 App 未保存草稿经真实本机透传代理访问官方端点，HTTP 401 | 获授权测试设备下的实际 WebView 保存／停止重启及原暂停保留流程 |
| E5 偏好与系统状态 | Rust 持久化／冲突、TS 迟到回包；探针自启启停；本次主 App en／light 保存、正常重开回读及恢复原值 | 主 App 跟随系统时改变 OS 外观／语言，以及安装路径自启 |
| E6 后台、通知、窗口 | 固定问题事实、后台 poll、持久去重、fake OS 权限／投递／恢复、原生单实例 IPC 与 owned 回收；macOS 实际权限 granted 及固定通知 OS accepted | 允许回调异常原因、拒绝路径、可见横幅／点击、关窗／托盘／Dock 找回，以及实际无托盘 Linux |

Windows／Linux 的交叉编译或 fake OS 测试不算该平台原生行为验收。S3 汇总安装路径及其余平台矩阵时可以复用仍有效的证据，不应重新实现 S2 功能。

## 可复现操作

从 S2 工作树使用 Node 24，构建 sidecar 后再运行 Cargo。每次新增源码提交后重新生成绑定当前 revision 的 sidecar provenance。

```sh
GOCACHE=/private/tmp/bee-desktop-s2-go-build RUSTUP_TOOLCHAIN=1.94 node desktop/scripts/build-bee.mjs
cargo +1.94 test --locked --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop run test:bridge
BEE_DEVICE_TEST_PORT=1425 npm --prefix desktop run test:device
npm --prefix desktop run build
RUSTUP_TOOLCHAIN=1.94 npm --prefix desktop run tauri -- build --debug --bundles app
```

`BEE_DEVICE_TEST_PORT` 仅供浏览器测试避让既有开发服务，默认 1421，不改变应用生产端口或网络配置。真实包只读协议检查：

```sh
node desktop/scripts/smoke-experience.mjs "$PWD/desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app/Contents/MacOS/bee" .cache/s2-bundle-experience-smoke
```

原生探针源码为 `desktop/src-tauri/examples/experience_probe.rs`，资源位于 `desktop/tests/fixtures/experience-probe`，构建命令为 `cargo +1.94 build --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --example experience_probe`。独立 app bundle 使用该目录的 Info.plist，签名 ID 必须为 `dev.tokhive.bee.s2-probe`；运行状态只能位于专用 cache／临时目录，不能用 HOME 重定向隔离用户配置。

探针路径隔离测试 3/3、JS 语法和实际构建通过；Clippy 对探针无新增警告（仅显式排除共享 `sidecar.rs` 原有 `too_many_arguments`），签名严格校验通过。`--smoke` 执行偏好／日志／自启／下载；`--notification-smoke` 仅在已有权限 granted 时提交一次，不申请权限。通知的可见性及点击仍须独立观察。

以下完整原生场景矩阵在隔离 OS 测试用户及授权测试设备中执行；本轮已取得的主 App 操作可直接复用，仍未覆盖的部分以上表为准：

1. 启动主应用，核对四页与 Hive 根入口；只配对测试 Hive，首次检测来源和开始贡献分别明确确认。
2. 从 WebView 运行 doctor，分别记录离线、TLS／409、身份拒绝、未选来源、取消和超时；核对服务端账本没有业务写入。
3. 启动本机 HTTP CONNECT 代理，记录官方／转发／Hive 三类请求；保存配置后确认 saved/effective 分离，再明确停止重启，核对原暂停及未决换号保持。
4. 从实际检查结果导出报告，独立打开文件确认可读、秘密标记缺失、成功／取消／写失败反馈与文件一致。
5. 切换语言／主题并重开主应用；跟随系统模式下改变系统外观，核对偏好保留。自启启停后检查精确系统登记，并恢复原状态。
6. 通知分别核对允许／拒绝／关闭、后台问题去重、恢复再出现及点击仅导航。关窗后通过托盘／Dock／任务栏／再次启动找回同一窗口；退出核对 owned 进程消失而外部 Bee 仍存活。Linux 另测无托盘找回，Windows／Linux 均须在真实 OS 记录行为结果。

本轮未新增账号授权或接入写入；只读 doctor 使用当前已选择来源，网络测试不携带账号授权。当前分支和工作树保留，不合回 S1、不推送、不发布。原 S2 功能计划未完成的原生项目继续保留未勾，其全 Plan 收尾须待所有 Task 完成；本次 UI 子计划的收尾单独记录。
