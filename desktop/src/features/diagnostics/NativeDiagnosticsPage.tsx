import {useEffect,useRef,useState} from 'react';
import {Dialog,Tabs} from 'radix-ui';
import {CircleAlert,ShieldCheck} from 'lucide-react';
import {t} from '../../i18n/index';
import type {DiagnosticCheck,DiagnosticEvent,DiagnosticPage,DiagnosticReport,DiagnosticsClient,LogQuery} from '../../system/diagnostics';
import {downloadPayload} from './report';
import {partitionChecks} from './presentation';
import '../../styles/section-tabs.css';
import './native-diagnostics.css';

const checkNames:Record<DiagnosticCheck['id'],string>={device:'设备身份',runtime:'贡献进程',hive:'Hive 连接',proxy:'网络路径',source:'官方登录来源',authorization:'官方授权',quota:'订阅额度',capabilities:'能力同步',account:'账号绑定',supply:'接单状态'};
const statuses={pass:'通过',warning:'需要留意',fail:'检查失败',skipped:'未检查'};
const destinations:Record<DiagnosticPage,string>={overview:'查看概览',accounts:'前往账号',diagnostics:'诊断',settings:'查看设置'};
const messages:Record<string,string>={pending:'等待检查',not_checked:'本次未完成此项检查',cancelled:'检查已取消',timeout:'检查超时',device_not_paired:'请先在设置中配对设备',device_binding_valid:'设备身份已核对',owned_runtime_connected:'贡献进程已连接',runtime_stopped:'贡献进程尚未运行',runtime_ownership_conflict:'检测到其他 Bee 进程',hive_identity_verified:'Hive 身份已核对',network_policy_observed:'已核对当前网络路径',network_changed:'网络配置已变化，请重新运行诊断',source_not_selected:'尚未选择此平台的账号',selected_source_read:'已读取所选官方登录',source_missing:'官方登录不存在',source_changed:'官方登录已变化，请前往账号重新检测',authorization_expired:'官方授权已失效',official_authorization_observed:'官方授权已核对',quota_available:'订阅额度可用',quota_exhausted:'订阅额度已耗尽',account_binding_verified:'账号绑定已核对',account_changed:'账号在检查期间发生变化',capabilities_synchronized:'能力已同步',taking_new_work:'可以接收新任务',supply_blocked:'当前未接收新任务',dns_failed:'域名解析失败',tls_failed:'安全连接校验失败',connection_failed:'无法连接服务',http_rejected:'服务拒绝了本次查询',rate_limited:'查询受到限流，请稍后重试'};
const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
function failure(cause:unknown){return cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message'in cause?String(cause.message):'DIAGNOSTICS_OPERATION_FAILED: native operation returned no failure evidence';}
export interface NativeDiagnosticsPageProps {client:DiagnosticsClient;onNavigate:(page:DiagnosticPage)=>void;instance:string|undefined;networkRevision:number;runId?:string|null}
export function NativeDiagnosticsPage({client,onNavigate,instance,networkRevision,runId}:NativeDiagnosticsPageProps){
 const [activeTab,setActiveTab]=useState('checks'),[logsLoaded,setLogsLoaded]=useState(false);
 const [report,setReport]=useState<DiagnosticReport|null>(()=>client.getSnapshot());
 const [busy,setBusy]=useState<'start'|'cancel'|'export'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [logs,setLogs]=useState<DiagnosticEvent[]>([]),[cursor,setCursor]=useState<string|null>(null),[truncated,setTruncated]=useState(false),[logsBusy,setLogsBusy]=useState(false),[logsError,setLogsError]=useState('');
 const [filters,setFilters]=useState<Pick<LogQuery,'module'|'platform'|'level'>>({module:null,platform:null,level:null});
 const [exportOpen,setExportOpen]=useState(false),[includeLogs,setIncludeLogs]=useState(false);
 const scope=`${instance}:${networkRevision}:${runId===undefined?'unset':runId??'stopped'}`;
 const owner=useRef({client,scope}),mounted=useRef(false),logRequest=useRef(0);
 owner.current={client,scope};
 const current=()=>mounted.current&&owner.current.client===client&&owner.current.scope===scope;
 const visible=report&&report.instance===instance&&report.network_revision===networkRevision&&(runId===undefined||report.run_id===runId)?report:null;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  client.setContext(networkRevision,runId);setReport(client.getSnapshot());setError('');setNotice('');setBusy(null);setExportOpen(false);logRequest.current++;setLogs([]);setLogsLoaded(false);setCursor(null);setTruncated(false);setLogsBusy(false);setLogsError('');
 },[client,scope,networkRevision,runId]);
 useEffect(()=>{
  if(!visible||visible.state!=='running')return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const next=await client.snapshot(visible.id);if(stopped||!current())return;setReport(next);if(next.state==='running')timer=setTimeout(()=>void poll(),800);}catch(cause){if(!stopped&&current())setError(failure(cause));}};
  timer=setTimeout(()=>void poll(),800);return()=>{stopped=true;clearTimeout(timer);};
 },[client,scope,visible?.id,visible?.state]);
 async function run(action:'start'|'cancel'){
  if(busy)return;setBusy(action);setError('');setNotice('');
  try{const next=action==='start'?await client.start():await client.cancel(visible!.id);if(current())setReport(next);}
  catch(cause){if(current())setError(failure(cause));}
  finally{if(current())setBusy(null);}
 }
 function filter(next:typeof filters){logRequest.current++;setFilters(next);setLogs([]);setLogsLoaded(false);setCursor(null);setTruncated(false);setLogsBusy(false);setLogsError('');}
 async function loadLogs(more=false){
  if(logsBusy)return;const request=++logRequest.current;setLogsBusy(true);setLogsError('');
  try{const page=await client.logs({cursor:more?cursor:null,limit:50,...filters});if(current()&&request===logRequest.current){setLogs(previous=>more?[...previous,...page.entries]:page.entries);setCursor(page.next_cursor);setTruncated(page.truncated);setLogsLoaded(true);}}
  catch(cause){if(current()&&request===logRequest.current)setLogsError(failure(cause));}
  finally{if(current()&&request===logRequest.current)setLogsBusy(false);}
 }
 async function exportReport(){
  if(!visible||busy)return;setBusy('export');setError('');setNotice(t('正在生成脱敏报告…'));
  try{
   const payload=await client.export(visible.id,includeLogs);if(!current())return;
   setExportOpen(false);setNotice(t('正在等待报告下载结果…'));
   const result=await downloadPayload(new Blob([JSON.stringify(payload)],{type:'application/json'}),'bee-diagnostics.json');
   if(current())setNotice(t(result==='completed'?'脱敏报告已下载。':result==='unconfirmed'?'报告下载结果未确认：waitedMs=30000；请先核对下载文件夹，避免重复导出。':'已发起报告文件下载；请在下载列表核对。'));
  }catch(cause){if(current()){setNotice('');setError(failure(cause));}}
  finally{if(current())setBusy(null);}
 }
 const sections=partitionChecks(visible?.checks??[]);
 const issues=Object.values(sections.issues).flat();
 const allPassed=visible?.state==='completed'&&visible.checks.length>0&&sections.passed.length===visible.checks.length;
 function renderCheck(check:DiagnosticCheck){return <li key={`${check.id}:${check.platform}`} data-status={check.status}>
  <div className="nd-check-heading"><div><h3>{check.platform&&<span className="nd-platform">{check.platform==='openai'?'OpenAI':'Claude'}</span>}{t(checkNames[check.id])}</h3><p>{t(messages[check.code]??'此项结果未确认，请查看安全证据。')}</p></div><span className={`nd-status nd-status-${check.status}`}>{t(check.code==='pending'?'等待检查':statuses[check.status])}</span></div>
  <div className="nd-check-footer"><details><summary>{t('安全证据')}</summary><p>{check.code}</p><dl>{Object.entries(check.evidence).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><time dateTime={check.observed_at}>{date(check.observed_at)}</time></details>{check.status!=='pass'&&check.code!=='pending'&&check.next_action!=='diagnostics'&&<button className="quiet" onClick={()=>onNavigate(check.next_action)}>{t(destinations[check.next_action])}</button>}</div>
 </li>;}
 return <Tabs.Root className="native-diagnostics section-tabs" data-testid="native-diagnostics" value={activeTab} onValueChange={setActiveTab}>
  <div className="nd-tabbar">
   <Tabs.List className="section-tabs-list" aria-label={t('诊断内容')}><Tabs.Trigger value="checks">{t('检查结果')}</Tabs.Trigger><Tabs.Trigger value="logs">{t('安全日志')}</Tabs.Trigger></Tabs.List>
   <div className="inline-actions nd-actions">{activeTab==='checks'?<>
    <button className="primary" disabled={!instance||!!busy||visible?.state==='running'} aria-busy={busy==='start'} onClick={()=>void run('start')}>{t(visible?'重新运行诊断':'运行诊断')}</button>
    {visible?.state==='running'&&<button disabled={!!busy} onClick={()=>void run('cancel')}>{t('取消诊断')}</button>}
   <Dialog.Root open={exportOpen} onOpenChange={next=>{if(!busy)setExportOpen(next);}}><Dialog.Trigger asChild><button disabled={!!busy||!visible}>{t('导出脱敏报告')}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content nd-export"><Dialog.Title>{t('选择导出范围')}</Dialog.Title><Dialog.Description>{t('报告保存在本机，最多 5 MiB。超出范围会明确标记截断。')}</Dialog.Description>
     <fieldset disabled={busy==='export'}><legend>{t('导出内容')}</legend><label><input type="radio" name="diagnostic-export-scope" checked={!includeLogs} onChange={()=>setIncludeLogs(false)}/><span>{t('仅本次检查结果')}</span></label><label><input type="radio" name="diagnostic-export-scope" checked={includeLogs} onChange={()=>setIncludeLogs(true)}/><span>{t('本次检查结果与安全日志')}</span></label></fieldset>
     <p>{t('不包含登录凭证、个人路径或请求内容。')}</p><div className="dialog-actions"><Dialog.Close asChild><button disabled={busy==='export'}>{t('取消')}</button></Dialog.Close><button className="primary" disabled={!!busy} onClick={()=>void exportReport()}>{t('确认导出')}</button></div>
    </Dialog.Content></Dialog.Portal>
   </Dialog.Root>
   </>:<button disabled={logsBusy} aria-busy={logsBusy} onClick={()=>void loadLogs()}>{t('刷新日志')}</button>}</div>
  </div>
  {error&&<p className="nd-error" role="alert">{error}</p>}{notice&&<p className="operation-message" role="status">{notice}</p>}
  <Tabs.Content value="checks">
   {!visible?<div className="nd-empty"><ShieldCheck aria-hidden="true"/><h2>{t('尚未运行诊断')}</h2><p>{t('点击运行诊断，查看当前设备的真实检查结果。')}</p><small>{t('检查设备、账号与网络；诊断不会开始贡献。')}</small></div>:<>
    <div className="nd-report-meta"><div><span>{t(visible.state==='running'?'诊断进行中':visible.state==='cancelled'?'诊断已取消':'检查已完成')}</span><time dateTime={visible.started_at}>{date(visible.started_at)}</time></div><div className="nd-counts">{(['fail','warning','pass','skipped'] as const).map(status=><span key={status} data-status={status}>{t(statuses[status])}<strong>{visible.checks.filter(check=>check.status===status).length}</strong></span>)}</div></div>
    {issues.length>0&&<section className="nd-issues" aria-label={t('需要处理的问题')}><header><h2>{t('需要处理的问题')}</h2><span>{issues.length}</span></header>{(['device','openai','claude'] as const).map(group=>sections.issues[group].length>0&&<section className="nd-issue-group" key={group}><header><CircleAlert aria-hidden="true"/><h3>{group==='device'?t('设备与连接'):group==='openai'?'OpenAI':'Claude'}</h3><span>{sections.issues[group].length}</span></header><ul className="nd-checks">{sections.issues[group].map(renderCheck)}</ul></section>)}</section>}
    {allPassed&&<div className="nd-all-passed"><ShieldCheck aria-hidden="true"/><div><h2>{t('全部检查通过')}</h2><p>{t('本次已返回的检查均通过。')}</p></div></div>}
    {!issues.length&&!allPassed&&<p className="nd-incomplete">{t(visible.state==='running'?'检查仍在进行，尚不能确认全部结果。':visible.state==='cancelled'?'本次诊断已取消，以下为已返回的检查。':'本次尚有未完成或未确认的检查。')}</p>}
    <details className="nd-fold" data-testid="unfinished-checks"><summary>{t('尚未完成的检查')}<span>{sections.unfinished.length}</span></summary><ul className="nd-checks">{sections.unfinished.map(renderCheck)}</ul></details>
    <details className="nd-fold" data-testid="passed-checks"><summary>{t('通过的检查')}<span>{sections.passed.length}</span></summary><ul className="nd-checks">{sections.passed.map(renderCheck)}</ul></details>
   </>}
  </Tabs.Content>
  <Tabs.Content value="logs"><section className="nd-logs" aria-label={t('安全日志')}>
   <header><h2>{t('安全日志')}</h2><p>{t('按需读取本机保留的安全事件。')}</p></header>
   <div className="nd-log-filters"><label>{t('模块')}<select value={filters.module??''} onChange={e=>filter({...filters,module:(e.target.value||null) as LogQuery['module']})}><option value="">{t('全部模块')}</option>{['diagnostics','runtime','network','accounts','device','bridge','lifecycle','export'].map(module=><option key={module} value={module}>{t(({diagnostics:'诊断',runtime:'贡献进程',network:'网络',accounts:'账号',device:'设备',bridge:'连接管理',lifecycle:'应用',export:'导出'} as Record<string,string>)[module])}</option>)}</select></label>
    <label>{t('平台')}<select value={filters.platform??''} onChange={e=>filter({...filters,platform:(e.target.value||null) as LogQuery['platform']})}><option value="">{t('全部平台')}</option><option value="openai">OpenAI</option><option value="claude">Claude</option></select></label>
    <label>{t('日志级别')}<select value={filters.level??''} onChange={e=>filter({...filters,level:(e.target.value||null) as LogQuery['level']})}><option value="">{t('全部日志')}</option><option value="info">{t('信息')}</option><option value="warning">{t('提醒')}</option><option value="error">{t('错误')}</option></select></label>
   </div>
   {logsError&&<p className="nd-error" role="alert">{logsError}</p>}
   {!logs.length?<p className="nd-empty-logs">{t(logsBusy?'正在读取日志…':logsLoaded?'所选范围没有保留的安全事件。':'点击刷新日志，查看所选范围的安全事件。')}</p>:<ul className="nd-log-list" data-testid="native-diagnostic-logs">{logs.map((entry,index)=><li key={`${entry.time}:${index}`}><time dateTime={entry.time}>{date(entry.time)}</time><span className="nd-log-level" data-level={entry.level}>{t(({info:'信息',warning:'提醒',error:'错误'} as const)[entry.level])}</span><div><strong>{entry.platform==='openai'?'OpenAI ':entry.platform==='claude'?'Claude ':''}{entry.code}</strong><details><summary>{t('安全证据')}</summary><dl>{Object.entries(entry.evidence).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details></div></li>)}</ul>}
   {truncated&&<p className="feature-note">{t('较早日志已轮转移除；此处仅显示保留范围。')}</p>}{cursor&&<div className="nd-pagination"><button disabled={logsBusy} onClick={()=>void loadLogs(true)}>{t('加载更多日志')}</button></div>}
  </section></Tabs.Content>
 </Tabs.Root>;
}
