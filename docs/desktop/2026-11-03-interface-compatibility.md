# 桌面重新绑定故障与接口兼容性核查

核查日期：2026-11-03。对象：`bee-desktop-p0` 工作树。

## 原因与修复

“重新绑定设备”的原始故障不是 Hive 接口变更。前端调用 `device_recovery_confirm` 时传入 `operation_id`、`expected_revision`，而 Tauri 命令默认要求顶层参数为 `operationId`、`expectedRevision`。实际原生错误为 `missing required key operationId`；请求在到达 Go/Hive 前就被拒绝。嵌套协议 DTO 继续使用 snake_case。

操作看似没有反应，是因为确认弹窗立即关闭，错误字符串被归为 `unknown_failure`，界面只显示泛化摘要，具体原因藏在可折叠详情里。现已修正参数，提交时保留弹窗并显示进度；失败时在弹窗内显示经过脱敏的具体原因并移动焦点。失败后返回设备核对，再由用户明确重试，不自动重放请求。处理中关闭弹窗时，若原按钮已禁用或移除，焦点回到设备区域。

同时修复：

- 保留 Hive 已公开的 26 个设备连接、租约、账号、授权、能力与事件错误码，同步 Go、Rust、TypeScript 的诊断白名单；未知码和敏感内容仍过滤。
- Rust 网络状态与测试解码器接收 Go 的 `result.error`，保留原始错误及证据，避免将业务失败改写为 `NETWORK_REPLY_INVALID`；成功与失败混合的非法响应仍拒绝。
- 接入上游已有的套餐变化恢复逻辑：OpenAI usage 套餐与凭据套餐不一致时，现有维护流程发送 `refresh_required`，绑定当前凭据 revision。同一 revision 请求一次，跨 revision 间隔一小时；失败响应不消耗机会。页面只读查询不启动维护，未收到 Hive task 不刷新、不写凭据。限频保存在内存，重启需重新观察；实际维护仍受已有持久 journal 保护。

## 核查基准与边界

本报告下列 47 个注册命令及测试数量属于本次原核查基线。后续新增 `bridge_pending_requests` 后，当前注册命令为 48 个；文档清理时重新运行原生命令、诊断与退避专项，25 项通过，其中契约检查覆盖 48 个注册命令。这不扩大原报告的真实账号或原生验收范围。

- Hive 本地源码：`ae6573b5e116793a8d954a9aba956be8a4f4a2e7`。
- 本次 fetch 后 `origin/main`：`3a04231b5f68d395907c58939b5efbd5eb9a40ad`；领先的两次提交不涉及下表接口。
- Hive 绑定的 Bee 子模块：`6fccf3b11a2a430075e4e23634eda4913e3ced08`，套餐刷新逻辑以此为参考。
- 核对 47 个桌面→Tauri 注册命令、30 个 Rust→Go 命令，以及下表 18 组 Bee→Hive 方法与路由；检查命名、字段、空值、枚举、成功/错误 envelope、身份、租约和 revision 约束。
- 47 个命令的自动契约检查读取真实 Rust 注册表、命令签名和 Serde 输入字段，捕获真实 TS 客户端调用参数；该测试在原生执行前截获调用，不代表逐一执行了真实写操作。
- TEE 的 inbox、credential、tunnel、WebSocket 核心文件在规范化 import 路径后相同。
- 当前部署的 Hive 提交版本未由本次源码核查确认。本轮重建后的原生验证只核查当前设备状态，没有执行新一轮配对或修改归属。

## Bee 使用的 Hive 接口

统一前缀 `/api/bee`；平台为 `openai` 或 `claude`。请求使用配对 token 或设备凭据。非成功响应为 `{error:{code,message,type,param}}`。

