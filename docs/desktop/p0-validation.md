# P0 桌面底座验证记录

日期：2026-10-23 更新。状态：**P0 未通过。Mac 原生窗口、860×600、管理桥、退出、系统回跳、真实第二实例与 DMG 复制安装已有证据，Chrome E2E 6/6；Windows 原生固定 TEE 已通过，受保护文件操作已取得行为 RED、正在实现；Linux arm64 Go vet/全量测试/构建通过。托盘和完整三端桌面/干净安装矩阵仍缺。** 用户已授权自动继续，重要方案变更集中确认。

## 来源和隔离

- 原 Bee 检出：`/Users/dayong/myspace/mywork/tokenhive/bee`，`main`，起点 `0fea1c71a1181b9b0257a5b0e15721f74d2395f0`；实施前工作树干净。
- 隔离检出：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`，分支 `feat/bee-desktop-p0`。原生 worktree 工具因工作区顶层不是 Git 仓库失败，随后使用 Git 创建此检出。
- Hive 的既存 ` M bee` 子模块修改保留，未暂存或提交；原 Bee 主分支未改源码。任务 1/2/4/5/6 的桌面、平台适配及 CI 改动尚未提交，任务 3 已单独提交。
- 已阅读工作区的计划评审、技术设计、技术/需求决策记录、布局、UI 核对、固定视觉基线及 P0/P1 计划。三份视觉资产和指定 SVG 品牌源哈希均与 manifest 一致。
- 任务 3 已单独提交为 `f4374af`：`feat(bee): add private desktop management protocol`。任务 1/2 的未完成工作仍留在原实施检出中，未推送或修改 Hive 子模块。

## 当前实现

已建立 React/TS/Vite 验证页、Tauri 配置/入口、最小权限及导航白名单、Playwright 验收用例、Node 环境检查、固定 TEE 准备、五目标 sidecar 构建准备和品牌图标。验证页始终明确“尚未开始贡献”。任务 4 已接入真实管理状态/版本与存活检查；普通浏览器明确 NATIVE_UNAVAILABLE，不模拟就绪。构建目标和管理进程返回的系统分开显示。

原生导航仅允许本地 bundle 来源，调试构建另外允许 `http://127.0.0.1:1420`；新窗口请求拒绝。导航函数及 Tauri 回调已通过完整原生编译，导航行为有 2 项测试；2026-10-23 已在实际窗口验证冷/后台系统协议回跳。未开放 Shell、凭证文件或远程页面能力。

Tauri 2.12.5、tauri-build 2.7.4、npm API/CLI 2.12.4 和 Rust 1.94.0 已写入配置；Cargo.lock 已由 Cargo 生成，当前 macOS arm64 的完整 Rust 编译/测试和 App 打包通过，2026-10-23 原生窗口运行及部分交互自动验收通过。与批准栈的唯一前端版本调整为 Vite 8.2.2 → 8.2.4 安全兼容补丁：官方 npm 审计列出 8.2.0–8.2.3 的多项公告，其中 GHSA-587h-7wmj-h5pm 为 high；8.2.4 安装审计为 0 漏洞。架构、框架类别、通信、权限、资金规则和平台目标均沿用设计。

文件保护实现已拆出带 `darwin || linux` 编译约束的 Unix 文件，私有读取验证已打开句柄的普通文件、权限和当前用户所有权；官方来源使用 no-follow 打开，但不强制它们具有 Bee 私有配置的 0600 权限。锁回调可重复调用而不会释放后来的新锁，私有替换拒绝链接和非普通文件；刷新及 egress 复用此边界。Windows ACL 测试已写，尚无原生红灯及运行证据，Windows 生产实现未添加，不能勾选任务 2 完成。

新增 `bee desktop`、独立 `desktopbridge` 协议包和[协议说明](bridge-protocol.md)。仅有 hello/ping/shutdown，输入输出帧均限制 1 MiB；未知字段、重复 JSON 字段、未完成 ID 重用及错误版本均拒绝。管理入口不进入账号、配置或贡献路径；CLI 与握手共享构建版本。通用 Run 的调用方负责解除阻塞 I/O；命令入口管理自有管道，Unix 使用非阻塞副本注册 runtime poller。原生退出测试确实发现并修复了直接关闭继承 stdin 不能唤醒读取的问题。

## 已运行证据（任务 1–3 的历史结果）

以下保留各阶段原始结果；任务 4 的新版本、包和测试见后面的追加记录，不用旧产物哈希代表当前包。

环境：macOS 15.7.7 arm64，macOS SDK 14.4，Git 2.39.3。Node 24.22.1 使用检出内的本地缓存，Go 自动工具链为 1.27.3，Rust/Cargo 使用已安装名称 `1.94`，实际版本均为 1.94.0。未修改系统默认工具链。

