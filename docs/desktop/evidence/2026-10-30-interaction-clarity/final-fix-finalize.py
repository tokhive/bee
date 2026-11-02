"""从既有命令记录生成本轮增量manifest及中文报告；拒绝覆盖。"""
import datetime
import hashlib
import json
import pathlib

B = pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
E = B / 'docs/desktop/evidence/2026-10-30-interaction-clarity'
REPORT = B / '.superpowers/sdd/final-fix-report.md'
MANIFEST = E / 'final-fix-manifest.json'
assert not REPORT.exists() and not MANIFEST.exists(), 'refusing to overwrite final records'
audit = json.loads((E / 'final-fix-preservation.json').read_text())
assert audit['passed']


def record(path):
    data = path.read_bytes()
    return {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def link(path, label=None):
    return '[' + (label or path.name) + '](' + str(path) + ')'


commands = {}
for path in sorted(E.glob('final-fix-*.json')):
    data = json.loads(path.read_text())
    if 'argv' in data:
        assert data.get('finished_at') and 'exit' in data, path
        commands[path.stem] = {
            key: data[key] for key in ['cwd', 'argv', 'started_at', 'finished_at', 'exit', 'bee_head', 'hive_head', 'hive_bee_gitlink', 'node', 'go', 'rust']
        }
        commands[path.stem].update(metadata=str(path.relative_to(B)), log=str(path.with_suffix('.log').relative_to(B)), source_count=len(data['source_sha256']), source_index_sha256=hashlib.sha256(json.dumps(data['source_sha256'], sort_keys=True).encode()).hexdigest())
artifacts = {}
for path in sorted(E.rglob('*')):
    if path.is_file() and path.relative_to(E).parts[0].startswith('final-fix-') and path != MANIFEST:
        artifacts[str(path.relative_to(B))] = record(path)
manifest = {
    'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': '最终审查I1/I2增量；不覆盖旧manifest，不宣称T10/76行/全部Plan完成',
    'bee_base': '5aef32ebed973aa2827d38d0e004827060c28a4b',
    'bee_product_commit': audit['bee_product_commit'], 'hive': audit['hive'],
    'product_sources': audit['product_sources'],
    'validation_document': {'path': 'docs/desktop/interaction-clarity-validation.md', **record(B / 'docs/desktop/interaction-clarity-validation.md')},
    'new_artifacts': artifacts, 'new_artifact_count': len(artifacts),
    'commands': commands,
    'verification_source_coverage': audit['verification_source_coverage'],
    'external_binaries': audit['external_binaries'],
    'binary_command_sources': {'bee-final-fix': ['final-fix-linux-core-build.json', 'final-fix-linux-runtime.json'], 'hive-integration-final-fix.test': ['final-fix-linux-hive-test-build.json', 'final-fix-linux-runtime.json']},
    'preservation': audit['preservation'],
    'old_baseline_sources': {name: record(E / name) for name in ['final-fix-baseline.json', 't10-fix2-initial-state.json']},
    'self_exclusion': '本manifest不包含自身，避免递归散列；证据提交由实际Git提交对象及主控postcommit核证绑定。',
    'report_boundary': 'final-fix-report.md是本地忽略sidecar，在证据提交后写入该提交号；不作为冻结E artifact递归散列。',
}
with MANIFEST.open('x') as stream:
    json.dump(manifest, stream, ensure_ascii=False, indent=2)

text = f'''# 最终审查统一修复报告：I1 / I2

日期：2026-11-03。状态：DONE / CONCERNS。本轮完成两项既有批准行为的修复、专项回归和增量证据归档，交回主控审查；不宣称最终审查已通过，也不勾选 T10、76 个复合场景或整个 Plan。

## 范围、提交与根因

- Bee 工作树 B：`{B}`；BASE：`5aef32ebed973aa2827d38d0e004827060c28a4b`。
- Hive 工作树 H：`{B.parent / 'hive-desktop-interaction'}`；HEAD：`87e3233faa3b00e2a207e6dc0fdc5ea380c3a02a`；gitlink：`ab8140a175f1c1c6fd4c689fc1bd1e23e82e180f`。本轮 H 未改动、未提交。
- 产品/测试提交：`843e3fff557d723ed8626c081f8cecf2567856a5`，`fix(desktop): clear recovered platform synchronization failures`；仅下列 7 路径。
- 证据/台账提交：`__EVIDENCE_COMMIT__`，`test(desktop): record final synchronization recovery evidence`。本报告按原约定留在本地忽略 sidecar；不 force-add 旧报告目录。
- 已全文读取 `.superpowers/sdd/final-fix-brief.md`、`final-review.md`、`final-evidence-review.md`。按 global-conventions、systematic-debugging、TDD、fail-fast-with-evidence、high-stakes-implementation-testing、verification-before-completion、git-commit 及适用 UI/ego-browser 指引执行；本轮是统一修复者，不另起全分支审查。

I1 根因：平台 worker 的失败会写当前 `connection_detail`，同连接内同步及全部回读成功却无成功发布分支；原 `synchronizationObserved(nil)` 直接返回。当前故障只能等重连或停止清除。修复让内部连接对象按平台保存失败，归属 connection/run；只有该平台真正完成同步、授权与供给回读后才移除其失败。当前显示平台恢复时，转而显示尚未恢复的平台；全部恢复才清空。另一平台成功不会清掉未证明恢复的错误，未造重连 timer 或 retry 时间。

同时将原先分离且无此作用域检查的 `platformFailure` 账号 Authorization/revision 与平台 Supply 失效发布，合并进 `synchronizationObserved` 的同一受保护区。成功和失败共同受 runtime mu/syncMu、run、当前 connection、active、ctx、running/connected、closed 守卫约束。迟到失败不能再先污染账号再因连接守卫拒绝 detail。原授权/供给事实、所有版本与停止屏障保留。

I2 根因：模拟 `finishRecovery` 将已选择账号重置成同一 revision=1 的未选择事实，首次绑定 context 又未推进 binding_revision；正式 `useAccounts` 正确拒绝同作用域同版本变化，实际页面继续保留旧账号。修复 fixture 在重置事实时推进每个平台 account revision，同时推进 context binding_revision，并让首次完成后的 device-unbound context 反映已绑定事实。没有修改 useAccounts、DTO、严格 decoder 或真实绑定规则。

## 修改路径

| 路径 | 变更与对应验证 |
| --- | --- |
| {link(B / 'agent/desktop_runtime_sync.go', 'agent/desktop_runtime_sync.go')} | 按平台/connection/run保存同步失败；完整成功后清除；账号与供给失败发布纳入相同守卫；真实worker与race验证。 |
| {link(B / 'agent/desktop_runtime_test.go', 'agent/desktop_runtime_test.go')} | 原真实Runtime fixture新增同步503、回读503后同连接成功两个子例，核暂停、零PUT及停止。 |
| {link(B / 'agent/desktop_connection_test.go', 'agent/desktop_connection_test.go')} | 跨平台与双失败恢复；旧run/connection、inactive、stopping/stopped、cancelled/closed的成功/失败完整Snapshot不变，含账号revision、Authorization和Supply。 |
| {link(B / 'desktop/tests/fixtures/bee-preview/fixture.mjs', 'desktop/tests/fixtures/bee-preview/fixture.mjs')} | 首次绑定/恢复的绑定与账号版本推进，恢复保持stopped/paused。 |
| {link(B / 'desktop/tests/t10-layout-fix.spec.ts', 'desktop/tests/t10-layout-fix.spec.ts')} | D06实际渲染断言、账号滚动可见图；正式NativeRuntimeControls消费Go detail转换，恢复后无旧故障而暂停/未接入保留，零业务写。 |
| {link(B / 'desktop/tests/fixtures/synchronization-recovery.json', 'desktop/tests/fixtures/synchronization-recovery.json')} | 来自本轮真实Go scope日志的4个detail转换，保存原log SHA。 |
| {link(B / 'desktop/playwright.final-fix.config.ts', 'desktop/playwright.final-fix.config.ts')} | 仅选择现有两个fixture直接消费者，使用自有1519服务。 |

另外仅更新 {link(B / 'docs/desktop/interaction-clarity-validation.md')} 的 D06/R04 子路径和 {link(E / 'final-fix-scenario-ledger.json')}。两行仍为“子路径已验；整行待验”。本轮未改CSS/布局，四页及摘要/设备/账号层次、开始停止与额度区动作位置沿用原布局。

## RED 与 GREEN 的实际结论

有效行为 RED：

- {link(E / 'final-fix-red-runtime.log')}：原 `desktop_runtime_sync.go` SHA 与 BASE blob 相同，两新增真实 worker 子例均在 `same-connection successful synchronization retained current failure` 失败，exit=1。
- {link(E / 'final-fix-red-d06-native.log')}：原 fixture SHA 与 BASE blob 相同，正式 NativeApp 实际找不到“0 个已接入”，exit=1。对应 error-context/trace 保留实际1账号、bbbb、Plus及3%/2%；未用fixture输入代替渲染断言。

GREEN 分开计数，不合并重复轮次：

| 证据 | 本次实际结论 |
| --- | --- |
| {link(E / 'final-fix-green-runtime-worker.log')} | 两个实际Start→WebSocket→startSlotLocked→真实加密同步→503→2秒worker重试成功子例通过。same run、单一连接、detail消失、Authorization synchronized、暂停保持、恢复阶段supply/resume PUT=0，显式停止。 |
| {link(E / 'final-fix-green-scopes.log')} | 原scope单例扩展通过；4个Go detail转换为正式消费者输入来源。 |
| {link(E / 'final-fix-affected-go-race.log')} | 受影响Connection/Runtime race，1包通过，无skip/fail；94条PASS含父/子，不称94个独立顶层测试。 |
| {link(E / 'final-fix-scope-barriers-race.log')} | 追加完整Snapshot守卫断言后，最终connection测试源码定向race通过。 |
| {link(E / 'final-fix-affected-go-vet.log')} | `go vet ./agent ./desktopbridge ./cmd/bee` exit=0。 |
| {link(E / 'final-fix-green-components-final.log')} | 最终7路径源码下D06＋NativeRuntimeControls两项，2 passed；中文light、860×600、reducedMotion=true。 |
| {link(E / 'final-fix-fixture-direct-consumers-final.log')} | 首次未绑定→绑定、不同owner撤销恢复的两个既有直接消费者，2 passed。 |
| {link(E / 'final-fix-typecheck-committed.log')} | 产品提交后 `npm run typecheck` exit=0，最终7路径SHA全部匹配。 |

D06 的断言对象为实际页面：批准前1个已接入，批准并只读核对后实际0个已接入、OpenAI与Claude均未接入；main无旧bbbb、Plus、3%和2%，开始禁用、stopped、零业务写。完成首屏、OpenAI滚动区与Claude滚动区分别存图和实际正文JSON，入口为 {link(E / 'final-fix-green-components-final-output')}。runtime消费者先证明Claude恢复后OpenAI错误仍在，再证明全部恢复后旧错误/自动重连提示消失，手动暂停和Claude未接入仍可见。

所有失败保留并准确归类：`red-d06` 的 `^D06-` 未选中测试（No tests found）；`red-d06-behavior` 最初误用 `--mode e2e` 进入demo而未满足Native前置。这两次不是行为RED。`green-runtime` 实际只选中了scope，不称它执行两个worker；worker另见上述专门命令。`green-runtime-consumer` 因断言文案误写“此平台已手动暂停”而失败，改成实际文案“已手动暂停”后重跑通过。早期green-d06/components/direct-consumers/typecheck记录只保留其各自当时来源，不拼成同一次总数。

## 新Linux二进制与真实边界

本轮重新构建Bee及只读H源码对应的race集成二进制，并在新专属internal网络/临时Postgres schema中运行。路由实查无default route、不发布端口、全部synthetic身份，不读取真实账号。构建、来源及运行原始记录分别为 {link(E / 'final-fix-linux-core-build.log')}、{link(E / 'final-fix-linux-hive-test-build.log')}、{link(E / 'final-fix-linux-runtime.log')}。

| 新文件 | bytes | SHA256 |
| --- | ---: | --- |
| `.cache/interaction-clarity-linux/bee-final-fix` | 30965181 | `313a32810ac16b5fa9d640c8fdfb41995817d14da2d2cb49d1840151caa5329c` |
| `.cache/interaction-clarity-linux/hive-integration-final-fix.test` | 71859248 | `148825231574ecc350bfa890d8c5b36bf69ab3793e2df7a2e8f726aaea599706` |

实际执行 `^TestDesktopBroker(FinalBinaryProvenance|Runtime)`，exit=0，无skip；核新Bee SHA、401/403/409/503/EOF握手、真实socket/listener关闭→refused/scheduled→同run重连、paused、零resume PUT与完整停止回执。Linux工具链为已验证Go1.27.3 linux/arm64，H以只读volume构建，Hive产品与gitlink未改。

该专项证明新外部二进制的Runtime边界回归；没有额外实现外部二进制“同平台同步503→同连接同步与全部回读成功”专项，此恢复链由上述真实Go in-process worker证明。旧v6/v9只沿用各自原来源，不把旧包重标为包含本轮代码，也不声称重跑全恢复矩阵。

## Ego、截图与原生界限

人工浏览器只创建自有space43/p1，未触碰用户space1/37。D06执行模拟approve后点击真实“重新核对设备”，核实际0账号/双未接入/旧值消失/stopped/开始禁用/零业务写；runtime使用Go产出的detail，在正式组件内展开安全详情，核剩余OpenAI失败与最终恢复画面。记录为 {link(E / 'final-fix-ego-d06.json')}、{link(E / 'final-fix-ego-runtime.json')}，截图为本轮 `final-fix-ego-*.png`。已实际查看D06 OpenAI区与runtime恢复图；主控另独立查看正式Playwright三张图。

Ego跨调用CDP viewport/media未持续，实际JSON均为1512×833、reducedMotion=false，按常规尺寸功能路径登记。860×600与减少动态效果由独立Playwright记录证明，未把两层属性互相挪用。截图和模拟IPC只支持所述正式组件子路径，不证明原生系统或真实官方恢复副作用。

首次finish脚本在调用finish前因不支持 `Browser.getVersion` 报错（exit=1），当次未执行finish。v2只实际执行一次 `task.finish({{keep:[]}})`；{link(E / 'final-fix-ego-finish-receipt.json')} 回执为closedSpace=true、closedManagedLabels=[p1]、preservedUnmanagedCount=0、completedFinishCalls=1。工具提示当前Ego0.6.1.13有更新，本轮遵照边界未升级。

## 来源、保持与资源清理

{link(E / 'final-fix-audit.log')} 及 {link(E / 'final-fix-preservation.json')} 实际逐文件验证：原 `t10-fix2-initial-state.json` 全部1040项dirty/untracked、本轮baseline的934项dirty和2143份旧artifact，size/SHA全部相同，differences=[]、exclusions=[]。未覆盖旧失败、trace、图、JSON或manifest；Makefile、README、spec、decision trace、Plan、报告、prototype等旧状态均保留。

产品7文件当前字节等于产品提交blob。Go worker/race/vet与构建使用最终Go产品源码；后续只增强connection测试的完整Snapshot断言，另以最终定向race证明。最终组件、fixture直接消费者与提交后typecheck的7路径SHA全部等于产品提交。每轮完整真实输入SHA索引留在其metadata；跨轮不同源码不伪装为同一来源，详见保持回执的verification_source_coverage。

Vite初次mode错误PID9506及正确Native服务PID15329均先核PID/命令/精确cwd再SIGTERM；服务log保留实际143退出，表示主动收尾，不计测试通过或行为失败。新DB/容器/network在finally按任务名/label回收。最终audit核1518/1519无listener，任务Docker容器与network为空；H HEAD/status/gitlink保持原值。`git diff --check` exit=0。

新 {link(MANIFEST)} 包含产品提交、7修改源/commitblob SHA、台账文档及{len(artifacts)}份本轮新artifact的size/SHA、外部二进制来源和每条命令索引；不包含manifest自身以免递归。证据提交以实际Git对象绑定，主控可据此再核。提交前仅stage验证台账及本轮final-fix前缀路径，未盲stage/clean旧文件。

自检：两项发现的全部要求均有对应实现/行为或版本屏障证据；失败保留且未伪计通过；旧文件保持、H、来源和资源核证已落盘；D06/R04仍保留整行未完成；未启动完整GUI或操作固定用户状态目录，未push/merge/部署。编辑窗口于本报告和证据提交完成后交回主控。

## Concerns

真实账号、OpenAI/Claude官方请求与原生登录副作用、隔离macOS GUI、Windows/Linux桌面、签名安装/更新包仍缺资源，未被本轮组件或核心专项替代。本轮只覆盖I1/I2，完整DNS/TLS/timeout/心跳外部变体、外部二进制同平台完整成功链及其余复合行/Plan的缺口继续保留。Ego版本更新仅记录，未升级。最终审查及整体验收结论由主控另行给出。

## 精确命令与UTC记录

以下每项直接摘自对应metadata。argv是实际进程参数数组，cwd为绝对路径；metadata另保存当次B/H HEAD、完整dirty状态、gitlink、真实输入SHA、Node/Go/Rust版本。完整stdout/stderr以原log为准；终端摘要截短不改变原log。执行器只在子进程指定NVM Node24.22.1、GOTOOLCHAIN=go1.27.3、RUSTUP_TOOLCHAIN=1.94，未改全局环境。
'''
for name, data in commands.items():
    text += '\n### ' + name + '\n\n'
    text += '- cwd：`' + data['cwd'] + '`\n'
    text += '- argv：`' + json.dumps(data['argv'], ensure_ascii=False) + '`\n'
    text += '- UTC：`' + data['started_at'] + '` → `' + data['finished_at'] + '`；exit=`' + str(data['exit']) + '`。\n'
    text += '- 工具：`' + data['node'] + '`；`' + data['go'] + '`；`' + data['rust'] + '`；来源索引 ' + str(data['source_count']) + ' 项。\n'
    text += '- ' + link(B / data['metadata'], 'metadata/真实输入SHA') + '；' + link(B / data['log'], '完整原始输出') + '。\n'
with REPORT.open('x') as stream:
    stream.write(text)
print(json.dumps({'manifest': str(MANIFEST), 'artifact_count': len(artifacts), 'command_count': len(commands), 'report': str(REPORT), 'report_lines': len(text.splitlines())}, ensure_ascii=False))
