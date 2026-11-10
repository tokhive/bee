import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowRight,Sparkle} from 'lucide-react';
import {Button,Badge} from '../../components/ui';
import {DetailSheet} from '../../components/DetailSheet';
import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {accountConfirmationKey} from '../../system/accounts';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {supplyFresh,type SharedSupply} from '../supply/useSupply';
import {accountPending,type AccountsModel} from './useAccounts';
import {accountActionBlock,accountPresentation,sameAccountFailure,supplyProblem,type AccountAction} from './accountPresentation';
import {AccountQuota,AccountReadHistory} from './AccountDisplay';
import {t} from '../../i18n/index';
import './openai-account.css';

type Props={accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;navigationRequest?:NavigationRequest;onNavigate?:(target:NavigationTarget)=>void;now:number};
function OpenaiAction({accounts,runtime,action,label}:{accounts:AccountsModel;runtime:RuntimeModel;action:AccountAction;label:string}){
 const view=accounts.views.openai;
 const [confirmation,setConfirmation]=useState<string>();
 const stamp=()=>JSON.stringify([accountConfirmationKey(view,Date.now()),accounts.sourceFor('openai'),runtime.view?.local,runtime.view?.run_id]);
 const block=()=>accountActionBlock(action,{autoService:true,view,platform:'openai',now:Date.now(),dirty:!!accounts.dirty.openai,busy:!!accounts.writeBusy.openai||accounts.sourceSaving,unknown:!!accounts.uncertain.openai,submissionBlocked:accounts.submissionBlocked,sharedReadFailure:accounts.sharedReadFailure,defaultsReady:!!accounts.defaults,runtime:runtime.view,runtimeBlocked:!!runtime.error||runtime.uncertain||runtime.stalled});
 const reason=block();
 return <Dialog.Root open={confirmation!==undefined} onOpenChange={open=>{if(!open)setConfirmation(undefined);}}>
  <div><Dialog.Trigger asChild><Button disabled={!!reason} onClick={()=>setConfirmation(stamp())}>{t(label)}</Button></Dialog.Trigger>{reason&&<p className="oa-help">{t(reason.message)}</p>}</div>
  {confirmation!==undefined&&<Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content">
   <Dialog.Title>{t(action==='select'?'接入 OpenAI 账号':action==='confirm_change'?'确认更换 OpenAI 账号':'登录 OpenAI')}</Dialog.Title>
   <Dialog.Description>{t(action==='authorize'?'调用已安装的 Codex 官方客户端，可能改变客户端当前登录账号。':'接单将使用该账号的订阅额度。')}</Dialog.Description>
   {action==='authorize'?<p>{t(view?.selection.state==='selected'?'将暂停此平台接单，已有请求可继续收尾。登录后仍暂停；不同账号需另行确认换号。':'登录后核验账号，由你确认是否接入 Bee。接入保留已有接单选择。')}</p>:<>
    <dl className="account-detail-facts">{action==='confirm_change'&&<div><dt>{t('已接入账号')}</dt><dd>{view?.selection.fingerprint?.slice(0,16)}</dd></div>}<div><dt>{t('目标账号')}</dt><dd>{view?.candidate.fingerprint?.slice(0,16)??t('尚未确认')}</dd></div></dl>
    <p>{t(action==='confirm_change'?'更换后使用新账号的订阅额度。将暂停此平台接单，准备就绪后仍暂停，由你恢复。':'准备期间临时停止派单，完成后保留你的最新接单选择。')}</p>
   </>}
   {confirmation!==stamp()&&<p role="alert">{t('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t('取消')}</Button></Dialog.Close><Button disabled={confirmation!==stamp()||!!reason} onClick={()=>{if(confirmation!==stamp()||block())return;setConfirmation(undefined);if(action==='authorize')accounts.authorize('openai');else accounts.action('openai',action);}}>{t(action==='select'?'确认接入':action==='confirm_change'?'确认更换':'开始官方登录')}</Button></div>
  </Dialog.Content></Dialog.Portal>}
 </Dialog.Root>;
}

export function OpenaiAccountCard({accounts,runtime,supply,navigationRequest,onNavigate,now}:Props){
 const view=accounts.views.openai,journey=accounts.openaiJourney;
 const selected=view?.selection.state==='selected',candidate=!accounts.dirty.openai&&view?.candidate.state==='available'&&!!view.candidate.reference;
 const different=selected&&candidate&&view.candidate.identity_verified&&!!view.candidate.fingerprint&&view.candidate.fingerprint!==view.selection.fingerprint;
 const op=view?.operation,maintenance=view?.login_maintenance;
 const query=accounts.loginProgress,progress=query&&query.id===op?.id?query.value:undefined;
 const liveLogin=op?.kind==='authorize'&&['pending','running'].includes(op.state);
 const cleaning=progress?.phase==='cleaning_up'||liveLogin&&!!accounts.cancelUnconfirmed.openai;
 const supplyView=supply?.state.views.openai;
 const supplyCurrent=!!supply&&!supply.blocked&&supplyFresh(supply.state,'openai',now)&&!(supply.state.operation==='write'&&supply.state.activePlatform==='openai');
 const current=supplyCurrent&&!accounts.readFailures.openai&&!runtime.error&&!runtime.uncertain;
 const ready=current&&runtime.view?.local==='running'&&runtime.view.connection==='connected'&&supplyView?.ready&&!supplyView.paused&&supplyView.reasons.length===0;
 const preparing=view?.authorization.state==='preparing'||!!view&&['pending','running'].includes(op?.state??'')&&op?.kind!=='authorize';
 const problems:UiFailure[]=[];
 for(const value of [accounts.errors.openai,accounts.sourceReadFailed.openai,accounts.loginOpenError,progress?.blocker,maintenance?.error,op?.error,view?.candidate.error,view?.authorization.error,view?.hive.error,...view?.capabilities.map(c=>c.error)??[],supply?.state.errors.openai,runtime.view?.local==='failed'?runtime.view.operation?.error:null]){
  if(value){const error=normalizeFailure(value,'account_operation');if(!problems.some(previous=>sameAccountFailure(previous,error)))problems.push(error);}
 }
 for(const issue of view?.issues??[])if(!problems.some(error=>error.code===issue.code&&error.message===issue.message))problems.push(normalizeFailure(issue,'account_issue'));
 const sourceProblem=problems.find(p=>p.check==='source_read'||p.evidence.permission_denied==='true'||['source_missing','source_unavailable','permission_denied'].includes(p.code));
 const problem=accounts.loginOpenError??sourceProblem??problems[0];
 const reasons=supplyCurrent?[...new Set(supplyView?.reasons??[])].filter(reason=>reason!=='manually_paused'&&!(sourceProblem&&reason==='codex_source_unavailable')):[];
 const uncertain=!!accounts.uncertain.openai||op?.state==='reconciling';
 const failed=!!problem;
 const presentation=accountPresentation(view,!!accounts.dirty.openai,now,!!accounts.readFailures.openai,!!accounts.deviceFailure);
 const sameFlow=!!journey&&!!op&&op.id===journey.operationId&&op.state==='succeeded'&&op.revision>journey.revision;
 const restored=!maintenance||maintenance.phase==='restored';
 const repairVerified=journey?.kind==='repair'&&!accounts.dirty.openai&&candidate&&view.candidate.identity_verified&&view.capabilities.some(c=>c.origin==='official'&&c.status==='ready'&&!!c.valid_until&&Date.parse(c.valid_until)>now);
 const canComplete=!!view&&!failed&&!different&&!uncertain&&restored&&selected&&current&&view.authorization.state==='synchronized'&&view.hive.state==='ready'&&(sameFlow||repairVerified);
 useEffect(()=>{if(canComplete&&!journey?.completed&&view?.selection.fingerprint)accounts.completeOpenai(view.selection.fingerprint);},[canComplete,journey?.completed,view?.selection.fingerprint]);
 useEffect(()=>{if(journey?.completed&&(problem||different||accounts.deviceFailure))accounts.dismissOpenai();},[journey?.completed,problem,different,accounts.deviceFailure]);
 const completion=!!journey?.completed&&canComplete&&journey.completed===view?.selection.fingerprint;
 const [details,setDetails]=useState(false),sourceField=useRef<HTMLInputElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const source=accounts.openaiDraft??accounts.sourceFor('openai');
 const defaults=accounts.defaults?.platforms.find(p=>p.platform==='openai');
 const sourceBlocked=accountPending(view)||!!accounts.uncertain.openai||!!accounts.writeBusy.openai||accounts.sourceSaving;
 useEffect(()=>{const target=navigationRequest?.target;if(target?.page==='accounts'&&(target.platform??'openai')==='openai'&&['source','account'].includes(target.section??'')){returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setDetails(true);}},[navigationRequest?.sequence]);
 useEffect(()=>{if(details&&navigationRequest?.target.section==='source'){sourceField.current?.focus();}},[details,navigationRequest?.sequence]);
 let title='尚未登录 OpenAI',note='通过已安装的 Codex 官方客户端登录。';
 if(!view){title='账号状态尚未确认';note='正在读取账号状态…';}
 else if(selected){title=ready?'可接单':!current?'账号状态待更新':reasons.length?supplyProblem(reasons[0],'openai').summary:supplyView?.paused?'已暂停':'正在更新账号状态…';note=current&&supplyView?.paused?'不再接收新任务；已有任务可继续完成。':ready?'':'连接恢复且其他条件满足后，按你的接单选择继续。';}
 else if(candidate){title=journey?.kind==='first'?'已识别账号，请确认是否接入':'尚未接入 Bee';note='接单会使用此账号的订阅额度。';}
 if(different){title='发现不同账号';note='确认换号前，Bee 保留已接入账号。';}
 if(accounts.dirty.openai||accounts.sourceSaving){title=accounts.sourceSaving?'正在保存设置…':'正在读取登录凭证…';note='设置保存后，Bee 将重新读取并核验账号。';}
 if(preparing){title=op?.kind==='confirm_change'?'正在更换账号…':selected?'正在准备接单…':'正在接入账号…';note='准备期间临时停止派单；这不改变你的接单选择。';}
 if(liveLogin){title=cleaning?'正在取消登录…':progress?.phase==='verifying'?'正在核验账号…':progress?.phase==='waiting_authorization'?'等待完成 OpenAI 登录':'正在获取登录链接…';note=cleaning?'正在结束本次登录，请稍候。':progress?.phase==='verifying'?'官方登录已完成，正在读取并核验本次身份。':'请在浏览器中完成登录，Bee 随后自动核验账号。';}
 if(op?.kind==='authorize'&&op.state==='cancelled'&&!journey?.completed){title='已取消登录';note='已确认本次流程结束；已发生的官方授权不会因此撤销。';}
 if(uncertain&&!liveLogin){title='账号操作结果待核对';note='尚未取得原操作的确定结果，不能据此再次提交。';}
 if(failed){title=accounts.loginOpenError?'无法打开登录页面':sourceProblem?'无法读取登录凭证':problem?.check==='official_identity'?'无法核验账号':problem?.check==='official_process_cleanup'?'尚未确认登录进程已结束':op?.kind==='authorize'?'官方登录未完成':op?.kind==='confirm_change'?'更换账号未完成':op?.kind==='select'?'接入账号未完成':'无法更新账号状态';note=problem?.message??'';}
 if(query?.phase==='stopped'&&liveLogin){title='暂时无法确认登录进度';note=query.reason==='retry_exhausted'?'查询重试已用尽。可以手动核对本次原操作。':'自动查询已停止。可以手动核对本次原操作。';}
 if(completion){title=journey.kind==='change'?'账号更换成功':journey.kind==='repair'?'账号读取已修复':journey.kind==='relogin'?'重新登录成功':'账号接入成功！';note=(journey.kind==='change'?'已更换账号':journey.kind==='repair'?'已读取并核验账号':journey.kind==='relogin'?'已完成重新登录':'账号已接入')+(supplyView?.paused?'，接单保持暂停。':ready?'，可以接单了。':'，等待接单条件恢复。');}
 const kind=different?'change':journey?.kind;
 const steps=kind==='first'?['登录','核验账号','确认接入','准备接单']:kind==='intake'?['确认接入','准备接单']:kind==='change'?['核对账号','确认换号','准备接单']:kind==='repair'?['修复读取','核验账号']:kind==='relogin'?['重新登录','核验账号']:[];
 const step=completion?steps.length:kind==='first'?liveLogin?(progress?.phase==='verifying'?1:0):candidate&&!selected?2:selected?3:0:kind==='change'?preparing?2:journey?.kind==='change'?1:0:kind==='intake'?selected?1:0:accounts.dirty.openai||liveLogin&&progress?.phase!=='verifying'?0:1;
 const showSteps=!!steps.length&&!cleaning&&op?.state!=='cancelled'&&!uncertain;
 return <section className="native-account-row openai-account" aria-label={t('OpenAI 账号')} data-account-platform="openai" data-nav-section="account" data-nav-platform="openai" tabIndex={-1}>
  <div className="oa-head"><span className="oa-icon"><Sparkle aria-hidden="true"/></span><div className="oa-identity"><div className="oa-platform"><h3>OpenAI</h3>{selected&&presentation.plan&&<Badge>{presentation.plan[0].toUpperCase()+presentation.plan.slice(1)}</Badge>}</div><p>{selected?t('已接入账号 {identity}',{identity:presentation.identity??t('待确认')}):candidate?t('待接入账号 {identity}',{identity:view.candidate.fingerprint?.slice(0,16)??t('待确认')}):t('通过官方客户端登录')}</p></div>
   <DetailSheet open={details} onOpenChange={setDetails} onCloseAutoFocus={event=>{if(returnFocus.current?.isConnected){event.preventDefault();returnFocus.current.focus();returnFocus.current=null;}}} trigger={<Button variant="ghost" aria-label={t('OpenAI 详情')}>{t('详情')}<ArrowRight aria-hidden="true"/></Button>} title={t('OpenAI 账号详情')} description={t('查看账号信息，管理凭证读取方式。')}>
    <dl className="account-detail-facts"><div><dt>{t('当前账号标识')}</dt><dd>{presentation.identity??t('尚未接入')}</dd></div><div><dt>{t('订阅套餐')}</dt><dd>{presentation.plan??t('待确认')}</dd></div>{candidate&&different&&<div><dt>{t('候选账号标识')}</dt><dd>{view.candidate.fingerprint?.slice(0,16)}</dd></div>}</dl>
    <AccountReadHistory accounts={accounts} platform="openai"/>
    <form className="account-source" data-account-source="openai" onSubmit={event=>{event.preventDefault();void accounts.saveOpenaiSource();}}><h3>{t('凭证读取设置')}</h3>
     <label>{t('读取目录')}<input ref={sourceField} name="openai-source-directory" autoComplete="off" spellCheck={false} disabled={sourceBlocked} placeholder={defaults?.directory??t('使用 Codex 默认目录')} value={source.directory??''} onChange={event=>accounts.setOpenaiDraft({...source,directory:event.target.value||null})}/></label>
     <label>{t('存储方式')}<select name="openai-source-store" disabled={sourceBlocked||!defaults} value={source.store} onChange={event=>accounts.setOpenaiDraft({...source,store:event.target.value})}>{defaults?.stores.map(store=><option key={store.store} value={store.store} disabled={!store.supported}>{t(({auto:'自动',file:'文件',keyring:'钥匙串'} as Record<string,string>)[store.store]??store.store)}</option>)}</select></label>
     <p>{t('修改后，Bee 将重新读取并核验账号。')}</p>{sourceBlocked&&<p>{t('账号操作仍待完成或核对，暂不能修改来源；当前草稿会保留。')}</p>}
     {accounts.sourceSaveError&&<FailureNotice failure={accounts.sourceSaveError} check="preferences_save"/>}
     <div className="dialog-actions"><Button type="button" variant="outline" disabled={accounts.sourceSaving} onClick={()=>{accounts.setOpenaiDraft(undefined);setDetails(false);}}>{t('取消')}</Button><Button type="submit" disabled={sourceBlocked||!accounts.openaiDraft}>{t(accounts.sourceSaving?'保存中…':'保存')}</Button></div>
    </form><OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="重新登录"/>
   </DetailSheet>
  </div>
  {showSteps&&<ol className="oa-steps" aria-label={t('OpenAI 当前流程')}>{steps.map((label,index)=>{const state=index<step?'done':index===step?failed?'failed':'current':'pending';return <li key={label} className={state} aria-current={state==='current'?'step':undefined}><span className="oa-step-dot" aria-hidden="true">{index+1}</span><span>{t(label)}</span><span className="sr-only">{t(state==='done'?'已完成':state==='failed'?'失败':state==='current'?'当前阶段':'未开始')}</span></li>;})}</ol>}
  <div className={`oa-body ${showSteps?'oa-with-steps':''}`}><p className={`oa-title ${failed?'oa-error':completion||ready?'oa-good':''}`} role="status">{t(title)}</p>{note&&<p className="oa-note">{t(note)}</p>}</div>
  <div className="oa-actions">
   {completion?<Button onClick={accounts.dismissOpenai}>{t('完成')}</Button>:liveLogin?<>
    {progress?.actions.open&&<Button disabled={accounts.openingLogin} onClick={()=>void accounts.openLoginPage()}>{t(accounts.openingLogin?'正在打开…':'打开登录页面')}</Button>}
    {(!progress||progress.actions.cancel)&&progress?.phase!=='verifying'&&!cleaning&&<Button variant="outline" disabled={!!accounts.writeBusy.openai} onClick={()=>accounts.cancelAuthorize('openai')}>{t('取消登录')}</Button>}
    {query?.phase==='stopped'&&<Button variant="outline" onClick={()=>void accounts.queryLogin()}>{t('刷新登录进度')}</Button>}
   </>:different&&!sourceProblem?<OpenaiAction accounts={accounts} runtime={runtime} action="confirm_change" label="核对账号变更"/>:candidate&&!selected&&!sourceProblem?<OpenaiAction accounts={accounts} runtime={runtime} action="select" label="接入账号"/>:!selected&&!accountPending(view)&&!sourceProblem?<OpenaiAction accounts={accounts} runtime={runtime} action="authorize" label="登录 OpenAI"/>:selected&&!failed&&!accountPending(view)&&supply&&<Button disabled={!current||!!accounts.uncertain.openai||!supply.model.canWrite('openai',!supplyView?.paused)} onClick={()=>void supply.model.write('openai',!supplyView?.paused)}>{t(supplyView?.paused?'恢复接单':'暂停接单')}</Button>}
   {!completion&&!liveLogin&&!accounts.uncertain.openai&&accounts.accountRefresh?.openai?.state==='blocked'&&<Button variant="outline" disabled={!!accounts.busy.openai} onClick={()=>void accounts.recheckCurrentOpenai()}>{t('重新查询状态')}</Button>}
   {!completion&&accounts.originalAccountQuery?.phase==='stopped'&&<Button variant="outline" onClick={()=>void accounts.queryOriginalAccount()}>{t('核对结果')}</Button>}
   {!completion&&sourceProblem&&<Button onClick={()=>setDetails(true)}>{t('修改凭证读取设置')}</Button>}
   {!completion&&maintenance?.can_recheck&&<Button variant="outline" disabled={!!accounts.busy.openai||!!accounts.writeBusy.openai||!!progress?.recheck_in_flight} onClick={()=>accounts.refresh('openai')}>{t('核对维护结果')}</Button>}
   {!completion&&failed&&!sourceProblem&&!liveLogin&&!accountPending(view)&&!accounts.uncertain.openai&&<Button variant="outline" disabled={!!accounts.busy.openai} onClick={()=>accounts.detect('openai','official')}>{t('重新核验')}</Button>}
  </div>
  {!completion&&accounts.originalAccountQuery?.phase==='stopped'&&<p className="oa-evidence" role="status">{t(accounts.originalAccountQuery.reason==='time_limit'?'自动核对已达 60 秒，尚未确认原操作结果。':'本轮查询已停止，尚未确认原操作结果。')}</p>}
  {!completion&&selected&&supplyCurrent&&supplyView?.paused&&title!=='已暂停'&&<p className="oa-evidence">{t('接单保持暂停。')}</p>}
  {!completion&&reasons.length>0&&<details className="oa-evidence"><summary>{t('查看接单条件')}</summary>{reasons.map(reason=>{const condition=supplyProblem(reason,'openai');return <div key={reason}><p>{t(condition.summary,{platform:'OpenAI'})}</p><p>{t(condition.impact)}</p>{condition.target&&onNavigate&&<Button variant="outline" onClick={()=>onNavigate(condition.target!)}>{t('查看相关设置')}</Button>}</div>;})}</details>}
  {!completion&&problems.length>0&&<details className="oa-evidence"><summary>{t('查看错误详情')}</summary>{problems.map((error,index)=><FailureNotice key={index} failure={error} check={error.check} onNavigate={onNavigate}/>)}</details>}
  {!completion&&!!query?.error&&<details className="oa-evidence"><summary>{t('查看核对记录')}</summary><FailureNotice failure={normalizeFailure(query.error,'authorize_progress')} check="authorize_progress"/></details>}
  {!completion&&!!accounts.originalAccountQuery?.error&&<details className="oa-evidence"><summary>{t('查看核对记录')}</summary><FailureNotice failure={accounts.originalAccountQuery.error} check="account_original_query"/></details>}
  {!completion&&selected&&!showSteps&&!failed&&!liveLogin&&!uncertain&&reasons.every(reason=>['quota_exhausted','quota_unknown','rate_limited','concurrency_full'].includes(reason))&&<div className="oa-quota"><AccountQuota presentation={presentation}/><details><summary>{t('额度详情')}</summary><AccountQuota presentation={presentation} resets/><p>{t('额度与暂停选择独立。')}</p></details></div>}
 </section>;
}
