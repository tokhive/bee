# 目标未封存屏障取消修复证据

日期：2026-11-13，Asia/Shanghai。修复范围仅为最终规格审查确认的 P1：目标 begin 已受理，但取消只结束本地准备进程，遗留服务器屏障，导致下一轮新操作冲突。

## 源码与行为

- 基线：`822b43fafa30ee0311f6c5f90f19a5b56b4106de`。
- 实现提交：`50e3c12534323f998d35226fe28246ba8fec544e`。
- `desktop/src-tauri/src/hive_switch.rs` SHA256：`17bfec5561d8ef19e3a60a351eb8c6f6a669030592ad97c779ac74469e060c40`。
- `desktop/tests/fixtures/hive-switch-server.mjs` SHA256：`93ea1630458e382b1fc11ffc2856ec741eeaf3781b0f7cdc064eab51c25d8646`。

取消现在核对所有已记录的目标操作，覆盖 pending begin 和已确认 draining 两条路径。目标未封存时，先保存原操作对应的 cancel release 请求与动作 ID，再发送释放；只有收到匹配的释放结果才结束取消。丢回执继续保存 pending，重启仅 GET 核对原 ID，无法核对时保留未终结状态。

目标已封存时保留 Go 持久封存证据和屏障，不为取消连接目标或解除该屏障；下一轮继续复用原封存操作。索引已提交时仍走既有成功边界，不把成功改写为取消。没有 UI、Go 生产代码、真实用户配置或主工作区改动。

## 验证边界

沿用已批准的协调器 → 真实 Go 子进程 → 合成 HTTP/WS Hive 边界，所有绑定和配置都在临时目录，凭证为合成数据。没有新增完整 GUI、真实 Hive/PG、发布包或全量 Rust 验收；旧证据没有算作本次重跑。

合成 Hive 补上单一有效屏障的 409 拒绝，以及旧 release 重放不解除下一轮屏障的行为。独立语义核对来自 Hive 集成源码 `3af90513fabb4857bbd59ceaee428920e16ce21b`：`device_drain.go` 的 `checkDeviceDrainBegin` 和 `device_drain_actions.go` 的 release 动作核对。仅阅读绑定源码，未声称本次连接真实 Hive。

| 场景 | 本次证据 |
| --- | --- |
| 已确认 draining → 取消 → 下一轮成功 | 新回归 `accepted_target_begin_cancellation_releases_barrier_before_another_switch`，取消确认原 release 后下一轮可建立新屏障并成功 |
| begin 已受理但丢回执，GET 为 draining / ready | 同一回归的两种故障配置；取消后目标未连接，晚到旧 begin/release 保留下一轮屏障 |
| cancel release 已受理但丢回执 → 重启 | 新回归 `accepted_target_cancellation_with_lost_release_restarts_by_query_only`；重启 GET 503 时仍保留 pending、原 operation/release，恢复查询后 cancelled；写审计只有原 begin 与原 release 两笔，下一轮成功 |
| 已封存目标取消与已成功边界 | 既有 `cancellation_after_source_seal_returns_under_new_epoch_and_never_rewrites_success` 增强断言：保留目标原操作/回执、不连接/不 release，下一轮复用原 seal，晚到 cancel 不改成功 |
| 未受理 begin、两腿墓碑、退出、来源恢复及其他切换回归 | 本次 `hive_switch` 受影响组重新执行 |

## 命令与结果

在工作树根目录执行 `node desktop/scripts/build-bee.mjs`，实际重建绑定基线 revision 的 Go sidecar；构建校验正常启用。Go 为 `go1.27.3 darwin/arm64`，target 为 `aarch64-apple-darwin`，sidecar 的源元数据保存在 `sidecar-source.json`。Go 生产代码本次未改；Rust 测试在提交前工作树运行，最终组对应上列源码 SHA256，不能将嵌入的基线 revision 冒称为提交后的新构建。

Cargo 工作目录为 `desktop/src-tauri`，环境变量 `CARGO_TARGET_DIR=/private/tmp/bee-ticket05-target`：

1. `cargo +1.94 test --locked accepted_target_begin_cancellation --lib`：首次预期红灯；旧实现已标 cancelled，但目标状态仍 draining。见 `accepted-target-red.log`。此时循环在第一种场景停止，未声称其他分支也已跑到红灯。
2. 同一命令：最小修复后通过。见 `accepted-target-green.log`；这是初始两种场景的中间绿灯。
3. `cargo +1.94 test --locked accepted_target_ --lib`：两个新测试通过，含新增 ready 场景、release 丢回执及重启。见 `target-cancel-green.log`。
4. `cargo +1.94 test --locked hive_switch --lib`：最终源码 **23 passed / 0 failed / 1 ignored**。见 `hive-switch-green.log`。忽略项为原有真实双 Hive/PG 验收，日志已明确所需环境，未执行。
5. `git diff 822b43f HEAD --check`：实现提交通过；最终含证据检查使用 `git diff 822b43f --check -- . ':!docs/desktop/evidence/2026-11-13-hive-switch-target-cancel/*.log'`，源码及说明通过。原始 Cargo 绿灯日志末尾自带空行，全量空白检查会报告三处 EOF 空行；原始日志按实际输出保留，没有调整 Git 配置或跳过 hook。

`cargo-invocation-error.log` 如实保留首次误在 `desktop/` 执行 Cargo 的目录错误；不算测试红灯。既有 sidecar `dead_code` 提示保留，没有通过忽略构建校验消除提示。提交后未再运行 macOS Cargo；下一次 Cargo 必须先为新 revision 重建 sidecar。

Linux cfg 最终验证由主代理在 Docker 隔离环境执行：`cargo build --locked --offline --lib -j 1`，显式设置 `CARGO_PROFILE_DEV_DEBUG=0`、`CARGO_INCREMENTAL=0`，结果 **exit 0 / 56.05s**。`linux-compile.log`、`linux-source-manifest.json`、`linux-compile-facts.json` 记录完整命令和范围；复制的 53 个 Rust 文件已按 manifest 核对与实现提交一致，源提交为 `50e3c125…`，私有验证 clone 基线为 `9a254fb4…`。这仅证明 Linux Rust cfg 编译，未扩大为 GUI、前端重跑或真实 Hive 验收。

首轮因命令遗漏上述两个 profile 环境变量而触发依赖重编译，主代理主动停止（exit 137）；这次人为停止不作为源码失败或通过证据。事实归档为 `linux-first-attempt-facts.json`，原始日志保留在 `/tmp/bee-hive-url-switching/target-cancel-linux/`。

## 资源与清理

本轮没有浏览器、预览服务器或用户 App 操作。测试的合成 Hive 和 Go 子进程均已退出；未清理无关缓存。`/private/tmp/bee-ticket05-target` 已结束本轮 Cargo 使用，可交回主代理复用。新 worktree 的忽略文件 `AGENTS.md` 保留有效主规则引用；本轮生成的 sidecar 二进制与元数据已从本工作树的忽略构建目录删除，元数据证据保留在 `sidecar-source.json`。
