# Bee 桌面私有管理协议

`bee desktop` 是桌面壳与本次创建的 Bee 子进程之间的机器入口，不能附加参数。启动、`hello`、`ping` 不读取设备配置、不连接 Hive；显式设备命令使用独立的受保护配置并访问 Hive 现有设备 API。管理入口本身不读取 CLI 配置、不自动启动贡献、不开放监听端口；贡献由固定运行命令控制。其他 CLI 命令仍走原入口。此协议可用不代表 Bee 已具备接单条件。

## 帧与关联

- stdin 接收请求，stdout 只输出响应；诊断写入 stderr，父进程须持续消费两个输出管道。
- 每个输入和输出帧是一个 UTF-8 JSON 对象，以 `\n` 结束；换行前最多 1,048,576 字节。分段读取和多个帧合并写入均支持。编码后的输出同样检查上限，防止 JSON 字符串转义扩大响应。
- 请求字段必须恰好为 `protocol`（整数 1）、`id`（非空字符串）、`method`（字符串）和 `params`（对象）。`device_begin` 的 params 必须恰好包含非空字符串 `hive`、`name`；`supply_status` 恰好含枚举 `platform`（openai/claude），`supply_set_paused` 恰好含该 `platform` 和显式 boolean `paused`。账号、运行与官方登录参数见下表；其余基础方法 params 必须为空。未知字段、重复 JSON 字段、缺失字段和不合法的 JSON 类型均拒绝。
- 每次 `Run` 创建新的随机 128 位 `instance`；一次会话内保持一致。父进程用 `id` 关联请求，用 `instance` 区分重新启动的管理实例。
- 相同 ID 的前一响应尚未完整写入时，返回 `DUPLICATE_ID`，不执行重复操作。父进程应为每次请求生成新 ID。
- ID 及版本号属于公开元数据，不能放入凭证。协议错误不回显完整请求、未知字段名、未知方法值或 JSON 解析器引用的载荷字节；JSON 语法错误报告字节位置和帧长度。
- 输入超过上限或在 EOF 时缺少终止换行，会尽力发送错误帧后结束本次会话。完整但不合法的请求返回错误后可继续接收下一帧。空输入直接正常结束。

## 握手与允许的操作

先发送：

```json
{"protocol":1,"id":"hello-1","method":"hello","params":{}}
```

响应示例（版本和实例以实际运行值为准）：

```json
{"protocol":1,"id":"hello-1","instance":"0d957c72d63b4c06ae544c10f4c549799","result":{"bee_version":"dev+revision-dirty","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin","supply_status","supply_set_paused","account_defaults","account_detect","account_snapshot","account_action","runtime_snapshot","runtime_start","runtime_stop","runtime_configure_network","runtime_restore","authorize_start","authorize_status","authorize_cancel","diagnostics_start","diagnostics_snapshot","diagnostics_cancel","network_status","network_test","notification_snapshot"]}}
```

版本不匹配返回 `VERSION_MISMATCH`，不进入 ready；未成功握手的其他方法返回 `NOT_READY`。握手成功后再发 `hello` 返回 `ALREADY_READY`，不会替换实例。当前 `bee desktop` 入口提供上述 **24 项**有序能力。Rust 保留 P0、设备、供给、账号、运行、官方登录及恢复服务的完整历史前缀；网络两项必须成组追加，诊断三项只能追加到含运行服务的前缀，通知快照只能追加到含账号且含网络或诊断的集合末尾。仅接受这些完整、有序组合，拒绝任意子集、乱序或额外方法。

| 请求 method | result | 含义 |
| --- | --- | --- |
| `ping` | `{"alive":true}` | 管理进程仍响应，不表示已连接 Hive 或开始贡献 |
| `shutdown` | `{"stopped":true}` | 停止接受后续输入，写完已接收的响应后退出；父进程仍须等待并回收本次子进程 |
| `device_status` | `{"device":DeviceView}` | 核验独立设备状态；未配置时返回 unbound；已配置时可轮询、兑换或核验原设备身份 |
| `supply_status` | `{"supply":DesktopSupply}` | 重新核验设备归属并只读查询指定平台 |
| `supply_set_paused` | `{"supply":DesktopSupply}` | 明确设置目标 paused，并 GET 回读核对；失败不重试 PUT |
| `device_begin` | `{"device":DeviceView}` | 使用 `{"hive":"https://hive.example","name":"Bee Desktop"}` 开始或继续配对；禁止改换已保存的 Hive |