| 检查 | 实际结果 |
| --- | --- |
| 缺少工程时运行 P0 页面验收命令 | 退出 254，`desktop/package.json` ENOENT，确认初始工程不存在；不是页面行为测试通过 |
| `preflight.mjs` | 当前 macOS arm64 全部检查通过；同时拒绝旧 Node/Go、缺失工具、未批准目标及低于 13 的 macOS/SDK |
| `node --test desktop/tests/tooling.test.mjs`（Node 24） | 9 项通过；包含临时 Git 归档、长文件名、export-ignore、缓存篡改保留、symlink 缓存拒绝、错误 revision 和构建目标不匹配 |
| 真实 `prepare-tee.mjs` | 固定 revision `a687f86d781e825c04c1d84d75b41bba5d862254` 导出成功；归档 SHA256 `4bc9caad3ad2ce5de01b9983a750cee6380098fc308333c30c098fbf8e7bad38` |
| 随后运行原 `bash scripts/prepare-tee.sh` | 退出 0；Node 导出缓存与原脚本的完整归档和标记一致 |
| `go test ./... -count=1` | agent、beewire、logx、relay、telemetry 全部通过，cmd/bee 编译成功（该包无测试）；仅为当前 OS 的既有代码基线 |
| Node 24 下 `npm ci --offline --cache .cache/npm --audit=false` | 退出 0；安装锁文件中的依赖。npm 提示可选 fsevents 安装脚本尚未批准，未扩大脚本权限 |
| Node 24 下 `npm run typecheck` / `npm run build`（desktop） | 均退出 0，Vite 8.2.4 构建成功 |
| Tauri CLI `icon` | 退出 0；保留批准 PNG 源、来源清单和所需 PNG/ICNS/ICO，不纳入无关移动端生成物 |
| `rustc +1.94 --test .../navigation.rs` 后执行测试 | 2 项通过：生产 bundle 白名单、开发精确 origin 限制；不是完整 Cargo/Tauri 测试 |
| `cargo +1.94 fmt ... -- --check` | 退出 0；只证明 Rust 格式检查通过 |
| Cargo 离线生成锁文件 | 退出 0，锁定 406 个 registry 包；来源保留官方 crates.io，锁文件未手填 |
| 406 个锁定 crate 的 SHA256 | 全部与 Cargo.lock 一致；72 个复用已有官方缓存，其余从 `static.crates.io` 下载 |
| `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml`（使用下述本地源缓存） | 退出 0；完整 Tauri 依赖和工程编译成功，2 项导航测试通过，main/doc-test 无测试；不等于原生窗口通过 |
| `node desktop/scripts/build-bee.mjs --target aarch64-apple-darwin` | 退出 0，真实固定 TEE 依赖参与编译，生成 arm64 Bee 和来源元数据；执行该二进制 `version` 返回 `bee dev+0fea1c71a118-dirty darwin/arm64` |
| `tauri build --debug --bundles app --ci -- --locked --offline` | 退出 0，生成本机 arm64 的 `Bee Dev.app`；CLI 版本兼容检查通过；App 尚未集成 Bee，未打包 sidecar |
| 带 `APPLE_SIGNING_IDENTITY=-` 的同一打包命令 | 退出 0，完成本地 ad-hoc 签名；`codesign --verify --deep --strict --verbose=2` 退出 0。没有 Developer ID 签名或公证 |
| 任务 2 新增行为测试的初次运行 | 明确复现私有写入/refresh 替换 symlink、旧 unlock 回调释放新锁的问题；随后修复并转绿 |
| `go test ./agent -run 'Test.*(PrivateFile\|StateLock\|Codex\|ClaudeStore\|ClaudeFile\|ClaudeRefreshSaves\|EgressConfiguration)' -count=1` | 当前 Mac 退出 0，33.206s；含真正第二进程锁竞争、持锁进程退出后重获、权限、链接、替换失败保留旧文件；不外推 Windows |
| 任务 2 后 `go vet ./...` / `go test ./... -count=1` | 均退出 0；完整 agent 回归 53.952s |
| 任务 3 初次协议/命令测试 | 协议占位实现返回未实现、命令入口报 unknown command；之后实现并转绿。另有真实子进程红灯发现空闲 stdin 取消后不退出，已修复 |
| `go test -race ./desktopbridge ./cmd/bee -count=1 -timeout=60s`（最终新增断管回归后） | 退出 0，1.455s / 8.870s；含父 EOF、shutdown、输入空闲/输出堵塞时中断、输出断管且输入保持打开时退出、流所有权和短写错误 |
| 任务 3 代码审查 | 两处 Important 问题均先加红灯回归再修复：JSON 转义后输出超过上限、未知字段错误丢失原 ID；只读复核无剩余 Critical/Important。原生 broken pipe 独立复验通过 |
| 任务 3 最终完整 Go 回归 | `go vet ./...`、协议修复后的 scoped vet 及最终 `go test ./... -count=1` 退出 0；最终 agent 57.194s、cmd/bee 3.263s、desktopbridge 3.803s；随后 `go run ./cmd/bee version` / `help` 退出 0，帮助含机器入口 |
| 新 Bee 原生构建及实际二进制管道冒烟 | 真实固定 TEE 构建退出 0；3 个关联响应 hello/ping/shutdown，实例一致，stderr 0 字节，进程退出 0；未通过 App 调用 |
| 独立协议包 Windows amd64 交叉编译 | 完整官方 Go 工具链下 `go test -c ./desktopbridge` 退出 0；只证明该包可编译，未执行 Windows 测试，整个 Bee 的 Windows 适配仍未完成 |
| 整个 Bee Linux amd64 交叉构建尝试 | 固定 TEE 的 Linux 文件需要本机原缓存缺失的 cloudwatchlogs/configfs-tsm/eventstream；前两者已从官方 Go proxy 获取并由 go.sum 校验，最后 eventstream 下载遇到 DNS 失败，构建未完成。未改依赖版本或校验，不能说 Linux 编译/运行通过 |

