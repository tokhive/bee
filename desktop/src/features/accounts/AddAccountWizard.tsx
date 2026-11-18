import {useEffect,useRef,useState} from 'react';
import {open} from '@tauri-apps/plugin-dialog';
import {Check,FolderOpen,ShieldCheck} from 'lucide-react';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {Button} from '../../components/ui';
import {accountConfirmationKey} from '../../system/accounts';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import {presentFailure} from '../../presentation/problems';
import {currentLocale,t} from '../../i18n/index';
import {accountPending,type AccountsModel} from './useAccounts';
import {accountActionBlock} from './accountPresentation';
import {AccountErrorPopover} from './AccountErrorPopover';
import {useAccountClock} from './AccountDisplay';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {supplyFresh,type SharedSupply} from '../supply/useSupply';
import './add-account.css';

type Props={accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;onBack:()=>void;navigationRequest?:NavigationRequest;onNavigate?:(target:NavigationTarget)=>void};
export function AddAccountWizard({accounts,runtime,supply,onBack,navigationRequest,onNavigate}:Props){
 const [screen,setScreen]=useState<'connect'|'source'|'confirm'>(navigationRequest?.target.section==='source'?'source':'connect');
 const [checking,setChecking]=useState(false),[confirmation,setConfirmation]=useState<string>(),[changed,setChanged]=useState(false);
 const [pickerError,setPickerError]=useState<UiFailure>(),[picking,setPicking]=useState(false);
 const [confirmedIdentity,setConfirmedIdentity]=useState<{fingerprint:string|null;plan:string|null}>();
 const [submitted,setSubmitted]=useState(false),[kept,setKept]=useState(false);
 const [exitAfterLogin,setExitAfterLogin]=useState<string>();
 const [dismissedLoginFailure,setDismissedLoginFailure]=useState<string>();
 const initial=useRef(false),active=useRef(true),heading=useRef<HTMLHeadingElement>(null);
 const now=useAccountClock(accounts),view=accounts.views.openai,op=view?.operation;
 const progressQuery=accounts.loginProgress?.id===op?.id?accounts.loginProgress:undefined;
 const progress=progressQuery?.value;
 const pending=accountPending(view)||op?.state==='unknown'||!!accounts.uncertain.openai||progress?.phase==='cleaning_up'||!!progress?.blocker;
 const observing=checking||!initial.current&&!!accounts.busy.openai;
 const busy=observing||!accounts.sourceReady||checking||accounts.sourceSaving||!!accounts.writeBusy.openai;
 const candidate=view?.candidate;
 // OpenAI exposes a locally validated candidate. identity_verified belongs to
 // the Claude profile check and remains false even after an OpenAI login succeeds.
 const valid=candidate?.state==='available'&&!candidate.error&&!!candidate.reference&&!!candidate.fingerprint&&!!candidate.expires_at&&Date.parse(candidate.expires_at)>now+30000&&!accounts.dirty.openai&&!accounts.errors.openai;
 const loginSucceeded=op?.kind==='authorize'&&op.state==='succeeded';
 const login=pending&&op?.kind==='authorize';
 const intake=pending&&!login;
 const submitting=submitted&&!!accounts.writeBusy.openai&&!pending;
 const starting=!!accounts.startingLogin.openai&&!login&&!intake;
 const queryStopped=login&&progressQuery?.phase==='stopped';
 const cleanup=login&&(progress?.phase==='cleaning_up'||!!accounts.cancelUnconfirmed.openai);
 const supplyCurrent=!!supply&&!supply.blocked&&supplyFresh(supply.state,'openai',now)&&!supply.state.writeBusy;
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),candidate?.identity_verified,accounts.sourceFor('openai'),runtime.view?.local,runtime.view?.run_id,supply?.state.views.openai?.paused]);
 const block=(action:'select'|'authorize')=>accountActionBlock(action,{autoService:accounts.autoService,view,platform:'openai',now:Date.now(),dirty:!!accounts.dirty.openai,busy:!!accounts.writeBusy.openai||accounts.sourceSaving||checking,unknown:!!accounts.uncertain.openai||!!accounts.readFailures.openai||op?.state==='unknown',submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults&&accounts.sourceReady,runtime:runtime.view,runtimeBlocked:!!runtime.error||runtime.uncertain||runtime.stalled});
 const selectBlock=block('select'),loginBlock=block('authorize');
 const confirmValid=confirmation===stamp()&&valid&&supplyCurrent&&!selectBlock&&!busy;
 const missing=candidate?.state==='source_missing';
 // A new official login creates/replaces the source. Prior source-read facts
 // still belong to the account snapshot, not to the in-flight login result.
 const showSourceError=!missing&&!starting&&!login;
 const failureDismissed=!!op&&dismissedLoginFailure===op.id;
 const operationError=starting||failureDismissed?undefined:op?.error;
 const progressError=login&&progressQuery?.error?normalizeFailure(progressQuery.error,'authorize_progress'):undefined;
 const rawError=pickerError??(screen==='source'?accounts.sourceSaveError:undefined)??(login&&(!progress||progress.actions.open)?accounts.loginOpenError:undefined)??(login?accounts.cancelUnconfirmed.openai?.failure:undefined)??progress?.blocker??progressError??(op?.kind==='authorize'&&op.state==='failed'&&!valid?operationError:undefined)??(failureDismissed&&accounts.errors.openai?.code===op?.error?.code?undefined:accounts.errors.openai)??(showSourceError?candidate?.error:undefined)??(showSourceError?view?.authorization.error:undefined)??(op?.kind==='authorize'&&valid?undefined:operationError);
 const queryError=accounts.originalAccountQuery?.error;
 const error=rawError?normalizeFailure(rawError,'account_operation'):undefined;
 const verify=async()=>{
  setChecking(true);setChanged(false);setKept(false);
  try{await accounts.verifyOpenai();}finally{if(active.current){setChecking(false);setScreen('confirm');setConfirmation(undefined);}}
 };
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{
  if(initial.current||!accounts.sourceReady||!accounts.defaults||!view||pending||accounts.busy.openai||screen==='source')return;
  initial.current=true;void verify();
 },[accounts.defaults,accounts.sourceReady,view,pending,accounts.busy.openai,screen]);
 // Capture the facts actually displayed, after verification. Ordinary refreshes
 // cannot silently replace the identity the user was about to confirm.
 useEffect(()=>{
  if(screen==='confirm'&&!checking&&valid&&!pending&&!confirmation){setConfirmation(stamp());setConfirmedIdentity({fingerprint:candidate!.fingerprint,plan:candidate!.plan});}
 },[screen,checking,valid,pending,confirmation,view,supply?.state.views.openai?.paused]);
 useEffect(()=>{if(screen==='source')document.getElementById('add-account-directory')?.focus();else heading.current?.focus();},[screen,login,intake]);
 useEffect(()=>{
  if(op?.kind==='authorize'&&op.state==='succeeded'&&!pending&&!kept&&screen==='connect'&&valid){setScreen('confirm');setConfirmation(undefined);}
 },[op,pending,kept,screen,valid]);
 useEffect(()=>{
  if(!exitAfterLogin)return;
  if(op?.id!==exitAfterLogin){setExitAfterLogin(undefined);return;}
  if(!pending&&!accounts.writeBusy.openai&&['succeeded','failed','cancelled'].includes(op.state)){setExitAfterLogin(undefined);onBack();}
 },[exitAfterLogin,op,pending,accounts.writeBusy.openai,onBack]);
 const problem=error?presentFailure(error,currentLocale()):undefined;
 const loginStartDenied=!starting&&!pending&&!valid&&op?.kind==='authorize'&&op.state==='failed'&&error?.code==='authorization_process_failed'&&error.check==='official_process'&&/\b(?:spawn|exec)\b/i.test(error.message)&&/EACCES|permission denied/i.test(error.message);
 const loginMissing=!starting&&!pending&&!valid&&op?.kind==='authorize'&&op.state==='failed'&&error?.code==='client_missing';
 const loginTimedOut=!starting&&!pending&&!valid&&op?.kind==='authorize'&&op.state==='failed'&&error?.code==='authorization_timeout';
 const sourcePermissionDenied=!starting&&!pending&&!observing&&!valid&&screen!=='source'&&error?.code==='permission_denied'&&error.check==='source_read'&&accounts.sourceFor('openai').store!=='keyring';
 const terminalLoginFailure=loginStartDenied||loginMissing||loginTimedOut;
 const returnToMethods=()=>{setDismissedLoginFailure(op?.id);setScreen('connect');setKept(false);};
 const source=accounts.openaiDraft??accounts.sourceFor('openai');
 const openSource=()=>{if(!accounts.openaiDraft)accounts.setOpenaiDraft({...accounts.sourceFor('openai')});setScreen('source');setPickerError(undefined);};
 const step=intake?3:screen==='confirm'&&(valid||!!confirmation)&&!pending&&!checking?3:2;
 const loginTitle=progress?.blocker?'登录流程暂时受阻':queryStopped?'登录进度查询已停止':cleanup?'正在确认登录已结束…':progress?.phase==='starting'?'正在启动 OpenAI 登录…':progress?.phase==='verifying'?'正在核验账号…':progress?.phase==='finished'?'正在更新登录结果…':'等待完成 OpenAI 登录';
 const title=screen==='source'?'读取已有的 OpenAI 登录信息':starting?'正在启动 OpenAI 登录…':login?loginTitle:loginStartDenied?'无法启动官方登录':loginMissing?'未找到 Codex':loginTimedOut?'本次登录已超时':sourcePermissionDenied?'无法读取本机登录信息':intake?'暂时无法确认接入结果':submitting?'正在接入账号…':observing?'正在读取并核验账号…':step===3?'确认接入 OpenAI 账号':kept&&valid?'已核验 OpenAI 账号':'连接 OpenAI 账号';
 const loginStatus=progress?.blocker?'本次登录仍有阻塞，请查看错误详情并核对原流程。':queryStopped?'Bee 尚未确认本次登录结果。点击“刷新登录进度”继续查询。':progressError?'暂时未读到登录进度，Bee 正在重试查询。':cleanup?'Bee 正在确认本次登录已结束，完成前不能再次发起登录。':progress?.phase==='starting'?'Bee 正在准备官方登录，请稍候。':progress?.phase==='verifying'?'官方登录已完成，Bee 正在核验账号身份。':progress?.phase==='finished'?'Bee 正在读取本次登录结果，核对通过后进入确认接入。':accounts.openingLogin?'Bee 正在请求打开本次官方登录页面。':'请在官方页面完成授权，Bee 会自动继续。';
 const status=submitting?'已提交你确认的账号，正在等待接入结果。':starting?'Bee 正在准备官方登录，请稍候。':login?loginStatus:observing?'Bee 正在读取本机登录信息；读取成功后会自动核验账号。':undefined;
 const showSpinner=!!status&&!queryStopped&&!progress?.blocker&&(submitting||starting||observing||cleanup||!!progress&&['starting','verifying','finished'].includes(progress.phase));
 const loginWaiting=login&&!cleanup&&!queryStopped&&!progress?.blocker&&(!progress||progress.phase==='waiting_authorization');
 const showLoginRefresh=!progress||queryStopped||!!progressError||cleanup||!!progress?.blocker;
 return <><section className="add-account" aria-label={t('添加账号')} data-account-platform="openai" tabIndex={-1}>
  <header className="add-account-top"><h2>{t('添加 OpenAI 账号')}</h2>{screen!=='source'&&step===2&&(missing&&!error||terminalLoginFailure||sourcePermissionDenied)&&!starting&&!pending&&!observing&&!kept&&<Button variant="ghost" onClick={onBack}>{t('取消添加')}</Button>}{loginWaiting&&progress?.actions.cancel&&op&&<Button variant="ghost" disabled={busy||accounts.openingLogin} onClick={()=>{setExitAfterLogin(op.id);accounts.cancelAuthorize('openai');}}>{t('取消添加')}</Button>}</header>
  <ol className="add-account-steps" aria-label={t('添加账号步骤')}>{['选择平台','连接账号','确认接入'].map((label,i)=><li key={label} className={step>i+1?'done':undefined} aria-current={step===i+1?'step':undefined}><span>{step>i+1?<Check aria-hidden="true"/>:i+1}</span>{t(label)}</li>)}</ol>
  <div className="add-account-body">
   <h3 ref={heading} tabIndex={-1} className={showSpinner?'add-account-progress-title':undefined}>{showSpinner&&<svg className="add-account-progress-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-8 5 16 3-8h5"/></svg>}{t(title)}</h3>
   {status&&<p role="status" aria-live="polite" aria-atomic="true">{t(status)}</p>}
   {error&&!intake&&!loginMissing&&!loginTimedOut&&<p className="add-account-error" role="alert">{loginStartDenied?t('系统拒绝运行 Codex，请检查客户端的执行权限。'):sourcePermissionDenied?t('系统拒绝访问 Codex 登录文件。'):problem?.summary}<AccountErrorPopover errors={[error]}/></p>}
   {problem?.action&&onNavigate&&!sourcePermissionDenied&&<Button variant="outline" onClick={()=>onNavigate(problem.action!)}>{problem.actionLabel??t('查看详情')}</Button>}
   {screen==='source'&&!pending?<form data-account-source="openai" onSubmit={event=>{event.preventDefault();initial.current=true;void (async()=>{const saved=await accounts.saveOpenaiSource(source);if(saved&&active.current){setScreen('confirm');setConfirmation(undefined);}})();}}>
    <p>{t('选择 Codex 保存登录信息的目录。')}</p>
    <label htmlFor="add-account-directory">{t('读取目录')}</label>
    <div className="add-account-directory"><input id="add-account-directory" name="credential-directory" autoComplete="off" spellCheck={false} value={source.directory??''} placeholder={accounts.defaults?.platforms.find(p=>p.platform==='openai')?.directory} disabled={busy||picking} onChange={e=>accounts.setOpenaiDraft({...source,directory:e.target.value||null})}/><Button type="button" variant="outline" disabled={busy||picking} onClick={()=>{setPicking(true);setPickerError(undefined);void open({directory:true,multiple:false,title:t('选择读取目录'),defaultPath:source.directory??undefined}).then(path=>{if(active.current&&typeof path==='string')accounts.setOpenaiDraft({...source,directory:path});}).catch(cause=>{if(active.current)setPickerError(normalizeFailure(cause,'directory_picker'));}).finally(()=>{if(active.current)setPicking(false);});}}><FolderOpen aria-hidden="true"/>{t('选择目录')}</Button></div>
    <p>{t('留空使用默认目录。保存后会自动读取并核验账号。')}</p>
    <label htmlFor="add-account-store">{t('凭证存储')}</label><select id="add-account-store" name="credential-store" value={source.store} disabled={busy} onChange={e=>accounts.setOpenaiDraft({...source,store:e.target.value})}>{accounts.defaults?.platforms.find(p=>p.platform==='openai')?.stores.filter(s=>s.supported).map(s=><option key={s.store} value={s.store}>{s.store}</option>)}</select>
    <div className="add-account-actions"><Button type="submit" disabled={busy||picking}>{t(accounts.sourceSaving?'正在保存…':'保存')}</Button><Button type="button" variant="outline" disabled={busy||picking} onClick={()=>setScreen('connect')}>{t('返回')}</Button></div>
   </form>:sourcePermissionDenied?<><p>{t('请检查目录的访问权限，也可以选择其他读取位置。')}</p><div className="add-account-actions"><Button disabled={busy} onClick={openSource}>{t('设置读取位置')}</Button><Button variant="ghost" disabled={busy} onClick={()=>void verify()}>{t('重新检查')}</Button></div></>:loginMissing||loginTimedOut?<><p>{t(loginMissing?'请先安装 Codex 官方客户端，然后返回此处重试。':'重新登录前，Bee 会先确认上次登录已结束。')}</p>{loginMissing&&<details className="add-account-install"><summary>{t('安装指引')}</summary><p>{t('通过 OpenAI 官方提供的 Codex 安装方式安装客户端，安装完成后回到 Bee。')}</p></details>}<div className="add-account-actions"><Button disabled={!!loginBlock||busy} onClick={()=>{initial.current=true;accounts.authorize('openai');}}>{t(loginMissing?'重试登录':'重新登录')}</Button><Button variant="ghost" disabled={busy} onClick={returnToMethods}>{t(loginMissing?'返回':'取消登录')}</Button>{error&&<AccountErrorPopover errors={[error]}/>}</div></>:loginStartDenied?<div className="add-account-actions"><Button disabled={!!loginBlock||busy} onClick={()=>{initial.current=true;accounts.authorize('openai');}}>{t('重试登录')}</Button><Button variant="ghost" disabled={busy} onClick={returnToMethods}>{t('返回')}</Button></div>:login?<>
    <div className="add-account-actions">{progress?.actions.open&&<Button disabled={accounts.openingLogin} aria-busy={accounts.openingLogin} onClick={()=>void accounts.openLoginPage()}>{t(accounts.openingLogin?'正在打开…':accounts.loginOpenError?'重新打开登录页面':'打开登录页面')}</Button>}{showLoginRefresh&&<Button variant="outline" disabled={busy} onClick={()=>{void accounts.queryLogin();accounts.refresh('openai');}}>{t('刷新登录进度')}</Button>}{op&&['pending','running'].includes(op.state)&&!accounts.cancelUnconfirmed.openai&&<Button variant="ghost" disabled={busy||progress?.phase==='cleaning_up'||!!progress&&!progress.actions.cancel} onClick={()=>accounts.cancelAuthorize('openai')}>{t('取消登录')}</Button>}</div>
   </>:intake?<>
    <div className="add-account-identity"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg><div><small>OpenAI</small><strong>{(confirmedIdentity?.fingerprint??candidate?.fingerprint)?.slice(0,16)??t('账号身份待核对')}</strong></div></div>
    <p>{t('接入请求已发出，但未取得确定回执。核对完成前，账号不会加入已接入列表。')}</p>
    {error&&<p className="add-account-error" role="alert">{problem?.summary}<AccountErrorPopover errors={[error]}/></p>}{accounts.originalAccountQuery?.phase==='stopped'&&<p>{t(accounts.originalAccountQuery.reason==='time_limit'?'自动核对已达 60 秒，尚未确认原操作结果。':'本轮查询已停止，尚未确认原操作结果。')}</p>}{!!queryError&&<AccountErrorPopover errors={[normalizeFailure(queryError,'account_original_query')]}/>}<div className="add-account-actions"><Button disabled={busy} onClick={()=>{if(accounts.originalAccountQuery)void accounts.queryOriginalAccount();else accounts.refresh('openai');}}>{t('核对结果')}</Button></div></>:observing||submitting?null:step===3?<>
    {loginSucceeded&&valid&&<p role="status">{t('登录成功，尚未接入 Bee')}</p>}
    <div className="add-account-identity"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg><div><small>OpenAI</small><strong>{confirmedIdentity?.fingerprint?.slice(0,16)}</strong></div></div>
    <p>{t('接单会使用此账号的订阅额度。')}</p>
    <p>{t(!supplyCurrent?'接单选择尚未确认，请先核对，暂不能接入。':supply?.state.views.openai?.paused?'接入后保留暂停，由你决定何时恢复接单。':'接入后允许接单，账号准备完成且供给条件满足后开始。')}</p>
    {(changed||confirmation&&confirmation!==stamp())&&<p role="alert">{t('账号、来源或接单选择已变化，请重新核验后确认。')}</p>}
    {selectBlock&&<p>{t(selectBlock.message)}</p>}
    <div className="add-account-actions"><Button disabled={!confirmValid||submitted} onClick={()=>{if(!confirmValid||confirmation!==stamp()||block('select')||!supply||!supplyFresh(supply.state,'openai',Date.now())){setChanged(true);return;}setSubmitted(true);accounts.action('openai','select');}}>{t('确认接入')}</Button><Button variant="ghost" disabled={busy} onClick={()=>{setScreen('connect');setKept(true);setSubmitted(false);}}>{t('返回')}</Button>{(!confirmValid||submitted)&&<Button variant="ghost" disabled={busy} onClick={()=>{setSubmitted(false);void accounts.recheckCurrentOpenai();void verify();}}>{t('重新核验')}</Button>}</div>
   </>:missing&&!error&&!starting&&!kept?<>
    <p>{t(source.directory?'未在所选位置找到登录信息。':'未在默认位置找到登录信息。')}</p>
    <h4>{t('通过官方客户端登录')}</h4>
    <p>{t('通过 Codex 完成登录后，Bee 会自动核验账号。登录后还需确认接入。')}</p>
    {loginBlock&&<p>{t(loginBlock.message)}</p>}
    <Button disabled={!!loginBlock||busy} onClick={()=>{initial.current=true;accounts.authorize('openai');}}>{t('登录 OpenAI')}</Button>
    <div className="add-account-secondary"><p>{t('已在其他位置登录？')}</p><Button variant="ghost" disabled={busy} onClick={openSource}>{t('设置读取位置')}</Button></div>
    <div className="add-account-back"><Button variant="ghost" disabled={busy} onClick={onBack}>{t('上一步')}</Button></div>
   </>:<>
    {kept&&valid&&<div className="add-account-identity"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg><div><small>OpenAI</small><strong>{confirmedIdentity?.fingerprint?.slice(0,16)}</strong></div></div>}
    {!starting&&<p>{t(kept&&valid?'可以继续使用此账号，也可以更换连接方式。尚未接入 Bee。':'可以通过官方客户端登录，或设置已有登录的读取位置。')}</p>}
    {!starting&&loginBlock&&<p>{t(loginBlock.message)}</p>}
    <div className="add-account-actions">{kept&&valid?<Button disabled={busy} onClick={()=>void verify()}>{t('继续使用此账号')}</Button>:<Button disabled={!!loginBlock||busy||starting} aria-busy={starting} onClick={()=>{initial.current=true;accounts.authorize('openai');}}>{t(starting?'正在启动登录…':'登录 OpenAI')}</Button>}<Button variant={kept&&valid?"ghost":"outline"} disabled={busy} onClick={()=>{if(kept&&valid)setKept(false);else openSource();}}>{t(kept&&valid?'更换连接方式':'设置读取位置')}</Button>{!(kept&&valid)&&<Button variant="ghost" disabled={busy} onClick={onBack}>{t('返回')}</Button>}{error&&<Button variant="ghost" disabled={busy} onClick={()=>void verify()}>{t('重新核验')}</Button>}</div>
   </>}
  </div>
 </section><p className="add-account-privacy"><ShieldCheck aria-hidden="true"/>{t('授权信息保留在本机')}</p></>;
}
