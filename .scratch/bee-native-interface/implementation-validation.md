# 原生自动服务实施验证

2026-11-05 开始实施，2026-11-06 完成最终回收补验。基于 `260318b` 开始实施。此文件记录已执行证据，不用 mock 或受控替身代替生产 Hive、真实官方客户端及各系统原生验收。

## 01：零账号等待

- Go：零账号 Restore/Start 最终为 `local=waiting`、`run_id=null`，不创建平台 worker、不发布授权、不改暂停；已有 presence 继续维护设备连接。首次官方登录允许 waiting，但不自动接入。
- 保护：未决账号操作、脏会话、坏文件及不明 guard 均保留并阻断。账号文件读取失败仍记录独立 dirty guard，避免后续保存失败后错误恢复。
- 契约：Go→Rust→TS 共用现有快照字段，仅新增 `local=waiting`；Rust 等待原启动操作最终结果，并接受已确认的 waiting。诊断明确记录 `runtime_waiting`，不会误报运行成功或未知故障。
- 前端：waiting 显示正常等待和账号入口，去掉无效的开始贡献动作；首次登录仍检查来源、修订、实例与运行上下文。

已执行：

- `go test -race ./agent -run '^TestDesktop(AutoService|Presence|Runtime|Upgrade|Authorize|DeviceRecovery)' -count=1`：通过，22.935s。包含真实 WebSocket 受控 Hive、官方登录进程替身及故障注入。
- `go test -race ./agent -run '^TestDesktopDiagnostics' -count=1`：通过，2.302s。
- Rust `runtime_protocol::tests`：6 通过；`startup_restore`：4 通过；`diagnostics_native`：3 通过。侧进程使用测试替身，严格契约及操作归属为真实实现。
- TS runtime、accountPresentation、desktopStatus、diagnostics：71 通过；`npm run typecheck` 通过。
- Playwright waiting→账号页→首次 Claude 登录：1 通过（2.0s）。前端命令记录为 authorize_start=1、runtime_start=0、account_action=0。
- Ego 实际浏览器独立走查同一路径：正常等待与首次登录反馈可见；同样未发送启动/接入写请求。浏览器使用 native fixture，属于前端验证。

尚未执行：正式 WebView 经 Tauri/Go 到受控 Hive 的组合流程、生产 Hive、真实官方客户端、三系统托盘/窗口验收。最终组合流程纳入 11，其他真实环境限制在最终交付时保留。

## 02：接入后自动维护

已实现 waiting 下明确接入后的原生自动维护，账号 worker 完整发布并释放平台 gate 后再启动，不新增命令或 DTO。当前 v3 的明确停止、失败状态、退出屏障及未决账号事务不会被自动升级；旧 v2 的一次转换遵守下方 09 规则。

7 项公开行为通过：首账号接入后自动维护且暂停；第二平台接入不重启运行/连接；每份授权响应返回前由 Hive 即时派流，真实 relay/CONNECT echo 成功；另一平台并发失败后首平台继续准备；接入中退出不复活；旧停止不自动升级；未知接入只核对原事务并保留错误；准备失败后无需重复接入，可明确重试原运行准备。其中时序证明与第二平台测试合并为一个用例。

`go test -race ./agent -run 'TestDesktop(AutoMaintenance|AutoService|Presence|Runtime|AccountSelection|AccountChange|Upgrade)' -count=1 -timeout=90s`：通过，20.388s。全量 TS 单元测试 315 通过；Rust `cargo test --lib`：268 通过、2 ignored（36.73s）；waiting UI 定向 Playwright 通过。这里的 Hive、官方源及转发目标均为受控替身，不是生产接单验收。

## 09：旧意图兼容决策

用户已明确同意：旧记录为“没在运行”的已接入账号升级后统一先暂停，自动维护登录，等待用户逐平台恢复。仅转换一次；不推断旧 false 的停止来源，不清理未决/归属/脏状态保护。原生一次转换与严格跨层契约已实现，详见下方 03／09 记录。

## 10：外部前置

仍未定义创建未知且未取得原 token 时的 Hive/人工恢复证据契约。当前保留 needs-info，不伪造恢复路径，不重放创建或采用任意 token。


## 03／09：保留选择与旧停止转换

原生验证明细见 [03／09 证据](validation/03-09-native.md)。03 使用当前 Hive 平台事实恢复，不以旧 resume 名单解除暂停。Relay 在授权上传前就绪；新暂停优先于旧恢复。09 使用账号文件 v3，严格读取 v1/v2，首写前保留 v2 备份；旧 false 的已选平台先确认暂停，转换完成后才自动维护，同一 scope 只转换一次。

