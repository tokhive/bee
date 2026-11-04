# Bee 设备在线与贡献分离实施计划

> 执行方式：使用 executing-plans；这些步骤共享连接生命周期，在当前会话顺序实现并验证。

**目标：** 已绑定 App 自动在线，贡献仍由原有明确授权控制。

**架构：** 复用 `/api/bee/connect` 与 `/api/bee/agent`，在 Go 中串行交接。原生启动核验通过后，以绑定及网络修订启用在线维持；退出、更新、恢复和网络切换先抑制再回收。

**技术栈：** 沿用 Go 1.27.3、coder/websocket 1.8.14、Tauri 2、React/TypeScript、Go race、Rust 与 Playwright，无新增依赖。

**完成状态：** 三个 Task 已完成。测试命令、原生 App 观察和验证限制见[验证报告](../reports/2026-11-03-desktop-device-connection-verification.md)。

## 全局约束

- 设计依据：`../specs/2026-11-03-desktop-device-connection-design.md`，用户已批准方案 A。
- 无账号也能在线；自动在线不得选择账号、上传/续期授权、解除暂停或写入贡献运行意图。
- 同一设备连接串行退出再启动；首次外部 409 不抢占，只有本实例同绑定的已成功连接可支持有限交接重试。
- 保留既有账号、恢复、退出和更新安全屏障；无 Hive 改动，不提交、不发布。

## Task 1：Go 在线维持与串行交接

文件：新建 `agent/desktop_presence.go`、`agent/desktop_presence_test.go`；修改 `agent/client.go`、`agent/desktop_runtime.go`、`agent/desktop_account_connection.go`、`agent/desktop_device_recovery.go`。

接口：`EnablePresence(context.Context, DesktopPresenceRequest) error`，参数 `binding_revision`、`network_revision`；仅原生核验流程调用。独立连接门保证完整回收；成功握手证据绑定当前身份，仅在主动取消的交接中传递。

- [x] 增加无账号在线、停止贡献后在线、退出不再连、临时账号交接、外部占用、旧绑定和旧网络拒绝测试；先运行确认失败。
- [x] 实现独立在线 worker、代次保护、连接门、受限交接所有权；接入开始、停止、账号、恢复、网络配置。
- [x] 运行 `go test -race ./agent -run 'Desktop(Presence|Runtime|Connection|Recovery|Account)' -count=1`，修复失败。

## Task 2：严格桥契约与原生自动启用

文件：`desktopbridge/runtime.go`、`desktopbridge/protocol.go`、`desktopbridge/server.go` 及测试；`desktop/src-tauri/src/{sidecar,experience,commands,protocol,runtime}.rs` 及测试。

- [x] 为 `runtime_enable_presence` 增加严格参数与返回值测试，拒绝未知/缺失/负修订；返回 `{enabled:true}`，作为可选能力，不暴露通用前端调用。
- [x] 启动核验和新绑定网络核验后启用；在原生设备状态读取中自动核对新绑定；网络成功应用后重新启用。退出冻结和启动屏障保持有效。
- [x] 运行 `go test ./desktopbridge` 与 `RUSTUP_TOOLCHAIN=1.94 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --tests --bins`（在 `desktop/` 下使用 Node 24）。裸 `cargo test --locked` 也已尝试，历史 `experience_probe` 示例因旧 API 编译失败；主程序、库和集成测试均通过，详见验证报告。

## Task 3：界面与最终验证

文件：`desktop/src/features/lifecycle/NativeRuntimeControls.tsx`、`desktop/src/i18n/en.ts`、`desktop/tests/native-runtime.spec.ts`、相关使用文档。

- [x] 增加“贡献未启动 / Hive 已连接”、空闲重连及拒绝详情的界面用例，确认旧界面失败。
- [x] 连接文案消费真实连接状态，停止时也显示失败详情，说明绑定后自动连接、贡献独立控制。
- [x] 执行 Go race/vet、Rust、TypeScript 和受影响 Playwright 测试，完成代码审查及一致性检查。
- [x] 构建并启动 Bee S1 Dev，验证真实已绑定且无账号状态下在线、贡献仍未启动；记录证据及限制，完成计划勾选。
