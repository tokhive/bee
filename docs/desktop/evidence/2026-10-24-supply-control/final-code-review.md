# 平台供给增量最终完整行为路径审查

审查范围：`fe1249f..0c0a789`；工作树 `.worktrees/bee-desktop-p0`。依据本批 design、plan、`.superpowers/sdd/review-fe1249f..0c0a789.diff`、三个任务的实现/复核报告，以及绑定 Hive 源码。使用 `global-conventions`、`requesting-code-review/code-reviewer.md`、`affected-path-review`、`fail-fast-with-evidence`。本报告只审“真实平台状态＋分平台暂停/恢复”，未重新审查旧 P0/P1 全产品。

## Strengths

- 用户行为与写入边界对应：已核验绑定的概览才创建供给客户端，两个平台串行 GET；按钮显式传目标 boolean，Go 在 identity 核验后 PUT，并校验 PUT 目标和随后 GET 目标，全部通过才返回成功。未发现 toggle、重试 PUT、持久化写意图、启动贡献或写入账号/资金的旁路（`desktop/src/app/NativeApp.tsx:38`、`:43`；`desktop/src/features/supply/SupplyPanel.tsx:23`；`agent/desktop_supply.go:73`、`:80`、`:89`）。
- 不依赖普通 JSON 解码的宽松默认值：Go 严格拒绝缺失/null/重复/未知字段、错误平台与原因、不变量矛盾；桥参数明确区别 missing false 与显式 false；TS 再校验公开七字段和当前绑定。上游未知载荷不被写入错误消息（`agent/desktop_supply.go:155`；`desktopbridge/protocol.go:137`；`desktop/src/system/supply.ts:25`）。
- 已读、写成功、写未知和过期没有混成一个成功状态。查询和失败期间隐藏旧成功，写失败停止轮询，手动重新核对只调用 GET；30 秒限制同时检查渲染时与点击时，跨客户端共享队列控制并发（`desktop/src/features/supply/SupplyPanel.tsx:25`、`:29`、`:40`、`:61`；`desktop/src/system/supply.ts:68`）。
- 生命周期与错误隔离保持原规则：Rust 固定方法/15 秒期限，信封核验请求 ID 和 owned instance；业务错误留在 result 中，不使健康桥失效。协议/传输错误使会话失效，管理实例改变重挂设备工作区，旧 effect 的异步结果不落入新页面（`desktop/src-tauri/src/sidecar.rs:226`、`:251`、`:421`、`:432`；`desktop/src-tauri/src/protocol.rs:198`；`desktop/src/app/NativeApp.tsx:69`；`desktop/src/features/supply/SupplyPanel.tsx:34`、`:37`、`:46`）。
- 测试证据与风险相匹配：Go fixture 核对真实 URL/header/body/调用序列和配置逐字节不变；丢写响应、回读失败/反值均断言 PUT 一次；Rust 使用真实子进程和 Tauri invoke；页面覆盖未知写结果、慢响应、实例替换、计时器滞后、860×600 和中英文。Task3 已有的 TS 实际类型 Minor 在 `0c0a789` 修复（`agent/desktop_supply_test.go:28`、`:75`、`:248`、`:354`；`desktop/src-tauri/src/sidecar_tests.rs:377`、`:419`；`desktop/tests/supply.spec.ts:43`、`:55`、`:94`、`:104`；`desktop/tests/supply.test.ts:43`）。

## 行为路径与字段追踪