真实 TEE 归档约 153 MB。首次通过 spawnSync stdout 读取触发 ENOBUFS；已改为让 Git 直接输出归档文件，随后真实导出及原 shell 缓存比对通过。没有修改固定依赖、禁用校验或用测试仓库替代真实依赖验证。

## 本轮依赖恢复与开发包

直接 Cargo 联网仍然失败。已用允许的 `curl -L` 从官方 `index.crates.io` 下载索引、从 `static.crates.io` 下载锁定包，再由 Cargo 使用标准 local-registry 源替换离线解析、验证和编译。复用的已有 crate 缓存也逐一按锁文件 SHA256 校验。源缓存、索引下载辅助文件和本机 Cargo 配置只在忽略的 `.cache/` 内，不作为工程依赖或 CI 前置条件提交。锁文件仍引用官方 crates.io，不引用本机绝对路径。

最初在包尚未全部下载完成时启动 Cargo，`window-vibrancy` 校验失败；随后确认 406 个包全部下载并通过 SHA256，再执行完整测试成功。没有关闭 checksum 校验或修改上游源码。

第一次打包未指定签名身份，App 只有链接器签名，`codesign` 报 `code has no resources but signature indicates they must be present`。指定 `APPLE_SIGNING_IDENTITY=-` 正常重新打包后，完整 App 校验通过；未关闭 Gatekeeper 或修改系统安全设置。

开发包位于 `desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`。Info.plist 的标识为 `dev.tokhive.bee`，最低系统为 13.0；两个生成的可执行文件均由 `file` 确认为 Mach-O arm64。这些只证明本机开发包构建与签名完整性，不证明在 macOS 13 上运行通过。

- 已签名 App 主程序 SHA256：`b974481506e2a28f4ffd6608a1540766180fa9eb16a7c6ab340d5e53d532fd99`。
- Cargo.lock SHA256：`0403e918bd4973db01da94bef10f32847d5b54a23405cf96a17f5fe245504c66`。
- 任务 1 时单独构建 Bee 的 SHA256：`f0d9f7f95f42f3c30c27bf7be2bbbc1e2abaefe613fea7f9243709a24951fde2`，是任务 2/3 修改前的旧产物。
- 任务 3 最新单独构建 Bee 的 SHA256：`6fa57cdec6f6bf704396db4b73aa348abbf0f6e23091c54ad5357297c50f94d3`。`.cache/qa/desktop-protocol-smoke.json` 保存本机实际 3 个响应及退出元数据；缓存不提交。版本仍为 `dev+0fea1c71a118-dirty`，未伪装正式版本。旧 App 未重新打包，尚未包含管理桥或此 Bee。

本机原自动下载 Go 模块工具链缺少 Windows 标准库源码，首次交叉构建失败不能归因于项目。已下载官方完整 `go1.27.3.darwin-arm64.tar.gz`，SHA256 `dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2` 与官方发布清单一致，解压到 `.cache/toolchains/`。随后对修改前项目源码复现了 `agent/state.go` 的 Flock/LOCK_*、codex/claude_store 的 O_NOFOLLOW 在 Windows 不存在；该编译失败不充当 Windows ACL 行为红灯。固定 TEE 的整个 Windows 构建及真实官方登录来源检测仍未验证。

## 阻塞和未验证项

