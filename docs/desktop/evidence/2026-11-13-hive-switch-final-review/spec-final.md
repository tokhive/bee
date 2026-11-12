复核：`822b43fa…50e3c12534323f998d35226fe28246ba8fec544e`；`hive_switch.rs` SHA256 为 `17bfec5561d8ef19e3a60a351eb8c6f6a669030592ad97c779ac74469e060c40`。仅复核目标屏障取消及相邻取消／提交边界。

**原 P1 已解决，未发现新确认问题。** `desktop/src-tauri/src/hive_switch.rs:1286` 现在核对所有目标 operation。confirmed draining、accepted begin 回执丢失后查询为 draining/ready，均在停止目标前持久化原请求的 cancel release 并确认匹配结果。release 回执丢失或重启查询503保留 pending，不宣称取消完成；后续只 GET 原 ID。已持久 sealed proof 保留，取消不连接或 release B，下一轮复用原 proof。原子当前索引已提交时仍直接完成目标激活，不倒退为取消。

已核对新增回归源码与既有红绿日志：两条新测试通过，受影响组23通过、1条外部验收测试忽略；覆盖下一轮成功和迟到 begin/release 不影响新屏障。fixture 已补单屏障约束。未广泛重跑测试，未新增真实 Hive 或完整原生验收声明；证据 README 与最终 Linux 记录仍由实现方收尾，不影响本次固定代码结论。
