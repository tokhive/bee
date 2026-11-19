import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowRight,Sparkle} from 'lucide-react';
import {Button,Badge} from '../../components/ui';
import {FailureNotice} from '../../components/ProblemNotice';
import {DetailSheet} from '../../components/DetailSheet';
import {presentFailure} from '../../presentation/problems';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {accountConfirmationKey} from '../../system/accounts';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {supplyFresh,type SharedSupply} from '../supply/useSupply';
import {accountPending,type AccountsModel} from './useAccounts';
import {accountActionBlock,accountPresentation,sameAccountFailure,supplyProblem,loginMaintenanceCopy,type AccountAction} from './accountPresentation';
import {AccountErrorPopover} from './AccountErrorPopover';
import {AccountQuota,AccountReadHistory} from './AccountDisplay';
import {t,currentLocale} from '../../i18n/index';
import './openai-account.css';

function ErrorEvidence({error}:{error:UiFailure}){return <pre className="oa-error-evidence">{presentFailure(error,currentLocale()).details}</pre>;}

type Props={accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;navigationRequest?:NavigationRequest;onNavigate?:(target:NavigationTarget)=>void;now:number};
function OpenaiAction({accounts,runtime,action,label,onConfirmationChange,onSubmitted}:{accounts:AccountsModel;runtime:RuntimeModel;action:AccountAction;label:string;onConfirmationChange?:(open:boolean)=>void;onSubmitted?:()=>void}){
 const view=accounts.views.openai;
 const [confirmation,setConfirmation]=useState<{stamp:string;target?:string|null;selected?:string|null}>();
 const [invalid,setInvalid]=useState(false);
 useEffect(()=>{onConfirmationChange?.(confirmation!==undefined);return()=>onConfirmationChange?.(false);},[confirmation!==undefined,onConfirmationChange]);
 useEffect(()=>{
  if(!confirmation)return;
  const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setConfirmation(undefined);}};
  window.addEventListener('keydown',dismiss,true);return()=>window.removeEventListener('keydown',dismiss,true);
 },[confirmation]);
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),accounts.sourceFor('openai'),runtime.view?.local,runtime.view?.run_id]);
 const block=()=>accountActionBlock(action,{autoService:true,view,platform:'openai',now:Date.now(),dirty:!!accounts.dirty.openai,busy:!!accounts.writeBusy.openai||accounts.sourceSaving,unknown:!!accounts.uncertain.openai||!!accounts.readFailures.openai,submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults,runtime:runtime.view,runtimeBlocked:!!runtime.error||runtime.uncertain||runtime.stalled});
 const reason=block();
 return <Dialog.Root open={confirmation!==undefined} onOpenChange={open=>{if(!open)setConfirmation(undefined);}}>
  <div><Dialog.Trigger asChild><Button variant="outline" disabled={!!reason} onClick={()=>{setInvalid(false);setConfirmation({stamp:stamp(),target:view?.candidate.fingerprint,selected:view?.selection.fingerprint});}}>{t(label)}</Button></Dialog.Trigger>{reason&&<p className="oa-help">{t(reason.message)}</p>}</div>
  <Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={`dialog-content${action==='authorize'?' openai-login-confirm':''}`} onEscapeKeyDown={event=>{event.preventDefault();event.stopImmediatePropagation();setConfirmation(undefined);}}>
   {action==='authorize'&&<Dialog.Close asChild><Button variant="ghost" className="openai-login-close">{t('关闭')}</Button></Dialog.Close>}
   <Dialog.Title>{t(action==='clear_selection'?'取消接入':action==='select'?'接入 OpenAI 账号':action==='confirm_change'?'确认更换 OpenAI 账号':view?.selection.state==='selected'?'重新登录 OpenAI':'登录 OpenAI')}</Dialog.Title>
   <Dialog.Description>{t(action==='clear_selection'?'仅取消尚未在 Hive 注册的本地选择；不会移除已注册的 Hive 账号。':action==='authorize'?'调用已安装的 Codex 官方客户端，可能改变客户端当前登录账号。':'接单将使用该账号的订阅额度。')}</Dialog.Description>
   {action==='authorize'?<p className="openai-login-impact">{t(view?.selection.state==='selected'?'将暂停此平台接单，已有请求可继续收尾。登录后仍暂停；不同账号需另行确认换号。':'登录后核验账号，由你确认是否接入 Bee。接入保留已有接单选择。')}</p>:action==='clear_selection'?null:<>
    <dl className="account-detail-facts">{action==='confirm_change'&&<div><dt>{t('已接入账号')}</dt><dd>{confirmation?.selected?.slice(0,16)}</dd></div>}<div><dt>{t('目标账号')}</dt><dd>{confirmation?.target?.slice(0,16)??t('尚未确认')}</dd></div></dl>
    <p>{t(action==='confirm_change'?'更换后使用新账号的订阅额度。将暂停此平台接单，准备就绪后仍暂停，由你恢复。':'准备期间临时停止派单，完成后保留你的最新接单选择。')}</p>
   </>}
   {(invalid||confirmation?.stamp!==stamp())&&<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={(invalid||confirmation?.stamp!==stamp())||!!reason} onClick={()=>{if((invalid||confirmation?.stamp!==stamp())||block()){setInvalid(true);return;}setConfirmation(undefined);if(action==='authorize')accounts.authorize('openai');else accounts.action('openai',action);onSubmitted?.();}}>{t(action==='clear_selection'?'确认取消接入':action==='select'?'确认接入':action==='confirm_change'?'确认更换':'开始官方登录')}</Button></div>
  </Dialog.Content></Dialog.Portal>
 </Dialog.Root>;
}