1. 直接 `cargo generate-lockfile` 仍退出 101：`Could not resolve host: index.crates.io`。**依赖阻塞已通过上述官方缓存方式解除，锁文件、完整 Cargo 测试和本机 App 打包已完成。** CI 的正常联网流程不依赖此本机缓存。
2. Playwright 通过真实配置启动 Vite 时退出 1：`listen EPERM: operation not permitted 127.0.0.1:1420`。因此 P0 页面断言未执行、浏览器截图未生成；没有把 typecheck/build 或初始 ENOENT 当作 E2E 通过。
3. 已签名 App 在当前执行环境中直接启动退出 1，stdout/stderr 均为空。读取该进程的系统日志退出 64：`log: Cannot run while sandboxed`，无法进一步确认运行失败点。不能直接归因为应用错误或仅归因为沙箱；已请用户在系统桌面实际打开开发包，结果待补。
4. `ego-browser` 启动失败，报告 `Connection Invalid error for service com.apple.hiservices-xpcservice` / `Failed to start ego lite`；备用 UI 工具读取 Chrome 超时。因此尚无页面断言或视觉截图证据。`.cache/qa/p0-preview.html` 只是从构建资产生成的离线预览，未冒充浏览器验收通过。
5. 没有 Windows/Ubuntu 或 macOS x64 的原生运行证据；Windows 受保护文件生产实现及原生测试未完成。私有 Go 管道和 Rust 管理桥在当前 Mac 已验证；原生窗口、账号来源、托盘/单实例/回跳和三端安装包仍未验证。

下载能力存在工具差异：标准 npm 元数据查询、Cargo、Node 内的 Git clone 受 DNS 限制；已获准的 curl、npm install、git fetch 命令可取得部分资源。本轮用它们正常取得 Node/前端依赖和固定 Git revision，未通过放宽沙箱来运行 Cargo 或监听本地端口。Node 官方下载 SHA256 为 `89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7`。

| 原生验收环境 | 窗口/托盘/管道/退出/安装 |
| --- | --- |
| macOS 13+ arm64（当前机器为 15.7.7） | 完整编译、Rust 测试、App 打包及 ad-hoc 签名校验通过；Go 管道/退出及 Unix 文件保护测试通过；签名包内 Bee 的 Rust 握手/ping/回收已验证；图形窗口及其余未验证 |
| macOS 13+ x64 | 未验证 |
| Windows 10 22H2 x64 | 未验证 |
| Windows 11 x64 | 未验证 |
| Ubuntu 22.04 x64 / arm64 | 两种架构均未验证 |
| Ubuntu 24.04 x64 / arm64 | 两种架构均未验证 |

## 任务 4：Tauri 私有管理桥（当前追加）

已实现 Rust 分帧、固定 sidecar 路径、构建来源校验、版本/系统/能力握手、只读 ping 命令、状态事件、超时失效及 owned child 回收。前端不能提供路径、额外参数或 shell；有界队列序列化并发请求，ID/instance 必须匹配。1 MiB 帧限制覆盖分段 UTF-8、EOF 和异常后不可恢复的会话。

构建流程先执行实际 Bee 的 version，记录 SHA256，再由 Rust build.rs 核对 target、当前 Git revision、固定 TEE revision、Go 1.27.3 和实际字节。MACOSX_DEPLOYMENT_TARGET 固定 13.0，脚本读取实际 Mach-O minos 复核。先前 Bee minos 实为 14.4，已由新增失败测试和原生产物检查发现并修正；这不等于已在 macOS 13 运行。

macOS 重签名会改变 sidecar 字节。本轮先复现原始哈希检查错误拒绝正常签名包，再沿用批准的同包签名边界：构建时核对原始 SHA256，运行 `.app` 时用系统 codesign 验证完整包的 seal，随后仍严格核对 Go 握手；开发目录继续精确 SHA256 检查。签名完整性与篡改拒绝有独立复制包测试；ad-hoc 不冒充生产身份认证。

Rust 的错误会立刻撤销 ready 和版本元数据，停止后等待本实例真正回收；2 秒 EOF 宽限后只 kill/wait owned Child。stderr 持续读取，最多保留 4 KiB 当前无凭证管理模式的诊断尾部，终态错误保留原始原因、实际退出状态、总字节数和截断情况。

任务内只读审查发现两处 Important，均先红灯复现再修复：退出码/诊断被丢弃；故障事件之后迟到的 ping 成功重新显示“响应正常”。前者现保留 exit=9/E42，后者通过可测试的状态观察器和世代检查失效旧结果；新终态会清理旧前端错误，使补充证据可见。最终复核无剩余 Critical/Important，不等于全 P0 或全分支审查完成。

