# 设备停止派单协议 v1

本契约落实[已批准的 Hive 切换设计](designs/2026-11-12-hive-url-switching.md)第 5 节。共享 Go 类型与严格解码位于 `beewire/device_drain.go`，Bee 公开 HTTP 客户端位于 `agent/device_drain_client.go`。JSON 字段全部必填；可空字段必须显式为 `null`。拒绝未知／重复／缺失字段、尾随 JSON 和超出 64 KiB 的正文。

## HTTP 边界

全部接口按设备 Bearer 凭据鉴权，携带 `X-Hive-Request: 1`；不重定向。能力 GET 不要求旧运行 epoch 有效，不产生写入。普通身份 GET 成功不能代替本能力证明。

| 方法 | 路由 | 请求／响应 |
| --- | --- | --- |
| GET | `/api/bee/device-drain-capabilities` | 无正文；`DeviceDrainCapabilities`：`{"version":1,"device_drain":1}` |
| POST | `/api/bee/device-drains/{id}/begin` | `DeviceDrainRequest`；`DeviceDrainStatus` |
| GET | `/api/bee/device-drains/{id}` | 无正文；`DeviceDrainStatus` |
| POST | `/api/bee/device-drains/{id}/seal` | `DeviceDrainSealRequest`；`DeviceDrainStatus` |
| POST | `/api/bee/device-drains/{id}/release` | `DeviceDrainReleaseRequest`；`DeviceDrainStatus` |

能力 `device_drain:0` 表示明确不支持；未知版本或畸形正文阻止切换。404／405／501 的能力响应只表示未提供能力。操作 GET 的 404、错误或未知正文均不能当作 absent：只有经鉴权、从主数据库查询原 ID 返回的完整 `state:"absent"` 响应才是可靠缺失。客户端每次只发一次请求；结果未知后由持久原 ID 的查询调度器核对，不自动重放写入。

## 固定原请求与动作

`DeviceDrainRequest` 字段：`id`（48 位小写 hex 操作 ID）、`device_id`、`owner_id`（1..128 字节公开 ID，字母、数字、`_`、`-`）、`origin`（原始合法 Hive origin）、`expected_epoch`（空或 48 位小写 hex）、`expected_lease`（空或公开 ID）。`origin` 固定保留原上下文；不得规范化后改写历史请求、摘要或证明。Hive 不把 origin 当成目标地址，不向该地址请求。

`DeviceDrainSealRequest`：`id`（独立的 48 位动作 ID）、`request`（完整原请求）。该动作 ID 同时是成功封存后的新 epoch。

`DeviceDrainReleaseRequest`：`id`（与操作／seal 不同的 48 位动作 ID）、`request`、`mode`（`cancel` 或 `activate`）、`expected_epoch`、`expected_lease`。`cancel` 可在 begin 尚未到达时写入持久 released 终结标记；迟到 begin 只能返回原终态，不能重建屏障。`activate` 要求先前已封存；按当前 epoch／连接 lease 验证后只解除原操作屏障。已封存的取消也必须使用新 epoch，不能复活旧 epoch。activate 及封存后的 cancel 必须提供已核验的新连接 lease，不能为空或等于已注销的原 lease。初始 B 的原请求可以为空 lease；该空值表示确认无连接，不能作为通配符。

所有动作发送前持久化参数。同操作 ID 的原请求必须逐字段完全相同；同动作 ID 参数必须完全相同，异参数返回 HTTP 409 `device_drain_conflict`。服务端保存动作请求与原结果，重复动作不再执行；响应的 current 是本次读取的当前事实，不属于不可变动作结果。动作 ID 不可换参重用；取消后迟到 seal／begin 不得复活操作，旧 release 不得解除下一笔屏障。HTTP 409 冲突及业务错误采用 `{"error":{"code":"device_drain_conflict","message":"公开诊断"}}`，不得包含凭据。鉴权沿用 `invalid_device_credential`／`device_replaced` 的区别。

## 操作状态与当前事实

`DeviceDrainStatus` 字段：`version:1`、`device_id`、`owner_id`、`operation_id`、`state`、`request`、`seal`、`release`、`receipt`、`current`。

| state | request／seal／release／receipt |
| --- | --- |
| `absent` | 全为 null；不能据此证明取消成功，仍可能有在途 begin |
| `draining` | 原 request；其余 null；当前屏障保持 |
| `ready` | 同 draining；当前已知工作三项均为零，屏障保持 |
| `sealing` | 原 request 和已受理 seal；release／receipt 为 null；隔离旧代和注销连接尚待完成，不能视为完成 |
| `sealed` | 原 request、seal、不可变 receipt；release 为 null |
| `released` | 原 request 和成功 release；未封存取消时 seal／receipt 均 null；封存后释放时两者均保留 |

`current` 固定字段：`epoch`（空或 48 位 hex）、`lease`（空或公开 ID）、`barrier_id`（空或 48 位 hex）、`work`（null 或 `DeviceDrainWork`）。`DeviceDrainWork` 包含 `executions`、`unknown_terminations`、`unsettled`，均为 0..9007199254740991 的整数。null 表示缺乏可靠计数，不能推定为零。draining／ready／sealing 的 barrier_id 必须是原操作；ready 还要求已知三项为零。draining／ready 的 epoch 必须保持原值；sealing 只允许原值或已保存的 seal.id；released 的当前屏障不得仍是原操作，因为终态不可重建屏障。

