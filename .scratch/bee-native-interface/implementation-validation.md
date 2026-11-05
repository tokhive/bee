# 原生自动服务实施验证

2026-11-05。基于 `260318b` 开始实施。此文件记录已执行证据，不用 mock 或受控替身代替生产 Hive、真实官方客户端及各系统原生验收。

## 01：零账号等待

- Go：零账号 Restore/Start 最终为 `local=waiting`、`run_id=null`，不创建平台 worker、不发布授权、不改暂停；已有 presence 继续维护设备连接。首次官方登录允许 waiting，但不自动接入。
- 保护：未决账号操作、脏会话、坏文件及不明 guard 均保留并阻断。账号文件读取失败仍记录独立 dirty guard，避免后续保存失败后错误恢复。
- 契约：Go→Rust→TS 共用现有快照字段，仅新增 `local=waiting`；Rust 等待原启动操作最终结果，并接受已确认的 waiting。诊断明确记录 `runtime_waiting`，不会误报运行成功或未知故障。
- 前端：waiting 显示正常等待和账号入口，去掉无效的开始贡献动作；首次登录仍检查来源、修订、实例与运行上下文。

已执行：

- `go test -race ./agent -run '^TestDesktop(AutoService|Presence|Runtime|Upgrade|Authorize|DeviceRecovery)' -count=1`：通过，22.935s。包含真实 WebSocket 受控 Hive、官方登录进程替身及故障注入。
- `go test -race ./agent -run '^TestDesktopDiagnostics' -count=1`：通过，2.302s。
- Rust `runtime_protocol::tests`：6 通过；`startup_restore`：4 通过；`diagnostics_native`：3 通过。侧进程使用测试替身，严格契约及操作归属为真实实现。
- TS runtime、accountPresentation、desktopStatus、diagnostics：71 通过；`npm run typecheck` 通过。
- Playwright waiting→账号页→首次 Claude 登录：1 通过（2.0s）。前端命令记录为 authorize_start=1、runtime_start=0、account_action=0。
- Ego 实际浏览器独立走查同一路径：正常等待与首次登录反馈可见；同样未发送启动/接入写请求。浏览器使用 native fixture，属于前端验证。

尚未执行：正式 WebView 经 Tauri/Go 到受控 Hive 的组合流程、生产 Hive、真实官方客户端、三系统托盘/窗口验收。最终组合流程纳入 11，其他真实环境限制在最终交付时保留。

## 02：接入后自动维护

已实现 waiting 下明确接入后的原生自动维护，账号 worker 完整发布并释放平台 gate 后再启动，不新增命令或 DTO。旧 stopped、失败状态、退出屏障及未决账号事务不会被自动升级。

7 项公开行为通过：首账号接入后自动维护且暂停；第二平台接入不重启运行/连接；每份授权响应返回前由 Hive 即时派流，真实 relay/CONNECT echo 成功；另一平台并发失败后首平台继续准备；接入中退出不复活；旧停止不自动升级；未知接入只核对原事务并保留错误；准备失败后无需重复接入，可明确重试原运行准备。其中时序证明与第二平台测试合并为一个用例。

`go test -race ./agent -run 'TestDesktop(AutoMaintenance|AutoService|Presence|Runtime|AccountSelection|AccountChange|Upgrade)' -count=1 -timeout=90s`：通过，20.388s。全量 TS 单元测试 315 通过；Rust `cargo test --lib`：268 通过、2 ignored（36.73s）；waiting UI 定向 Playwright 通过。这里的 Hive、官方源及转发目标均为受控替身，不是生产接单验收。

## 09：旧意图兼容决策

用户已明确同意：旧记录为“没在运行”的已接入账号升级后统一先暂停，自动维护登录，等待用户逐平台恢复。仅转换一次；不推断旧 false 的停止来源，不清理未决/归属/脏状态保护。待 03 完成后实施。

## 10：外部前置

仍未定义创建未知且未取得原 token 时的 Hive/人工恢复证据契约。当前保留 needs-info，不伪造恢复路径，不重放创建或采用任意 token。
