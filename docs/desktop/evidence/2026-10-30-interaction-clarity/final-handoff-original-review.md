# Bee 桌面交互清晰化：最终全分支行为路径审查

日期：2026-11-03。**Spec Compliance：Issues found；Code Quality：Needs fixes；本轮未关闭 C/I/M = 0/2/0。** I1 是产品恢复状态缺陷，I2 是本机可修复的组件验收缺口。主要权限、未知写入和作用域保护符合批准方向，但当前分支不能据此批准收口；T10、76 个复合场景及全部 Plan 均未完成整体验收。

## 范围与方法

- B = `/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`，审查 `5e3d773..5aef32ebed973aa2827d38d0e004827060c28a4b` 全部 26 个提交；当前产品提交 `dd554529e8803f2791f26ab99c9ee5178a9479fd`。
- H = `/Users/dayong/myspace/mywork/tokenhive/.worktrees/hive-desktop-interaction`，审查 `ae6573b..87e3233faa3b00e2a207e6dc0fdc5ea380c3a02a` 全部 4 个提交；Bee gitlink `ab8140a175f1c1c6fd4c689fc1bd1e23e82e180f`。下文 B 内路径省略 B；H 路径显式标注。E = `docs/desktop/evidence/2026-10-30-interaction-clarity`。
- 依据批准 spec、Plan 的全局约束与接口、76 项全流程报告、布局报告及原布局 README；使用 global-conventions、requesting-code-review、affected-path-review，并按实际路径应用失败证据、持久化异步任务、幂等和高风险正确性审查要求。界面按 UI 规范及本轮取得的 Web Interface Guidelines 核对，不以通用 Web 建议改写批准的桌面行为。
- 已分段完整读取 Bee source diff 的 25,934 行／165 块及 Hive 完整 diff 的 1,950 行；截断区段已补读。source 视图仅剔除证据目录，块一致性依据 `final-package-integrity.json`；不以 diff stat 代替阅读。补读未改动的 Hive 网页确认、Controller、配对／替换事务、供给选择、凭据检查和准入锁，以及 Go session／同步成功链和正式 UI 直接消费者。
- 已核 `final-verification.md`、`final-review-start.md`、T10／fix／fix2 实施报告、三轮任务审查及本轮任务对应的 progress 记录。过时的“正在修复”“产品仍 3b0b747”等表述仅作为历史，不覆盖本次固定 HEAD。
- 证据目录的 23 个脚本由主控另派的独立辅助 reviewer 全读，详见 `.superpowers/sdd/final-evidence-review.md`；本报告合并其结论，并独立核验 D06 的 fixture、消费者、现存 JSON 和 PNG。没有声称本人又逐个重审全部脚本。来源 SHA／提交 blob、旧文件保持及 311 个链接检查沿用主控的核证；链接存在不作为行为通过依据。
- 本 reviewer 仅只读检索／源码追踪／解析已有 JSON，并实际打开 D06 完成首屏、fix2 中文协议详情和英文深色完整性详情三张原图；其余人工图观察按已有报告明确继承。没有重新运行已绿全套、启动 GUI／浏览器／数据库、读取真实账号或执行业务写入；仅写本报告。I1 是完整控制流已确定的失败模式，未冒称有本轮新增执行 trace。

## Strengths