09 的 `legacy_stop.can_recheck` 表示继续用户已批准的原转换：已提交步骤只 GET，原来从未提交的步骤修复并重新验证后允许首次提交。04／05 的 `login_maintenance.can_recheck` 则只核对原登录维护，不重放暂停和官方登录。两者均不代表解除暂停。

## 04：主动登录维护

登录只隔离目标平台，保留另一平台和已有请求的事实；同号核验后恢复维护，异号等待明确确认。`login_maintenance` 为账号必需 nullable 字段，保存原 authorize 结果、维护阶段、来源、开始时间、错误及核对能力，Go→Rust→TS 严格解码。原成功／失败／取消／未知与维护是否恢复分别表达。

独立审查发现并修复两项 P1：跨平台 journal 保存失去更新、完成证据未落盘便提前解除隔离。前者补独立事务锁和公开双平台 24 轮并发回归；后者以真实目录占据文件路径注入最终保存失败，确认失败仍隔离、不能恢复接单，修复后只读核对可继续。`TestDesktopLoginMaintenance` race 通过，11.084s。

列表和详情提供维护核对入口；有 journal 时直接 `account_snapshot(refresh=true)`，不会先查询新实例并不拥有的旧登录 job。维护未完成时禁止新登录与恢复接单；异号阶段保留明确确认换号入口。

## 05：中断后的原维护恢复

Unix 由独立 Go guardian 监听管理进程独有的 lifetime pipe writer；取消和父进程突死均先停止并核对 owned 登录组成员，再 KILL、确认无活成员，最后才回收保留 PGID 的 leader 并释放私有 flock。观测或信号失败时先报告具体清理错误，guardian 继续保留 leader／guard，OS 观测恢复后只清理同一 owned 组。恢复只在取得该原操作锁后读取来源。Windows 使用私有 named Job／KILL_ON_JOB_CLOSE 及原操作 guard；Windows、Linux 仅交叉编译，未原生执行。私有 journal 绑定持久 Hive／owner／device／binding_digest，先经过原 dirty session／guard 保护才恢复目标平台。原 pending／running 跨进程保留同一 ID 并转为 unknown，原 failed／cancelled／succeeded 保留；维护恢复不改原结果。

受控真实管理进程 SIGKILL 后，旧 owned 命令不能在释放闸门后再写官方来源；新实例读回同一 journal，能恢复原身份维护或保持目标平台受阻，另一平台继续自己的有效维护。新来源 Detect 不被旧恢复覆盖；损坏 journal 不遮蔽已完成的 Stop receipt；纯来源读取在 journal 缺失时不取得默认设备写锁。

启动恢复与 Snapshot 手动核对共用 worker 所有权；Stop 取消并 join，mark 失败始终清理 activeActions。真实 HTTP 门竞争两项先 red 后 green，分别证明不会永久 busy、不会覆盖另一恢复的终态。确认换号已保存而最终 journal 保存失败时，保留原 pending 关联，只读继续核对，不重放 confirm 或供给写。最终 Go 全量通过。全量检查暴露的既有终端 fork 回收问题已修复：原取消用例连续 100 轮通过且保持 1 秒 EOF 断言；另有 24 轮取消 fork、12 轮管理进程真实 Kill fork、异常观测／信号失败保锁，以及生产 Bee 固定私有 CLI 入口验证。具体 RED 对照和进程／guard／无迟写证据见 [05 原生验证](validation/05-login-recovery.md)。

## 06：窗口与自有退出

沿用 close→hide、tray/reopen；明确 app_exit/update 先冻结后续启动、恢复和连接工作，再取消并 join 自有登录／运行工作，最后保存停止与回收证据。回收或保存失败不得返回干净成功。最终诊断先持久化，再释放 singleton；前端严格日志白名单贯通 owned_exit_started/completed/unconfirmed。

已执行 Go Exit race 及 Runtime／Presence／Upgrade／Authorize 回归；Rust runtime 11、lifecycle 7、diagnostic_log 9、sidecar owned_exit 2 通过。未执行三系统实际托盘／窗口找回与安装包退出验收。

## 07：网络应用

保留原保存／生效／停止／恢复公开状态。新增真实回归证明：配置核验期间若用户保存新修订，旧回调不得 Restore。现在返回 `NETWORK_SAVED_CHANGED`，同时保留最新保存值和已核实生效值，服务保持已确认停止。独立审查补齐 Stop／Configure／Restore 成功阶段严格推进、bootstrap 严格推进、失败查询不倒退共五项 red→green；最终 network 43 项通过（23.58s）。

## 08：更新安装

仅在有效安装准入已经持久化之后、返回安装 ticket 之前同步冻结 owned restore。正在进行或迟到的 startup verify 不得覆盖 Stopping 或重新拉起服务。检查、下载及被拒绝的安装确认不会冻结服务或改变平台选择。

