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

本文件随 Task3 客户端源码提交。最终匹配源码 Mac 包、来源提交/hash、旧包备份、签名及签名包专项、包内真实只读协议与供给冒烟、CUA 原生图形验收由主控收尾，当前尚待记录，不能将此前设备配对包视为本增量交付证据。Windows/Linux 原生矩阵及已有 P0/P1 缺口继续保留；本批不发布生产版本。
