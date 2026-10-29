import {useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import type {AccountError,AccountPlatform} from '../../system/accounts';
import {DetailSheet} from '../../components/DetailSheet';
import {Button} from '../../components/ui';
import {t} from '../../i18n/index';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {SharedSupply} from '../supply/useSupply';
import {accountPresentation} from './accountPresentation';
import {NativeAccountActions,AccountOperationStatus} from './NativeAccountActions';
import {AccountQuota,AccountCheckStatus,useAccountClock} from './AccountDisplay';
// Detailed diagnostic evidence remains available to diagnostic consumers.
export function AccountErrorView({error}:{error:AccountError}){return <p role="alert" className="device-error">{error.code}: {error.message}<br/>{error.check} {JSON.stringify(error.evidence)}</p>;}
export const accountTime=(value:string|null)=>value?new Date(value).toLocaleString():t('未知');
export function NativeAccountDetails({accounts,platform,runtime,supply}:{accounts:AccountsModel;platform:AccountPlatform;runtime:RuntimeModel;supply?:SharedSupply}){
 const label=platform==='openai'?'OpenAI':'Claude',snapshot=accounts.views[platform];
 const now=useAccountClock(accounts),presentation=accountPresentation(snapshot,!!accounts.dirty[platform],now);
 const defaults=accounts.defaults?.platforms.find(d=>d.platform===platform);
 const source=accounts.sources[platform]??{directory:null,store:defaults?.default_store??'file'};
 const [directory,setDirectory]=useState(source.directory??'');
 useEffect(()=>{setDirectory(source.directory??'');},[source.directory]);
 const blocked=accountPending(snapshot)||!!accounts.uncertain[platform]||!!accounts.writeBusy[platform];
 const commitDirectory=()=>{if(directory!==(source.directory??''))accounts.edit(platform,{...source,directory:directory||null});};
 const storeNames:Record<string,string>={auto:'自动',file:'文件',keyring:'钥匙串',keychain:'钥匙串'};
 return <DetailSheet trigger={<Button variant="ghost" size="icon" aria-label={t('{platform} 详情',{platform:label})} title={t('{platform} 详情',{platform:label})}><ArrowRight aria-hidden="true"/></Button>} title={t('{name} 账号详情',{name:label})} description={t('查看账号与额度，管理凭证读取方式。')}>
  <AccountCheckStatus supply={supply} platform={platform}/>
  <dl className="account-detail-facts"><div><dt>{t('当前账号')}</dt><dd>{presentation.identity??t('尚未接入')}</dd></div><div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan??t('未知套餐')}</dd></div><div><dt>{t('授权到期')}</dt><dd>{accountTime(presentation.expiresAt)}</dd></div></dl>
  <section className="account-detail-quota"><h3>{t('额度与重置')}</h3><AccountQuota presentation={presentation} resets/></section>
  <details open className="account-source"><summary>{t('凭证读取方式')}</summary><p>{t('读取官方客户端已保存的登录；目录留空使用默认位置。')}</p>
   <label>{t('自定义目录')}<input disabled={blocked} placeholder={defaults?.directory??t('默认目录')} value={directory} onChange={e=>setDirectory(e.target.value)} onBlur={commitDirectory} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitDirectory();}}}/></label>
   <label>{t('存储方式')}<select disabled={blocked||!defaults} value={source.store} onChange={e=>accounts.edit(platform,{directory:directory||null,store:e.target.value})}>{defaults?.stores.map(v=><option key={v.store} value={v.store} disabled={!v.supported}>{t(storeNames[v.store]??v.store)}{v.supported?'':` (${t('暂不支持')})`}</option>)}</select></label>
   {accounts.busy[platform]&&!accountPending(snapshot)&&(accounts.dirty[platform]||!snapshot?.candidate.source)&&<p role="status">{t('正在读取已有登录…')}</p>}
   {accounts.sourceReadFailed[platform]?<p role="alert">{t('无法读取凭证来源，请检查目录和访问权限；重新进入账号页会再次读取。')}</p>:accounts.dirty[platform]&&!accounts.busy[platform]&&<p>{t('来源已更改，等待自动读取。')}</p>}
   <p>{t('修改读取位置不会自动更换已接入账号。')}</p>
   {!defaults&&<p>{t('凭证读取方式暂不可用，正在自动核对。')}</p>}
  </details>
  <AccountOperationStatus accounts={accounts} platform={platform}/>
  <div className="account-detail-actions"><NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="detail"/></div>
  {runtime.view?.local==='running'&&<p className="feature-note">{t('重新登录前请先停止贡献。')}</p>}
 </DetailSheet>;
}