| 字段/边界 | 来源、变换与去向 | 审查结论 |
| --- | --- | --- |
| `hive` | 固定桌面配置 → `hiveOrigin` 规范检查 → identity/平台请求 origin → 七字段 → TS 与已核验设备的 hive 严格相等 | 未由供给 IPC 接收地址，无请求路径拼接逃逸；没有从响应采信新 origin（`agent/desktop_device.go:44`、`agent/desktop_supply.go:60`、`:101`、`:106`、`desktop/src/system/supply.ts:45`） |
| `device_id` | 配置保存身份 → identity 实时核验 ID/owner 不变 → `identity.ID` → TS 当前设备 ID | 不接受前端指定身份，没有从供给 JSON 伪造设备归属；owner 保留于 Go 核验，不额外进入七字段（`agent/desktop_device.go:249`、`agent/desktop_supply.go:70`、`:101`、`desktop/src/system/supply.ts:46`） |
| `platform` | UI 两个常量 → TS 白名单 → Rust 封闭枚举 → Go 严格参数 → 固定 API 路径 → 响应平台相等 → TS 相等 | 无改名、缺省或平台串线；claude/codex 专有原因也分别校验（`desktop/src/features/supply/SupplyPanel.tsx:4`、`desktop/src-tauri/src/protocol.rs:6`、`desktopbridge/protocol.go:168`、`agent/desktop_supply.go:212`、`desktop/src/system/supply.ts:47`） |
| `paused` | 最近经验证状态的显式目标 → typed bool → Go 必需 bool → PUT `{"paused":false/true}` → PUT 核验 → GET 核验 → UI | false 不被遗漏，不通过省略或 null 推断 false；paused 与 manually_paused 必须一致（`desktop/src/system/supply.ts:80`、`desktopbridge/protocol.go:180`、`agent/desktop_supply.go:85`、`:94`、`:110`、`:235`） |
| `ready` | Hive `len(reasons)==0` → Go/TS 不变量检查 → “满足接单条件（Hive 报告）” | 不推断本机已贡献或整体在线，恢复仍可因其它原因不 ready（`agent/desktop_supply.go:232`、`desktop/src/system/supply.ts:59`、`desktop/src/features/supply/SupplyPanel.tsx:65`） |
| `reasons` | Hive/beewire 白名单 → 非 null 数组/唯一/跨平台检查 → TS 再校验 → 中英文原因文案 | 未发现原因丢失；manually_paused 由状态标题展示，其余列为原因；未知载荷拒绝且不回显（`beewire/supply_reasons.go:7`、`agent/desktop_supply.go:192`、`:219`、`desktop/src/system/supply.ts:50`、`desktop/src/features/supply/SupplyPanel.tsx:66`） |
| `checked_at` | 完成 Go 核验后的本机 UTC RFC3339 秒值 → TS 合法 UTC/非未来检查 → 30 秒新鲜度及到期 UI | Go 秒格式与 TS 秒/毫秒正则兼容；旧于阈值不能授权按钮写入（`agent/desktop_supply.go:101`、`desktop/src/system/supply.ts:61`、`desktop/src/features/supply/SupplyPanel.tsx:27`、`:49`、`:61`） |
| credential | Go 私有配置 → Go 格式检查/身份回显秘密拦截 → HTTP Bearer | 不进入 DesktopSupply、IPC 参数或 TS；错误仅输出白名单公共证据（`agent/desktop_supply.go:67`、`:122`、`:144`；`agent/desktop_device.go:253`） |
| instance/id | Go 每管理会话随机 instance + 请求 ID → Rust 信封核验 → NativeApp 管理实例 key | 留在信封层，无混入七字段。Rust 会话只绑定一个 owned child，当前生产入口没有自动替换/重启写重放路径（`desktopbridge/server.go:46`、`:121`；`desktop/src-tauri/src/sidecar.rs:395`、`:432`；`desktop/src-tauri/src/lib.rs:78`） |

补读的未改参与者：`cmd/bee/main.go:42`、`:76` 只把 `bee desktop` 导向 `NewDesktopDevice`；没有贡献 runtime 调用。`agent/state.go:20` 经私有文件打开/保护验证读取，`agent/state_lock_unix.go:13` 与 `state_lock_windows.go:14` 为同配置非阻塞独占锁；供给路径持锁覆盖身份与 GET/PUT，未调用 saveState。`agent/client.go:62` 的 HTTP 客户端禁止跟随重定向，避免 307/308 重发该写请求。`desktop/src-tauri/src/lib.rs:108` 和 sidecar supervise/stop 仍回收 owned child；不是供给功能另开进程。`desktop/src/main.tsx:26` 的普通原生分支与 demo 路由继续隔离。

Hive 只读事实：`hive/hive/internal/controller/supply_control.go:9` 使用 currentDevice 并校验平台与显式 paused；`service/platform_control.go:10` 按 identity.OwnerID/platform 更新控制，事务核验设备未撤销；`service/supply_control.go:68` 从 owner/platform 读取 paused，再累加原因并决定 ready。与本批“暂停跨设备保留、恢复不等于贡献在线”的文案一致。本审查未访问真实 Hive，也未执行真实暂停/恢复。

## Issues

### Critical

无，0 项。

### Important

无，0 项。

### Minor

**M1 — Go 供给响应类型拒绝缺少本次实际类型。**

