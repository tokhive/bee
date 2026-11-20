import {Pause} from 'lucide-react';
import type {DesktopSnapshot} from '../../system/desktopState';
import type {AccountPlatform} from '../../system/accounts';
import {accountPresentation,type AccountPresentation} from './accountPresentation';
import {AccountQuota} from './AccountDisplay';
import {Badge,Button} from '../../components/ui';
import {t} from '../../i18n';

interface HistoricalAccount {platform:AccountPlatform;presentation:AccountPresentation;paused?:boolean}
export interface HandoffAccountHistory {profile:string;bindingRevision:number;hive:string;rows:HistoricalAccount[]}
/** Display-only public facts: no client, callback, credential, or current readiness. */
export function rememberHandoffAccounts(previous:HandoffAccountHistory|undefined,snapshot:DesktopSnapshot):HandoffAccountHistory|undefined {
 if(snapshot.currentProfile&&previous?.profile!==snapshot.currentProfile)previous=undefined;
 if(!snapshot.currentProfile||snapshot.native.state!=='ready'||snapshot.device?.state!=='bound'||snapshot.bindingRevision===undefined||!snapshot.device.hive)return previous;
 if(previous?.bindingRevision!==snapshot.bindingRevision||previous.hive!==snapshot.device.hive)previous=undefined;
 if(snapshot.error||snapshot.deviceError||snapshot.recoveryError||snapshot.startup?.state!=='ready')return previous;
 const rows=[...previous?.rows??[]];
 for(const platform of ['openai','claude'] as const){
  const account=snapshot.accounts[platform];
  if(!account||snapshot.accountErrors[platform]||!snapshot.accountRefresh[platform]?.lastConfirmedAt)continue;
  const index=rows.findIndex(row=>row.platform===platform);
  if(index!==-1)rows.splice(index,1);
  if(account.selection.state!=='selected')continue;
  const presentation=accountPresentation(account,false,Date.now(),true,true);
  const supply=snapshot.supplies[platform];
  const paused=supply&&!snapshot.supplyErrors[platform]&&snapshot.supplyRefresh[platform]?.lastConfirmedAt?supply.paused:undefined;
  rows.push({platform,presentation,paused});
 }
 rows.sort((a,b)=>a.platform==='openai'?-1:b.platform==='openai'?1:0);
 return {profile:snapshot.currentProfile,bindingRevision:snapshot.bindingRevision,hive:snapshot.device.hive,rows};
}
export function HandoffAccountList({history}:{history:HandoffAccountHistory}){
 if(!history.rows.length)return null;
 return <section className="native-accounts-section auto-service-accounts overview-accounts-card" aria-label={t('平台账号列表')}>
  <div className="section-heading"><h2>{t('AI 账号')}</h2></div>
  <div className="native-account-list">{history.rows.map(({platform,presentation,paused})=>{
   const label=platform==='openai'?'OpenAI':'Claude';
   return <section key={platform} className="native-account-row" aria-label={t('{platform} 账号',{platform:label})} data-account-platform={platform}>
    <div className="native-account-identity"><div className="native-account-copy">
     <div className="native-platform-name"><h3>{label}</h3>{presentation.plan&&<Badge>{presentation.plan[0].toUpperCase()+presentation.plan.slice(1)}</Badge>}</div>
     <p className="native-account-fingerprint"><span className="sr-only">{t('账号标识')}: </span><span>{presentation.identity}</span></p>
    </div></div>
    <div className="account-list-condition"><p className="native-account-condition" role="status"><Pause aria-hidden="true"/>{t('等待 Hive 切换')}</p>{paused!==undefined&&<p className="account-action-help">{t(paused?'接单选择：暂停':'接单选择：允许')}</p>}</div>
    {platform==='openai'&&<AccountQuota presentation={presentation}/>}
    <div className="native-account-row-actions">{paused!==undefined&&<Button variant="outline" disabled>{t(paused?'恢复接单':'暂停接单')}</Button>}</div>
   </section>;
  })}</div>
 </section>;
}
