# Hive 会话安全结束配套补丁

状态：已在独立 Hive 分支 `fix/runtime-session-retirement` 集成；真实 Rust → Go sidecar → Hive HTTP → PostgreSQL 的五个隔离场景通过。Hive 主工作区未修改，未部署，未对真实账号执行恢复。

独立 checkout：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/hive-session-retirement`。当前已推送 [Hive PR #292](https://github.com/tokhive/hive/pull/292)，验证源码提交为 `58db70fdc9ed286de85f9b1ea7d98137e0ada2ec`，PR head 为补充验证记录的 `b13db702df61bba3f8d0da5fab90fb43332b41f9`，该分支已同步 `main` 基线 `db4b2a5`；共享协议依赖已发布为 Bee 提交 `c8f628af3fa662df36b1f5705e5871ba9a1159d9`。迁移已顺延为 `078_supply_preparations.sql`、`079_runtime_recovery.sql`。PR 已可评审。本地 `go vet`、全部非数据库包的竞态测试、准备／归属／详细原因／调度／官方 API 的数据库目标回归通过，五场景跨进程联调与四个 Hive HTTP／DB 测试重新通过（35.439 秒），干净远端克隆可获取子模块；远端 CI 因 GitHub 账户付款／支出上限未能启动。同步 main 后的验证证据位于 Hive 的 `docs/evidence/runtime-recovery-pr-292.txt`。部署、迁移、回滚边界与复跑步骤见 Hive checkout 的 `docs/runtime-recovery.md`。

## 历史补丁与基线

- `hive.patch`：Hive 服务、HTTP 入口、调度候选过滤、数据库迁移、四个 HTTP／DB 测试和五场景跨进程测试入口。
- `bee-wire.patch`：Hive 的 Bee 子模块需要的共享协议文件；当前 Bee worktree 已有相同源码。
- `source-manifest.json`：Hive 基线 `f5950789b1f89d9b8cee5557429f90e129a6de30`、Bee 子模块基线 `6fccf3b11a2a430075e4e23634eda4913e3ced08` 和各文件 SHA-256。

以下补丁与 manifest 中的 `integration` 保留原基线和原提交，仅用于复现历史证据，不代表当前 PR 快照；`published_integration` 记录发布版本。两份补丁已在上述真实基线上检查，并在独立 checkout 实际应用；共享协议先独立提交，再更新 Hive 子模块引用。`source-manifest.json` 记录原文件与集成源码哈希。迁移 `068_runtime_recovery.sql` 已随真实 Hive 启动机制在各隔离 schema 执行；部署仍需沿用正常迁移机制，若编号已占用，应按实际分支重新编号。

## 协议与隔离保证

`GET /api/bee/runtime-recovery/{operation}` 读取原操作，`POST` 以同一 ID 推进结束流程。请求固定原 epoch、run、账号范围摘要及各平台原准备 ID／指纹。无记录的 GET 返回 `absent`，必须读主数据库；同 ID 改参数或新 ID 抢占未决恢复返回 409。

设备写请求及 WebSocket 带 `X-Bee-Runtime-Epoch`。旧写先获准时，结束流程等待其返回；随后持久化新 epoch 和未决恢复 ID，拒绝迟到的旧代／无代请求。停止并 join 旧连接，再按现有 `deviceHasUnfinished` 核对执行和结算；未决或终止未知时保留 `draining`。调度的单设备与批量候选查询均排除 pending 设备。

原准备记录的 ID、设备、账号指纹必须一致；结束时只取消对应准备、清除其引用，不写 `paused`，不重写终态、不换设备。只有所有检查成功的事务提交后才返回 `retired` 证明。冲突保留原保护和 epoch 屏障。

当前部署模型要求同一设备的连接与调度由单个 Market 进程拥有。请求排空采用进程内 gate，epoch 和原操作采用 PostgreSQL 持久化；这不能证明多个 Market 同时拥有同一设备时的分布式隔离。部署前必须核对该前提。

## 兼容与发布顺序

先部署支持新协议的 Hive，再使用新版 Bee 验证恢复。Hive 尚无 epoch 行的设备仍接受旧客户端，第一次成功结束旧会话后只接受新 epoch。旧 Bee 不会自动取得新 epoch；不能把退回旧版本作为恢复办法。已有设备使用 epoch 后，也不能回滚到不执行该隔离校验的旧 Hive，否则迟到旧请求的隔离保证失效。

新版 Bee 将 `runtime_epoch` 写入原私有设备配置。旧版 Bee 使用严格解码器，无法读取该新增字段；不要手工删除字段、回滚配置或清除保护绕过隔离。设备绑定、账号和暂停选择保持原语义。

旧版 Rust 恢复记录若缺少持久设备绑定摘要，不能仅用跨进程恰好相同的 revision 结束未知提交；新版保留阻塞和原证据。新记录保存绑定摘要后可在取得同设备真实证明时结束旧会话，原操作未知结果仍保留。

## 验证

首轮隔离源码副本保留在 `.cache/startup-stall/hive-session-retirement` 作为历史；当前正式集成源码使用上述独立 Hive checkout。专用 PostgreSQL 18.1 容器只用于测试，各测试独立 schema。Hive 主工作区保持原状态。

```sh
TEST_DATABASE_URL='postgres://postgres@127.0.0.1:15439/postgres?sslmode=disable' go test -race ./hive/internal/integration -run RuntimeRecovery -count=1
go test -race ./hive/internal/service ./hive/internal/controller ./hive/internal/router -run RuntimeRecovery -count=1
```

覆盖已准入写排空、旧 WS 关闭、暂停保持、旧 epoch 拒绝、Market 重建后的持久隔离、同 ID 重放与改参数、未决执行／终止未知、原准备指纹冲突及保护保持。日志、App 与未验收范围见[验收报告](../../evidence/2026-11-11-startup-recovery/README.md)。该测试不证明真实 Hive 已升级或真实账号已恢复。

完整跨进程验收在包含桌面实现的 Bee worktree 中运行：准备专用回环 PostgreSQL，并设置 `TEST_DATABASE_URL`，再执行：

```sh
python3 scripts/test-runtime-retirement.py --hive /absolute/path/to/hive-checkout
```

脚本构建真实 Rust 测试协调器与 Go 管理 sidecar，并运行五个跨进程场景和四个 Hive 集成测试。包括未知 journal 归档、成功后回执丢失、draining 后实际中断子进程再继续、冲突保护和退出竞争；全过程零暂停写，原选择保持，旧代写拒绝。官方登录／额度使用合成边界，未验收真实账号与打包窗口。
