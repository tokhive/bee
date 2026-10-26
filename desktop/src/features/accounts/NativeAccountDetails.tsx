import {useEffect,useState} from 'react';
import type {AccountCapabilities,AccountSnapshot,AccountError} from '../../system/accounts';
import {DetailSheet} from '../../components/DetailSheet';
import {t} from '../../i18n/index';
import {reasonCopy} from '../supply/SupplyPanel';
export function AccountErrorView({error}:{error:AccountError}){return <p role="alert" className="device-error">{error.code}: {error.message}<br/>{error.check} {JSON.stringify(error.evidence)}</p>;}
export const accountTime=(value:string|null)=>value?new Date(value).toLocaleString():t('未知');
function AccountObservation({value}:{value:AccountCapabilities}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const until=Math.min(...[value.valid_until,...value.windows.map(w=>w.reset_at)].filter((v):v is string=>v!==null).map(v=>Date.parse(v)));if(!Number.isFinite(until))return;if(until<=Date.now())return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(2147483647,until-Date.now()+1));return()=>clearTimeout(timer);},[value]);
 const stale=value.status==='stale'||!!value.valid_until&&Date.parse(value.valid_until)<=Math.max(now,Date.now())||value.windows.some(w=>w.reset_at&&Date.parse(w.reset_at)<=Math.max(now,Date.now()));
 return <section className="account-observation"><h3>{t(value.origin==='official'?'官方观察':'Hive 观察')}</h3><p>{t(value.status==='ready'&&!stale?'本次观察有效':reasonCopy[value.status]??'观察尚未就绪')}</p>{stale&&<p>{t('历史数据，已过期')}</p>}<p className="muted">{t('更新时间')}: {accountTime(value.observed_at)}<br/>{t('元数据时间')}: {accountTime(value.metadata_observed_at)}<br/>{t('有效期至')}: {accountTime(value.valid_until)}</p>{value.retry_at&&<p>{t('下次可检查时间')}: {accountTime(value.retry_at)}</p>}
 {!value.windows.length&&<p>{t('额度未知')}</p>}{value.windows.map((w,i)=><div className="native-quota" key={i}><strong>{t('额度窗口')} {w.seconds/3600}h {w.scope}</strong><p>{w.used_percent===null?t('额度未知'):t('已用 {used}% · 剩余 {remaining}%',{used:w.used_percent,remaining:Math.max(0,100-w.used_percent)})}</p>{w.used_percent!==null&&<progress aria-label={t('已用额度')} max={100} value={Math.min(100,w.used_percent)}/>}<p className="muted">{t('重置时间')}: {accountTime(w.reset_at)}</p></div>)}
 <h4>{t('模型能力与市场开放')}</h4>{!value.models.length&&<p>{t('账号模型未知')}</p>}{value.models.map(m=><div className="model-row" key={m.id}><strong>{m.id}</strong><span>{t(m.account_supported===null?'账号支持：未知':m.account_supported?'账号支持':'账号不支持')}</span><span>{t('市场开放：未知')}</span><small>{t('当前接单条件请看平台供给')}</small></div>)}{value.error&&<AccountErrorView error={value.error}/>}</section>;
}
export function NativeAccountDetails({snapshot,dirty}:{snapshot:AccountSnapshot;dirty:boolean}){
 const c=dirty?undefined:snapshot.candidate;
 return <DetailSheet trigger={<button>{t('查看详情')}</button>} title={t('{name} 账号详情',{name:snapshot.platform==='openai'?'OpenAI':'Claude'})} description={t('本地候选、官方观察与 Hive 记录分别核对。')}><>{!dirty&&snapshot.authorization.error&&<AccountErrorView error={snapshot.authorization.error}/>}</><dl><dt>{t('本地候选')}</dt><dd>{c?.fingerprint??t('身份尚未核验')}</dd><dt>{t('订阅套餐')}</dt><dd>{c?.plan??t('未知套餐')}</dd><dt>{t('授权到期')}</dt><dd>{accountTime(c?.expires_at??null)}</dd><dt>{t('接入来源')}</dt><dd>{c?.source?`${c.source.store} · ${c.source.directory??t('默认目录')}`:t('尚未检测')}</dd><dt>{t('Hive 当前账号')}</dt><dd>{snapshot.hive.fingerprint??t('未知')}</dd><dt>{t('Hive 候选账号')}</dt><dd>{snapshot.hive.pending_fingerprint??t('无待确认候选')}</dd><dt>{t('Hive 账号代次')}</dt><dd>{snapshot.hive.generation??t('未知')}</dd></dl>{snapshot.capabilities.filter(v=>!dirty||v.origin!=='official').map(v=><AccountObservation key={v.origin} value={v}/>)}</DetailSheet>;
}
