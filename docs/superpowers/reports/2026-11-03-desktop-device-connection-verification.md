# Bee 设备在线与贡献分离验证报告

日期：2026-11-03。工作区：`.worktrees/bee-desktop-p0`。用户已批准方案 A，接受启停贡献及临时账号操作时短暂重连。

## 实现结果

已绑定的 App 在原生核验设备和生效网络配置后，自动通过 `/api/bee/connect` 保持在线。开始贡献或执行需要租约的账号动作时，先回收在线连接，再使用 `/api/bee/agent`；停止贡献或临时动作结束后恢复在线。退出和更新关闭连接并禁止再连。

自动在线不选择账号、不同步贡献授权、不解除平台暂停、不生成贡献恢复意图。连接占用和身份拒绝保持具体失败事实；只有本实例主动关闭的同一绑定成功连接可以提供短期、一次性的交接重试证据。Hive 源码、接口和依赖未修改。

## 原生 App 实测

重建内置 Bee 后，构建并签名 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`。完全退出旧 App，再启动新包；通过原生辅助功能树及截图观察到：

- Hive 为 `https://dev.tokhive.ai`，设备已绑定。
- 同时显示“贡献未启动”和“Hive 已连接”。
- AI 账号显示“0 个已接入”，“开始贡献”不可用。
- 页面说明为“设备绑定后自动连接 Hive；是否贡献由你控制。”

该观察来自真实原生 App，不是前端预览或测试夹具。没有接入真实 AI 账号、开始贡献或恢复平台接单。App 保持打开供用户检查。

## 自动验证

以下日志位于工作区 `.cache/`，属于本地验证产物。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| `go vet ./...` 和 `go test -race -timeout=600s ./...` | 退出码 0，7 个包全部通过 | `presence-go-final.log` |
| Go 在线、贡献交接、账号临时连接及旧 worker 回收 | 通过 | `presence-go-test.log`、`presence-go-joined.log` |
| 断线后身份撤销、跨绑定交接拒绝 | 通过 | `presence-go-revocation.log` |
| 拒绝同修订冲突代理时不改变已发布状态 | 通过；也纳入最终全量 Go 测试 | `presence-network-regression.log` |
| `go test ./desktopbridge` | 通过，严格参数及成功回执契约已覆盖 | `presence-bridge.log` |
| Rust `--lib --tests --bins` | 库 235 通过、2 忽略；网络契约 62 通过；二进制 0 测试，退出码 0 | `presence-rust-tested.log` |
| 原生命令权限范围测试 | 通过，内部在线启用入口未暴露给通用前端调用 | `presence-native-contract.log` |
| TypeScript `npm run typecheck` | 通过 | `presence-typecheck.log` |
| Playwright 运行、设备、恢复用例 | 81 通过 | `presence-e2e-final.log` |
| 内置 Bee 与原生 App 构建 | 成功 | `presence-sidecar-final.log`、`presence-app-final.log` |
| `codesign --verify --deep --strict`、`git diff --check` | 通过 | 命令退出码 0 |

Rust 命令在 `desktop/` 中执行，PATH 使用项目缓存的 Node 24：

```sh
PATH="$PWD/../.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH" \
RUSTUP_TOOLCHAIN=1.94 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --tests --bins
```

Playwright 命令：

```sh
npm run test:e2e -- --config playwright.device.config.ts \
  tests/native-runtime.spec.ts tests/device.spec.ts tests/device-recovery.spec.ts \
  --output ../.cache/presence-e2e-final --reporter=line
```

界面新增的 4 个空闲连接状态用例在旧界面失败，见 `presence-ui-red.log`；最终全部通过。原生新绑定测试最初因缺少入口无法编译，见 `presence-rust-red.log`，最终对应测试通过。

## 审查与修复

代码审查后修复了新代理配置下开始贡献会丢失后续在线启用、启动恢复失败被当作永久退出、在线启用引用未经核验的新上下文，以及早期失败丢失旧 worker 回收证明等问题。同时覆盖用户停止期间退出不得再次连接、拒绝冲突网络配置不得更改运行快照。最终审查未留下 Important/Critical 问题，相关回归与最终全量测试通过。

## 验证边界

- 裸 `cargo test --locked` 未通过：历史 `examples/experience_probe.rs` 使用旧 API，涉及 `crate::lifecycle`、`BridgeError.details`、`DiagnosticReport.binding_revision` 及通知适配器构造参数。见 `presence-rust-final.log`。上述成功范围明确限定为库、集成测试、二进制及实际 App 构建。
- 未直接打开 Hive 网页核验其在线标签；真实证据为 Bee 在 dev Hive 上成功连接后显示的运行快照。Hive 页面更新时序不在本次实测结论中。
- 真实账号贡献、外部 replace、断网、退出并发和短暂重连通过本地 HTTP/WebSocket、Rust 与界面测试覆盖；没有对用户线上账号执行这些破坏性操作。Windows/Linux 原生运行未实测。

## 一致性清单

- ✅ 会话：保持用户已批准的方案 A；未恢复方案 B；接受短暂重连，无 Hive 变更。
- ✅ 纵向：本次设计、计划、报告内部一致，连接与贡献术语分离。
- ✅ 横向：实现对应三个 Task；Go/Rust 的修订字段、可选能力、成功回执和停止原因一致；原生命令及全部调用点已同步。
- ✅ 配置：没有新增依赖、环境变量或配置模板要求；现有绑定和网络核验仍生效。
- ✅ 文档：README 与旧账号设计的替代说明已更新；报告明确测试和实际运行的不同证明范围。
- ✅ 交付：未创建 PR 或提交；保留工作区既有改动，最终说明与本次实际范围一致。

结论：实现与已批准设计一致。已记录历史示例编译问题和未做的线上/跨平台实测，不把这些范围计为通过。

计划核对：共 10 项，收尾前 0 项已勾选，本次根据实现及验证证据勾选 10 项，剩余 0 项。
