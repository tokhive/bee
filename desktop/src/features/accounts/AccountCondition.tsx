import {AccountErrorPopover} from './AccountErrorPopover';
import {useState} from 'react';
import {AlertCircle,Check,Pause} from 'lucide-react';
import type {AccountPlatform} from '../../system/accounts';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import {presentFailure} from '../../presentation/problems';
import {Button} from '../../components/ui';
import {currentLocale,formatDate,t} from '../../i18n/index';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {supplyFresh,type SharedSupply} from '../supply/useSupply';
import {sameAccountFailure,supplyProblem} from './accountPresentation';

/** One current conclusion; independent conditions remain available in the disclosure. */
export function AccountCondition({accounts,platform,runtime,supply,onNavigate,now=Date.now(),inlineFailure,deviceBlock,compact=false,workflow=false}:{workflow?:boolean;compact?:boolean;deviceBlock?:string;accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel;supply?:SharedSupply;onNavigate?:(target:NavigationTarget)=>void;now?:number;inlineFailure?:Parameters<typeof sameAccountFailure>[0]}){
 const [expanded,setExpanded]=useState(false);
 const account=accounts.views[platform],selected=account?.selection.state==='selected';
 const op=account?.operation,dirty=accounts.dirty[platform];
 const view=supply?.state.views[platform];
 const writing=supply?.state.operation==='write'&&supply.state.activePlatform===platform;
 const uncertain=accounts.uncertain[platform]||op?.state==='reconciling';
 const current=!!supply&&!supply.blocked&&!accounts.readFailures[platform]&&supplyFresh(supply.state,platform,now)&&!runtime.error&&!runtime.uncertain;
 const errors:UiFailure[]=[];
 const candidates=[runtime.view?.local==='failed'?runtime.view.operation?.error:null,accounts.errors[platform],accounts.sourceReadFailed[platform],supply?.state.errors[platform],op?.error,...(!dirty?[account?.candidate.error,account?.authorization.error,account?.hive.error,...account?.capabilities.map(c=>c.error)??[],...account?.issues??[]]:[])];
 for(const value of candidates){
  if(!value)continue;
  const error=normalizeFailure(value,'account_condition');
  if(deviceBlock&&sameAccountFailure(error,accounts.deviceFailure))continue;
  if(!errors.some(previous=>sameAccountFailure(previous,error)))errors.push(error);
 }
 const visibleErrors=errors.filter(error=>!sameAccountFailure(error,inlineFailure));
 const sourceError=errors.some(e=>e.evidence.permission_denied==='true'||['source_missing','source_unavailable','permission_denied'].includes(e.code));
 const reasons=selected&&current?[...new Set(view?.reasons??[])].filter(r=>r!=='manually_paused'&&!(r==='offline'&&runtime.view?.local==='failed')&&!(sourceError&&r===`${platform==='openai'?'codex':'claude'}_source_unavailable`)):[];
 const changed=!dirty&&selected&&account?.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint;
 const expired=!dirty&&account?.candidate.expires_at&&Date.parse(account.candidate.expires_at)<=now+(compact?0:30000);
 const pending=accountPending(account);
 const stale=selected&&!current;
 const deviceWait=selected&&deviceBlock&&!uncertain&&!pending;
 const blocked=errors.length>0||reasons.length>0||changed||expired;
 const ready=!deviceWait&&selected&&current&&runtime.view?.local==='running'&&view?.ready&&!view.paused&&!blocked&&!dirty&&!uncertain&&!pending;
 let title:string;
 if(pending&&op?.state!=='reconciling')title=op?.kind==='authorize'?'等待官方登录':'正在处理账号操作';
 else if(uncertain)title='操作结果待确认';
 else if(deviceWait)title=deviceBlock!;
 else if(writing)title='正在更新接单选择…';
 else if(account?.authorization.state==='preparing')title='正在准备账号…';
 else if(runtime.view?.local==='starting')title='正在准备服务…';
 else if(runtime.view?.local==='failed')title='服务准备失败';
 else if(dirty||!selected&&accounts.busy[platform]&&account?.candidate.state==='not_checked')title='正在读取已有登录…';
 else if(stale)title='状态待更新';
 else if(changed)title='发现不同账号';
 else if(!selected&&errors.length&&errors.every(e=>e.code==='source_missing'))title='尚未登录';
 else if(blocked)title=selected?'不能接单':'登录需要处理';
 else if(!selected)title=account?.candidate.state==='available'?'已有登录，尚未接入':'尚未接入';
 else if(ready)title='可接单';
 else title=view?.paused?'已暂停接单':'不能接单';
 const showPaused=!deviceWait&&selected&&view?.paused&&title!=='已暂停接单';
 const primary=compact&&!pending&&!uncertain&&!deviceWait&&!writing&&!dirty?visibleErrors[0]:undefined;
 const specific=primary?presentFailure(primary,currentLocale()):undefined;
 if(specific&&primary&&(primary.check==='read_keychain'||primary.check==='read_keyring'||primary.check==='source_read'&&['keychain','keyring'].includes(accounts.sourceFor(platform).store))&&(primary.code==='permission_denied'||primary.evidence.permission_denied==='true')){specific.summary=t('无法读取系统钥匙串凭证');specific.impact=t('系统拒绝访问所选配置目录对应的钥匙串凭证，请检查钥匙串访问权限；原账号选择仍保留。');}
 if(specific)title=specific.summary;
 else if(compact&&!pending&&!uncertain&&!deviceWait&&!dirty&&!changed&&expired)title='授权已过期';
 else if(compact&&title==='不能接单'&&reasons.length===1&&reasons[0]==='quota_exhausted')title='额度已耗尽';
 else if(compact&&title==='已暂停接单')title='已暂停';
 const remainingErrors=primary?visibleErrors.slice(1):visibleErrors;
 const count=remainingErrors.length+reasons.length+(!compact&&showPaused?1:0)+(changed&&!reasons.some(r=>r.endsWith('_confirmation_required'))?1:0)+(!compact&&expired?1:0)+(stale&&!errors.length&&!deviceWait?1:0);
 const navigate=(target:NavigationTarget)=>onNavigate?.({...target,...(target.page==='accounts'&&!target.platform?{platform}:{})});
 if(workflow)return visibleErrors.length||reasons.length?<div className="account-flow-evidence">
  {visibleErrors.map((error,index)=>{const p=presentFailure(error,currentLocale());return <div key={index}><p>{p.summary}<AccountErrorPopover errors={[error]}/></p>{p.action&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.action!)}>{p.actionLabel??t('查看账号详情')}</Button>}</div>;})}
  {reasons.map(reason=>{const p=supplyProblem(reason,platform);return <div key={reason}><p>{t(p.summary,{platform:platform==='openai'?'OpenAI':'Claude'})}</p>{p.target&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.target!)}>{t('查看相关设置')}</Button>}</div>;})}
 </div>:null;
 return <div className="account-status-block">
  <p className={`native-account-condition ${ready?'is-ready':blocked?'is-blocked':''}`} role="status">{!compact&&(ready?<Check aria-hidden="true"/>:title==='已暂停接单'?<Pause aria-hidden="true"/>:<AlertCircle aria-hidden="true"/>)}<span>{t(title)}</span>{primary&&<AccountErrorPopover errors={[primary]}/>}</p>
  {compact&&(specific?.impact||expired&&!changed||showPaused&&title!=='已暂停')&&<p className="account-action-help">{specific?.impact??(expired?t('需要通过官方客户端重新授权。'):'')}{showPaused&&title!=='已暂停'&&<> {t('接单保持暂停。')}</>}</p>}
  {deviceWait&&(view??runtime.view?.platforms[platform].supply)&&<p className="account-action-help">{t((view??runtime.view?.platforms[platform].supply)?.paused?'接单选择：暂停':'接单选择：允许')}</p>}
  {count>0&&<details className="account-conditions" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
   <summary>{t('查看原因（{count}）',{count})}</summary>
   <ul>
    {remainingErrors.map((error,index)=>{const p=presentFailure(error,currentLocale());return <li key={index}><p>{p.summary}</p>{p.impact&&p.impact!==p.summary&&<p className="muted">{p.impact}</p>}<details className="account-condition-evidence"><summary>{t('查看失败详情')}</summary><pre>{p.details}</pre></details>{p.action&&p.action.section!=='source'&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.action!)}>{p.actionLabel??t('查看账号详情')}</Button>}</li>;})}
    {reasons.map(reason=>{
     const p=supplyProblem(reason,platform);
     if(reason==='offline'){
      const detail=runtime.view?.connection_detail;
      const failure=detail?.failure?presentFailure(normalizeFailure({...detail.failure,check:detail.failure.stage,observedAt:detail.failure.occurred_at},'connection'),currentLocale()):null;
      return <li key={reason}>
       <p>{failure?.summary??t(p.summary)}</p>
       <p className="muted">{t(detail?.retry==='attempting'?'正在尝试连接 Hive。':detail?.retry==='scheduled'?'已安排重新连接：':detail?.retry==='halted'?'自动重连已停止，请先处理当前问题。':'Hive 尚未确认此平台在线，请重新核对连接。')}{detail?.retry==='scheduled'&&detail.next_retry_at&&formatDate(detail.next_retry_at,currentLocale())}</p>
       {failure&&<details className="account-condition-evidence"><summary>{t('查看失败详情')}</summary><pre>{failure.details}</pre></details>}
       <Button variant="ghost" disabled={runtime.busy||runtime.refreshing||supply?.state.busy} onClick={()=>{void runtime.refresh();void supply?.model.read();}}>{t('重新核对连接')}</Button>
       {detail?.retry==='halted'&&onNavigate&&<Button variant="ghost" onClick={()=>navigate({page:'diagnostics',section:'connection'})}>{t('前往诊断检查 Hive 连接')}</Button>}
      </li>;
     }
     return <li key={reason}><p>{t(p.summary,{platform:platform==='openai'?'OpenAI':'Claude'})}</p><p className="muted">{t(p.impact)}</p>{p.target&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.target!)}>{t(p.target.section==='source'?'打开读取设置':'查看账号详情')}</Button>}</li>;
    })}
    {changed&&!reasons.some(r=>r.endsWith('_confirmation_required'))&&<li>{t('发现不同账号，请在详情确认换号；原账号选择仍保留。')}</li>}
    {!compact&&expired&&<li>{t('所选来源的授权已过期，请重新登录。')}</li>}
    {!deviceWait&&stale&&!errors.length&&<li>{t('上次报告不能证明当前接单状态，正在重新核对。')}</li>}
    {!compact&&showPaused&&<li>{t(current?'已暂停接单':'上次记录：已暂停接单')}</li>}
   </ul>
   {sourceError&&onNavigate&&<Button variant="ghost" onClick={()=>navigate({page:'accounts',section:'source',platform})}>{t('打开读取设置')}</Button>}
  </details>}
  {!deviceWait&&runtime.view?.local==='failed'&&<Button variant="outline" disabled={runtime.busy||runtime.uncertain||runtime.startBlocked} onClick={()=>void runtime.start([])}>{t('重试准备')}</Button>}
  {(uncertain||stale&&!deviceWait)&&<Button variant="outline" disabled={!!accounts.busy[platform]||!!accounts.writeBusy[platform]||supply?.state.busy} onClick={()=>{accounts.refresh(platform);void supply?.model.read();}}>{t('重新核对')}</Button>}
  {op?.kind==='authorize'&&op.state==='cancelled'&&<p className="account-action-help">{t('本次登录已取消；可重新读取当前登录后继续。')}</p>}
 </div>;
}
