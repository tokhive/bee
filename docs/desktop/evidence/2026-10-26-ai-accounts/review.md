# 账号批次审查与修复

审查基线为 `cdf987c`，产品基线为 `24aca16`，覆盖全部本批改动及行为路径上的既有调用方。实施由当前会话按 `executing-plans` 完成；独立代理仅承担只读审查，不承担实现。

## 完整路径范围

| 入口／对象 | 逐层核对的字段与最终行为 |
| --- | --- |
| 默认来源及手动检测 | platform、directory 的 null／绝对路径、store、mode → 固定官方读取器 → 候选修订、指纹、套餐、过期；默认加载不打开凭证 |
| 官方观察 | 凭证版本、来源命名空间、身份、scope → 固定 GET／禁重定向、客户端版本辅助读取 → 查询后重新读来源 → 缓存／公开能力；不刷新／写回授权 |
| Hive 观察 | device／owner／Hive → identity → account/capabilities/account；核对 fingerprint、generation、credential_revision、状态和 pending；丢弃变化组 |
| 提醒 | 已核验归属／指纹／问题 → 60 秒离线门槛 → 去重键与明确恢复 → 私密文件、锁序、原子写和读回；失败不冒充持久化 |
| 私有桥 | 精确字段与显式 null／boolean → Go 固定方法与业务错 → Rust 2/4/6/10 能力组、实例与含排队期限 → TS 逐字段解码 |
| 页面与共享供给 | 来源编辑／旧 Promise → 独立事实与错误 → 共享 pending 门禁／新鲜度 → 最终 PUT 后 GET；未知写不自动重放，部分成功不被覆盖 |
| 副作用门禁 | 接入／换号／撤销／移除的参数及候选修订 → 缺失运行证据 → 在写 Hive、保存选择或启动贡献之前拒绝 |

## 逐任务修复

- 查询后读来源失败使用 `unconfirmed/source_readback`；只有已证明不一致才报告 `source_changed`。scope、HTTP 和 OS 失败均保留本次安全证据。
- Hive 公开 `pending_fingerprint/generation`，未确认时为 null；confirmation_id 不进 DTO。pending 同时进入概览和账号页的恢复门禁，仍允许暂停及 GET。
- 设备核对失败独立显示，本地检测仍可操作；供给写继续受设备门禁保护。
- 未知套餐使用 null 公开，保留 `unknown_plan` 状态；避免 Go 合法结果被 TS 套餐白名单拒绝。
- 各观察子域分别显示错误；候选自然进入到期前 30 秒时失效；历史额度过期不覆盖 Hive 当前 `rate_limited`。
- Rust 请求使用包含排队的绝对期限。未发请求取消后不迟发；已发超时先撤销 ready，调用方不等待子进程回收。session 发前／收后再查共享失效状态，迟到成功不能恢复会话或放行排队写。
- 共享全部操作每次实际发送前重查 blocked／pending／新鲜度；逐平台保留结果，失败后仅允许显式 GET 核对。

## 最终完整路径新增发现

两项均为可复现 P2，来自原有 helper 接入新账号观察的完整路径。没有只看 diff 而忽略未修改 helper。

1. **模型缓存 FIFO 阻塞。** `cachedCodexVersion` 原用 `os.Open` 读取 `models_cache.json`。合成 auth.json 配合 FIFO，使完整官方检测在 50ms context 取消后仍卡住，300ms 手动释放才返回。改用既有 `openRegularNoFollow`：非阻塞打开并核对普通文件，拒绝 FIFO 和符号链接，保留正常缓存版本与安装版本选择。`TestDesktopAccountsOfficialMetadataFIFO` 和 `TestCachedCodexVersionRejectsSymlink` 已观察原代码红灯；修复后官方定向 race 通过。独立旧复现于约 635 微秒返回。
2. **版本命令后代占住输出管道。** OpenAI／Claude 的 `--version` 包装器启动后台子进程后退出，原 `CommandContext.Output` 仍等输出 EOF。完整检测使用 2s context、4s 后台测试进程及执行 marker，原代码分别耗时 4.411s／4.397s。两处设置 `WaitDelay=100ms`，同时约束直接进程和输出管道等待；不能取得可信版本时沿用既有安全默认值，不枚举或查杀其他进程。回归为 `TestDesktopAccountsOfficialVersionPipeDeadline`，恢复真实版本函数且断言 marker，避免脚本未启动的假绿。

复测命令：

```sh
go test -race ./agent -run 'TestDesktopAccountsOfficial|TestCachedCodexVersionRejectsSymlink|TestOpenAI|TestCodexOnPath|TestLocalClaudeVersion|TestClaudeCapabilit' -count=1
go vet ./agent
```

所有凭证、官方响应、版本脚本和服务器均为合成／本地测试。真实来源、Keychain、真实联网和跨 OS 验收不在本轮审查证据内。

最终复核结论：完整路径审查无剩余 P1/P2。主会话执行上述定向 race（2.555s）及 vet 通过；独立旧复现确认包装器实际执行，OpenAI／Claude 分别约 504ms／494ms 返回，FIFO 约 1.2ms 返回。
