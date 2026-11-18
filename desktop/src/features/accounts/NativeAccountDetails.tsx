import {AccountCondition} from './AccountCondition';
import {formatDate,currentLocale} from '../../i18n/index';
import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {useEffect,useRef,useState} from 'react';
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
export function NativeAccountDetails({accounts,platform,runtime,supply,onNavigate,navigationRequest,compact=false}:{compact?:boolean;navigationRequest?:NavigationRequest;accounts:AccountsModel;onNavigate?:(target:NavigationTarget)=>void;platform:AccountPlatform;runtime:RuntimeModel;supply?:SharedSupply}){
 const label=platform==='openai'?'OpenAI':'Claude',snapshot=accounts.views[platform];
 const readFailed=!!accounts.readFailures[platform];
 const now=useAccountClock(accounts),presentation=accountPresentation(snapshot,!!accounts.dirty[platform],now,readFailed,!!accounts.deviceFailure,accounts.quotaHistory[platform]);
 const defaults=accounts.defaults?.platforms.find(d=>d.platform===platform);
 const source=accounts.sourceFor(platform);
 const [localDirectory,setLocalDirectory]=useState(source.directory??'');
 const [compactPanel,setCompactPanel]=useState<'summary'|'source'>('summary'),[draftStore,setDraftStore]=useState(source.store);
 const directory=accounts.sourceDirectories[platform]??localDirectory;
 const setDirectory=(value:string)=>{if(accounts.setSourceDirectory)accounts.setSourceDirectory(platform,value);else setLocalDirectory(value);};
 const returnFromLogin=useRef(false),restoreLoginFocus=useRef(false);
 const [open,setOpen]=useState(false),inlineLogin=useRef(false),sourceTrigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{const target=navigationRequest?.target;if(target?.page==='accounts'&&['source','account'].includes(target.section??'')&&(target.platform??'openai')===platform){if(!open)sourceTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setCompactPanel(target.section==='source'?'source':'summary');setOpen(true);}},[navigationRequest?.sequence,platform]);
 useEffect(()=>{setLocalDirectory(source.directory??'');setDraftStore(source.store);},[source.directory,source.store]);
 useEffect(()=>{if(!open)return;const target=navigationRequest?.target;if(target?.page!=='accounts'||target.platform!==platform)return;const timer=setTimeout(()=>{const field=document.querySelector<HTMLInputElement>(`[data-account-source="${platform}"] input`);if(target.section==='source'){field?.closest('details')?.setAttribute('open','');field?.scrollIntoView({block:'nearest'});field?.focus({preventScroll:true});}},0);return()=>clearTimeout(timer);},[open,navigationRequest?.sequence,platform]);
 useEffect(()=>{if(!returnFromLogin.current||accounts.loginFlows.claude?.confirmation)return;returnFromLogin.current=false;if(!accounts.loginFlows.claude){restoreLoginFocus.current=true;setCompactPanel('summary');setOpen(true);}},[accounts.loginFlows.claude]);
 const navigate=onNavigate?((target:NavigationTarget)=>onNavigate({...target,...((target.page==='accounts'||target.page==='diagnostics')&&!target.platform?{platform}:{})})):undefined;
 const blocked=accountPending(snapshot)||!!accounts.uncertain[platform]||!!accounts.writeBusy[platform];
 const commitDirectory=()=>{if(directory!==(source.directory??''))accounts.edit(platform,{...source,directory:directory||null});};
 const storeNames:Record<string,string>={auto:'自动',file:'文件',keyring:'钥匙串',keychain:'钥匙串'};
 if(compact&&platform==='claude')return <DetailSheet overlayClassName="claude-detail-overlay" onCloseAutoFocus={event=>{if(returnFromLogin.current){event.preventDefault();return;}if(sourceTrigger.current?.isConnected){event.preventDefault();sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;}}} onOpenAutoFocus={event=>{if(restoreLoginFocus.current){restoreLoginFocus.current=false;const button=document.querySelector<HTMLElement>('.claude-detail-actions .account-actions button');if(button){event.preventDefault();button.focus({preventScroll:true});}}}} open={open} onOpenChange={value=>{if(!accounts.claudeSourceSaving)setOpen(value);}} trigger={<Button variant="ghost" size="sm" aria-label={t('{platform} 详情',{platform:label})} onClick={()=>setCompactPanel('summary')}>{t('账号详情')}<ArrowRight aria-hidden="true"/></Button>} title={t(compactPanel==='source'?'凭证读取设置':'Claude 账号详情')} description="">
  {compactPanel==='summary'?<>
   <AccountReadHistory accounts={accounts} platform={platform}/>
   <dl className="account-detail-facts"><div><dt>{t('已接入账号')}</dt><dd>{presentation.identity??t('尚未接入')}</dd></div><div><dt>{t('账号状态')}</dt><dd><AccountCondition compact accounts={accounts} platform={platform} runtime={runtime} supply={supply} now={now}/></dd></div>{presentation.plan&&<div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan[0].toUpperCase()+presentation.plan.slice(1)}</dd></div>}</dl>
   <div className="claude-detail-actions"><Button variant="outline" onClick={()=>setCompactPanel('source')}>{t('修改凭证读取设置')}</Button><NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="detail" onInlineLogin={()=>{returnFromLogin.current=true;setOpen(false);}} onNavigate={navigate}/></div>
   {(!snapshot?.candidate.reference||snapshot.candidate.fingerprint===snapshot.selection.fingerprint)?null:<dl className="account-detail-facts"><div><dt>{t('目标账号')}</dt><dd>{snapshot.candidate.fingerprint?.slice(0,16)??t('账号标识待官方核验')}</dd></div></dl>}
   {(accounts.readFailures[platform]||snapshot?.login_maintenance&&snapshot.login_maintenance.phase!=='restored')&&<AccountOperationStatus accounts={accounts} platform={platform} onNavigate={navigate}/>}
  </>:<form className="claude-source-form" data-account-source={platform} onSubmit={event=>{event.preventDefault();if(!blocked&&!accounts.claudeSourceSaving)void accounts.saveClaudeSource({directory:localDirectory||null,store:draftStore}).then(saved=>{if(saved)setOpen(false);});}}>
   <label>{t('配置目录')}<input autoComplete="off" spellCheck={false} value={localDirectory} placeholder={t('使用 Claude Code 默认目录')} disabled={blocked||accounts.claudeSourceSaving} onChange={event=>setLocalDirectory(event.target.value)}/></label>
   <label>{t('存储方式')}<select value={draftStore} disabled={blocked||accounts.claudeSourceSaving||!defaults} onChange={event=>setDraftStore(event.target.value)}>{defaults?.stores.map(item=><option value={item.store} key={item.store} disabled={!item.supported}>{t(item.store==='keychain'?'系统钥匙串':storeNames[item.store]??item.store)}{item.supported?'':` (${t('暂不支持')})`}</option>)}</select></label>
   <p>{t('修改后，Bee 将重新读取并核验账号。')}</p>
   {blocked&&<p>{t('账号操作仍待完成或核对，暂不能修改来源；当前草稿会保留。')}</p>}
   {accounts.claudeSourceSaveError&&<FailureNotice failure={accounts.claudeSourceSaveError} check="preferences_save"/>}
   <div className="dialog-actions"><Button type="button" variant="outline" disabled={accounts.claudeSourceSaving} onClick={()=>{setLocalDirectory(source.directory??'');setDraftStore(source.store);setOpen(false);}}>{t('取消')}</Button><Button type="submit" disabled={blocked||accounts.claudeSourceSaving||!defaults}>{t(accounts.claudeSourceSaving?'正在保存…':'保存')}</Button></div>
   {draftStore==='keychain'&&<p>{t('macOS 官方登录使用系统钥匙串；配置目录用于定位对应凭证，不表示凭证一定存为目录中的文件。')}</p>}
  </form>}
 </DetailSheet>;
 return <DetailSheet open={open} onOpenChange={setOpen} onCloseAutoFocus={event=>{if(sourceTrigger.current?.isConnected){event.preventDefault();sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;}if(inlineLogin.current){event.preventDefault();inlineLogin.current=false;const login=document.querySelector<HTMLElement>('[data-account-platform="claude"] .native-account-login');login?.scrollIntoView({block:'nearest'});login?.focus({preventScroll:true});}}} trigger={<Button variant="ghost" size={compact?'sm':'icon'} aria-label={t('{platform} 详情',{platform:label})} title={t('{platform} 详情',{platform:label})}>{compact&&t('账号详情')}<ArrowRight aria-hidden="true"/></Button>} title={t('{name} 账号详情',{name:label})} description={t('查看账号与额度，管理凭证读取方式。')}>
  <AccountCheckStatus supply={supply} platform={platform}/>
  <AccountReadHistory accounts={accounts} platform={platform}/>
  <dl className="account-detail-facts"><div><dt>{t('当前账号标识')}</dt><dd>{presentation.identity??t('尚未接入 {platform} 账号',{platform:label})}</dd></div>{snapshot?.selection.state==='selected'&&<><div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan??t('套餐待确认')}</dd></div><div><dt>{t('授权到期')}</dt><dd>{accountTime(presentation.expiresAt)}</dd></div></>}{!accounts.dirty[platform]&&snapshot?.candidate.reference&&(!accounts.autoService||snapshot.candidate.fingerprint!==snapshot.selection.fingerprint)&&<div><dt>{t('候选账号标识')}</dt><dd>{snapshot.candidate.fingerprint?.slice(0,16)??t('账号标识待官方核验')}</dd></div>}</dl>
  {accounts.autoService?<AccountCondition accounts={accounts} platform={platform} runtime={runtime} supply={supply} onNavigate={navigate} now={now}/>:!readFailed&&<p className="native-account-reason">{t(accountPhase(snapshot,!!accounts.dirty[platform],!!accounts.busy[platform],now))}</p>}
  <section className="account-detail-quota"><h3>{t('额度与重置')}</h3><AccountQuota presentation={presentation} resets/></section>
  <details open className="account-source" data-account-source={platform} data-nav-section="source" data-nav-platform={platform}><summary>{t('凭证读取方式')}</summary><p>{t('读取官方客户端已保存的登录；目录留空使用默认位置。')}</p>
   <label>{t('自定义目录')}<input name={`${platform}-source-directory`} autoComplete="off" spellCheck={false} disabled={blocked} placeholder={defaults?.directory??t('默认目录')} value={directory} onChange={e=>setDirectory(e.target.value)} onBlur={commitDirectory} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitDirectory();}}}/></label>
   <label>{t('存储方式')}<select disabled={blocked||!defaults} value={source.store} onChange={e=>accounts.edit(platform,{directory:directory||null,store:e.target.value})}>{defaults?.stores.map(v=><option key={v.store} value={v.store} disabled={!v.supported}>{t(storeNames[v.store]??v.store)}{v.supported?'':` (${t('暂不支持')})`}</option>)}</select></label>
   {defaults?.stores.filter(v=>!v.supported).map(v=><p key={v.store}>{t('{store} 在当前系统不可用；不会自动改用其他存储方式。',{store:t(storeNames[v.store]??v.store)})} {v.reason&&<span>{t(v.reason==='keyring_not_supported_on_this_os'?'当前系统不支持 Codex 钥匙串读取。':v.reason==='keychain_not_supported_on_this_os'?'当前系统不支持 Claude Code 钥匙串读取。':'此存储方式的支持条件尚未确认。')} <code>{v.reason}</code></span>}</p>)}
   {blocked&&<p>{t('账号操作仍待完成或核对，暂不能修改来源；当前草稿会保留。')}</p>}
   {accounts.busy[platform]&&!accountPending(snapshot)&&(accounts.dirty[platform]||!snapshot?.candidate.source)&&<p role="status">{t('正在读取已有登录…')}</p>}
   {accounts.sourceReadFailed[platform]?<FailureNotice failure={accounts.sourceReadFailed[platform]} check="source_read" onNavigate={navigate}/>:accounts.dirty[platform]&&!accounts.busy[platform]&&<p>{t('来源已更改，等待自动读取。')}</p>}
   <p>{t('修改读取位置不会自动更换已接入账号。')}</p>
   {accounts.autoService&&<Button variant="outline" disabled={blocked||!!accounts.busy[platform]} onClick={()=>accounts.detect(platform,'local')}>{t('重新读取')}</Button>}
   {!defaults&&<p>{t('凭证读取方式尚未确认，暂不能启动官方登录。')}</p>}
  </details>
  {(accounts.autoService?!!(snapshot?.login_maintenance||snapshot?.operation):!(platform==='claude'&&(accounts.loginFlows.claude||snapshot?.operation?.kind==='authorize')))&&<AccountOperationStatus accounts={accounts} platform={platform} onNavigate={navigate} sourceFailure={accounts.sourceReadFailed[platform]} conditionErrors={accounts.autoService}/>}
  <div className="account-detail-actions"><NativeAccountActions accounts={accounts} platform={platform} runtime={runtime} placement="detail" onInlineLogin={()=>{inlineLogin.current=true;setOpen(false);}} onNavigate={target=>{if(target.page!=='accounts')setOpen(false);navigate?.(target);}}/></div>
 </DetailSheet>;
}