| 当前检查（macOS 15.7.7 arm64） | 结果 |
| --- | --- |
| Rust 新行为初次运行 | 管道 supervisor 未实现时 4 项失败；版本/分帧、来源、方法白名单、超时状态、签名及诊断均有先红灯再转绿证据 |
| 最终 `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml -- --include-ignored --nocapture` | **24 项通过，0 失败，0 忽略，32.23s**；包含两项打包后的原生测试 |
| 包内真实 Bee 管道测试 | 签名完整性检查后从 `.app/Contents/MacOS/bee` 固定路径完成 hello、ping、stop/reap；不使用 PATH Bee，不打开 GUI |
| 签名包篡改测试 | 复制真实 App 后改写 Bee，签名验证拒绝并保留改写文件；原 App 不改动 |
| owned child 回收 | stubborn 子进程在 EOF 宽限后被回收；两个并发 stop 均等待结束；另行启动的外部 Node 仍存活 |
| 诊断与状态交错 | exit=9/E42 保留；1 MiB stderr 完整消费、仅留 4 KiB；失败立即撤销 ready；旧 ping 不覆盖新故障，延迟订阅和销毁清理正确 |
| `npm --prefix desktop run test:tooling` | **12 项通过**；含版本/目标/SHA256 和 macOS 实际最低系统检查 |
| `npm --prefix desktop run test:bridge` | **7 项通过**；其中 4 项为异步状态交错/清理回归，不依赖浏览器服务 |
| 最终 Tauri debug App 打包 | beforeBuild 的 typecheck/Vite build 通过；App 54.12 MiB，打包退出 0；ad-hoc 签名完整性校验退出 0 |
| 实际包内 Bee 的 `otool -l` | `minos 13.0`、SDK 14.4；只证明产物标记，不证明 macOS 13 实机通过 |
| Cargo 格式检查及工作树 diff 检查 | 均退出 0；不将格式检查替代行为测试 |
| `test:e2e -- tests/bridge.spec.ts` | Vite `listen EPERM 127.0.0.1:1420`，页面断言未执行，仍未通过 |

当前构建 Bee 版本为 `dev+f4374af17a6c-dirty`，来源 revision 为 `f4374af17a6c380f4ff779fe43f30f9dcc1b334a`，TEE revision 不变。任务 1/2/4 仍有未提交改动，不冒充正式发行版本。以下为任务 4 当时产物（任务 5 更新另见后文）：

- 原始 Bee SHA256：`becce5c05bca9d41b99f2ee4f12ab3ca2d3c619a4e88dc6c7df7413601ac782a`。
- 签名包内 Bee SHA256：`f34969cfe6cf849a75cbf8a73a78f73ce1851e271ff9ea9071ac228b4a617738`。
- 签名 App 主程序 SHA256：`f29d8b5f39c2b27978409664b3846d87b3ae7bcaf1c7e36acc3ac7fd3fe68274`。
- 当前 Cargo.lock SHA256：`d7667d6b176ba0cfa6fcf0a46805c9443cdf7222a6c257c6553852e1c3a6aa55`，409 个 registry 包；新增 Tokio process/macros 所需三包沿用官方缓存和索引并校验。

本轮 Cargo 重新解析时曾带入无关更新，已用 Cargo 精确降回原有锁定版本；未手改锁文件或缓存源码。GUI 启动曾异常退出 -6 且 stdout/stderr 为空，先前任务 1 的旧包则退出 1；无法读取系统日志的限制保留，未将失败直接归因于代码或沙箱。最终包尚无图形验收证据。

## 任务 5：生命周期及原生投递（实施中）

已加入原生菜单与托盘“打开 Bee/退出”、系统标题栏关窗隐藏、重复启动/macOS Dock 找回、开发协议回跳 boolean 提示。没有引入开机启动或真实登录，前端始终保留“尚未开始贡献”，不接收 URL、code/state。签名 App 的 Info.plist 已实际查到 `tokhive-bee-dev` 协议注册。

本轮采用官方 single-instance 2.5.4 源码副本（SHA256 与许可证保留），修补范围和来源见 `desktop/src-tauri/vendor/tauri-plugin-single-instance/BEE-PATCH.md`。官方实现暴露 macOS 异步绑定失败继续启动、Windows 消息窗口尚未出现时继续启动、Linux 无有效 D-Bus 时继续启动的路径，不满足 Bee 的唯一管理进程要求。任务内独立审查确认三项 Important，含原生入口早于 owned Child 回收而释放；现均已修补，只读复核未发现剩余阻塞问题。此结论是源码层面复核，不替代三端原生正向运行。

macOS 已补私有 OS 文件锁串行化选主、同步注册、注册错误停止启动、bounded 转发及接收确认。文件锁独占/释放、symlink 与公开权限拒绝、真实插件注册失败路径均有 RED→GREEN。另加入真实 Go 管理进程收到 hello 后杀死 Node 父进程的检查，验证 stdin EOF 随父死亡关闭后管理进程自行结束；该行为本来已由 Go 任务实现，本轮补充的是父进程被杀的集成证据。

中间检查：Rust 32 项（含签名包）全过、TS 桥及回跳收据 10 项全过、工具 12 项、生产构建/开发 App 重打包/签名完整性与协议注册通过。这些在审查修补之前执行，最终数量与产物将在修补验证后追加；不将它们作为修补后的通过证明。原生窗口、托盘、正向单实例/回跳投递均未验证，Unix socket bind 环境探测也被拒绝，`PermissionError(1, Operation not permitted)`。

### 修补后的最终本机证据

