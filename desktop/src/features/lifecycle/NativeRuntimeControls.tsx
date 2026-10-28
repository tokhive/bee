import {useState} from 'react';
import {Dialog} from 'radix-ui';
import type {RuntimeModel} from './useRuntime';
import type {AccountPlatform} from '../../system/accounts';
import {AccountErrorView} from '../accounts/NativeAccountDetails';
import {t} from '../../i18n/index';

const localCopy={stopped:'尚未开始贡献',starting:'正在核验并启动贡献',running:'贡献进程运行中',stopping:'正在停止贡献',failed:'贡献未启动或已中断'};
const connectionCopy={disconnected:'未连接 Hive',connecting:'正在连接 Hive',connected:'已连接 Hive',reconnecting:'正在重新连接 Hive',rejected:'Hive 拒绝连接',occupied:'设备连接已被占用'};
export function NativeRuntimeControls({runtime}:{runtime:RuntimeModel}){
 const {view,busy,error,uncertain}=runtime;
 const [resume,setResume]=useState<AccountPlatform[]>([]),[stopOpen,setStopOpen]=useState(false);
 const selected=(['openai','claude'] as const).filter(p=>view?.platforms[p].account.selection.state==='selected');
 const blocked=busy||uncertain||!view||!!error||runtime.stalled;
 return <section className="supply-panel native-runtime" aria-label={t('贡献运行')}>
  <div className="section-heading"><h2>{t('贡献运行')}</h2><button disabled={busy} onClick={()=>void runtime.refresh()}>{t('重新核对运行状态')}</button></div>
  <p className="account-state">{t(view?localCopy[view.local]:'正在读取 Bee…')}</p>
  <p>{t('管理进程已就绪不代表正在贡献。')}{view&&<> {t(connectionCopy[view.connection])}</>}</p>
  {uncertain&&<p role="alert">{t('操作结果未确认，请先重新核对。')}</p>}{error&&<p role="alert" className="device-error">{error}</p>}
  {view?.operation?.error&&<AccountErrorView error={view.operation.error}/>}
  <div className="supply-grid">{(['openai','claude'] as const).map(p=>{
   const state=view?.platforms[p],label=p==='openai'?'OpenAI':'Claude';
   return <div key={p}><strong>{label}</strong><p>{t(state?.account.selection.state==='selected'?'已保存账号选择':'尚未接入')}</p>
    {state?.account.authorization.error&&<AccountErrorView error={state.account.authorization.error}/>}
    <label><input type="checkbox" disabled={blocked||!selected.includes(p)||view?.local==='running'||view?.local==='starting'||view?.local==='stopping'} checked={resume.includes(p)} onChange={e=>setResume(values=>e.target.checked?[...values,p]:values.filter(v=>v!==p))}/>{t('允许 {platform} 恢复接单',{platform:label})}</label>
   </div>;
  })}</div>
  <p className="feature-note">{t('开始前重新核验已选账号；仅勾选的平台允许恢复接单，其余保持暂停。')}</p>
  <div className="account-actions"><button className="primary" disabled={blocked||selected.length===0||view?.local==='running'||view?.local==='starting'||view?.local==='stopping'} onClick={()=>void runtime.start(resume.filter(p=>selected.includes(p)))}>{t('开始贡献')}</button>
   <Dialog.Root open={stopOpen} onOpenChange={setStopOpen}><Dialog.Trigger asChild><button disabled={blocked||view?.local==='stopped'||view?.local==='stopping'}>{t('停止贡献')}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="detail-sheet"><Dialog.Title>{t('停止贡献')}</Dialog.Title><Dialog.Description>{t('停止或退出可能中断正在处理的任务，不会等待 Hive 任务完成。停止后下次打开保持停止。')}</Dialog.Description><div className="account-actions"><button disabled={blocked} onClick={()=>{setStopOpen(false);void runtime.stop();}}>{t('确认停止')}</button><Dialog.Close asChild><button>{t('取消')}</button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
  {view?.stop_receipt&&<p>{t(view.stop_receipt.workers_stopped&&view.stop_receipt.intent_saved&&view.stop_receipt.session_clean?'停止已确认，下次打开保持停止。':'本机已尝试停止，但保存或清理结果未确认。')}</p>}
 </section>;
}
