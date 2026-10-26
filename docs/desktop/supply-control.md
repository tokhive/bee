# 桌面平台状态与暂停恢复

本增量使用现有 Hive 设备和供给 API，不修改 Hive。普通原生客户端的“概览”在核验设备归属后显示 OpenAI、Claude 两张平台卡。设备绑定和平台供给是不同状态：设备已绑定不代表贡献在线；某平台报告 offline 不代表设备未绑定。

## 怎么使用

1. 打开匹配本增量源码的普通原生开发包，进入“概览”。尚未绑定时先按[设备配对说明](device-pairing.md)完成绑定；网页确认后手动回到 Bee。
2. 已核验设备下方显示两个平台的 Hive 报告、具体原因和最后核对时间。“满足接单条件（Hive 报告）”只表示 Hive 当前报告满足条件，不表示本机正在贡献。
3. 点击对应平台“暂停”或“恢复”。暂停按当前 Hive 账号和该平台持久保存，替换设备后仍继承；不会终止已接请求。恢复只解除手动暂停，不启动本机贡献；离线、账号或授权问题仍可能阻止接单。
4. 如显示“结果未确认”，先查看同一条消息中的检查或 HTTP 证据，再点“重新核对平台”。该按钮只读取服务端现状，不重复提交修改。应用重启也只读取，不保存或重放写意图。

两平台按顺序核对。一次全部成功后等待 10 秒再读取；失败停止自动轮询，直到手动重新核对。核对中、失败和旧于 30 秒的结果不会显示为当前成功，暂停／恢复按钮仅在已验证且新鲜时启用。离开概览停止轮询；管理实例改变会丢弃旧设备和供给结果，重新核验。

此界面没有独立账号登录、开始贡献或收益功能。中英文和 860×600 最小窗口沿用现有银白布局；小窗口可纵向滚动。演示构建仍只操作本地演示数据，不调用真实设备或供给命令。

## 协议与数据边界

前端仅调用 `supply_status({platform})` 和 `supply_set_paused({platform,paused})`。平台限定 `openai/claude`，修改必须显式传 boolean。Go 使用固定独立配置，并在同一受保护配置锁内重新核对设备归属；写入成功后 GET 回读目标值，任何写入或回读不确定均失败，不自动重试 PUT。

成功为 `result.supply`，精确字段为 `hive/device_id/platform/paused/ready/reasons/checked_at`；业务失败为 `result.error`。前端检查全部字段、当前 Hive/设备/平台、显式暂停目标、UTC 时间、原因白名单及 ready/reasons、paused/manually_paused 不变量。未知字段和原因的原始载荷不写入错误，凭证始终只在 Go。JSON 重复字段由上游 Go 解码拒绝；前端接收的是已解码对象。

完整细节见[私有管理协议](bridge-protocol.md)。

## 本批验收与交付边界

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
