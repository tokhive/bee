import {FailureNotice} from '../../components/ProblemNotice';
import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {CirclePause, Play, Square, Radio, Check, Pause} from 'lucide-react';
import type {RuntimeModel} from './useRuntime';
import {Button} from '../../components/ui';
import {t} from '../../i18n/index';

const localCopy={stopped:'贡献尚未启动',starting:'正在启动贡献',running:'贡献已启动',stopping:'正在停止贡献',failed:'贡献未启动或已中断'};
const connectionCopy={disconnected:'Hive 未连接',connecting:'正在连接 Hive',connected:'Hive 已连接',reconnecting:'正在重新连接 Hive',rejected:'Hive 拒绝连接',occupied:'设备连接已被占用'};
export function NativeRuntimeControls({runtime,deviceReady=true}:{runtime:RuntimeModel;deviceReady?:boolean}){
 const {view,busy,error,uncertain}=runtime;
 const [stopOpen,setStopOpen]=useState(false);
 const selected=(['openai','claude'] as const).some(p=>view?.platforms[p].account.selection.state==='selected');
 const running=view?.local==='running';
 const stopping=view?.local==='stopping',starting=view?.local==='starting';
 const blocked=busy||uncertain||!view||!!error||runtime.stalled;
 const confirmed=!!view&&!error&&!uncertain&&!runtime.stalled;
 return <section className="native-runtime-summary" aria-label={t('贡献运行')}>
  <div className="native-runtime-row">
   <div className="native-runtime-title"><span className={`run-mark ${confirmed&&running?'active':''}`}>{confirmed&&running?<Radio aria-hidden="true"/>:<CirclePause aria-hidden="true"/>}</span><div>
    <h2>{t(confirmed?localCopy[view.local]:'贡献状态待确认')}</h2>
    <p>{t(running?'按平台管理接单；暂停后不再接收新任务。':'开始后建立连接；接单需单独恢复。')}</p>
   </div></div>
   {running||stopping?<Dialog.Root open={stopOpen} onOpenChange={setStopOpen}><Dialog.Trigger asChild><Button disabled={blocked||stopping}><Square aria-hidden="true"/>{t(stopping?'正在停止贡献':'停止贡献')}</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{t('停止贡献')}</Dialog.Title><Dialog.Description>{t('停止或退出可能中断正在处理的任务，不会等待 Hive 任务完成。停止后下次打开保持停止。')}</Dialog.Description><div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={blocked} onClick={()=>{setStopOpen(false);void runtime.stop();}}>{t('确认停止')}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    :<Button disabled={blocked||!selected||!deviceReady||starting} onClick={()=>void runtime.start([])}><Play aria-hidden="true"/>{t(starting?'正在启动贡献':'开始贡献')}</Button>}
  </div>
  <div className="health native-runtime-health"><span>{confirmed&&running?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(confirmed?running?'Bee 运行中':'Bee 未运行':'Bee 状态待确认')}</span><span>{confirmed&&view.connection==='connected'?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(confirmed?connectionCopy[view.connection]:'Hive 状态待确认')}</span></div>
  {(uncertain||error||runtime.stalled)&&<p role="status" className="runtime-note">{t('贡献状态待确认，正在自动核对…')}</p>}
  {error&&<FailureNotice failure={error} check="runtime_operation"/>}
  {confirmed&&view.operation?.error&&<FailureNotice failure={view.operation.error} check="runtime_operation"/>}
  {view?.stop_receipt&&<p className="runtime-note">{t(view.stop_receipt.workers_stopped&&view.stop_receipt.intent_saved&&view.stop_receipt.session_clean?'停止已确认，下次打开保持停止。':'本机已尝试停止，但保存或清理结果未确认。')}</p>}
 </section>;
}
