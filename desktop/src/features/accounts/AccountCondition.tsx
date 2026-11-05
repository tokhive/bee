import {useState} from 'react';
import {AlertCircle,Check,Pause} from 'lucide-react';
import type {AccountPlatform} from '../../system/accounts';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import {presentFailure} from '../../presentation/problems';
import {Button} from '../../components/ui';
import {currentLocale,t} from '../../i18n/index';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {supplyFresh,type SharedSupply} from '../supply/useSupply';
import {sameAccountFailure,supplyProblem} from './accountPresentation';

/** One current conclusion; independent conditions remain available in the disclosure. */
export function AccountCondition({accounts,platform,runtime,supply,onNavigate,now=Date.now()}:{accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel;supply?:SharedSupply;onNavigate?:(target:NavigationTarget)=>void;now?:number}){
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
  if(!errors.some(previous=>sameAccountFailure(previous,error)))errors.push(error);
 }
 const sourceError=errors.some(e=>e.evidence.permission_denied==='true'||['source_missing','source_unavailable','permission_denied'].includes(e.code));
 const reasons=current?[...new Set(view?.reasons??[])].filter(r=>r!=='manually_paused'&&r!=='not_configured'&&!(r==='offline'&&runtime.view?.local==='failed')&&!(sourceError&&r===`${platform==='openai'?'codex':'claude'}_source_unavailable`)):[];
 const changed=!dirty&&selected&&account?.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint;
 const expired=!dirty&&account?.candidate.expires_at&&Date.parse(account.candidate.expires_at)<=now+30000;
 const pending=accountPending(account);
 const stale=selected&&!current;
 const blocked=errors.length>0||reasons.length>0||changed||expired;
 const ready=selected&&current&&runtime.view?.local==='running'&&view?.ready&&!view.paused&&!blocked&&!dirty&&!uncertain&&!pending;
 let title:string;
 if(pending&&op?.state!=='reconciling')title=op?.kind==='authorize'?'等待官方登录':'正在处理账号操作';
 else if(uncertain)title='操作结果待确认';
 else if(writing)title='正在更新接单选择…';
 else if(account?.authorization.state==='preparing')title='正在准备账号…';
 else if(runtime.view?.local==='starting')title='正在准备服务…';
 else if(runtime.view?.local==='failed')title='服务准备失败';
 else if(dirty)title='正在读取已有登录…';
 else if(stale)title='状态待更新';
 else if(changed)title='发现不同账号';
 else if(!selected&&errors.length&&errors.every(e=>e.code==='source_missing'))title='尚未登录';
 else if(blocked)title=selected?'不能接单':'登录需要处理';
 else if(!selected)title=account?.candidate.state==='available'?'已有登录，尚未接入':'尚未接入';
 else if(ready)title='可接单';
 else title=view?.paused?'已暂停接单':'不能接单';
 const showPaused=selected&&view?.paused&&title!=='已暂停接单';
 const count=errors.length+reasons.length+(showPaused?1:0)+(changed&&!reasons.some(r=>r.endsWith('_confirmation_required'))?1:0)+(expired?1:0)+(stale&&!errors.length?1:0);
 const navigate=(target:NavigationTarget)=>onNavigate?.({...target,...(target.page==='accounts'&&!target.platform?{platform}:{})});
 return <div className="account-status-block">
  <p className={`native-account-condition ${ready?'is-ready':blocked?'is-blocked':''}`} role="status">{ready?<Check aria-hidden="true"/>:title==='已暂停接单'?<Pause aria-hidden="true"/>:<AlertCircle aria-hidden="true"/>}<span>{t(title)}</span></p>
  {count>0&&<details className="account-conditions" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
   <summary>{t('查看原因（{count}）',{count})}</summary>
   <ul>
    {errors.map((error,index)=>{const p=presentFailure(error,currentLocale());return <li key={index}><p>{p.summary}</p>{p.impact&&p.impact!==p.summary&&<p className="muted">{p.impact}</p>}<details className="account-condition-evidence"><summary>{t('查看失败详情')}</summary><pre>{p.details}</pre></details>{p.action&&p.action.section!=='source'&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.action!)}>{p.actionLabel??t('查看账号详情')}</Button>}</li>;})}
    {reasons.map(reason=>{const p=supplyProblem(reason,platform);return <li key={reason}><p>{t(p.summary,{platform:platform==='openai'?'OpenAI':'Claude'})}</p><p className="muted">{t(p.impact)}</p>{p.target&&onNavigate&&<Button variant="ghost" onClick={()=>navigate(p.target!)}>{t(p.target.section==='source'?'打开读取设置':p.target.section==='connection'?'查看连接':'查看账号详情')}</Button>}</li>;})}
    {changed&&!reasons.some(r=>r.endsWith('_confirmation_required'))&&<li>{t('发现不同账号，请在详情确认换号；原账号选择仍保留。')}</li>}
    {expired&&<li>{t('所选来源的授权已过期，请重新登录。')}</li>}
    {stale&&!errors.length&&<li>{t('上次报告不能证明当前接单状态，正在重新核对。')}</li>}
    {showPaused&&<li>{t(current?'已暂停接单':'上次记录：已暂停接单')}</li>}
   </ul>
   {sourceError&&onNavigate&&<Button variant="ghost" onClick={()=>navigate({page:'accounts',section:'source',platform})}>{t('打开读取设置')}</Button>}
  </details>}
  {runtime.view?.local==='failed'&&<Button variant="outline" disabled={runtime.busy||runtime.uncertain||runtime.startBlocked} onClick={()=>void runtime.start([])}>{t('重试准备')}</Button>}
  {(uncertain||stale)&&<Button variant="outline" disabled={!!accounts.busy[platform]||!!accounts.writeBusy[platform]||supply?.state.busy} onClick={()=>{accounts.refresh(platform);void supply?.model.read();}}>{t('核对结果')}</Button>}
  {op?.kind==='authorize'&&op.state==='cancelled'&&<p className="account-action-help">{t('本次登录已取消；可重新读取当前登录后继续。')}</p>}
 </div>;
}
