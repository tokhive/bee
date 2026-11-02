# 桌面平台状态与暂停恢复

当前桌面使用 Hive 设备和供给 API，并显式请求 `reason_detail=1`；Hive 保持旧请求的原因集合与准入语义。“概览”和“AI 账号”共用 OpenAI、Claude 平台行。设备绑定和平台供给是不同状态：设备已绑定不代表贡献在线；某平台报告 offline 不代表设备未绑定。

## 怎么使用

1. 打开匹配本增量源码的普通原生开发包，进入“概览”。尚未绑定时先按[设备配对说明](device-pairing.md)完成绑定；网页确认后手动回到 Bee。
2. 已核验设备下方显示两个平台的 Hive 报告、具体原因和最后核对时间。“满足接单条件（Hive 报告）”只表示 Hive 当前报告满足条件，不表示本机正在贡献。
3. 点击对应平台“暂停接单”或“恢复接单”。暂停按当前 Hive 账号和该平台持久保存，替换设备后仍继承；不会终止已接请求。恢复只解除手动暂停，不启动本机贡献；离线、账号或授权问题仍可能阻止接单。
4. 如显示“结果未确认”，先查看同一条消息中的检查或 HTTP 证据，等待已安排的自动读取，或使用错误对应的核对入口。核对只读取服务端现状，不重复提交修改。应用重启也只读取，不保存或重放写意图。

两平台独立读取，同平台请求不重叠；每次完成后等待 10 秒再读取，失败也按实际调度自动重试。新鲜报告后台读取时保留当前事实；失败或超过 30 秒后隐藏旧可接单结论并禁止依赖该报告的写入。概览与 AI 账号页共用同一份状态；管理实例改变会丢弃旧设备和供给依据，重新核验。

账号观察增量见[AI 账号说明](ai-accounts.md)；换号未决的平台禁止恢复，仍可暂停及 GET 核对。设备绑定、官方登录、账号接入和开始贡献各有独立流程；页面不显示推测收益。中英文和 860×600 最小窗口沿用现有银白布局；小窗口可纵向滚动。演示构建仍只操作本地演示数据，不调用真实设备或供给命令。

## 协议与数据边界

前端仅调用 `supply_status({platform})` 和 `supply_set_paused({platform,paused})`。平台限定 `openai/claude`，修改必须显式传 boolean。Go 使用固定独立配置，并在同一受保护配置锁内重新核对设备归属；写入成功后 GET 回读目标值，任何写入或回读不确定均失败，不自动重试 PUT。

成功为 `result.supply`，精确字段为 `hive/device_id/platform/paused/ready/reasons/checked_at`；业务失败为 `result.error`。前端检查全部字段、当前 Hive/设备/平台、显式暂停目标、UTC 时间、原因白名单及 ready/reasons、paused/manually_paused 不变量。未知字段和原因的原始载荷不写入错误，凭证始终只在 Go。JSON 重复字段由上游 Go 解码拒绝；前端接收的是已解码对象。

### 详细原因契约

桌面 Go、Rust 与 TypeScript 解码器同时接受旧原因和下列详细原因。`beewire.DetailedSupplyReasons()` 返回两者并集；`SupplyReasons()` 保留原有 19 项，旧网页与 CLI 的默认集合不变。桌面 GET、PUT 及写后 GET 都携带 `reason_detail=1`；PUT JSON 仍只有显式 `paused`。旧 Hive 忽略参数时严格接收旧原因，不猜测细分原因。

| 原因码 | 已确认事实 |
| --- | --- |
| `account_not_registered` | Hive 没有对应平台账号记录；不代表本机未接入 |
| `market_not_open` | 平台全局市场没有符合发布、价格和协议条件的可交易模型 |
| `supply_not_enabled` | 设备没有有效静态供给，平台动态供给也未配置；由管理员处理 |
| `supply_device_restricted` | 同一所有者的平台静态绑定指向其他设备；由管理员核对绑定 |
| `account_not_admitted` | 当前账号指纹不在动态供给允许集合中；不返回其他账号或允许集合 |