账号命令参数必须精确匹配以下字段；同样拒绝未知、重复、缺失、null 错用或错误类型：

| 请求 method | params | result／边界 |
| --- | --- | --- |
| `account_defaults` | `{}` | `{"defaults":DesktopAccountDefaults}`；不打开官方凭证或连接 Hive |
| `account_detect` | `platform,directory,store,mode` | `{"account":DesktopAccountSnapshot}`；平台 openai/claude；directory 必须显式 null 或非空绝对路径（≤4096 UTF-8 字节，无控制字符）；OpenAI store 为 auto/file/keyring，Claude 为 file/keychain；mode 为 local/official |
| `account_snapshot` | `platform,refresh` | `{"account":DesktopAccountSnapshot}`；refresh 显式 boolean，false 只返回公开快照，true 只刷新 Hive |
| `account_action` | `platform,revision,candidate_ref,action,confirmed` | `{"account":DesktopAccountSnapshot}`；revision 为非负安全整数，candidate_ref 为当前随机引用，action 为 select/confirm_change/remove/clear_selection，confirmed 必须为 boolean；false 是合法参数但业务拒绝；select／clear_selection／confirm_change 已接通；已注册账号 remove 仍不可用 |

Tauri `account_detect`／`account_action` 的 invoke 参数为 `{request:{…}}`；defaults 为 `{}`，snapshot 为 `{platform,refresh}`。Rust typed 命令与 Go 双重校验；generic `bridge_request` 仍只开放 ping。公开 DTO 与只读、缓存、提醒及功能依赖说明见[AI 账号观察](ai-accounts.md)。

贡献使用下述固定 `runtime_start`；官方授权使用下述 authorize 三项固定动作，不存在资金或任意 Shell 操作。成功响应含 `result`，协议失败以 `error` 取代 `result`：

```json
{"protocol":1,"id":"ping-1","instance":"0d957c72d63b4c06ae544c10f4c549799","error":{"code":"NOT_READY","message":"hello handshake has not succeeded; required=hello before other methods"}}
```

设备、供给和账号业务失败返回 `result.error`；账号代码为 `ACCOUNT_OPERATION_FAILED`，供给代码为 `SUPPLY_OPERATION_FAILED`，如设备错误 `{"error":{"code":"DEVICE_OPERATION_FAILED","message":"…"}}`，保留 HTTP 方法、路径、状态码等诊断证据，不回显响应体或秘密；失败后管道和 ping 仍可用。协议、来源、实例或已发送请求的传输失败仍使桥失效。

`DeviceView` 只含 `state`（unbound/pending/draining/expired/bound）及适用的 `hive`、`name`、`verification_url`、`user_code`、`expires_at`、`poll_interval_seconds`、公开 `identity`。身份字段为 `id/name/owner_id/owner_email`。凭证和配对令牌只留在 Go；配置路径固定为 `UserConfigDir()/tokhive/bee-desktop.json`，不接受前端传入路径。兑换结果未知时保留原事务和凭证，先重新核验身份，禁止用新事务覆盖。

Tauri 另提供不接受 URL 参数的 `device_open`：重新核对设备，只在 pending/draining 时打开同 Hive 的 `/devices/pair?code=…`；若恰好已绑定或过期，直接返回最新状态。系统启动器最长等待 5 秒，超时回收自有启动器并报告打开结果未确认。浏览器确认后须手动回到 Bee，没有账号自动回跳。

Go 一次设备、供给或账号操作总期限 12 秒，单次 HTTP 最长 10 秒；Rust 这些请求从进入队列起共 15 秒，原 hello/ping 为 5 秒。排队时期限已过且尚未发送的请求单独返回 `REQUEST_QUEUE_TIMEOUT`，取消后不会迟发，保留健康会话。已发送请求超时先撤销 ready，再返回 `RESPONSE_TIMEOUT`；子进程回收不延迟调用方超时。会话拒绝迟到成功及后续排队写，不能因 supervisor 暂时未被调度而恢复 ready。

