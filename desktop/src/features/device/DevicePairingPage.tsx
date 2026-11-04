import {formatDate,formatNumber,currentLocale,t} from '../../i18n/index';
import {FailureNotice} from '../../components/ProblemNotice';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import type {DeviceView,DeviceRecoveryView,DeviceContext} from '../../system/device';
import type {RefreshStatus} from '../../system/desktopState';
import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {Copy,ExternalLink,RefreshCw} from 'lucide-react';
import {Button} from '../../components/ui';
type Decision='begin_pairing'|'adopt_owner'|'renew_expired';
const phaseCopy={awaiting_confirmation:'等待确认后生成配对码',creating:'正在创建配对请求',creation_unknown:'创建结果未知',pending:'等待网页确认',draining:'等待旧设备完成任务和结算',redeeming:'兑换已提交，正在核对新设备身份',redemption_unknown:'兑换结果未知，正在核对新设备身份',awaiting_owner_confirmation:'新设备归属与原设备不同',saving:'新设备身份已核对，正在保存本机配置',completed:'上次重新绑定已完成，未自动开始贡献。',expired:'Hive 已确认配对码过期',blocked:'设备配对暂时无法继续'};
export function DevicePairingPage({view,context,recovery,recoveryError,refreshStatus,busy:writing,checking=false,initialLoading=false,error,operationError,begin,refresh,open,recover,onNavigate}:{
 view?:DeviceView;context?:DeviceContext;recovery?:DeviceRecoveryView;recoveryError?:UiFailure|null;refreshStatus?:RefreshStatus;busy:boolean;checking?:boolean;initialLoading?:boolean;error:UiFailure|null;operationError?:UiFailure|null;onNavigate?:(target:NavigationTarget)=>void;
 begin:(hive:string,name:string)=>void;refresh:()=>void;open:()=>void;recover?:(decision:Decision,transaction?:DeviceRecoveryView)=>Promise<boolean>;
}) {
 const [hive,setHive]=useState(''),[name,setName]=useState('Bee Desktop');
 const [now,setNow]=useState(Date.now()),[copied,setCopied]=useState(''),[copyError,setCopyError]=useState<UiFailure|null>(null);
 const [confirmation,setConfirmation]=useState<{decision:Decision;transaction?:DeviceRecoveryView}|null>(null);
 const [confirmationSubmitted,setConfirmationSubmitted]=useState(false);
 const confirmationTrigger=useRef<HTMLButtonElement|null>(null);
 const deviceSection=useRef<HTMLElement|null>(null);
 const confirmationFailure=useRef<HTMLDivElement|null>(null);
 const failedConfirmation=confirmationSubmitted?operationError:null;
 const ask=(trigger:HTMLButtonElement,decision:Decision,transaction?:DeviceRecoveryView)=>{confirmationTrigger.current=trigger;setConfirmationSubmitted(false);setConfirmation({decision,transaction});};
 useEffect(()=>{if(confirmation&&failedConfirmation)confirmationFailure.current?.focus();},[confirmation,failedConfirmation]);
 const submitConfirmation=async()=>{
  if(!confirmation||busy||!recover)return;
  const request=confirmation;setConfirmationSubmitted(true);
  if(await recover(request.decision,request.transaction))setConfirmation(current=>current===request?null:current);
 };
 useEffect(()=>{if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 const transaction=recovery??view?.recovery,credentialRecovery=!!recovery;
 const pairing=transaction?.phase==='completed'?null:transaction?.pairing??(view?.user_code&&view.verification_url&&view.expires_at?{code:view.user_code,verification_url:view.verification_url,expires_at:view.expires_at}:null);
 useEffect(()=>{if(!pairing)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pairing?.expires_at]);
 const seconds=pairing?Math.max(0,Math.ceil((Date.parse(pairing.expires_at)-now)/1000)):0;
 const knownIdentity=view?.identity;
 const busy=writing||checking||initialLoading;
 const confirmed=!!knownIdentity&&!error;
 const phase=transaction?.phase??(view?.state==='pending'||view?.state==='draining'||view?.state==='expired'?view.state:null);
 const waiting=phase==='pending'||phase==='draining';
 const canRecover=!!recover&&!recoveryError&&(!transaction||transaction.phase==='completed')&&!!context&&['device_replaced','invalid_device_credential'].includes(error?.code??'');
 const copy=async(value:string,label:string)=>{
  setCopyError(null);setCopied('');try{if(!navigator.clipboard?.writeText)throw new Error('clipboard.writeText unavailable; manual selection required');await navigator.clipboard.writeText(value);setCopied(label);}catch(cause){setCopyError(normalizeFailure(cause,'clipboard_write'));}
 };
 const statusCopy=refreshStatus?.state==='waiting'?'前次核对尚未结束，结束后重试。':refreshStatus?.state==='blocked'?'设备核对已暂停，需先处理当前问题。':refreshStatus?.state==='scheduled'?'等待已安排的设备核对。':'设备状态待确认。';
 return <section ref={deviceSection} tabIndex={-1} className="native-device-summary device-pairing" aria-label={t('设备配对')}>
  <div className="device-section-heading"><h2>{t(view?.state==='unbound'&&!error?'连接本机设备':'本机设备')}</h2><Button variant="outline" disabled={writing||initialLoading} aria-disabled={checking||undefined} aria-busy={checking} onClick={()=>{if(!busy)refresh();}}><RefreshCw className={checking?'device-refreshing':undefined} aria-hidden="true"/>{t('重新核对设备')}</Button></div>
  {initialLoading?<div className="device-facts device-loading" role="status" aria-label={t('正在读取设备与账号状态')}>{['本机设备','归属账号','Hive'].map(label=><div key={label} aria-hidden="true"><p>{t(label)}</p><strong className="device-skeleton-line"/><small className="device-skeleton-line"/></div>)}</div>:knownIdentity?<div className="device-facts">
   <div><p>{t('本机设备')}</p><strong>{knownIdentity.name}</strong><small role="status">{t(confirmed?'设备已绑定。':'上次确认的设备，当前待核对。')}</small></div>
   <div><p>{t('归属账号')}</p><strong>{knownIdentity.owner_email}</strong><small>{t('设备所属账号')}</small></div>
   <div><p>Hive</p><strong>{view.hive}</strong><small>{t('配对不会自动开始贡献')}</small></div>
  </div>:context?.device_id?<p className="saved-device-context">{t('上次保存的设备信息')}：{context.name} · {context.hive}</p>:null}
  {error&&<FailureNotice failure={error} check="device_status" onNavigate={onNavigate}/>}
  {recoveryError&&recoveryError!==error&&<FailureNotice failure={recoveryError} check="device_recovery_status" onNavigate={onNavigate}/>}
  {transaction||phase?<div className="device-transaction">
   <div className="device-transaction-heading"><p className="pairing-phase" role="status">{t(phase==='saving'&&transaction?.failure?'本机保存未完成，需重新核对':phaseCopy[phase!])}</p>{pairing&&waiting&&<Button disabled={busy||seconds===0} onClick={open}>{t('打开 Hive 确认网页')}<ExternalLink aria-hidden="true"/></Button>}</div>
   {phase==='awaiting_confirmation'&&<><p>{t('此请求尚未提交；确认后才会生成配对码。')}</p>{credentialRecovery?<Button disabled={busy||!!recoveryError} onClick={event=>ask(event.currentTarget,'begin_pairing',transaction)}>{t('重新绑定设备')}</Button>:<Button disabled={busy} onClick={()=>begin(view!.hive!,view!.name!)}>{t('继续生成配对码')}</Button>}</>}
   {phase==='creating'&&<p>{t('正在处理已保存的请求，请勿重复创建。')}</p>}
   {phase==='creation_unknown'&&<p>{t('未取得原请求的配对凭据，不能重新创建。请在 Hive 控制台核对并导出诊断。')}</p>}
   {(phase==='redeeming'||phase==='redemption_unknown')&&<p>{t('只核对原事务，不会重新兑换；网页已批准不代表本机已经保存。')}</p>}
   {phase==='saving'&&<p>{t('新身份与归属已确认；本机保存尚未完成，重新核对原事务可继续保存。')}</p>}
   {phase==='blocked'&&<p>{t('请先处理下方的具体失败，再重新核对原事务。')}</p>}
   {phase==='awaiting_owner_confirmation'&&transaction&&<><div className="recovery-identities"><div><p>{t('原归属账号')}</p><strong>{transaction.old_identity?.owner_email}</strong></div><div><p>{t('新归属账号')}</p><strong>{transaction.new_identity?.owner_email}</strong></div></div><p>{t('采用新归属后，旧账号选择与运行意图不会迁移。')}</p><Button disabled={busy||!!recoveryError} onClick={event=>ask(event.currentTarget,'adopt_owner',transaction)}>{t('确认采用新归属')}</Button></>}
   {pairing&&<><div className="device-pairing-grid">
    <div><p>{t('配对码')}</p><strong className="pair-code">{pairing.code}</strong><Button variant="outline" onClick={()=>void copy(pairing.code,'配对码已复制')}><Copy aria-hidden="true"/>{t('复制配对码')}</Button></div>
    <div><p>{t('有效期至')}</p><strong>{formatDate(pairing.expires_at,currentLocale())}</strong><small>{seconds>0?t('剩余 {seconds} 秒',{seconds:formatNumber(seconds,currentLocale())}):t('配对码有效期已到，等待 Hive 核对是否过期。')}</small></div>
   </div><p className="device-url">{pairing.verification_url}</p><div className="inline-actions"><Button variant="outline" onClick={()=>void copy(pairing.verification_url,'确认网址已复制')}><Copy aria-hidden="true"/>{t('复制确认网址')}</Button></div><p className="device-note">{t('完成网页确认后，请回到 Bee。')}{' '}{t('网页无法打开时，可手动复制上方网址；当前请求会保留。')}</p></>}
   {phase==='expired'&&<><p>{t('旧配对已确认过期；重新生成需由你发起。')}</p><Button disabled={busy||!!recoveryError} onClick={event=>credentialRecovery?ask(event.currentTarget,'renew_expired',transaction):begin(view!.hive!,view!.name!)}>{t('重新生成配对码')}</Button></>}
   {transaction?.failure&&<FailureNotice failure={transaction.failure} check="device_recovery" onNavigate={onNavigate}/>}
  </div>:view?.state==='unbound'&&!error&&!recoveryError?<><p>{t('在 Hive 网页确认这台设备的归属；绑定不会开始贡献。')}</p><form className="settings-form" onSubmit={event=>{event.preventDefault();if(!busy)begin(hive.trim(),name.trim());}}>
   <label>{t('Hive 地址')}<input type="url" required placeholder="https://hive.example" value={hive} disabled={busy} onChange={event=>setHive(event.target.value)}/></label>
   <label>{t('设备名称')}<input required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
   <Button disabled={busy||!hive.trim()||!name.trim()} type="submit">{t('生成配对码')}</Button>
  </form><p className="feature-note">{t('设备配置独立保存，不覆盖 CLI；已有设备的替换请在 Hive 网页核对后确认。')}</p></>:!initialLoading&&!knownIdentity&&!error&&!recoveryError?<p role="status">{t(statusCopy)}</p>:null}
  {canRecover&&<div className="device-recovery-action"><p>{t('原凭据已明确撤销。重新绑定需再次在 Hive 网页确认，完成后贡献保持停止。')}</p><Button disabled={busy} onClick={event=>ask(event.currentTarget,'begin_pairing')}>{t('重新绑定设备')}</Button></div>}
  {copied&&<p className="device-note" role="status">{t(copied)}</p>}{copyError&&<FailureNotice failure={copyError} check="clipboard_write"/>}
  <Dialog.Root open={!!confirmation} onOpenChange={value=>{if(!value)setConfirmation(null);}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onCloseAutoFocus={event=>{event.preventDefault();const trigger=confirmationTrigger.current;(trigger?.isConnected&&!trigger.disabled?trigger:deviceSection.current)?.focus({preventScroll:true});}}>
   <Dialog.Title>{t(confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='renew_expired'?'重新生成配对码':'重新绑定设备')}</Dialog.Title>
   <Dialog.Description>{t(confirmation?.decision==='adopt_owner'?'请确认采用上方的新归属账号。旧账号选择与运行意图不会迁移，贡献保持停止。':'确认后生成新的配对请求，仍需在 Hive 网页确认归属及设备替换；完成后贡献保持停止。')}</Dialog.Description>
   {confirmation?.decision==='adopt_owner'&&<p>{confirmation.transaction?.old_identity?.owner_email} → {confirmation.transaction?.new_identity?.owner_email}</p>}
   {failedConfirmation?<div ref={confirmationFailure} tabIndex={-1} data-recovery-failure><FailureNotice failure={failedConfirmation} check="device_recovery_confirm"/></div>:confirmationSubmitted&&busy&&<p role="status">{t('正在处理设备恢复，请稍候…')}</p>}
   <div className="dialog-actions"><Dialog.Close asChild><Button variant="outline">{t(failedConfirmation?'返回设备核对':confirmationSubmitted?'关闭':'取消')}</Button></Dialog.Close>
    {!failedConfirmation&&<Button disabled={busy||!recover} onClick={()=>void submitConfirmation()}>{t(confirmationSubmitted&&busy?'正在处理…':confirmation?.decision==='adopt_owner'?'确认采用新归属':confirmation?.decision==='renew_expired'?'确认重新生成':'确认重新绑定')}</Button>}
   </div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
