import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Dialog,DropdownMenu} from 'radix-ui';
import {currentLocale,formatDate} from '../../i18n/index';
import {Button} from '../../components/ui';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import type {DeviceView,DeviceRecoveryView,DeviceContext,RecoveryDecision} from '../../system/device';
import type {RefreshStatus} from '../../system/desktopState';
import {validateHive,WizardFailure} from './FirstLaunchWizard';
import {wizardText as w} from './first-launch-copy';
import {deviceProblem} from './devicePresentation';
import {DeviceFeedback} from './DeviceFeedback';
import './binding-repair.css';

function DeviceMenuIcon(){return <svg viewBox="0 0 16 16" aria-hidden="true" style={{fill:'currentColor',stroke:'none'}}><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg>;}
const phaseCopy:Record<DeviceRecoveryView['phase'],string>={
 awaiting_confirmation:'请重新绑定',creating:'正在创建配对请求',creation_unknown:'绑定结果尚未确认',pending:'等待网页确认',
 draining:'正在完成重新绑定',redeeming:'正在完成设备替换',redemption_unknown:'绑定结果尚未确认',
 awaiting_owner_confirmation:'新设备归属与原设备不同',saving:'正在保存设备绑定',completed:'设备已重新绑定',expired:'Hive 已确认配对码过期',blocked:'设备绑定暂时无法继续',
};
export interface DevicePairingProps {
 embedded?:boolean;transactionIntro?:ReactNode;transactionDetails?:ReactNode;extraActions?:ReactNode;title?:string;inputDraft?:{hive:string;name:string;hiveReadOnly?:boolean;setHive:(value:string)=>void;setName:(value:string)=>void};
 switchFeedback?:ReactNode;switchControl?:ReactNode;switchStatus?:ReactNode;statusControl?:ReactNode;startupNotice?:ReactNode;
 retryConnection?:()=>Promise<unknown>;onSwitchHive?:()=>void;switching?:boolean;cancelOperation?:string;repair?:()=>Promise<void>;repairResult?:'healthy'|'restored';
 view?:DeviceView;context?:DeviceContext;recovery?:DeviceRecoveryView;recoveryError?:UiFailure|null;refreshStatus?:RefreshStatus;
 busy:boolean;checking?:boolean;initialLoading?:boolean;error:UiFailure|null;reportedFailure?:UiFailure|null;operationError?:UiFailure|null;
 onNavigate?:(target:NavigationTarget)=>void;canRefresh?:boolean;recoveryStart?:(hive:string,name:string)=>Promise<void>;
 begin:(hive:string,name:string)=>void;refresh:()=>void|Promise<unknown>;open:()=>void;recover?:(decision:RecoveryDecision,transaction?:DeviceRecoveryView)=>Promise<boolean>;
}
/** Presents native receipts only. Opening a web page never approves or completes a binding. */
export function DevicePairingPage({embedded=false,transactionIntro,transactionDetails,extraActions,view,context,recovery,recoveryError,refreshStatus,busy:writing,checking=false,initialLoading=false,error,reportedFailure,operationError,begin,refresh,open,recover,recoveryStart,onNavigate,canRefresh=true,switchFeedback,switchControl,switchStatus,statusControl,startupNotice,onSwitchHive,switching=false,repair,repairResult,inputDraft,title,cancelOperation,retryConnection}:DevicePairingProps){
 const [localHive,setLocalHive]=useState(''),[localName,setLocalName]=useState('Bee Desktop');
 const hive=inputDraft?.hive??localHive,name=inputDraft?.name??localName,setHive=inputDraft?.setHive??setLocalHive,setName=inputDraft?.setName??setLocalName;
 const [now,setNow]=useState(Date.now()),[copied,setCopied]=useState(''),[copyError,setCopyError]=useState<UiFailure|null>(null);
 const [querying,setQuerying]=useState(false),[cancelSubmitting,setCancelSubmitting]=useState(false),[repairChecking,setRepairChecking]=useState(false);
 const [menuOpen,setMenuOpen]=useState(false),[progressOpen,setProgressOpen]=useState(false);
 const afterMenuClose=useRef<(()=>void)|null>(null);
 const mounted=useRef(true),copyAttempt=useRef(0);
 const progressTrigger=useRef<HTMLButtonElement>(null);
 const [confirmation,setConfirmation]=useState<{decision:RecoveryDecision;transaction?:DeviceRecoveryView}|null>(null),[submitted,setSubmitted]=useState(false);
 const section=useRef<HTMLElement>(null),menuTrigger=useRef<HTMLButtonElement>(null),confirmationTrigger=useRef<HTMLButtonElement|null>(null),failureFocus=useRef<HTMLDivElement>(null);
 const busy=writing||checking||initialLoading||querying||cancelSubmitting||repairChecking;
 const transaction=recovery??view?.recovery;
 const initialPairing=transaction?.purpose==='initial_pairing';
 const phase=transaction?.phase??(view?.state==='pending'||view?.state==='draining'||view?.state==='expired'?view.state:undefined);
 const cancelled=phase==='blocked'&&transaction?.failure?.code==='PAIRING_CLOSED';
 const active=!!phase&&phase!=='completed'&&!cancelled;
 const savePermissionDenied=phase==='saving'&&!!transaction?.failure&&/(?:EACCES|PermissionDenied|permission denied)/i.test(transaction.failure.message)&&/(?:save|writ|config)/i.test(transaction.failure.message);
 const paused=transaction?.failure?.code==='PAIRING_OBSERVATION_PAUSED';
 const admin=transaction?.failure?.code==='PAIRING_ADMIN_REQUIRED'||transaction?.failure?.code==='RECOVERY_EVIDENCE_UNRESOLVED';
 const pairing=phase==='completed'||cancelled?null:transaction?.pairing??(view?.user_code&&view.verification_url&&view.expires_at?{code:view.user_code,verification_url:view.verification_url,expires_at:view.expires_at}:null);
 const locallyExpired=phase==='pending'&&!!pairing&&Date.parse(pairing.expires_at)<=now;
 const identity=view?.identity??(phase==='completed'?transaction?.new_identity:transaction?.old_identity);
 const address=view?.hive??context?.hive??hive,deviceName=identity?.name??context?.name??name;
 const issue=error??reportedFailure??recoveryError;
 const credentialFault=!!issue&&['device_replaced','invalid_device_credential','DEVICE_CONTEXT_INVALID'].includes(issue.code);
 const confirmed=view?.state==='bound'&&!issue&&!active;
 const cancelling=active&&(cancelSubmitting||transaction?.cancel_requested===true||!!cancelOperation&&cancelOperation===transaction?.operation_id);
 const unknown=active&&['creation_unknown','redemption_unknown'].includes(phase!);
 const problem=issue?deviceProblem(normalizeFailure(issue,'device_binding')):null;
 const canCancel=!embedded&&!cancelling&&!!transaction&&!!recover&&active&&!['saving','awaiting_owner_confirmation','awaiting_confirmation'].includes(phase!);
 const failures=[...new Map([issue,recoveryError,operationError,transaction?.failure].filter((f):f is UiFailure=>!!f&&!['PAIRING_CLOSED','PAIRING_OBSERVATION_PAUSED','PAIRING_WORK_PENDING'].includes(f.code)).map(f=>[JSON.stringify([f.code,f.message]),normalizeFailure(f,'device_binding')])).values()];
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;copyAttempt.current++;};},[]);
 useEffect(()=>{if(inputDraft&&view?.state==='bound')return;if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 useEffect(()=>{if(!pairing)return;setNow(Date.now());const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[pairing?.expires_at]);
 useEffect(()=>{copyAttempt.current++;setCopied('');setCopyError(null);},[address,transaction?.operation_id,pairing?.code]);
 useEffect(()=>{if(submitted&&operationError)failureFocus.current?.focus();},[submitted,operationError]);
 const ask=(trigger:HTMLButtonElement,decision:RecoveryDecision,record=transaction)=>{confirmationTrigger.current=trigger;setSubmitted(false);setConfirmation({decision,transaction:record});};
 const submit=async()=>{if(!confirmation||busy||!recover)return;const request=confirmation;setSubmitted(true);if(request.decision==='cancel_pairing'){setCancelSubmitting(true);setConfirmation(null);}try{const ok=await recover(request.decision,request.transaction);if(ok)setConfirmation(value=>value===request?null:value);}finally{if(mounted.current)setCancelSubmitting(false);}};
 const copy=async(value:string,label:string)=>{const attempt=++copyAttempt.current;setCopyError(null);setCopied('');try{if(!navigator.clipboard?.writeText)throw Error('clipboard.writeText unavailable; select and copy the displayed value manually');await navigator.clipboard.writeText(value);if(mounted.current&&attempt===copyAttempt.current)setCopied(label);}catch(cause){if(mounted.current&&attempt===copyAttempt.current)setCopyError(normalizeFailure(cause,'clipboard_write'));}};
 const doRepair=(trigger:HTMLButtonElement)=>{if(cancelled){ask(trigger,'restart_pairing');return;}if(active){section.current?.querySelector<HTMLElement>('.device-transaction')?.focus();check();return;}if(repair){setRepairChecking(true);void repair().finally(()=>{if(mounted.current)setRepairChecking(false);});}else if(recoveryStart&&address)void recoveryStart(address,deviceName);else if(recover){confirmationTrigger.current=trigger;setSubmitted(false);setConfirmation({decision:'begin_pairing'});}};
 const check=()=>{if(!busy&&canRefresh)refresh();};
 const recheck=async(trigger?:HTMLButtonElement)=>{if(busy||!canRefresh)return;setQuerying(true);try{if(recover&&transaction&&active&&phase!=='saving')await recover('continue_checking',transaction);else if(problem?.action==='retry'&&retryConnection)await retryConnection();else await refresh();}finally{if(mounted.current){setQuerying(false);requestAnimationFrame(()=>{if(mounted.current)(trigger?.isConnected?trigger:section.current?.previousElementSibling instanceof HTMLElement?section.current.previousElementSibling:section.current)?.focus({preventScroll:true});});}}};
 const headline=repairChecking?'修复设备绑定':cancelSubmitting?'正在取消重新绑定':querying?(!active&&problem?.action==='retry'?'正在连接 Hive':cancelling?'正在核对取消结果…':active?'正在核对绑定结果…':'正在核对 Hive 状态…'):checking?'正在连接 Hive':cancelling?'取消结果尚未确认':cancelled?'设备尚未恢复贡献':!active&&problem?problem.title:locallyExpired?'配对码有效期已到':paused&&!embedded?(initialPairing?'设备绑定尚未完成':'重新绑定尚未完成'):phase==='saving'&&transaction?.failure?'绑定已完成，本机保存失败':phase==='pending'?(embedded?'等待目标 Hive 网页确认':'在 Hive 网页确认设备'):phase==='completed'&&!transaction?.old_identity?'设备已绑定':active?(initialPairing&&phase==='awaiting_confirmation'?'请绑定设备':phaseCopy[phase!]):problem?.title??'无法确认设备状态';
 const feedback=!issue&&repairResult?(repairResult==='healthy'?'设备绑定正常。':'设备绑定已恢复，接单选择保留。'):!issue&&phase==='completed'?'设备绑定已保存。':cancelled?'重新绑定已取消。':'';
 const progressMenu=canCancel&&!querying&&!checking&&<DropdownMenu.Root open={progressOpen} onOpenChange={setProgressOpen}><DropdownMenu.Trigger asChild><Button ref={progressTrigger} variant="ghost" size="icon" aria-label={w('重新绑定操作')}><DeviceMenuIcon/></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="device-actions-menu" align="end" sideOffset={4}><DropdownMenu.Item onSelect={event=>{event.preventDefault();setProgressOpen(false);ask(progressTrigger.current!,'cancel_pairing');}}>{w('取消重新绑定')}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
 const showConfirmationUrl=embedded||!!copyError||failures.some(f=>f.code.startsWith('BROWSER_')||f.check==='browser_open');
 const expiryLabel=pairing&&new Date(pairing.expires_at).toDateString()===new Date(now).toDateString()?new Intl.DateTimeFormat(currentLocale(),{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(pairing.expires_at)):pairing?formatDate(pairing.expires_at,currentLocale()):'';
 return <>{switchFeedback}{feedback&&<DeviceFeedback id={`${transaction?.operation_id??address}:${feedback}`} message={feedback}/>}<section ref={section} tabIndex={-1} className={embedded?"device-pairing device-pairing-embedded":"native-device-summary device-pairing device-card"} aria-label={w(title??'设备与 Hive')}>
  {!embedded&&<div className="device-card-heading"><h2>{w(title??'设备与 Hive')}</h2>
   {onSwitchHive&&<DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}><DropdownMenu.Trigger asChild><Button ref={menuTrigger} data-device-menu variant="ghost" size="icon" aria-label={w('设备操作')} aria-busy={checking}><DeviceMenuIcon/></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="device-actions-menu" align="end" sideOffset={4} collisionPadding={12} onCloseAutoFocus={event=>{const action=afterMenuClose.current;if(action){event.preventDefault();afterMenuClose.current=null;queueMicrotask(action);}}}>
    <DropdownMenu.Item disabled={busy||active||switching} onSelect={event=>{event.preventDefault();afterMenuClose.current=onSwitchHive;setMenuOpen(false);}}>{w('切换 Hive')}</DropdownMenu.Item>
    {active&&<p>{w('当前修复结束后可切换 Hive')}</p>}
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
  </div>}
  {switchControl}
  {statusControl}
  {switchStatus}
  {(active||cancelled||issue||checking)&&!initialLoading&&!switching&&<div className="device-transaction" tabIndex={-1}>
   <div className="device-transaction-heading"><h3 className="pairing-phase" aria-live="polite">{w(headline)}</h3>
    {phase!=='pending'&&progressMenu}
   </div>
   {((checking&&!querying)||querying&&!active&&problem?.action==='retry')&&<p role="status">{w(repairChecking?'正在检查原绑定…':'正在重试连接…')}</p>}
   {cancelSubmitting&&<p role="status">{w('正在取消…')}</p>}
   {!querying&&!checking&&!cancelSubmitting&&<>
   {transactionIntro}
   {!querying&&!cancelling&&pairing&&(phase==='pending'||phase==='expired')&&<div className="binding-pairing-code"><p>{w('配对码')}</p><div><strong className="pair-code">{pairing.code}</strong>{!embedded&&<Button variant="ghost" onClick={()=>void copy(pairing.code,'配对码已复制')}>{w('复制')}</Button>}</div>{(!embedded||phase!=='pending'||locallyExpired)&&<small>{w(phase==='expired'?'Hive 已确认配对码过期':Date.parse(pairing.expires_at)<=now?'有效期已到，请重新获取配对码。':'有效期至')}{phase!=='expired'&&Date.parse(pairing.expires_at)>now&&' '+expiryLabel}</small>}{embedded&&phase==='pending'&&!locallyExpired&&<span>{w('· 仅在目标 Hive 确认，不更改当前 Hive。')}</span>}</div>}
   {!embedded&&!querying&&!cancelling&&phase==='pending'&&<p>{w(transaction?.old_identity?'请登录原设备所属的 Hive 账号，核对配对码和旧设备后，确认重新绑定。':'请登录 Hive 账号，核对配对码后，确认设备归属。')}</p>}
   {phase==='awaiting_confirmation'&&<p>{w(initialPairing?'请在 Hive 网页核对配对码，确认设备归属。':'请在 Hive 网页核对配对码与原设备，确认重新绑定。')}</p>}
   {!querying&&!cancelling&&((phase==='pending'||phase==='awaiting_confirmation')&&!!recovery&&!initialPairing||phase==='awaiting_owner_confirmation')&&<p className="repair-impact">{w('重新绑定完成后，需要重新接入 AI 账号。')}</p>}
   {phase==='awaiting_owner_confirmation'&&transaction&&<><dl className="recovery-identities"><div><dt>{w('原归属账号')}</dt><dd>{transaction.old_identity?.owner_email??w('待核对')}</dd></div><div><dt>{w('新归属账号')}</dt><dd>{transaction.new_identity?.owner_email}</dd></div></dl><p>{w('采用新归属后，旧账号选择与运行意图不会迁移。')}</p></>}
   {phase==='draining'&&<div className="repair-progress" role="status"><p>{w(admin?'Hive 无法确认旧设备的任务处理记录。':'正在等待旧设备的任务、结算和遗留操作完成。')}</p>{transaction?.failure?.code==='PAIRING_WORK_PENDING'&&<details><summary>{w('等待详情')}</summary><pre>{transaction.failure.message}</pre></details>}</div>}
   {admin&&<p>{w('请联系 Hive 管理员检查记录。')}</p>}
   {!querying&&!cancelling&&phase&&['creating','redeeming'].includes(phase)&&<p className="repair-progress" role="status">{w(phase==='creating'?'正在处理已保存的请求，请勿重复创建。':'Bee 沿原请求核对结果；网页已批准不代表本机已经保存。')}</p>}

   {phase==='saving'&&!transaction?.failure&&<p>{w('正在保存设备配置…')}</p>}
   {cancelled&&<><p>{w('旧设备不会自动恢复接单。')}</p><p>{w('已完成的处理不会撤回。')}</p></>}
   {!querying&&(unknown||cancelling)&&failures.length===0&&<p>{w('原请求已保留，结果尚未确认。')}</p>}
   {!querying&&!checking&&failures.filter(failure=>!active||!['device_replaced','invalid_device_credential'].includes(failure.code)).map((failure,index)=><WizardFailure key={index} failure={failure} centered compact summary={savePermissionDenied&&failure.message===transaction?.failure?.message?w('设备配置写入被拒绝。'):index===0&&problem&&!active?w(problem.reason):unknown||cancelling?w(deviceProblem(failure).reason):undefined} manualUrlAvailable={!!pairing}/>)}
   {phase==='saving'&&transaction?.failure&&!querying&&!checking&&<p>{w(savePermissionDenied?'请允许 Bee 写入设备配置，然后继续保存。':'请处理保存失败原因，然后继续保存。')}</p>}
   {!active&&!querying&&!checking&&problem?.title==='Hive 暂不可用'&&<p>{w('请稍后重试连接。')}</p>}
   {active&&!issue&&startupNotice}
   <div className="binding-actions" aria-busy={busy}>
    {cancelled&&<Button disabled={busy||switching} onClick={event=>doRepair(event.currentTarget)}>{w('修复设备绑定')}</Button>}
    {!active&&credentialFault&&!cancelled&&<Button disabled={busy||switching} onClick={event=>doRepair(event.currentTarget)}>{w('修复设备绑定')}</Button>}
    {phase==='awaiting_confirmation'&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,'begin_pairing')}>{w(initialPairing?'绑定设备':'重新绑定 Hive')}</Button>}
    {phase==='awaiting_owner_confirmation'&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,'adopt_owner')}>{w('确认采用新归属')}</Button>}
    {!querying&&!cancelling&&pairing&&phase==='pending'&&<Button disabled={busy||Date.parse(pairing.expires_at)<=now} onClick={open}>{w('打开 Hive 确认网页')}</Button>}
    {phase==='saving'&&transaction?.failure&&<Button disabled={busy} onClick={check}>{w('继续保存')}</Button>}
    {(phase==='expired'||locallyExpired)&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,locallyExpired?'restart_pairing':'renew_expired')}>{w('重新获取配对码')}</Button>}
    {recover&&active&&(cancelling||unknown||paused||phase==='blocked')&&!admin&&!locallyExpired&&<Button variant={pairing&&phase==='pending'?'outline':'default'} disabled={busy} onClick={event=>void recheck(event.currentTarget)}>{w(querying?'正在核对…':'重新核对')}</Button>}
    {recover&&active&&!cancelling&&!unknown&&!admin&&phase==='blocked'&&<Button variant="outline" disabled={busy||!!recoveryError} onClick={event=>ask(event.currentTarget,'restart_pairing')}>{w('重新配对')}</Button>}
    {!active&&issue&&!credentialFault&&canRefresh&&<Button disabled={busy} onClick={event=>void recheck(event.currentTarget)}>{w(querying?(problem?.action==='retry'?'正在连接…':'正在核对…'):checking?'正在连接…':problem?.action==='retry'?'重试连接':'重新核对')}</Button>}
    {!embedded&&!querying&&!cancelling&&pairing&&phase==='pending'&&<Button variant="ghost" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}>{w('复制确认网址')}</Button>}
    {(admin||failures.length>0&&problem?.action==='recheck')&&onNavigate&&<Button variant="ghost" onClick={()=>onNavigate({page:'diagnostics'})}>{w('查看诊断')}</Button>}
    {phase==='pending'&&progressMenu}
    {extraActions}
   </div>
   {!querying&&!cancelling&&pairing&&phase==='pending'&&<>{!embedded&&<p className="device-note">{w(paused?'自动核对已暂停，网页确认后请点击重新核对。':'完成确认后，此处会自动更新。')}</p>}{showConfirmationUrl&&<details className="binding-url"><summary>{w(embedded?'切换详情':'确认网址')}</summary>{transactionDetails}{embedded&&<p>{w('有效期至')} {formatDate(pairing.expires_at,currentLocale())}</p>}<p>{pairing.verification_url}</p>{embedded&&<div className="binding-actions"><Button variant="ghost" onClick={()=>void copy(pairing.code,'配对码已复制')}>{w('复制配对码')}</Button><Button variant="ghost" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}>{w('复制确认网址')}</Button></div>}</details>}</>}
   {!embedded&&phase!=='saving'&&transaction?.failure?.details?.observed_at&&<p className="device-note">{w('上次核对')}：{formatDate(transaction.failure.details.observed_at,currentLocale())}</p>}
   </>}
  </div>}
  {!(active||issue)&&startupNotice}
  {!embedded&&(initialLoading?<p className="device-loading" role="status">{w('正在读取本机配置与设备状态…')}</p>:<dl className="device-card-facts" aria-label={identity&&issue?w('上次确认的设备，当前待核对。'):!identity&&context?.device_id?w('上次保存的设备信息'):undefined}>
   <div><dt>{w('本机设备')}</dt><dd>{deviceName}</dd></div>
   {(identity||context?.device_id)&&<div><dt>{w('归属账号')}</dt><dd>{identity?.owner_email??w('待核对')}</dd></div>}
   {address&&<div><dt>Hive</dt><dd>{address}</dd></div>}
  </dl>)}

  {embedded&&!transaction&&!issue&&view?.state==='unbound'&&<div className="binding-actions"><Button disabled={busy||!hive.trim()||!name.trim()} onClick={()=>begin(hive.trim(),name.trim())}>{w('生成目标配对码')}</Button>{extraActions}</div>}
  {!embedded&&!transaction&&!issue&&view?.state==='unbound'&&<form className="settings-form" onSubmit={event=>{event.preventDefault();if(!busy)begin(hive.trim(),name.trim());}}><label>{w('Hive 地址')}<input type="url" required readOnly={inputDraft?.hiveReadOnly} value={hive} disabled={busy} onChange={event=>setHive(event.target.value)}/></label><label>{w('设备名称')}<input required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><Button disabled={busy||!hive.trim()||!name.trim()}>{w('继续绑定设备')}</Button></form>}
  {recoveryStart&&!confirmed&&!active&&!cancelled&&!credentialFault&&issue?.code==='DEVICE_CONTEXT_UNCONFIGURED'&&<HiveRecoveryEntry busy={busy} initialHive={address} initialName={deviceName} start={recoveryStart}/>}
  {!view&&!issue&&!transaction&&!initialLoading&&<p role="status">{w(refreshStatus?.state==='waiting'?'前次设备检查尚未结束，结果待确认。':'设备状态尚未确认，请重新检查设备。')}</p>}
  {copied&&<p className="device-note" role="status">{w(copied)}</p>}{copyError&&<WizardFailure failure={copyError}/>}
  <Dialog.Root open={!!confirmation} onOpenChange={value=>{if(!value)setConfirmation(null);}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content binding-confirmation" onCloseAutoFocus={event=>{event.preventDefault();const trigger=confirmationTrigger.current;(trigger?.isConnected&&!trigger.disabled?trigger:menuTrigger.current??section.current)?.focus({preventScroll:true});}}>
   <Dialog.Title>{w(confirmation?.decision==='cancel_pairing'?'取消重新绑定？':confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='restart_pairing'?(locallyExpired?'重新获取配对码':'重新配对'):initialPairing?'绑定设备':'重新绑定 Hive')}</Dialog.Title>
   <Dialog.Description>{w(confirmation?.decision==='cancel_pairing'?'取消后将停止后续替换。旧设备不会自动恢复接单，已完成的处理不会撤回。':confirmation?.decision==='restart_pairing'?'Bee 先向 Hive 确认结束旧申请。若旧绑定已经成功，Bee 会恢复原成功结果，不再生成新码。':confirmation?.decision==='adopt_owner'?'请确认采用上方的新归属账号。旧账号选择与运行意图不会迁移，贡献保持停止。':initialPairing?'请前往 Hive 网页确认设备归属。':'请前往 Hive 网页核对原设备并确认重新绑定。')}</Dialog.Description>
   {!initialPairing&&confirmation?.decision!=='cancel_pairing'&&<p className="repair-impact">{w('重新绑定完成后，需要重新接入 AI 账号。')}</p>}
   {confirmation?.decision==='adopt_owner'&&<p>{confirmation.transaction?.old_identity?.owner_email} → {confirmation.transaction?.new_identity?.owner_email}</p>}
   {submitted&&operationError?<div ref={failureFocus} data-recovery-failure tabIndex={-1}><WizardFailure failure={operationError}/></div>:submitted&&busy&&<p role="status">{w('正在处理设备恢复，请稍候…')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{w(confirmation?.decision==='cancel_pairing'?'继续重新绑定':submitted?'关闭':'取消')}</Button></Dialog.Close><Button disabled={busy||!recover} onClick={()=>void submit()}>{w(confirmation?.decision==='cancel_pairing'?'确认取消':confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='restart_pairing'?(locallyExpired?'确认获取新码':'确认重新配对'):initialPairing?'确认绑定':'确认重新绑定')}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section></>;
}

export function HiveRecoveryEntry({busy,initialHive='',initialName='Bee Desktop',start}:{busy:boolean;initialHive?:string;initialName?:string;start:(hive:string,name:string)=>Promise<void>}){
 const [entry,setEntry]=useState(false),[hive,setHive]=useState(initialHive),[name,setName]=useState(initialName),[validation,setValidation]=useState('');
 const hiveInput=useRef<HTMLInputElement>(null);
 return <div className="device-recovery-action"><Button variant="ghost" disabled={busy} aria-expanded={entry} onClick={()=>setEntry(value=>!value)}>{w('修复设备绑定')}</Button>{entry&&<form className="settings-form" noValidate onSubmit={event=>{event.preventDefault();if(busy)return;const message=validateHive(hive.trim());setValidation(message);if(message){hiveInput.current?.focus();return;}if(!name.trim())return;void start(hive.trim().replace(/\/$/,''),name.trim());}}>
  <p>{w('输入原设备使用的 Hive 地址。')}</p><label>{w('Hive 地址')}<input ref={hiveInput} name="recovery-hive" type="url" autoComplete="url" spellCheck={false} required value={hive} aria-invalid={!!validation} aria-describedby={validation?'recovery-address-error':undefined} disabled={busy} onChange={event=>{setHive(event.target.value);setValidation('');}}/></label>{validation&&<p id="recovery-address-error" role="alert">{w(validation)}</p>}
  <label>{w('设备名称')}<input name="recovery-device-name" required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><Button disabled={busy||!name.trim()} aria-busy={busy}>{w(busy?'正在核对恢复…':'继续')}</Button>
 </form>}</div>;
}
