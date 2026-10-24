# 桌面真实状态与暂停恢复实施计划

> 使用 subagent-driven-development 逐任务实施及复核；用户已要求后续自动确认和继续，无需重复申请实施批准。

**目标：** 不改 Hive，使用已绑定设备核验两个平台的真实状态，并明确设置暂停／恢复且回读确认。

**架构：** 现有 Go 设备服务扩展两个供给方法，私有桥及 Rust 增加 typed 命令，React 概览展示真实平台卡。

**技术栈：** 沿用 spec 的 Go 1.27.3、Tauri 2.12.5/Rust 1.94、React 19.2.8、TS 7.0.2、Vite 8.2.4，无新增依赖或权限。

## 全局约束

不改 Hive 源码、数据库或子模块；不覆盖 CLI 或既有桌面绑定；秘密只在 Go；不启动贡献、不接入账号或资金、不实现自动回跳或任务后退出；不对真实 Hive 自动发送暂停／恢复；失败不冒充成功，不自动重试 PUT；未验收系统保留缺口。沿用 `.worktrees/bee-desktop-p0` 与 `feat/bee-desktop-p0`。

## Task 1: Go 真实供给服务

文件：新 `agent/desktop_supply.go`、`agent/desktop_supply_test.go`；按需从 `agent/desktop_device.go` 抽出纯身份校验供旧新路径共用，保留原配对行为。

接口：`(*DesktopDevice).SupplyStatus(context.Context,string)(DesktopSupply,error)`、`SetPaused(context.Context,string,bool)(DesktopSupply,error)`；结构字段精确为 `hive/device_id/platform/paused/ready/reasons/checked_at`。`paused/ready` 均 bool，`reasons` 非 null 字符串数组，`checked_at` UTC RFC3339 时间。平台只允许 openai/claude。

- [x] 写并运行风险矩阵红灯测试：身份和撤销、原配置字节保护、真实 GET/PUT URL/Header/body、两平台隔离、显式 false、所有响应 schema/不变量拒绝、写响应丢失及回读失败或相反值均不重试 PUT。
- [x] 在固定配置锁和 12 秒 context 内完成绑定/身份校验；GET 读取，PUT 校验后 GET 回读。响应错误带 HTTP/检查项等证据，不回显未知数据或秘密。不保存供给控制到本地或重放写操作。
- [x] 运行 `go test -race ./agent -run 'TestDesktop(Device|Supply)' -count=1` 通过，自检并提交本任务；写实现/测试报告后做任务级复核。

## Task 2: 白名单桥与 Rust 命令

文件：`desktopbridge/{protocol,server}.go` 及新 `supply_test.go`；`desktop/src-tauri/src/{commands,lib,protocol,sidecar,sidecar_tests}.rs`、相关测试和 `desktop/tests/fixtures/bridge-child.mjs`。

接口：保持 Devices 和 RunWithDevices 兼容；通过可选 `Supplies` 接口检测 Task 1 两个方法。新增 method/command 为 `supply_status` 和 `supply_set_paused`，成功 `result.supply`，业务失败 `result.error`（`SUPPLY_OPERATION_FAILED`）。六项能力顺序为 ping,shutdown,device_status,device_begin,supply_status,supply_set_paused，Rust 也保留精确原两组。

- [x] 红灯覆盖 platform 缺失/null/路径串入、paused false/missing/null/string、未知/重复参数、业务失败后 ping；Rust 用真实 fixture 验证六项握手及固定 method/params。
- [x] Go 和 Rust 仅允许平台枚举和显式 bool，Rust 命令不接受任意 method、配置/命令/URL/身份参数。沿用 15 秒请求期限、队列超时与 fail-closed 来源/实例规则，不扩大 generic bridge_request。
- [x] 运行 `go test ./desktopbridge ./cmd/bee`；正确本机环境下重建 native Bee，运行 `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml`（签名包专项留收尾），自检、提交并任务级复核。

## Task 3: 概览真实平台卡与交付

文件：新 `desktop/src/system/supply.ts`、`desktop/src/features/supply/SupplyPanel.tsx`、`desktop/tests/supply.test.ts`、`supply.spec.ts`；接入 `NativeApp.tsx/main.tsx`，更新词典、CSS及测试 fixture/config/script。新 `docs/desktop/supply-control.md`；同步 bridge-protocol、README 和当前计划。

接口：`SupplyClient.status(platform)`、`setPaused(platform,paused)` 解码 Task 1 白名单，校验期望 Hive/device_id/platform/paused；不接受凭证。概览仅已核验设备显示卡片，两平台串行读取，10 秒成功后轮询，失败停止；超过 30 秒或查询中状态不算当前成功。写失败仅允许重新 GET，不重放 PUT。旧实例/卸载的异步结果不覆盖当前状态。

- [ ] 写 TS/页面红灯测试，覆盖两平台、恢复仍不可供给、未知写结果后只 GET、空/缺失/错类型/错误归属、慢响应与串行轮询、过期及失败不闪成功、英文/最小窗口和 demo 隔离。沿用 test:device 加入本批测试及 CI。
- [ ] 实现平台卡、具体原因、最后核对时间、暂停／恢复及重新核对；明确 owner/platform 持久作用范围、暂停不终止在途请求、恢复不启动贡献。复用现有视觉和导航，不虚构账号或在线状态。
- [ ] 执行 TS 相关单测、typecheck、普通/demo build、新旧相关页面测试、Go 全量/vet和适当 Rust 回归；任务级复核并修复。独立全路径 final review 后完成验证、一致性和逐项收尾。
- [ ] 提交客户端源码；备份旧开发 App，再构建匹配源码的新 Mac 包，签名及 2 项签名包测试、真实包内只读协议冒烟；尝试 CUA 图形验收。记录来源/hash/已过项/未验收项和白话使用步骤，再提交记录；保留分支和 worktree，不发布生产版本。

Task3 客户端实施记录：平台卡、严格 TS 解码及 fixture 页面测试接入 `test:device`（现有 CI 入口自动包含）；使用与包验收边界见 `docs/desktop/supply-control.md`。本记录不勾选 Task3：任务级复核、全路径最终审查和匹配源码包的交付证据仍由主控收尾。
