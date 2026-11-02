# 最终全分支统一修复：有限复审

日期：2026-11-03。**Spec Compliance：Compliant；Code Quality：Approved；新增及当前未关闭 C/I/M = 0/0/0。** 原全分支审查的 I1、I2 均关闭。本结论仅批准本轮修复及其直接行为路径，不表示 T10、76 个复合场景或全部 Plan 已完成真实验收。

## 固定范围与审查方法

- Bee BASE：`5aef32ebed973aa2827d38d0e004827060c28a4b`；产品／测试提交：`843e3fff557d723ed8626c081f8cecf2567856a5`；复审 HEAD：`815365835c90953a9cc0b49db922fb504504cfb5`。覆盖两个修复提交，不以 HEAD~1 代替整个修复范围。
- Hive 维持 `87e3233faa3b00e2a207e6dc0fdc5ea380c3a02a`，Bee gitlink 维持 `ab8140a175f1c1c6fd4c689fc1bd1e23e82e180f`。
- 完整审读 699 行、8 个块的 source diff（7 个产品／测试路径及验证台账），读完修复 brief、报告、包索引及全部 11 个新增证据脚本。大日志／图片通过原件按相关失败模式选读，没有将排除证据目录的 source diff 当成完整证据包。
- 沿用 [原全分支审查](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.superpowers/sdd/final-review.md) 的未变路径结论；本轮重点追踪 worker→账号／运行 snapshot→正式消费者，以及 fixture→绑定版本→共享作用域→实际账号卡片。未重跑已绿套件、未改产品、测试、index、HEAD 或用户状态；仅写本报告。

## I1：同平台真实恢复后保留旧错误——关闭

**实现闭合。** [startSlotLocked](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/desktop_runtime_sync.go:247) 的同步失败和全部回读失败统一调用带 connection、run、platform 的观察入口；只有 `observeSynchronizedPlatform` 整体返回成功才报告该平台恢复。原有设备绑定、账号 fingerprint／generation／credential revision、同步 receipt、当前来源、持久化选择／session 和供给 GET 核验仍位于成功分支之前。

[synchronizationObserved](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/desktop_runtime_sync.go:591) 将失败保存在当前 connection 的平台 map 中。成功仅删除对应平台：Claude 成功不会清 OpenAI 失败；两平台失败时，当前展示的平台恢复后会回显仍未恢复平台的原失败；全部恢复才清空详情。清除的是原失败对象，未覆盖其它后来发布的连接详情。失败发布同时将该平台 Authorization 标成 unconfirmed 并移除供给；恢复详情不额外修改账号或供给事实，不创建 reconnect timer，也没有增加 resume／supply PUT。

**迟到观察和副作用范围。** 新入口在同一临界区内检查 closed、run、当前 connection、active、连接 context、running 和 connected，再发布账号 revision／Authorization、供给及详情；账号短 gate→runtime mutex→sync mutex 的顺序没有引入反向持锁等待。Snapshot 释放 runtime mutex 后才取得账号 gate，连接 shutdown 在 sync mutex 外等待 workers。[完整 Snapshot 断言](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/desktop_connection_test.go:340) 对旧 run、旧 connection、inactive、stopping、stopped、cancelled 和 closed 分别注入成功与失败，比较含账号 revision／Authorization／供给的完整 Snapshot，仅归一化本次 ObservedAt；并非仅断言提示消失。

继续核对了未改的生命周期：[连接退出与同步 worker join](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/client.go:192) 在进入下一次连接前关闭 relay 并等待同步 workers；[停止等待](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/desktop_runtime.go:430) 等待 runDone 后才发布 stopped，新 Start 不能跨 stopping 进入。因此旧 worker 不会跨已完成的 join 边界进入新连接／新 run。上述新增直接单测证明观察入口的屏障；真实 worker 测试证明完整成功路径。没有把直接调用 helper 的测试表述为逐个阻塞点上的全 worker 竞态注入。

