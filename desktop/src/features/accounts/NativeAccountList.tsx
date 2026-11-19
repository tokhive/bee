import {useState} from 'react';
import {OpenaiAccountCard} from './OpenaiAccountCard';
import {AccountCondition} from './AccountCondition';
import {FailureNotice} from '../../components/ProblemNotice';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import {Sparkles,Check,Pause,ShieldCheck} from 'lucide-react';
import {accountPending,type AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import {platforms,supplyFresh,type SharedSupply} from '../supply/useSupply';
import {accountPresentation,accountPhase,supplyProblem,sameAccountFailure} from './accountPresentation';
import {NativeAccountActions,AccountOperationStatus} from './NativeAccountActions';
import {NativeAccountLogin,hasClaudeLogin,claudeLoginFailure} from './NativeAccountLogin';
import {NativeAccountDetails} from './NativeAccountDetails';
import {AccountQuota,AccountCheckStatus,AccountReadHistory,useAccountClock} from './AccountDisplay';
import {Badge,Button} from '../../components/ui';
import {t,formatNumber,currentLocale} from '../../i18n/index';

export function NativeAccountList({context,accounts,runtime,supply,onNavigate,navigationRequest,visiblePlatforms,deviceBlock}:{deviceBlock?:string;visiblePlatforms?:('openai'|'claude')[];navigationRequest?:NavigationRequest;context:'overview'|'accounts';onNavigate?:(target:NavigationTarget)=>void;accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply}){
 const now=useAccountClock(accounts);
 const [reviewedClaude,setReviewedClaude]=useState<string>();
 const [claudeCompareRequest,setClaudeCompareRequest]=useState(0);
 const [dismissedClaudeLogin,setDismissedClaudeLogin]=useState<string>();
 const compactList=context==='accounts'&&accounts.autoService;
 const running=runtime.view?.local==='running'&&!runtime.error&&!runtime.uncertain;
 const confirmedPlatforms=platforms.filter(p=>!!accounts.views[p]&&!accounts.errors[p]&&(!accounts.accountRefresh||!!accounts.accountRefresh[p]?.lastConfirmedAt));
 const selectedCount=confirmedPlatforms.filter(p=>accounts.views[p]?.selection.state==='selected').length;
 const countCopy=confirmedPlatforms.length===platforms.length?t('{count} 个已接入',{count:formatNumber(selectedCount,currentLocale())}):selectedCount?t('已确认接入 {count} 个，其余待确认',{count:formatNumber(selectedCount,currentLocale())}):t('接入数量待确认');
 return <section className={`native-accounts-section ${accounts.autoService?'auto-service-accounts':''} ${context==='overview'?'overview-accounts-card':''}`} aria-label={t('平台账号列表')}>
  <div className={`section-heading ${accounts.autoService&&context==='accounts'?'account-inline-check':''}`}>{(!accounts.autoService||context==='overview')&&<h2>{t('AI 账号')}</h2>}<div className="account-list-status">{!compactList&&<AccountCheckStatus supply={supply}/>}{!(accounts.autoService&&context==='accounts')&&<span>{countCopy}</span>}</div></div>
  <div className={`native-account-list ${compactList?'account-list-compact':''}`}>{compactList&&<div className="account-list-heading" aria-hidden="true"><span>{t('账号')}</span><span>{t('状态')}</span><span>{t('额度')}</span><span>{t('操作')}</span></div>}{(visiblePlatforms??platforms).map(platform=>{
   const navigate=onNavigate?((target:NavigationTarget)=>onNavigate({...target,...((target.page==='accounts'||target.page==='diagnostics')&&!target.platform?{platform}:{})})):undefined;
   if(context==='accounts'&&accounts.autoService&&platform==='openai')return <OpenaiAccountCard key={platform} accounts={accounts} runtime={runtime} supply={supply} now={now} onNavigate={navigate} navigationRequest={navigationRequest}/>;
   const snapshot=accounts.views[platform],label=platform==='openai'?'OpenAI':'Claude',dirty=!!accounts.dirty[platform];
   const readFailed=!!accounts.readFailures[platform];
   const presentation=accountPresentation(snapshot,dirty,now,readFailed,!!accounts.deviceFailure,accounts.quotaHistory[platform]),selected=snapshot?.selection.state==='selected';
   const view=supply?.state.views[platform];
   const current=!readFailed&&!!supply&&!supply.blocked&&supplyFresh(supply.state,platform,now)&&!(supply.state.operation==='write'&&supply.state.activePlatform===platform);
   const ready=current&&running&&!view!.paused&&view!.ready&&view!.reasons.length===0;
   const candidate=!dirty?snapshot?.candidate:undefined;
   const reasons=current?[...new Set(view!.reasons)].map(reason=>({reason,...supplyProblem(reason,platform)})):[];
   const localReason=readFailed?'':accountPhase(snapshot,dirty,!!accounts.busy[platform]&&!accountPending(snapshot),now);
   const copy=current?ready?'可接单':'不能接单':view||supply?.state.errors[platform]?'状态待更新':'状态待确认';
   const displaySupply=view??runtime.view?.platforms[platform].supply;
   const paused=displaySupply?.paused===true;
   const preparing=accounts.autoService&&snapshot?.authorization.state==='preparing';
   const maintenanceBlocked=paused&&!!snapshot?.login_maintenance&&snapshot.login_maintenance.phase!=='restored';
   const inlineLogin=platform==='claude'&&hasClaudeLogin(accounts)&&!(snapshot?.operation?.state==='succeeded'&&snapshot.operation.id===dismissedClaudeLogin&&!accounts.loginFlows.claude?.confirmation),loginFailure=inlineLogin?claudeLoginFailure(accounts):undefined;
   const sourceFailure=!dirty&&(accounts.sourceReadFailed[platform]??snapshot?.candidate.error);
   const sourceRepair=compactList&&selected&&!!sourceFailure&&(sourceFailure.check==='source_read'||sourceFailure.evidence.permission_denied==='true'||['source_missing','source_unavailable','permission_denied'].includes(sourceFailure.code));
   const expired=compactList&&selected&&!dirty&&!readFailed&&!!presentation.expiresAt&&Date.parse(presentation.expiresAt)<=now;
   const expiredFlow=expired&&!sourceRepair&&(!inlineLogin||!!accounts.loginFlows.claude?.confirmation)&&!accountPending(snapshot)&&!accounts.uncertain[platform];
   const loginWorkflow=compactList&&selected&&inlineLogin&&!accounts.loginFlows.claude?.confirmation;
   const compactLogin=loginWorkflow&&(snapshot?.operation?.state==='cancelled'||!!accounts.cancelUnconfirmed.claude||snapshot?.operation?.state==='reconciling');
   const loginFlow=loginWorkflow&&!compactLogin;
   const journey=platform==='claude'?accounts.claudeChange:undefined;
   const changedOperation=!!journey&&snapshot?.operation?.id===journey.operationId&&snapshot.operation.kind==='confirm_change'&&snapshot.operation.state==='succeeded'&&snapshot.operation.revision>journey.revision&&snapshot.selection.fingerprint===journey.to;
   const changeHealthy=compactList&&changedOperation&&!expired&&!sourceRepair&&!snapshot?.capabilities.some(c=>c.error&&c.error.code!=='quota_exhausted')&&!snapshot?.issues.some(i=>i.code!=='quota_exhausted')&&!dirty&&!readFailed&&!accounts.uncertain[platform]&&!accounts.errors[platform]&&!accounts.deviceFailure&&!runtime.error&&!runtime.uncertain&&!snapshot?.candidate.error&&!snapshot?.authorization.error&&!snapshot?.hive.error&&!snapshot?.operation?.error&&candidate?.fingerprint===journey?.to&&(!snapshot?.login_maintenance||snapshot.login_maintenance.phase==='restored');
   const changeComplete=changeHealthy&&current&&snapshot?.authorization.state==='synchronized'&&snapshot.authorization.fingerprint===journey?.to&&snapshot.hive.state==='ready'&&snapshot.hive.fingerprint===journey?.to;
   const changePreparing=changeHealthy&&!changeComplete&&running&&runtime.view?.connection==='connected'&&snapshot?.authorization.state==='unconfirmed';
   const preparationFlow=changePreparing||compactList&&selected&&preparing&&!inlineLogin&&snapshot?.operation?.kind!=='confirm_change';
   const repairFlow=compactList&&selected&&['reading','verifying'].includes(accounts.claudeSourcePhase??'');
   const changeOperation=compactList&&selected&&!inlineLogin&&snapshot?.operation?.kind==='confirm_change';
   const changeUnknown=changeOperation&&(snapshot.operation?.state==='reconciling'||!!accounts.uncertain[platform]);
   const changeQuery=changeUnknown&&!!accounts.busy[platform];
   const changePending=changeOperation&&!changeUnknown&&['pending','running'].includes(snapshot.operation?.state??'');
   const changeFailed=changeOperation&&snapshot.operation?.state==='failed';
   const changeCandidate=compactList&&selected&&!dirty&&!readFailed&&!accountPending(snapshot)&&!!candidate?.fingerprint&&candidate.fingerprint!==snapshot?.selection.fingerprint&&!inlineLogin&&!repairFlow;
   const changeFlow=changeCandidate&&!changeFailed;
   const expandedFlow=expiredFlow||loginFlow||preparationFlow||repairFlow||changeFlow||changePending||changeComplete;
   const sourceStore=snapshot?.candidate.source?.store??accounts.sourceFor(platform).store;
   const localErrors=!dirty?[candidate?.error,snapshot?.authorization.error,snapshot?.capabilities[0]?.error]:[];
   return <section className={`native-account-row ${compactList?'account-compact-row':''} ${expandedFlow?'claude-expired-flow openai-account oa-flow':''} ${loginFlow?'claude-login-flow':''} ${preparationFlow?'claude-preparation-flow':''} ${changeComplete?'claude-change-complete':''} ${compactLogin?'claude-compact-login-row':''}`} aria-label={t('{platform} 账号',{platform:label})} key={platform} data-account-platform={platform} data-nav-section="account" data-nav-platform={platform} tabIndex={-1}>
    <div className="native-account-identity"><span className={`platform-mark ${platform}`}>{platform==='openai'?<Sparkles aria-hidden="true"/>:<span aria-hidden="true">✳</span>}</span><div className="native-account-copy">
     <div className="native-platform-name"><h3>{label}</h3>{selected&&(!compactList||presentation.plan)&&<Badge>{presentation.plan?presentation.plan[0].toUpperCase()+presentation.plan.slice(1):t('套餐待确认')}</Badge>}</div>
     <p className="native-account-fingerprint">{presentation.identity?<><span className={context==='overview'?'sr-only':undefined}>{t(changeUnknown?'原账号':compactList?'已接入账号':'账号标识')}{compactList?' ':': '}</span><span>{presentation.identity}</span></>:accounts.autoService&&snapshot?candidate?.fingerprint?t('候选账号：{identity}',{identity:candidate.fingerprint.slice(0,16)}):t('通过官方客户端登录'):snapshot?t('尚未接入 {platform} 账号',{platform:label}):t('账号状态尚未确认')}</p>
     {compactList&&!expandedFlow&&selected&&sourceStore&&<p className="native-account-fingerprint">{t(sourceStore==='keychain'||sourceStore==='keyring'?'系统钥匙串':sourceStore==='file'?'本地文件':'自动读取')}</p>}
     {accounts.autoService?(compactList||context==='overview'?null:<AccountCondition deviceBlock={deviceBlock} accounts={accounts} platform={platform} runtime={runtime} supply={supply} onNavigate={navigate} now={now} inlineFailure={loginFailure}/>):<>
     <AccountReadHistory accounts={accounts} platform={platform}/>
     <p className={`native-account-condition ${ready?'is-ready':''}`}>{ready?<Check aria-hidden="true"/>:<Pause aria-hidden="true"/>}{t(copy)}{context==='accounts'&&selected&&!running&&current&&paused&&<span className="account-paused">{t('已暂停')}</span>}</p>
     {localReason&&<p className="native-account-reason">{t(localReason)}</p>}
     {current&&!running&&!view!.reasons.includes('offline')&&<p className="native-account-reason">{t('贡献尚未启动')}</p>}
     {reasons.length>0&&<ul className="native-account-reasons">{reasons.map(problem=><li key={problem.reason}><span>{t(problem.summary,{platform:label})}</span><p>{t(problem.impact)}</p>{problem.target&&navigate&&<Button variant="ghost" onClick={()=>navigate(problem.target!)}>{t(problem.target.section==='connection'?'查看连接':problem.target.section==='source'?'检查凭证来源':'查看账号详情')}</Button>}</li>)}</ul>}
     {[...new Map([...localErrors,snapshot?.hive.error].filter(e=>!!e).filter(e=>!sameAccountFailure(e,loginFailure)).map(e=>[JSON.stringify([e.code,e.check,e.evidence,e.message]),e])).entries()].map(([key,e])=><FailureNotice key={key} failure={e} check="source_read" onNavigate={navigate}/>)}
     {snapshot?.issues.filter(issue=>!current||!view!.reasons.includes(issue.code)&&!view!.reasons.includes(`${platform==='openai'?'codex':'claude'}_${issue.code}`)).map((issue,i)=><FailureNotice key={`${issue.code}:${i}`} failure={{...issue,check:'account_issue',evidence:{}}} check="account_issue" onNavigate={navigate}/>)}
     {!inlineLogin&&<AccountOperationStatus hideProgress={changePending||changeUnknown||changeFailed} accounts={accounts} platform={platform} onNavigate={navigate} conditionErrors={accounts.autoService}/>}
     {supply?.state.errors[platform]&&!sameAccountFailure(supply.state.errors[platform],accounts.sharedFailure)&&<FailureNotice failure={supply.state.errors[platform]} check="supply_read" onNavigate={navigate}/>}
     </>}
     {accounts.autoService&&!inlineLogin&&!preparationFlow&&!repairFlow&&(snapshot?.login_maintenance&&snapshot.login_maintenance.phase!=='restored'||snapshot?.operation&&snapshot.operation.state!=='succeeded')&&<AccountOperationStatus hideProgress={changePending||changeUnknown||changeFailed} accounts={accounts} platform={platform} onNavigate={navigate} conditionErrors={accounts.autoService}/>}
    </div></div>
    {(changeFlow||changePending||changePreparing||changeComplete)&&<ol className="oa-steps" aria-label={t('Claude 当前流程')}>{['核对账号','确认换号','准备接单'].map((label,index)=><li key={label} className={index<(changeComplete?3:changePreparing?2:changePending||reviewedClaude===candidate?.fingerprint?1:0)?'done':index===(changeComplete?3:changePreparing?2:changePending||reviewedClaude===candidate?.fingerprint?1:0)?'current':''} aria-current={index===(changeComplete?3:changePreparing?2:changePending||reviewedClaude===candidate?.fingerprint?1:0)?'step':undefined}><span className="oa-step-dot" aria-hidden="true">{index+1}</span><span>{t(label)}</span></li>)}</ol>}
    {repairFlow&&<ol className="oa-steps" aria-label={t('Claude 当前流程')}>{['修复读取','核验账号'].map((label,index)=>{const step=accounts.claudeSourcePhase==='verifying'?1:0;return <li key={label} className={index<step?'done':index===step?'current':''} aria-current={index===step?'step':undefined}><span className="oa-step-dot" aria-hidden="true">{index+1}</span><span>{t(label)}</span></li>;})}</ol>}
    {preparationFlow&&!changePreparing&&<ol className="oa-steps" aria-label={t('Claude 当前流程')}><li className="done"><span className="oa-step-dot" aria-hidden="true">1</span><span>{t('确认接入')}</span></li><li className="current" aria-current="step"><span className="oa-step-dot" aria-hidden="true">2</span><span>{t('准备接单')}</span></li></ol>}
    {expiredFlow&&<ol className="oa-steps" aria-label={t('Claude 当前流程')}><li className="current" aria-current="step"><span className="oa-step-dot" aria-hidden="true">1</span><span>{t('重新登录')}</span></li><li><span className="oa-step-dot" aria-hidden="true">2</span><span>{t('核验账号')}</span></li></ol>}
    {(compactList||context==='overview'&&accounts.autoService)&&<div className="account-list-condition">{changeComplete&&<><p className="native-account-condition" role="status">{t('账号更换成功')}</p><p className="account-action-help">{t(paused?'已更换账号，接单保持暂停。':'账号已更换，接单状态以当前核对结果为准。')}</p></>}{(changePending||changeUnknown)&&<><p className="native-account-condition" role="status">{t(changeQuery?'正在核对换号结果…':changeUnknown?'换号结果待核对':'正在更换账号…')}</p><p className="account-action-help">{t(changeUnknown?'暂时无法确认是否已更换，请核对后再继续。':'正在等待本次更换结果。')}{paused&&<> {t('接单保持暂停。')}</>}</p></>}{changeFlow&&<><p className="native-account-condition" role="status">{t('发现不同账号')}</p><p className="account-action-help">{t('确认换号前，Bee 保留已接入账号。')}</p></>}{repairFlow&&<><p className="native-account-condition" role="status">{t(accounts.claudeSourcePhase==='reading'?'正在读取登录凭证…':'正在核验账号…')}</p><p className="account-action-help">{t(accounts.claudeSourcePhase==='reading'?'设置已保存；尚未确认读取或修复成功。':'凭证读取已完成，正在核验身份。')}{paused&&<> {t('接单保持暂停。')}</>}</p></>}{preparationFlow&&<><p className="native-account-condition" role="status">{t('正在准备接单…')}</p><p className="account-action-help">{t('准备期间临时停止派单；这不改变你的接单选择。')}{paused&&<> {t('接单保持暂停。')}</>}</p></>}<AccountCondition workflow={loginWorkflow||preparationFlow||repairFlow||changeFlow||changePending||changeUnknown||changeComplete} compact={compactList} deviceBlock={deviceBlock} accounts={accounts} platform={platform} runtime={runtime} supply={supply} onNavigate={navigate} now={now} inlineFailure={loginFailure}/></div>}
    {compactList?(selected&&!preparationFlow&&!changeComplete?<AccountQuota presentation={presentation} list historical={!!accounts.sourceReadFailed[platform]||!!snapshot?.candidate.error}/>:null):(!deviceBlock||platform==='openai')&&(!accounts.autoService||selected)&&<AccountQuota presentation={presentation}/>}
    <div className="native-account-row-actions">
     {compactList&&accounts.sharedFailure&&onNavigate&&<Button onClick={()=>onNavigate({page:'overview',section:'device'})}>{t('前往概览')}</Button>}
     {changeComplete&&<Button onClick={()=>accounts.dismissClaudeChange()}>{t('完成')}</Button>}
     {changeUnknown&&<Button disabled={!!accounts.busy[platform]||!!accounts.writeBusy[platform]} onClick={()=>accounts.refresh(platform)}>{t(changeQuery?'正在核对…':'核对结果')}</Button>}
     {context==='overview'&&!selected&&onNavigate&&<Button variant="outline" onClick={()=>onNavigate({page:'accounts',platform})}>{t('前往接入')}</Button>}
     {!changeComplete&&!changePending&&!changeUnknown&&!loginWorkflow&&!repairFlow&&(changeCandidate?<Button onClick={()=>{setReviewedClaude(candidate?.fingerprint??undefined);setClaudeCompareRequest(value=>value+1);}}>{t('核对账号变更')}</Button>:sourceRepair&&navigate?<Button onClick={()=>navigate({page:'accounts',section:'source',platform})}>{t('修改凭证读取设置')}</Button>:context==='accounts'&&<NativeAccountActions repairAuthorization={expired}  accounts={accounts} platform={platform} runtime={runtime} placement="row" onNavigate={navigate}/>)}
     {!changeComplete&&!changePending&&!changeUnknown&&!loginWorkflow&&!repairFlow&&!changeCandidate&&!sourceRepair&&!expired&&!(preparationFlow&&paused)&&selected&&supply&&(!supply.state.errors[platform]||context==='overview'&&supply.state.errors[platform]?.check!=='supply_write')&&(running||context==='overview'&&!!displaySupply)&&<Button variant={accounts.autoService&&!preparationFlow&&(compactList||paused||context==='overview'&&platform==='openai'&&ready)&&!deviceBlock?"default":"outline"} disabled={!!deviceBlock||!running||preparing&&!preparationFlow||maintenanceBlocked||!current||!!accounts.uncertain[platform]||!supply.model.canWrite(platform,!paused)} onClick={()=>{if(current)void supply.model.write(platform,!paused);}}>{t(preparing&&!preparationFlow?'正在准备账号…':supply.state.writeBusy&&supply.state.pendingChoices?.[platform]!==undefined?supply.state.pendingChoices[platform]?'暂停中…':'恢复中…':supply.state.writeBusy&&supply.state.activePlatform===platform?'正在更新接单选择…':paused?'恢复接单':'暂停接单')}</Button>}
     {!changeComplete&&!changePending&&!changeUnknown&&!loginWorkflow&&!repairFlow&&!changeCandidate&&!preparationFlow&&!sourceRepair&&!expired&&!deviceBlock&&running&&selected&&supply&&!supply.state.errors[platform]&&!(supply.state.writeBusy&&supply.state.pendingChoices?.[platform]!==undefined)&&(maintenanceBlocked||!current||!!accounts.uncertain[platform]||!supply.model.canWrite(platform,!paused))&&<p className="account-action-help">{t(maintenanceBlocked?'此平台的登录维护尚未完成，请先核对维护结果。':!current?'当前平台接单状态待核对，暂不能修改暂停。':accounts.uncertain[platform]?'账号操作结果待核对，暂不能修改暂停。':'当前平台操作条件不满足，请先处理账号与供给阻塞。')}</p>}
     {preparationFlow&&paused&&<p className="account-action-help">{t('接单选择：已暂停；准备就绪后可恢复。')}</p>}
     {context==='accounts'&&<NativeAccountDetails compareRequest={platform==='claude'?claudeCompareRequest:undefined} flow={expandedFlow} compact={compactList} navigationRequest={navigationRequest} onNavigate={onNavigate} accounts={accounts} platform={platform} runtime={runtime} supply={supply}/>}
    </div>
    {changeUnknown&&<details className="claude-change-record"><summary>{t('查看核对记录')}</summary><AccountOperationStatus accounts={accounts} platform={platform} conditionErrors/><AccountReadHistory accounts={accounts} platform={platform}/></details>}
    {inlineLogin&&<NativeAccountLogin compact={compactLogin} onDismiss={()=>{if(snapshot?.operation?.state==='succeeded'){setDismissedClaudeLogin(snapshot.operation.id);accounts.dismissLogin(platform);}}} expanded={loginFlow} accounts={accounts} runtime={runtime} onNavigate={navigate}/>}
   </section>;
  })}</div>
  <p className="native-accounts-footnote"><ShieldCheck aria-hidden="true"/>{t('授权信息保留在本机')}</p>
 </section>;
}