- 位置：`agent/desktop_supply.go:208`、`:209`；对应已有测试 `agent/desktop_supply_test.go:258`。
- 路径：Hive 返回错误类型 → `json.Unmarshal` 返回类型错误 → 新固定错误只输出 `field` 和 `required` → HTTP 包装 → `SUPPLY_OPERATION_FAILED` → UI。比如 `paused:"false"` 和 `paused:0` 均变成 `supply field type rejected: field=paused, required=boolean`，没有本次 `actual_type=string/number`。这与本批已修 TS paused 输入诊断同类，仍欠 `fail-fast-with-evidence` 要求的本次实际类型证据。
- 影响：拒绝行为正确、不会发生后续回读成功或虚假状态，因此不构成写入安全或状态正确性阻断；但操作者无法仅由同条错误区分服务端 schema 的具体类型偏差。
- 建议：从 JSON token 或受控类型错误信息提取安全类型分类，附 actual_type；不要直接拼原始字段值或未经筛选的错误载荷。数组元素类型错误可补元素位置和实际类型。
- 定向测试：扩充 `TestDesktopSupplyRejectsResponseSchemaAndInvariantViolations`，至少让 paused string/number/object 的错误各自包含 actual_type，保留 HTTP 方法/状态与 secret-marker 不泄露断言。运行 `go test ./agent -run TestDesktopSupplyRejectsResponseSchemaAndInvariantViolations -count=1` 足以覆盖这一窄修补；无需为此重复完整套件。

## 验证证据与边界

- 本轮是只读审查；未改产品、index、HEAD、配置或 Hive，唯一落盘是本报告。读取设计/计划、review package、实现/复核报告，并按调用链补读未改参与者；大输出截断处按实际源码与指定片段补齐关键路径。
- 沿用已有验证证据，没有无理由重跑大套：Task1 `go test -race ./agent -run 'TestDesktop(Device|Supply)' -count=1`；Task2 Go bridge/cmd、Rust 50 passed/2 ignored 及修补后的 protocol 10 passed；Task3 device/supply 单元与 17 页面、typecheck、普通/demo build、bridge 单元和 89 页面回归；`0c0a789` 的8项 supply单测通过。报告中的测试通过是已有记录，并非本审查重新执行。
- 排除了具名疑点：307/308 是否自动重发 PUT（客户端禁重定向）；UTC 秒格式是否被 TS 拒绝（格式兼容）；实例变化旧结果是否覆盖新失败（workspace key + effect active guard + 已有页面回归）；共享队列是否造成跨平台并发（按 transport 串行且页面 batch 串行）。未发现需要进一步 focused 执行才能裁决的产品正确性疑点，M1 有直接确定的错误返回代码证据。
- Mac 匹配源码包、旧包备份、签名与2项签名包专项、包内真实只读协议/供给冒烟、CUA 原生图形仍由主控交付。Windows/Linux 和原 P0/P1 未验收项继续保留；本审查不替代这些验收，不把 Task3 全部标完成。

## Assessment

**代码审查结论：Approved（C/I/M = 0/0/1）。Ready to merge：Yes，就本次增量的代码质量而言，附上述非阻断诊断 Minor；不表示当前可宣称产品交付完成。**

用户可见状态、明确写入、身份/平台归属、私有凭证边界和失败处理链闭合，未发现需阻断本增量的正确性问题。建议主控按已授权范围窄修 M1 并完成保留的包/只读/CUA 交付证据后，再给出本批最终完成结论。

## M1 有限复核：0c0a789 → 24aca16

- 复核范围仅为 `agent/desktop_supply.go` 和 `agent/desktop_supply_test.go` 的两文件 diff、对应测试及 Task3 报告追加的 RED/GREEN 记录；未重开全路径审查、未重跑既有测试套件。
- `agent/desktop_supply.go:209` 使用 `errors.As` 提取 `json.UnmarshalTypeError`，保留字段、期望类型，新增安全 `actual_type` 和字节偏移。`Value` 中 number 后可能携带的原始数字经 `strings.Cut(..., " ")` 移除，bool 统一成 boolean；没有拼入原始载荷或完整错误字符串。改动仅在既有解码失败分支，合法接受集合和失败控制流未改变。
- `agent/desktop_supply_test.go:248` 新增七个子例，覆盖 string/number/boolean/array/object 和 reasons 数组元素类型；断言字段、实际类型、字节位置，同时断言秘密字符串和原始数字均不回显。现有完整 schema 拒绝测试继续验证 HTTP 包装与载荷保护。
- 已核对实现报告中七子例 RED、修补后两个定向测试 GREEN（0.787s）。主控另提供 `go test ./agent -run TestDesktopSupply -count=1` 通过（1.294s）、`go vet ./...` exit 0 无输出；这两项为主控验证证据，本复核未重复执行。
- **M1 已闭合。最终代码审查：Approved，未解决 C/I/M = 0/0/0。** 原报告 M1 为历史发现，不再是未解决项；Mac 包、签名、真实只读与 CUA 的独立交付边界仍由主控记录。