export function OpenaiAccountCard({accounts,runtime,supply,navigationRequest,onNavigate,now}:Props){
 const view=accounts.views.openai,journey=accounts.openaiJourney;
 const selected=view?.selection.state==='selected',candidate=!accounts.dirty.openai&&view?.candidate.state==='available'&&!!view.candidate.reference;
 const different=selected&&candidate&&!!view.candidate.fingerprint&&view.candidate.fingerprint!==view.selection.fingerprint;
 const op=view?.operation,maintenance=view?.login_maintenance;
 const query=accounts.loginProgress,progress=query&&query.id===op?.id?query.value:undefined;
 const liveLogin=op?.kind==='authorize'&&['pending','running'].includes(op.state);
 const cleaning=progress?.phase==='cleaning_up';
 const cancelUnknown=liveLogin&&!!accounts.cancelUnconfirmed.openai;
 const supplyView=supply?.state.views.openai;
 const supplyCurrent=!!supply&&!supply.blocked&&supplyFresh(supply.state,'openai',now)&&!(supply.state.operation==='write'&&supply.state.activePlatform==='openai');
 const current=supplyCurrent&&!accounts.readFailures.openai&&!runtime.error&&!runtime.uncertain;
 const ready=current&&runtime.view?.local==='running'&&runtime.view.connection==='connected'&&supplyView?.ready&&!supplyView.paused&&supplyView.reasons.length===0;
 const preparing=view?.authorization.state==='preparing'||!!view&&['pending','running'].includes(op?.state??'')&&op?.kind!=='authorize';
 const problems:UiFailure[]=[];
 for(const value of [accounts.sharedFailure,accounts.cancelUnconfirmed.openai?.failure,accounts.errors.openai,accounts.sourceReadFailed.openai,accounts.loginOpenError,progress?.blocker,maintenance?.error,op?.error,view?.candidate.error,view?.authorization.error,view?.hive.error,...view?.capabilities.map(c=>c.error)??[],supply?.state.errors.openai,runtime.view?.local==='failed'?runtime.view.operation?.error:null]){
  if(value&&value.code!=='quota_exhausted'){const error=normalizeFailure(value,'account_operation');if(!problems.some(previous=>sameAccountFailure(previous,error)))problems.push(error);}
 }
 for(const issue of view?.issues??[])if(issue.code!=='quota_exhausted'&&!problems.some(error=>error.code===issue.code&&error.message===issue.message))problems.push(normalizeFailure(issue,'account_issue'));
 const sourceProblem=problems.find(p=>p.check==='source_read'||p.evidence.permission_denied==='true'||['source_missing','source_unavailable','permission_denied'].includes(p.code));
 const problem=accounts.loginOpenError??sourceProblem??problems[0];
 const reasons=selected&&supplyCurrent?[...new Set(supplyView?.reasons??[])].filter(reason=>reason!=='manually_paused'&&!(sourceProblem&&reason==='codex_source_unavailable')&&!(different&&reason==='codex_confirmation_required')):[];
 const uncertain=!!accounts.uncertain.openai||op?.state==='reconciling';
 const observing=problem?.code==='operation_pending';
 const failed=!!problem&&!observing;
 const intakeOperation=op?.kind==='select'||op?.kind==='confirm_change';
 const confirmationUnsent=op?.kind==='confirm_change'&&op.state==='reconciling'&&op.error?.code==='confirmation_not_submitted';
 const intakeUnconfirmed=intakeOperation&&!confirmationUnsent&&(uncertain||!!op&&['pending','running','reconciling'].includes(op.state));
 const preparationFailed=selected&&intakeOperation&&!intakeUnconfirmed&&failed&&!confirmationUnsent&&(view.authorization.state!=='synchronized'||view.hive.state!=='ready');
 const presentation=accountPresentation(view,!!accounts.dirty.openai,now,!!accounts.readFailures.openai,!!accounts.deviceFailure,accounts.quotaHistory.openai);
 const credentialExpired=selected&&candidate&&!accounts.readFailures.openai&&!!presentation.expiresAt&&Date.parse(presentation.expiresAt)<=now;
 const sameFlow=!!journey&&!!op&&op.id===journey.operationId&&op.state==='succeeded'&&op.revision>journey.revision;
 const restored=!maintenance||maintenance.phase==='restored';
 const repairVerified=journey?.kind==='repair'&&!accounts.dirty.openai&&candidate&&view.capabilities.some(c=>c.origin==='official'&&c.status==='ready'&&!!c.valid_until&&Date.parse(c.valid_until)>now);
 const canComplete=!!view&&!credentialExpired&&!failed&&!different&&!uncertain&&restored&&selected&&current&&view.authorization.state==='synchronized'&&view.hive.state==='ready'&&(sameFlow||repairVerified);
 useEffect(()=>{if(canComplete&&!journey?.completed&&view?.selection.fingerprint)accounts.completeOpenai(view.selection.fingerprint);},[canComplete,journey?.completed,view?.selection.fingerprint]);
 useEffect(()=>{if(journey?.completed&&(problem||different||accounts.deviceFailure))accounts.dismissOpenai();},[journey?.completed,problem,different,accounts.deviceFailure]);
 const completion=!!journey?.completed&&canComplete&&journey.completed===view?.selection.fingerprint;
 const [nestedConfirmation,setNestedConfirmation]=useState(false);
 const [details,setDetails]=useState(false),[panel,setPanel]=useState<'detail'|'settings'|'compare'|'install'>('detail'),sourceField=useRef<HTMLInputElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const source=accounts.openaiDraft??accounts.sourceFor('openai');
 const defaults=accounts.defaults?.platforms.find(p=>p.platform==='openai');
 const sourceBlocked=accountPending(view)||!!accounts.uncertain.openai||!!accounts.writeBusy.openai||accounts.sourceSaving;
 useEffect(()=>{const target=navigationRequest?.target;if(target?.page==='accounts'&&(target.platform??'openai')==='openai'&&['source','account'].includes(target.section??'')){returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPanel(target.section==='source'?'settings':'detail');setDetails(true);}},[navigationRequest?.sequence]);
 useEffect(()=>{if(details&&panel==='settings'){if(!accounts.openaiDraft)accounts.setOpenaiDraft(accounts.sourceFor('openai'));sourceField.current?.focus();}},[details,panel,navigationRequest?.sequence]);
 const retryPreparation=async()=>{
  await accounts.recheckCurrentOpenai();
  if(!runtime.startBlocked&&['stopped','failed'].includes(runtime.view?.local??''))await runtime.start([]);
 };
 let title='尚未登录 OpenAI',note='通过已安装的 Codex 官方客户端登录。';
 if(!view||view.candidate.state==='not_checked'){title='账号状态尚未确认';note='正在读取账号状态…';}
 else if(selected){title=ready?'可接单':!current?'账号状态待更新':supplyView?.paused?'已暂停':reasons.length?supplyProblem(reasons[0],'openai').summary:'正在更新账号状态…';note=current&&supplyView?.paused?'':ready?'':current&&reasons.length?supplyProblem(reasons[0],'openai').impact:'连接恢复且其他条件满足后，按你的接单选择继续。';}
 else if(candidate){title=journey?.kind==='first'?'已识别账号，请确认是否接入':'尚未接入 Bee';note='接单会使用此账号的订阅额度。';}
 if(selected&&current&&!supplyView?.paused&&reasons.length===1&&reasons[0]==='quota_exhausted'){
  title=accounts.busy.openai&&presentation.quotaState==='stale'?'正在核验额度…':'额度已耗尽';
  note='';
 }
 if(credentialExpired){title='授权已过期';note='需要通过官方客户端重新授权。';}
 if(different){title='发现不同账号';note='确认换号前，Bee 保留已接入账号。';}
 if(accounts.dirty.openai||accounts.sourceSaving){title=accounts.sourceSaving?'正在保存设置…':'正在读取登录凭证…';note='设置保存后，Bee 将重新读取并核验账号。';}
 if(preparing){title=op?.kind==='confirm_change'?'正在更换账号…':selected?'正在准备接单…':'正在接入账号…';note='准备期间临时停止派单；这不改变你的接单选择。';}
 if(liveLogin){title=cleaning?'正在取消登录…':progress?.phase==='verifying'?'正在核验账号…':progress?.phase==='waiting_authorization'?'等待完成 OpenAI 登录':'正在启动登录…';note=cleaning?'正在结束本次登录，请稍候。':progress?.phase==='verifying'?'官方登录已完成，正在读取并核验本次身份。':progress?.phase==='waiting_authorization'?'请在浏览器中完成登录，Bee 随后自动核验账号。':'Bee 正在启动 Codex，请稍候。';}
 if(observing&&!liveLogin&&!preparing){title='正在核验账号…';note='正在读取最新账号状态，完成后自动更新。';}
 if(op?.kind==='authorize'&&op.state==='cancelled'&&!journey?.completed){title='已取消登录';note='已确认本次流程结束；已发生的官方授权不会因此撤销。';}
 if(uncertain&&!liveLogin){title='账号操作结果待核对';note='尚未取得原操作的确定结果，不能据此再次提交。';}
 if(failed&&(!liveLogin||accounts.loginOpenError)){title=accounts.loginOpenError?'无法打开登录页面':sourceProblem?(sourceProblem.code==='source_missing'&&sourceProblem.check==='read_keyring'?'钥匙串中未找到 Codex 登录项':presentFailure(sourceProblem,currentLocale()).summary):problem?.check==='official_identity'?'无法核验账号':problem?.check==='official_process_cleanup'?'尚未确认登录进程已结束':problem?.code==='client_missing'?'未找到 Codex 官方客户端':problem?.code==='expired'?'登录已过期':op?.kind==='authorize'?'官方登录未完成':op?.kind==='confirm_change'?'更换账号未完成':op?.kind==='select'?'接入账号未完成':'无法更新账号状态';note='';}
 if(failed&&problem&&sameAccountFailure(problem,supply?.state.errors.openai)&&!liveLogin){const failure=presentFailure(problem,currentLocale());title=failure.summary;note=failure.impact??'';}
 if(accounts.sharedFailure&&!liveLogin&&!sourceProblem&&!intakeUnconfirmed){const shared=presentFailure(accounts.sharedFailure,currentLocale());title=shared.summary;note=shared.impact??'';}
 if(preparationFailed&&!liveLogin&&!sourceProblem){
  const cause=view.authorization.error??view.hive.error??op?.error??problem;
  title=presentFailure(normalizeFailure(cause,'account_operation'),currentLocale()).summary;
  note='账号已接入。请在问题解除后重试准备，无需重新确认接入。';
 }
 if(intakeUnconfirmed){title=op?.kind==='confirm_change'?'换号结果待核对':'暂时无法确认接入结果';note='尚未取得原操作的确定结果；只核对本次操作，不会重复提交。';}
 if(sourceProblem?.code==='source_missing'&&sourceProblem.check==='read_keyring'&&!accounts.sourceSaving&&!accounts.dirty.openai){title='凭证缺失';note='钥匙串中未找到 Codex 登录项';}
 if(query?.phase==='stopped'&&liveLogin){title='暂时无法确认登录进度';note=query.reason==='retry_exhausted'?'查询重试已用尽。可以手动核对本次原操作。':'自动查询已停止。可以手动核对本次原操作。';}
 if(op?.kind==='authorize'&&op.state==='failed'&&problem?.code==='authorization_timeout'){title='登录已超时';note='本次登录已超时。';}
 if(op?.kind==='authorize'&&op.state==='failed'&&problem?.code==='client_missing'){title='未找到 Codex';note='请安装 Codex 官方客户端，再返回重试。';}
 if(accounts.loginOpenError&&liveLogin){note='系统未能打开浏览器，请重试。';}
 if(accounts.openingLogin&&liveLogin){title='正在打开登录页面…';note='';}
 if(cancelUnknown){title='暂时无法确认取消结果';note='Bee 正在继续核对本次登录是否已结束。';}
 if(completion){title=journey.kind==='change'?'账号更换成功':journey.kind==='repair'?'账号读取已修复':journey.kind==='relogin'?'重新登录成功':'账号接入成功！';note=(journey.kind==='change'?'已更换账号':journey.kind==='repair'?'已读取并核验账号':journey.kind==='relogin'?'已完成重新登录':'账号已接入')+(supplyView?.paused?'，接单保持暂停。':ready?'，可以接单了。':'，等待接单条件恢复。');}
 const kind=different?'change':journey?.kind??(preparationFailed||preparing?(op?.kind==='confirm_change'?'change':'intake'):undefined);
 const steps=kind==='first'?['登录','核验账号','确认接入','准备接单']:kind==='intake'?['确认接入','准备接单']:kind==='change'?['核对账号','确认换号','准备接单']:kind==='repair'?['修复读取','核验账号']:kind==='relogin'?['重新登录','核验账号']:[];
 if(preparing&&(kind==='repair'||kind==='relogin'))steps.push('准备接单');
 let step=completion?steps.length:kind==='first'?liveLogin?(progress?.phase==='verifying'?1:0):candidate&&!selected?2:selected?3:0:kind==='change'?preparing?2:journey?.kind==='change'?1:0:kind==='intake'?selected?1:0:preparing?2:accounts.dirty.openai||liveLogin&&progress?.phase!=='verifying'?0:1;
 if(kind==='relogin'&&op?.state==='failed')step=['official_source_recheck','official_namespace','official_source_revision'].includes(problem?.check??'')?1:0;
 const confirmedLoginProgress=liveLogin&&progress?.operation.id===op?.id&&['starting','waiting_authorization','verifying'].includes(progress.phase)&&!accounts.cancelUnconfirmed.openai;
 const showSteps=!!steps.length&&!sourceProblem&&!cleaning&&!cancelUnknown&&op?.state!=='cancelled'&&(!uncertain||confirmedLoginProgress)&&!intakeUnconfirmed;
 const pauseInNote=!completion&&selected&&supplyCurrent&&supplyView?.paused&&title!=='已暂停';
 if(pauseInNote&&!note.includes('暂停'))note+=(note?' ':'')+'接单保持暂停。';
 const requestedPause=supply?.state.pendingChoices?.openai;
 if(supply?.state.writeBusy&&requestedPause!==undefined){title=requestedPause?'正在暂停接单…':'正在恢复接单…';note=requestedPause?'确认暂停后不再接收新任务，已有任务可继续完成。':'正在解除暂停；完成后仍需满足额度等接单条件。';}
 const accountDetails=<DetailSheet overlayClassName={`openai-detail-overlay${nestedConfirmation?' account-confirmation-background':''}`} contentClassName={nestedConfirmation?'account-confirmation-background':undefined} onEscapeKeyDown={event=>{if(nestedConfirmation)event.preventDefault();}} onOpenAutoFocus={event=>{if(panel==='settings'){event.preventDefault();sourceField.current?.focus();}}} open={details} onOpenChange={open=>{setDetails(open);if(open)setPanel('detail');}} onCloseAutoFocus={event=>{if(returnFocus.current?.isConnected){event.preventDefault();returnFocus.current.focus();returnFocus.current=null;}}} trigger={<Button variant="ghost" aria-label={t('OpenAI 详情')}>{t('账号详情')}<ArrowRight aria-hidden="true"/></Button>} title={t(panel==='settings'?'凭证读取设置':panel==='compare'?'核对账号变更':panel==='install'?'安装 Codex':'OpenAI 账号详情')} description={panel==='settings'?'':t('查看账号信息，管理凭证读取方式。')}>
    {panel==='detail'&&<><dl className="account-detail-facts"><div><dt>{t(selected?'已接入账号':'待接入账号')}</dt><dd>{presentation.identity??t('尚未接入')}</dd></div><div><dt>{t('账号状态')}</dt><dd>{t(title)}</dd></div><div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan?presentation.plan[0].toUpperCase()+presentation.plan.slice(1):t('待确认')}</dd></div>{candidate&&different&&<div><dt>{t('候选账号标识')}</dt><dd>{view.candidate.fingerprint?.slice(0,16)}</dd></div>}</dl>
    <AccountReadHistory accounts={accounts} platform="openai"/>
    {maintenance&&<p role="status">{t(loginMaintenanceCopy[maintenance.phase])}</p>}
    {op?.kind==='authorize'&&op.state==='unknown'&&<p>{t('原登录进程已中断，原登录结果未确认；账号维护状态单独核对。')}</p>}
    {maintenance?.can_recheck&&<Button variant="outline" disabled={!!accounts.busy.openai||!!accounts.writeBusy.openai} onClick={()=>accounts.refresh('openai')}>{t('核对维护结果')}</Button>}
    <div className="oa-sheet-actions"><Button variant="outline" onClick={()=>setPanel('settings')}>{t('修改凭证读取设置')}</Button><OpenaiAction onSubmitted={()=>setDetails(false)} onConfirmationChange={setNestedConfirmation} accounts={accounts} runtime={runtime} action="authorize" label="重新登录"/>{selected&&view.hive.fingerprint===null&&view.hive.generation===null&&<OpenaiAction onSubmitted={()=>setDetails(false)} onConfirmationChange={setNestedConfirmation} accounts={accounts} runtime={runtime} action="clear_selection" label="取消接入"/>}</div></>}
    {panel==='compare'&&<><dl className="account-detail-facts"><div><dt>{t('已接入账号')}</dt><dd>{view?.selection.fingerprint?.slice(0,16)}</dd></div><div><dt>{t('发现新账号')}</dt><dd>{view?.candidate.fingerprint?.slice(0,16)}</dd></div></dl><p>{t('确认换号前，Bee 保留已接入账号。')}</p><OpenaiAction onSubmitted={()=>setDetails(false)} onConfirmationChange={setNestedConfirmation} accounts={accounts} runtime={runtime} action="confirm_change" label="确认换号"/></>}
    {panel==='install'&&<><p>{t('安装 OpenAI 官方 Codex CLI，确保当前用户可运行 codex 命令，再返回 Bee 重试。')}</p><Button variant="outline" onClick={()=>setDetails(false)}>{t('返回账号页')}</Button></>}
    {panel==='settings'&&<form className="openai-source-form" data-account-source="openai" data-nav-section="source" data-nav-platform="openai" onSubmit={event=>{event.preventDefault();void accounts.saveOpenaiSource();}}>
     <label>{t('读取目录')}<input ref={sourceField} name="openai-source-directory" autoComplete="off" spellCheck={false} disabled={sourceBlocked} placeholder={defaults?.directory??t('使用 Codex 默认目录')} value={source.directory??''} onChange={event=>accounts.setOpenaiDraft({...source,directory:event.target.value||null})}/></label>
     <label>{t('存储方式')}<select name="openai-source-store" disabled={sourceBlocked||!defaults} value={source.store} onChange={event=>accounts.setOpenaiDraft({...source,store:event.target.value})}>{defaults?.stores.map(store=><option key={store.store} value={store.store} disabled={!store.supported}>{t(({auto:'自动',file:'文件',keyring:'钥匙串'} as Record<string,string>)[store.store]??store.store)}</option>)}</select></label>
     <p>{t('修改后，Bee 将重新读取并核验账号。')}</p>{sourceBlocked&&<p>{t('账号操作仍待完成或核对，暂不能修改来源；当前草稿会保留。')}</p>}
     {sourceProblem&&<FailureNotice failure={sourceProblem} check="source_read" onNavigate={onNavigate}/>}
     {accounts.sourceSaveError&&<ErrorEvidence error={normalizeFailure(accounts.sourceSaveError,'preferences_save')}/>}
     <div className="dialog-actions"><Button type="button" variant="outline" disabled={accounts.sourceSaving} onClick={()=>{accounts.setOpenaiDraft(undefined);setDetails(false);}}>{t('取消')}</Button><Button type="submit" disabled={sourceBlocked||!accounts.openaiDraft}>{t(accounts.sourceSaving?'保存中…':'保存')}</Button></div>
    </form>}
   </DetailSheet>;
 return <section className={`native-account-row openai-account ${showSteps?'oa-flow':'oa-compact'}`} aria-label={t('OpenAI 账号')} data-account-platform="openai" data-nav-section="account" data-nav-platform="openai" tabIndex={-1}>
  <div className="oa-head"><span className="oa-icon"><Sparkle aria-hidden="true"/></span><div className="oa-identity"><div className="oa-platform"><h3>OpenAI</h3>{selected&&presentation.plan&&<Badge>{presentation.plan[0].toUpperCase()+presentation.plan.slice(1)}</Badge>}</div><p>{selected?t('已接入账号 {identity}',{identity:presentation.identity??t('待确认')}):candidate?t('待接入账号 {identity}',{identity:view.candidate.fingerprint?.slice(0,16)??t('待确认')}):t('通过官方客户端登录')}</p>{selected&&!showSteps&&<p>{t('Codex 本机凭证')}</p>}</div>
   {showSteps&&accountDetails}
  </div>
  {showSteps&&<ol className="oa-steps" aria-label={t('OpenAI 当前流程')}>{steps.map((label,index)=>{const state=index<step?'done':index===step?failed?'failed':'current':'pending';return <li key={label} className={state} aria-current={state==='current'?'step':undefined}><span className="oa-step-dot" aria-hidden="true">{index+1}</span><span>{t(label)}</span><span className="sr-only">{t(state==='done'?'已完成':state==='failed'?'失败':state==='current'?'当前阶段':'未开始')}</span></li>;})}</ol>}
  <div className={`oa-body ${showSteps?'oa-with-steps':''}`}><div className="oa-status-line"><p className={`oa-title ${(failed||credentialExpired)&&!intakeUnconfirmed&&!cancelUnknown?'oa-error':completion||ready&&!observing?'oa-good':''}`} role="status">{t(title)}</p>{!completion&&!cancelUnknown&&problems.some(p=>p.code!=='operation_pending')&&<AccountErrorPopover errors={problems.filter(p=>p.code!=='operation_pending')}/>}</div>{note&&<p className="oa-note">{t(note)}</p>}</div>
  <div className="oa-actions">
   {completion?<Button onClick={accounts.dismissOpenai}>{t('完成')}</Button>:cancelUnknown?(query?.phase==='stopped'?<Button variant="outline" onClick={()=>void accounts.queryLogin()}>{t('核对登录结果')}</Button>:null):liveLogin?<>
    {progress?.actions.open&&<Button disabled={accounts.openingLogin} onClick={()=>void accounts.openLoginPage()}>{t(accounts.openingLogin?'正在打开…':accounts.loginOpenError?'重新打开登录页面':'打开登录页面')}</Button>}
    {(!progress||progress.actions.cancel)&&progress?.phase!=='verifying'&&!cleaning&&<Button variant="outline" disabled={!!accounts.writeBusy.openai} onClick={()=>accounts.cancelAuthorize('openai')}>{t('取消登录')}</Button>}
    {query?.phase==='stopped'&&<Button variant="outline" onClick={()=>void accounts.queryLogin()}>{t('刷新登录进度')}</Button>}
   </>:intakeUnconfirmed?<Button disabled={accounts.originalAccountQuery?.phase==='reading'} onClick={()=>void accounts.queryOriginalAccount()}>{t(accounts.originalAccountQuery?.phase==='reading'?'正在核对…':'核对结果')}</Button>
   :maintenance?.can_recheck&&!(different&&maintenance.phase==='confirmation_required')?<Button disabled={!!accounts.busy.openai||!!accounts.writeBusy.openai||!!progress?.recheck_in_flight} onClick={()=>accounts.refresh('openai')}>{t('核对维护结果')}</Button>
   :accounts.sharedFailure&&onNavigate?<Button onClick={()=>onNavigate({page:'overview',section:'device'})}>{t('前往概览')}</Button>
   :sourceProblem?<Button onClick={()=>{setPanel('settings');setDetails(true);}}>{t('修改凭证读取设置')}</Button>
   :op?.kind==='authorize'&&['cancelled','failed'].includes(op.state)&&(!problem||['authorization_timeout','authorization_process_failed'].includes(problem.code))?<OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="重新登录"/>
   :credentialExpired||problem?.code==='expired'?<OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="重新登录"/>
   :problem?.code==='client_missing'?<><Button onClick={()=>{setPanel('install');setDetails(true);}}>{t('查看安装说明')}</Button><OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="重试"/></>
   :different?<Button onClick={()=>{setPanel('compare');setDetails(true);}}>{t('核对账号变更')}</Button>
   :preparationFailed?<Button disabled={!!accounts.busy.openai||runtime.busy||runtime.startBlocked} onClick={()=>void retryPreparation()}>{t('重试')}</Button>
   :accounts.uncertain.openai||accounts.accountRefresh?.openai?.state==='blocked'||!!supply?.state.errors.openai?<Button disabled={!!accounts.busy.openai||supply?.state.busy} onClick={()=>void accounts.recheckCurrentOpenai()}>{t(accounts.uncertain.openai?'核对结果':'重新核对')}</Button>
   :failed&&!accountPending(view)?<Button disabled={!!accounts.busy.openai} onClick={()=>accounts.detect('openai','official')}>{t('重新核验')}</Button>
   :candidate&&!selected?<OpenaiAction accounts={accounts} runtime={runtime} action="select" label="接入账号"/>
   :!selected&&!accountPending(view)?<OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="登录 OpenAI"/>
   :selected&&!accountPending(view)&&supply?<Button disabled={observing||!current||!supply.model.canWrite('openai',!supplyView?.paused)} onClick={()=>void supply.model.write('openai',!supplyView?.paused)}>{t(supply.state.writeBusy&&requestedPause!==undefined?requestedPause?'暂停中…':'恢复中…':supply.state.writeBusy&&supply.state.activePlatform==='openai'?'正在更新接单选择…':supplyView?.paused?'恢复接单':'暂停接单')}</Button>:null}
   {!showSteps&&accountDetails}
  </div>
  {!completion&&intakeUnconfirmed&&accounts.originalAccountQuery?.phase==='stopped'&&<p className="oa-evidence" role="status">{t(accounts.originalAccountQuery.reason==='time_limit'?'自动核对已达 60 秒，尚未确认原操作结果。':'本轮查询已停止，尚未确认原操作结果。')}</p>}
  {!pauseInNote&&!completion&&selected&&supplyCurrent&&supplyView?.paused&&title!=='已暂停'&&<p className="oa-evidence">{t('接单保持暂停。')}</p>}
  {!completion&&reasons.filter(reason=>!['quota_exhausted','quota_unknown'].includes(reason)).map(reason=>{const condition=supplyProblem(reason,'openai');return <div className="oa-evidence" key={reason}>{condition.summary!==title&&<span>{t(condition.summary,{platform:'OpenAI'})}</span>}{condition.target&&onNavigate&&<Button variant="ghost" onClick={()=>onNavigate(condition.target!)}>{t('查看相关设置')}</Button>}</div>;})}
  {cancelUnknown&&<details className="oa-evidence"><summary>{t('查看核对记录')}</summary><ErrorEvidence error={accounts.cancelUnconfirmed.openai!.failure}/></details>}
  {!completion&&!cancelUnknown&&!!query?.error&&<details className="oa-evidence"><summary>{t('查看核对记录')}</summary><ErrorEvidence error={normalizeFailure(query.error,'authorize_progress')}/></details>}
  {!completion&&intakeUnconfirmed&&!!accounts.originalAccountQuery?.error&&<details className="oa-evidence"><summary>{t('查看核对记录')}</summary><ErrorEvidence error={normalizeFailure(accounts.originalAccountQuery.error,'account_original_query')}/></details>}
  {!completion&&<div className="oa-quota"><AccountQuota presentation={presentation} list historical={!!sourceProblem||!!accounts.readFailures.openai}/></div>}
 </section>;
}
