# 07: 取消、退出和重启继续原切换

**What to build:** 用户取消和退出意图被保存；崩溃后核对原操作，不重复写入或丢失配对子事务。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 06 App 执行 A→B→A 的持久切换

**Status:** done

- [x] 取消与提交串行；未知保持占位，已成功不能改成取消成功。
- [x] 主动退出可继续等待／取消并退出；意外崩溃继续，重启不刷新预算。
- [x] 2 秒查询／60 秒观察／首次失败后最多三次重试；旧响应与通知带 profile／instance 归属。

实现还补齐首次错误 URL 的安全修正：仅原初始配对尚未提交且确证无绑定、未知配对、运行及恢复证据时，切到新的空 profile；旧目录、凭证和记录保留。历史列表归属只读取本地保存 identity，标为上次归属，不遍历远端、不暴露凭据。

验证：Rust `hive_switch::tests` 19 项、`notification_poll::tests` 11 项、启动恢复／runtime 退出／lifecycle／相关 sidecar 44 项全部通过；最后 Go 改动后的 `TestDesktopSwitch|TestDeviceDrainClient` race 通过。真实 built Go children 配合两套明确的 synthetic HTTP／WS fixture，覆盖原 ID 取消与重启、未知写只 GET、sealed 后新 epoch 返回、成功后迟到取消、Q9 退出保留脏 guard、查询预算、首次地址修正和本地归属投影。原生菜单／系统退出真实 GUI、双真实 Hive／Postgres／任务结算已由 09 单独验收，未以本票合成结果代替。最终审查还补齐未知 begin 和目标未封存屏障的取消恢复，见最终交付记录。
