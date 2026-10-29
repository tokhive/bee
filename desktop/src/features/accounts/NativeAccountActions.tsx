import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {accountPending,type AccountsModel} from './useAccounts';
import type {AccountPlatform} from '../../system/accounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {Button} from '../../components/ui';
import {t} from '../../i18n/index';

const actions={select:{label:'接入',confirm:'确认接入',description:'保存当前账号选择，核验并暂停该平台；接入成功后需明确开始贡献。'},confirm_change:{label:'换号',confirm:'确认更换',description:'将此平台切换到当前候选账号，换号成功后仍保持暂停。'},clear_selection:{label:'取消接入',confirm:'确认取消接入',description:'仅取消尚未注册的本地选择。'},authorize:{label:'重新登录',confirm:'开始官方登录',description:'将调用已安装的官方客户端，可能改变官方客户端当前登录。完成后仅成为候选，不会自动接入或贡献。'}};
type Action=keyof typeof actions;
export function AccountOperationStatus({accounts,platform}:{accounts:AccountsModel;platform:AccountPlatform}){
 const op=accounts.views[platform]?.operation;
 const unconfirmed=accounts.uncertain[platform]||!!accounts.errors[platform]||op?.state==='reconciling';
 return <div className="account-operation-status">
  {unconfirmed?<p role="status">{t(accounts.busy[platform]?'重试中…':'等待自动重试…')}</p>:op&&<p role="status">{t(op.state==='pending'||op.state==='running'?op.kind==='authorize'?'等待官方登录完成':'正在处理账号操作':op.state==='succeeded'?op.kind==='authorize'?'登录已核验，尚未接入':'账号操作已完成，平台保持暂停':op.state==='cancelled'?'操作已取消':'账号操作失败')}</p>}
  {op?.error&&<p role="alert">{op.error.message}</p>}
 </div>;
}
export function NativeAccountActions({accounts,platform,runtime,placement='row'}:{accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel;placement?:'row'|'detail'}){
 const [confirm,setConfirm]=useState<{action:Action;candidate:string|null}|null>(null);
 const view=accounts.views[platform],pending=accountPending(view),busy=!!accounts.writeBusy[platform],dirty=!!accounts.dirty[platform],unknown=!!accounts.uncertain[platform]||!!accounts.errors[platform];
 const selected=view?.selection.state==='selected',op=view?.operation,label=platform==='openai'?'OpenAI':'Claude';
 const transitioning=runtime.view?.local==='starting'||runtime.view?.local==='stopping';
 const candidate=!dirty&&!!view?.candidate.reference&&view.candidate.state==='available'&&!!view.candidate.expires_at&&Date.parse(view.candidate.expires_at)>Date.now()+30000;
 function disabled(action:Action){
  const continuation=action==='confirm_change'&&op?.state==='reconciling'&&op.error?.code==='confirmation_not_submitted';
  if(!view||busy||pending&&!continuation||unknown||transitioning||!view.features[action].available)return true;
  if(action==='authorize')return !accounts.defaults||runtime.uncertain||!!runtime.error||runtime.stalled||!runtime.view||!['stopped','failed'].includes(runtime.view.local);
  if(action==='clear_selection')return !selected;
  if(!candidate)return true;
  if(action==='confirm_change')return !selected||view.candidate.fingerprint!==null&&view.selection.fingerprint===view.candidate.fingerprint;
  return selected;
 }
 const offered:Action[]=placement==='row'?(selected?[]:[candidate?'select':'authorize']):[
  ...(selected&&candidate&&view?.candidate.fingerprint!==view?.selection.fingerprint?['confirm_change' as const]:[]),
  'authorize',
  ...(selected&&view?.features.clear_selection.available&&view.hive.fingerprint===null&&view.hive.generation===null?['clear_selection' as const]:[]),
 ];
 const actionLabel=(action:Action)=>action==='authorize'&&!selected?t('登录 {platform}',{platform:label}):t(actions[action].label);
 const changed=!!confirm&&['select','confirm_change'].includes(confirm.action)&&confirm.candidate!==view?.candidate.reference;
 return <Dialog.Root open={confirm!==null} onOpenChange={open=>{if(!open)setConfirm(null);}}>
  <div className="account-actions">{offered.map(action=><Dialog.Trigger asChild key={action}><Button variant={placement==='row'?'default':'outline'} disabled={disabled(action)} onClick={()=>setConfirm({action,candidate:view?.candidate.reference??null})}>{actionLabel(action)}</Button></Dialog.Trigger>)}
   {op?.kind==='authorize'&&['pending','running'].includes(op.state)&&<Button variant="outline" disabled={busy} onClick={()=>accounts.cancelAuthorize(platform)}>{t('取消官方登录')}</Button>}
  </div>
  {confirm&&<Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{actionLabel(confirm.action)}</Dialog.Title><Dialog.Description>{t(actions[confirm.action].description)}</Dialog.Description>
   {confirm.action==='confirm_change'&&<dl className="account-detail-facts"><div><dt>{t('当前账号')}</dt><dd>{view?.selection.fingerprint?.slice(0,16)??t('未知')}</dd></div><div><dt>{t('要换成')}</dt><dd>{view?.candidate.fingerprint?.slice(0,16)??t('未知')}</dd></div></dl>}
   {changed&&<p role="alert">{t('候选账号已变化，请关闭后重新确认。')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={disabled(confirm.action)||changed} onClick={()=>{const action=confirm.action;setConfirm(null);if(action==='authorize')accounts.authorize(platform);else accounts.action(platform,action);}}>{t(actions[confirm.action].confirm)}</Button></div>
  </Dialog.Content></Dialog.Portal>}
 </Dialog.Root>;
}
