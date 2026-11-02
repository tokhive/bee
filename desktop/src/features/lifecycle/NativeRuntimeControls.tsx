import type {DesktopPresentation} from '../../presentation/desktopStatus';
import type {NavigationTarget} from '../../app/navigation';
import {normalizeFailure,requestNotSent} from '../../system/failures';
import {FailureNotice} from '../../components/ProblemNotice';
import {useId,useState} from 'react';
import {Dialog} from 'radix-ui';
import {CirclePause, Play, Square, Radio, Check, Pause} from 'lucide-react';
import type {RuntimeModel} from './useRuntime';
import {Button} from '../../components/ui';
import {t,formatDate,currentLocale} from '../../i18n/index';

const connectionCopy={disconnected:'Hive 未连接',connecting:'正在连接 Hive',connected:'Hive 已连接',reconnecting:'正在重新连接 Hive',rejected:'Hive 拒绝连接',occupied:'设备连接已被占用'};
export function NativeRuntimeControls({runtime,deviceReady=true,presentation,onNavigate}:{runtime:RuntimeModel;deviceReady?:boolean;presentation:DesktopPresentation;onNavigate?:(target:NavigationTarget)=>void}){
 const {view,busy,error,uncertain}=runtime;const disabledId=useId();
 const [stopOpen,setStopOpen]=useState(false);
 const selected=(['openai','claude'] as const).some(p=>view?.platforms[p].account.selection.state==='selected');
 const running=view?.local==='running';
 const stopping=view?.local==='stopping',starting=view?.local==='starting';
 const blocked=busy||uncertain||!view||!!error||runtime.stalled;
 const disabledReason=busy?'正在提交操作，请稍候。':uncertain||runtime.stalled||!view||error?'请先核对本机贡献状态。':!running&&(runtime.startBlocked||!deviceReady)?'请先完成设备核对与绑定。':!running&&!selected?'请先接入至少一个 AI 账号。':starting||stopping?'请等待当前贡献操作完成。':null;
 const detail=view?.connection_detail;
 const connectionFailure=detail?.failure?normalizeFailure({...detail.failure,check:detail.failure.stage,observedAt:detail.failure.occurred_at},'connection'):null;
 const confirmed=!!view&&!error&&!uncertain&&!runtime.stalled;
 return <section className="native-runtime-summary" aria-label={t('贡献运行')}>
  <div className="native-runtime-row">
   <div className="native-runtime-title"><span className={`run-mark ${presentation.severity==='success'?'active':''}`}>{confirmed&&running?<Radio aria-hidden="true"/>:<CirclePause aria-hidden="true"/>}</span><div>
    <h2>{t(`desktop.status.${presentation.kind}`)}</h2>
    <p>{t(running?'按平台管理接单；暂停后不再接收新任务。':'开始后建立连接；接单需单独恢复。')}</p>
   </div></div>
   {running||stopping?<Dialog.Root open={stopOpen} onOpenChange={setStopOpen}><Dialog.Trigger asChild><Button aria-describedby={disabledReason?disabledId:undefined} disabled={blocked||stopping}><Square aria-hidden="true"/>{t(stopping?'正在停止贡献':'停止贡献')}</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{t('停止贡献')}</Dialog.Title><Dialog.Description>{t('停止或退出可能中断正在处理的任务，不会等待 Hive 任务完成。停止后下次打开保持停止。')}</Dialog.Description><div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={blocked} onClick={()=>{setStopOpen(false);void runtime.stop();}}>{t('确认停止')}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    :<Button aria-describedby={disabledReason?disabledId:undefined} disabled={blocked||runtime.startBlocked||!selected||!deviceReady||starting} onClick={()=>void runtime.start([])}><Play aria-hidden="true"/>{t(starting?'正在启动贡献':'开始贡献')}</Button>}
  </div>
  {disabledReason&&<p id={disabledId} className="runtime-note runtime-disabled-reason">{t(disabledReason)}</p>}
  {presentation.kind==='ready'&&<p className="runtime-note">{t('可接单平台：')}{presentation.readyPlatforms.map(p=>p==='openai'?'OpenAI':'Claude').join('、')}{presentation.blockedPlatforms.length>0&&t('；其他平台仍需处理。')}</p>}
  <div className="health native-runtime-health"><span>{confirmed&&running?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(confirmed?running?'Bee 运行中':'Bee 未运行':'Bee 状态待确认')}</span><span>{confirmed&&view.connection==='connected'?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(confirmed?view.local==='stopped'?'尚未建立 Hive 连接':connectionCopy[view.connection]:'Hive 状态待确认')}</span></div>
  {confirmed&&running&&detail&&<div className="native-connection-detail">{connectionFailure&&<FailureNotice failure={connectionFailure} check="connection" onNavigate={onNavigate}/>}<p className="runtime-note">{t(detail.retry==='scheduled'?'已安排重新连接：':detail.retry==='attempting'?'正在尝试重新连接。':detail.retry==='halted'?'自动重连已停止，请先处理当前问题。':'当前没有安排自动重连。')}{detail.retry==='scheduled'&&detail.next_retry_at&&formatDate(detail.next_retry_at,currentLocale())}</p><Button variant="outline" onClick={()=>onNavigate?.({page:'diagnostics',section:'connection'})}>{t('检查 Hive 连接')}</Button></div>}
  {(uncertain||error&&!requestNotSent(error)||runtime.stalled)&&<p role="status" className="runtime-note">{t(runtime.refreshStatus?.state==='blocked'?'贡献状态待确认，核对已暂停。':runtime.refreshStatus?.state==='scheduled'?'贡献状态待确认，等待已安排的核对。':runtime.refreshStatus?.state==='reading'||runtime.refreshing?'贡献状态待确认，正在核对…':'贡献状态待确认。')}</p>}
  {error&&<FailureNotice failure={error} check="runtime_operation"/>}
  {confirmed&&view.operation?.error&&<FailureNotice failure={view.operation.error} check="runtime_operation"/>}
  {view?.stop_receipt&&<p className="runtime-note">{t(view.stop_receipt.workers_stopped&&view.stop_receipt.intent_saved&&view.stop_receipt.session_clean?'停止已确认，下次打开保持停止。':'本机已尝试停止，但保存或清理结果未确认。')}</p>}
 </section>;
}
