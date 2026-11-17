import {useEffect} from 'react';
import {Button} from '../../components/ui';
import {AddAccountWizard} from './AddAccountWizard';
import {platforms} from '../supply/useSupply';
import {FailureNotice} from '../../components/ProblemNotice';
import type {UiFailure} from '../../system/failures';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import type {AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {SharedSupply} from '../supply/useSupply';
import {NativeAccountList} from './NativeAccountList';
import {t} from '../../i18n/index';
function accountPageState(accounts:AccountsModel){
 const selected=platforms.filter(p=>accounts.views[p]?.selection.state==='selected');
 const known=platforms.every(p=>!!accounts.views[p]);
 const activeOpenai=accounts.views.openai?.operation&&['pending','running','reconciling','unknown'].includes(accounts.views.openai.operation.state)||accounts.uncertain.openai;
 const adding=accounts.setupPlatform;
 const setup=selected.includes('openai')&&adding==='openai'?null:adding??(!selected.length&&known?(activeOpenai?'openai':'choose'):null);
 return {selected,known,setup};
}
export function NativeAccountHeadingActions({accounts,readOnly}:{accounts:AccountsModel;readOnly:boolean}){
 const {selected,known,setup}=accountPageState(accounts);
 const confirmed=!readOnly&&known&&!platforms.some(p=>accounts.readFailures[p]);
 return <div className="account-heading-actions"><span className="account-page-count">{confirmed?t('{count} 个已接入',{count:selected.length}):t('接入数量待确认')}</span>{!readOnly&&known&&selected.length<platforms.length&&setup===null&&<Button onClick={()=>accounts.setSetupPlatform('choose')}>{t('添加账号')}</Button>}</div>;
}
export function NativeAccountsPage({accounts,supply,deviceError,runtime,onNavigate,navigationRequest}:{navigationRequest?:NavigationRequest;accounts:AccountsModel;supply:SharedSupply|undefined;deviceError:UiFailure|null;onNavigate?:(target:NavigationTarget)=>void;runtime:RuntimeModel}){
 const adding=accounts.setupPlatform,setAdding=accounts.setSetupPlatform;
 useEffect(()=>{const target=navigationRequest?.target;if(target?.page==='accounts'&&target.platform&&accounts.views[target.platform]?.selection.state!=='selected')setAdding(target.platform);},[navigationRequest?.sequence]);
 const {selected,known,setup}=accountPageState(accounts);
 useEffect(()=>{if(adding&&adding!=='choose'&&selected.includes(adding))setAdding(null);},[adding,selected.join(',')]);
 return <>
  {accounts.defaultsError&&<FailureNotice failure={accounts.defaultsError} check="account_defaults" onNavigate={onNavigate}/>}
  {deviceError&&<div className="accounts-device-problem"><FailureNotice failure={deviceError} check="device_status" onNavigate={onNavigate}/></div>}
  {platforms.filter(p=>!accounts.views[p]&&accounts.errors[p]&&accounts.errors[p]!==accounts.defaultsError).map(p=><FailureNotice key={p} failure={accounts.errors[p]} check="account_read" onNavigate={onNavigate}/>)}
  {!known&&<p role="status">{t('正在读取账号状态…')}</p>}
  {accounts.autoService&&setup==='choose'?<section className="add-account" aria-label={t('添加账号')}><ol className="add-account-steps" aria-label={t('添加账号步骤')}>{['选择平台','连接账号','确认接入'].map((label,i)=><li key={label} aria-current={i===0?'step':undefined}><span>{i+1}</span>{t(label)}</li>)}</ol><h2>{t('选择要添加的平台')}</h2><p>{t('只会在列表中展示你已添加的账号。')}</p><div className="add-account-platforms">{platforms.filter(p=>!selected.includes(p)).map(p=><Button key={p} variant="outline" onClick={()=>setAdding(p)}>{p==='openai'?'OpenAI':'Claude'}</Button>)}</div>{selected.length>0&&<Button variant="outline" onClick={()=>setAdding(null)}>{t('返回')}</Button>}</section>:
   accounts.autoService&&setup==='openai'?<AddAccountWizard accounts={accounts} runtime={runtime} supply={supply} navigationRequest={navigationRequest} onNavigate={onNavigate} onBack={()=>setAdding('choose')}/>:
   <>{setup==='claude'&&!selected.includes('claude')&&<Button variant="ghost" onClick={()=>setAdding('choose')}>{t('返回')}</Button>}
  <NativeAccountList visiblePlatforms={accounts.autoService?(setup==='claude'?[...new Set([...selected,'claude' as const])]:selected):undefined} navigationRequest={navigationRequest} onNavigate={onNavigate} context="accounts" accounts={accounts} runtime={runtime} supply={supply}/></>}
 </>;
}
