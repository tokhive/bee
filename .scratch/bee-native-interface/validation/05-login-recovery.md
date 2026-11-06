# 05 登录中断恢复：原生证据

05 首轮源码按 2026-11-05 18:04（Asia/Shanghai）冻结；共享 waiting 启动边界和全量检查发现的既有终端 fork 回收缺陷一并修复后，追加 2026-11-06 的 guardian 验证。测试均使用临时设备配置、合成凭据、受控 Hive／官方身份 HTTP 和官方命令替身；未操作生产账号或真实官方客户端。

## 恢复规则

- 原登录 ID、来源命名空间、原选择、绑定摘要和维护阶段保存在同一私有 journal。恢复不新建登录、不重放暂停或确认操作、不解除暂停。
- 管理进程中断后，原 pending／running 变为 unknown；failed／cancelled／succeeded 保留。当前来源可用和维护完成不改写原操作事实。
- 原操作的私有 OS guard 保留旧命令所有权。Unix 使用独立 Go guardian 监听管理进程独有的 lifetime writer；它处于官方进程组之外，是固定 shell leader 的直接父进程和唯一 Wait 者。取消与管理进程突死都执行停止、完整成员状态核对、KILL、无活成员证明，最后才 Wait leader 并释放 flock。Windows 使用同一操作的私有 named Job 和 guard 查询活动进程数。
- Unix 的停止观测或信号检查失败时，活管理进程先收到包含 PGID、阶段、成员状态及原错误的 cleanup failure；guardian 继续持有原 guard 和尚未回收的 leader。OS 观测恢复后，若仍有活成员就继续清理同一 owned 组，确认无活成员才释放。该过程不重新登录、不重放账号或供给写。
- 只有正常取得的新 owned runtime 可以接管原平台维护。历史 dirty session、共享 scope 和独立 runtime guard 仍阻断恢复；另一平台不借此绕过共享保护。
- 原 pending 换号事务在 login journal 确认保存前不删除。外部确认成功但 journal 写失败后，只读核对仍能沿原事务完成，不再次 confirm。

## 真实故障与公开行为

所有断言通过 Detect／Action／Snapshot／Authorize／Start／Stop／SetPaused 和真实 relay／CONNECT 边界观察；journal 文件读取仅用于选定真实外部中断时机，不直接构造恢复状态。

| 用例 | 真实触发 | 验证结果 |
| --- | --- | --- |
| `TestDesktopLoginRecoveryAfterActualParentDeathStopsOriginalProcessAndRetainsOperation` | 独立管理进程启动官方命令后被 Kill；随后释放官方写文件闸 | 旧命令不能写入来源；新实例恢复同一 ID，原结果为 unknown |
| `TestDesktopLoginRecoveryAcrossRealProcessStageAndTerminalBoundaries/pause_pending` | journal 保存后，首次供给 GET 阻塞时 Kill | 恢复仅查询；不启动官方命令，不重放 PUT |
| 同上 `/reconciling` | Claude 来源核对的真实 profile HTTP 阻塞时 Kill | 原 succeeded 保留，重新读取原来源后恢复 |
| 同上 `/failed_result`、`/cancelled_result` | 原命令真实失败／公开 Cancel 后，恢复 identity GET 阻塞时 Kill | 新实例保留原 failed／cancelled 和原 ID，维护可恢复 |
| `TestDesktopLoginRecoveryCleanNewRunRestoresOrIsolatesOnlyInterruptedPlatform` | 真 Kill／新实例／正常 Restore | 同号恢复且暂停；缺失来源仅隔离目标；异号等待明确确认；另一平台继续 |
| 同上 `/dirty_runtime` | 原进程真实运行后 Kill，留下 dirty session／guard | 新 Restore 和登录核对均不能自动接管；无供给写重放 |
| 同上 `/missing_source` | 来源先缺失；用户显式 Detect 新命名空间；旧来源随后恢复 | 旧 journal 不覆盖新候选，保留来源冲突和恢复入口 |
| 同上 `/stop_while_mark_waits` | Detect 官方 HTTP 持 platform gate、公开暂停 PUT 持 slot gate；Stop 取消等待中的恢复 | 原故障先 RED：`active account actions=1` 永久 busy；修复后清理归属并可再次 Start |
| 同上 `/snapshot_during_start` | Snapshot 原恢复持真实供给 GET，启动随后到达 | 原故障先 RED：启动提前释放平台 admission；修复后 join 原 worker，不覆盖完成结果 |
| `TestDesktopLoginMaintenanceConfirmedChangeJournalFailureCanBeReconciledWithoutAnotherConfirmation` | confirm 成功并同步后，真实目录占据 journal 路径导致最终保存失败 | 原故障先 RED：再次核对无法恢复；修复后原 confirm 仅一次，原 failed 登录保留，Snapshot 可继续且无供给写 |
| `TestDesktopLoginMaintenanceFinalJournalFailureKeepsIsolationUntilReadOnlyRepair` | 最终 restored 保存被真实文件故障阻断 | 失败仍隔离，relay／恢复接单被拒绝；修复文件后只读核对可完成 |
| `TestDesktopLoginMaintenanceConcurrentPlatformsRetainBothOriginalOperations` | 双平台账户 GET barrier 对齐，共 24 轮真实并发 | 原故障先 RED：journal readback 不一致／丢更新；独立 journal 事务锁修复后两原操作都保留 |
| `TestDesktopAuthorizeCancelJoinsForkingDescendantsBeforeReleasingGuard` | 24 轮真实 shell 后代持 guard／输出 FD，输入触发继续 fork 的同时取消 | 返回前独立 ps 证明已记录后代无活状态；原 flock 可重新取得，输出 1 秒内 EOF，随后释放来源写闸仍无迟写 |
| `TestDesktopAuthorizeParentDeathJoinsForkingDescendantsBeforeReleasingGuard` | 12 轮独立管理进程在后代开始 fork 时被真实 Kill | guardian 接收 lifetime EOF，原 guard 仅在组回收后释放；独立 ps 无活后代，原来源写闸不能被迟到执行 |
| `TestDesktopAuthorizeObservationFailureRetainsGuardUntilStopIsProved` | 测试进程中的内核查询 seam 返回明确故障，同时 KILL seam 返回 EPERM；真实组仍由 SIGSTOP 暂停 | 先向管理端报告具体错误；独立 ps 确认 leader 仍 live／T，原 flock 仍受阻；恢复查询与信号后真正清理组，再释放原 guard |