1. **供给解释与准入保持分离。** Hive 的详细参数在暂停写入之前验证，默认原因仍保持旧契约；详细原因复用真实静态／动态候选和目录、授权事实。静态供给、无注册但已有合法授权等旧 ready 路径没有被额外注册条件封锁。Go／Rust／TS 均严格校验原因和 `ready/paused` 不变量，未知响应没有被当成可接单。
2. **未知副作用有明确边界。** 设备恢复在创建／兑换前记录尝试，丢回执只查原事务／新凭据身份；账号换号、暂停恢复、诊断和安装保留原操作及版本，不以重建操作解除未知。不同 owner 仍需本机确认，Hive 网页仍确认登录用户及被替换设备，未绕过旧任务收尾事务。
3. **隔离贯穿实际运输层。** 共享协调器先校验 receipt floor 再发布；Rust 接纳预算覆盖排队与进行中请求，首字节发送与取消共同受保护；Go 单 reader 能在 dispatcher 等待屏障时观察 EOF／shutdown，取消后不启动排队写且 join 已有工作。同平台串行、另一平台独立读取不只停留在前端 Promise 层。
4. **恢复页面可达而写入仍受保护。** 管理进程可通信与业务就绪分开；真实身份失败允许本机读取、官方登录和原操作取消，Hive 写入保持门禁。显式 startup recheck 不再次 Restore；恢复新绑定后清除旧账号／代理目标／运行作用域，保持停止。
5. **界面与证据修复具有实际行为断言。** 已关闭的 R01 前提、过期确认零写、原未知操作跨页、自动读取恢复、系统登记未知、预览直接消费者和 S05 实际桥错误等修复，均有相应状态／副作用证据。两张本轮实际查看的 S05 图清楚显示匹配摘要、影响、下一步及安全原文；没有用详情存在掩盖主提示泛化。
6. **保留历史事实与验证边界。** 失败轮次、命令来源、v6／v9 差异和资源缺口未被后续绿色覆盖。25 项修复与后续 4 项原因采图没有拼成一次 29；最终 fix2 也没有把旧包重标为包含新前端。

## 六条完整行为路径与字段追踪

### 1. 详细供给原因、暂停写入与实际准入

`agent/desktop_supply.go:124` 的 GET／PUT／写后 GET 全部显式携带 `reason_detail=1`，PUT body 仍只有 boolean `paused`。H `controller/supply_control.go::BeePlatformSupply` 先核有效设备、平台和单一参数值，再解码显式 `paused`，只调用一次 Market 写入口。H `service/platform_control.go:19` 的事务锁活跃设备，更新 `owner_id + platform` 的暂停行并提交，随后只读投影。

`platform/paused/ready/reasons` 在 H `supply_control.go::platformSupplyMode` 来自暂停、封禁、替换排空、连接、账号、候选选择、目录、授权、capabilities、并发事实。`dynamicSupplySelection` 保留受阻候选用于解释独立原因；旧 `dynamicSupplyFor` 仍在任何选择阻塞时返回 nil。`marketOpen` 看平台目录，`tradableModels` 看设备／账号可用集合；`account_not_registered` 仅解释动态授权不可用，不额外封锁已有合法来源。读取失败返回错误，不变成业务原因。

实际接单继续经过未改动的 `credentialSnapshot`、`candidate_facts.go::judgeCandidate` 和 `scheduling.go::lockChosen`：凭据 owner/platform/fingerprint/generation/revision、有效来源、暂停、封禁和设备替换在准入锁下再次核验。详细展示没有成为准入授权器。Hive 暂停事务与准入 SHARE 锁仍相容；替换 `FOR NO KEY UPDATE` 等待已有准入／收尾。

Bee `decodeDesktopSupply` 拒绝重复／缺失／null／未知字段及相互矛盾的事实；再加当前 hive/device_id/checked_at，经 Rust protocol、TS `system/supply.ts` 校验后进入共享 snapshot 和平台呈现。旧原因不猜细分，未知不放宽。PUT 或回读不确定时只 GET，不重放 PUT。此路径未确认新增缺陷；数据库矩阵、旧请求兼容和真实最终二进制组合证据在各自范围有效。

### 2. 开始、停止、连接失败与恢复

正式开始传空 `ResumePlatforms`，准备账号／暂停、保留用户显式暂停；连接成功本身不解除暂停。Go `client.go::connectObserved` 在真实握手／心跳失败处生成 `code/stage/occurred_at/message/evidence`，只在创建实际 timer 后发布 `retry=scheduled/next_retry_at`；401／403 与无归属或持续 409 分别停止不适用重试，不自动接管。

`DesktopRuntime.connectionObserved` 以 `run_id` 和运行阶段拒绝旧回调，更新 `revision/connection/connection_detail`，连接丢失清掉平台 supply；connected 观测清除上一连接失败。Rust／TS 保留严格字段和观察时间，共享协调器拒绝旧 runtime/account receipt。停止先转 stopping 并清连接详情，取消／join owned workers，分别记录 workers_stopped、intent_saved、session_clean；UI 不把部分停止当下次一定停止。