请求含有唯一有效 ID 时，未知字段或重复非 ID 字段的错误仍关联原 ID。无法可靠解码请求信封、重复 ID 字段有歧义，或编码后的响应超过上限时，错误响应的 `id` 为空字符串。输出超长只发送小型 `FRAME_TOO_LARGE` 错误帧并终止会话；父进程应将这种响应作为协议错误处理，不能据此完成某个正常请求。

## 取消与资源所有权

首次设备业务访问由共享桌面会话获取 `bee-desktop.json` 的跨进程锁，持有至管理进程结束。配对、供给、账号查询复用该会话；配置互斥只保护本地读写，网络等待不持有它。配对事务单独串行，不阻塞另一平台供给查询。管理入口关闭会话前等待现有操作退出；关闭后不得重新打开。CLI 的配置文件及锁生命周期不变。

`desktopbridge.Run(ctx, in, out, diagnostics, version)` 不关闭外部传入的流；返回前会等待自己创建的响应写入 goroutine 结束。输入 EOF 正常结束，context 取消保留 `context.Canceled` / `context.DeadlineExceeded`，底层读写错误保留错误链。响应队列有界，只允许一个输出写入者，避免响应交错和无界积压。

通用 `io.Reader` / `io.Writer` 没有中断方法。**调用方必须在取消时解除正在阻塞的 Read / Write**；单独取消 context 不能保证唤醒任意外部流。这里不通过遗留读取 goroutine 假装已经退出。

命令入口拥有其标准管道：Unix 将继承的管道复制为 close-on-exec、非阻塞描述符，并注册 Go runtime poller；取消时关闭自有输入和输出，唤醒空闲读取和堵塞写入。普通文件不修改描述符标志。Windows 保留 Go 标准管道关闭行为，其既有原生验收进度以 P0 验证记录为准；本次设备增量未新增 Windows 原生证据。输出失败也会触发命令入口取消并回收本次资源。

关闭、EOF、信号和错误路径均不枚举系统进程，不查杀外部 Bee。同时回收 owned 贡献与官方登录进程；不等待 Hive 在途任务完成。

## S1 运行交接契约（T1 已定义，命令在接通服务后开放）

公共数据定义在 `agent/desktop_runtime_types.go`；跨语言样本为 `desktopbridge/testdata/runtime-contract.json`。S1-T3 已接通运行查询、开始、停止及内部网络配置；S1-T4 已接通官方登录；S1-T6 接通仅供 Rust 启动生命周期调用的 runtime_restore。

| 数据／动作 | 固定字段及语义 |
| --- | --- |
| `DesktopNetworkConfig` | revision、connect_proxy；默认0/空代理；只允许可信Rust内部配置 |
| `DesktopOperation` | id、kind（select/clear_selection/start/stop/confirm_change/authorize）、platform（null或openai/claude）、state（pending/running/reconciling/succeeded/failed/cancelled）、revision、error；id是本机动作引用，不是Hive confirmation_id |
| `DesktopRuntimeSnapshot` | run_id（可空，本次贡献运行）、revision、network_revision、observed_at、local（stopped/starting/running/stopping/failed）、connection（disconnected/connecting/connected/reconnecting/rejected/occupied）、platforms、operation、stop_receipt。桥envelope的instance仍为管理进程实例 |
| platforms | 按平台索引；每项含account（既有账号快照）、supply（既有供给或null，null表示未获得可信读回）、selection_revision。不用空供给冒充正常/可接单 |
| `runtime_start` | expected_revision、resume_platforms；仅本次用户明确允许恢复的平台 |
| `runtime_stop` | expected_revision、reason（user_stop/app_exit/update/network_change）；reason由固定Rust入口生成；网页只可明确停止 |
| `runtime_snapshot` | 无参数；长操作的operation和receipt通过快照核对，不能持续占用普通请求 |
| `runtime_configure_network` / `runtime_restore` | 仅Rust内部使用，generic bridge_request继续只允许ping；恢复必须核对保存意图和新鲜暂停状态 |
| `DesktopStopReceipt` | workers_stopped、intent_saved、session_clean；仅证明Go本机运行，还需Rust证明管理进程已wait/reap与配置锁释放 |
| `authorize_start` | platform、source（directory/store）、expected_revision；不接收程序或命令参数 |
| `authorize_status` / `authorize_cancel` | operation_id；返回DesktopOperation，取消不能撤销已完成的官方登录 |

