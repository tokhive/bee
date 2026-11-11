import {useEffect,useRef,useState} from 'react';
import type {DesktopSnapshot} from '../system/desktopState';
import {normalizeFailure,safeFailureText,type UiFailure} from '../system/failures';
import {presentFailure} from '../presentation/problems';
import {currentLocale,formatDate,t} from '../i18n/index';
import {downloadPayload} from '../features/diagnostics/report';
import './startup-recovery.css';
const stages={connecting:'正在连接后台…',checking_previous:'正在确认上次任务是否结束…',checking_device:'正在核对设备与账号状态…',preparing_accounts:'正在准备账号…',confirming_service:'正在确认服务是否恢复…'};
export function StartupRecoveryNotice({snapshot,onQuery,onRetry,onDiagnostics,diagnostics=false}:{snapshot:DesktopSnapshot;onQuery:()=>Promise<unknown>;onRetry:()=>Promise<unknown>;onDiagnostics:()=>void;diagnostics?:boolean}){
 const startup=snapshot.startup,native=snapshot.native;
 const pending=native.state==='starting'||native.state==='ready'&&startup?.state==='checking';
 const visible=native.state!=='ready'||startup?.state==='blocked'||startup?.state==='checking'||!startup&&!!snapshot.startupReadError;
 const stage=startup?.progress?.stage??(native.state==='starting'?'connecting':'checking_device');
 const phase=`${startup?.instance??native.metadata?.instance}:${stage}:${startup?.progress?.operation_id??''}`;
 const [elapsed,setElapsed]=useState(0),[totalElapsed,setTotalElapsed]=useState(0),[busy,setBusy]=useState(false),[localError,setLocalError]=useState<UiFailure|null>(null),[exporting,setExporting]=useState(false),[exportResult,setExportResult]=useState('');
 const [completedOperation,setCompletedOperation]=useState<string|null>(null),observedChecking=useRef(false);
 const mounted=useRef(true),working=useRef(false),heading=useRef<HTMLHeadingElement>(null),pendingSince=useRef<number|null>(null),previousProblem=useRef<UiFailure|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(startup?.state==='checking'){observedChecking.current=true;setCompletedOperation(null);}else if(startup?.state==='ready'&&observedChecking.current){observedChecking.current=false;if(startup.recovering&&startup.progress?.operation_id)setCompletedOperation(startup.progress.operation_id);}},[startup?.state,startup?.recovering,startup?.progress?.operation_id]);
 useEffect(()=>{setElapsed(0);if(!pending){pendingSince.current=null;setTotalElapsed(0);return;}const began=Date.now();pendingSince.current??=began;const timer=setInterval(()=>{setElapsed(Date.now()-began);setTotalElapsed(Date.now()-pendingSince.current!);},1000);return()=>clearInterval(timer);},[phase,pending]);
 const currentProblem=startup?.failure??(native.error?normalizeFailure(native.error,'bridge_startup'):snapshot.startupReadError??null);
 if(currentProblem)previousProblem.current=currentProblem;
 else if(!pending)previousProblem.current=null;
 const problem=currentProblem??(pending?previousProblem.current:null);
 const recoveryAvailable=native.metadata?.capabilities?.includes('runtime_inspect_recovery')===true;
 const queryUseful=recoveryAvailable&&(!problem||!['RECOVERY_SERVER_UNSUPPORTED','RECOVERY_RETIREMENT_INVALID','RECOVERY_RETIREMENT_CONFLICT'].includes(problem.code));
 const run=async(action:()=>Promise<unknown>,trigger:HTMLButtonElement)=>{if(working.current)return;working.current=true;setBusy(true);setLocalError(null);try{await action();}catch(cause){if(mounted.current)setLocalError(normalizeFailure(cause,'startup_status'));}finally{working.current=false;if(mounted.current){setBusy(false);requestAnimationFrame(()=>{if(!mounted.current)return;(trigger.isConnected?trigger:heading.current??document.querySelector<HTMLElement>('main h1'))?.focus();});}}};
 const exportEvidence=async()=>{
  if(exporting)return;setExporting(true);setExportResult('');
  try{
   const result=await downloadPayload(new Blob([JSON.stringify({product:'Bee',native_state:native.state,startup_state:startup?.state??null,instance:startup?.instance??null,revision:startup?.revision??null,observed_at:startup?.observed_at??null,progress:startup?.progress??null,failure:problem?presentFailure(problem,currentLocale()).details:null},null,2)],{type:'application/json'}),'bee-startup-diagnostics.json');
   if(mounted.current)setExportResult(result==='completed'?'启动诊断已下载。':result==='initiated'?'已发起下载，请核对下载文件夹。':'下载结果待确认，请先核对下载文件夹。');
  }catch(cause){if(mounted.current)setLocalError(normalizeFailure(cause,'startup_diagnostic_export'));}
  finally{if(mounted.current)setExporting(false);}
 };
 if(!visible&&(!diagnostics||!problem))return completedOperation&&snapshot.runtime?.operation?.id===completedOperation&&snapshot.runtime.operation.state==='succeeded'?<p className="startup-recovery-result" role="status">{t(snapshot.runtime.local==='running'&&snapshot.runtime.connection==='connected'?'服务已恢复，接单选择保持不变。':'后台已连接，服务未启动。')}</p>:null;
 const waiting=pending&&(snapshot.startupObservation==='stopped'||totalElapsed>=60000);
 const title=pending?(waiting?'状态待核对':startup?.recovering?'正在恢复 Bee…':'正在启动 Bee…'):native.state==='stopped'?'Bee 后台已停止':native.state==='failed'?'Bee 后台连接失败':startup?.state==='blocked'?'暂时无法恢复 Bee':snapshot.startupReadError?'状态待核对':'启动诊断';
 const progress=startup?.progress;
 const subtitle=pending&&!waiting?(progress?.stage==='preparing_accounts'&&progress.total!==null&&progress.total!==undefined?t('正在准备账号（{completed}/{total}）…',{completed:progress.completed??0,total:progress.total}):t(stages[stage])):problem?presentFailure(problem,currentLocale()).summary:t('当前后台状态尚未确认，可查看诊断。');
 return <section className="startup-recovery-notice" data-testid="startup-recovery" role={!pending&&problem?'alert':undefined} aria-busy={pending&&!waiting}>
  <div className="startup-recovery-main"><div aria-live="polite"><h2 ref={heading} tabIndex={-1}>{t(title)}</h2><p>{subtitle}</p></div>
   {(!pending||waiting)&&<div className="inline-actions">
    {!pending&&(native.state==='failed'||native.state==='stopped'||recoveryAvailable&&startup?.can_retry)?<button disabled={busy} onClick={event=>void run(onRetry,event.currentTarget)}>{t(native.state==='ready'?(problem?.code==='RECOVERY_REMOTE_DRAINING'||problem?.code==='RECOVERY_RETIREMENT_UNCONFIRMED'?'继续恢复':'重试恢复'):'重新连接')}</button>:queryUseful&&<button disabled={busy} onClick={event=>void run(onQuery,event.currentTarget)}>{t('核对结果')}</button>}
    {!diagnostics&&<button className="quiet" onClick={onDiagnostics}>{t('查看诊断')}</button>}
   </div>}
  </div>
  {pending&&(waiting||elapsed>=10000)&&<small>{t(waiting?'自动核对已暂停；后台操作可能仍在进行，可手动核对结果。':'等待时间较长，可查看诊断。')}{!diagnostics&&!waiting&&<button className="quiet" onClick={onDiagnostics}>{t('查看诊断')}</button>}</small>}
  {waiting&&startup?.observed_at&&<small>{t('上次确认：{time}',{time:formatDate(startup.observed_at,currentLocale(),{dateStyle:"short",timeStyle:"medium"})})}</small>}
  {problem&&<details><summary>{t('错误详情')}</summary><pre>{presentFailure(problem,currentLocale()).details}</pre></details>}
  {snapshot.startupReadError&&snapshot.startupReadError!==currentProblem&&<p role="alert">{safeFailureText(snapshot.startupReadError.message)}</p>}
  {localError&&<p role="alert">{safeFailureText(localError.message)}</p>}
  {diagnostics&&<><p className="startup-diagnostic-hint">{t('此记录由 App 保留；后台不可用时不会执行实时检查。')}</p><button disabled={exporting} onClick={()=>void exportEvidence()}>{t('导出启动诊断')}</button>{exportResult&&<p role="status">{t(exportResult)}</p>}</>}
 </section>;
}
