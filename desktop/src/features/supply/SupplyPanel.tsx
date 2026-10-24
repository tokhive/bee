import { useEffect, useRef, useState } from 'react';
import type { SupplyClient, SupplyPlatform, SupplyView } from '../../system/supply';
import { t } from '../../i18n/index';
const platforms: SupplyPlatform[] = ['openai','claude'];
const reasonCopy: Record<string,string> = {
 manually_paused:'已手动暂停',banned:'管理员已禁用此平台供给',device_draining:'设备替换中，仅收尾已接请求',offline:'Hive 未看到此平台的 Bee 连接',
 not_configured:'尚未配置平台账号或市场未开放',model_unavailable:'账号没有可用的市场模型',authorization_unavailable:'Hive 没有可用的加密授权',capabilities_unknown:'账号模型和额度报告尚未确认',rate_limited:'上游平台限流中',quota_unknown:'账号额度窗口尚未确认',quota_exhausted:'账号订阅额度已耗尽',plan_not_configured:'管理员尚未配置套餐并发上限',concurrency_full:'账号并发请求已满',
 codex_source_unavailable:'无法读取 Codex 官方登录',codex_confirmation_required:'Codex 账号变更待确认',codex_authorization_rejected:'OpenAI 已拒绝此账号授权',claude_source_unavailable:'无法读取 Claude Code 官方登录',claude_confirmation_required:'Claude Code 账号变更待确认',claude_authorization_rejected:'Anthropic 已拒绝此账号授权',
};
function failure(cause: unknown): string {
 if (cause instanceof Error) return cause.message;
 if (typeof cause === 'object' && cause !== null && 'message' in cause) return `${'code' in cause ? String(cause.code)+': ' : ''}${String(cause.message)}`;
 return String(cause);
}
export function SupplyPanel({client}: {client:SupplyClient}) {
 const [views,setViews] = useState<Partial<Record<SupplyPlatform,SupplyView>>>({});
 const [phase,setPhase] = useState<'checking'|'success'|'failed'>('checking');
 const [error,setError] = useState('');const [now,setNow] = useState(Date.now());
 const actions = useRef<{read:()=>void;write:(platform:SupplyPlatform,paused:boolean)=>void}>(undefined);
 useEffect(()=>{
  let active=true,busy=false,timer:ReturnType<typeof setTimeout>|undefined;
  let latest:Partial<Record<SupplyPlatform,SupplyView>>={};
  async function run(write?:{platform:SupplyPlatform;paused:boolean}) {
   if (!active || busy) return;
   if(write){
    const checked=latest[write.platform];
    if(!checked || Date.now()-Date.parse(checked.checked_at)>30000){setNow(Date.now());return;}
   }
   busy=true;clearTimeout(timer);setPhase('checking');setError('');
   try {
    const next={...latest};
    if(write) next[write.platform]=await client.setPaused(write.platform,write.paused);
    else for(const platform of platforms) {
     if(!active)return;
     next[platform]=await client.status(platform);
    }
    if(!active)return;
    latest=next;setViews(next);setNow(Date.now());setPhase('success');
    timer=setTimeout(()=>void run(),10000);
   }catch(cause){if(active){setError(failure(cause));setPhase('failed');}}
   finally{busy=false;}
  }
  actions.current={read:()=>void run(),write:(platform,paused)=>void run({platform,paused})};
  // The first StrictMode effect is disposed before any IPC is issued.
  queueMicrotask(()=>{if(active)void run();});
  return()=>{active=false;clearTimeout(timer);actions.current=undefined;};
 },[client]);
 useEffect(()=>{
  const expires=Object.values(views).map(view=>Date.parse(view.checked_at)+30001).filter(time=>time>now);
  if(!expires.length)return;
  const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,Math.min(...expires)-Date.now()));
  return()=>clearTimeout(timer);
 },[views,now]);
 return <section className="supply-panel" aria-label={t('平台供给')}>
  <div className="section-heading"><h2>{t('平台供给')}</h2><button disabled={phase==='checking'} onClick={()=>actions.current?.read()}>{t('重新核对平台')}</button></div>
  <p className="feature-note">{t('暂停按当前 Hive 账号和平台保存，换设备后仍保留；不会终止已接请求。')}</p>
  <p className="feature-note">{t('恢复只解除手动暂停，不启动本机贡献；接单条件由 Hive 报告。')}</p>
  {phase==='checking'&&<p role="status">{t('正在核对平台…')}</p>}
  {phase==='failed'&&<p role="alert" className="device-error">{t('平台结果未确认，请重新核对；不会自动重试修改。')}<br/>{error}</p>}
  <div className="supply-grid">{platforms.map(platform=>{
   const view=views[platform];const fresh=Boolean(view && now-Date.parse(view.checked_at)<=30000 && Date.now()-Date.parse(view.checked_at)<=30000);
   const current=phase==='success'&&fresh;
   return <section className="supply-card" aria-label={platform==='openai'?'OpenAI':'Claude'} key={platform}>
    <h3>{platform==='openai'?'OpenAI':'Claude'}</h3>
    <p className="supply-state">{t(current ? view!.paused?'已手动暂停':view!.ready?'满足接单条件（Hive 报告）':'不满足接单条件' : phase==='checking'?'核对中':phase==='failed'?'本次结果未确认':'核对已过期，请重新核对')}</p>
    {current&&view!.reasons.length>0&&<ul className="supply-reasons">{view!.reasons.filter(reason=>reason!=='manually_paused').map(reason=><li key={reason}>{t(reasonCopy[reason])}</li>)}</ul>}
    <p className="muted supply-time">{t('最后核对时间')}: {view?<time dateTime={view.checked_at}>{new Date(view.checked_at).toLocaleString()}</time>:t('尚未核对')}</p>
    <button disabled={!current} onClick={()=>{if(current)actions.current?.write(platform,!view!.paused);}}>{t(view?.paused?'恢复':'暂停')}</button>
   </section>;
  })}</div>
 </section>;
}
