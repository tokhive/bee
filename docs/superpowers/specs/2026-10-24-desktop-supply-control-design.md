# 桌面真实平台状态与暂停恢复

状态：按用户“好了，你可以继续了”及“后续自动确认就可以”执行。复用已批准架构，不改 Hive；实施无需重复确认。交付时若图形工具无法读取窗口，仅需用户显示现有主窗口，具体验收状态见平台供给说明。

## 已确认范围和技术栈

沿用 Go 1.27.3、Tauri 2.12.5、现有 Rust 1.94 工具链、React 19.2.8、TypeScript 7.0.2、Vite 8.2.4 和现有私有管道，均已确认，无新增依赖或权限。复用已有独立设备配置，不修改用户已完成的绑定。

本批在普通原生概览展示 OpenAI、Claude 的 Hive 权威供给状态与原因，提供分平台暂停／恢复。账号接入、开始贡献、余额收益、等待任务后退出、独立账号会话和自动回跳不在本批。

## 事实与实现选择

Hive `a8e4e8742b7a43413ffd7771bcf1dcb0f9235115` 的 `hive/internal/controller/supply_control.go`、`service/platform_control.go`、`service/supply_control.go` 及 `integration/supply_control_test.go` 证明：GET/PUT `/api/bee/platforms/{openai|claude}` 使用设备 Bearer，返回 `platform/paused/ready/reasons`；PUT 体必须显式包含 boolean `paused`，手动暂停按 owner/platform 持久化，替换设备后仍继承。解除暂停不代表满足其他接单条件。

采用现有 Go 服务加两个 typed 管道方法；相较抓取 CLI 文案，保留结构化字段和失败证据；相较让 React 直连 Hive，无需让凭证进入前端或新增权限。沿用独立配置、锁和受限原生命令，比引入新服务更直接；两种被比较方案均不采用。

## 约定

- 新 Go 方法为 `SupplyStatus(ctx, platform)`、`SetPaused(ctx, platform, paused)`，返回 `DesktopSupply`：`hive/device_id/platform/paused/ready/reasons/checked_at`。配置路径仍固定，不接受 Hive、设备 ID、账号 ID 或凭证输入。
- 操作在同一受保护配置锁内，最长 12 秒。必须已有绑定，校验 Hive/凭证格式，再向 identity 核验保存的设备和 owner 不变；读写供给均不修改绑定配置。平台只允许 openai/claude。
- 供给响应必须恰好含四个必需字段，拒绝缺失/null/重复字段、错误类型、平台串线、未知字段、未知或重复原因、ready 与 reasons 矛盾、paused 与 manually_paused 矛盾。错误报告失败项和公开证据，不回显未知载荷或秘密。
- PUT 是明确设置目标值，不是服务端 toggle。成功响应先校验目标值，再 GET 同平台核对；全部一致才返回成功。PUT/回读失败或值不一致，返回“结果未确认”及具体证据；不自动重试 PUT。用户点击重新核对只 GET，不重放修改。重启也只读取服务端现状，无需保存或重放本地写意图。
- `supply_status({platform})`、`supply_set_paused({platform,paused})` 参数严格校验。业务错误放 `result.error`，成功为 `result.supply`；原有设备接口保持不变。完整能力集为原四项加这两项；无供给实现的设备替身保留四项，P0 保留两项。Rust 精确接受这三组，15 秒期限和原有来源/实例/请求关联不放宽。
- UI 在已核验设备的概览显示两张平台卡；按平台串行查询，禁止并发或自动重复写入。10 秒串行刷新仅在上次成功后继续，失败停止到手动重查；离开页/卸载不留下定时器。失败、核对中和旧于 30 秒的结果不显示成当前成功状态，旧异步结果不得覆盖新实例。
- 控件只在对应数据已验证且新鲜时启用。暂停作用于当前 Hive 账号的该平台，换设备后仍保留；暂停不终止已接请求。恢复只解除手动暂停，不启动本机贡献。ready 仅显示“满足接单条件（Hive 报告）”，不显示成“正在贡献”。identity 可用不等于贡献在线；offline 按平台原因显示，不推断整体在线状态。
- 使用既有银白布局、中英文和 860×600 最小尺寸；demo 继续隔离。凭证只在 Go，前端校验全部白名单字段及当前 Hive/设备/平台。

## 验证与边界

先做风险测试再实现：两平台隔离、暂停持久语义、恢复仍因 offline/not_configured 不 ready、missing false 与显式 false、错误平台/未知字段/重复字段/秘密载荷、身份撤销或变化阻断写入、响应丢失无自动重试、PUT 成功但 GET 失败/相反值、读配置字节不变。独立依据为 Hive 源码及其现有集成测试。

管道和 Rust 覆盖严格参数、六项握手、业务失败后 ping 健康、固定命令与期限；TS/页面覆盖普通原生两平台、实际状态、暂停恢复、未知结果只读核对、过期数据、串行轮询、错误不闪回成功、中英文和最小窗口。自动写入仅针对本地 fixture，不暂停用户真实 Hive 账号。

收尾保留源码提交和对应 Mac 开发包，验证签名、包内真实协议和只读供给查询；尽量进行 CUA 原生窗口验收，工具取窗失败时记录精确错误。已有 P0/P1 三端缺口不因本批而勾选。
