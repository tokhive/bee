import {safeOrigin} from '../../../src/system/failures.ts';
const clone=value=>structuredClone(value);
const stamp=offset=>new Date(Date.now()+offset).toISOString();
const operationId=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16);
const failure=(code,message,check,evidence={})=>({code,message,details:{check,observed_at:stamp(0),evidence:{actual:message,...evidence}}});
const rejected=(code,message,check,evidence)=>({result:{error:failure(code,message,check,evidence)}});
const controlError=(code,message)=>Object.assign(new Error(code+': '+message),{code});
const initialPhases={'device-awaiting-confirmation':'awaiting_confirmation','device-creating':'creating','device-creation-unknown':'creation_unknown','device-pending':'pending','device-draining':'draining','device-redeeming':'redeeming','device-redemption-unknown':'redemption_unknown','device-saving':'saving','device-expired':'expired'};
const recoveryPhases={'recovery-pending':'pending','recovery-draining':'draining','recovery-creation-unknown':'creation_unknown','recovery-redemption-unknown':'redemption_unknown','recovery-owner':'awaiting_owner_confirmation','recovery-saving':'saving','recovery-completed':'completed'};

// External controls change Hive facts; status reads reconcile the saved transaction.
export function createPreviewDeviceSession({scene,origin,current,instance,onConfigurationChanged,onCompleted,onRevoked}){
 const w=window,isInitial=scene.startsWith('device-')&&!['device-bound','device-error','device-recovery-confirm','device-revoked-source-missing'].includes(scene);
 let savedHive=scene==='device-unbound'||scene==='device-loading'?'':origin,name='Bee Desktop',identity=isInitial?null:{id:'dev-1',name,owner_id:'owner-1',owner_email:'owner@example.test'};
 let revoked=['device-recovery-confirm','device-revoked-source-missing','startup-blocked'].includes(scene)||scene.startsWith('recovery-')&&scene!=='recovery-completed';
 let transaction=null,accepted=[],approved=false,redeemAttempted=false,pairingSequence=0,identitySequence=1;
 const pair=()=>{const code=['ABCD-EFGH','BCDE-FGHJ','CDEF-GHJK'][pairingSequence++%3];return {code,verification_url:savedHive+'/devices/pair?code='+code,expires_at:stamp(600000)};};
 const makeTransaction=(phase,oldIdentity)=>({operation_id:operationId(),revision:1,phase,old_identity:clone(oldIdentity),new_identity:null,pairing:null,failure:null});
 const phase=initialPhases[scene]??recoveryPhases[scene];
 if(phase){
  transaction=makeTransaction(phase,scene.startsWith('recovery-')?identity:null);
  if(['pending','draining','redeeming','redemption_unknown','expired'].includes(phase))transaction.pairing=pair();
  if(phase==='expired')transaction.pairing.expires_at=stamp(-60000);
  if(['saving','completed','awaiting_owner_confirmation'].includes(phase))transaction.new_identity={id:'dev-2',name,owner_id:'owner-2',owner_email:'new-owner@example.test'};
  if(['creating','creation_unknown'].includes(phase))transaction.failure=failure('DEVICE_RECOVERY_BLOCKED','pairing creation result unknown without token; original POST cannot be repeated; required=verify original request in Hive console','device_recovery_create');
  if(phase==='saving')transaction.failure=failure('DEVICE_RECOVERY_BLOCKED','atomic local save failed: kind=PermissionDenied os_code=13; phase=saving; required=private configuration writable','device_recovery_save');
  redeemAttempted=['redeeming','redemption_unknown','saving','completed','awaiting_owner_confirmation'].includes(phase);
 }
 const context=()=>({deviceId:identity?.id??null,bindingRevision:w.bindingRevision??1,...transaction?{operationId:transaction.operation_id,expectedRevision:transaction.revision}:{}});
 const requireCurrent=request=>{if(!current()||request.session!==w.__beePreviewSession)throw controlError('PREVIEW_SESSION_STALE','device event received_session='+request.session+'; required_session='+w.__beePreviewSession+'; required=current fixture generation');};
 const requireTransaction=request=>{if(!transaction||request.operationId!==transaction.operation_id||request.expectedRevision!==transaction.revision)throw controlError('PREVIEW_DEVICE_STALE','received='+request.operationId+':'+request.expectedRevision+'; current='+transaction?.operation_id+':'+transaction?.revision+'; required=current device transaction');};
 const approve=request=>{
  requireCurrent(request);
  if(request.value!=='approve')throw controlError('PREVIEW_CONTROL_INVALID','action=device-approval; value='+request.value+'; required=approve');
  requireTransaction(request);
  if(!transaction.pairing||!['pending','draining','redeeming','redemption_unknown'].includes(transaction.phase))throw controlError('PREVIEW_DEVICE_PHASE','phase='+transaction.phase+'; token_present='+!!transaction.pairing+'; required=pending/draining original pairing or new-credential identity observation');
  approved=true;
  return {message:'模拟 Hive 已批准原配对；正式页面将在下一次核对时读取原事务结果。'};
 };
 const alias=()=>{const request={session:w.__beePreviewSession,value:'approve',...context()};w.__beePreviewApprove=()=>approve(request);};
 const changed=(next,extra={})=>{transaction={...transaction,...extra,phase:next,revision:transaction.revision+1};alias();};
 const complete=()=>{
  identity=clone(transaction.new_identity);identitySequence=Math.max(identitySequence,Number(identity.id.slice(4))||1);revoked=false;
  changed('completed',{failure:null});onCompleted();
 };
 if(phase==='completed'){identity=clone(transaction.new_identity);identitySequence=2;onCompleted();}
 w.__beeMockDeviceContext=context;
 w.__beeMockControls['device-approval']=approve;
 w.__beeMockControls['device-credential']=request=>{
  requireCurrent(request);
  if(request.value!=='revoke')throw controlError('PREVIEW_CONTROL_INVALID','action=device-credential; value='+request.value+'; required=revoke');
  if(request.deviceId!==identity?.id||request.bindingRevision!==(w.bindingRevision??1))throw controlError('PREVIEW_DEVICE_BINDING_STALE','received='+request.deviceId+':'+request.bindingRevision+'; current='+identity?.id+':'+(w.bindingRevision??1)+'; required=current saved binding');
  if(transaction)requireTransaction(request);
  if(!identity||transaction&&transaction.phase!=='completed')throw controlError('PREVIEW_DEVICE_PHASE','credential event phase='+(transaction?.phase??'none')+'; device_present='+!!identity+'; required=bound device without unresolved pairing');
  revoked=true;onRevoked();
  return {message:'模拟 Hive 已撤销当前设备凭据；请在正式页面核对并确认恢复。'};
 };
 alias();
 const advance=()=>{
  if(!transaction)return;
  if(transaction.phase==='creating'){changed('creation_unknown');return;}
  if(['pending','draining'].includes(transaction.phase)&&Date.parse(transaction.pairing.expires_at)<=Date.now()&&!redeemAttempted){approved=false;changed('expired',{failure:null});return;}
  if(!approved||!['pending','draining','redeeming','redemption_unknown'].includes(transaction.phase))return;
  approved=false;redeemAttempted=true;
  const nextIdentity={id:'dev-'+(++identitySequence),name,owner_id:'owner-'+identitySequence,owner_email:'new-owner@example.test'};
  changed(transaction.old_identity&&transaction.old_identity.owner_id!==nextIdentity.owner_id?'awaiting_owner_confirmation':'saving',{new_identity:nextIdentity,failure:null});
  if(transaction.phase==='saving')complete();
 };
 const device=()=>{
  if(transaction&&!transaction.old_identity){
   const state=transaction.phase==='completed'?'bound':['pending','draining','expired'].includes(transaction.phase)?transaction.phase:'pairing';
   return {state,hive:savedHive,name,...state==='bound'?{identity:clone(identity)}:{},...['pending','draining'].includes(state)?{user_code:transaction.pairing.code,verification_url:transaction.pairing.verification_url,expires_at:transaction.pairing.expires_at,poll_interval_seconds:2}:{},recovery:clone(transaction)};
  }
  return identity?{state:'bound',hive:savedHive,name,identity:clone(identity)}:{state:'unbound'};
 };
 const admission=()=>{
  const local=w.__beeMockRuntimeLocal();
  if(local!=='stopped')return 'device recovery local='+local+'; required=stopped before replacement';
  const pending=Object.entries(w.accounts).find(([,a])=>a.operation&&['pending','running','reconciling'].includes(a.operation.state));
  return pending?'device recovery blocked by pending account operation: platform='+pending[0]+'; state='+pending[1].operation.state:null;
 };
 const commands=new Set(['device_context','device_begin','device_status','device_open','device_recovery_prepare','device_recovery_confirm','device_recovery_status','startup_status','startup_recheck']);
 return {
  binding:()=>({hive:savedHive||origin,device_id:identity?.id??null,owner_id:identity?.owner_id??null}),
  writeBarrier:()=>transaction&&transaction.phase!=='completed'?{phase:transaction.phase,revision:transaction.revision}:null,
  handles:command=>commands.has(command),
  async invoke(command,args={}){
   if(!current())return rejected('PREVIEW_SESSION_STALE','device preview request belongs to an earlier fixture; required=current session',command);
   w.calls.push({command,args});
   if(command==='startup_status'||command==='startup_recheck')return {state:revoked?'blocked':'ready',failure:revoked?failure('device_replaced','GET /api/bee/identity HTTP 401 device_replaced; saved credential rejected','startup_identity'):null,instance,binding_revision:w.bindingRevision??1,network_revision:w.networkRevision??0,observed_at:stamp(0),revision:w.__beeMockRuntimeContext().revision};
   if(command==='device_context')return savedHive?{result:{context:{hive:savedHive,name,device_id:identity?.id??null,owner_id:identity?.owner_id??null,binding_revision:w.bindingRevision??1}}}:{result:{binding_revision:w.bindingRevision??1,error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'saved desktop binding absent; required=configured Hive and device'}}};
   if(command==='device_recovery_prepare'){
    const blocked=admission();if(blocked)return rejected('DEVICE_RECOVERY_PRECONDITION',blocked,command);
    if(transaction&&transaction.phase!=='completed')return transaction.old_identity?{result:{recovery:clone(transaction)}}:rejected('DEVICE_RECOVERY_PRECONDITION','initial pairing already occupies saved device transaction; original transaction preserved',command);
    if(!identity)return rejected('DEVICE_RECOVERY_PRECONDITION','credential recovery requires saved bound identity; identity_present=false',command);
    if(!revoked)return rejected('DEVICE_RECOVERY_PRECONDITION','device credential remains accepted; required=HTTP 401 device_replaced or invalid_device_credential before replacement',command);
    transaction=makeTransaction('awaiting_confirmation',identity);accepted=[];approved=false;redeemAttempted=false;
    transaction.failure=failure('device_replaced','GET /api/bee/identity HTTP 401 device_replaced; required=explicit rebind confirmation','device_identity');alias();
    return {result:{recovery:clone(transaction)}};
   }
   if(command==='device_recovery_status'||command==='device_recovery_confirm'){
    if(!transaction?.old_identity)return rejected(command==='device_recovery_status'?'DEVICE_RECOVERY_NONE':'DEVICE_RECOVERY_PRECONDITION','no credential recovery transaction exists; prepare explicitly first',command);
    if(command==='device_recovery_confirm'){
     // Accepted triples precede current revision/phase checks, including completion.
     const decision={operationId:args.operationId,expectedRevision:args.expectedRevision,decision:args.decision};
     if(accepted.some(item=>item.operationId===decision.operationId&&item.expectedRevision===decision.expectedRevision&&item.decision===decision.decision))return {result:{recovery:clone(transaction)}};
     if(args.operationId!==transaction.operation_id||args.expectedRevision!==transaction.revision)return rejected('DEVICE_RECOVERY_PRECONDITION','recovery confirmation revision conflict: actual='+transaction.revision+' expected='+args.expectedRevision+' operation_match='+(args.operationId===transaction.operation_id),command);
     const allowed=args.decision==='begin_pairing'&&transaction.phase==='awaiting_confirmation'||args.decision==='adopt_owner'&&transaction.phase==='awaiting_owner_confirmation'||args.decision==='renew_expired'&&transaction.phase==='expired'&&!redeemAttempted;
     if(!allowed)return rejected('DEVICE_RECOVERY_PRECONDITION','recovery decision rejected: phase='+transaction.phase+'; decision='+args.decision+'; redeem_attempted='+redeemAttempted+'; required=authorized decision for current phase',command);
     const blocked=admission();if(blocked)return rejected('DEVICE_RECOVERY_PRECONDITION',blocked,command);
     accepted.push(decision);
     if(args.decision==='adopt_owner')complete();
     else {approved=false;redeemAttempted=false;changed('pending',{pairing:pair(),new_identity:null,failure:null});}
    }else advance();
    return {result:{recovery:clone(transaction)}};
   }
   if(scene==='device-loading')return new Promise(()=>{});
   if(command==='device_begin'){
    const hive=typeof args.hive==='string'?args.hive.replace(/\/$/,''):'';
    if(!safeOrigin(hive))return rejected('DEVICE_OPERATION_FAILED','Hive address rejected: actual='+args.hive+'; required=HTTPS origin or loopback HTTP origin',command);
    const nextName=typeof args.name==='string'?args.name.trim():'';
    if(!nextName||[...nextName].length>80||/\p{Cc}/u.test(nextName))return rejected('DEVICE_OPERATION_FAILED','device name rejected: characters='+[...nextName].length+'; control_present='+/\p{Cc}/u.test(nextName)+'; required=1..80 without control characters',command);
    if(savedHive&&hive!==savedHive)return rejected('DEVICE_OPERATION_FAILED','desktop Hive change rejected: requested='+hive+'; saved='+savedHive+'; existing pairing preserved',command);
    if(!transaction&&!identity){savedHive=hive;name=nextName;transaction=makeTransaction('pending',null);transaction.pairing=pair();onConfigurationChanged({hive:savedHive,name});alias();}
    else if(transaction&&!transaction.old_identity&&['awaiting_confirmation','expired'].includes(transaction.phase)&&!redeemAttempted){approved=false;changed('pending',{pairing:pair(),failure:null});}
   }
   if(command==='device_open'&&transaction?.old_identity){
    if(!['pending','draining'].includes(transaction.phase))return rejected('DEVICE_RECOVERY_OPEN_PHASE','recovery browser open rejected: phase='+transaction.phase+'; required=pending or draining; refresh the original transaction',command);
    return {result:{recovery:clone(transaction)}};
   }
   if(revoked)return rejected('device_replaced','GET /api/bee/identity HTTP 401 device_replaced; original saved identity preserved','device_identity');
   if(scene==='device-error')return rejected('http_rejected','GET /api/bee/identity HTTP 503; preview upstream unavailable','device_identity',{target_origin:savedHive,path:'/api/bee/identity',http_status:'503',response_body:'Hive upstream temporarily unavailable'});
   advance();return {result:{device:device()}};
  },
 };
}