`model_unavailable` 继续表示市场已开放但该账号或供给没有可用模型；`authorization_unavailable` 仅表示没有可用加密授权，不据此推断正在同步。诊断报告、原生日志和导出保留上述安全原因证据。未知原因、重复原因、跨平台账号原因，以及 `ready`／`paused` 与原因列表矛盾的供给对象仍被拒绝。

完整细节见[私有管理协议](bridge-protocol.md)。

## 2026-11-03 交互清晰度验收

最终组件、模拟 IPC、真实最终 Bee/Hive HTTP、数据库和有限原生包专项分别登记在[76 项台账](interaction-clarity-validation.md)。真实协议组合包含新 Bee／新 Hive、旧请求／新 Hive，以及忽略详细参数的旧响应处理器；签名更新和官方上游请求不在这些通过结论内。

## 历史增量验收与交付边界（2026-10-24 至 10-26）

客户端自动测试仅对本地原生 IPC fixture 执行暂停／恢复，不修改用户真实 Hive 平台状态或设备配置。执行入口：

```sh
npm --prefix desktop run test:device
npm --prefix desktop run typecheck
npm --prefix desktop run build
npm --prefix desktop run build:demo
npm --prefix desktop run test:bridge
cd desktop
npx playwright test navigation.spec.ts onboarding-overview.spec.ts settings-diagnostics.spec.ts lifecycle-ui.spec.ts --project chromium
```

本批源码与自动化验收已完成，完整行为路径独立复核 C/I/M 为 0/0/0。最终 Mac 包绑定源码 `24aca16f37e9fa17f843d1c300786056a2b083a1`，版本 `dev+24aca16f37e9`；后续文档提交不改变包内版本。

- App：`desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`。旧包已正常退出，完整备份保留在 `.cache/supply-control/previous/Bee Dev.app`，没有复制或覆盖设备配置。
- ZIP：`.cache/supply-control/Bee-Dev-macos-arm64-24aca16.zip`，23,021,577 字节；SHA256 `6464759e020c95ab1983e79f1cec24e9388bead1aa0ce643239871180dfec024`。CRC、全部 App 文件字节和两程序可执行权限均已核对。
- `codesign --verify --deep --strict` 通过；2 项签名包专项通过，涵盖包内 Bee 握手/ping/回收与篡改拒绝。仅 ad-hoc 开发签名，未公证或生产发布。
- 最终包内 Bee 真实执行 hello → OpenAI GET → Claude GET → ping → shutdown，两个平台均通过严格校验，exit0、stderr0、设备配置字节未改。OpenAI 未就绪原因是 offline、codex_source_unavailable、authorization_unavailable；Claude 是 offline、authorization_unavailable。没有发送 PUT，也未启动贡献。
- 自动测试：Go 全量7包及 vet；设备/供给 race；最终供给定向回归；Rust普通51项和上述签名包2项；工具37项；前端初次设备/供给单元8项（后续供给单测8项）、页面17项、桥10项及相关旧页面89项；typecheck、普通/demo build 通过。各轮源码和后续窄修覆盖见[验收记录](evidence/2026-10-24-supply-control/README.md)，不把旧轮结果冒充最终源码全量重跑。
- **2026-10-26 已补验新版 Mac 界面。** 用户显示窗口后，核对了已绑定设备、两张真实平台卡、手动刷新时的核对中/禁用状态、成功时间更新、失败时隐藏旧成功与禁写、诊断版本、导航及中英切换。语言已恢复为原来的“跟随系统”，界面已交还用户正常使用。完整证据见[原生补验记录](evidence/2026-10-26-supply-native/README.md)。连续联网稳定性未通过：成功查询后出现HTTP409，再有EOF；独立Go只读诊断也报TLS握手失败，具体根因尚未确定，不能据此断言是Hive或客户端故障。

现在可以正常操作电脑和 Bee，不需保持窗口或等待测试。查看状态时进入“概览”向下滚动到平台卡；如果显示未确认，可点“重新核对平台”只读查询，不需重新配对。真实暂停/恢复未在本轮点击。以后只有明确收到“请暂停操作”的通知才需停手，测试结束会明确交还。

Windows/Linux 本增量原生界面、已有 P0/P1 环境矩阵和其它缺口继续保留。来源、签名、只读证据及未验收项见[交付清单](evidence/2026-10-24-supply-control/manifest.json)。