**未闭合处为 I1：平台同步失败有发布路径，同连接内该平台成功却没有恢复发布路径。** 实际核心重连与后台平台同步是不同操作，修复不能假造重连 timer，也不能让另一平台成功清除未恢复平台的失败。

### 3. 首次配对、凭据恢复与替换后的作用域

UI 显式确认携 `operation_id/expected_revision/decision`；Rust 验证管理进程／恢复门禁，Go 校验 `purpose/phase`、原绑定、owner、已有账号写入／运行事务。受保护记录的 CreateAttempted／RedeemAttempted 在 POST 前持久化；相同已接受确认返回当前事务，未知创建无 token 不能被重新 Begin 越过，未知兑换只用已保存新凭据查询身份。已完成历史记录与新的合法撤销恢复分别处理。

H `web/src/DevicesPage.tsx::confirm` 提交 inspect 取得的 code／replace_device_id 与当前 user.id；Controller 复核当前登录 owner。H `service/devices.go::ConfirmPairing` 锁 pairing／旧设备并核精确替换 ID；`RedeemPairing` 核过期、一次兑换、旧设备活跃及未完成执行／结算，在同一事务撤销旧设备、插入新身份、标记 redeemed，提交后 retire 原连接。没有由桌面推断网页归属或绕过 draining。

Go `saveRecoveryIdentity` 再查询并精确匹配新身份／已确认 owner，原子保存后清空旧运行／网络目标／账号内存状态。`desktop_session.go:104` 的 digest 包含 Hive、名称、凭据及 identity，真实绑定变化推进 `binding_revision`；共享协调器在 status 前后重读 context，即使保存后末次回执失败也切 epoch／清 receipt floor；`NativeApp.tsx:161` 用 instance 与 binding revision 重建工作区。旧账号状态和草稿不跨真实新绑定复用。**I2 属于模拟未遵守这条链，不能反推真实产品存在同样泄漏。**

### 4. 来源、官方登录、接入／换号及取消

账号来源目录／store 草稿在当前工作区跨页保存；自动本机读取与官方权限查询区分，候选只是候选。确认提交保留 platform、candidate reference、fingerprint、account revision；Go 复核当前来源和身份，原操作存储保留 generation／credential revision／pending 状态。同步完成仍暂停，不把官方退出码零或本机候选当接入成功。

`desktop_authorize.go` 与平台进程 helper 限制 owned child，取消／超时后等待回收；真实错误区分未安装、版本、来源未变化、namespace mismatch 等。TS `useAccounts` 对操作回执先记 floor，未知取消保留原 id；只有同 platform、id、kind、generation 且 revision 合格的可信终态才能解除原操作未知，旧／异操作成功不能解锁。读取错误不会无条件变成取消未知。Rust／Go 双平台读取白名单和共享写屏障覆盖此路径。

受控回归可支持上述状态和 owned 生命周期；官方账号登录／取消实际落点、两平台接入换号及官方请求仍待真实资源。未确认此链新增产品问题。

### 5. 设置、诊断、更新和原生生命周期

网络草稿、保存偏好、effective revision 与运行恢复分开；同 revision 不推断 Restore 成功，未知应用先回读网络和 runtime，不重放 stop/configure/restore。startup hold 下窄应用保持停止，显式 recheck 仍只验证。系统通知的 desired／permission／delivery 与自启 desired／registered/error 分开，registered=null 不解除未知写锁。

DiagnosticsClient 在 workspace 存活，`instance/binding_revision/network_revision/run_id/report_id` 及报告 generation 一起约束查询／取消／导出；start 无 id 未知仍锁原动作，离页或查询失败只重读，不重建诊断。导出晚回执不能覆盖新报告。原始失败保留固定 check、实际时间与安全证据。

