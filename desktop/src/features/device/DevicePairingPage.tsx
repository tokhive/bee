import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Dialog,DropdownMenu} from 'radix-ui';
import {Copy,ExternalLink,MoreHorizontal,RefreshCw,Check} from 'lucide-react';
import {currentLocale,formatDate} from '../../i18n/index';
import {Button} from '../../components/ui';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import type {DeviceView,DeviceRecoveryView,DeviceContext,RecoveryDecision} from '../../system/device';
import type {RefreshStatus} from '../../system/desktopState';
import {validateHive,WizardFailure} from './FirstLaunchWizard';
import {wizardText as w} from './first-launch-copy';
import './binding-repair.css';

const phaseCopy:Record<DeviceRecoveryView['phase'],string>={
 awaiting_confirmation:'请重新绑定',creating:'正在创建配对请求',creation_unknown:'创建结果未知',pending:'等待网页确认',
 draining:'等待 Hive 核对旧设备的任务、结算和遗留操作',redeeming:'正在完成设备替换',redemption_unknown:'兑换结果未知',
 awaiting_owner_confirmation:'新设备归属与原设备不同',saving:'正在保存设备绑定',completed:'设备已重新绑定',expired:'Hive 已确认配对码过期',blocked:'设备绑定暂时无法继续',
};
export interface DevicePairingProps {
 title?:string;inputDraft?:{hive:string;name:string;hiveReadOnly?:boolean;setHive:(value:string)=>void;setName:(value:string)=>void};
 switchControl?:ReactNode;switchStatus?:ReactNode;statusControl?:ReactNode;startupNotice?:ReactNode;
 onSwitchHive?:()=>void;switching?:boolean;repair?:()=>Promise<void>;repairResult?:'healthy'|'restored';
 view?:DeviceView;context?:DeviceContext;recovery?:DeviceRecoveryView;recoveryError?:UiFailure|null;refreshStatus?:RefreshStatus;
 busy:boolean;checking?:boolean;initialLoading?:boolean;error:UiFailure|null;reportedFailure?:UiFailure|null;operationError?:UiFailure|null;
 onNavigate?:(target:NavigationTarget)=>void;canRefresh?:boolean;recoveryStart?:(hive:string,name:string)=>Promise<void>;
 begin:(hive:string,name:string)=>void;refresh:()=>void;open:()=>void;recover?:(decision:RecoveryDecision,transaction?:DeviceRecoveryView)=>Promise<boolean>;
}
/** Presents native receipts only. Opening a web page never approves or completes a binding. */
export function DevicePairingPage({view,context,recovery,recoveryError,refreshStatus,busy:writing,checking=false,initialLoading=false,error,reportedFailure,operationError,begin,refresh,open,recover,recoveryStart,onNavigate,canRefresh=true,switchControl,switchStatus,statusControl,startupNotice,onSwitchHive,switching=false,repair,repairResult,inputDraft,title}:DevicePairingProps){
 const [localHive,setLocalHive]=useState(''),[localName,setLocalName]=useState('Bee Desktop');
 const hive=inputDraft?.hive??localHive,name=inputDraft?.name??localName,setHive=inputDraft?.setHive??setLocalHive,setName=inputDraft?.setName??setLocalName;
 const [now,setNow]=useState(Date.now()),[copied,setCopied]=useState(''),[copyError,setCopyError]=useState<UiFailure|null>(null);
 const [menuOpen,setMenuOpen]=useState(false),[progressOpen,setProgressOpen]=useState(false);
 const afterMenuClose=useRef<(()=>void)|null>(null);
 const mounted=useRef(true),copyAttempt=useRef(0);
 const progressTrigger=useRef<HTMLButtonElement>(null);
 const [confirmation,setConfirmation]=useState<{decision:RecoveryDecision;transaction?:DeviceRecoveryView}|null>(null),[submitted,setSubmitted]=useState(false);
 const section=useRef<HTMLElement>(null),menuTrigger=useRef<HTMLButtonElement>(null),confirmationTrigger=useRef<HTMLButtonElement|null>(null),failureFocus=useRef<HTMLDivElement>(null);
 const busy=writing||checking||initialLoading;
 const transaction=recovery??view?.recovery;
 const phase=transaction?.phase??(view?.state==='pending'||view?.state==='draining'||view?.state==='expired'?view.state:undefined);
 const cancelled=phase==='blocked'&&transaction?.failure?.code==='PAIRING_CLOSED';
 const active=!!phase&&phase!=='completed'&&!cancelled;
 const paused=transaction?.failure?.code==='PAIRING_OBSERVATION_PAUSED';
 const admin=transaction?.failure?.code==='PAIRING_ADMIN_REQUIRED'||transaction?.failure?.code==='RECOVERY_EVIDENCE_UNRESOLVED';
 const pairing=phase==='completed'||cancelled?null:transaction?.pairing??(view?.user_code&&view.verification_url&&view.expires_at?{code:view.user_code,verification_url:view.verification_url,expires_at:view.expires_at}:null);
 const identity=view?.identity??(phase==='completed'?transaction?.new_identity:transaction?.old_identity);
 const address=view?.hive??context?.hive??hive,deviceName=identity?.name??context?.name??name;
 const issue=error??reportedFailure??recoveryError;
 const credentialFault=!!issue&&['device_replaced','invalid_device_credential','DEVICE_CONTEXT_INVALID'].includes(issue.code);
 const confirmed=view?.state==='bound'&&!issue&&!active;
 const canCancel=!!transaction&&!!recover&&active&&!['saving','awaiting_owner_confirmation','awaiting_confirmation'].includes(phase!);
 const failures=[...new Map([issue,recoveryError,operationError,transaction?.failure].filter((f):f is UiFailure=>!!f&&!['PAIRING_CLOSED','PAIRING_OBSERVATION_PAUSED','PAIRING_WORK_PENDING'].includes(f.code)).map(f=>[JSON.stringify([f.code,f.message]),normalizeFailure(f,'device_binding')])).values()];
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;copyAttempt.current++;};},[]);
 useEffect(()=>{if(inputDraft&&view?.state==='bound')return;if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 useEffect(()=>{if(!pairing)return;setNow(Date.now());const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[pairing?.expires_at]);
 useEffect(()=>{copyAttempt.current++;setCopied('');setCopyError(null);},[address,transaction?.operation_id,pairing?.code]);
 useEffect(()=>{if(submitted&&operationError)failureFocus.current?.focus();},[submitted,operationError]);
 const ask=(trigger:HTMLButtonElement,decision:RecoveryDecision,record=transaction)=>{confirmationTrigger.current=trigger;setSubmitted(false);setConfirmation({decision,transaction:record});};
 const submit=async()=>{if(!confirmation||busy||!recover)return;const request=confirmation;setSubmitted(true);if(await recover(request.decision,request.transaction))setConfirmation(value=>value===request?null:value);};
 const copy=async(value:string,label:string)=>{const attempt=++copyAttempt.current;setCopyError(null);setCopied('');try{if(!navigator.clipboard?.writeText)throw Error('clipboard.writeText unavailable; select and copy the displayed value manually');await navigator.clipboard.writeText(value);if(mounted.current&&attempt===copyAttempt.current)setCopied(label);}catch(cause){if(mounted.current&&attempt===copyAttempt.current)setCopyError(normalizeFailure(cause,'clipboard_write'));}};
 const doRepair=(trigger:HTMLButtonElement)=>{if(cancelled){ask(trigger,'restart_pairing');return;}if(active){section.current?.querySelector<HTMLElement>('.device-transaction')?.focus();check();return;}if(repair)void repair();else if(recoveryStart&&address)void recoveryStart(address,deviceName);else if(recover){confirmationTrigger.current=trigger;setSubmitted(false);setConfirmation({decision:'begin_pairing'});}};
 const check=()=>{if(!busy&&canRefresh)refresh();};
 const headline=cancelled?'已取消重新绑定':paused?'重新绑定尚未完成':phase==='saving'&&transaction?.failure?'绑定已完成，本机保存失败':phase==='pending'?'在 Hive 网页确认设备':phase==='completed'&&!transaction?.old_identity?'设备已绑定':phase?phaseCopy[phase]:credentialFault?'设备绑定需要修复':'无法确认设备状态';
 return <section ref={section} tabIndex={-1} className="native-device-summary device-pairing device-card" aria-label={w(title??'设备与 Hive')}>
  <div className="device-card-heading"><h2>{w(title??'设备与 Hive')}</h2>
   <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}><DropdownMenu.Trigger asChild><Button ref={menuTrigger} data-device-menu variant="ghost" size="icon" aria-label={w('设备操作')} aria-busy={checking}><MoreHorizontal aria-hidden="true"/></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="device-actions-menu" align="end" sideOffset={4} collisionPadding={12} onCloseAutoFocus={event=>{const action=afterMenuClose.current;if(action){event.preventDefault();afterMenuClose.current=null;queueMicrotask(action);}}}>
    <DropdownMenu.Item disabled={busy||switching||!repair&&!recover&&!recoveryStart} onSelect={event=>{event.preventDefault();afterMenuClose.current=()=>doRepair(menuTrigger.current!);setMenuOpen(false);}}>{w(active?'查看修复进度':'修复设备绑定')}</DropdownMenu.Item>
    {onSwitchHive&&<DropdownMenu.Item disabled={busy||active||switching} onSelect={event=>{event.preventDefault();afterMenuClose.current=onSwitchHive;setMenuOpen(false);}}>{w('切换 Hive')}</DropdownMenu.Item>}
    {active&&onSwitchHive&&<p>{w('当前修复结束后可切换 Hive')}</p>}
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  </div>
  {switchControl}
  {statusControl}
  {initialLoading?<p className="device-loading" role="status">{w('正在读取本机配置与设备状态…')}</p>:<dl className="device-card-facts">
   <div><dt>{w('本机设备')}</dt><dd>{deviceName}</dd></div>
   {(identity||context?.device_id)&&<div><dt>{w('归属账号')}</dt><dd>{identity?.owner_email??w('待核对')}</dd></div>}
   {address&&<div><dt>Hive</dt><dd>{address}</dd></div>}
  </dl>}
  {!initialLoading&&identity&&issue&&<p className="device-note">{w('上次确认的设备，当前待核对。')}</p>}
  {!initialLoading&&!identity&&context?.device_id&&<p className="device-note">{w('上次保存的设备信息')}</p>}
  {switchStatus}
  {repairResult&&!active&&!issue&&!checking&&<p className="repair-result" role="status"><Check aria-hidden="true"/>{w(repairResult==='healthy'?'设备绑定正常，无需修复。':'设备绑定已恢复，AI 账号与接单选择保持不变。')}</p>}
  {checking&&<p className="repair-result" role="status"><RefreshCw className="device-refreshing" aria-hidden="true"/>{w('正在检查原绑定…')}</p>}
  {(phase||issue)&&!initialLoading&&<div className="device-transaction" tabIndex={-1}>
   <div className="device-transaction-heading"><h3 className="pairing-phase" aria-live="polite">{w(headline)}</h3>
    {canCancel&&<DropdownMenu.Root open={progressOpen} onOpenChange={setProgressOpen}><DropdownMenu.Trigger asChild><Button ref={progressTrigger} variant="ghost" size="icon" aria-label={w('重新绑定操作')}><MoreHorizontal aria-hidden="true"/></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="device-actions-menu" align="end" sideOffset={4}><DropdownMenu.Item onSelect={event=>{event.preventDefault();setProgressOpen(false);ask(progressTrigger.current!,'cancel_pairing');}}>{w('取消重新绑定')}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
   </div>
   {pairing&&(phase==='pending'||phase==='expired')&&<div className="binding-pairing-code"><p>{w('配对码')}</p><div><strong className="pair-code">{pairing.code}</strong><Button variant="ghost" onClick={()=>void copy(pairing.code,'配对码已复制')}><Copy aria-hidden="true"/>{w('复制')}</Button></div><small>{w(phase==='expired'?'Hive 已确认配对码过期':Date.parse(pairing.expires_at)<=now?'配对码有效期已到，正在核对原请求。':'有效期至')}{phase!=='expired'&&Date.parse(pairing.expires_at)>now&&' '+formatDate(pairing.expires_at,currentLocale())}</small></div>}
   {phase==='pending'&&<p>{w(transaction?.old_identity?'请登录原设备所属的 Hive 账号，核对配对码和旧设备后，确认重新绑定。':'请登录 Hive 账号，核对配对码后，确认设备归属。')}</p>}
   {phase==='awaiting_confirmation'&&<p>{w('请在 Hive 网页核对配对码与原设备，确认重新绑定。')}</p>}
   {((phase==='pending'||phase==='awaiting_confirmation')&&!!recovery||phase==='awaiting_owner_confirmation')&&<p className="repair-impact">{w('重新绑定完成后，需要重新接入 AI 账号。')}</p>}
   {phase==='awaiting_owner_confirmation'&&transaction&&<><dl className="recovery-identities"><div><dt>{w('原归属账号')}</dt><dd>{transaction.old_identity?.owner_email??w('待核对')}</dd></div><div><dt>{w('新归属账号')}</dt><dd>{transaction.new_identity?.owner_email}</dd></div></dl><p>{w('采用新归属后，旧账号选择与运行意图不会迁移。')}</p></>}
   {phase==='draining'&&<div className="repair-progress" role="status"><p>{w(admin?'Hive 无法确认旧设备的任务处理记录。':'正在等待旧设备的任务、结算和遗留操作完成。')}</p>{transaction?.failure?.code==='PAIRING_WORK_PENDING'&&<details><summary>{w('等待详情')}</summary><pre>{transaction.failure.message}</pre></details>}</div>}
   {admin&&<p>{w('请联系 Hive 管理员检查记录。')}</p>}
   {phase&&['creating','redeeming','redemption_unknown'].includes(phase)&&<p className="repair-progress" role="status">{w(phase==='creating'?'正在处理已保存的请求，请勿重复创建。':'Bee 沿原请求核对结果；网页已批准不代表本机已经保存。')}</p>}
   {phase==='creation_unknown'&&<p>{w('Bee 保留了原请求，正在核对 Hive。重新配对会先结束旧申请，再生成新码。')}</p>}
   {phase==='saving'&&<p>{w(transaction?.failure?'请处理保存失败原因，然后继续保存。':'正在保存设备配置…')}</p>}
   {cancelled&&<><p>{w('旧设备不会自动恢复接单。')}</p><p>{w('已完成的处理不会撤回。')}</p></>}
   {phase==='completed'&&<><p>{w('设备绑定已保存。')}</p>{recovery&&<p>{w('请前往 AI 账号核对接入状态。')}</p>}</>}
   {failures.filter(problem=>!active||!['device_replaced','invalid_device_credential'].includes(problem.code)).map((problem,index)=><WizardFailure key={index} failure={problem} manualUrlAvailable={!!pairing}/>)}
   {startupNotice}
   <div className="binding-actions">
    {cancelled&&<Button disabled={busy||switching} onClick={event=>doRepair(event.currentTarget)}>{w('重新绑定 Hive')}</Button>}
    {!active&&credentialFault&&!cancelled&&<Button disabled={busy||switching} onClick={event=>doRepair(event.currentTarget)}>{w('修复设备绑定')}</Button>}
    {phase==='awaiting_confirmation'&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,'begin_pairing')}>{w('重新绑定 Hive')}</Button>}
    {phase==='awaiting_owner_confirmation'&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,'adopt_owner')}>{w('确认采用新归属')}</Button>}
    {pairing&&phase==='pending'&&!paused&&<Button disabled={busy||Date.parse(pairing.expires_at)<=now} onClick={open}>{w('打开 Hive 确认网页')}<ExternalLink aria-hidden="true"/></Button>}
    {phase==='saving'&&transaction?.failure&&<Button disabled={busy} onClick={check}>{w('继续保存')}</Button>}
    {phase==='expired'&&<Button disabled={busy||!recover} onClick={event=>ask(event.currentTarget,'renew_expired')}>{w('重新获取配对码')}</Button>}
    {recover&&active&&(paused||['creation_unknown','redemption_unknown','blocked'].includes(phase!))&&!admin&&<Button disabled={busy||!!recoveryError} onClick={()=>void recover('continue_checking',transaction)}>{w('继续核对')}</Button>}
    {recover&&active&&!admin&&['creation_unknown','blocked'].includes(phase!)&&<Button variant="outline" disabled={busy||!!recoveryError} onClick={event=>ask(event.currentTarget,'restart_pairing')}>{w('重新配对')}</Button>}
    {!active&&issue&&!credentialFault&&canRefresh&&<Button disabled={busy} onClick={check}>{w('重试连接')}</Button>}
    {phase==='completed'&&onNavigate&&<Button onClick={()=>onNavigate({page:'accounts'})}>{w('接入 AI 账号')}</Button>}
    {pairing&&phase==='pending'&&<Button variant="ghost" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}>{w('复制确认网址')}</Button>}
    {(admin||failures.length>0)&&onNavigate&&<Button variant="ghost" onClick={()=>onNavigate({page:'diagnostics'})}>{w('查看诊断')}</Button>}
   </div>
   {pairing&&phase==='pending'&&<><p className="device-note">{w('完成确认后，此处会自动更新。')}</p><details className="binding-url"><summary>{w('确认网址')}</summary><p>{pairing.verification_url}</p></details></>}
   {transaction?.failure?.details?.observed_at&&<p className="device-note">{w('上次核对')}：{formatDate(transaction.failure.details.observed_at,currentLocale())}</p>}
  </div>}
  {!(phase||issue)&&startupNotice}
  {!transaction&&!issue&&view?.state==='unbound'&&<form className="settings-form" onSubmit={event=>{event.preventDefault();if(!busy)begin(hive.trim(),name.trim());}}><label>{w('Hive 地址')}<input type="url" required readOnly={inputDraft?.hiveReadOnly} value={hive} disabled={busy} onChange={event=>setHive(event.target.value)}/></label><label>{w('设备名称')}<input required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><Button disabled={busy||!hive.trim()||!name.trim()}>{w('继续绑定设备')}</Button></form>}
  {recoveryStart&&!confirmed&&!active&&!cancelled&&!credentialFault&&<HiveRecoveryEntry busy={busy} initialHive={address} initialName={deviceName} start={recoveryStart}/>}
  {!view&&!issue&&!transaction&&!initialLoading&&<p role="status">{w(refreshStatus?.state==='waiting'?'前次设备检查尚未结束，结果待确认。':'设备状态尚未确认，请重新检查设备。')}</p>}
  {copied&&<p className="device-note" role="status">{w(copied)}</p>}{copyError&&<WizardFailure failure={copyError}/>}
  <Dialog.Root open={!!confirmation} onOpenChange={value=>{if(!value)setConfirmation(null);}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content binding-confirmation" onCloseAutoFocus={event=>{event.preventDefault();const trigger=confirmationTrigger.current;(trigger?.isConnected&&!trigger.disabled?trigger:menuTrigger.current??section.current)?.focus({preventScroll:true});}}>
   <Dialog.Title>{w(confirmation?.decision==='cancel_pairing'?'取消重新绑定？':confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='restart_pairing'?'重新配对':'重新绑定 Hive')}</Dialog.Title>
   <Dialog.Description>{w(confirmation?.decision==='cancel_pairing'?'取消后将停止后续替换。旧设备不会自动恢复接单，已完成的处理不会撤回。':confirmation?.decision==='restart_pairing'?'Bee 先向 Hive 确认结束旧申请。若旧绑定已经成功，Bee 会恢复原成功结果，不再生成新码。':confirmation?.decision==='adopt_owner'?'请确认采用上方的新归属账号。旧账号选择与运行意图不会迁移，贡献保持停止。':'请前往 Hive 网页核对原设备并确认重新绑定。')}</Dialog.Description>
   {confirmation?.decision!=='cancel_pairing'&&<p className="repair-impact">{w('重新绑定完成后，需要重新接入 AI 账号。')}</p>}
   {confirmation?.decision==='adopt_owner'&&<p>{confirmation.transaction?.old_identity?.owner_email} → {confirmation.transaction?.new_identity?.owner_email}</p>}
   {submitted&&operationError?<div ref={failureFocus} data-recovery-failure tabIndex={-1}><WizardFailure failure={operationError}/></div>:submitted&&busy&&<p role="status">{w('正在处理设备恢复，请稍候…')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{w(confirmation?.decision==='cancel_pairing'?'继续重新绑定':submitted?'关闭':'取消')}</Button></Dialog.Close><Button disabled={busy||!recover} onClick={()=>void submit()}>{w(confirmation?.decision==='cancel_pairing'?'确认取消':confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='restart_pairing'?'确认重新配对':'确认重新绑定')}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}

export function HiveRecoveryEntry({busy,initialHive='',initialName='Bee Desktop',start}:{busy:boolean;initialHive?:string;initialName?:string;start:(hive:string,name:string)=>Promise<void>}){
 const [entry,setEntry]=useState(false),[hive,setHive]=useState(initialHive),[name,setName]=useState(initialName),[validation,setValidation]=useState('');
 const hiveInput=useRef<HTMLInputElement>(null);
 return <div className="device-recovery-action"><Button variant="ghost" disabled={busy} aria-expanded={entry} onClick={()=>setEntry(value=>!value)}>{w('修复设备绑定')}</Button>{entry&&<form className="settings-form" noValidate onSubmit={event=>{event.preventDefault();if(busy)return;const message=validateHive(hive.trim());setValidation(message);if(message){hiveInput.current?.focus();return;}if(!name.trim())return;void start(hive.trim().replace(/\/$/,''),name.trim());}}>
  <p>{w('输入原设备使用的 Hive 地址。')}</p><label>{w('Hive 地址')}<input ref={hiveInput} name="recovery-hive" type="url" autoComplete="url" spellCheck={false} required value={hive} aria-invalid={!!validation} aria-describedby={validation?'recovery-address-error':undefined} disabled={busy} onChange={event=>{setHive(event.target.value);setValidation('');}}/></label>{validation&&<p id="recovery-address-error" role="alert">{w(validation)}</p>}
  <label>{w('设备名称')}<input name="recovery-device-name" required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><Button disabled={busy||!name.trim()} aria-busy={busy}>{w(busy?'正在核对恢复…':'继续')}</Button>
 </form>}</div>;
}
