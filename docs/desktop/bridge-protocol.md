# Bee 桌面私有管理协议

`bee desktop` 是桌面壳与本次创建的 Bee 子进程之间的机器入口，不能附加参数。启动、`hello`、`ping` 不读取设备配置、不连接 Hive；显式设备命令使用独立的受保护配置并访问 Hive 现有设备 API。它不读取 CLI 配置、不启动贡献、不开放监听端口。其他 CLI 命令仍走原入口。此协议可用不代表 Bee 已具备接单条件。

## 帧与关联

- stdin 接收请求，stdout 只输出响应；诊断写入 stderr，父进程须持续消费两个输出管道。
- 每个输入和输出帧是一个 UTF-8 JSON 对象，以 `\n` 结束；换行前最多 1,048,576 字节。分段读取和多个帧合并写入均支持。编码后的输出同样检查上限，防止 JSON 字符串转义扩大响应。
- 请求字段必须恰好为 `protocol`（整数 1）、`id`（非空字符串）、`method`（字符串）和 `params`（对象）。除 `device_begin` 外，params 必须为空；`device_begin` 必须恰好包含非空字符串 `hive`、`name`。未知字段、重复 JSON 字段、缺失字段和不合法的 JSON 类型均拒绝。
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
{"protocol":1,"id":"hello-1","instance":"0d957c72d63b4c06ae544c10f4c549799","result":{"bee_version":"dev+revision-dirty","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin"]}}
```

版本不匹配返回 `VERSION_MISMATCH`，不进入 ready；未成功握手的其他方法返回 `NOT_READY`。握手成功后再发 `hello` 返回 `ALREADY_READY`，不会替换实例。当前 CLI 入口提供四项能力；保留的 `desktopbridge.Run` 无设备服务时只提供原 P0 两项能力。Rust 只接受这两组精确的能力集合。

| 请求 method | result | 含义 |
| --- | --- | --- |
| `ping` | `{"alive":true}` | 管理进程仍响应，不表示已连接 Hive 或开始贡献 |
| `shutdown` | `{"stopped":true}` | 停止接受后续输入，写完已接收的响应后退出；父进程仍须等待并回收本次子进程 |
| `device_status` | `{"device":DeviceView}` | 核验独立设备状态；未配置时返回 unbound；已配置时可轮询、兑换或核验原设备身份 |
| `device_begin` | `{"device":DeviceView}` | 使用 `{"hive":"https://hive.example","name":"Bee Desktop"}` 开始或继续配对；禁止改换已保存的 Hive |

不存在贡献 `start`、独立账号授权、资金或任意 Shell 操作。成功响应含 `result`，协议失败以 `error` 取代 `result`：

```json
{"protocol":1,"id":"ping-1","instance":"0d957c72d63b4c06ae544c10f4c549799","error":{"code":"NOT_READY","message":"hello handshake has not succeeded; required=hello before other methods"}}
```

设备业务失败返回 `result.error`，如 `{"error":{"code":"DEVICE_OPERATION_FAILED","message":"…"}}`，保留 HTTP 方法、路径、状态码等诊断证据，不回显响应体或秘密；失败后管道和 ping 仍可用。协议、来源、实例或已发送请求的传输失败仍使桥失效。

`DeviceView` 只含 `state`（unbound/pending/draining/expired/bound）及适用的 `hive`、`name`、`verification_url`、`user_code`、`expires_at`、`poll_interval_seconds`、公开 `identity`。身份字段为 `id/name/owner_id/owner_email`。凭证和配对令牌只留在 Go；配置路径固定为 `UserConfigDir()/tokhive/bee-desktop.json`，不接受前端传入路径。兑换结果未知时保留原事务和凭证，先重新核验身份，禁止用新事务覆盖。

Tauri 另提供不接受 URL 参数的 `device_open`：重新核对设备，只在 pending/draining 时打开同 Hive 的 `/devices/pair?code=…`；若恰好已绑定或过期，直接返回最新状态。系统启动器最长等待 5 秒，超时回收自有启动器并报告打开结果未确认。浏览器确认后须手动回到 Bee，没有账号自动回跳。

Go 一次设备操作最长 12 秒、单次 HTTP 最长 10 秒；Rust 设备请求期限 15 秒，原 hello/ping 为 5 秒。排队时期限已过且尚未发送的请求单独返回 `REQUEST_QUEUE_TIMEOUT`，保留健康会话。

请求含有唯一有效 ID 时，未知字段或重复非 ID 字段的错误仍关联原 ID。无法可靠解码请求信封、重复 ID 字段有歧义，或编码后的响应超过上限时，错误响应的 `id` 为空字符串。输出超长只发送小型 `FRAME_TOO_LARGE` 错误帧并终止会话；父进程应将这种响应作为协议错误处理，不能据此完成某个正常请求。

## 取消与资源所有权

`desktopbridge.Run(ctx, in, out, diagnostics, version)` 不关闭外部传入的流；返回前会等待自己创建的响应写入 goroutine 结束。输入 EOF 正常结束，context 取消保留 `context.Canceled` / `context.DeadlineExceeded`，底层读写错误保留错误链。响应队列有界，只允许一个输出写入者，避免响应交错和无界积压。

通用 `io.Reader` / `io.Writer` 没有中断方法。**调用方必须在取消时解除正在阻塞的 Read / Write**；单独取消 context 不能保证唤醒任意外部流。这里不通过遗留读取 goroutine 假装已经退出。

命令入口拥有其标准管道：Unix 将继承的管道复制为 close-on-exec、非阻塞描述符，并注册 Go runtime poller；取消时关闭自有输入和输出，唤醒空闲读取和堵塞写入。普通文件不修改描述符标志。Windows 保留 Go 标准管道关闭行为，其既有原生验收进度以 P0 验证记录为准；本次设备增量未新增 Windows 原生证据。输出失败也会触发命令入口取消并回收本次资源。

关闭、EOF、信号和错误路径均不枚举系统进程，不查杀外部 Bee。此处管理协议与设备配对；真实贡献运行及任务收尾属于后续阶段。

## 验证

从 Bee 实施检出运行：

```sh
go test ./desktopbridge ./cmd/bee -count=1
go test -race ./desktopbridge ./cmd/bee -count=1
go run ./cmd/bee version
go run ./cmd/bee help
```

协议测试覆盖分段/合并帧、帧长度边界、错误输入、重复未完成 ID、实例关联、版本不匹配、流所有权、取消和底层 I/O 错误。命令测试创建真实测试子进程，验证握手、拒绝贡献操作、shutdown、父输入 EOF、空闲输入/堵塞输出时的中断、CLI 帮助与版本一致，以及工作目录配置样本未改变。

本次设备配对的自动测试与实际子进程证据来自 macOS arm64；交叉编译不替代 Windows/Linux 的行为测试。设备增量的使用、验证及原生图形缺口见[设备配对说明](device-pairing.md)。既有 P0 三端进度仍以 [P0 验证记录](p0-validation.md)为准，不能用本增量宣称三端产品已通过。