**有效 RED／GREEN。** [原实现 RED](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-red-runtime.log) 的两个真实 worker 子例均因 `same-connection successful synchronization retained current failure` 失败，exit=1；原 Go 产品文件与 BASE 来源绑定。[真实 worker GREEN](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-green-runtime-worker.log) 的同步 503 与供给回读 503 两个子例均通过。[恢复断言](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/agent/desktop_runtime_test.go:423) 明确检查同 run、单连接、Authorization synchronized、detail=null、供给仍 paused、恢复期间供给 PUT 不增加、resume PUT=0，并执行 Stop。原日志中的 recovered snapshot 与这些断言一致。

**正式消费者闭合。** Go scope 测试产出的四个 detail 转换，与 [消费者 fixture](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/tests/fixtures/synchronization-recovery.json) 的对象逐项相等，源日志 SHA256 为 `d854a1ab845ae75c50fb7ce9335c03b8dc36c07949059a3a32255ea0948520b2`，本复审重新只读核对相等。[NativeRuntimeControls](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src/features/lifecycle/NativeRuntimeControls.tsx:36) 按共享快照渲染详情，未加入前端自行吞错逻辑。[正式消费者回归](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/tests/t10-layout-fix.spec.ts:136) 先证明 Claude 恢复后仍显示 OpenAI 原因且没有已安排重连，再证明全部恢复后旧原因消失、Bee 仍运行、手动暂停和 Claude 未接入保留、零业务写。实际 JSON 与恢复首屏图均已查看。

## I2：D06 输入清空但实际页面保留旧账号——关闭

[finishRecovery 与 device_context](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/tests/fixtures/bee-preview/fixture.mjs:54) 在首次绑定／恢复完成时将两平台账号 revision 从原值推进，并推进 bindingRevision；首次未绑定场景在绑定后也返回已绑定 context。它遵守实际绑定切换的版本契约，未放宽 `useAccounts` 同 revision 屏障、DTO decoder 或生产者的作用域规则。真实产品 digest→binding revision→协调器 epoch→NativeWorkspace 重建的原保护链不变。

[D06 实际渲染断言](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/tests/t10-layout-fix.spec.ts:155) 先验证实际“1 个已接入”，模拟批准并点击真实“重新核对设备”后，断言实际“0 个已接入”、两个平台卡片均未接入、main 中旧 bbbb／Plus／3%／2% 消失；另核 stopped、开始禁用及零业务写。[原 fixture 的有效 RED](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-red-d06-native.log) 确实因实际页面找不到零账号而失败，非无测试、错误模式或 fixture 输入断言。

[最终组件 GREEN](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-green-components-final.log) 为 D06 与 runtime 消费者同次 2 passed；[fixture 直接消费者 GREEN](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-fixture-direct-consumers-final.log) 为首次未绑定→绑定及不同 owner 撤销恢复两项 2 passed。新实际正文中两账号 revision 均为 2，旧值均不存在。已实际查看 [OpenAI 账号区](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-green-components-final-output/t10-layout-fix-D06-initial-pairing-completed-stopped-chromium/D06-bound-stopped-accounts-visible.png)、[Claude 账号区](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-green-components-final-output/t10-layout-fix-D06-initial-pairing-completed-stopped-chromium/D06-bound-stopped-claude-visible.png)，不是只看上方设备绑定摘要。

[D06 台账](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/interaction-clarity-validation.md:68) 已切换至新的完成首屏、实际账号区图和正文 JSON；旧反例图／JSON 保留并明确不能支持双未接入结论。I2 的证据缺陷已经关闭，仍不据此反推或宣称修复了真实产品账号泄漏。

## 验证和证据脚本质量