Rust update_install 17、updater 18 项通过。测试通过临时签名、真实 HTTP、真实 IPC 下载检查受控服务保持运行与选择不变；不等同于生产签名、三系统安装或真实更新源验收。

## 11：真实原生受控组合验证

新增 test-only Go 进程，使用生产 desktopbridge transport、真实 Go runtime／持久化／加密与 relay；Rust 使用真实 Bridge 启动并调用。官方身份来源和 Hive 是受控替身。组合测试覆盖同一会话的 waiting→候选不自动选→明确双平台接入→保持暂停→只恢复 OpenAI→network_change 受控停止／恢复→保留两平台不同选择→再次暂停→app_exit→自有子进程回收及迟到请求冻结。

首次实际通过 5.25s；含 waiting 身份核验修复的源码重编后通过 10.32s；最终 guardian 源码重编后于 2026-11-06 再次通过 5.35s。安全统计：2 次连接、4 次暂停写、1 次恢复写、4 次授权上传、4 次即时 relay 探针、0 次 relay 失败；两平台最终均暂停。登录中断的真实父进程 kill/restart 由 05 的原生回归单独证明。

重跑方法（先编译真实 Go 测试进程）：

```sh
go test -c -o /tmp/bee-native-bridge-integration.test ./agent
BEE_NATIVE_BRIDGE_TEST_BINARY=/tmp/bee-native-bridge-integration.test cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib native_auto_service_through_real_go_transport_and_controlled_hive -- --ignored --nocapture
```

这项证据是 Rust→Go→受控 Hive 集成，不是正式 WebView、官方真实登录、生产 Hive 或三系统验收。正常入口已接通，最终自动检查见下方汇总。

## 最终入口与跨层检查

正常 `main.tsx` 的 `NativeApp` 已启用 autoService；Go 管理服务生命周期，前端只明确发起接入、登录、换号与平台恢复。运行不确定时只读核对，waiting 的 halted 连接提供明确重连且不选择账号或修改供给。

- TS 全量单测 321 通过；类型检查及生产构建通过。
- Go `go vet ./...` 和 `go test -race -timeout=600s ./...` 全部通过；agent 139.966s、cmd/bee 11.842s、desktopbridge 2.342s，无数据竞争报告。
- Rust `cargo test --lib`：287 通过、0 失败、3 ignored，138.85s；ignored 包含需显式环境的真实受控组合测试，另行执行记录。
- 独立暂存目录的完整 device Playwright 单次 327 项通过（1.5m），包含账号 29、运行 53、自动服务 6、更新器 23 及其余 216 项。维护原 ID 无 owned job 时直接核对快照；原 unknown 与维护 restored 独立；详情同一当前失败只呈现一次；Claude 内联失败与原因区也已去重，独立 Hive 问题保留。
- 独立供给回归发现 selected 平台的旧 Hive `not_configured` 被原因过滤吞掉，已保留该远端原因，避免用本机选择替代 Hive 配置事实。首次读取未接入来源时显示读取中，已选账号的后台读取不闪烁为首次读取。

独立暂存目录的 device／preview 和 TS 验证，以及最终 Go 全量检查已完成。正式系统验收仍未执行。

无账号 Start／Restore 现在在 worker 锁外核验原 binding 的 identity，再只读检查等待保护；401／绑定变化不会被发布为 waiting 成功。真实 HTTP 门证明新 binding 与 Stop 优先。原 upgrade 故障样本在修复文件后允许此 identity GET，迁移保护前仍禁止任何 Hive 请求。

验证对象按本次暂存内容导出，保留其他工作区修改而不纳入提交：独立目录的生产构建和 device 327 项已通过；独立暂存目录预览 67 项通过（51.7s），迁移后的 TS 单测 321 项通过；最后的 guardian 修复仅涉及 Go，已通过最终 Go 全量及生产私有入口验证。冻结预览的生成 JS 含模板字面量空白，使用限定路径的 Git whitespace 属性原样保留历史字节，源码仍检查空白错误。

本轮一致性自检：用户确认的旧 false 一次暂停转换、候选不接入、维护与接单分离、未知写只核对和新暂停优先均保持；Go／Rust／TS 必需字段、枚举与所有本次调用方／模拟契约已同步。09 与 04／05 的 can_recheck 区别、v3 兼容备份、原登录结果与维护恢复分别记录，文档主表与增量说明一致。正常原生入口、配置／退出／更新的启动冻结一致；没有新增生产环境变量。10 的外部恢复证据和正式系统验收没有被已通过测试覆盖或改为 done。
