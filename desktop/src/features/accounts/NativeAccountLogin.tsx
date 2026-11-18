import {useEffect,useRef} from 'react';
import {AlertCircle,CheckCircle2,ExternalLink,LoaderCircle} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {Button} from '../../components/ui';
import {accountConfirmationKey} from '../../system/accounts';
import {normalizeFailure,requestNotExecuted} from '../../system/failures';
import {presentFailure} from '../../presentation/problems';
import {currentLocale,t} from '../../i18n/index';
import type {NavigationTarget} from '../../app/navigation';
import type {AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {accountActionBlock,loginMaintenanceCopy,sameAccountFailure} from './accountPresentation';
import {FailureNotice} from '../../components/ProblemNotice';

export const hasClaudeLogin=(accounts:AccountsModel)=>!!accounts.loginFlows.claude||accounts.views.claude?.operation?.kind==='authorize'||!!accounts.views.claude?.login_maintenance;
export function claudeLoginFailure(accounts:AccountsModel){
 const flow=accounts.loginFlows.claude,view=accounts.views.claude;
 if(flow?.checking)return accounts.errors.claude;
 return accounts.errors.claude??accounts.sourceReadFailed.claude??(flow?.rechecked?view?.candidate.error??view?.authorization.error:view?.operation?.error??view?.candidate.error);
}
export function NativeAccountLogin({accounts,runtime,onNavigate,expanded=false,compact=false,onDismiss}:{compact?:boolean;onDismiss?:()=>void;expanded?:boolean;accounts:AccountsModel;runtime:RuntimeModel;onNavigate?:(target:NavigationTarget)=>void}){
 const platform='claude',view=accounts.views.claude,flow=accounts.loginFlows.claude,maintenance=view?.login_maintenance,op=view?.operation??maintenance?.operation;
 const root=useRef<HTMLElement>(null);
 const confirmation=flow?.confirmation;
 useEffect(()=>{if(confirmation){root.current?.scrollIntoView({block:'nearest'});root.current?.focus({preventScroll:true});}},[confirmation]);
 if(!hasClaudeLogin(accounts))return null;
 const busy=accounts.claudeSourceSaving||!!accounts.writeBusy.claude||!!accounts.busy.claude||!!flow?.checking;
 const active=op?.kind==='authorize'&&['pending','running'].includes(op.state);
 const failure=claudeLoginFailure(accounts);
 const cancelUnknown=!!accounts.cancelUnconfirmed.claude&&accounts.cancelUnconfirmed.claude.operationId===op?.id&&active;
 const unknown=cancelUnknown||op?.state==='reconciling'||!!accounts.uncertain.claude&&!active||!!accounts.errors.claude&&!requestNotExecuted(accounts.errors.claude)&&accounts.errors.claude.code!=='ACCOUNT_CONTEXT_CHANGED';
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),accounts.sources.claude,!!accounts.dirty.claude,runtime.view?.local,runtime.view?.run_id]);
 const block=()=>accountActionBlock('authorize',{autoService:accounts.autoService,view,platform,now:Date.now(),dirty:!!accounts.dirty.claude,busy:!!accounts.writeBusy.claude,unknown,submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults,runtime:runtime.view,runtimeBlocked:runtime.uncertain||!!runtime.error||runtime.stalled});
 const changed=!!confirmation&&confirmation!==stamp();
 const candidate=view?.candidate;
 const verified=(!maintenance||maintenance.phase==='restored')&&(flow?.rechecked||op?.kind==='authorize'&&op.state==='succeeded')&&!busy&&!unknown&&!accounts.dirty.claude&&!accounts.readFailures.claude&&!failure&&candidate?.state==='available'&&!!candidate.reference&&candidate.identity_verified&&!!candidate.expires_at&&Date.parse(candidate.expires_at)>Date.now()+30000;
 const different=expanded&&verified&&view?.selection.state==='selected'&&!!candidate?.fingerprint&&candidate.fingerprint!==view.selection.fingerprint;
 const completed=expanded&&verified&&op?.state==='succeeded'&&view?.selection.state==='selected'&&candidate?.fingerprint===view.selection.fingerprint;
 const problem=failure?presentFailure(normalizeFailure(failure,'account_operation'),currentLocale()):null;
 const transport=failure?.evidence.transport_failed==='true';
 const permission=failure?.code==='permission_denied'||failure?.evidence.permission_denied==='true';
 const invalid=!!failure&&['invalid_credentials','source_missing','expired','missing_scope','authorization_source_unchanged','client_missing','client_version_unsupported','client_capability_missing'].includes(failure.code);
 const sourceBlocked=!!failure&&['unsupported_store','authorization_namespace_mismatch'].includes(failure.code);
 const localRead=permission||!!failure?.check.startsWith('read_');
 const cancelled=op?.state==='cancelled'&&!flow?.rechecked;
 const waiting=!confirmation&&!unknown&&(active||busy);
 const title=compact&&cancelUnknown?'暂时无法确认取消结果':compact&&cancelled?'已取消登录':different?'发现不同账号':completed?'重新登录成功':confirmation?'登录 Claude':unknown?'登录结果待确认':waiting?flow?.checking?'正在核验当前登录…':expanded?'等待完成 Claude 登录':'请完成 Claude 官方登录':op?.state==='unknown'?'本次登录结果未确认':verified?view?.selection.state==='selected'?'Claude 登录已核验':'已登录 Claude，尚未接入':cancelled?'本次登录已取消':problem?null:'尚未确认可用的 Claude 登录';
 const open=()=>accounts.openLogin(platform,stamp());
 const source=accounts.sourceFor(platform);
 const checkBlocked=busy||active||unknown||!!accounts.readFailures.claude||!accounts.defaults||!!accounts.sharedReadFailure;
 if(confirmation&&accounts.autoService)return <Dialog.Root open onOpenChange={open=>{if(!open)accounts.dismissLogin(platform);}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content claude-login-confirm">
  <Dialog.Close asChild><Button variant="ghost" className="claude-login-close">{t('关闭')}</Button></Dialog.Close>
  <Dialog.Title>{t(view?.selection.state==='selected'?'重新登录 Claude':'登录 Claude')}</Dialog.Title>
  <Dialog.Description>{t('调用已安装的 Claude Code 官方客户端，可能改变客户端当前登录账号。')}</Dialog.Description>
  <p className="claude-login-impact">{t(view?.selection.state==='selected'?'将暂停此平台接单，已有请求可继续收尾。登录后仍暂停；不同账号需另行确认换号。':'登录后核验账号，由你确认是否接入 Bee。接入保留已有接单选择。')}</p>
  <p>{t('本次配置目录：{directory}；凭证存储：{store}。',{directory:source.directory??t('Claude Code 默认目录'),store:t(source.store==='keychain'?'系统钥匙串':source.store==='file'?'本地文件':'自动读取')})} {t('Bee 将打开系统终端，请按终端和浏览器提示完成登录。')}</p>
  {changed?<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>:block()&&<p role="alert">{t(block()!.message)}</p>}
  <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={changed||!!block()} onClick={()=>{if(confirmation===stamp()&&!block())accounts.authorize(platform);}}>{t('开始官方登录')}</Button></div>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
 return <section ref={root} tabIndex={-1} className={`native-account-login ${expanded?'claude-login-expanded':''} ${completed?'claude-login-complete':''} ${compact?'claude-login-compact':''}`} aria-label={t('Claude 登录状态')}>
  {expanded&&!unknown&&!cancelled&&<ol className="oa-steps" aria-label={t('Claude 当前流程')}>{['重新登录','核验账号'].map((label,index)=>{const step=verified?2:flow?.checking||failure&&['official_source_recheck','official_namespace','official_source_revision','official_profile'].includes(failure.check)?1:0;return <li key={label} className={index<step?'done':index===step?problem?'failed':'current':''} aria-current={index===step?'step':undefined}><span className="oa-step-dot" aria-hidden="true">{index+1}</span><span>{t(label)}</span></li>;})}</ol>}
  <div className="account-login-copy">
   <span className={`account-login-icon ${verified?'is-good':problem?'is-error':''}`} aria-hidden="true">{waiting?<LoaderCircle className="account-login-spinner"/>:verified?<CheckCircle2/>:problem?<AlertCircle/>:<ExternalLink/>}</span>
   <div className="account-login-message">
    {title&&<h4 role="status">{t(title)}</h4>}
    {confirmation?<><p>{t('将打开系统终端运行 Claude Code 官方登录，可能改变该客户端当前账号。')}</p><p>{t(accounts.autoService?'登录将暂停此平台接单；完成后由你手动恢复。':'登录后不会自动接入或开始贡献。')}</p>{changed?<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>:block()&&<p role="alert">{t(block()!.message)}</p>}</>:unknown?<p>{t(cancelUnknown?'Bee 正在继续核对本次登录是否已结束。':'正在核对原登录操作；请先确认结果。')}{compact&&runtime.view?.platforms.claude.supply?.paused&&<> {t('接单保持暂停。')}</>}</p>:waiting?<p>{t(flow?.checking?'正在读取所选来源并核验账号。':'请按官方页面和系统终端中的提示完成登录；如显示授权码，请粘贴到终端。Bee 会自动核验结果。')}{expanded&&runtime.view?.platforms.claude.supply?.paused&&<> {t('接单保持暂停。')}</>}</p>:different?<p>{t('确认换号前，Bee 保留已接入账号。')}</p>:completed?<p>{t(runtime.view?.platforms.claude.supply?.paused?'已完成重新登录，接单保持暂停。':'已完成重新登录，接单状态以当前核对结果为准。')}</p>:verified?<p>{t(view?.selection.state==='selected'?'账号选择未改变；如需换号，请在详情确认。':accounts.autoService?'下一步确认接入，再由你恢复接单。':'下一步点击接入，由你决定何时开始贡献。')}</p>:cancelled?<p>{t(compact?'已确认本次流程结束；已发生的官方授权不会因此撤销。':'官方客户端可能已保存登录，可以检查当前登录后继续。')}{compact&&runtime.view?.platforms.claude.supply?.paused&&<> {t('接单保持暂停。')}</>}</p>:null}
    {!confirmation&&problem&&!compact&&<div role="alert" className="account-login-error"><h4>{transport?t('Claude 官方账号核验请求失败。'):problem.summary}</h4><p>{permission?t('请允许 Bee 读取所选登录记录，然后重新读取。'):problem.impact}</p><details><summary>{t('查看失败详情')}</summary><pre>{problem.details}</pre></details></div>}
    {op?.state==='unknown'&&<p>{t('原登录进程已中断，原登录结果未确认；账号维护状态单独核对。')}</p>}
    {maintenance&&<><p role="status">{t(loginMaintenanceCopy[maintenance.phase])}</p>{maintenance.error&&!sameAccountFailure(maintenance.error,failure)&&<FailureNotice failure={maintenance.error} check="login_maintenance" onNavigate={onNavigate}/>}</>}
   </div>
  </div>
  <div className="account-login-actions">
   {maintenance?.can_recheck&&<Button variant="outline" disabled={busy} onClick={()=>accounts.refresh(platform)}>{t('核对维护结果')}</Button>}
   {different&&onNavigate?<Button onClick={()=>onNavigate({page:'accounts',section:'account',platform})}>{t('核对账号变更')}</Button>:completed?<Button onClick={onDismiss}>{t('完成')}</Button>:confirmation?<><Button variant="outline" onClick={()=>accounts.dismissLogin(platform)}>{t('取消')}</Button><Button disabled={changed||!!block()} onClick={()=>{if(confirmation===stamp()&&!block())accounts.authorize(platform);}}>{t('继续登录')}</Button></>:unknown?(!compact||accounts.accountRefresh?.claude?.state==='blocked'?<Button variant="outline" disabled={busy} onClick={()=>accounts.refresh(platform)}>{t('检查登录结果')}</Button>:null):active?<Button variant="outline" disabled={busy} onClick={()=>accounts.cancelAuthorize(platform)}>{t('取消登录')}</Button>:busy?null:verified?null:<>
    {!compact&&!invalid&&!sourceBlocked&&<Button disabled={checkBlocked} onClick={()=>accounts.recheckLogin(platform,localRead?'local':'official')}>{t(localRead?'重新读取':transport?'重新核验':'检查当前登录')}</Button>}
    {!transport&&!localRead&&!sourceBlocked&&<Button variant={invalid||compact?'default':'outline'} disabled={!!block()} onClick={open}>{t('重新登录')}</Button>}
    {onNavigate&&sourceBlocked&&<Button variant="outline" onClick={()=>onNavigate({page:'accounts',section:'source',platform})}>{t('检查凭证来源')}</Button>}
   </>}
  </div>
  {compact&&problem&&<details className="claude-login-record"><summary>{t('查看核对记录')}</summary><pre>{problem.details}</pre></details>}
 </section>;
}
