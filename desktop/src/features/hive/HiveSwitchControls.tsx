import {Dialog,Popover} from 'radix-ui';
import {useRef} from 'react';
import {Button} from '../../components/ui';
import {FailureNotice} from '../../components/ProblemNotice';
import {safeFailureText,normalizeFailure} from '../../system/failures';
import {presentFailure} from '../../presentation/problems';
import {currentLocale,t} from '../../i18n/index';
import {switchPending,type SwitchPhase} from '../../system/hiveSwitch';
import type {DeviceView} from '../../system/device';
import {DevicePairingPage} from '../device/DevicePairingPage';
import type {HiveSwitchModel} from './useHiveSwitch';
const phases:Record<SwitchPhase,string>={preparing_target:'正在准备目标 Hive',draining_source:'等待原 Hive 的任务完成',stopping_source:'正在安全停止原 Hive',connecting_target:'正在连接目标 Hive',committing_current:'正在保存当前 Hive',releasing_target:'已切换，正在确认目标 Hive 接单条件',restoring_source:'正在恢复原 Hive',succeeded:'Hive 已切换',failed:'本次切换未完成',cancelled:'切换已取消'};
export function HiveSwitchChooser({model,view}:{model:HiveSwitchModel;view?:DeviceView}){
 const {snapshot,busy}=model,trigger=useRef<HTMLButtonElement>(null);
 if(!snapshot?.profiles.current_profile)return null;
 const pending=switchPending(snapshot);
 return <Popover.Root open={model.chooserOpen} onOpenChange={model.setChooserOpen}><Popover.Trigger asChild><Button ref={trigger} variant="outline">{t('切换 Hive')}</Button></Popover.Trigger><Popover.Portal><Popover.Content className="hive-switch-popover" sideOffset={8} collisionPadding={16} aria-labelledby="hive-switch-title" onCloseAutoFocus={event=>{if(!trigger.current?.isConnected){event.preventDefault();document.querySelector<HTMLElement>('[data-nav-section=device]')?.focus();}}}>
  <div className="hive-switch-heading"><h3 id="hive-switch-title">{t('切换 Hive')}</h3><Popover.Close asChild><Button variant="ghost" aria-label={t('关闭 Hive 列表')}>{t('关闭')}</Button></Popover.Close></div>
  <p className="device-note">{t('各 Hive 保留自己的账号选择。切换成功且满足条件后，允许接单的平台可能开始接单。')}</p>
  <ul className="hive-profile-list">{snapshot.profiles.profiles.map(profile=>{const current=profile.id===snapshot.profiles.current_profile,identity=snapshot.profile_identities.find(i=>i.profile_id===profile.id);return <li key={profile.id}><div><strong>{profile.origin}</strong><small>{current&&view?.identity?t('当前归属：{owner}',{owner:view.identity.owner_email}):identity?t('上次归属：{owner}',{owner:identity.owner_email}):t('归属待核对')}</small>{profile.blockers.length>0&&<small className="hive-profile-blocker">{profile.blockers.join('；')}</small>}</div>{current?<span className="badge">{t('当前')}</span>:<Button variant="outline" disabled={busy||pending||profile.blockers.length>0} onClick={()=>void model.start(profile.origin,model.name)}>{t('切换到此 Hive')}</Button>}</li>;})}</ul>
  <form className="hive-add-form" onSubmit={event=>{event.preventDefault();if(!busy&&!pending)void model.start(model.hive.trim(),model.name.trim());}}><h4>{t('添加 Hive')}</h4><label>{t('Hive 地址')}<input type="url" name="hive" autoComplete="url" autoCapitalize="none" spellCheck={false} required value={model.hive} placeholder="https://hive.example" disabled={busy||pending} onChange={event=>model.setHive(event.target.value)}/></label><label>{t('设备名称')}<input name="device_name" autoComplete="off" required maxLength={80} value={model.name} disabled={busy||pending} onChange={event=>model.setName(event.target.value)}/></label><Button type="submit" disabled={busy||pending||!model.hive.trim()||!model.name.trim()}>{t('保存并准备切换')}</Button></form>
  {pending&&<p className="device-note">{t('已有切换正在进行。关闭此列表后仍会继续。')}</p>}{model.error&&<FailureNotice failure={model.error} check="hive_switch"/>}
 </Popover.Content></Popover.Portal></Popover.Root>;
}
export function HiveSwitchProgress({model}:{model:HiveSwitchModel}){
 const {snapshot,busy,error,target}=model,operation=snapshot?.operation;
 if(!snapshot||!operation)return error?<FailureNotice failure={error} check="hive_switch"/>:null;
 const source=snapshot.profiles.profiles.find(p=>p.id===operation.source.profile),destination=snapshot.profiles.profiles.find(p=>p.id===operation.target.profile);
 const pending=switchPending(snapshot),work=operation.source.status?.current.work;
 const unknown=!!operation.source.pending||!!operation.target.pending||!!operation.failure;
 return <div className="hive-switch-progress" aria-label={t('Hive 切换进度')}>
  <div className="device-transaction-heading"><div aria-live="polite"><p className="pairing-phase">{t(phases[operation.phase])}</p><p className="device-note">{source?.origin} → {destination?.origin}</p></div><div className="inline-actions">
   {snapshot.actions.can_continue&&<Button disabled={busy} onClick={()=>void model.continueWaiting()}>{t('继续等待')}</Button>}
   {snapshot.actions.can_observe&&snapshot.observation.state!=='observing'&&<Button variant="outline" disabled={busy} onClick={()=>void model.observe()}>{t('核对结果')}</Button>}
   {snapshot.actions.can_cancel&&<Button variant="outline" disabled={busy||operation.cancel_requested} onClick={()=>void model.cancel()}>{t(operation.cancel_requested?'正在取消切换':'取消切换')}</Button>}
  </div></div>
  {pending&&unknown&&<p role="status">{t('结果待核对；原操作已保留。')}</p>}
  {pending&&operation.phase==='draining_source'&&<p className="device-note">{work?t('正在执行 {running} · 终止结果未知 {unknown} · 未结算 {unsettled}',{running:work.executions,unknown:work.unknown_terminations,unsettled:work.unsettled}):t('任务和结算数量待核对。')}</p>}
  {pending&&snapshot.observation.state==='paused'&&<p className="device-note">{t('自动核对已暂停，切换仍保留。继续等待将核对同一操作。')}</p>}
  {pending&&snapshot.observation.state==='blocked'&&<p className="device-note">{t('自动核对已停止，请先处理下方的具体原因。')}</p>}
  {operation.committed&&<p className="device-note">{t('当前 Hive 已保存为目标地址；账号问题请在此 Hive 内处理。')}</p>}
  {(operation.failure||error)&&<p role="alert">{safeFailureText((error??operation.failure!).message)}</p>}
  <details><summary>{t('切换详情')}</summary><dl className="hive-switch-details"><div><dt>{t('原 Hive')}</dt><dd>{source?.origin}</dd></div><div><dt>{t('目标 Hive')}</dt><dd>{destination?.origin}</dd></div><div><dt>{t('操作编号')}</dt><dd>{operation.id}</dd></div><div><dt>{t('当前记录')}</dt><dd>{t(operation.committed?'已保存目标 Hive':'仍保留原 Hive')}</dd></div></dl>{snapshot.observation.reason&&<p>{snapshot.observation.reason}</p>}{(error??operation.failure)&&<pre>{presentFailure(normalizeFailure(error??operation.failure,'hive_switch'),currentLocale()).details}</pre>}</details>
  {snapshot.actions.target_pairing&&<div className="hive-target-device"><DevicePairingPage title="目标 Hive 设备" view={target.view} context={target.error?{hive:destination?.origin??'',name:model.name,device_id:null,owner_id:snapshot.profile_identities.find(p=>p.profile_id===operation.target.profile)?.owner_id??null,binding_revision:operation.target.process_binding_revision??0}:undefined} recovery={target.recovery} recoveryError={target.recoveryError} error={target.error} operationError={error} busy={busy} initialLoading={!target.view&&!target.error&&!target.recovery} begin={model.targetBegin} refresh={()=>void model.targetRefresh()} open={()=>void model.targetOpen()} recover={model.targetRecover}/></div>}
  <Dialog.Root open={model.exitOperation===operation.id} onOpenChange={()=>{}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onEscapeKeyDown={event=>event.preventDefault()}><Dialog.Title>{t('切换 Hive 尚未结束')}</Dialog.Title><Dialog.Description>{t('继续等待会保留 Bee。取消切换并退出可能中断任务；未确认的取消会保留，下次启动先核对原操作。')}</Dialog.Description><div className="dialog-actions"><Button disabled={busy} onClick={()=>void model.quit('continue_waiting')}>{t('继续等待')}</Button><Button variant="outline" disabled={busy} onClick={()=>void model.quit('cancel_and_quit')}>{t('取消切换并退出')}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
 </div>;
}
