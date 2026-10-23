# Bee 桌面客户端

当前 **P0 未通过，P1 Task1 页面壳已完成**。当前 Mac arm64 已自动验证原生窗口、860×600 操作、握手/ping、菜单退出、owned child 回收、冷启动/后台回跳、真实第二实例和 DMG 复制安装；新银白五页壳、连接抽屉和焦点恢复也有实窗证据。Windows 安全专项/vet 已通过，全量 Go 回归仍有 1 项 Claude 上报测试待修；托盘及完整三端安装矩阵仍缺。P1 业务处于明确标识的演示模式，不连接 Hive、不控制真实贡献、不操作真实资金。

## 页面验收入口

从 Bee 仓库根执行 `npm --prefix desktop run dev:demo`，打开 `http://127.0.0.1:1420` 查看五页演示。普通 `npm --prefix desktop run dev` 显示业务未接通；开发/e2e 的 `?p0=1` 才进入原 P0 验证页。首次引导、账号、收益、诊断和设置功能按 P1 后续任务逐项补齐。

默认锁定 Chromium 已完整安装。P1 Task1 金额、导航与 P0 三组页面用例共 **20/20 通过**，typecheck、普通 build 和 build:demo 均通过；金额修补已独立复核。Mac 原生五页证据对应 `845af2b`，后续金额修补 `35873d5` 的证据为浏览器测试与构建，不混用包版本。

```sh
npm --prefix desktop run test:e2e -- tests/amount-display.spec.ts tests/navigation.spec.ts tests/p0-shell.spec.ts tests/bridge.spec.ts tests/lifecycle.spec.ts
```

## 直接验收 P0 开发页

当前 Mac arm64 开发包位于：

```text
/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app
```

在 Finder 双击，或在系统终端执行：

```sh
open "/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app"
```

1. 本节是 P0 开发页的验收步骤；当前 App 已使用五页演示壳，P0 页通过上述开发入口验收。窗口应有指定 Logo、Bee 标题和“尚未开始贡献”；缩到 860×600 后操作和文字仍可见。
2. 管理进程应从启动中变为“管理协议已就绪”，显示内置 Bee 的真实版本及系统；点击“检查存活”后显示“管理进程响应正常”。这只代表管理管道可用。
3. 检查失败应显示具体错误码和证据，保留“重新检查”；不会自动开始贡献或模拟成功。失败的管理进程不会自动重启，修复安装内容后须重新打开 App。
4. 关闭主窗口后，从菜单栏/托盘的“打开 Bee”或 macOS Dock 找回；窗口和原有管理进程应保留。再用 `open -n` 打开同一个 App，应找回原窗口，活动监视器中不应多出第二个 App 管理进程。
5. 首次打开 App 后，执行 `open 'tokhive-bee-dev://login?code=p0-check&state=p0-check'` 验证后台回跳；退出 App 后再执行一次验证冷启动。页面只应显示“已收到登录返回”，仍为“尚未开始贡献”，不显示 code/state 或“已登录”。这只是投递验证。
6. 从菜单栏/托盘选择“退出”：App 创建的管理子进程应退出，独立启动的 Bee CLI 不应被结束。反复执行关闭、找回、明确退出，检查无管理进程残留。

如原生单实例注册失败，App 应报告具体启动错误并停止，不应继续创建第二个管理进程。上述预期中，当前 Mac 窗口、存活检查、菜单找回/退出、外部 Bee 保留和两类系统回跳已有自动操作证据；真实第二实例已验证仅保留一个 owned Bee；托盘仍未验收。

本机开发包使用 ad-hoc 签名，未做 Developer ID 签名或公证。2026-10-23 解除旧执行限制后，当前包已成功启动并通过上述 Mac 自动操作；昨日启动异常不再是当前阻塞。查看[原生截图与 AX 证据](../docs/desktop/evidence/2026-10-23-mac-native/README.md)及 [P0 验证记录](../docs/desktop/p0-validation.md)。另见 [DMG 与真实第二实例证据](../docs/desktop/evidence/2026-10-23-mac-dmg/README.md)和 [Windows/Linux 原生测试证据](../docs/desktop/evidence/2026-10-23-native-ci/README.md)。P1 Task1 已完成；另见[Mac 新壳实窗证据](../docs/desktop/evidence/2026-10-23-mac-p1-845af2b/README.md)。

## 可重复的开发检查

要求 Node 24.22.1、Go 1.27.3、Rust 1.94.0、Git 及对应系统原生构建依赖。从 Bee 仓库根执行：

