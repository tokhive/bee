import {Sparkles,Check,Pause,ShieldCheck} from 'lucide-react';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {platforms,supplyFresh,type SharedSupply} from '../supply/useSupply';
import {reasonCopy} from '../supply/SupplyPanel';
import {accountPresentation} from './accountPresentation';
import {NativeAccountActions,AccountOperationStatus} from './NativeAccountActions';
import {NativeAccountDetails} from './NativeAccountDetails';
import {AccountQuota,AccountCheckStatus,useAccountClock} from './AccountDisplay';
import {Badge,Button} from '../../components/ui';
import {t} from '../../i18n/index';

export function NativeAccountList({context,accounts,runtime,supply}:{context:'overview'|'accounts';accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply}){
 const now=useAccountClock(accounts);
 const running=runtime.view?.local==='running'&&!runtime.error&&!runtime.uncertain;
 const selectedCount=platforms.filter(p=>accounts.views[p]?.selection.state==='selected').length;
 return <section className="native-accounts-section" aria-label={t('平台账号列表')}>
  <div className="section-heading"><h2>{t('AI 账号')}</h2><div className="account-list-status"><AccountCheckStatus supply={supply}/><span>{t('{count} 个已接入',{count:selectedCount})}</span></div></div>
  <div className="native-account-list">{platforms.map(platform=>{
   const snapshot=accounts.views[platform],label=platform==='openai'?'OpenAI':'Claude',dirty=!!accounts.dirty[platform];
   const presentation=accountPresentation(snapshot,dirty,now),selected=snapshot?.selection.state==='selected';
   const view=supply?.state.views[platform];
   const current=!!supply&&!supply.blocked&&supplyFresh(supply.state,platform,now)&&!(supply.state.operation==='write'&&supply.state.activePlatform===platform);
   const ready=current&&running&&!view!.paused&&view!.ready&&view!.reasons.length===0;
   const candidate=!dirty?snapshot?.candidate:undefined;
   const reasons=current?view!.reasons.map(reason=>t(reasonCopy[reason])):[];
   if(current&&!running&&!view!.reasons.includes('offline'))reasons.push(t('贡献尚未启动'));
   const localReason=!selected?(accounts.busy[platform]&&!accountPending(snapshot)&&!candidate?.source?t('正在读取已有登录…'):candidate?.state==='available'?t('已有登录，尚未接入'):candidate&&candidate.state!=='not_checked'?t('还没有 {platform} 登录',{platform:label}):t('登录状态待确认')):null;
   const copy=current?ready?'可接单':'不能接单':view||supply?.state.errors[platform]?'状态待更新':'状态待确认';
   const paused=view?.paused===true;
   const localErrors=!dirty?[candidate?.error,snapshot?.authorization.error,snapshot?.capabilities[0]?.error]:[];
   return <section className="native-account-row" aria-label={t('{platform} 账号',{platform:label})} key={platform}>
    <div className="native-account-identity"><span className={`platform-mark ${platform}`}>{platform==='openai'?<Sparkles aria-hidden="true"/>:<span aria-hidden="true">✳</span>}</span><div className="native-account-copy">
     <div className="native-platform-name"><h3>{label}</h3><Badge>{presentation.plan?presentation.plan[0].toUpperCase()+presentation.plan.slice(1):t('未知套餐')}</Badge></div>
     <p className="native-account-fingerprint">{presentation.identity??t('尚未接入')}</p>
     <p className={`native-account-condition ${ready?'is-ready':''}`}>{ready?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(copy)}{context==='accounts'&&selected&&!running&&current&&paused&&<span className="account-paused">{t('已暂停')}</span>}</p>
     {localReason&&<p className="native-account-reason">{localReason}</p>}
     {reasons.length>0&&<ul className="native-account-reasons">{reasons.map((reason,i)=><li key={`${reason}:${i}`}>{reason}</li>)}</ul>}
     {[...new Map([...localErrors,snapshot?.hive.error].filter(e=>!!e).map(e=>[`${e.code}:${e.message}`,e])).values()].map(e=><p className="native-account-reason" role="alert" key={`${e.code}:${e.message}`}>{e.message}</p>)}
     {snapshot?.issues.map((issue,i)=><p className="native-account-reason" role={issue.notify?'alert':undefined} key={`${issue.code}:${i}`}>{issue.message}</p>)}
     <AccountOperationStatus accounts={accounts} platform={platform}/>
    </div></div>
    <AccountQuota presentation={presentation}/>
    <div className="native-account-row-actions">
     {context==='accounts'&&<NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="row"/>}
     {running&&selected&&supply&&<Button variant="outline" disabled={!current||!!accounts.uncertain[platform]||!supply.model.canWrite(platform,!paused)} onClick={()=>{if(current)void supply.model.write(platform,!paused);}}>{t(paused?'恢复接单':'暂停接单')}</Button>}
     {context==='accounts'&&<NativeAccountDetails accounts={accounts} platform={platform} runtime={runtime} supply={supply}/>}
    </div>
   </section>;
  })}</div>
  <p className="native-accounts-footnote"><ShieldCheck aria-hidden="true"/>{t('授权信息保留在本机')}</p>
 </section>;
}
