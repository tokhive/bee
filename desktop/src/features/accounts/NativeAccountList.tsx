import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {Sparkles,Check,Pause,ShieldCheck} from 'lucide-react';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {platforms,supplyFresh,type SharedSupply} from '../supply/useSupply';
import {accountPresentation,accountPhase,supplyProblem,sameAccountFailure} from './accountPresentation';
import {NativeAccountActions,AccountOperationStatus} from './NativeAccountActions';
import {NativeAccountDetails} from './NativeAccountDetails';
import {AccountQuota,AccountCheckStatus,useAccountClock} from './AccountDisplay';
import {Badge,Button} from '../../components/ui';
import {t,formatNumber,currentLocale} from '../../i18n/index';

export function NativeAccountList({context,accounts,runtime,supply,onNavigate,navigationRequest}:{navigationRequest?:NavigationRequest;context:'overview'|'accounts';onNavigate?:(target:NavigationTarget)=>void;accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply}){
 const now=useAccountClock(accounts);
 const running=runtime.view?.local==='running'&&!runtime.error&&!runtime.uncertain;
 const confirmedPlatforms=platforms.filter(p=>!!accounts.views[p]&&!accounts.errors[p]&&(!accounts.accountRefresh||!!accounts.accountRefresh[p]?.lastConfirmedAt));
 const selectedCount=confirmedPlatforms.filter(p=>accounts.views[p]?.selection.state==='selected').length;
 const countCopy=confirmedPlatforms.length===platforms.length?t('{count} 个已接入',{count:formatNumber(selectedCount,currentLocale())}):selectedCount?t('已确认接入 {count} 个，其余待确认',{count:formatNumber(selectedCount,currentLocale())}):t('接入数量待确认');
 return <section className="native-accounts-section" aria-label={t('平台账号列表')}>
  <div className="section-heading"><h2>{t('AI 账号')}</h2><div className="account-list-status"><AccountCheckStatus supply={supply}/><span>{countCopy}</span></div></div>
  <div className="native-account-list">{platforms.map(platform=>{
   const navigate=onNavigate?((target:NavigationTarget)=>onNavigate({...target,...((target.page==='accounts'||target.page==='diagnostics')&&!target.platform?{platform}:{})})):undefined;
   const snapshot=accounts.views[platform],label=platform==='openai'?'OpenAI':'Claude',dirty=!!accounts.dirty[platform];
   const presentation=accountPresentation(snapshot,dirty,now),selected=snapshot?.selection.state==='selected';
   const view=supply?.state.views[platform];
   const current=!!supply&&!supply.blocked&&supplyFresh(supply.state,platform,now)&&!(supply.state.operation==='write'&&supply.state.activePlatform===platform);
   const ready=current&&running&&!view!.paused&&view!.ready&&view!.reasons.length===0;
   const candidate=!dirty?snapshot?.candidate:undefined;
   const reasons=current?[...new Set(view!.reasons)].map(reason=>({reason,...supplyProblem(reason,platform)})):[];
   const localReason=accountPhase(snapshot,dirty,!!accounts.busy[platform]&&!accountPending(snapshot),now);
   const copy=current?ready?'可接单':'不能接单':view||supply?.state.errors[platform]?'状态待更新':'状态待确认';
   const paused=view?.paused===true;
   const localErrors=!dirty?[candidate?.error,snapshot?.authorization.error,snapshot?.capabilities[0]?.error]:[];
   return <section className="native-account-row" aria-label={t('{platform} 账号',{platform:label})} key={platform} data-account-platform={platform} data-nav-section="account" data-nav-platform={platform} tabIndex={-1}>
    <div className="native-account-identity"><span className={`platform-mark ${platform}`}>{platform==='openai'?<Sparkles aria-hidden="true"/>:<span aria-hidden="true">✳</span>}</span><div className="native-account-copy">
     <div className="native-platform-name"><h3>{label}</h3>{selected&&<Badge>{presentation.plan?presentation.plan[0].toUpperCase()+presentation.plan.slice(1):t('套餐待确认')}</Badge>}</div>
     <p className="native-account-fingerprint">{presentation.identity?<><span>{t('账号标识')}: </span><span>{presentation.identity}</span></>:snapshot?t('尚未接入 {platform} 账号',{platform:label}):t('账号状态尚未确认')}</p>
     <p className={`native-account-condition ${ready?'is-ready':''}`}>{ready?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(copy)}{context==='accounts'&&selected&&!running&&current&&paused&&<span className="account-paused">{t('已暂停')}</span>}</p>
     {localReason&&<p className="native-account-reason">{t(localReason)}</p>}
     {current&&!running&&!view!.reasons.includes('offline')&&<p className="native-account-reason">{t('贡献尚未启动')}</p>}
     {reasons.length>0&&<ul className="native-account-reasons">{reasons.map(problem=><li key={problem.reason}><span>{t(problem.summary,{platform:label})}</span><p>{t(problem.impact)}</p>{problem.target&&navigate&&<Button variant="ghost" onClick={()=>navigate(problem.target!)}>{t(problem.target.section==='connection'?'查看连接':problem.target.section==='source'?'检查凭证来源':'查看账号详情')}</Button>}</li>)}</ul>}
     {[...new Map([...localErrors,snapshot?.hive.error].filter(e=>!!e).map(e=>[JSON.stringify([e.code,e.check,e.evidence,e.message]),e])).entries()].map(([key,e])=><FailureNotice key={key} failure={e} check="source_read" onNavigate={navigate}/>)}
     {snapshot?.issues.filter(issue=>!current||!view!.reasons.includes(issue.code)&&!view!.reasons.includes(`${platform==='openai'?'codex':'claude'}_${issue.code}`)).map((issue,i)=><FailureNotice key={`${issue.code}:${i}`} failure={{...issue,check:'account_issue',evidence:{}}} check="account_issue" onNavigate={navigate}/>)}
     <AccountOperationStatus accounts={accounts} platform={platform} onNavigate={navigate}/>
     {supply?.state.errors[platform]&&!sameAccountFailure(supply.state.errors[platform],accounts.sharedFailure)&&<FailureNotice failure={supply.state.errors[platform]} check="supply_read" onNavigate={navigate}/>}
    </div></div>
    <AccountQuota presentation={presentation}/>
    <div className="native-account-row-actions">
     {context==='accounts'&&<NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="row" onNavigate={navigate}/>}
     {running&&selected&&supply&&<Button variant="outline" disabled={!current||!!accounts.uncertain[platform]||!supply.model.canWrite(platform,!paused)} onClick={()=>{if(current)void supply.model.write(platform,!paused);}}>{t(paused?'恢复接单':'暂停接单')}</Button>}
     {running&&selected&&supply&&(!current||!!accounts.uncertain[platform]||!supply.model.canWrite(platform,!paused))&&<p className="account-action-help">{t(!current?'当前平台接单状态待核对，暂不能修改暂停。':accounts.uncertain[platform]?'账号操作结果待核对，暂不能修改暂停。':'当前平台操作条件不满足，请先处理账号与供给阻塞。')}</p>}
     {context==='accounts'&&<NativeAccountDetails navigationRequest={navigationRequest} onNavigate={onNavigate} accounts={accounts} platform={platform} runtime={runtime} supply={supply}/>}
    </div>
   </section>;
  })}</div>
  <p className="native-accounts-footnote"><ShieldCheck aria-hidden="true"/>{t('授权信息保留在本机')}</p>
 </section>;
}