新数值修订使用非负JS安全整数，时间为UTC RFC3339，状态枚举封闭；旧instance/run_id/revision不能覆盖新结果。未知值和结果未确认时保持不可恢复。

账号文件v2保留提醒entries，新增scopes（SHA256键由Hive origin、owner、device构造）。每scope包含明确身份、selections、pending_operations、runtime_intent及session；不保存token。旧v1在首次写入升级前原样保存到受保护`.v1.bak`；备份失败、未知字段/版本、身份范围不一致、损坏及保护失败均不覆盖原件。读取不会自动升级。未来运行必须先保存活动会话，只有可信结束才标clean；active与clean不能同时为真。

## 验证命令

### S2 诊断、网络与后台问题事实

下表属于 Go sidecar 的固定能力；参数同样拒绝未知、重复、缺失及错类型字段。日志、普通偏好和 OS 适配由 Rust 提供，不增加 Go 任意文件／Shell 入口。

| 请求 method | params | result／边界 |
| --- | --- | --- |
| `diagnostics_start` | `{}` | `{report:DesktopDiagnosticReport}`；显式启动异步检查，复用 S1 会话、已选来源和有效网络；不读默认 `bee.json`，不配对、续期、暂停、同步或启动贡献 |
| `diagnostics_snapshot` | `{id}` | `{report:DesktopDiagnosticReport}`；id 为当前实例保留的 48 位小写十六进制报告引用；只读已有结果，不重跑 |
| `diagnostics_cancel` | `{id}` | `{report:DesktopDiagnosticReport}`；取消当前检查并保留部分结果；终态报告不回退为运行中 |
| `network_status` | `{}` | `{network:{effective_revision,effective_proxy,paths}}`；仅内存中的实际生效策略，不访问设备配置或网络；没有 Rust 保存值 |
| `network_test` | `{proxy}` | `{network_test:{observed_at,checks}}`；proxy 必须显式字符串；只测试本机代理 CONNECT 和两个固定官方只读 GET，不接收端点、账号或凭证 |
| `notification_snapshot` | `{}` | `{notifications:{facts,observed_at,network_revision}}`；仅供 Rust 后台调度，读取 S1 公开问题及持久提醒门禁；不刷新官方／Hive，不消费应用内 Notify 脉冲，也不写提醒记录 |

对应业务错误分别为 `DIAGNOSTICS_OPERATION_FAILED`、`NETWORK_OPERATION_FAILED`、`NOTIFICATIONS_OPERATION_FAILED`，位于 `result.error`；错误参数为 envelope 的 `INVALID_REQUEST`。业务错误及未知报告不破坏后续 ping。

`DesktopDiagnosticReport` 精确字段为 `id,instance,run_id,network_revision,started_at,finished_at,state,checks`。id 为 48 位小写十六进制，instance 为当前管理进程 32 位引用，run_id 为 S1 运行引用或 null；修订为非负 JS 安全整数，时间为 UTC RFC3339。state 为 running/completed/cancelled；running 的 finished_at 为 null，终态必须有完成时间。每实例最多保留 8 份，至多一份正在运行。

每项检查为 `id,platform,status,observed_at,code,evidence,next_action`。全局 device/runtime/hive/proxy 的 platform 为 null；每个平台各有 source/authorization/quota/capabilities/account/supply，共 16 项。status 为 pass/warning/fail/skipped，code 和 evidence 使用公开白名单；未知检查不转成通过。next_action 仅 overview/accounts/diagnostics/settings，不是命令或 URL。前端按 instance、run_id、network_revision 拒绝过期上下文；切页不新建报告。