`DeviceDrainReceipt` 固定字段：`version:1`、`seal`（完整封存请求）、`epoch`（必须等于 seal.id）、`connection_retired:true`、`work`（三项为零）。回执只证明本操作原设备、用户、原上下文、旧连接注销和封存完成事实，持久保存后永不因后续动作变化。current 与回执分离：当前 epoch／lease／屏障和工作可因后续重新连接、释放或新操作变化，不能用历史回执推断当前在线、允许接单或当前无任务。

服务端在最终准入同一设备锁下处理屏障、替换／退役及动作串行化，持久化屏障和取消 tombstone；seal 才推进 epoch，并确认旧连接退出后才生成回执。屏障不随进程或超时解除；平台 paused 独立。客户端严格核对身份、原 ID、原请求和动作参数；不接受另一设备、另一请求或“能力未知但身份成功”。

## 初次激活与错误链

首次激活 B 的顺序也是 begin → 等待 ready → seal → 保存回执 → 在 seal.id 的新 epoch 建立并核验 presence 连接 → 提交当前绑定 → 用新 lease 执行 activate release。已有 B 切出屏障时优先查询并沿用原 request／receipt。无连接的新绑定不跳过 seal，也不能用空 lease 解除屏障。传输和读取失败保留可检查的原始错误链（如取消、deadline、网络错误类型），其对用户可见的 Error 文本移除凭据。

## 桌面后台交接边界

原生核心通过 `bee desktop --profile-dir <已登记的绝对目录> --mode current|prepare|activate` 固定后台归属；目录必须已存在且没有符号链接别名。无参数的旧 `bee desktop` 保留原协议能力。prepare 只开放上下文、设备配对／恢复、只读启动核验以及设备屏障控制；activate 额外允许本地网络配置，并在协调器提交和解除屏障前禁止账号、供给与普通任务连接。Go 与 Rust 均执行能力白名单。

原生专用 `desktop_switch` 不向 WebView 注册命令。固定参数为 `action`、`profile_id`、`instance`、`binding_revision`、`network_revision`、`operation`、`seal`、`release`，不用的远端参数显式为 null。Rust `Bridge::switch_control` 从固定 LaunchSpec 和已核验 hello 注入 profile／instance；Go 再核对实例、目录、设备绑定版本和原请求。绑定版本是该 Go 进程的上下文版本，App 仍须独立核对持久 profile 索引版本。

| action | 后台行为 |
| --- | --- |
| `inspect`／`capabilities` | 返回本地交接事实／查询远端能力；inspect 不访问 Hive，可能附带原持久封存状态 |
| `freeze` | 关闭新增账号／登录／供给／运行恢复准入，等待已准入账号动作核对；保留原运行意图和现有任务连接 |
| `drain_begin`／`drain_status`／`drain_seal`／`drain_release` | 使用协调器已持久的原 ID 与参数，每次只发送一次；封存回执私有写入并回读成功后才可清原保护 |
| `stop` | 仅凭匹配的持久封存证明正常结束 owned worker／登录／连接，推进本地 epoch 并保存 workers_stopped；保留运行意图 |
| `connect` | activate／current 恢复专用；核验本地未决记录、设备身份和原 sealed 屏障，用新 epoch 连接 `/api/bee/connect` 并验证 lease／心跳；不读取官方账号来源 |
| `commit` | App 持久索引提交成功后通知后台；与匹配的新连接或已释放证明绑定，不能代替远端 release |

响应为 `{"switch":...}`，包含 mode、绑定／网络版本、epoch、lease、连接状态、冻结／维护许可、workers_stopped、seal_persisted、capabilities 和 drain。`inspect` 的历史 receipt 仅证明原封存，不推断当前远端事实。尚未完成原生准入的证明在重启后冻结维护；查询到 released 本身不会开放维护。activate release 要求先 commit，已封存 cancel 也要求新 epoch／lease。connect／release 尝试前撤销旧 workers_stopped，防止把后续重连／释放尝试之前的退出证明用于离线切换。

App 用真实 current 索引及原 request／seal／receipt／release 核对终态；成功目标绑定本次 switch ID，安全返回源绑定保存的 predecessor ID。随后原生 `commit` 才在私有证明中持久保存 `admission_completed:true`，写入、目录同步和回读成功后开放准入；旧证明缺此字段按 false 处理。断电发生在完成位保存前时仍需按原 ID 核对；保存后不丢失原历史回执。prepare／activate 重启不能单凭此位开放维护。current 的后续 epoch 若不同于原封存 epoch，必须有当前绑定、相同 epoch、已完成的普通 session-retirement 及其严格远端 proof；普通 guard、未决操作与启动恢复仍独立验证，无对应证据的 epoch 变化继续阻塞。

普通 user_stop／network_change／startup_recovery 不能绕过冻结。取消结果未知时 app_exit／update 仍正常 join owned worker，但无持久 seal 时停止结果保持失败、`StopReceipt.WorkersStopped=true`、`SessionClean=false`，原 guard 不变；这表示本地退出清理已完成，不能表示切换安全或恢复获准。`workers_stopped` 只覆盖该 Go owner 的 worker／socket，App 还须独立证明在途 IPC 已结束、子进程正常退出且已 reap，以及持久取消／退出意图，才能形成完整离线证据。

## URL 键

`beewire/testdata/hive-origin-contract.json` 是 Go／Rust／TS 的同组契约。新键统一协议和主机 ASCII 大小写、默认端口、一个根 `/`；只允许远程 HTTPS 或标准回环 HTTP。非 ASCII 主机字符保留原拼写，避免三种语言的 Unicode 大小写表和 URL 解析器隐式改变上下文。域名别名、localhost／127.0.0.1、Unicode／punycode、不同 IPv6 写法和非默认端口保持不同键。原始历史上下文不因生成键而更改；冲突处置归 profile 存储任务。