```sh
node desktop/scripts/preflight.mjs
node desktop/scripts/prepare-tee.mjs
npm --prefix desktop ci
npm --prefix desktop run test:tooling
npm --prefix desktop run test:bridge
npm --prefix desktop run build
node desktop/scripts/build-bee.mjs
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop exec -- playwright install chromium
npm --prefix desktop run test:e2e -- tests/p0-shell.spec.ts tests/bridge.spec.ts tests/lifecycle.spec.ts
npm --prefix desktop run tauri -- dev
```

必须先构建 native Bee 再运行 Cargo；构建元数据和二进制不匹配会直接失败。工具行为测试共 32 项，TS 桥、状态交错与回跳提示测试共 10 项。Playwright 只用 Tauri 调用替身验收页面故障呈现，真实管理桥由 Rust 测试调用实际 Bee 验证。

已安装官方 Google Chrome 时，可显式使用本机浏览器执行同一组测试；不会修改默认配置或 CI：

```sh
npm --prefix desktop run test:e2e -- --config playwright.chrome.config.ts --reporter=line
```

2026-10-23 此命令 **6/6 通过（5.3s）**，Chrome 实际版本为 156.0.8078.48，配置已纳入 `typecheck`。

Vite 限定 `127.0.0.1:1420`。普通浏览器明确显示 `NATIVE_UNAVAILABLE`，不会伪造握手成功。2026-10-23 已成功监听并用上面的本机 Chrome 配置执行全部 6 项 E2E；锁定 Playwright Chromium 的默认命令现已通过，P0 6 项及 P1 Task1 共 20 项均已验证。缺少浏览器或服务启动失败不算断言通过。

本机隔离工具链和官方离线缓存的复现环境为：

```sh
export PATH="$PWD/.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.94
export CARGO_HOME="$PWD/.cache/cargo-home"
cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml
APPLE_SIGNING_IDENTITY=- npm --prefix desktop run tauri -- build --debug --bundles app --ci -- --locked --offline
cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml -- --include-ignored
codesign --verify --deep --strict --verbose=2 "desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app"
```

最后一组 Cargo 命令包含两项要求已有签名 App 的测试：对完整包验证签名及篡改拒绝，从包内固定路径启动真实 Bee 完成握手/ping/回收。它们无须打开 WebView，不能证明图形窗口可用。正常联网开发与 CI 不依赖本机缓存；本机锁定官方 crate 归档已逐一校验，缓存和机器路径不提交。

## 构建与权限边界

Tauri 2.12.5、tauri-build 2.7.4、npm API/CLI 2.12.4、React 19.2.8、TypeScript 7.0.2、Playwright 1.63.0 均已锁定。Vite 使用已批准的安全兼容补丁 8.2.4。Logo 源与来源哈希保存在 `src-tauri/icons/source.json`；CI 仅读取 Bee 内资产。