`paths` 精确字段为 relay/official/hive/official_login：relay 为 direct/local_proxy；official 为 `openai=<path>;claude=<path>`，每项 path 为 direct/environment_proxy/local_proxy；Hive 固定 process_environment，官方登录固定 official_client。只公开路径类别，不回显环境代理原文。测试 checks 固定依次为 local_proxy/openai_read_only/claude_read_only，每项含 id/status/message/path/http_status；status 为 ok/failed/skipped，HTTP 状态为整数或 null。401/403/429 只能证明收到 HTTP 响应，不能证明账号、额度或贡献可用。

通知 facts 最多 8 项，每项为 `identity,platform,problem,active,eligible,recovered`：identity 为 64 位不透明摘要，problem 仅 authorization_rejected/confirmation_required/offline/quota_exhausted。eligible 必须同时 active，recovered 不可同时 active；来源、邮箱、完整账号指纹及自定义通知正文不进入此通道。Rust 持有独立 OS 提交去重记录，提交已接受不等于用户已读。

### S2 Rust typed 命令

以下是 WebView invoke 契约；未注明时参数为空对象，multiword 参数由 Tauri 使用 camelCase。generic `bridge_request` 继续只允许 ping。

| 命令 | invoke 参数／返回 |
| --- | --- |
| `preferences_read` / `preferences_save` | `{}` / `{request:{expected_revision,preferences}}`；返回 `{preferences,error}`；preferences 为 version:1、revision、language(system/zh/en)、theme(system/light/dark)、notifications_enabled、autostart_desired、proxies |
| `diagnostics_start` / `diagnostics_snapshot` / `diagnostics_cancel` | `{}` / `{id}` / `{id}`；返回原管理桥 envelope，由 Rust 与 TS 双重核验报告 |
| `diagnostic_logs` | `{query:{cursor,limit,module,platform,level}}`；返回 `{entries,next_cursor,truncated}`；limit 为 1..200，其余过滤项或 cursor 可为 null |
| `diagnostics_export` | `{reportId,includeLogs}`；返回 `product,app_version,bee_version,os,arch,report,logs,truncated,truncated_sections`；报告须属于当前实例，页面选择范围后复用下载完成／取消／失败回执 |
| `network_test` / `network_snapshot` | `{proxy}` 返回 Go envelope；`{}` 返回 `{saved_revision,effective_revision,saved_proxy,effective_proxy,paths,pending_restart,error}` |
| `network_save_proxy` / `network_apply_saved` | `{proxy,origin,expectedRevision}` 保存并返回偏好快照，origin 为未配对草稿的 canonical origin 或 null；`{confirmed:true}` 明确确认可能中断任务后应用，返回网络快照 |
| `notification_permission` / `notification_enable` | 查询 / 用户明确触发请求权限；返回 granted/denied/prompt，普通保存偏好不申请权限 |
| `notification_delivery_status` / `notification_retry` | 查询返回 `{error}`；用户主动允许失败提交再试，返回 null，不清除 S1 问题 |
| `autostart_status` / `autostart_set` | `{}` / `{enabled}`；返回 `{desired,registered,error}`；registered 可为 null，登记失败不能按 desired 宣称成功 |
| `hive_open` | 不接受 URL 参数；由已保存 canonical origin 打开站点根地址，不携带凭证或配对码 |

proxies 每项为 `{origin,device_scope,connect_proxy}`，device_scope 为 null 时仅未配对草稿；核验设备后才关联范围。专用代理仅空值或无认证、显式回环 IP 的 HTTP 地址和合法端口（允许根路径 `/`），不支持 SOCKS、localhost 名称、远端主机、认证、其他路径或 query。保存与生效分离，运行中保存显示 pending_restart；应用时复用 S1 停止证明、内部配置和保存意图恢复，不能解除原暂停或未决换号。

普通偏好位于当前 OS 用户配置目录 `tokhive/desktop-preferences.json`，不导入 demo localStorage；默认语言／主题跟随系统，通知及自启关闭。OS 提交记录另存 `tokhive/notification-delivery.json`。安全诊断日志位于 App 日志目录 safe-diagnostics，每份最多 5 MiB、最多 3 份；仅记录固定结构的公开证据，不复制原始 stderr。导出在 Rust 组装且最多 5 MiB，以 truncated/truncated_sections 显式标记截断，沿用 1 MiB sidecar 帧限制。

