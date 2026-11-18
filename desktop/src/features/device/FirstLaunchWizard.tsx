import {useEffect,useId,useRef,useState,type ReactNode,type FormEvent} from 'react';
import type {DeviceView,DeviceContext,DeviceRecoveryView,RecoveryDecision} from '../../system/device';
import type {RefreshStatus} from '../../system/desktopState';
import {normalizeFailure,safeOrigin,type UiFailure} from '../../system/failures';
import {currentLocale} from '../../i18n';
import {presentFailure} from '../../presentation/problems';
import {Button} from '../../components/ui';
import {Dialog,Popover} from 'radix-ui';
import {downloadPayload} from '../diagnostics/report';
import {wizardText as w} from './first-launch-copy';
import './first-launch-wizard.css';

export interface FirstLaunchWizardProps {
 startupNotice?:ReactNode;
 recoveryEntry?:ReactNode;
 recover?:(decision:RecoveryDecision,transaction?:DeviceRecoveryView)=>Promise<boolean>;
 view?:DeviceView;context?:DeviceContext;refreshStatus?:RefreshStatus;
 initialLoading?:boolean;busy:boolean;checking?:boolean;
 error:UiFailure|null;operationError?:UiFailure|null;completed?:boolean;
 begin:(hive:string,name:string)=>void|Promise<unknown>;
 refresh:()=>void|Promise<unknown>;open:()=>void|Promise<unknown>;
 onNavigate:(page:'accounts'|'overview')=>void;
 onDiagnostics?:()=>void;onRepair?:()=>void;onOpenHive?:()=>void|Promise<unknown>;
}

/** Hive offered to a new device; builds for another Hive set VITE_DEFAULT_HIVE. */
export const DEFAULT_HIVE=import.meta.env.VITE_DEFAULT_HIVE||'https://console.tokhive.ai';

/** Reads a bare host such as console.tokhive.ai as an HTTPS address. */
function typedHive(raw:string):string {return raw&&!raw.includes('://')?`https://${raw}`:raw;}

