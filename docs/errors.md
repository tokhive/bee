# Bee 错误码

排查时先运行 `bee doctor`，它会按顺序检查下面每一类问题，见 [README · Troubleshooting](../README.md#troubleshooting)。

Bee 面向 Provider 的错误使用「错误码 + 原因 + 处理」格式。一次性命令在终端输出两行：

```text
[BEE-CONFIG-TARGET-MISSING] a configured platform's upstream address is missing from targets: "claude" is configured but targets lacks api.anthropic.com:443
fix: add the reported address to targets; without it Bee registers the account but refuses every connection Hive sends it
```

`bee run` 因错误退出时，日志行带 `code`、`error` 与 `fix` 三个属性。错误码一经发布保持不变，可直接用来查本页或向管理员报告；终端文案可能调整。

错误码目录定义在 `agent/problems.go`，测试保证本页与目录一致：目录新增错误码时，必须在这里补一节。

## 出口配置

`bee run --egress-config <路径>` 读取出口配置时的错误。配置格式见 [README · Egress configuration](../README.md#egress-configuration)。

### BEE-CONFIG-NOT-FOUND

指定的出口配置文件不存在。核对 `--egress-config` 的路径。

### BEE-CONFIG-NOT-REGULAR

路径指向目录或符号链接。Bee 只读取普通文件，不跟随符号链接，`--egress-config` 需指向文件本身。

### BEE-CONFIG-PERMISSIONS

出口配置对其他用户可读或可写。配置里可能含凭证，执行 `chmod 600 <文件>`，只允许运行 Bee 的用户访问。报错会给出当前权限。

### BEE-CONFIG-UNREADABLE

文件存在但无法读取，通常是属主不是运行 Bee 的用户。

### BEE-CONFIG-TOO-LARGE

文件超过 64 KiB。出口配置只有几个字段，超过这个大小说明放入了不相关的内容。

### BEE-CONFIG-SYNTAX

文件不是合法 JSON。报错给出出错的行号和列号，常见原因是漏写逗号、多写末尾逗号或引号不配对。

### BEE-CONFIG-UNKNOWN-FIELD

出现 Bee 不认识的字段，报错给出字段名和位置。Bee 严格拒绝未知字段，避免拼错的字段被静默忽略，例如把 `home` 写成 `hom` 会导致 Codex 目录没有生效。可用字段：

| 位置 | 字段 |
| --- | --- |
| 顶层 | `targets`、`codex`、`claude`、`capabilities`、`connect_proxy`、`inbox_key_id`、`credential` |
| `codex` | `home`、`store`、`keyring_backend` |
| `claude` | `store`、`config_dir`、`refresh`、`capabilities` |
| `capabilities` | `local_url`（仅本地测试夹具使用） |

### BEE-CONFIG-FIELD-TYPE

字段类型不对，报错给出字段路径、期望类型和位置。例如 `targets` 必须是列表：`["chatgpt.com:443"]`，不能写成字符串。

### BEE-CONFIG-TRAILING-DATA

JSON 对象结束后还有其他内容。文件里只能有一个 JSON 对象。

### BEE-CONFIG-NO-TARGETS

`targets` 为空或缺失。`targets` 是这台 Bee 允许替 TEE 连接的上游地址：OpenAI 为 `chatgpt.com:443`，Claude 为 `api.anthropic.com:443`。

### BEE-CONFIG-TOO-MANY-TARGETS

`targets` 超过 16 项。只保留所供给平台的上游地址。

### BEE-CONFIG-TARGET-FORMAT

某个目标不是精确的 `host:port`，例如漏写了端口。报错给出该目标。

### BEE-CONFIG-TARGET-MISSING

配置了某个平台的账号来源，`targets` 却缺少该平台的上游地址：配置 `codex` 需要 `chatgpt.com:443`，配置 `claude` 需要 `api.anthropic.com:443`。

不拦下的话，Bee 会照常向 Hive 上报该平台账号，Hive 照常派单，Bee 却在出口白名单检查时关闭每一条连接，表现为没有原因的执行失败。按报错把地址补进 `targets`。

所有目标都是回环 IP 的配置属于本地验收夹具，用本地上游代替官方地址，不做此项检查。

### BEE-CONFIG-NO-SOURCE

既没有官方账号来源（`codex` 或 `claude`），也没有静态 `credential`。按要供给的平台添加对应来源。

### BEE-CONFIG-STATIC-MIXED

官方账号来源与静态 `credential` 同时出现。两者互斥，删除 `credential`；`codex` 与 `claude` 可以同时配置。

### BEE-CONFIG-STATIC-CREDENTIAL

静态 `credential` 不完整或格式错误，需同时提供 token、header 和 scheme。静态凭证只用于合成验收，真实供给使用官方账号来源。

### BEE-CONFIG-INBOX-KEY

`inbox_key_id` 缺失或不是 64 位十六进制。静态凭证必须提供经独立渠道核实的 TEE 收件公钥 ID；官方账号来源可以省略该字段，写了则必须格式正确。

### BEE-CONFIG-PROXY

`connect_proxy` 不是回环 IP 上的无认证 HTTP 代理。写成 `http://127.0.0.1:端口`，或删除该字段改用 `HTTPS_PROXY`。

### BEE-CONFIG-CAPABILITIES-SOURCE

顶层 `capabilities` 只用于 Codex 的模型与额度上报，需要同时配置 `codex`。Claude 的能力上报用 `claude.capabilities: true` 开启。

### BEE-CONFIG-CAPABILITIES-URL

`capabilities.local_url` 不是回环 IP 上的 HTTP 地址。该字段只供本地测试夹具使用，真实供给应删除。

### BEE-CONFIG-CLAUDE-STORE

`claude.store` 不是 `keychain`。Bee 目前只读取 macOS 上 Claude Code 的 Keychain 授权，需显式写 `"store": "keychain"`。

## 接入设置

`bee setup` 与不带出口配置的 `bee run` 给出的错误，流程见 [README · Getting started](../README.md#getting-started)。

### BEE-SETUP-NEEDED

`bee run` 既没有 `--egress-config`，设备配置同目录也没有 `egress.json`，所以 Bee 只保持在线、不供给任何账号。这是警告，`bee run` 继续运行。执行 `bee setup` 选择要上报的账号，再重启 `bee run`。

### BEE-SETUP-PLATFORM

`--platform` 里有 Bee 不支持的平台名。只能写 `openai`、`claude`，或用逗号同时写两个。

### BEE-SETUP-CODEX-NOT-FOUND

找不到官方 Codex 目录：`--codex-home`、`$CODEX_HOME` 与 `~/.codex` 都不存在。先用官方 Codex 客户端登录；目录在别处时用 `--codex-home` 指定。

### BEE-SETUP-NO-ANSWER

`bee setup` 需要确认是否上报某个账号，但标准输入已关闭，例如在脚本或管道中运行。在终端里运行，或加 `--yes` 上报所有找到的账号。

### BEE-SETUP-NOTHING

没有选中任何账号，所以没有写出口配置。确认官方客户端已登录，重新运行并对要上报的账号回答 yes。

### BEE-SETUP-WRITE

无法写入出口配置，通常是配置目录不存在或不属于运行 Bee 的用户。

### BEE-SETUP-MANUAL

已有的出口配置使用了 `bee setup` 不管理的设置（静态 `credential` 或 `capabilities.local_url`），为避免覆盖，`bee setup` 不改动它。手工编辑该文件，或用 `--egress-config` 写到别的位置。

## 设备与 Hive

`bee doctor` 检查设备配置和与 Hive 的连接时的错误。

### BEE-DEVICE-CONFIG

设备配置（`bee.json`）无法使用：权限不是 `0600`、不是普通文件、内容损坏，或其中的 Hive 地址、设备凭证格式不对。核对 `--config` 路径和文件权限；不要为排查删除配置，否则会丢失唯一有效的设备凭证，见 [README · Configuration](../README.md#configuration)。

### BEE-DEVICE-NOT-PAIRED

这份配置还没有完成配对。执行 `bee login`，在网页上确认配对码。

### BEE-DEVICE-REPLACED

另一台 Bee 已经替换了本设备，本设备的凭证已被吊销。运行新 Bee；要让这台机器重新接单，用 `bee login` 重新配对。

### BEE-HIVE-UNREACHABLE

Bee 连不上 Hive。检查本机网络和设备配置里的 Hive 地址；Hive 本身也可能暂时不可用。

### BEE-HIVE-CREDENTIAL

Hive 拒绝了本设备的凭证（HTTP 401 或 403）。确认这份配置属于当前 Hive；若无法恢复，用 `bee login` 重新配对。

### BEE-HIVE-ERROR

Hive 返回了意外的错误。稍后重试；持续出现时把错误码、HTTP 状态和时间报给市场管理员。

## 本地授权

`bee doctor` 读取出口配置里各平台官方登录时的错误。

### BEE-CODEX-SOURCE

Bee 读不到 Codex 的官方登录。报错会附带具体原因，例如 `auth.json` 不存在、存储方式选错或不是 ChatGPT 登录。用官方 Codex 客户端登录，并核对出口配置中的 `codex.home` 与 `codex.store`，规则见 [README · Egress configuration](../README.md#egress-configuration)。

### BEE-CODEX-EXPIRED

Codex 的 Access Token 已过期。这是警告而非失败：`bee run` 在线时 Hive 会调度刷新。如果供给一直没有恢复，在官方 Codex 客户端重新登录。

### BEE-CLAUDE-UNSUPPORTED

Bee 只能从 macOS Keychain 读取 Claude Code 的登录，当前系统不支持。在 Mac 上供给 Claude，或从这台机器的出口配置中删除 `claude`。

### BEE-CLAUDE-SOURCE

Bee 读不到 Keychain 里的 Claude Code 登录。用 Claude Code 登录，解锁 Keychain 并允许 Bee 读取；设置了 `claude.config_dir` 时核对它是否和 Claude Code 使用的目录一致，见 [README · Egress configuration](../README.md#egress-configuration)。

### BEE-CLAUDE-EXPIRED

Claude Code 的 Access Token 已过期。打开 Claude Code 让它续期登录，或在出口配置中开启 `claude.refresh`，运行中的 Bee 会自动同步。开启了自动续期时只作为警告。

### BEE-CLAUDE-SCOPE

Claude Code 的登录缺少 `user:inference` 权限，不能用于推理。用订阅账号在 Claude Code 重新登录。

## 出口连接

`bee run` 替 TEE 打开到上游平台的连接失败时，在默认日志级别输出带错误码的 `WARN` 行，属性含 `code`、`host` 和 `fix`，不需要开启 `BEE_DEBUG`。网络故障会让每条连接都失败，所以同一错误码和地址每分钟最多输出一行，并在下一次输出时用 `repeated` 说明期间省略了多少次。这些失败不对应到具体的买家请求。

每条输出的事件约每 10 秒批量上报给 Hive（`POST /api/bee/events`，设备凭证认证，每批最多 20 条），只含时间、错误码、目标地址和合并次数，不含流量内容或代理地址；Hive 暂时不可达时最多在内存中保留 100 条，最旧的先丢弃。管理员在 Supply Failures 页（`/admin/supply-failures`）查看全部 Provider 的事件并可按 Provider 邮箱筛选，也在调用详情的失败尝试旁看到同一 Provider 在尝试前后一分钟内的事件；Provider 看自己 Bee 的本地日志。Hive 按设备保留最近 7 天、最多 200 条。

### BEE-EGRESS-NOT-ALLOWED

Hive 要求本 Bee 连接一个不在 `targets` 里的地址，Bee 拒绝了。如果该地址属于你供给的平台，把它加进 `targets`；否则无需处理，这是出口白名单按设计工作。配置了平台却漏写其地址的情况，Bee 在启动时已经用 `BEE-CONFIG-TARGET-MISSING` 拦下。

### BEE-EGRESS-DIAL

Bee 连不上上游平台，日志附带系统给出的原因，例如 DNS 解析失败（`no such host`）、连接超时或被拒绝。检查本机网络、DNS 和防火墙；本机需要代理才能访问该平台时，在出口配置中设置 `connect_proxy`。

### BEE-EGRESS-PROXY

通过 `connect_proxy` 建立隧道失败，例如代理没有运行、握手失败或拒绝了 CONNECT。确认代理在运行，并允许 CONNECT 到平台地址。日志不包含代理地址。

### BEE-EGRESS-METADATA

Bee 读不懂 Hive 发来的连接请求，通常是 Bee 版本与市场不匹配。更新 Bee；持续出现时把错误码和时间报给市场管理员。

## 供给原因

Hive 判断某个平台不能接新单时给出的原因，见于 `bee supply-status` 与网页设备页的 `reasons`。原因码不带 `BEE-` 前缀，由 Hive 定义，名称保持不变。标注「管理员」的需要联系市场管理员处理，其余由 Provider 处理。

### `manually_paused`

该平台在本 Bee 上主动暂停了供给。需要接单时执行 `bee resume --platform <平台>`。

### `banned`

管理员封禁了该平台的供给。**管理员**处理。

### `device_draining`

本设备正在被替换，只完成手上已有的任务。运行新 Bee，旧设备排空后新设备自动接管。

### `offline`

Hive 没有看到本 Bee 在线。启动 `bee run`，并确认它能连上 Hive。

### `not_configured`

该平台没有已注册的账号，或市场没有上架该平台。如果出口配置里没有该平台的账号来源，补上后重启 `bee run`；如果已配置，询问管理员市场是否提供该平台。

### `model_unavailable`

市场上架的模型对这个账号都不可用。在官方客户端核对账号套餐；套餐应当符合时，询问管理员市场提供哪些模型。

### `authorization_unavailable`

Hive 没有本 Bee 可用的加密授权。保持 `bee run` 在线；持续出现时在官方客户端重新登录。

### `capabilities_unknown`

Hive 没有该账号最新的模型与额度报告。保持 `bee run` 在线并开启能力上报，报告通常几分钟内到达。

### `rate_limited`

上游平台正在对该账号限流。等待冷却结束后自动恢复。

### `quota_unknown`

读取不到该账号的额度窗口。保持 `bee run` 在线，Bee 会重试额度查询。

### `quota_exhausted`

该账号的订阅额度已用完，等待额度窗口重置后自动恢复。

### `plan_not_configured`

市场没有为该账号的套餐设置并发上限。**管理员**处理。

### `concurrency_full`

该账号正在运行的请求已达到套餐允许的并发数。无需处理，在途请求结束后会接新单。

### `codex_source_unavailable`

Bee 当前读不到 Codex 的登录授权。在官方 Codex 客户端重新登录，运行中的 Bee 会自动同步。

### `codex_confirmation_required`

Codex 登录切换到了另一个账号，需要确认才生效。执行 `bee account-status --platform openai` 查看待确认指纹，再用 `bee confirm-account` 确认。

### `codex_authorization_rejected`

OpenAI 拒绝了该账号的授权。在官方 Codex 客户端重新登录。

### `claude_source_unavailable`

Bee 当前读不到 Claude Code 的登录授权。在 Claude Code 重新登录，运行中的 Bee 会自动同步。

### `claude_confirmation_required`

Claude Code 登录切换到了另一个账号，需要确认才生效。执行 `bee account-status --platform claude` 查看待确认指纹，再用 `bee confirm-account` 确认。

### `claude_authorization_rejected`

Anthropic 拒绝了该账号的授权。在 Claude Code 重新登录。