### 安全只读 smoke

Node 24 下可执行 `node desktop/scripts/smoke-accounts.mjs <Bee绝对路径>` 以及 `node desktop/scripts/smoke-experience.mjs <Bee绝对路径> [证据目录]`。二者均严格断言当前完整 24 项能力；前者只取默认来源及 refresh:false 公开快照，后者另核对 S1 内存快照、网络策略、参数拒绝、未知报告业务错误及 owned 子进程回收，不执行配对／检测凭证／恢复／贡献／有效网络测试。

体验脚本以独立临时工作目录运行：Linux 将子进程 XDG_CONFIG_HOME、Windows 将 APPDATA 指向空临时目录，才额外执行未配对诊断及空通知快照，只允许产生临时配置锁。macOS 的 Go `os.UserConfigDir()` 不使用 XDG_CONFIG_HOME，因此脚本明确跳过会打开设备会话的命令；不重定向 HOME，不读取用户的 `~/Library/Application Support/tokhive`。JSON 证据记录覆盖、跳过、二进制 SHA256 与正常退出；协议 smoke、浏览器 fixture 均不替代 doctor 真实配对路径、实际代理、日志下载或原生 OS 通知／自启／窗口验收。

### Go 协议回归

从 Bee 实施检出运行：

```sh
go test ./desktopbridge ./cmd/bee -count=1
go test -race ./desktopbridge ./cmd/bee -count=1
go run ./cmd/bee version
go run ./cmd/bee help
```

协议测试覆盖分段/合并帧、帧长度边界、错误输入、重复未完成 ID、实例关联、版本不匹配、流所有权、取消和底层 I/O 错误。命令测试创建真实测试子进程，验证握手、拒绝贡献操作、shutdown、父输入 EOF、空闲输入/堵塞输出时的中断、CLI 帮助与版本一致，以及工作目录配置样本未改变。

本次设备配对的自动测试与实际子进程证据来自 macOS arm64；交叉编译不替代 Windows/Linux 的行为测试。设备增量的使用、验证及原生图形缺口见[设备配对说明](device-pairing.md)。既有 P0 三端进度仍以 [P0 验证记录](p0-validation.md)为准，不能用本增量宣称三端产品已通过。

供给公开字段、暂停持久语义、前端串行刷新和未知写结果处理见[平台状态与暂停恢复说明](supply-control.md)。`DesktopSupply` 精确字段为 `hive/device_id/platform/paused/ready/reasons/checked_at`；凭证不进入前端。`checked_at` 为 UTC RFC3339。`ready` 当且仅当原因数组为空，`paused` 当且仅当含 `manually_paused`；两平台原因不能串线。PUT 后 GET 回读失败或目标值不符均报告结果未确认，重新核对仅 GET。

### S1 接入操作（已实现）

`account_action.select` 异步返回 `account.operation`，通过 `account_snapshot` 轮询。选择前持久记录意图、暂停该平台并读回，再保存来源；成功状态为 `selection.state=selected`，不代表已经注册或贡献。`operation` 必须存在，可为 null；账号操作 kind 为 select／clear_selection／confirm_change／authorize，state 为 pending／running／reconciling／succeeded／failed／cancelled。

`clear_selection` 只清除尚未注册且未运行的本地选择，使用当前快照 revision 与 confirmed=true；candidate_ref 可以是空字符串，不要求官方凭证仍有效。select／confirm_change 继续要求当前候选引用。完整移除仍不可用。若暂停已证实、Hive 身份/代次未变而官方来源发生变化，原接入操作以失败结束并保持暂停，允许用户重新检测确认；无法确认暂停或 Hive 归属时保留未决操作，刷新只查询、不重发 PUT。


### S1-T3 真实运行与同步屏障

