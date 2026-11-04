import {formatDate,currentLocale} from '../../i18n/index';
import {FailureNotice} from '../../components/ProblemNotice';
import {platforms,supplyFresh,supplyProgress,type SharedSupply} from './useSupply';
import { t } from '../../i18n/index';
import {reasonCopy,supplyProblem} from '../accounts/accountPresentation';
export {reasonCopy} from '../accounts/accountPresentation';
export function SupplyPanel({supply}: {supply:SharedSupply}) {
 const {model,state,blocked}=supply;
 const {views,errors}=state;
 return <section className="supply-panel" aria-label={t('平台供给')}>
  <div className="section-heading"><h2>{t('平台供给')}</h2></div>
  <p className="feature-note">{t('暂停按当前 Hive 账号和平台保存，换设备后仍保留；不会终止已接请求。')}</p>
  <p className="feature-note">{t('恢复只解除手动暂停，不启动本机贡献；接单条件由 Hive 报告。')}</p>
  <div className="account-actions"><button disabled={blocked||!platforms.every(p=>model.canWrite(p,true))} onClick={()=>void model.writeAll(true)}>{t('全部暂停')}</button><button disabled={blocked||!platforms.every(p=>model.canWrite(p))} onClick={()=>void model.writeAll(false)}>{t('全部恢复')}</button></div>
  <div className="supply-grid">{platforms.map(platform=>{
   const view=views[platform];const progress=supplyProgress(state,platform);
   const current=supplyFresh(state,platform)&&!(state.operation==='write'&&state.activePlatform===platform);
   const progressCopy=progress==='inflight'?'前次核对尚未结束，结束后重试。':progress==='waiting'?'等待自动重试…':progress==='retrying'?'重试中…':'核对中…';
   return <section className="supply-card" aria-label={platform==='openai'?'OpenAI':'Claude'} key={platform}>
    <h3>{platform==='openai'?'OpenAI':'Claude'}</h3>
    <p className="supply-state" role={progress?'status':undefined}>{t(current ? view!.paused?'已手动暂停':view!.ready?'满足接单条件（Hive 报告）':'不满足接单条件' : progress?progressCopy:errors[platform]?'本次结果未确认':'核对已过期')}</p>
    {progress==='waiting'&&state.supplyRefresh?.[platform]?.nextRetryAt&&<p className="muted">{t('下次核对')}: <time dateTime={state.supplyRefresh[platform]!.nextRetryAt!}>{formatDate(state.supplyRefresh[platform]!.nextRetryAt!,currentLocale())}</time></p>}
    {errors[platform]&&<FailureNotice failure={errors[platform]} check="supply_read"/>}
    {current&&view!.reasons.length>0&&<ul className="supply-reasons">{view!.reasons.map(reason=><li key={reason}>{t(reasonCopy[reason],{platform:platform==='openai'?'OpenAI':'Claude'})}<p>{t(supplyProblem(reason,platform).impact)}</p></li>)}</ul>}
    <p className="muted supply-time">{t('最后核对时间')}: {view?<time dateTime={view.checked_at}>{formatDate(view.checked_at,currentLocale())}</time>:t('尚未核对')}</p>
    <button disabled={blocked||!current||!model.canWrite(platform,!view?.paused)} onClick={()=>{if(current)void model.write(platform,!view!.paused);}}>{t(view?.paused?'恢复':'暂停')}</button>
   </section>;
  })}</div>
 </section>;
}
