import {ShieldCheck} from 'lucide-react';
import {useEffect} from 'react';
import {Button} from '../../components/ui';
import {AddAccountWizard} from './AddAccountWizard';
import {platforms} from '../supply/useSupply';
import {AccountErrorPopover} from './AccountErrorPopover';
import {presentFailure} from '../../presentation/problems';
import {sameAccountFailure} from './accountPresentation';
import type {UiFailure} from '../../system/failures';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import type {AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {SharedSupply} from '../supply/useSupply';
import {NativeAccountList} from './NativeAccountList';
import {t,currentLocale} from '../../i18n/index';
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
 const hasAccountRows=!accounts.autoService||(setup===null||setup==='claude')&&selected.length>0;
 const sharedFailure=deviceError??accounts.sharedFailure;
 const rowAccounts=sharedFailure?{...accounts,sharedFailure}:accounts;
 const pageErrors=[accounts.defaultsError,...(!hasAccountRows?[sharedFailure]:[]),...platforms.filter(p=>!accounts.views[p]).map(p=>accounts.errors[p])].filter((error,index,all):error is UiFailure=>!!error&&!all.slice(0,index).some(previous=>sameAccountFailure(previous,error))&&!(hasAccountRows&&sameAccountFailure(error,sharedFailure)));
 useEffect(()=>{if(adding&&adding!=='choose'&&selected.includes(adding))setAdding(null);},[adding,selected.join(',')]);
 return <>
  {pageErrors.map(error=>{const problem=presentFailure(error,currentLocale()),shared=sameAccountFailure(error,sharedFailure),target=shared?{page:'overview' as const,section:'device' as const}:problem.action;return <div className="account-page-problem" key={JSON.stringify([error.code,error.check,error.message])}><p role="alert">{problem.summary}</p><AccountErrorPopover errors={[error]}/>{target&&onNavigate&&<Button variant="outline" onClick={()=>onNavigate(target)}>{shared?t('前往概览'):problem.actionLabel??t('查看详情')}</Button>}</div>;})}
  {!known&&<p role="status">{t('正在读取账号状态…')}</p>}
  {accounts.autoService&&setup==='choose'?<><section className="add-account" aria-label={t('添加账号')}><header className="add-account-top"><h2>{t('添加账号')}</h2>{selected.length>0&&<Button variant="ghost" onClick={()=>setAdding(null)}>{t('取消添加')}</Button>}</header><ol className="add-account-steps" aria-label={t('添加账号步骤')}>{['选择平台','连接账号','确认接入'].map((label,i)=><li key={label} aria-current={i===0?'step':undefined}><span>{i+1}</span>{t(label)}</li>)}</ol><div className="add-account-body"><h3>{t(selected.length?'添加另一个平台':'添加第一个账号')}</h3><p>{t('选择要接入的平台。接入后，你可以在这里管理账号和接单。')}</p><div className="add-account-platforms">{platforms.map(p=><Button disabled={selected.includes(p)} key={p} aria-label={p==='openai'?'OpenAI':'Claude'} variant="outline" onClick={()=>setAdding(p)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p==='openai'?'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z':'M12 2v20 M2 12h20 M5 5l14 14 M5 19L19 5'}/></svg><span><strong>{p==='openai'?'OpenAI':'Claude'}</strong><small>{t(selected.includes(p)?'已接入，可在账号详情中换号':p==='openai'?'通过 Codex 连接':'通过 Claude Code 连接')}</small></span></Button>)}</div></div></section><p className="add-account-privacy"><ShieldCheck aria-hidden="true"/>{t('授权信息保留在本机')}</p></>:

   accounts.autoService&&setup==='openai'?<AddAccountWizard accounts={accounts} runtime={runtime} supply={supply} navigationRequest={navigationRequest} onNavigate={onNavigate} onBack={()=>setAdding('choose')}/>:
   <>{setup==='claude'&&!selected.includes('claude')&&<Button variant="ghost" onClick={()=>setAdding('choose')}>{t('返回')}</Button>}
  <NativeAccountList visiblePlatforms={accounts.autoService?(setup==='claude'?[...new Set([...selected,'claude' as const])]:selected):undefined} navigationRequest={navigationRequest} onNavigate={onNavigate} context="accounts" accounts={rowAccounts} runtime={runtime} supply={supply}/></>}
 </>;
}