Windows 已存在 mutex 时有界等待 HWND；NULL handle、转发失败及接收未确认均阻止 setup，handle/userdata 释放保持单一归属。4 项纯策略测试先红后绿；Win32 adapter 未在 Windows 编译或运行。Linux session builder/注册/转发失败停止 setup；实际 Linux adapter 与 zbus 在 Mac MockRuntime 下通过两种失败地址的隔离子进程回归，不能据此宣称 Linux 原生通过。

Mac/Linux 主实例持有生命周期文件锁，listener/bus 失效不会放行第二个管理父进程；Mac 另有启动注册锁。两端临时路径均包含 UID，避免不同 OS 用户争用。Linux 在 lease 成功后才发布 callback。三端移除插件自动 Exit 清理，由 App 先 stop/reap owned Child，再显式释放入口；真实 stubborn child 测试先复现入口释放时仍为 Ready，再修为 Stopped。

| 最终本机检查（macOS 15.7.7 arm64） | 实际结果及边界 |
| --- | --- |
| `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml -- --include-ignored --nocapture` | **40 项通过，0 失败，0 忽略，32.56s**；含两项签名 App 检查、真实父死亡 EOF、回收先于单实例释放、注册失败和跨平台策略/失败适配器测试 |
| `npm --prefix desktop run test:bridge` / `test:tooling` | **10 项 / 12 项通过**；未启动浏览器或原生窗口 |
| 最新 Tauri debug App 打包 | typecheck/Vite build 和打包退出 0，**58,269,228 字节（55.57 MiB）**；含最新生命周期与单实例修补 |
| `codesign --verify --deep --strict --verbose=2` | 退出 0，包 seal 有效；仅 ad-hoc，未公证 |
| Info.plist | 最低系统 `13.0`，实际注册 `tokhive-bee-dev`；未外推为 macOS 13 实机运行 |
| `cargo fmt -- --check` | 退出 0；格式不代替行为验证 |
| 444 个 registry crate 归档 | SHA256 均与 Cargo.lock 一致，未缺包或关闭校验；本地缓存不提交 |
| 任务 5 修补复核 | 原三项 Important 和 Minor 在源码层面闭合；未发现新增阻塞问题；不是全分支审查 |
| 页面 E2E / 原生 GUI | **未通过验收**；未重试已知受限的监听/窗口操作，原缺口保留 |

最新产物以本段为准，Bee 来源仍为 `f4374af17a6c380f4ff779fe43f30f9dcc1b334a`，版本 `dev+f4374af17a6c-dirty`，固定 TEE revision 未变。原始 Bee 未重建、Go 生产代码本轮未改，因此沿用已通过的 Go 完整/race/vet 结果，不重复扩跑。

- 签名 App 主程序 SHA256：`b6b4fb0866f99e37745295487e85cc6b4e8e7284eac2368482f694ee940adda1`。
- 签名包内 Bee SHA256：`f34969cfe6cf849a75cbf8a73a78f73ce1851e271ff9ea9071ac228b4a617738`。
- 原始 Bee SHA256：`becce5c05bca9d41b99f2ee4f12ab3ca2d3c619a4e88dc6c7df7413601ac782a`。
- Cargo.lock SHA256：`bcfd2758f56c8ef395f2e1255ba3bd17f7090a37062c32c083551793d1dea63a`。

## 任务 6：原生 CI 配置已准备，执行未验证

