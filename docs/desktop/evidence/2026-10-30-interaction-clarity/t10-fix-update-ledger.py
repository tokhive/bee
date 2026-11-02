"""生成修复台账；历史台账及其证据保持只读。"""
import copy, json, pathlib

B=pathlib.Path(__file__).resolve().parents[4]
E=pathlib.Path(__file__).resolve().parent
output=E/'t10-fix-ui-frozen-output'
records={}
for p in output.rglob('*.json'):
    data=json.loads(p.read_text())
    if 'id' in data: records[data['id']]=(p,data)
for p in (E/'t10-fix-reasons-visible-final-output').rglob('*.json'):
    data=json.loads(p.read_text())
    if 'id' in data: records[data['id']]=(p,data)
def source(p):
    name='t10-fix-reasons-visible-final.json' if 't10-fix-reasons-visible-final-output' in p.parts else 't10-fix-ui-frozen.json'
    return str((E/name).relative_to(B))
scopes={
 'R01':(['R01-account-reads-pending','R01-account-reads-pending-accounts','R01-no-selection','R01-accounts-unconfirmed','R01'], '无已选账号：开始禁用、具体接入说明与账号入口；独立账号读取未完成：设备bound/运行stopped可信、两平台account_snapshot未完成，数量待确认不显示零，账号页来源读取中且导航零写。runtime提供可信not_selected，不把后续账号读取未完成等同运行未知；共享runtime读取失败另作附加路径。'),
 'S05':(['S05-config-invalid','S05-protocol-mismatch','S05-integrity-blocked'], '正式组件分别呈现DEVICE_CONTEXT_INVALID、Rust实际VERSION_MISMATCH及BUNDLED_BEE_INVALID；展开本次JSON字节/协议版本/SHA原始原因，零写。仅模拟IPC故障DTO，不证明真实损坏文件保留或签名安装；两桥错误的当前摘要仍为通用文案，具体原因在展开详情。'),
 'D06':(['D06-bound-stopped-no-selection'], '首次pending经模拟网页批准并只读核对后bound、stopped、两平台not_selected、开始禁用且零写；历史真实网页v2的POST/DB增量与最终核心stopped证据仍按其原来源保留。'),
 'A04':(['A04-keyring-unsupported'], '实际unsupported store reason=keyring_not_supported_on_this_os，keyring选项disabled、可读说明、当前file保留且零写；真实目标OS读取仍待验。'),
 'A08':(['A08-official-query-failed'], 'official capability=rate_limited、HTTP429、retry_after_seconds=25及真实retry_at字段；展开失败环节与原始原因、本地候选保留且零授权/接入/开始。仅模拟官方查询结果，不是实际官方请求。'),
 'L02':(['L02-running-login-disabled','L02-stop-entry'], '真实运行中组件重新登录disabled、明确先停止说明；查看贡献运行跳转实际runtime目标获焦且停止按钮可用，零自动停止/登录/接入。真实官方进程仍待验。'),
 'L05':(['L05-authorization_source_unchanged','L05-authorization_namespace_mismatch'], '实际authorize操作failed分别为来源未变/namespace不符，显示具体失败、一次authorize_start、零接入/开始；真实官方客户端及文件落点仍待验。'),
 'W04':(['W04-stale-confirmation'], '打开换号确认后真实增加revision，旧确认disabled并显示条件变化，account_action=0、runtime_start=0；关闭重开后新revision确认沿用既有native-runtime回归来源。'),
 'W05':(['W05-original-operation-unconfirmed','W05-original-operation-diagnostics'], '接入提交回执未知，原operation.id及reconciling跨诊断/账号页保留；仅核对原操作，account_action始终1、runtime_start=0。不同于旧supply PUT503关联图；真实官方接入回执丢失仍待验。'),
 'P04':(['P04-detailed-reasons'], '分别断言五详细原因account_not_registered/market_not_open/supply_not_enabled/supply_device_restricted/account_not_admitted，每个原因滚动至可见后独立截图；零写，不据合成已确认供给事实证明真实上游。'),
 'P05':(['P05-existing-reasons'], '分别断言banned/device_draining/offline/model_unavailable/authorization_unavailable/capabilities_unknown/plan_not_configured，每个原因独立视口截图；零写，真实Hive/数据库语义沿用原定向证据。'),
 'P06':(['P06-limit-reasons'], '分别断言rate_limited/quota_unknown/quota_exhausted/concurrency_full原因与处理说明，每个原因独立视口截图；零写，真实额度及请求仍待验。'),
 'P07':(['P07-source-authorization-reasons'], 'OpenAI与Claude分别断言source_unavailable/confirmation_required/authorization_rejected六个真实reason码对应文案与处理入口，每个原因独立视口截图且零写；真实来源和官方授权仍待验。'),
 'U05':(['U05-trusted-previous','U05-unproven-protected'], '复用现有更新recovery DTO：可信旧版本未安装目标与恢复证据不足继续保护两分支；显示可重试检查/只读回读入口，零自动检查/下载/安装。不是实际签名安装或重启验收。'),
 'G05':(['G05-logs-filtered-more','G05-logs-filtered-rotation','G05-logs-unread','G05-logs-empty','G05-logs-loading'], '安全日志未读取/空/读取中/筛选与轮转、手动刷新及分页cursor均有实际画面与调用，未读前diagnostic_logs=0；仅手动读取、零业务写、零诊断启动。'),
}
historical={
 'R01':'历史stopped图实际selected OpenAI、开始可用，是前提反例，不能支持R01无账号/未确认。',
 'S05':'历史bridge-failed只关联管理进程退出，未呈现配置/协议/完整性受阻。',
 'D06':'历史device-bound图实际running/selected，不能支持绑定完成后停止且不自动接入。',
 'A04':'历史普通来源设置未建立unsupported store前提。',
 'A08':'历史supply503关联图不是official查询失败或retry_at。',
 'L02':'历史account-candidate不是运行中登录禁用。',
 'L05':'历史permission_denied不是来源未变或namespace不符的authorize失败。',
 'W04':'历史confirm-change是有效确认，不支持revision变化后旧确认禁用。',
 'W05':'历史check-waiting为supply PUT503，不支持account operation未知。',
 'P04':'历史组合图只支持其实际显示原因，不能支持五原因全画面。',
 'P05':'历史组合图只支持其实际显示原因，不能支持七原因全画面。',
 'P06':'历史组合图未展开全部额度/限流/并发原因。',
 'P07':'历史图未逐项呈现两平台全部来源/授权原因。',
 'U05':'历史update-failed签名失败支持U02，不能支持U05恢复两分支。',
 'G05':'历史diagnostics入口未呈现安全日志的空/筛选/读取中子状态。',
}
ledger=copy.deepcopy(json.loads((E/'t10-scenario-ledger.json').read_text()))
for row in ledger:
    if row['id'] not in scopes: continue
    ids,scope=scopes[row['id']]
    row['historical_evidence']={k:row[k] for k in ['scene','layout_json','screenshot','observed_at','source_manifest','verified_scope']}
    row['historical_evidence']['limitation']=historical[row['id']]
    row['fix_subpaths']=[]
    for ident in ids:
        p,data=records[ident]
        shot=p.with_suffix('.png')
        entry=p.with_name(p.stem+'-entry.png')
        item={'id':ident,'layout_json':str(p.relative_to(B)),'screenshot':str(shot.relative_to(B)),'source_manifest':source(p)}
        if entry.exists():item['entry_screenshot']=str(entry.relative_to(B))
        item['reason_screenshots']=[str(x.relative_to(B)) for x in sorted(p.parent.glob(p.stem+'-*.png')) if x!=entry]
        row['fix_subpaths'].append(item)
    p,data=records[ids[0]]
    row.update(scene=ids[0],layout_json=str(p.relative_to(B)),screenshot=str(p.with_suffix('.png').relative_to(B)),observed_at=data['observed_at'],verified_scope=scope,source_manifest=source(p))
    row['fix_archive_manifest']=str((E/'t10-fix-source-manifest.json').relative_to(B))
(E/'t10-fix-scenario-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
doc=B/'docs/desktop/interaction-clarity-validation.md'
lines=doc.read_text().splitlines()
for i,line in enumerate(lines):
    if not line.startswith('| '):continue
    ident=line.split('|')[1].strip()
    if ident not in scopes:continue
    row=next(x for x in ledger if x['id']==ident)
    links=[]
    for item in row['fix_subpaths']:
        links.append('['+item['id']+'画面]('+item['screenshot'].removeprefix('docs/desktop/')+')／[DTO与实际调用]('+item['layout_json'].removeprefix('docs/desktop/')+')')
    cells=line.split('|')
    cells[-2]=' '+row['verified_scope']+' '+'；'.join(links)+'；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 '
    lines[i]='|'.join(cells)
doc.write_text('\n'.join(lines)+'\n')
print(json.dumps({'rows':len(ledger),'updated':sorted(scopes),'source':'t10-fix-ui-frozen.json'},ensure_ascii=False))