`runtime_snapshot` 返回 `{runtime:DesktopRuntimeSnapshot}`；`runtime_start`／`runtime_stop`／`runtime_restore` 返回 `{operation:DesktopOperation}`；`runtime_configure_network` 返回 `{configured:true}`。业务错误为 `RUNTIME_OPERATION_FAILED`，不使管理桥失效。前端调用分别为 `{}`、`{request:{expected_revision,resume_platforms}}`、`{expectedRevision}`；停止理由由 Rust 固定为 `user_stop`，内部理由及代理配置不开放为网页命令。

真实 Go 连接与授权维护运行于管理子进程。同步回执核对当前连接租约、账号指纹、代次和凭证修订，并与持久选择／run_id核对；手动恢复同样核验。来源切换先取消并等待原平台维护，再启用新来源，成功仍保持暂停。一个平台失败不阻塞另一个平台；首次409停止，不抢占连接。

手动暂停的修订优先于正在准备的开始请求。重连为每个平台登记可取消的启动等待器，慢暂停不会永久漏启维护。停止即使保存失败也取消并等待授权维护、转发处理和失败上报退出；receipt如实报告，不能替代 Rust 对管理子进程的 wait/reap。普通窗口关闭仍沿用原有后台行为。

### 官方登录动作（S1-T4）

`authorize_start` 参数必须是 `{platform,source:{directory,store},expected_revision}`；`authorize_status`／`authorize_cancel` 必须是 `{operation_id}`。所有返回 `{operation:DesktopOperation}`，业务错误为 `AUTHORIZE_OPERATION_FAILED`。Go 严格拒绝 source 内外的未知、重复、缺失字段；directory 必须明确为 null 或绝对目录，修订必须为非负安全整数，operation_id 必须为当前管理实例拥有的 48 位小写十六进制引用。

Tauri 调用分别为 `{request:{…}}`、`{operationId}`、`{operationId}`，只提供这三个固定命令。启动返回 pending，后续查状态；账号快照也包含同一平台操作。status／cancel 的 ID 必须与回执相同，前端拒绝旧 instance、修订倒退和跨平台回执。取消请求本身可能仍返回 running，回收完成后才返回 cancelled。真实登录的十分钟期限不占用桥请求；版本和 help 探测各五秒，输出不进入桥。支持范围及尚未完成的真实登录验收见 [AI 账号管理](ai-accounts.md)。

`account_action.confirm_change` 返回原有账号 operation；持久操作 ID 独立于私有 Hive confirmation_id。确认提交前保持原候选 revision，确认后按目标指纹及严格下一代 generation 核对。submitted 之后不会重发 confirm POST；尚未提交的未决操作只有再次显式确认可继续，快照刷新不会代替该确认。成功前完成实际同步，平台仍暂停；临时连接不能转发贡献请求。


### S1-T6 恢复与退出

Rust 在管理进程 ready 后仅发一次 `runtime_restore({})`，不自动重启崩溃进程。Go 在返回开始操作前保存本次活动会话，自动恢复仅接受已保存运行意图与正常结束记录；恢复时重新核验设备、来源、授权和 Hive 暂停状态。同身份官方 token 更新可以重新同步，手动暂停和换号后暂停不被恢复覆盖。

`runtime-session` 是设备配置同目录的受保护恢复标记，仅保存本次 run 或 `clean`，不含凭证。在读取 `ai-accounts.json` 前保存它，使账号文件本身不可读／不可写时仍保留未完成恢复的证据。上次非 clean 标记必须通过明确开始处理。用户停止的内存意图不会被随后 app_exit 覆盖；只有当前实例持有的会话证明可以标 clean。保存失败仍回收本机 worker，返回未确认结果；无法在整个存储介质不可写时保证持久记录新的停止操作，不能把该情况报告成功。

`Bridge::prepare_owned_exit(OwnedExitReason::{AppExit,Update})` 冻结新请求及尚未发送的排队操作，核对同 instance、run_id、stop operation 和修订的停止回执，最多等待12秒后仍必须回收 owned Child。调用方取消不会取消该清理任务。仅保存意图、会话clean和Child wait/reap均被证实后返回四项为真的 `OwnedExitReceipt`；配置锁随该子进程退出释放。更新准备不释放 App 单实例，普通退出在回收后才释放。该回执不代表 Hive 在途任务已排空。