新增 `.github/workflows/desktop.yml` 和 `desktop/scripts/ci-native-evidence.mjs`。工作流仅手动触发，八行明确自托管环境覆盖五 target 和批准的系统基线；真实 OS/CPU、Rust host、Go host/build 必须相符。完整 runner 标签、依赖及逐项安装验收见 [desktop/README.md](../../desktop/README.md#三端-ci-与验收记录)。本轮没有配置 runner、触发 Actions、推送、提交或发布。

工作流串行执行固定 TEE、Go vet/test、npm ci/typecheck/build/tooling/bridge、Playwright、原生 sidecar、locked Rust tests、开发安装包构建；macOS 打包后另跑已有两项签名 App 检查。失败不吞掉，只在前置成功后上传测试包，失败日志始终上传；记录来源及包 hash，不做生产签名、公证或更新发布。

本机 Ruby/Psych 解析、Bash/JS 语法与错误 host 拒绝烟测通过；任务范围只读复核未发现配置级阻塞问题。2026-10-23 已补 actionlint 1.7.12 + ShellCheck 0.11.0，退出 0；未完成远程 Actions/服务端运行验证。**八行均未运行，无 run URL、DMG/NSIS/AppImage 交付或干净用户验收证据**。不能把配置、artifact 上传或绿色构建等同于托盘、关窗找回、回跳、安装和 GUI 通过。

## 继续位置

任务 1 的当前 Mac 原生窗口和本机 Chrome E2E 缺口已补，锁定 Chromium 默认运行及任务 1 整体验收/提交仍待收束。任务 2 Windows 安全行为红灯及生产实现、任务 5 托盘/实际 GUI 重复实例/三端原生矩阵、任务 6 安装与八行 runner 仍需推进。P1 继续遵守“P0 任务 1 后可开始页面”的原条件；不扩大为必须等待全部 P0。任务 1/2/4/5/6 尚未提交；用户自动继续授权有效，不以协议 ready 冒充可贡献。


## 2026-10-23：解除旧限制后的自动验收

本节覆盖前文 10 月 22 日的“当前窗口/E2E 未验收”状态，保留原失败记录作为历史。现有生产代码和开发包没有改动；增加任务 5 的一个集成测试，以及显式使用本机 Chrome 的 Playwright 配置；后者纳入 TS 类型检查，默认配置和 CI 保持原锁定浏览器。

| 证据层次 | 本次实际结果 |
| --- | --- |
| 原生 WebView | CUA 读取真实 `tauri://localhost`；正确 Logo、系统、真实版本；冷启动从 starting 到 ready，实际点击 ping 后显示“管理进程响应正常” |
| 最小窗口 | CUA 实际拖到逻辑 860×600（Retina 截图 1720×1200），回跳后点击 ping 成功，文字与操作可达 |
| 关窗与菜单找回 | 已执行原生关闭按钮，再从 App 菜单“打开 Bee”找回；原 App/owned Bee PID 12508/12538 保持。AX 观察可能包含隐藏窗口，未据 AX 树单独断言隐藏可见性；系统日志有 prevented close 及 order window 辅助证据 |
| 菜单退出与拥有权 | App 菜单退出后 PID 12508/12538 均消失；独立启动的外部 Bee PID 23100 仍真实 ping 成功，随后由夹具 shutdown 正常退出 0。早先控制夹具超时也已清理，22617/22628 均不存在；不是应用失败 |
| 后台系统回跳 | Safari 向已运行 App 投递普通测试参数；确认页面只显示“已收到登录返回”，仍未贡献，App/owned Bee 仍为 25143/25179 |
| 冷启动系统回跳 | 菜单退出并确认 25143/25179 消失后，再经 Safari 系统协议启动；观察前先确认新 App/owned Bee 34970/35004 存在，页面显示收到及 ready。Safari 本次允许打开 Bee，没有开启“始终允许”；测试标签页已关闭 |
| 浏览器 E2E | Playwright 1.63.0 + 已安装 Google Chrome 156.0.8078.48，临时配置首次 6/6 通过（10.5s），落盘仓库配置后再次 6/6 通过（5.3s），均退出 0；含真实普通浏览器 NATIVE_UNAVAILABLE、Tauri 替身成功/故障及两类 boolean 回跳呈现。替身不代表原生运行 |
| Ego 普通浏览器 | 复用任务空间 15 打开实际 Vite，点击重新检查后仍明确 NATIVE_UNAVAILABLE。已 finish 任务空间，并仅退出本测试启动的 Vite（130） |
| 真实 Unix IPC + MockRuntime | 新增测试主代理独立运行 1/1 通过、4.09s、40 filtered；实际 vendor 插件、Unix socket/ACK、文件锁、4 个隔离进程，第二实例在 setup 前退出，同 identifier 退出后重新注册。MockRuntime 不创建真实 WebView 或 Go child |
| 新增测试后的 Rust 完整回归 | `cargo test --offline --locked --manifest-path desktop/src-tauri/Cargo.toml -- --include-ignored --nocapture`，**41/41 通过、0 失败、0 忽略，4.22s**；含两个签名包检查。没有把 Mac 上的 Win/Linux策略测试当作对应原生平台运行 |
| TS 类型检查 | 新增 Chrome 配置纳入 `playwright*.config.ts`，`npm --prefix desktop run typecheck` 退出 0 |
| 任务内审查 | 新增 IPC 测试无 Critical/Important；Minor 为父测试断言触发 Drop 时不保留 child 输出，报告已收窄诊断承诺，留待改进。此审查不扩大为全分支完成审查 |
| 当前包完整性 | App/Bee SHA256 与 10 月 22 日最终产物一致，`codesign --verify --deep --strict --verbose=2` 再次退出 0；没有为测试源码变更重打包生产 App |

页面补充验证命令：

```sh
npm --prefix desktop run test:e2e -- --config playwright.chrome.config.ts --reporter=line
```

首次使用忽略目录下的临时配置（10.5s）。随后新增仓库内 `desktop/playwright.chrome.config.ts`，只扩展原配置的 `use.channel=chrome`，同一组断言再次通过（5.3s）；未修改测试断言、默认配置或生产配置，普通 typecheck 同时校验两个配置。默认锁定浏览器的第一次尝试 6 项均因缺少 `chromium_headless_shell-1243` 而在页面断言前失败；不能和本次已安装 Chrome 6/6 混算。官方 Chromium 153.0.8010.12（revision 1243）下载曾持续推进至约 70%（约 132 MiB）；本机 Chrome 已提供完整可复现验收入口，随后明确取消本轮安装（130），不留下长期下载进程。默认锁定浏览器命令仍未完成，不将取消记作应用测试失败，也未更改默认/CI 浏览器版本。

新增定向 IPC 命令：

```sh
RUSTUP_TOOLCHAIN=1.94 CARGO_HOME=$PWD/.cache/cargo-home cargo test --offline --locked --manifest-path desktop/src-tauri/Cargo.toml singleton_tests::macos_ipc::primary_accepts_forwarding_and_reacquires_after_exit -- --exact --nocapture
```

新增测试定向 1/1 后，主代理执行完整 `--include-ignored --nocapture` 回归，实际 41/41、0 忽略通过（4.22s）；10 月 22 日 40/40 保留为历史结果。真实 GUI 截图与 Bee AX 收据见 [本机证据目录](evidence/2026-10-23-mac-native/README.md)。

昨日 crash report 显示 `_RegisterApplication` → `NSApplication sharedApplication` → Tao event loop 初始化发生 abort，进入项目 setup 之前；不足以单独确定根因。当前同包已成功运行，不继续把昨日失败归为当前沙箱限制。原生工具访问 SystemUIServer 托盘表面超时，托盘未验收；App 菜单结果不能代替它。GitHub runner 清单只读请求返回 HTTP 403（缺少 runner 读取权限），不能据此断言仓库没有 runner；没有修改授权、配置或触发远程运行。Docker 当前提供 linux/aarch64，但官方 `golang:1.27.3` 拉取在 5 分 9 秒调查期限内未完成，日志只显示已解析七层，没有字节进度；仅结束本任务 pull 客户端，最终镜像不存在，未创建容器，Linux Go 测试均未执行。不能把调查超时解释为平台不支持或应用测试失败。原始材料在 `.cache/qa/linux-go/`，完整报告在 `.superpowers/sdd/linux-go-native-container-report.md`；容器 Go 测试也不能替代 Ubuntu 桌面 GUI 或安装矩阵。


### 本轮配置与资源收束

新增的 Chrome 配置与 TS include 已通过实际 6/6 页面测试和类型检查。完整 Rust 41/41 后未修改 Rust 代码，`cargo fmt -- --check` 退出 0。CI 已用官方 actionlint 1.7.12（发行包与官方 SHA256 一致）及现有 ShellCheck 0.11.0 校验，主代理独立复验也退出 0，无诊断：

```sh
.cache/toolchains/actionlint/1.7.12/actionlint -no-color -pyflakes= -shellcheck=/opt/homebrew/bin/shellcheck .github/workflows/desktop.yml
```

未安装 pyflakes，显式关闭此可选集成；当前 workflow 无 Python run 步骤。不将静态检查当作八行 CI 已运行。完整报告见 `.superpowers/sdd/task-6-actionlint-report.md`；下载和命令记录在 `.cache/qa/actionlint/`。本轮没有全局安装、改系统代理/安全设置、提交/推送或触发远程工作流。

## 2026-10-23：原生验证新增结果与任务 1 收束

- Windows Node/Git/真实固定 TEE 已在 Server 2022 x64 原生通过，run 39896456139、源码 e4b0df8；tooling 29 PASS/3 POSIX SKIP/0 FAIL，真实 TEE 3/3。首轮 run 39895713224 的 CRLF 失败保留为历史；单次 Git 命令固定 LF 后复验成功，未改系统配置或原归档 SHA。任务 1 Windows 准备脚本证据缺口已闭合。
- Windows 安全操作原生 run 39896456172 已实际执行后因 fail-closed stubs 失败；这是有效行为 RED，最终实现与 GREEN 尚待完成，不能将交叉构建成功当作安全通过。
- Linux arm64 Go 原生容器验证完成：23 个聚焦测试通过、1 个 macOS Keychain 专项跳过；vet、全量 7 包测试、CLI build 退出 0。Oracle Linux 9.4/glibc 2.34/UID 1000/CGO=0，535 个文件前后 hash 一致。它不能替代 Ubuntu 桌面或其它架构。
- Mac 真实 GUI 第二实例启动退出 0，原 App/owned Bee PID 不变、15 次采样无额外管理 child；DMG 校验、只读挂载、复制至用户 Applications 含空格路径、签名校验、实际握手/ping 和菜单退出均通过。复制安装不是 Finder 拖动；当前开发账户不能冒充干净用户、最低 OS 或托盘验收。
- 此次工程提交包括已审查的任务 4/5 集成代码和锁文件，不宣称任务 4/5/6 全部平台验收闭合。完整 CI 配置准备与后续真实八环境验收仍分开记录。

证据：[Windows/Linux](evidence/2026-10-23-native-ci/README.md)、[Mac DMG/第二实例](evidence/2026-10-23-mac-dmg/README.md)。此前旧沙箱和下载失败记录是历史，不再作为当前阻塞。默认 Chromium 下载继续进行，本机 Chrome 已通过的入口保持可用。