更新的 check/download/Verified/install 各阶段保留版本／revision 和原操作，安装确认绑定精确已验证版本；未知结果仅核对。native install 的 pending marker、owned exit、停止回执和下次 startup 核验仍约束结果，可信旧版本／保护未解除各有真实状态文案。原生语言同步携顺序版本；切语言重新呈现已存事实，不重新发起业务动作。菜单／通知入口沿现有权限、open target 和 owned exit 边界。此链未确认新增产品缺陷；真实签名安装和 OS 行为不由模拟或 ad-hoc 构建证明。

### 6. 当前、历史、未知状态和可达操作

`desktopState` 先发布可信共享读取，平台账号／供给独立完成；新鲜后台刷新保留有效事实，失败或过期使旧报告不能支持 ready／写入。`deriveDesktopStatus` 与账号 display 区分未确认、已确认零、部分已知、历史额度和当前原因；保留全部额度窗口、原 used percent／reset time，超过 100% 不截成虚假事实。

`NavigationTarget` 保留 page/section/platform/from，切页滚动到标题或明确目标并恢复焦点，后台更新不反复导航。Radix dialog/details 的键盘与 Escape、当前操作草稿和返回路径由对应回归约束。四页继续可达，概览开始／停止及账号额度区下方动作沿原布局。CSS 和 i18n 提供 12px 关键说明、13px 正文、16px 主状态、32px 关键按钮及长文本换行；日期数字由 App locale 格式化。S05 用实际码映射，未知英文消息不猜分类，安全原文同提示展开。

界面现有局部证据有效，但不能由模板、首屏或 fixture input 推断所有未显示子状态。I1 破坏当前／历史失败区别；I2 具体说明为何组件实际正文仍须作为验收对象。

## 未关闭发现

### I1 — 同平台同步恢复后，连接详情永久保留已恢复的失败

- **位置：** `agent/desktop_runtime_sync.go:251`、`:262`（失败发布／缺失成功分支），`:591`（`synchronizationObserved`）；直接消费者 `desktop/src/features/lifecycle/NativeRuntimeControls.tsx:22`、`:36`；现有测试 `agent/desktop_connection_test.go:294`。
- **触发：** 已连接且运行中，某平台一次同步或授权／供给回读出现可恢复错误，例如 HTTP 503；该错误不属于会结束连接的身份拒绝。连接和 run 保持不变，2 秒后的同平台 worker 重试成功，账号、凭据收据和供给全部通过核验。
- **实际控制流：** 失败把 `ConnectionDetail` 设为本次 failure、`Retry=idle` 并推进 revision。下一轮 `observeSynchronizedPlatform` 在 `:404` 更新 authorization、`:415` 更新 supply，`:422` 返回 nil；调用者没有成功观察分支。即使调用 `synchronizationObserved(..., nil)`，`:592` 仍直接返回。清除只发生在新的 connection observation／停止／作用域重置，因此在健康同连接中可以无限残留。
- **可见错误与影响：** RuntimeControls 在 confirmed、running 且 detail 存在时无条件显示 FailureNotice、当前没有安排自动重连及检查 Hive 连接入口，没有“历史／已恢复”标记。此时共享状态可以根据新鲜 ready supply 显示可接单，同屏仍要求处理已恢复的同步失败。它不改变实际供给准入，但误报当前故障并引导无必要诊断／重启，直接违背 spec §6.2 `:203` 的“按实际同步状态”和 R04“恢复后剩余阻塞”。
- **为什么现有绿色未覆盖：** `TestDesktopConnectionSynchronizationObservationIsScoped` 明确核另一平台成功不能清除失败，却没有携平台身份或执行同平台失败→成功链。保护另一平台并不能证明同平台成功也应永久保留。
- **最小修复／回归：** 让同步观察保留失败平台／连接／run 归属，在同平台真正完成同步及回读后清除对应当前失败；若多个平台分别失败，仍保留尚未恢复者。不得简单令任意 nil 清空所有失败。定向覆盖同平台失败→同连接成功、另一平台成功不清、两平台分别失败／逐个恢复、旧连接／旧 run／停止后的成功不影响当前状态。加正式消费者恢复后的旧失败消失或明确历史语义断言，并保持零新重连调度／零恢复 PUT。无需为该修复重跑已绿无关套件。

