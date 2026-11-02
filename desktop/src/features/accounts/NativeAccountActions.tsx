import {requestNotSent} from '../../system/failures';
import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationTarget} from '../../app/navigation';
import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {type AccountsModel} from './useAccounts';
import type {AccountPlatform} from '../../system/accounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {Button} from '../../components/ui';
import {t,currentLocale,formatDate} from '../../i18n/index';
import {accountActionBlock,sameAccountFailure,type AccountAction} from './accountPresentation';
import type {UiFailure} from '../../system/failures';

const actions={select:{label:'接入',confirm:'确认接入',description:'将目标账号接入当前设备，并核验 Hive 注册；此 Hive 账号的平台接单将保持暂停，不会开始贡献。'},confirm_change:{label:'换号',confirm:'确认更换',description:'将此平台切换到目标账号，核对 Hive 注册与已有请求收尾；完成后仍保持暂停，不会开始贡献。'},clear_selection:{label:'取消接入',confirm:'确认取消接入',description:'仅取消尚未在 Hive 注册的本地选择；不会移除已注册的 Hive 账号。'},authorize:{label:'重新登录',confirm:'开始官方登录',description:'将调用已安装的 {client} 官方客户端，可能改变该客户端当前登录。完成后仅成为候选，不会自动接入、开始贡献或恢复接单。'}};
export function AccountOperationStatus({accounts,platform,onNavigate,sourceFailure}:{accounts:AccountsModel;platform:AccountPlatform;onNavigate?:(target:NavigationTarget)=>void;sourceFailure?:UiFailure}){
 const op=accounts.views[platform]?.operation;
 const error=accounts.errors[platform],submissionChanged=error?.code==='ACCOUNT_CONTEXT_CHANGED';
 const showError=error&&!sameAccountFailure(error,accounts.sharedFailure)&&!sameAccountFailure(error,sourceFailure);
 const refresh=accounts.accountRefresh?.[platform];
 const unconfirmed=accounts.uncertain[platform]||op?.state==='reconciling';
 const progress=refresh?.state==='reading'?'重试中…':refresh?.state==='scheduled'&&refresh.nextRetryAt?'等待自动重试…':refresh?.state==='blocked'?'核对已暂停，需先处理当前问题。':'账号状态待核对。';
 const terminal=op?.state==='succeeded'?op.kind==='authorize'?'登录已核验，尚未接入':op.kind==='clear_selection'?'已取消未注册的本地选择；Hive 注册账号未被移除。':op.kind==='confirm_change'?'换号已完成，该平台保持暂停。':'接入已完成，该平台保持暂停。':op?.state==='cancelled'?'官方登录进程已取消；已发生的客户端登录变化可能保留，需重新核对来源。':'账号操作失败';
 return <div className="account-operation-status">
  {unconfirmed&&!submissionChanged&&<p role="status">{t('账号操作结果尚未确认；只核对原操作，不会重复提交或解除暂停。')}</p>}
  {(unconfirmed||error&&!requestNotSent(error))&&!submissionChanged?<p><span>{t(progress)}</span>{refresh?.state==='scheduled'&&refresh.nextRetryAt&&<> <time dateTime={refresh.nextRetryAt}>{formatDate(refresh.nextRetryAt,currentLocale())}</time></>}</p>:op&&<p role="status">{t(op.state==='pending'||op.state==='running'?op.kind==='authorize'?'等待官方登录完成；关闭详情不会取消登录。':'正在处理账号操作':terminal)}</p>}
  {op?.error&&<FailureNotice failure={op.error} check="account_operation" onNavigate={onNavigate}/>}
  {showError&&<FailureNotice failure={error} check="account_operation" onNavigate={onNavigate}/>}
  {error&&!requestNotSent(error)&&op?.kind==='authorize'&&['pending','running'].includes(op.state)&&<p>{t('取消请求结果未确认；仍在核对同一官方登录进程。')}</p>}
 </div>;
}
export function NativeAccountActions({accounts,platform,runtime,placement='row',onNavigate}:{accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel;placement?:'row'|'detail';onNavigate?:(target:NavigationTarget)=>void}){
 const view=accounts.views[platform],selected=view?.selection.state==='selected',op=view?.operation,label=platform==='openai'?'OpenAI':'Claude',client=platform==='openai'?'Codex':'Claude Code';
 const busy=!!accounts.writeBusy[platform],dirty=!!accounts.dirty[platform];
 const unknown=!!accounts.uncertain[platform]||!!accounts.errors[platform]&&accounts.errors[platform]?.code!=='ACCOUNT_CONTEXT_CHANGED'&&!requestNotSent(accounts.errors[platform]!);
 const context={view,platform,now:Date.now(),dirty,busy,unknown,submissionBlocked:accounts.submissionBlocked,defaultsReady:!!accounts.defaults,runtime:runtime.view,runtimeBlocked:runtime.uncertain||!!runtime.error||runtime.stalled};
 const block=(action:AccountAction)=>accountActionBlock(action,context);
 const candidate=!dirty&&view?.candidate.state==='available'&&!!view.candidate.reference;
 const offered:AccountAction[]=placement==='row'?(selected?[]:[candidate?'select':'authorize']):[
  ...(!selected&&candidate?['select' as const]:[]),
  ...(selected&&candidate&&view?.candidate.fingerprint!==view?.selection.fingerprint?['confirm_change' as const]:[]),
  'authorize',
  ...(selected&&view?.features.clear_selection.available&&view.hive.fingerprint===null&&view.hive.generation===null?['clear_selection' as const]:[]),
 ];
 const actionLabel=(action:AccountAction)=>action==='authorize'&&!selected?t('登录 {platform}',{platform:label}):t(actions[action].label);
 const stamp=()=>JSON.stringify([view?.revision,view?.candidate.reference,view?.selection.fingerprint,view?.features,accounts.sources[platform],dirty,runtime.view?.local,runtime.view?.run_id]);
 const [confirm,setConfirm]=useState<{action:AccountAction;stamp:string;current:string|null;target:string|null}|null>(null);
 const changed=!!confirm&&confirm.stamp!==stamp();
 const blocks=offered.map(action=>block(action)).filter(b=>!!b);
 const unique=[...new Map(blocks.map(b=>[b.message,b])).values()];
 const targetLabel=(target:NavigationTarget)=>target.page==='overview'&&target.section==='runtime'?'查看贡献运行':target.page==='overview'?'查看设备':target.section==='source'?'检查凭证来源':'查看账号详情';
 return <Dialog.Root open={confirm!==null} onOpenChange={open=>{if(!open)setConfirm(null);}}>
  <div className="account-actions">{offered.map(action=><Dialog.Trigger asChild key={action}><Button variant={placement==='row'?'default':'outline'} disabled={!!block(action)} onClick={()=>setConfirm({action,stamp:stamp(),current:view?.selection.fingerprint??null,target:view?.candidate.fingerprint??null})}>{actionLabel(action)}</Button></Dialog.Trigger>)}
   {op?.kind==='authorize'&&['pending','running'].includes(op.state)&&<Button variant="outline" disabled={busy} onClick={()=>accounts.cancelAuthorize(platform)}>{t('取消官方登录')}</Button>}
  </div>
  {unique.length>0&&<div className="account-action-help">{unique.map(b=><div key={b.message}><p>{t(b.message)}</p>{b.reason&&<details><summary>{t('查看操作限制')}</summary><code>{b.reason}</code></details>}{b.target&&onNavigate&&<Button variant="ghost" onClick={()=>onNavigate(b.target!)}>{t(targetLabel(b.target))}</Button>}</div>)}</div>}
  {confirm&&<Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{actionLabel(confirm.action)}</Dialog.Title><Dialog.Description>{t(actions[confirm.action].description,{client})}</Dialog.Description>
   {['select','confirm_change'].includes(confirm.action)&&<dl className="account-detail-facts">{confirm.action==='confirm_change'&&<div><dt>{t('当前账号')}</dt><dd>{confirm.current?.slice(0,16)??t('未知')}</dd></div>}<div><dt>{t('目标账号')}</dt><dd>{confirm.target?.slice(0,16)??t('账号标识待官方核验')}</dd></div><div><dt>{t('平台')}</dt><dd>{label}</dd></div></dl>}
   {changed?<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>:block(confirm.action)&&<p role="alert">{t(block(confirm.action)!.message)}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={!!block(confirm.action)||changed} onClick={()=>{const action=confirm.action;setConfirm(null);if(action==='authorize')accounts.authorize(platform);else accounts.action(platform,action);}}>{t(actions[confirm.action].confirm)}</Button></div>
  </Dialog.Content></Dialog.Portal>}
 </Dialog.Root>;
}
