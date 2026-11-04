import {useEffect,useRef} from 'react';
import {AlertCircle,CheckCircle2,ExternalLink,LoaderCircle} from 'lucide-react';
import {Button} from '../../components/ui';
import {accountConfirmationKey} from '../../system/accounts';
import {normalizeFailure,requestNotSent} from '../../system/failures';
import {presentFailure} from '../../presentation/problems';
import {currentLocale,t} from '../../i18n/index';
import type {NavigationTarget} from '../../app/navigation';
import type {AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {accountActionBlock} from './accountPresentation';

export const hasClaudeLogin=(accounts:AccountsModel)=>!!accounts.loginFlows.claude||accounts.views.claude?.operation?.kind==='authorize';
export function claudeLoginFailure(accounts:AccountsModel){
 const flow=accounts.loginFlows.claude,view=accounts.views.claude;
 if(flow?.checking)return accounts.errors.claude;
 return accounts.errors.claude??accounts.sourceReadFailed.claude??(flow?.rechecked?view?.candidate.error??view?.authorization.error:view?.operation?.error??view?.candidate.error);
}
export function NativeAccountLogin({accounts,runtime,onNavigate}:{accounts:AccountsModel;runtime:RuntimeModel;onNavigate?:(target:NavigationTarget)=>void}){
 const platform='claude',view=accounts.views.claude,flow=accounts.loginFlows.claude,op=view?.operation;
 const root=useRef<HTMLElement>(null);
 const confirmation=flow?.confirmation;
 useEffect(()=>{if(confirmation){root.current?.scrollIntoView({block:'nearest'});root.current?.focus({preventScroll:true});}},[confirmation]);
 if(!hasClaudeLogin(accounts))return null;
 const busy=!!accounts.writeBusy.claude||!!accounts.busy.claude||!!flow?.checking;
 const active=op?.kind==='authorize'&&['pending','running'].includes(op.state);
 const failure=claudeLoginFailure(accounts);
 const unknown=!!accounts.cancelUnconfirmed.claude&&accounts.cancelUnconfirmed.claude.operationId===op?.id&&active||op?.state==='reconciling'||!!accounts.uncertain.claude&&!active||!!accounts.errors.claude&&!requestNotSent(accounts.errors.claude)&&accounts.errors.claude.code!=='ACCOUNT_CONTEXT_CHANGED';
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),accounts.sources.claude,!!accounts.dirty.claude,runtime.view?.local,runtime.view?.run_id]);
 const block=()=>accountActionBlock('authorize',{view,platform,now:Date.now(),dirty:!!accounts.dirty.claude,busy:!!accounts.writeBusy.claude,unknown,submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults,runtime:runtime.view,runtimeBlocked:runtime.uncertain||!!runtime.error||runtime.stalled});
 const changed=!!confirmation&&confirmation!==stamp();
 const candidate=view?.candidate;
 const verified=(flow?.rechecked||op?.kind==='authorize'&&op.state==='succeeded')&&!busy&&!unknown&&!accounts.dirty.claude&&!accounts.readFailures.claude&&!failure&&candidate?.state==='available'&&!!candidate.reference&&candidate.identity_verified&&!!candidate.expires_at&&Date.parse(candidate.expires_at)>Date.now()+30000;
 const problem=failure?presentFailure(normalizeFailure(failure,'account_operation'),currentLocale()):null;
 const transport=failure?.evidence.transport_failed==='true';
 const permission=failure?.code==='permission_denied'||failure?.evidence.permission_denied==='true';
 const invalid=!!failure&&['invalid_credentials','source_missing','expired','missing_scope','authorization_source_unchanged','client_missing','client_version_unsupported','client_capability_missing'].includes(failure.code);
 const sourceBlocked=!!failure&&['unsupported_store','authorization_namespace_mismatch'].includes(failure.code);
 const localRead=permission||!!failure?.check.startsWith('read_');
 const cancelled=op?.state==='cancelled'&&!flow?.rechecked;
 const waiting=!confirmation&&!unknown&&(active||busy);
 const title=confirmation?'登录 Claude':unknown?'登录结果待确认':waiting?flow?.checking?'正在核验当前登录…':'请完成 Claude 官方登录':verified?view?.selection.state==='selected'?'Claude 登录已核验':'已登录 Claude，尚未接入':cancelled?'本次登录已取消':problem?null:'尚未确认可用的 Claude 登录';
 const open=()=>accounts.openLogin(platform,stamp());
 const checkBlocked=busy||active||unknown||!!accounts.readFailures.claude||!accounts.defaults||!!accounts.sharedReadFailure;
 return <section ref={root} tabIndex={-1} className="native-account-login" aria-label={t('Claude 登录状态')}>
  <div className="account-login-copy">
   <span className={`account-login-icon ${verified?'is-good':problem?'is-error':''}`} aria-hidden="true">{waiting?<LoaderCircle className="account-login-spinner"/>:verified?<CheckCircle2/>:problem?<AlertCircle/>:<ExternalLink/>}</span>
   <div className="account-login-message">
    {title&&<h4 role="status">{t(title)}</h4>}
    {confirmation?<><p>{t('将打开系统终端运行 Claude Code 官方登录，可能改变该客户端当前账号。')}</p><p>{t('登录后不会自动接入或开始贡献。')}</p>{changed?<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>:block()&&<p role="alert">{t(block()!.message)}</p>}</>:unknown?<p>{t('正在核对原登录操作；请先确认结果。')}</p>:waiting?<p>{t(flow?.checking?'正在读取所选来源并核验账号。':'请按官方页面和系统终端中的提示完成登录；如显示授权码，请粘贴到终端。Bee 会自动核验结果。')}</p>:verified?<p>{t(view?.selection.state==='selected'?'账号选择未改变；如需换号，请在详情确认。':'下一步点击接入，由你决定何时开始贡献。')}</p>:cancelled?<p>{t('官方客户端可能已保存登录，可以检查当前登录后继续。')}</p>:null}
    {!confirmation&&problem&&<div role="alert" className="account-login-error"><h4>{transport?t('Claude 官方账号核验请求失败。'):problem.summary}</h4><p>{permission?t('请允许 Bee 读取所选登录记录，然后重新读取。'):problem.impact}</p><details><summary>{t('查看失败详情')}</summary><pre>{problem.details}</pre></details></div>}
   </div>
  </div>
  <div className="account-login-actions">
   {confirmation?<><Button variant="outline" onClick={()=>accounts.dismissLogin(platform)}>{t('取消')}</Button><Button disabled={changed||!!block()} onClick={()=>{if(confirmation===stamp()&&!block())accounts.authorize(platform);}}>{t('继续登录')}</Button></>:unknown?<Button variant="outline" disabled={busy} onClick={()=>accounts.refresh(platform)}>{t('检查登录结果')}</Button>:active?<Button variant="outline" disabled={busy} onClick={()=>accounts.cancelAuthorize(platform)}>{t('取消登录')}</Button>:busy?null:verified?null:<>
    {!invalid&&!sourceBlocked&&<Button disabled={checkBlocked} onClick={()=>accounts.recheckLogin(platform,localRead?'local':'official')}>{t(localRead?'重新读取':transport?'重新核验':'检查当前登录')}</Button>}
    {!transport&&!localRead&&!sourceBlocked&&<Button variant={invalid?'default':'outline'} disabled={!!block()} onClick={open}>{t('重新登录')}</Button>}
    {onNavigate&&sourceBlocked&&<Button variant="outline" onClick={()=>onNavigate({page:'accounts',section:'source',platform})}>{t('检查凭证来源')}</Button>}
   </>}
  </div>
 </section>;
}