| 证据层 | 核对结果与边界 |
| --- | --- |
| Go | 定向 Connection／Runtime race exit=0，94 条 PASS 含父子测试，非 94 个顶层测试；最终扩展完整 Snapshot 断言后另有 scope race exit=0。vet exit=0。 |
| 前端 | 最终组件 2 passed、fixture 直接消费者 2 passed、产品提交后 typecheck exit=0；不累加早期重复轮次。 |
| Linux 外部二进制 | 新 Bee SHA `313a32810ac16b5fa9d640c8fdfb41995817d14da2d2cb49d1840151caa5329c`，新 Hive test SHA `148825231574ecc350bfa890d8c5b36bf69ab3793e2df7a2e8f726aaea599706`。原日志证明 provenance、401／403／409／503／EOF、真实 socket/listener 关闭→refused/scheduled→同 run 重连、paused、零 resume PUT、完整停止回执，exit=0。未声称外部二进制完成同平台同步失败→全部回读成功的专项；该链由 in-process 真实 worker 证明。 |
| 画面 | Playwright 实际 860×600、reducedMotion=true；Ego 实际 1512×833、reducedMotion=false。两层分别记录，没有把最小窗口／减少动态效果属性套给 Ego。 |
| 失败记录 | 保留无测试的首次 RED、误用 e2e mode 的前置失败、消费者文案断言失败及首次 finish 失败；报告准确区分有效行为 RED。Vite 143 是核归属后的主动 SIGTERM，不计测试通过。 |

新 Linux Bee 在产品提交前构建，因此内嵌 vcs.revision 仍为 `5aef32e`、vcs.modified=true；工具链为 Go1.27.3／linux arm64／CGO0。实际新源码通过构建 metadata 的 source_sha256 与 `843e3ff` 产品 blob 绑定，不能单凭二进制内嵌 revision 宣称它构建自该后续提交。

11 个新增证据脚本全部审读：run 执行与来源记录、runtime-isolated、stop-vite、五个 Ego 脚本、audit、finalize、manifest-v2。执行器保留实际退出码及 stdout/stderr；audit 检查各轮真实输入而不是用 HEAD 名称代替来源；manifest-v2 保留旧 manifest 并先验证旧 artifact。未发现脚本隐藏失败、重写旧结果或把不同源码轮次冒充同次运行的问题。

Ego 首次 finish 脚本先调用不支持的 `Browser.getVersion`，原日志与代码均确认异常发生在 finish 之前。v2 仅调用一次 finish，[实际回执](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-ego-finish-receipt.json) 为 space43、closedSpace=true、closedManagedLabels=[p1]、completedFinishCalls=1。隔离运行脚本先检查自有资源名不存在，创建 internal 网络并实查无默认路由；finally 按名称／label 只清理本轮 DB／网络，原日志有成功删除回执。

暂存 diff-check 的 exit=2 与 44 处尾随空格均保留：只发生于 5 份原始日志／失败上下文。后续 authored check 精确排除这些原始文件及记录它们的 check log，exit=0，没有排除产品、测试或手写文档。

来源与保持方面，审读了执行器／audit／manifest 的核证逻辑和原结果；主控另独立核对最终 946 项输入的三轮来源、147 份 artifact 加 manifest、149 个证据提交路径、7 个产品 blob、两个二进制，以及 1040／934／2143 项保持，报告 errors=[]，并只读重跑原 audit exit=0。本复审没有重复全量散列扫描。新证据与旧失败均保留，Hive／gitlink 不变。

## 当前结论与真实验收边界

原 I1、I2 已有实现、有效 RED、最终 GREEN、直接消费者和真实渲染的闭环。限定范围没有新增 Critical／Important／Minor，也没有需再修改产品或改变已批准设计的发现。

真实账号、OpenAI／Claude 官方请求及原生登录副作用、隔离 macOS GUI、Windows／Linux 桌面、签名安装／更新包等原资源缺口仍在；完整 DNS／TLS／timeout／心跳外部变体，以及外部二进制同平台完整同步恢复链也未由本轮替代。[R04 台账](/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/interaction-clarity-validation.md:95) 与 D06 均继续标注“子路径已验；整行待验”。本批准关闭代码／证据缺陷，不勾选这些未验内容，不代表全部 Plan 验收完成，也不包含 push、merge 或部署。