export function validateHive(raw:string):string {
 if(!raw)return '请填写 Hive 地址。';
 let url:URL;try{url=new URL(raw);}catch{return 'Hive 地址须为完整的 HTTPS 网址。';}
 if(url.username||url.password||raw.includes('@'))return 'Hive 地址不能包含用户名或密码。';
 if(url.pathname!=='/'||url.search||url.hash||/[?#]/.test(raw))return 'Hive 地址不能包含路径、查询参数或片段。';
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&safeOrigin(raw.replace(/\/$/,''))))return '远程 Hive 必须使用 HTTPS；HTTP 仅限本机回环地址。';
 if(!/^https?:\/\/[^/?#@\\\s]+\/?$/.test(raw))return 'Hive 地址须为完整的 HTTPS 网址。';
 return '';
}

function useDiagnosticExport(details:string){
 const [exporting,setExporting]=useState(false),[exportNotice,setExportNotice]=useState('');
 const exportEvidence=async()=>{
  if(exporting)return;setExporting(true);setExportNotice('');
  try{const result=await downloadPayload(new Blob([details],{type:'text/plain;charset=utf-8'}),'bee-device-diagnostics.txt');setExportNotice(result==='completed'?'诊断已导出。':result==='initiated'?'已发起下载，请核对下载文件。':'下载结果尚未确认，请核对下载文件。');}
  catch(cause){setExportNotice(presentFailure(normalizeFailure(cause,'device_diagnostic_export'),currentLocale()).summary);}
  finally{setExporting(false);}
 };
 useEffect(()=>{setExportNotice('');},[details]);
 return {exporting,exportNotice,exportEvidence};
}
function WizardDiagnosticExport({details}:{details:string}){
 const {exporting,exportNotice,exportEvidence}=useDiagnosticExport(details);
 return <><Button type="button" variant="ghost" disabled={exporting} onClick={()=>void exportEvidence()}>{w(exporting?'正在导出…':'导出诊断')}</Button>{exportNotice&&<p role="status">{w(exportNotice)}</p>}</>;
}

export function WizardFailure({failure,manualUrlAvailable=false,summary:summaryOverride,compact=false,centered=false}:{failure:UiFailure;manualUrlAvailable?:boolean;summary?:string;compact?:boolean;centered?:boolean}){
 const [open,setOpen]=useState(false),titleId=useId();
 const problem=presentFailure(failure,currentLocale()),details=problem.details;
 const {exporting,exportNotice,exportEvidence}=useDiagnosticExport(details);
 const browserReason:Record<string,string>={BROWSER_OPEN_FAILED:'默认浏览器打开失败。',BROWSER_OPEN_TIMEOUT:'打开浏览器超时，网页打开结果尚未确认。',BROWSER_OPEN_CLEANUP_FAILED:'浏览器打开程序超时，且未能确认已结束。'};
 const browser=browserReason[failure.code];
 const browserSummary=failure.code==='BROWSER_OPEN_FAILED'&&/\bEACCES\b/.test(failure.message)?'系统拒绝打开默认浏览器（EACCES）。':browser;
 const summary=summaryOverride??(browserSummary?w(browserSummary):problem.summary);
 const impact=browser&&manualUrlAvailable?w('原配对请求已保留，设备绑定仍需在 Hive 网页确认。'):problem.impact;
 const guidance=browser&&manualUrlAvailable?'可复制确认网址，在浏览器中打开；本次配对仍保留。':failure.code==='tls_failed'?'请核对 Hive 地址与服务证书，修复后再继续当前绑定步骤。':failure.code==='unavailable'?'请等待 Hive 恢复服务，再继续当前绑定步骤。':'';
 useEffect(()=>{setOpen(false);},[details]);
 const Root=centered?Dialog.Root:Popover.Root,Trigger=centered?Dialog.Trigger:Popover.Trigger,Portal=centered?Dialog.Portal:Popover.Portal,Close=centered?Dialog.Close:Popover.Close;
 const contents=<><header>{centered?<Dialog.Title asChild><h3 id={titleId}>{w('错误详情')}</h3></Dialog.Title>:<h3 id={titleId}>{w('错误详情')}</h3>}</header><pre>{details}</pre><div className="binding-actions"><Button type="button" variant="outline" disabled={exporting} onClick={()=>void exportEvidence()}>{w(exporting?'正在导出…':'导出诊断')}</Button><Close asChild><Button type="button" variant={centered?'ghost':'outline'} aria-label={w('关闭错误详情')}>{w('关闭')}</Button></Close></div>{exportNotice&&<p role="status">{w(exportNotice)}</p>}</>;
 return <div className={`first-launch-failure${browser&&manualUrlAvailable?' first-launch-browser-failure':''}`} role="alert"><p>{summary}{details.length>0&&<Root open={open} onOpenChange={setOpen} modal={false}>
  <Trigger asChild><Button type="button" variant="ghost" className="first-launch-error-trigger" aria-label={w('查看错误详情')} title={w('查看错误详情')}><span aria-hidden="true">!</span></Button></Trigger>
  <Portal>{centered?<Dialog.Content className="dialog-content device-error-dialog" aria-labelledby={titleId} aria-describedby={undefined}>{contents}</Dialog.Content>:<Popover.Content className="first-launch-error-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>{contents}</Popover.Content>}</Portal>
 </Root>}</p>{!compact&&!(browser&&manualUrlAvailable)&&<p>{impact}</p>}{!compact&&guidance&&<p>{w(guidance)}</p>}</div>;
}

/** First-launch presentation only. The caller owns native commands and status scheduling. */
export function FirstLaunchWizard({startupNotice,recover,recoveryEntry,view,context,refreshStatus,busy,checking=false,initialLoading=false,error,operationError,completed=false,begin,open,refresh,onNavigate,onDiagnostics,onRepair,onOpenHive}:FirstLaunchWizardProps){
 const recoveryTrigger=useRef<HTMLButtonElement|null>(null);
 const [recoveryDecision,setRecoveryDecision]=useState<'restart_pairing'|'cancel_pairing'|null>(null);

 const [hive,setHive]=useState(view?.hive||DEFAULT_HIVE),[name,setName]=useState(view?.name??'Bee Desktop');
 const [fieldErrors,setFieldErrors]=useState({hive:'',name:''});
 const [submitting,setSubmitting]=useState(false),submitted=useRef(false);
 const hiveInput=useRef<HTMLInputElement>(null),nameInput=useRef<HTMLInputElement>(null);
 const title=useRef<HTMLHeadingElement>(null);
 const [copyFailure,setCopyFailure]=useState<UiFailure|null>(null),[copied,setCopied]=useState('');
 const copyAttempt=useRef(0),mounted=useRef(true);
 const [now,setNow]=useState(Date.now());
 const transaction=view?.recovery,rawPhase=transaction?.phase??view?.state;
 const expectedState={awaiting_confirmation:'pairing',creating:'pairing',creation_unknown:'pairing',pending:'pending',draining:'draining',redeeming:'pairing',redemption_unknown:'pairing',awaiting_owner_confirmation:'pairing',saving:'pairing',completed:'bound',expired:'expired',blocked:'pairing'};
 const rejectedPhase=!!transaction&&(transaction.old_identity!==null||rawPhase==='awaiting_owner_confirmation'||view?.state!==expectedState[transaction.phase]);
 const required=transaction?.old_identity?'initial pairing without an old identity':rawPhase==='awaiting_owner_confirmation'?'initial pairing without owner adoption':transaction?expectedState[transaction.phase]:'';
 const phaseFailure:UiFailure|null=rejectedPhase?{code:'FIRST_LAUNCH_PHASE_INVALID',check:'first_launch_phase',observedAt:null,evidence:{actual:`${view?.state}/${rawPhase}`,required},message:currentLocale()==='en'?`Initial pairing cannot continue: device state=${view?.state}; phase=${rawPhase}; required=${required}.`:`首次绑定无法继续：设备状态=${view?.state}；事务阶段=${rawPhase}；要求=${required}。`}:null;
 const phase=rejectedPhase?'blocked':rawPhase;
 const pairing=view?.recovery?.pairing??(view?.user_code&&view.verification_url&&view.expires_at?{code:view.user_code,verification_url:view.verification_url,expires_at:view.expires_at}:null);
 const waiting=phase==='pending'||phase==='draining';
 const scope=[view?.recovery?.operation_id,phase,pairing?.verification_url,context?.binding_revision].join('|');
 const currentScope=useRef(scope);currentScope.current=scope;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;copyAttempt.current++;};},[]);
 const expired=!!pairing&&Date.parse(pairing.expires_at)<=now;
 const loading=initialLoading||!view&&!error;
 const form=!loading&&!error&&(view?.state==='unbound'||phase==='awaiting_confirmation'||phase==='creating');
 const creating=phase==='creating'||busy||submitting;
 const readBlocked=!loading&&!!error&&!view?.recovery&&!waiting;
 useEffect(()=>{if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 useEffect(()=>{if(form&&!creating)hiveInput.current?.focus({preventScroll:true});},[form]);
 const identity=view?.identity;
 const complete=completed&&view?.state==='bound'&&!!identity&&!!context&&!error&&!operationError&&!phaseFailure&&!transaction?.failure&&context.hive===view.hive&&view.name===identity.name&&context.device_id===identity.id&&context.owner_id===identity.owner_id&&(!transaction||(['id','name','owner_id','owner_email'] as const).every(key=>transaction.new_identity?.[key]===identity[key]));
 const transactionFailure=view?.recovery?.failure?normalizeFailure(view.recovery.failure,'device_pairing'):null;
 const failures=[error,operationError,transactionFailure,phaseFailure].filter((failure):failure is UiFailure=>!!failure);
 const showConfirmationUrl=!!copyFailure;
 const browserOpenFailed=!!operationError?.code.startsWith('BROWSER_');
 const needsRecoveryAction=['creation_unknown','redemption_unknown','blocked','expired'].includes(phase??'')||!!error||!!transactionFailure||!!phaseFailure||!!operationError&&!browserOpenFailed||refreshStatus?.state==='blocked';
 const savePermissionDenied=phase==='saving'&&!!transaction?.new_identity&&!!transactionFailure&&/\bEACCES\b/.test(transactionFailure.message)&&/config|device\.json/i.test(transactionFailure.message);
 const inlineDiagnostics=readBlocked||phase==='saving'&&!!transactionFailure;
 const diagnosticDetails=failures.map(failure=>presentFailure(failure,currentLocale()).details).join('\n\n');
 const failureNotices=failures.map((failure,index)=><WizardFailure key={`${phase}-${failure.code}-${index}`} failure={failure} summary={savePermissionDenied&&failure===transactionFailure?w('设备身份已确认，但系统拒绝保存配置（EACCES）。'):undefined} compact={phase==='saving'&&failure===transactionFailure} manualUrlAvailable={!!pairing&&waiting&&!expired}/>);
 useEffect(()=>{if(complete)title.current?.focus({preventScroll:true});},[complete]);
 useEffect(()=>{
  setNow(Date.now());if(!pairing)return;
  const delay=Date.parse(pairing.expires_at)-Date.now();
  if(delay<=0||delay>2147483647)return;
  const timer=setTimeout(()=>setNow(Date.now()),delay+1);return()=>clearTimeout(timer);
 },[pairing?.expires_at]);
 useEffect(()=>{copyAttempt.current++;setCopyFailure(null);setCopied('');},[scope]);
 const copy=async(value:string,label:string)=>{
  const attempt=++copyAttempt.current,requestScope=scope;
  const active=()=>mounted.current&&attempt===copyAttempt.current&&requestScope===currentScope.current;
  setCopyFailure(null);setCopied('');try{
   if(!navigator.clipboard?.writeText)throw new Error('clipboard.writeText unavailable; manual selection required');
   await navigator.clipboard.writeText(value);if(active())setCopied(label);
  }catch(cause){if(active())setCopyFailure(normalizeFailure(cause,'clipboard_write'));}
 };
 const status=refreshStatus?.state==='blocked'?'设备检查已暂停，请先处理当前问题，再重新检查设备。':refreshStatus?.state==='waiting'?'前次设备检查尚未结束，结果待确认。':error?refreshStatus?.nextRetryAt?'设备检查暂未完成，等待已安排的重试。':'设备状态尚未确认，请重新检查设备。':refreshStatus?.state==='reading'||refreshStatus?.state==='scheduled'?expired?'配对码有效期已到。Bee 正在向 Hive 确认最新状态，请稍等，结果会自动更新。':'完成网页确认后回到 Bee，此处会自动更新。':'设备状态尚未确认，请重新检查设备。';
 const stageCopy=phase==='draining'?'正在等待旧设备完成任务和结算。':phase==='redeeming'?'正在确认设备身份…':phase==='redemption_unknown'?'尚未确认绑定结果。Bee 只检查原事务，不会再次兑换。':phase==='creation_unknown'?'未取得原请求的配对凭据。请在 Hive 控制台核对设备记录，当前不能安全地重新生成配对码。':phase==='expired'?'Hive 已确认配对码过期。':phase==='blocked'||phase==='awaiting_owner_confirmation'?'设备绑定暂时无法继续，请查看具体原因并导出诊断。':'';
 const canCheck=phase==='completed'&&!complete&&failures.length>0||phase==='creation_unknown'||phase==='redemption_unknown'||waiting&&(!!error||refreshStatus?.state==='blocked'||refreshStatus?.state==='idle');
 useEffect(()=>{hiveInput.current?.focus();},[]);
 useEffect(()=>{if(!busy){submitted.current=false;setSubmitting(false);}},[busy,view,error,operationError]);
 const submit=(event:FormEvent)=>{
  event.preventDefault();if(busy||submitted.current)return;
  const address=typedHive(hive.trim()),deviceName=name.trim();
  const errors={hive:validateHive(address),name:!deviceName?'请填写设备名称。':/[\p{Cc}]/u.test(deviceName)?'设备名称不能包含控制字符。':[...deviceName].length>80?'设备名称最多为 80 个字符。':''};
  setFieldErrors(errors);if(errors.hive||errors.name){(errors.hive?hiveInput:nameInput).current?.focus();return;}
  submitted.current=true;setSubmitting(true);begin(address.replace(/\/$/,''),deviceName);
 };
 return <div className="first-launch-wizard"><a className="first-launch-skip" href="#first-launch-content">{w('跳到设备设置')}</a><header className="first-launch-brand" translate="no">Bee</header><main id="first-launch-content" className="first-launch-content">
  <h1 ref={title} tabIndex={-1}>{w(loading?'正在检查设备…':readBlocked?'无法确认设备状态':complete?'设备已绑定':'设置这台设备')}</h1>{startupNotice}{!loading&&!readBlocked&&<ol className="first-launch-steps" aria-label={w('设置步骤')}><li aria-current={form?'step':undefined} className={!form?'done':undefined}><span>{form?'1':'✓'}</span>{w('连接 Hive')}</li><li aria-current={!form&&!complete?'step':undefined} className={complete?'done':undefined}><span>{complete?'✓':'2'}</span>{w('绑定设备')}</li></ol>}
  {loading?<p role="status">{w('正在读取本机配置与设备状态…')}</p>:readBlocked?<>{failureNotices}<div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('重新检查设备')}</Button>{onRepair&&<Button type="button" variant="outline" onClick={onRepair}>{w('修复当前问题')}</Button>}<WizardDiagnosticExport details={diagnosticDetails}/></div></>:complete?<><dl className="first-launch-facts"><dt>{w('设备')}</dt><dd>{identity.name}</dd><dt>{w('归属账号')}</dt><dd>{identity.owner_email}</dd><dt>Hive</dt><dd>{view.hive}</dd></dl><h2>{w('下一步：接入 AI 账号')}</h2><p>{w('接入后才能使用该账号参与贡献。')}</p><div className="first-launch-actions"><Button type="button" onClick={()=>onNavigate('accounts')}>{w('前往接入 AI 账号')}</Button><Button type="button" variant="ghost" onClick={()=>onNavigate('overview')}>{w('进入概览')}</Button></div></>:form?<form noValidate onSubmit={submit}>
   <label htmlFor="first-launch-hive">{w('Hive 地址')}</label><input ref={hiveInput} id="first-launch-hive" name="hive" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://hive.example…" value={hive} disabled={creating} aria-invalid={!!fieldErrors.hive} aria-describedby="first-launch-hive-help first-launch-hive-error" onChange={event=>{setHive(event.target.value);setFieldErrors(current=>({...current,hive:''}));}}/>
   <p id="first-launch-hive-help" className="first-launch-help">{w('默认连接 TokHive 官方 Hive，也可以改为其他 Hive 地址。')}</p><p id="first-launch-hive-error" aria-live="polite" aria-atomic="true" className="first-launch-field-error">{w(fieldErrors.hive)}</p>
   <label htmlFor="first-launch-name">{w('设备名称')}</label><input ref={nameInput} id="first-launch-name" name="device-name" autoComplete="off" value={name} disabled={creating} aria-invalid={!!fieldErrors.name} aria-describedby="first-launch-name-help first-launch-name-error" onChange={event=>{setName(event.target.value);setFieldErrors(current=>({...current,name:''}));}}/>
   <p id="first-launch-name-help" className="first-launch-help">{w('用于在 Hive 中识别这台设备。')}</p><p id="first-launch-name-error" aria-live="polite" aria-atomic="true" className="first-launch-field-error">{w(fieldErrors.name)}</p>
   {failureNotices}
   <div className="first-launch-actions"><Button type="submit" disabled={creating} aria-busy={creating}>{w(creating?'正在创建配对请求…':'继续绑定设备')}</Button></div>
  </form>:<><h2>{w(phase==='saving'||phase==='redeeming'||phase==='redemption_unknown'?'正在完成设备绑定':phase==='creation_unknown'?'尚无法确认配对请求结果':phase==='draining'?'正在等待旧设备结束连接':phase==='blocked'||phase==='awaiting_owner_confirmation'?'设备绑定已阻塞':'在 Hive 网页确认设备归属')}</h2><dl className="first-launch-facts"><dt>Hive</dt><dd>{view?.hive}</dd><dt>{w('设备')}</dt><dd>{view?.name}</dd></dl>
   {pairing&&(waiting||phase==='expired')&&<><div className="first-launch-pair"><div><strong className="first-launch-code">{pairing.code}</strong><Button type="button" variant="ghost" onClick={()=>void copy(pairing.code,'配对码已复制')}>{w('复制配对码')}</Button></div><p className="first-launch-help" role={phase==='pending'&&expired?'status':undefined}>{phase==='expired'?w('Hive 已确认配对码过期'):phase==='pending'&&expired?w(status):<>{w('有效期至')} {new Intl.DateTimeFormat(currentLocale()==='zh'?'zh-CN':'en',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(pairing.expires_at))}</>}</p></div>
    {showConfirmationUrl&&!expired&&phase!=='expired'&&<p className="first-launch-url">{pairing.verification_url}</p>}
    {failureNotices}
    {!expired&&phase!=='expired'&&<><div className="first-launch-actions"><Button type="button" disabled={busy} onClick={()=>void open()}>{w(browserOpenFailed?'重新打开确认网页':'打开 Hive 确认网页')}</Button><Button type="button" variant="ghost" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}>{w('复制确认网址')}</Button></div></>}
    {phase==='pending'&&!expired&&<p className="first-launch-help" role="status">{w(status)}</p>}
   </>}
   {stageCopy&&!(phase==='expired'&&pairing)&&<div className={phase==='redeeming'?'first-launch-progress':undefined} role="status"><p>{w(stageCopy)}</p></div>}
   {phase==='creation_unknown'&&onOpenHive&&<div className="first-launch-actions"><Button type="button" disabled={busy} onClick={()=>void onOpenHive()}>{w('打开 Hive 控制台')}</Button></div>}
   {!(pairing&&(waiting||phase==='expired'))&&failureNotices}
   {canCheck&&<div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('重新检查设备')}</Button></div>}
   {needsRecoveryAction&&recover&&view?.recovery&&!['completed','saving','awaiting_owner_confirmation'].includes(view.recovery.phase)&&<div className="first-launch-actions">{phase!=='expired'&&<Button disabled={busy||checking} onClick={()=>void recover('continue_checking',view.recovery)}>{w('继续核对原请求')}</Button>}{(['creation_unknown','blocked','expired'].includes(view.recovery.phase)||expired&&phase==='pending')&&<Button variant={phase==='expired'?'default':'outline'} disabled={busy||checking} onClick={event=>{recoveryTrigger.current=event.currentTarget;setRecoveryDecision('restart_pairing');}}>{w(phase==='expired'||expired?'重新生成配对码':'重新配对')}</Button>}{phase!=='expired'&&<Button variant="outline" disabled={busy||checking} onClick={event=>{recoveryTrigger.current=event.currentTarget;setRecoveryDecision('cancel_pairing');}}>{w('取消本次重绑')}</Button>}</div>}
   {phase==='expired'&&!view?.recovery&&<div className="first-launch-actions"><Button type="button" disabled={busy||checking||submitting} onClick={()=>{if(submitted.current||!view?.hive||!view.name)return;submitted.current=true;setSubmitting(true);void begin(view.hive,view.name);}}>{w('重新生成配对码')}</Button></div>}
   {phase==='saving'&&<>{(!transactionFailure||checking)&&<div className="first-launch-progress" role="status"><p>{w(checking?'正在检查绑定结果并继续保存…':'正在保存设备配置…')}</p></div>}{transactionFailure&&<><p>{w(savePermissionDenied?'请恢复配置目录的写入权限，再点击“继续完成绑定”。Bee 会检查已有绑定结果并继续保存。':'请处理以上保存失败原因，再点击“继续完成绑定”。Bee 会检查已有绑定结果并继续保存。')}</p><div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('继续完成绑定')}</Button><WizardDiagnosticExport details={diagnosticDetails}/></div></>}</>}
   {copied&&<p role="status">{w(copied)}</p>}{copyFailure&&<WizardFailure failure={copyFailure}/>}
  </>}
  {!complete&&!inlineDiagnostics&&(failures.some(failure=>!failure.code.startsWith('BROWSER_'))||canCheck||phase==='blocked'||phase==='awaiting_owner_confirmation')&&onDiagnostics&&<div className="first-launch-actions"><Button type="button" variant="ghost" onClick={onDiagnostics}>{w('查看诊断')}</Button></div>}
 {recoveryEntry}
 <Dialog.Root open={!!recoveryDecision} onOpenChange={open=>{if(!open)setRecoveryDecision(null);}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onCloseAutoFocus={event=>{event.preventDefault();(recoveryTrigger.current?.isConnected?recoveryTrigger.current:title.current)?.focus();}}><Dialog.Title>{w(recoveryDecision==='cancel_pairing'?'取消本次重绑':'重新配对')}</Dialog.Title><Dialog.Description>{w(recoveryDecision==='cancel_pairing'?'取消后 Bee 停止后续替换；Hive 保留已完成的旧操作处理，旧设备不会自动恢复接单。':'Bee 先向 Hive 确认结束旧申请。若旧绑定已经成功，Bee 会恢复原成功结果，不再生成新码。')}</Dialog.Description>{operationError&&<WizardFailure failure={operationError}/>}<div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{w('返回设备设置')}</Button></Dialog.Close><Button disabled={busy||checking} onClick={async()=>{if(recoveryDecision&&await recover?.(recoveryDecision,view?.recovery))setRecoveryDecision(null);}}>{w(recoveryDecision==='cancel_pairing'?'确认取消重绑':'确认重新配对')}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
 </main></div>;
}
