# AI 账号观察验收记录

日期：2026-10-26。环境为 macOS 15.7.7（24G720）arm64、Go 1.27.3、Node 24.22.1、Rust 1.94.0。使用已有 Node、Rust、TEE 和离线 Cargo 缓存，无新增依赖。

本记录覆盖[账号 plan](../../ai-accounts.md)的可执行只读批次。它不关闭完整 spec 的接入、运行同步、换号、移除、市场或系统通知依赖；A01–A12 的逐项覆盖和依赖见[使用指南](../../ai-accounts.md)。没有修改 Hive、读取真实官方凭证、调用真实暂停／恢复或启动贡献。

## 源码与验证范围

Task 1–5 检查点依次为 `1892985`、`06b5c54`、`98d403c`、`f9807ca`、`56b79ca`。Task 6 修复了完整路径审查发现的辅助版本读取问题（FIFO／符号链接及后代管道）；最终源码由本目录随附的 Git 提交确定，不用文档中的旧 hash 冒充最终包版本。包内来源以构建目录中的 `.source.json` 为准，构建时校验当前 HEAD、目标、TEE、工具链及 SHA256。

以下结果来自本轮实际执行。回归使用合成凭证、注入 transport、本地 HTTP／Unix 服务或原生 IPC fixture；不会检测用户真实官方登录。早期红灯及中途缺陷已修复，绿色结果仅按各轮实际覆盖范围记录。

| 检查 | 命令／结果 |
| --- | --- |
| Go 全量与静态检查 | `go test ./...`、`go vet ./...` 在 FIFO 修复后通过（agent 54.273s）；随后版本管道窄修补官方／版本／缓存 race 和 agent vet，通过（2.555s） |
| 账号／设备／供给／桥竞态 | `go test -race ./agent ./desktopbridge ./cmd/bee -run 'TestDesktopAccounts\|TestDesktop(Device\|Supply)\|TestAccount\|TestRunWithAccounts' -count=1` 通过，三个包退出 0（cmd/bee 无匹配测试） |
| TS 与两种构建 | `npm --prefix desktop run typecheck`、`build`、`build:demo` 通过；原生包 beforeBuild 再执行普通生产构建 |
| 原生 fixture | `npm --prefix desktop run test:device`：17 项 Node 测试、23 项 Chromium 页面测试通过 |
| 既有桥 | `npm --prefix desktop run test:bridge`：10 项通过 |
| 构建工具 | `npm --prefix desktop run test:tooling`：37 项通过 |
| 既有 demo 页面 | `npm --prefix desktop run test:e2e -- --workers=4`：Chromium／Firefox／WebKit 合计 507 项通过 |
| Rust | `cargo fmt --check`；`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml`：56 项通过，2 项签名包专项默认 ignored，须打包后单独执行 |

Rust 使用 worktree 内 `.cache/cargo-home`，Go 构建复用 `.cache/go-build`，不修改系统 HOME／CODEX_HOME。本地监听被沙箱拒绝的测试通过受审执行权限运行，不将 EPERM 当作业务失败。三端交叉编译及模拟测试不能替代 Windows／Linux 原生验收。

## 界面与契约证据

新增原生页面覆盖首次加载不 detect、点击读取、默认 null 命名空间、自定义来源、权限错误、迟到结果失效、Hive 独立失败、设备 503 时仍可检测、scope 缺失、到期前 30 秒失效、120%／null、专属窗、历史数据与 Hive 当前限流、英文暗色、860×600、Tab／Escape／焦点返回，以及共享供给、全部操作部分失败和未决账号禁恢复。

下列截图来自本轮原生 IPC **fixture 的浏览器页面**，只证明布局／交互，不是 WKWebView、真实账号或真实 Hive 的验收。截图为 full-page：窗口高 600 时内容允许滚动。

- [中文浅色，860 像素宽](accounts-zh-860.png)
- [英文暗色](accounts-en-dark.png)

Go 真实 sidecar 的 defaults 和两平台 snapshot(false) 也已用前端实际 `decodeAccountDefaults`／`decodeAccountReply` 解码，覆盖 RFC3339Nano 时间、null、严格字段和实例一致性。此冒烟不 detect、不 refresh Hive、不建账号文件。

## 审查与修复

逐任务审查和最终 `affected-path-review` 分别执行；最终审查以 `cdf987c` 到当前增量为范围，沿 source → Go 读取／缓存／Hive → 私有桥 → Rust → TS → 页面／供给 sink 检查，并追踪未修改的调用方和辅助函数。具体发现、修复及复测见[审查记录](review.md)。

重要修复包括：源读回失败不能冒充 source_changed；Hive pending 必须进入共享恢复门禁；设备状态失败不能遮盖本地检测；Rust 15 秒须包含排队，已发超时须先撤销 ready，并拒绝迟到成功和后续排队写；未知套餐公开为 null；各观察子域分别展示失败；历史额度过期不覆盖 Hive 当前限流。

## 本机包与未验收项

包路径为 `desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`。仅构建本机 arm64 debug／ad-hoc 开发包，不公证、不发布。构建与签名包专项的执行结果另记于[包验证记录](package-validation.md)。

自动包内冒烟固定为 hello → defaults → 两平台 snapshot(false) → ping → shutdown，只访问本次创建的管理子进程。它不打开 GUI、不读取设备配置或真实官方凭证、不联网，也不替用户点击检测。

本轮未验收：新账号页的 macOS 原生 GUI／Keychain 权限、真实两平台账号与联网查询、Windows／Linux 原生来源／界面／签名。旧供给页已知的真实网络 409／EOF／TLS 问题没有因本批自动测试关闭。没有把旧原生截图或旧包当作本批证据。

保留当前分支和 worktree。下一项为运行管理 spec 及事实调查；新 spec、plan 和执行模式仍须按当前约定审阅，不使用已撤销的旧自动确认授权。
