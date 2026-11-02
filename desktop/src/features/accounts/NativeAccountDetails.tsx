import {formatDate,currentLocale} from '../../i18n/index';
import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import type {AccountError,AccountPlatform} from '../../system/accounts';
import {DetailSheet} from '../../components/DetailSheet';
import {Button} from '../../components/ui';
import {t} from '../../i18n/index';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {SharedSupply} from '../supply/useSupply';
import {accountPresentation,accountPhase} from './accountPresentation';
import {NativeAccountActions,AccountOperationStatus} from './NativeAccountActions';
import {AccountQuota,AccountCheckStatus,AccountReadHistory,useAccountClock} from './AccountDisplay';
// Detailed diagnostic evidence remains available to diagnostic consumers.
export function AccountErrorView({error}:{error:AccountError}){return <FailureNotice failure={error} check="account_operation"/>;}
export const accountTime=(value:string|null)=>value?formatDate(value,currentLocale()):t('未知');
export function NativeAccountDetails({accounts,platform,runtime,supply,onNavigate,navigationRequest}:{navigationRequest?:NavigationRequest;accounts:AccountsModel;onNavigate?:(target:NavigationTarget)=>void;platform:AccountPlatform;runtime:RuntimeModel;supply?:SharedSupply}){
 const label=platform==='openai'?'OpenAI':'Claude',snapshot=accounts.views[platform];
 const readFailed=!!accounts.readFailures[platform];
 const now=useAccountClock(accounts),presentation=accountPresentation(snapshot,!!accounts.dirty[platform],now,readFailed,!!accounts.deviceFailure);
 const defaults=accounts.defaults?.platforms.find(d=>d.platform===platform);
 const source=accounts.sources[platform]??{directory:null,store:defaults?.default_store??'file'};
 const [localDirectory,setLocalDirectory]=useState(source.directory??'');
 const directory=accounts.sourceDirectories[platform]??localDirectory;
 const setDirectory=(value:string)=>{if(accounts.setSourceDirectory)accounts.setSourceDirectory(platform,value);else setLocalDirectory(value);};
 const [open,setOpen]=useState(false);
 useEffect(()=>{const target=navigationRequest?.target;if(target?.page==='accounts'&&['source','account'].includes(target.section??'')&&(target.platform??'openai')===platform)setOpen(true);},[navigationRequest?.sequence,platform]);
 useEffect(()=>{if(!open)return;const target=navigationRequest?.target;if(target?.page!=='accounts'||target.platform!==platform)return;const timer=setTimeout(()=>{const field=document.querySelector<HTMLInputElement>(`[data-account-source="${platform}"] input`);if(target.section==='source'){field?.closest('details')?.setAttribute('open','');field?.scrollIntoView({block:'nearest'});field?.focus({preventScroll:true});}},0);return()=>clearTimeout(timer);},[open,navigationRequest?.sequence,platform]);
 const navigate=onNavigate?((target:NavigationTarget)=>onNavigate({...target,...((target.page==='accounts'||target.page==='diagnostics')&&!target.platform?{platform}:{})})):undefined;
 const blocked=accountPending(snapshot)||!!accounts.uncertain[platform]||!!accounts.writeBusy[platform];
 const commitDirectory=()=>{if(directory!==(source.directory??''))accounts.edit(platform,{...source,directory:directory||null});};
 const storeNames:Record<string,string>={auto:'自动',file:'文件',keyring:'钥匙串',keychain:'钥匙串'};
 return <DetailSheet open={open} onOpenChange={setOpen} trigger={<Button variant="ghost" size="icon" aria-label={t('{platform} 详情',{platform:label})} title={t('{platform} 详情',{platform:label})}><ArrowRight aria-hidden="true"/></Button>} title={t('{name} 账号详情',{name:label})} description={t('查看账号与额度，管理凭证读取方式。')}>
  <AccountCheckStatus supply={supply} platform={platform}/>
  <AccountReadHistory accounts={accounts} platform={platform}/>
  <dl className="account-detail-facts"><div><dt>{t('当前账号标识')}</dt><dd>{presentation.identity??t('尚未接入 {platform} 账号',{platform:label})}</dd></div>{snapshot?.selection.state==='selected'&&<><div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan??t('套餐待确认')}</dd></div><div><dt>{t('授权到期')}</dt><dd>{accountTime(presentation.expiresAt)}</dd></div></>}{!accounts.dirty[platform]&&snapshot?.candidate.reference&&<div><dt>{t('候选账号标识')}</dt><dd>{snapshot.candidate.fingerprint?.slice(0,16)??t('账号标识待官方核验')}</dd></div>}</dl>
  {!readFailed&&<p className="native-account-reason">{t(accountPhase(snapshot,!!accounts.dirty[platform],!!accounts.busy[platform],now))}</p>}
  <section className="account-detail-quota"><h3>{t('额度与重置')}</h3><AccountQuota presentation={presentation} resets/></section>
  <details open className="account-source" data-account-source={platform} data-nav-section="source" data-nav-platform={platform}><summary>{t('凭证读取方式')}</summary><p>{t('读取官方客户端已保存的登录；目录留空使用默认位置。')}</p>
   <label>{t('自定义目录')}<input disabled={blocked} placeholder={defaults?.directory??t('默认目录')} value={directory} onChange={e=>setDirectory(e.target.value)} onBlur={commitDirectory} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitDirectory();}}}/></label>
   <label>{t('存储方式')}<select disabled={blocked||!defaults} value={source.store} onChange={e=>accounts.edit(platform,{directory:directory||null,store:e.target.value})}>{defaults?.stores.map(v=><option key={v.store} value={v.store} disabled={!v.supported}>{t(storeNames[v.store]??v.store)}{v.supported?'':` (${t('暂不支持')})`}</option>)}</select></label>
   {defaults?.stores.filter(v=>!v.supported).map(v=><p key={v.store}>{t('{store} 在当前系统不可用；不会自动改用其他存储方式。',{store:t(storeNames[v.store]??v.store)})} {v.reason&&<span>{t(v.reason==='keyring_not_supported_on_this_os'?'当前系统不支持 Codex 钥匙串读取。':v.reason==='keychain_not_supported_on_this_os'?'当前系统不支持 Claude Code 钥匙串读取。':'此存储方式的支持条件尚未确认。')} <code>{v.reason}</code></span>}</p>)}
   {blocked&&<p>{t('账号操作仍待完成或核对，暂不能修改来源；当前草稿会保留。')}</p>}
   {accounts.busy[platform]&&!accountPending(snapshot)&&(accounts.dirty[platform]||!snapshot?.candidate.source)&&<p role="status">{t('正在读取已有登录…')}</p>}
   {accounts.sourceReadFailed[platform]?<FailureNotice failure={accounts.sourceReadFailed[platform]} check="source_read" onNavigate={navigate}/>:accounts.dirty[platform]&&!accounts.busy[platform]&&<p>{t('来源已更改，等待自动读取。')}</p>}
   <p>{t('修改读取位置不会自动更换已接入账号。')}</p>
   {!defaults&&<p>{t('凭证读取方式尚未确认，暂不能启动官方登录。')}</p>}
  </details>
  <AccountOperationStatus accounts={accounts} platform={platform} onNavigate={navigate} sourceFailure={accounts.sourceReadFailed[platform]}/>
  <div className="account-detail-actions"><NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="detail" onNavigate={target=>{if(target.page!=='accounts')setOpen(false);navigate?.(target);}}/></div>
 </DetailSheet>;
}
