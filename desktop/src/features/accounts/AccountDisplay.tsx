import {formatDate,formatNumber,currentLocale} from '../../i18n/index';
import {useEffect,useState} from 'react';
import type {AccountPlatform} from '../../system/accounts';
import type {AccountsModel} from './useAccounts';
import type {AccountPresentation} from './accountPresentation';
import {platforms,supplyProgress,type SharedSupply} from '../supply/useSupply';
import {Progress} from '../../components/ui';
import {t} from '../../i18n/index';

export function useAccountClock(accounts:AccountsModel){
 const [tick,setTick]=useState(Date.now());
 useEffect(()=>{
  const dates=Object.values(accounts.views).flatMap(s=>[
   ...(s.candidate.expires_at?[Date.parse(s.candidate.expires_at)-30000,Date.parse(s.candidate.expires_at)]:[]),
   ...s.capabilities.flatMap(c=>[c.valid_until,...c.windows.map(w=>w.reset_at)].filter((v):v is string=>!!v).map(Date.parse)),
  ]).filter(at=>at>Date.now());
  if(!dates.length)return;
  const timer=setTimeout(()=>setTick(Date.now()),Math.min(2147483647,Math.max(1,Math.min(...dates)-Date.now()+1)));
  return()=>clearTimeout(timer);
 },[accounts.views,tick]);
 return Math.max(tick,Date.now());
}
export function AccountCheckStatus({supply,platform}:{supply?:SharedSupply;platform?:AccountPlatform}){
 const progress=supply?(platform?[supplyProgress(supply.state,platform)]:platforms.map(p=>supplyProgress(supply.state,p))):[];
 const copy=progress.includes('retrying')?'重试中…':progress.includes('waiting')?'等待自动重试…':progress.includes('checking')?'核对中…':progress.includes('blocked')?'核对已暂停，需先处理当前问题。':progress.includes('stale')?'接单状态待核对。':null;
 return copy?<span className="account-check-status" role="status">{t(copy)}</span>:null;
}
export function AccountReadHistory({accounts,platform}:{accounts:AccountsModel;platform:AccountPlatform}){
 const snapshot=accounts.views[platform];
 if(!snapshot)return null;
 if(accounts.readFailures[platform]){
  const confirmed=accounts.accountRefresh?.[platform]?.lastConfirmedAt??accounts.refreshStatus?.lastConfirmedAt;
  return <div className="account-read-history"><p>{t('上次确认的账号事实；当前状态待核对。')}</p><p>{t('历史事实不能支持当前可接单结论或账号写操作。')}</p>{confirmed&&<p>{t('上次确认')}: <time dateTime={confirmed}>{formatDate(confirmed,currentLocale())}</time></p>}</div>;
 }
 return accounts.deviceFailure&&snapshot.hive.observed_at?<div className="account-remote-history"><p>{t('Hive 记录未重新确认，仅供参考；本机凭证读取结果单独展示。')}</p><p>{t('上次 Hive 观测')}: <time dateTime={snapshot.hive.observed_at}>{formatDate(snapshot.hive.observed_at,currentLocale())}</time></p></div>:null;
}
export function AccountQuota({presentation,resets=false}:{presentation:AccountPresentation;resets?:boolean}){
 const {windows,quotaState}=presentation;
 const ordered=[...windows].sort((a,b)=>a.seconds-b.seconds);
 const windowName=(seconds:number)=>seconds===18000?t('5 小时'):seconds===604800?t('7 日'):t('{hours} 小时',{hours:formatNumber(seconds/3600,currentLocale())});
 return <div className={`native-account-quota ${quotaState==='current'?'':'quota-unconfirmed'}`}>
  {!ordered.length&&<div className="quota-window"><div className="quota-label"><span>{t('额度')}</span><span>{t('尚未核对')}</span></div><Progress value={null} aria-label={t('已用额度')}/></div>}
  {ordered.map((w,i)=><div className="quota-window" key={`${w.scope}:${w.seconds}:${i}`}><div className="quota-label"><span>{windowName(w.seconds)}{w.scope?` · ${w.scope}`:''}</span><span className="quota-value">{w.used_percent===null?t('尚未核对'):t('已用 {used}%',{used:formatNumber(w.used_percent,currentLocale())})}</span></div>
   <Progress value={w.used_percent} aria-label={`${windowName(w.seconds)} ${w.scope} ${t('已用额度')}`} aria-valuetext={w.used_percent===null?t('尚未核对'):t('已用 {used}%',{used:formatNumber(w.used_percent,currentLocale())})}/>
   {resets&&<p className="quota-reset">{t('重置时间')}: {w.reset_at?formatDate(w.reset_at,currentLocale()):t('未知')}</p>}
  </div>)}
  {quotaState==='stale'&&<p className="quota-history">{t('历史数据，已过期')}</p>}
  {quotaState==='unconfirmed'&&<p className="quota-history">{t('上次确认的额度；当前待核对。')}</p>}
  {(quotaState==='stale'||quotaState==='unconfirmed')&&presentation.observedAt&&<p className="quota-history">{t('上次额度观测')}: <time dateTime={presentation.observedAt}>{formatDate(presentation.observedAt,currentLocale())}</time></p>}
  {quotaState==='current'&&windows.some(w=>w.used_percent!==null&&w.used_percent>=100)&&<p className="quota-exhausted">{t('有额度窗口已耗尽；请查看各窗口重置时间。')}</p>}
 </div>;
}
