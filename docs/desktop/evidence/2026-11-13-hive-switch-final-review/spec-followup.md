复核：集成 `822b43fa`，与修复源 `fb26377` 同树；仅复核原三项及取消边界。

1. **[P1] 取消仍遗留目标未封存屏障。** 规格105/109行要求单一有效屏障且重启只核对原操作。可复现时序有两种：B `work.executions=1`，begin 确认 draining 后取消；或 `faults.begin=1`（受理后断开），pending begin 时取消。`desktop/src-tauri/src/hive_switch.rs:1286` 只核对 pending；第二种由 `:1291` 的 GET 清掉 pending。两者均在 `:1297`–`:1303` 未 release 即停 B、宣称 cancelled。Go 仅保存有封存回执的 proof（`agent/desktop_switch.go:450`）；下一轮 `hive_switch.rs:1650` 无 proof 而换新 ID，真实 Hive `hive/internal/service/device_drain.go:158` 返回屏障占用409。B 被旧屏障卡住，终态取消记录也不再恢复。新增测试仅覆盖 `begin_before_accept`。absent 的双腿墓碑修复通过。
2. **历史 URL 冲突通过。** 登记和旧索引读取均投影局部 blocker，start 在准备前拒绝，原 A 可用，界面解释冲突。
3. **通知来源通过。** 来源贯穿账本、正文与三平台点击；原生读取持久当前 profile，前端复核，跨 Hive 仅提示来源。

依据源码和既有定点日志；未重跑广泛测试，未新增真实 Hive/完整原生验收声明。