`prepare-tee.mjs` 校验固定 `TEE_REVISION` 及 Git 归档，缓存不匹配时保留并失败。Node 与 shell 准备入口均以单次 Git 配置禁止自动 CRLF 转换并固定 LF，保持原始归档字节和 SHA256，不修改仓库或全局 Git 配置。它先完整解析并验证归档，POSIX 保留符号链接；Windows 将链接归一化为同一归档内最终普通文件的内容副本，因此无需创建符号链接的权限，不承诺别名写入语义。绝对路径、路径逃逸、缺失/循环目标以及目录或特殊目标均被拒绝，取内容不跟随已有缓存或外部文件系统。原始 `.archive-sha256` 保持不变，副本位置及最终目标均参与严格缓存比对。Mac 上已验证确定性的 `win32` 分支及真实固定依赖；Windows 原生 CI 首轮暴露 CRLF 问题，修复后 [run 39896456139](https://github.com/wangdayong228/bee/actions/runs/39896456139) 已通过：tooling 29 通过、3 项 POSIX 专属跳过，真实固定 TEE 3/3。此结果不代表 Windows Go 安全操作或 GUI 通过。

`build-bee.mjs --target <Rust triple>` 只接受批准的五个原生目标，核验 Rust host、Go 版本、实际 Bee 版本及 OS/架构，再记录源码 revision、TEE revision 和 SHA256。macOS 显式使用 13.0 deployment target，并读取实际 Mach-O 最低系统标记确认，未外推为已在 macOS 13 运行。

Rust 构建时再次核对来源和原始二进制 SHA256；运行签名 `.app` 时检查整个包的签名 seal，再核对 Bee 的版本/系统/能力握手，因为重签名会改变 Mach-O 字节。未签名的开发目录保持精确 SHA256 校验；ad-hoc 完整性校验不等于生产发布身份认证。

内置 Bee 总是从 App 可执行文件同目录启动，不查找 PATH。前端只有管理状态查询、ping 和 boolean 回跳收据；没有 Shell、凭证文件或任意路径权限。stdout 仅协议，stderr 持续消费并最多保留 4 KiB 当前无凭证管理模式的诊断，失败时附实际退出状态。停止只关闭本次管道、回收本次 Child，不按名字查杀其他 Bee。帧格式见[管理协议说明](../docs/desktop/bridge-protocol.md)。

## 单实例与回跳边界

单实例检测先于主窗口和 Go 管理进程创建。当前使用官方 single-instance 2.5.4 的本地源码副本，来源、许可证及修补范围见 [BEE-PATCH.md](src-tauri/vendor/tauri-plugin-single-instance/BEE-PATCH.md)；注册失败必须停止启动。主实例明确退出时先等待 owned Child 回收，再释放系统入口。

开发协议为 `tokhive-bee-dev`，应用标识为 `dev.tokhive.bee`。系统安装包注册协议，运行时从原生事件即时提取 boolean，不注册会缓存/广播完整 URL 的 deep-link 插件；前端不接收 URL、code/state。开机启动尚未启用，默认关闭。此 P0 行为只适用于未开始贡献的管理模式。

## 三端 CI 与验收记录

[桌面测试包工作流](../.github/workflows/desktop.yml)仅支持手动 `workflow_dispatch`，默认运行全部八行，也可选五个 Rust target 之一。Windows/Linux 单选仍包含两个系统基线。当前仅完成配置和静态检查，**尚未配置或运行这些 runner，八行均未验证**。

| 原生环境 | 自托管 runner 自定义标签 | 测试包 |
| --- | --- | --- |
| macOS 13.x arm64 | `bee-aarch64-apple-darwin-minimum` | DMG |
| macOS 13.x Intel x64 | `bee-x86_64-apple-darwin-minimum` | DMG |
| Windows 10 22H2 x64，build 19045 | `bee-x86_64-pc-windows-msvc-minimum` | NSIS EXE |
| Windows 11 x64 | `bee-x86_64-pc-windows-msvc-current` | NSIS EXE |
| Ubuntu 22.04 x64 | `bee-x86_64-unknown-linux-gnu-minimum` | AppImage |
| Ubuntu 24.04 x64 | `bee-x86_64-unknown-linux-gnu-current` | AppImage |
| Ubuntu 22.04 arm64 | `bee-aarch64-unknown-linux-gnu-minimum` | AppImage |
| Ubuntu 24.04 arm64 | `bee-aarch64-unknown-linux-gnu-current` | AppImage |

每行还需 `self-hosted` 标签，并预装上文工具链和原生依赖；Windows 需 Git Bash、x64 MSVC/SDK 与 WebView2，Ubuntu 需 WebKitGTK 4.1、GTK3、AppIndicator、librsvg 及 AppImage/Chromium 运行依赖，macOS 需 Xcode/Command Line Tools 和 DMG 工具。工作流不自动安装系统依赖。辅助脚本核对真实 OS/CPU、Rust host、Go host/target；不能用交叉编译或 Rosetta 替代。macOS 13 runner 是否能满足所需 SDK/工具链也须实际验证。

工作流依次执行固定 TEE、Go vet/test、前端构建和测试、Playwright、真实 sidecar、Rust 测试、开发安装包构建；失败停止并保留日志。包 artifact 仅在前置步骤成功后上传，名称含 target、基线及源码 SHA；`bee-checks-*` 中记录版本、实际环境、日志和安装包 SHA256。只上传测试产物，不发布 Release，不做生产签名、公证或更新发布。

CI 在 macOS 打包后另执行两项签名 App 检查（`signed -- --ignored`），验证包完整性/篡改拒绝及包内 Bee 管道；这两项无须打开窗口。绿色构建和浏览器替身测试仍需补充干净用户环境的原生验收：无 Go/Rust/Node、macOS 拖入 Applications 后启动、Windows 含空格安装路径，以及 Linux WebKitGTK/FUSE/无托盘找回。每行记录系统/工具版本、来源、包 hash、安装/启动/握手/托盘/关窗找回/回跳/退出实际结果和证据位置；未运行写“未验证”。当前完整进度见 [P0 验证记录](../docs/desktop/p0-validation.md)。