精确 Kill 覆盖 pause_pending、authorizing、reconciling 及已记录的终态。paused／isolated 两个无外部等待的小窗口未声称被精确中断；authorizing 真 Kill 的记录携带此前 pause_confirmed／isolated 证据。

## 验证结果

- 最终确认保存失败回归：race 通过，4.812s。
- 新增四个跨进程阶段／终态边界：race 通过，2.985s。
- 启动与 Snapshot／Stop 竞争及 dirty runtime 子例：race 通过，3.537s。
- `go vet ./...`：通过。
- `git diff --check`：通过。
- 首次 `go test -race -timeout=600s ./...`：agent 130.977s，唯一失败为无选择账号时已拒绝设备被标为 waiting；无数据竞争报告，05 登录恢复测试无失败。共享启动路径已修复。
- `DeviceContext`／`AutoService`／`Presence`／`Upgrade`：race 通过，6.485s。共享 waiting 启动边界由本代理按主代理授权修复：reservation 保持本地，worker 在锁外核验同一 binding，失败保持 failed 与本次 identity 错误；新 binding 和 Stop 优先。新增真实 HTTP 门测试先 RED 后 GREEN；原无账号启动测试允许 identity GET，仍拒绝贡献请求／写入并保持原账号文件字节和无 runtime guard。
- 第二轮 full race：agent 123.997s，仅两个旧升级 fixture 拒绝新增的 identity GET；已精确同步夹具，使迁移失败期间仍禁止任何请求、修复后仅允许只读身份核验，原配置及备份字节保持不变。
- 第三轮 full race：agent 134.256s，仅既有 `TestDesktopOfficialTerminalSession/cancel` 的原 1 秒 EOF 断言失败。单独复现为 63／100 失败；仅移除本票新增 lifetime watcher、恢复原 supervisor 的 overlay 对照仍有 16／30 失败。lsof／ps 直接发现持有终端 FD 的 sleep 成为 PPID=1、仍位于原 PGID，不能将该缺陷写成 05 新引入。
- 新增 fork／guard 故障矩阵：race 通过，3.335s。压力验证还暴露 KILL 后仍有新可见成员及 Darwin 对 kernel exit 中成员返回 EPERM 的情况；当前依据实际成员状态继续清理，只有无活成员证明允许成功，不把 EPERM 当完成。
- 最终 `Terminal`／`Login`／`Authorize`／`Exit` 定向 race：通过，36.647s。
- 原终端取消用例连续 100 轮：通过，10.580s；原 1 秒 EOF 断言未放宽。
- 生产 Bee 二进制固定 `desktop-login-supervisor` CLI 入口：真实继承 FD 的 normal／lifetime EOF 合成 smoke 通过，核对 cleanup JSON、guardian 退出、guard 释放、独立 ps 后代退出及无迟写；错误内部协议在启动官方命令前被拒绝。Go 测试二进制使用固定测试 dispatch seam，未用测试 helper 代替该生产入口验证。
- 最终 `GOOS=windows GOARCH=amd64 go test -c ./agent` 和 `GOOS=linux GOARCH=amd64 go test -c ./agent`：通过。
- 最终 `go test -race -timeout=600s ./...`：全部通过；agent 139.966s、cmd/bee 11.842s、desktopbridge 2.342s，其余包通过或使用缓存，无数据竞争报告。
- 独立代理定向只读检查 guardian 的 FD、启动、唯一 Wait 所有权和异常保锁／恢复清理路径，未发现阻断问题；未扩展为本票外的代码审查。最终 ps 未发现本轮 guardian、管理 helper、来源写后代或专属测试终端残留。

## 平台限制

Unix 进程生命期和崩溃恢复在本次 macOS 主机真实执行；官方命令为 Go 测试二进制或 shell 替身，Claude 文件源的 OS 能力由受控配置选择。回收范围是 Bee 启动、保留 PGID 所有权的官方进程组，不声称提供任意恶意程序的跨进程组隔离。Windows、Linux 只交叉编译，未在对应系统原生执行；Windows Job／文件锁／终端和托盘、Linux proc 观察行为仍须对应平台验收。

测试矩阵首跑的 Claude 管理 helper 曾遗漏受控交互适配，打开了两个 macOS 测试 Terminal 会话。已固定 helper 使用受控进程执行，终止残留的专属 `agent.test desktop-login-terminal` 进程树；不将该首跑计为通过证据。