### I2 — D06 的模拟绑定不推进作用域／账号版本，实际页面仍显示旧账号，验收只检查 fixture 输入

- **位置：** `desktop/tests/fixtures/bee-preview/fixture.mjs:54`、`:56`、`:93`；`desktop/tests/t10-layout-fix.spec.ts:136`，尤其 `:140`；登记入口 `docs/desktop/interaction-clarity-validation.md:68`。
- **触发／错误：** `device-pending` 初始继承已选 OpenAI revision=1。`__beePreviewApprove` 调 `finishRecovery` 将两平台重建为 `accountFixture` 的 revision=1／not_selected，而首次配对没有 recovery completed 对象，`device_context` 仍报 binding_revision=1。账号事实改变却既无账号版本推进，也无真实产品绑定作用域切换。`useAccounts.ts:51` 对已核实的同 revision 快照不更新，因此保留旧已选视图。
- **现存反证：** `E/t10-fix-ui-frozen-output/t10-layout-fix-D06-initial-pairing-completed-stopped-chromium/D06-bound-stopped-no-selection.json:17` 的 actual.body 实际包含“AI 账号\n1 个已接入\nOpenAI\nPlus”、`bbbbbbbbbbbbbbbb` 和旧 3%／2% 额度，`:18` 的 actual.main 同样如此；actual.accounts 却是两平台 not_selected／revision=1。本人已重新解析该原 JSON，且实际打开 PNG：首屏仅显示 bound／stopped／开始禁用，旧账号区在内部滚动区域下方，截图没有证明它已更新。
- **漏检原因：** D06 `:140` 断言的是 `window.accounts`，证据 helper `:29` 的 actual.accounts 也是 fixture 输入；它们不是正式组件渲染状态。开始禁用和顶部 no_accounts 来自较新的共享 runtime，不足以证明账号列表同样正确。辅助 reviewer 的无写入 Node 24.22.1 探针也确认 selected→not_selected 而 revision 仍 1；该诊断 exit 0 不是 D06 行为通过。
- **影响／范围：** 此用例不能支持已登记的首次批准后无旧选择的完整组件子路径，回归可在现有本机环境被漏检，不属于官方／OS 资源缺口。真实产品 `desktop_session.go:104`、`desktopState.ts:93`、`NativeApp.tsx:161` 有 binding digest→revision→epoch／重挂载保护，故不据本模拟反例宣称真实恢复泄漏。真实 Hive 网页／核心配对的停止及零自动写入证据仍有效。
- **最小修复／回归：** fixture 遵循真实首次绑定的 context revision／作用域契约，避免同作用域同 revision 改写事实；D06 同时断言实际账号区确定数量、两平台未接入、旧 fingerprint／套餐／额度消失及停止／开始禁用／零业务写。滚动到账号区保存新图和真实正文，运行该受影响单例及必要直接 fixture 消费者即可。新证据增量归档，旧 JSON／图／manifest 不覆盖，并改正 D06 的主证据链接及局部结论。

本轮无 Critical、无新增独立 Minor。上两项均具确定触发和有限回归目标，不依赖用户补充真实环境资源。

## 旧发现的实质处置

- T10 原来源测试 opt-in、R01 错误前提及 shutdown 失败跳过 reap：最终代码与 RED／GREEN 足以维持关闭。reap 负例子 runner 仍真实 FAIL，父探针只证明回收；未设置 TEST_BEE_BIN 的 Skip 不等于真实二进制验收。
- 第一次修复的预览 74／76 直接消费者，以及 S05 实际 VERSION_MISMATCH／BUNDLED_BEE_INVALID 摘要缺口：最终窄修及现存证据支持关闭，未发现要求再次改回的理由。
- T4b 早期授权 150ms 失败缺当次阶段耗时、T7 83／3 模块404缺原 trace：属于不能追溯证明根因的历史证据限制；后续绿色未倒推出原因，不作为当前新增产品缺陷，也不称历史调查已完成。
- 大 chunk（最新 680.22kB／500kB 提示）及 NO_COLOR／FORCE_COLOR 为仍存在的非阻塞构建／工具提醒，不因重复出现累计多个 Minor；本轮没有证据证明性能故障。Hive web 安装日志两个 high 审计发现缺具体包／公告，仍是独立依赖跟进，未擅自升级或宣称无风险。
- QA 构建消费的 `.cache/t10-tauri-qa.json` 未进入历史 source manifest，且未归档完整 bundle 摘要，限制当时打包来源的独立复现；当前覆写配置不能倒填历史。实际 build／codesign／两无 GUI 专项输出仍在，不把这一限制扩成未经证明的产品故障。

