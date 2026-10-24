# Task 1 实施报告：Go 真实供给服务

状态：实现完成，已自检并提交，等待任务级复核。提交：`be3e2a6` — `feat(desktop): add verified platform supply control`。

## 实现与绑定约束

- 新增 `DesktopSupply` 与 `(*DesktopDevice).SupplyStatus(ctx, platform)`、`SetPaused(ctx, platform, paused)`；公开字段恰好为 `hive/device_id/platform/paused/ready/reasons/checked_at`，原因数组非 null，核验时间使用 UTC RFC3339。
- 平台只接受 openai/claude；固定独立配置路径、同一受保护配置锁与共用 12 秒 context 内，先确认已绑定、Hive/凭证格式、保存身份合法，再 GET identity 核对设备与 owner。没有开始配对或覆盖现有绑定的路径。
- GET/PUT 使用真实 Hive API URL、设备 Bearer 与现有请求头。PUT 总是显式发送 boolean（包括 false）；验证 PUT 响应及目标值后 GET 同平台回读，只在回读确认目标值后返回成功。丢失写响应、回读失败或反值均返回 unconfirmed，服务没有 PUT 重试或本地写意图保存/重放。
- 供给对象逐 token 检查四个必需字段，拒绝未知/重复/缺失/null、类型错误、平台串线、未知/重复/跨平台账号原因，以及 ready/reasons、paused/manually_paused 矛盾；限制响应为 65536 字节。错误包含检查点、HTTP 状态、布尔值/计数等公开证据，不输出未知字段、原因原文或响应正文。
- 仅从原 `finishDesktopDevice` 抽取纯 `validateDesktopIdentity`，保留旧配对完成与持久化流程。供给服务不调用 saveState；fixture 对配置连同额外空白逐字节比较。

## 独立事实依据

只读核对 `/Users/dayong/myspace/mywork/tokenhive/hive/hive/internal/controller/supply_control.go`、`service/platform_control.go`、`service/supply_control.go`、`integration/supply_control_test.go`，以及 Bee `beewire/supply_reasons.go`。

Hive 明确按 owner/platform 持久化暂停；平台隔离，设备替换后继承；恢复并不消除 offline/not_configured 等其他原因。账号原因由 `AccountReason(platform, status)` 生成，必须与平台对应。

## TDD 与验证证据

全部命令工作目录均为 `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`。

1. 初次 RED（尚未添加服务方法）：`go test ./agent -run TestDesktopSupply -count=1`

   ```text
   --- FAIL: TestDesktopSupplyAPIAvailable (0.00s)
       desktop_supply_test.go:11: DesktopDevice lacks required supply method SupplyStatus
   FAIL github.com/tokhive/bee/agent 0.968s
   ```

2. 先添加接口占位，写完风险矩阵再运行 RED：`go test ./agent -run TestDesktopSupply -count=1 > /tmp/desktop-supply-red.log 2>&1`，退出 1。摘要：

   ```text
   --- FAIL: TestDesktopSupplyPlatformIsolationExplicitFalseAndRestart
       status: ... supply status not implemented
   --- FAIL: TestDesktopSupplyRejectsUntrustedIdentityBeforeAnySupplyRequest/revoked
       HTTP evidence omitted: supply status not implemented
   --- FAIL: TestDesktopSupplyRejectsResponseSchemaAndInvariantViolations/...
       missing response evidence: supply status not implemented
   --- FAIL: TestDesktopSupplyUnconfirmedWritesNeverReplay/...
       uncertain write not identified: supply control not implemented
   --- FAIL: TestDesktopSupplyLockAndCallerDeadlineBlockWrites
       configuration lock not honored: supply control not implemented
   FAIL github.com/tokhive/bee/agent 1.683s
   ```

3. 自检补充跨平台账号原因 RED：`go test ./agent -run TestDesktopSupplyRejectsReasonsFromOtherPlatform -count=1`，退出 1，两平台均报告 `accepted account reason belonging to the other platform`。添加拒绝检查后同命令 GREEN：`ok github.com/tokhive/bee/agent 0.479s`。

4. 主矩阵 GREEN：`go test ./agent -run TestDesktopSupply -count=1`，退出 0：`ok github.com/tokhive/bee/agent 1.137s`（该次在跨平台补充前；后续 race 包含最终全部用例）。

5. 最终要求的回归验证：`go test -race ./agent -run 'TestDesktop(Device|Supply)' -count=1`，退出 0：`ok github.com/tokhive/bee/agent 2.918s`。

6. 一次完整 agent 包验证：`go test ./agent -count=1`，退出 0：`ok github.com/tokhive/bee/agent 53.970s`。

7. `git diff --check` 退出 0，无输出。

## 测试风险矩阵

- 身份撤销、设备/owner 变化、身份字段无效、身份夹带设备凭证/配对 token：GET 与 PUT 均阻断，且不发供给/配对请求。
- 未绑定、待配对、非规范或不安全 Hive、非法凭证、损坏保存身份与非法平台：网络请求前阻断。
- 两平台独立、明确 true/false PUT 正文、正确 Bearer/Header/URL、identity→PUT→GET 顺序、服务重启只读、恢复仍因 offline/not_configured 不 ready；公开结果关联 Hive/设备/平台，精确七字段与 UTC 时间。
- 每个必需字段缺失/null/重复，字段类型错误、原因元素非字符串/null、未知字段/原因、重复原因、平台与账号原因串线、两项状态不变量、无效/尾随/非对象 JSON 和超大响应：GET 与 PUT 均拒绝且不泄露 fixture 的 secret-marker。
- PUT 响应丢失/503/错误目标值；回读 503/正文截断/反值/错误 schema：结果不确认且 PUT 恰好一次，后续手动 GET 和新服务实例不重放修改。
- 配置锁占用与调用方更短 deadline：阻断请求或在身份阶段取消，未发 PUT。
- 所有 fixture 在结束时核对原配置逐字节不变。

## 自检、定位与边界

测试初次 GREEN 时，响应头前断开 GET 连接触发 Go transport 对可重放读取的透明重试，回读计数为 2。重复复现并核对标准库 `persistConn.shouldRetryRequest` 后，将“正文丢失”fixture 改成发送 HTTP 200 及 Content-Length 后截断正文；该用例连续两次通过（`ok ... 0.481s`）。这没有放宽 PUT 不重放断言，也没有修改既有 HTTP 客户端行为。

本任务只改三个指定源码/测试文件；未改 Hive、前端、管道、ledger 或用户配置，未联系真实 Hive、未读取真实秘密。测试使用独立临时私有配置与 httptest 服务。没有已知剩余正确性问题；Task 2 接入管道及 UI 验收属于后续任务。

变更文件：`agent/desktop_supply.go`、`agent/desktop_supply_test.go`、`agent/desktop_device.go`。
