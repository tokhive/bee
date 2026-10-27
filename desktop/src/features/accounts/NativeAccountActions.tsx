import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {accountPending,type AccountsModel} from './useAccounts';
import type {AccountPlatform} from '../../system/accounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {AccountErrorView} from './NativeAccountDetails';
import {t} from '../../i18n/index';

const actions={select:{label:'接入账号',confirm:'确认接入',description:'保存当前账号选择，核验并暂停该平台；接入成功后需明确开始贡献。'},confirm_change:{label:'确认换号',confirm:'确认更换',description:'将此平台切换到当前候选账号，换号成功后仍保持暂停。'},clear_selection:{label:'撤销选择',confirm:'确认撤销',description:'仅撤销尚未注册的本地选择；已注册账号的完整移除暂不支持。'},authorize:{label:'官方授权',confirm:'开始官方登录',description:'将调用已安装的官方客户端，可能改变官方客户端当前登录。完成后仅成为候选，不会自动接入或贡献。'}};
type Action=keyof typeof actions;
export function NativeAccountActions({accounts,platform,runtime}:{accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel}){
 const [confirm,setConfirm]=useState<Action|null>(null);
 const view=accounts.views[platform],pending=accountPending(view),busy=!!accounts.busy[platform],dirty=!!accounts.dirty[platform],unknown=!!accounts.uncertain[platform];
 const op=view?.operation;
 const transitioning=runtime.view?.local==='starting'||runtime.view?.local==='stopping';
 const candidate=!!view?.candidate.reference&&view.candidate.state==='available'&&!!view.candidate.expires_at&&Date.parse(view.candidate.expires_at)>Date.now()+30000;
 function disabled(action:Action){
  const continuation=action==='confirm_change'&&op?.state==='reconciling'&&op.error?.code==='confirmation_not_submitted';
  if(!view||busy||pending&&!continuation||unknown||transitioning||!view.features[action].available)return true;
  if(action==='authorize')return !accounts.defaults||runtime.uncertain||!!runtime.error||!runtime.view||!['stopped','failed'].includes(runtime.view.local);
  if(action==='clear_selection')return view.selection.state!=='selected';
  if(dirty||!candidate)return true;
  if(action==='confirm_change')return view.selection.state!=='selected'||view.candidate.fingerprint!==null&&view.selection.fingerprint===view.candidate.fingerprint;
  return false;
 }
 return <>
  {op&&<p role="status">{t(op.state==='reconciling'?'操作待核对，请刷新状态':op.state==='pending'||op.state==='running'?op.kind==='authorize'?'等待官方登录完成':'正在处理账号操作':op.state==='succeeded'?op.kind==='authorize'?'登录已核验，尚未接入':'账号操作已完成，平台保持暂停':op.state==='cancelled'?'操作已取消':'账号操作失败')}</p>}
  {op?.error&&<AccountErrorView error={op.error}/>}
  {unknown&&<p role="alert">{t('操作结果未确认，请先重新核对。')}</p>}
  <Dialog.Root open={confirm!==null} onOpenChange={open=>{if(!open)setConfirm(null);}}>
   <div className="account-actions">{(Object.keys(actions) as Action[]).map(action=><Dialog.Trigger asChild key={action}><button disabled={disabled(action)} onClick={()=>setConfirm(action)}>{t(actions[action].label)}</button></Dialog.Trigger>)}
    {op?.kind==='authorize'&&['pending','running'].includes(op.state)&&<button disabled={busy} onClick={()=>accounts.cancelAuthorize(platform)}>{t('取消官方登录')}</button>}
   </div>
   {confirm&&<Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="detail-sheet"><Dialog.Title>{t(actions[confirm].label)}</Dialog.Title><Dialog.Description>{t(actions[confirm].description)}</Dialog.Description>
    <div className="account-actions"><button disabled={disabled(confirm)} onClick={()=>{const action=confirm;setConfirm(null);if(action==='authorize')accounts.authorize(platform);else accounts.action(platform,action);}}>{t(actions[confirm].confirm)}</button><Dialog.Close asChild><button>{t('取消')}</button></Dialog.Close></div>
   </Dialog.Content></Dialog.Portal>}
  </Dialog.Root>
 </>;
}
