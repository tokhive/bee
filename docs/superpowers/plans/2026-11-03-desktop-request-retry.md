# Bee 请求超时保活与重试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 subagent-driven-development，逐项实现与审查。用户已授权按方案 A 完成，无需再次确认。

**Goal:** 状态查询超时不退出 Bee；原请求完成后自动退避重查，保留连接和用户操作边界。

**Architecture:** Rust 私有桥保留已发送请求、通道和 16 项预算直至原回复；Go 提供基于类型的失败分类与限流证据；React 单一刷新器按资源调度。沿用现有协议，无 Go 管道取消方法。

**Tech Stack:** 沿用 Go 1.27.3、Tauri 2.12.5、Tokio 1.54.1、Rust 1.94、React 19、TypeScript、Node 24、Playwright。

## 全局约束

- 绑定后保持 Hive 连接，是否贡献另行控制；不开始贡献、不选择账号、不解除暂停、不修改 Hive。
- 保留现有工作区改动；不提交、不推送、不发布。使用既有隔离工作树。
- 普通排队最多 15 秒；首次写出后执行通常 15 秒；保留专用长请求及握手/退出/更新总期限。
- 原请求尚未结束不重放、不释放通道或共享屏障；部分帧继续剩余字节；最多 16 项。
- 状态读取退避 2、4、8、16、30 秒，抖动 [0.8d,d]；成功恢复 10 秒。429 尊重有效 Retry-After。
- 致命协议错误、实际子进程退出及管道损坏仍按既有方式关闭；不自动重启子进程。
- 新增错误字段同步严格 Go/Rust/TS 契约；不记录凭据、请求正文或任意 stderr。

### Task 1: Rust 请求生命周期与完成通知

**Files:** 修改 `desktop/src-tauri/src/sidecar.rs`、`sidecar_tests.rs`、`commands.rs`、`lib.rs`（或实际命令注册入口）、`protocol.rs`、`diagnostic_log.rs`；测试夹具 `desktop/tests/fixtures/bridge-child.mjs`。

**Interfaces:** 原有请求方法与 BridgeStatus 不变。新增本地 `bridge_pending_requests` 命令，返回 `{instance, requests:[{id,method,platform}]}`（只列调用方已超时仍在途项）；完成事件 `bee://request-settled` 携带 `{instance,id,method,platform}`，不含业务结果。`platform` 为 openai/claude/null。RESPONSE_TIMEOUT 证据含 request_id、method、platform、phase、queue_ms、execution_ms、fully_sent、in_flight。前端以该事件解除等待并从原生内存回读补偿事件丢失。

- [x] 写回归用例并确认旧实现失败：已发送超时后 bridge Ready、同 instance ping 可用、迟到回复可消费；排队与执行预算分开。
- [x] 实现 request/session 两处超时统一语义：未发送取消；已发送只结束调用方等待；仍校验迟到回复。取消调用方同样保留帧与屏障。
- [x] 完成事件和内存回读、严格证据字段、诊断；不引入无界 retired map。完整帧输出后才可读为 fully_sent。
- [x] 覆盖慢平台不阻断另一平台、写屏障、16 项上限、部分帧、迟到失败、未知/重复/跨实例、退出期限。运行 Rust sidecar 与命令相关测试，任务审查。

验证：`RUSTUP_TOOLCHAIN=1.94 cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib sidecar`。应通过；原有“超时必须 Failed”的测试更新为真正故障才 Failed。

### Task 2: Go 失败类别、Retry-After 与安全证据

**Files:** `agent/desktop_failure.go`、相关 HTTP 边界（device/supply/accounts）、同目录测试，Rust `protocol.rs`/`diagnostic_log.rs`，TS `failures.ts` 及契约测试。

**Interfaces:** 使用稳定错误码和 `retry_after_seconds` 证据（非负整秒），有效 HTTP 日期转换为收到响应时的剩余秒数；仅对 429 使用。明确超时、连接错误/临时 DNS 可重试，TLS/认证/非法数据阻断。未知错误不归为网络断开。

- [x] 写并运行失败类型和 429 秒数/日期/无效字段测试，先确认缺失行为。
- [x] 实现最小类型分类与 Retry-After 传播；核对 12 秒 context 覆盖子步骤，不新增 HTTP 重试。
- [x] 增加请求阶段与耗时安全诊断，三端字段白名单同步，确保秘密不进入日志。
- [x] 运行 Go 定向测试与跨语言错误契约测试；任务审查。

验证：`go test ./agent ./desktopbridge`，Node 契约用例，Rust protocol/diagnostic 用例。所有可重试判定来自错误类型、稳定码或 HTTP 状态。

### Task 3: 单一前端刷新器退避与局部状态

**Files:** `desktop/src/system/desktopState.ts`、`bridge.ts`、`failures.ts`，展示刷新状态的组件和中英文文案，`desktop/tests/desktop-state.test.ts`（按实际文件名）、Playwright 恢复用例。

**Interfaces:** 使用 Task 1 的完成事件/内存回读。RefreshStatus 增加等待原请求结束语义；资源分别计数，事件开始退避，正常/400ms 刷新不绕过。可注入随机源用于测试。

- [x] 写并运行失败用例：同平台账号后供给、跨平台并行；2/4/8/16/30 退避、成功复位、429、终止类别、旧实例事件、事件丢失。
- [x] 实现每资源自动核对闸门；在途超时先等完成；不重复执行写命令，不丢失原操作记录或修订保护。
- [x] 保留其他有效快照和导航；显示“前次核对尚未结束，结束后重试”或真实重试时间；供给失败不伪造 WebSocket 断开。
- [x] TypeScript、Node 定向测试及 Playwright 恢复用例通过；任务审查。

验证：`npm run typecheck`（若项目命令不同用 `npx tsc --noEmit`）；使用项目已有 test 脚本运行相关用例。不新增全局重试按钮。

### Task 4: 集成验收、构建与文档

**Files:** 本计划与 `docs/superpowers/reports/2026-11-03-desktop-request-retry-verification.md`、相关旧规则文档。

- [x] 运行 Go vet/race、Rust lib/tests/bins、TypeScript 与受影响 Playwright；保留历史 examples 编译限制的准确记录。
- [x] 重建 Go sidecar 和 Bee S1 Dev.app，验签；使用本地合成故障验证 PID/instance 保留、迟到恢复、退出仍受控。不启用真实贡献或平台写入。
- [x] 最终行为路径审查，处理重要问题并运行覆盖测试；同步文档、检查一致性与全部验收项。
- [x] 汇总已验证结果与实际限制；停止实现，不提交、不发布。

## 自检

覆盖设计的请求阶段、保活、预算、迟到回复、有限资源、单一退避、写操作边界、局部 UI 与诊断；技术栈沿用，无新增配置。任务中的验证使用合成凭据及本地服务。

## 完成记录

2026-11-03：16 项均按实际证据验收。完整浏览器运行与旧夹具定向修正分别记录；没有声称重跑后全套同次通过。原生 App 已重启并确认绑定、Hive 在线、贡献未启动。详见[验证记录](../reports/2026-11-03-desktop-request-retry-verification.md)。未提交或发布。
