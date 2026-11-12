审查范围：Bee `5d16ad8...98c5ded`、Hive `4f03ed7...3af9051`；已核对批准规格、01–09 任务、共享协议、主要实现和三份验收记录。

1. **[P1][c] begin 丢失后无法取消。** 规格第107行要求：“取消一个尚未到达的 begin 需要持久终结标记”。`desktop/src-tauri/src/hive_switch.rs:1569` 对 pending begin 的 absent 状态直接返回未确认；源取消在 `:1970`、目标取消在 `:1277` 均必经该门禁，无法发出 cancel release。触发：begin 未到服务端，用户取消；操作永久占位，源阶段还会保持 A 冻结。`:2745` 的测试甚至明确要求此时没有 POST。服务端已有墓碑能力，但客户端未使用。

2. **[P2][a] 历史 URL 冲突未局部阻塞或提示。** 规格第53行要求：“对冲突项禁用切换并给出明确冲突信息”。`desktop/src-tauri/src/profiles.rs:942` 收集冲突，`:1153` 仅保存；`:412` 的注册不检查它，`:435` 仍创建空 blockers。`desktop/src/features/hive/HiveSwitchControls.tsx:20` 也只显示、禁用 blockers。触发：旧历史包含归一化等价的两个 B origin；迁移后添加 B 仍能配对和切换，用户看不到冲突。

3. **[P2][a] 已投递通知丢失来源。** 规格第69行要求：“通知携带来源 profile，切换后不得把 A 的通知解释成 B 的问题”。`desktop/src-tauri/src/notification_poll.rs:151` 构建 Notice 时不附 profile；`notifications.rs:505` 的点击路由只保留页面和摘要，`:515` 丢弃摘要；`lib.rs:146` 无条件导航。触发：A 的授权／额度通知已投递，切到 B 后点击它，会打开 B 的账号页，正文也未标明 A。现有 scope 检查仅保护投递前的迟到样本。

未发现特性新增越界行为。其余核对涵盖固定 profile、双层准备白名单、最终准入、执行／结算事实、封存回执、索引提交窗口、Q9/预算与无账号激活。真实四场景协调器链及 Linux GUI 记录支持已声明范围，未将模拟故障矩阵算作真实 GUI 全覆盖。
