import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import type {DeviceView,DeviceContext} from '../../system/device';
import type {RefreshStatus} from '../../system/desktopState';
import {normalizeFailure,safeFailureText,safeOrigin,type UiFailure} from '../../system/failures';
import {currentLocale,formatDate} from '../../i18n';
import {Button} from '../../components/ui';
import {Popover} from 'radix-ui';
import {CircleAlert} from 'lucide-react';
import {wizardText as w} from './first-launch-copy';
import './first-launch-wizard.css';

export interface FirstLaunchWizardProps {
 view?:DeviceView;context?:DeviceContext;refreshStatus?:RefreshStatus;
 initialLoading?:boolean;busy:boolean;checking?:boolean;
 error:UiFailure|null;operationError?:UiFailure|null;completed?:boolean;
 begin:(hive:string,name:string)=>void|Promise<unknown>;
 refresh:()=>void|Promise<unknown>;open:()=>void|Promise<unknown>;
 onNavigate:(page:'accounts'|'overview')=>void;
 onDiagnostics?:()=>void;onRepair?:()=>void;
}

function validateHive(raw:string):string {
 if(!raw)return '请填写 Hive 地址。';
 let url:URL;try{url=new URL(raw);}catch{return 'Hive 地址须为完整的 HTTPS 网址。';}
 if(url.username||url.password||raw.includes('@'))return 'Hive 地址不能包含用户名或密码。';
 if(url.pathname!=='/'||url.search||url.hash||/[?#]/.test(raw))return 'Hive 地址不能包含路径、查询参数或片段。';
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&safeOrigin(raw.replace(/\/$/,''))))return '远程 Hive 必须使用 HTTPS；HTTP 仅限本机回环地址。';
 if(!/^https?:\/\/[^/?#@\\\s]+\/?$/.test(raw))return 'Hive 地址须为完整的 HTTPS 网址。';
 return '';
}

function WizardFailure({failure}:{failure:UiFailure}){
 const [open,setOpen]=useState(false),titleId=useId();
 const details=[failure.code,failure.check,failure.observedAt,...Object.entries(failure.evidence).map(([key,value])=>`${key}: ${safeFailureText(value)}`)].filter(Boolean).join('\n');
 useEffect(()=>setOpen(false),[details]);
 return <div className="first-launch-failure" role="alert"><p>{safeFailureText(failure.message)}{(failure.observedAt||Object.keys(failure.evidence).length>0)&&<Popover.Root open={open} onOpenChange={setOpen}>
  <Popover.Trigger asChild><Button type="button" variant="ghost" className="first-launch-error-trigger" aria-label={w('查看错误详情')} title={w('查看错误详情')}><CircleAlert aria-hidden="true"/></Button></Popover.Trigger>
  <Popover.Portal><Popover.Content className="first-launch-error-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
   <header><h3 id={titleId}>{w('错误详情')}</h3><Popover.Close asChild><Button type="button" variant="ghost" aria-label={w('关闭错误详情')}>{w('关闭')}</Button></Popover.Close></header><pre>{details}</pre>
  </Popover.Content></Popover.Portal>
 </Popover.Root>}</p></div>;
}

/** First-launch presentation only. The caller owns native commands and status scheduling. */
export function FirstLaunchWizard({view,context,refreshStatus,busy,checking=false,initialLoading=false,error,operationError,completed=false,begin,open,refresh,onNavigate,onDiagnostics,onRepair}:FirstLaunchWizardProps){
 const [hive,setHive]=useState(view?.hive??''),[name,setName]=useState(view?.name??'Bee Desktop');
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
 const complete=completed&&view?.state==='bound'&&!!identity&&!!context&&!error&&!operationError&&!phaseFailure&&!transaction?.failure&&context.hive===view.hive&&context.name===view.name&&context.name===identity.name&&context.device_id===identity.id&&context.owner_id===identity.owner_id;
 const transactionFailure=view?.recovery?.failure?normalizeFailure(view.recovery.failure,'device_pairing'):null;
 const failures=[error,operationError,transactionFailure,phaseFailure].filter((failure):failure is UiFailure=>!!failure);
 const failureNotices=failures.map((failure,index)=><WizardFailure key={`${phase}-${failure.code}-${index}`} failure={failure}/>);
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
 const canCheck=phase==='creation_unknown'||phase==='redemption_unknown'||waiting&&(!!error||refreshStatus?.state==='blocked'||refreshStatus?.state==='idle');
 useEffect(()=>{hiveInput.current?.focus();},[]);
 useEffect(()=>{if(!busy){submitted.current=false;setSubmitting(false);}},[busy,view,error,operationError]);
 const submit=(event:FormEvent)=>{
  event.preventDefault();if(busy||submitted.current)return;
  const address=hive.trim(),deviceName=name.trim();
  const errors={hive:validateHive(address),name:!deviceName?'请填写设备名称。':/[\p{Cc}]/u.test(deviceName)?'设备名称不能包含控制字符。':[...deviceName].length>80?'设备名称最多为 80 个字符。':''};
  setFieldErrors(errors);if(errors.hive||errors.name){(errors.hive?hiveInput:nameInput).current?.focus();return;}
  submitted.current=true;setSubmitting(true);begin(address.replace(/\/$/,''),deviceName);
 };
 return <div className="first-launch-wizard"><a className="first-launch-skip" href="#first-launch-content">{w('跳到设备设置')}</a><header className="first-launch-brand" translate="no">Bee</header><main id="first-launch-content" className="first-launch-content">
  <h1 ref={title} tabIndex={-1}>{w(loading?'正在检查设备…':readBlocked?'无法确认设备状态':complete?'设备已绑定':'设置这台设备')}</h1>{!loading&&!readBlocked&&<ol className="first-launch-steps" aria-label={w('设置步骤')}><li aria-current={form?'step':undefined} className={!form?'done':undefined}><span>{form?'1':'✓'}</span>{w('连接 Hive')}</li><li aria-current={!form&&!complete?'step':undefined} className={complete?'done':undefined}><span>{complete?'✓':'2'}</span>{w('绑定设备')}</li></ol>}
  {loading?<p role="status">{w('正在读取本机配置与设备状态…')}</p>:readBlocked?<>{failureNotices}<div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('重新检查设备')}</Button>{onRepair&&<Button type="button" variant="outline" onClick={onRepair}>{w('修复当前问题')}</Button>}</div></>:complete?<><dl className="first-launch-facts"><dt>{w('设备')}</dt><dd>{identity.name}</dd><dt>{w('归属账号')}</dt><dd>{identity.owner_email}</dd><dt>Hive</dt><dd>{view.hive}</dd></dl><h2>{w('下一步：接入 AI 账号')}</h2><p>{w('接入后才能使用该账号参与贡献。')}</p><div className="first-launch-actions"><Button type="button" onClick={()=>onNavigate('accounts')}>{w('前往接入 AI 账号')}</Button><Button type="button" variant="ghost" onClick={()=>onNavigate('overview')}>{w('进入概览')}</Button></div></>:form?<form noValidate onSubmit={submit}>
   <label htmlFor="first-launch-hive">{w('Hive 地址')}</label><input ref={hiveInput} id="first-launch-hive" name="hive" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://hive.example…" value={hive} disabled={creating} aria-invalid={!!fieldErrors.hive} aria-describedby="first-launch-hive-help first-launch-hive-error" onChange={event=>{setHive(event.target.value);setFieldErrors(current=>({...current,hive:''}));}}/>
   <p id="first-launch-hive-help" className="first-launch-help">{w('填写你要连接的 Hive 服务地址。')}</p><p id="first-launch-hive-error" className="first-launch-field-error">{w(fieldErrors.hive)}</p>
   <label htmlFor="first-launch-name">{w('设备名称')}</label><input ref={nameInput} id="first-launch-name" name="device-name" autoComplete="off" value={name} disabled={creating} aria-invalid={!!fieldErrors.name} aria-describedby="first-launch-name-help first-launch-name-error" onChange={event=>{setName(event.target.value);setFieldErrors(current=>({...current,name:''}));}}/>
   <p id="first-launch-name-help" className="first-launch-help">{w('用于在 Hive 中识别这台设备。')}</p><p id="first-launch-name-error" className="first-launch-field-error">{w(fieldErrors.name)}</p>
   {failureNotices}
   <div className="first-launch-actions"><Button type="submit" disabled={creating} aria-busy={creating}>{w(creating?'正在创建配对请求…':'继续绑定设备')}</Button></div>
  </form>:<><h2>{w(phase==='saving'||phase==='redeeming'||phase==='redemption_unknown'?'正在完成设备绑定':phase==='creation_unknown'?'尚无法确认配对请求结果':phase==='draining'?'正在等待旧设备结束连接':phase==='blocked'||phase==='awaiting_owner_confirmation'?'设备绑定已阻塞':'在 Hive 网页确认设备归属')}</h2><dl className="first-launch-facts"><dt>Hive</dt><dd>{view?.hive}</dd><dt>{w('设备')}</dt><dd>{view?.name}</dd></dl>
   {pairing&&waiting&&<><div className="first-launch-pair"><div><strong className="first-launch-code">{pairing.code}</strong><Button type="button" variant="outline" onClick={()=>void copy(pairing.code,'配对码已复制')}>{w('复制配对码')}</Button></div><p className="first-launch-help">{w('有效期至')} {formatDate(pairing.expires_at,currentLocale())}</p></div>
    {!expired&&<><div className="first-launch-actions"><Button type="button" disabled={busy} onClick={()=>void open()}>{w('打开 Hive 确认网页')}</Button><Button type="button" variant="ghost" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}>{w('复制确认网址')}</Button></div><p className="first-launch-url">{pairing.verification_url}</p></>}
    {phase==='pending'&&<p role="status">{w(status)}</p>}
   </>}
   {stageCopy&&<p role="status">{w(stageCopy)}</p>}
   {failureNotices}
   {canCheck&&<div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('重新检查设备')}</Button></div>}
   {phase==='expired'&&<div className="first-launch-actions"><Button type="button" disabled={busy||checking||submitting} onClick={()=>{if(submitted.current||!view?.hive||!view.name)return;submitted.current=true;setSubmitting(true);void begin(view.hive,view.name);}}>{w('重新生成配对码')}</Button></div>}
   {phase==='saving'&&<><p role="status">{w(checking?'正在检查绑定结果并继续保存…':transactionFailure?'设备身份已确认，本机保存尚未完成。':'正在保存设备配置…')}</p>{transactionFailure&&<><p>{w('请处理以上保存失败原因，再点击“继续完成绑定”。Bee 会检查已有绑定结果并继续保存。')}</p><div className="first-launch-actions"><Button type="button" disabled={busy||checking} onClick={()=>void refresh()}>{w('继续完成绑定')}</Button></div></>}</>}
   {copied&&<p role="status">{w(copied)}</p>}{copyFailure&&<WizardFailure failure={copyFailure}/>}
  </>}
  {!complete&&(failures.length>0||canCheck||phase==='blocked'||phase==='awaiting_owner_confirmation')&&onDiagnostics&&<div className="first-launch-actions"><Button type="button" variant="ghost" onClick={onDiagnostics}>{w('导出诊断')}</Button></div>}
 </main></div>;
}