| 方法与路径 | 核查结果 |
|---|---|
| POST `/pairings` | name、credential_hash → 201，配对 token、公开码、确认地址、到期时间和轮询间隔一致 |
| GET `/pairings` | pending/approved/draining/redeemed 一致；轮询省略 token/code/URI 的处理一致 |
| POST `/pairings/redeem` | 配对 token + 空对象 → 201 Identity；未知结果保留原事务、不重放 |
| GET `/identity` | id/name/owner_id/owner_email 及撤销凭据错误码一致 |
| GET `/connect` | WebSocket presence、握手、X-Bee-Lease 和心跳一致 |
| GET `/agent` | WebSocket 隧道、角色、帧和 host metadata 一致；可选控制流仅在声明支持后发送 |
| GET `/credential-key` | key_id、public_key 编码一致 |
| GET `/supply-status` | not_configured/configured/codex_authorization_rejected 一致 |
| GET `/platforms/{platform}` | platform/paused/ready/reasons 一致；旧 Hive 原因降级逻辑保留 |
| PUT `/platforms/{platform}` | 显式 paused（包括 false）及供给响应一致；未知写结果只回读 |
| GET `/platforms/{platform}/account` | 状态、指纹、generation、confirmation、revision、source deadline 一致 |
| POST `/platforms/{platform}/account/confirm` | account_fingerprint/confirmation_id → PlatformAccount 一致 |
| PUT `/platforms/{platform}/account/source` | lease → source_unavailable 一致 |
| POST `/maintenance` | 授权元数据、预期版本、刷新标记、account/task 一致；补上套餐变化时的刷新标记 |
| POST `/credentials` | lease、envelope、平台授权、task ID → 201 registered/generation 一致 |
| GET `/platforms/{platform}/capabilities` | 状态、套餐、模型、额度窗、观察时间和客户端版本一致 |
| POST `/platforms/{platform}/capabilities` | 能力、lease/generation/fingerprint/revision/reuse_metadata 一致 |
| POST `/events` | 最多 20 条事件 → 204 空正文一致 |

Hive main 尚未包含桌面所用的可选 `reason_detail` 扩展，客户端已有明确旧版降级；可选 credits 不影响现有桌面功能。收益、reseller 以及 OpenAI 上游 `model_usage` 扩展不在本次 Bee↔Hive 接口修复范围。

## 回归覆盖

- 原生参数：47/47 注册命令、嵌套 DTO 与旧 snake_case 请求反例。
- 交互：原生参数错误、Hive HTTP 503、中英文、等待中与失败后关闭、焦点恢复、只读核对挂起、用户明确重试、成功结果和防止重复提交。
- 网络：原始错误与 details 透传、混合 envelope 拒绝。
- 诊断：Go 公开码经过 Rust/TS 保留，未知码与敏感信息过滤；跨语言回归直接读取 Go 白名单。
- 维护：套餐变化/未变化、拒绝后重试、revision 变化、重启、一小时时限、无 task 不写凭据。

验证结果：

| 检查 | 结果 |
|---|---|
| TypeScript typecheck | 通过 |
| Node 24 全部 `tests/*.test.ts` | 226/226 通过，无跳过 |
| Playwright 完整 device 配置 | 276/276 通过，含中文/英文失败与重试、焦点恢复 |
| `go test -race -timeout=600s ./agent ./beewire ./relay` | 通过；beewire/relay 为缓存结果 |
| Go 新增契约与套餐刷新专项（race、count=1） | 通过 |
| `go test ./desktopbridge -count=1` | 通过 |
| `go vet ./agent ./desktopbridge ./beewire ./relay` | 通过 |
| Rust protocol/network/diagnostic 专项 | 分别 36/37/15 项通过；专项筛选可能重叠，不累加为总数 |
| Hive controller/middleware 测试（count=1） | 通过 |
| Go sidecar、Tauri debug `.app` 构建 | 通过 |
| macOS `codesign --verify --deep --strict` | 通过，本地临时签名开发包 |
| 重建后原生应用启动、手动设备核对 | 通过；显示设备已绑定、上次重新绑定已完成，贡献保持停止 |

自动测试与构建日志位于工作树 `.cache/device-pairing/interface-{unit,e2e,app-build}.log`，失败弹窗截图为 `rebind-failure-{zh,en}-{native,hive}.png`。已检查 860×600 的中英文截图，原因与返回入口完整可见。