## 验证充分性及交付边界

| 证据层 | 本次可以继承的结论 | 不能推出的结论 |
| --- | --- | --- |
| 原 T10 Go race 7 包、vet；Node 214；Rust 230 passed／2 ignored | 各次绑定源下的受控核心／协议／前端状态回归 | 真实官方账号、OS 集成和全部用户路径已完成 |
| 两 ignored 原生包专项另外 2 passed | 当次 ad-hoc 包 seal／副本篡改及包内 Bee hello/ping/shutdown/reap | 完整 GUI、受信签名更新安装或重启验收 |
| 正式 UI 252、preview 61、布局88、补充9 | 各自独立轮次中实际断言的组件与场景 | 同次410通过、76复合行全部通过，或隐藏区已正确 |
| fix UI25＋独立原因采图4；fix2 Node22、S05四例、selector单例及 typecheck/build | 对受影响路径的增量验证；S05具体本地化与预览消费修复；D06的账号渲染结论除外 | 重跑了全部旧 suite／最新前端已经进入历史 QA 包 |
| Linux最终 Bee＋Hive HTTP／DB／网页 | v6 的持久化配对恢复、未知提交、保存失败和兼容；网页Cancel零写／Confirm实际增量 | v9完整重跑v6或真实官方上游返回 |
| 最终运行专项 v9 | 401／403／409／503／EOF及真实 WebSocket→断开socket/listener→连接拒绝／scheduled→同run重连；暂停与停止回执 | 全部DNS／TLS／timeout／心跳／持续冲突／旧run最终外部二进制变体 |
| Ego／截图／JSON／几何 | 所列尺寸、语言、主题、焦点、模拟调用和具体可见区域 | 真实辅助技术、系统权限投递、所有自动截图人工逐张审阅 |

76 个唯一场景 ID 及必要子路径继续以现有台账为索引；当前各行均为“已验所列子路径；复合行未全验”，I2 对应的 D06 子路径还须修正。16 个未勾 Plan 项（T9 两项真实原生验收及 T10 十四项）不得由本评审改成完成。已核的来源完整性和已关闭任务审查不替代这些完成判据。

已确认暂缺资源继续独立登记：专用 OpenAI／Claude 官方测试账号与允许请求范围；Windows／Linux 真实桌面；隔离 macOS GUI 状态；可安装签名更新包。另名 QA App 无法隔离 Go 固定用户目录，不能用改产品名作为真实用户状态隔离。实际官方登录／取消／来源落点、接入换号、两平台受控上游返回、暂停后新派发及停止后准入、原生菜单／托盘／通知／自启／退出重开和签名安装恢复仍待相应真实验收，无需重新问同一资源授权。

无 token 的 creation_unknown 不能从当前协议找回 token，已证明的是安全阻塞／不重放，人工恢复闭环仍不完整。其余最终外部二进制故障变体和未展开的异常布局是尚未逐案完成，不应一律称为“环境无法验证”；I1／I2 及它们的定向回归尤其可在现有受控环境完成。

历史 T8 早108图缺逐源SHA、manual02实际1512×833、03／04才860×600；v6来源早于最后agent握手捕获、v9仅Runtime；早期Go版本取样cwd失配、采图失败及其他原始日志均保留。未用后续绿色回写来源或消除这些限制。

## 交回

**先统一修复 I1、I2，再对两个失败模式及直接消费者作有限复审。** Spec／Quality 当前均不批准；没有发现需改变批准业务设计的新取舍。其余证据按上述范围继承，整体验收缺口保持未完成；本报告不发布、合并或代替主控最终一致性与 Plan 收口。
