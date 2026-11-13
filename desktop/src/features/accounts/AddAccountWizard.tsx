import {useEffect,useRef,useState} from 'react';
import {open} from '@tauri-apps/plugin-dialog';
import {Check,FolderOpen,LoaderCircle,Sparkles} from 'lucide-react';
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
 const initial=useRef(false),active=useRef(true),heading=useRef<HTMLHeadingElement>(null);
 const now=useAccountClock(accounts),view=accounts.views.openai,op=view?.operation;
 const progress=accounts.loginProgress?.id===op?.id?accounts.loginProgress?.value:undefined;
 const pending=accountPending(view)||op?.state==='unknown'||!!accounts.uncertain.openai||progress?.phase==='cleaning_up'||!!progress?.blocker;
 const observing=checking||!initial.current&&!!accounts.busy.openai;
 const busy=observing||!accounts.sourceReady||checking||accounts.sourceSaving||!!accounts.writeBusy.openai;
 const candidate=view?.candidate;
 const valid=!!candidate?.identity_verified&&candidate.state==='available'&&!!candidate.reference&&!!candidate.fingerprint&&!!candidate.expires_at&&Date.parse(candidate.expires_at)>now+30000&&!accounts.dirty.openai&&!accounts.errors.openai;
 const login=pending&&op?.kind==='authorize';
 const intake=pending&&!login;
 const supplyCurrent=!!supply&&!supply.blocked&&supplyFresh(supply.state,'openai',now)&&!supply.state.writeBusy;
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),candidate?.identity_verified,accounts.sourceFor('openai'),runtime.view?.local,runtime.view?.run_id,supply?.state.views.openai?.paused]);
 const block=(action:'select'|'authorize')=>accountActionBlock(action,{autoService:accounts.autoService,view,platform:'openai',now:Date.now(),dirty:!!accounts.dirty.openai,busy:!!accounts.writeBusy.openai||accounts.sourceSaving||checking,unknown:!!accounts.uncertain.openai||!!accounts.readFailures.openai||op?.state==='unknown',submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults&&accounts.sourceReady,runtime:runtime.view,runtimeBlocked:!!runtime.error||runtime.uncertain||runtime.stalled});
 const selectBlock=block('select'),loginBlock=block('authorize');
 const confirmValid=confirmation===stamp()&&valid&&supplyCurrent&&!selectBlock&&!busy;
 const missing=candidate?.state==='source_missing';
 const rawError=pickerError??(screen==='source'?accounts.sourceSaveError:undefined)??(login?accounts.loginOpenError:undefined)??(login?accounts.cancelUnconfirmed.openai?.failure:undefined)??progress?.blocker??(op?.kind==='authorize'&&op.state==='failed'&&!valid?op.error:undefined)??accounts.errors.openai??(!missing?candidate?.error:undefined)??(!missing?view?.authorization.error:undefined)??(op?.kind==='authorize'&&valid?undefined:op?.error);
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
 const problem=error?presentFailure(error,currentLocale()):undefined;
 const source=accounts.openaiDraft??accounts.sourceFor('openai');
 const openSource=()=>{if(!accounts.openaiDraft)accounts.setOpenaiDraft({...accounts.sourceFor('openai')});setScreen('source');setPickerError(undefined);};
 const step=intake?3:screen==='confirm'&&(valid||!!confirmation)&&!pending&&!checking?3:2;
 const title=screen==='source'?'设置读取位置':login?progress?.phase==='cleaning_up'||accounts.cancelUnconfirmed.openai?'正在确认登录已结束…':'请在官方页面完成登录':intake?'账号操作结果待核对':observing?'正在读取并核验账号…':step===3?'确认接入 OpenAI':kept&&valid?'已保留当前账号':missing?'未找到本机 OpenAI 登录':'连接 OpenAI 账号';
 return <section className="add-account" aria-label={t('添加账号')} data-account-platform="openai" tabIndex={-1}>
  <ol className="add-account-steps" aria-label={t('添加账号步骤')}>{['选择平台','连接账号','确认接入'].map((label,i)=><li key={label} aria-current={step===i+1?'step':undefined}><span>{step>i+1?<Check aria-hidden="true"/>:i+1}</span>{t(label)}</li>)}</ol>
  <div className="add-account-body">
   <Sparkles className="add-account-mark" aria-hidden="true"/>
   <h2 ref={heading} tabIndex={-1}>{t(title)}</h2>
   <div aria-live="polite">{checking&&<LoaderCircle className="add-account-spinner" aria-label={t('正在读取并核验账号…')}/>}</div>
   {error&&<p className="add-account-error" role="alert">{problem?.summary}<AccountErrorPopover errors={[error]}/></p>}
   {problem?.action&&onNavigate&&<Button variant="outline" onClick={()=>onNavigate(problem.action!)}>{problem.actionLabel??t('查看详情')}</Button>}
   {screen==='source'&&!pending?<form data-account-source="openai" onSubmit={event=>{event.preventDefault();initial.current=true;void (async()=>{const saved=await accounts.saveOpenaiSource(source);if(saved&&active.current){setScreen('confirm');setConfirmation(undefined);}})();}}>
    <label htmlFor="add-account-directory">{t('读取目录')}</label>
    <div className="add-account-directory"><input id="add-account-directory" name="credential-directory" autoComplete="off" spellCheck={false} value={source.directory??''} placeholder={accounts.defaults?.platforms.find(p=>p.platform==='openai')?.directory} disabled={busy||picking} onChange={e=>accounts.setOpenaiDraft({...source,directory:e.target.value||null})}/><Button type="button" variant="outline" disabled={busy||picking} onClick={()=>{setPicking(true);setPickerError(undefined);void open({directory:true,multiple:false,title:t('选择读取目录'),defaultPath:source.directory??undefined}).then(path=>{if(active.current&&typeof path==='string')accounts.setOpenaiDraft({...source,directory:path});}).catch(cause=>{if(active.current)setPickerError(normalizeFailure(cause,'directory_picker'));}).finally(()=>{if(active.current)setPicking(false);});}}><FolderOpen aria-hidden="true"/>{t('选择目录')}</Button></div>
    <p>{t('留空使用默认目录。保存后会自动读取并核验账号。')}</p>
    <label htmlFor="add-account-store">{t('凭证存储')}</label><select id="add-account-store" name="credential-store" value={source.store} disabled={busy} onChange={e=>accounts.setOpenaiDraft({...source,store:e.target.value})}>{accounts.defaults?.platforms.find(p=>p.platform==='openai')?.stores.filter(s=>s.supported).map(s=><option key={s.store} value={s.store}>{s.store}</option>)}</select>
    <div className="add-account-actions"><Button type="submit" disabled={busy||picking}>{t(accounts.sourceSaving?'正在保存…':'保存')}</Button><Button type="button" variant="outline" disabled={busy||picking} onClick={()=>setScreen('connect')}>{t('返回')}</Button></div>
   </form>:login?<>
    <p>{t('登录后自动核验账号，再由你确认是否接入。')}</p>
    <div className="add-account-actions">{progress?.actions.open&&<Button disabled={accounts.openingLogin} onClick={()=>void accounts.openLoginPage()}>{t('打开登录页面')}</Button>}<Button variant="outline" disabled={busy} onClick={()=>{void accounts.queryLogin();accounts.refresh('openai');}}>{t('刷新登录进度')}</Button>{op&&['pending','running'].includes(op.state)&&!accounts.cancelUnconfirmed.openai&&<Button variant="outline" disabled={busy||progress?.phase==='cleaning_up'} onClick={()=>accounts.cancelAuthorize('openai')}>{t('取消登录')}</Button>}</div>
   </>:intake?<><p role="status">{t('账号操作结果待核对')}</p><p>{t('只核对原操作，确认结果前不会重复接入。')}</p>{accounts.originalAccountQuery?.phase==='stopped'&&<p>{t(accounts.originalAccountQuery.reason==='time_limit'?'自动核对已达 60 秒，尚未确认原操作结果。':'本轮查询已停止，尚未确认原操作结果。')}</p>}{!!queryError&&<AccountErrorPopover errors={[normalizeFailure(queryError,'account_original_query')]}/>}<Button disabled={busy} onClick={()=>{if(accounts.originalAccountQuery)void accounts.queryOriginalAccount();else accounts.refresh('openai');}}>{t('核对结果')}</Button></>:observing?null:step===3?<>
    <dl><dt>{t('账号标识')}</dt><dd>{confirmedIdentity?.fingerprint?.slice(0,16)}</dd><dt>{t('套餐')}</dt><dd>{confirmedIdentity?.plan??t('尚未确认')}</dd></dl>
    <p>{t('接单将使用该账号的订阅额度。')}</p>
    <p>{t(!supplyCurrent?'接单选择尚未确认，请先核对，暂不能接入。':supply?.state.views.openai?.paused?'接入后保留暂停，由你决定何时恢复接单。':'接入后允许接单，账号准备完成且供给条件满足后开始。')}</p>
    {(changed||confirmation&&confirmation!==stamp())&&<p role="alert">{t('账号、来源或接单选择已变化，请重新核验后确认。')}</p>}
    {selectBlock&&<p>{t(selectBlock.message)}</p>}
    <div className="add-account-actions"><Button disabled={!confirmValid||submitted} onClick={()=>{if(!confirmValid||confirmation!==stamp()||block('select')||!supply||!supplyFresh(supply.state,'openai',Date.now())){setChanged(true);return;}setSubmitted(true);accounts.action('openai','select');}}>{t('确认接入')}</Button><Button variant="outline" disabled={busy} onClick={()=>{setScreen('connect');setKept(true);setSubmitted(false);}}>{t('返回')}</Button>{(!confirmValid||submitted)&&<Button variant="ghost" disabled={busy} onClick={()=>{setSubmitted(false);void accounts.recheckCurrentOpenai();void verify();}}>{t('重新核验')}</Button>}</div>
   </>:<>
    <p>{t(kept&&valid?'返回不会丢失已核验的账号，继续时会再次核对。':'可以通过官方客户端登录，或设置已有登录的读取位置。')}</p>
    {loginBlock&&<p>{t(loginBlock.message)}</p>}
    <div className="add-account-actions">{kept&&valid?<Button disabled={busy} onClick={()=>void verify()}>{t('继续使用此账号')}</Button>:<Button disabled={!!loginBlock||busy} onClick={()=>{initial.current=true;accounts.authorize('openai');}}>{t('登录 OpenAI')}</Button>}<Button variant="outline" disabled={busy} onClick={()=>{if(kept&&valid)setKept(false);else openSource();}}>{t(kept&&valid?'更换连接方式':'设置读取位置')}</Button><Button variant="ghost" disabled={busy} onClick={onBack}>{t('返回')}</Button>{error&&<Button variant="ghost" disabled={busy} onClick={()=>void verify()}>{t('重新核验')}</Button>}</div>
   </>}
  </div>
 </section>;
}
