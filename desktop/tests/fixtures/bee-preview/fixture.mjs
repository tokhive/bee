import {createPreviewSwitchSession} from './switch-session.mjs';
import {accountFixture,installAccountFixture} from '../native-accounts.mjs';
import {getScene} from './scenarios.mjs';
import {createPreviewDeviceSession} from './device-session.mjs';
import {createPreviewNetworkSession} from './network-session.mjs';
const clone=value=>structuredClone(value);
const stamp=offset=>new Date(Date.now()+offset).toISOString();
const hold=()=>new Promise(()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function installPreviewFixture(id){
 const scene=getScene(id),w=window;
 const accountAutoScene=id.startsWith('accounts-auto-'),autoService=true;
 if(accountAutoScene)id=({'candidate':'account-candidate',empty:'account-empty',running:'running',paused:'supply-paused',error:'account-error',change:'account-change',stale:'running'})[id.slice('accounts-auto-'.length)];
 const generation=crypto.randomUUID();w.__beePreviewFixture=generation;
 w.__beePreviewSession=new URLSearchParams(location.search).get('session')??generation;
 const current=()=>w.__beePreviewFixture===generation;
 const long=new URLSearchParams(location.search).has('long');
 let origin=long?'https://'+['long-hive-address'.repeat(3),'pairing-verification'.repeat(2),'example'].join('.'):'https://hive.example';
 const phase=value=>{if(!current())return;w.__beePreviewPhase=value;w.parent.postMessage({type:'bee-preview-phase',session:w.__beePreviewSession,scene:scene.id,phase:value},location.origin);};
 const seeded=(platform,selected=true)=>{
  const a=accountFixture(platform),fingerprint=(platform==='openai'?'b':'c').repeat(64);
  a.candidate={...a.candidate,state:'available',reference:(platform==='openai'?'a':'d').repeat(48),source:{directory:null,store:platform==='claude'?'keychain':'file'},fingerprint,plan:platform==='openai'?'plus':'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:stamp(0)};
  if(selected){a.selection={...a.selection,state:'selected',fingerprint,observed_at:stamp(0)};a.hive={...a.hive,state:'ready',fingerprint,generation:1};}
  a.authorization={...a.authorization,state:selected?'synchronized':'official_identity_verified',fingerprint,observed_at:stamp(0)};
  a.capabilities[0]={...a.capabilities[0],status:'ready',plan:a.candidate.plan,observed_at:stamp(0),metadata_observed_at:stamp(0),valid_until:stamp(3600000),windows:[{scope:'',seconds:18000,used_percent:3,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:2,reset_at:'2099-01-01T00:00:00Z'}]};
  return a;
 };
 const accounts={openai:seeded('openai'),claude:accountFixture('claude')};
 accounts.claude.candidate.state='source_missing';
 if(id==='confirm-clear'){accounts.openai.hive={...accountFixture('openai').hive};accounts.openai.authorization.state='official_identity_verified';}
 const empty=['runtime-no-accounts','runtime-accounts-unconfirmed','account-empty','account-reading','confirm-login'].includes(id);
 if(empty){accounts.openai=accountFixture('openai');accounts.openai.candidate.state=id==='account-reading'?'not_checked':'source_missing';}
 if(['account-candidate','confirm-select'].includes(id))accounts.openai=seeded('openai',false);
 if(['account-change','confirm-change'].includes(id)){
  accounts.openai.candidate.fingerprint='f'.repeat(64);
  accounts.openai.candidate.reference='f'.repeat(48);
  accounts.openai.authorization.fingerprint=accounts.openai.candidate.fingerprint;
  accounts.openai.capabilities=accountFixture('openai').capabilities;
 }
 if(id==='account-expired')accounts.openai.candidate.expires_at=stamp(-60000);
 if(id==='quota-unknown')accounts.openai.capabilities[0]={...accountFixture('openai').capabilities[0]};
 if(id==='quota-expired')accounts.openai.capabilities[0].valid_until=stamp(-60000);
 if(id==='quota-multiple'||accountAutoScene&&id==='running')accounts.claude=seeded('claude');
 if(id==='quota-multiple')accounts.claude.capabilities[0].windows.push({scope:'opus',seconds:604800,used_percent:47,reset_at:'2099-01-01T00:00:00Z'});
 if(id==='quota-over')accounts.openai.capabilities[0].windows[0].used_percent=120;
 if(id==='account-error')accounts.openai.candidate={...accountFixture('openai').candidate,state:'unavailable',error:{code:'source_unavailable',check:'file_read',platform:'openai',message:'无法读取 OpenAI 登录：file_read permission_denied=true；预览模拟权限拒绝。',evidence:{permission_denied:'true',path:'/preview/codex/auth.json'}}};
 if(id==='device-revoked-source-missing')accounts.openai.candidate={...accounts.openai.candidate,state:'source_missing',error:{code:'source_missing',check:'source_read',platform:'openai',message:'selected file missing: /isolated/qa/codex/auth.json',evidence:{not_found:'true',path:'/isolated/qa/codex/auth.json'}}};
 const params=new URLSearchParams(location.search);
 installAccountFixture({accounts,runtimeEnabled:true,scenarios:{previewSources:true,autoService},initialPreferences:{language:params.get('locale')==='en'?'en':'zh',theme:['light','dark','system'].includes(params.get('theme'))?params.get('theme'):'light',autostart_desired:id==='settings-system'}});
 if(id==='settings-system'){
  w.notificationPermission='denied';
  w.autostartQueryError={code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13; registration unconfirmed'};
 }
 w.paused={openai:id==='supply-paused'||accountAutoScene&&id==='account-error',claude:false};
 let local=['runtime-no-accounts','runtime-accounts-unconfirmed','device-revoked-source-missing','startup-blocked','stopped','runtime-unknown','confirm-login','confirm-select','confirm-clear','account-candidate','account-empty'].includes(id)||id.startsWith('device-')&&id!=='device-bound'?'stopped':'running';
 if(empty||['account-candidate','confirm-select'].includes(id))local='waiting';
 if(id==='runtime-starting')local='starting';if(id==='runtime-stopping')local='stopping';
 if(local==='stopped'&&w.accounts.openai.selection.state==='selected')w.paused.openai=true;
 if(id==='diagnostics-export-unknown'){w.previewDownloads=[];HTMLAnchorElement.prototype.click=function(){w.previewDownloads.push(this.download);};}
 if(accountAutoScene)local=Object.values(accounts).some(a=>a.selection.state==='selected')?'running':'waiting';
 const preparingAccounts=new Map();
 let preparingUntil=0,staleSupply=scene.id==='accounts-auto-stale',supplyUnknownNext=false,prepareFailure=false;
 let unknown=false,revision=1,runtimeOperation=null,stopReceipt=null;
 if(id.startsWith('recovery-')||id==='device-recovery-confirm')local='stopped';
 let bound=!(id.startsWith('device-')&&id!=='device-bound'||id.startsWith('recovery-')&&id!=='recovery-completed'||id==='startup-blocked');
 let connection=({'runtime-offline':'disconnected','runtime-disconnected':'reconnecting','runtime-connecting':'connecting','runtime-rejected':'rejected','runtime-occupied':'occupied'}[id])??(!bound?'disconnected':local==='starting'?'connecting':'connected');
 let networkUnavailable=id==='runtime-offline',unknownNext=false;
 let activeRun='a'.repeat(32),deviceSession=null;
 const runId=()=>['starting','running','stopping'].includes(local)?activeRun:null;
 w.__beeMockRuntimeLocal=()=>local;
 w.__beeMockRuntimeContext=()=>({run_id:runId(),network_revision:w.networkRevision??0,binding_revision:w.bindingRevision??1,revision,hive:origin,device_id:deviceSession?deviceSession.binding().device_id:bound?'dev-1':null});
 w.__beePreviewBindingChanged=next=>{
  if(!current())throw new Error(`PREVIEW_SESSION_STALE: fixture=${generation}; required=current preview fixture before binding change`);
  bound=next.bound;local='stopped';connection=bound?'connected':'disconnected';runtimeOperation=null;stopReceipt=null;unknown=false;networkUnavailable=false;revision++;
 };
 const connectionDetail=()=>{
  if(!bound||!['disconnected','reconnecting','connecting','rejected','occupied'].includes(connection))return null;
  const disconnected=['disconnected','reconnecting'].includes(connection);
  const status=connection==='rejected'?'401':connection==='occupied'?'409':null;
  return {failure:{code:status?'http_rejected':disconnected?'connection_closed':'timeout',stage:disconnected?'heartbeat':'connect',occurred_at:stamp(0),message:status?`Hive connection rejected: HTTP ${status}; preview ${connection}`:disconnected?'Preview websocket heartbeat connection closed':'Preview connection attempt is in flight',evidence:{...(status?{http_status:status}:{}),path:'/api/bee/connect'}},retry:status?'halted':disconnected?'scheduled':'attempting',next_retry_at:disconnected?stamp(12000):null};
 };
 w.__beeMockControls['runtime-connection']=request=>{
  if(!current())throw new Error(`PREVIEW_SESSION_STALE: fixture=${generation}; required=current preview fixture before connection event`);
  if(!['online','offline','connecting','rejected','occupied'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=runtime-connection; value=${request.value}; required=online,offline,connecting,rejected,occupied`);
  if(!bound)throw new Error(`PREVIEW_CONTROL_PRECONDITION: action=runtime-connection; bound=false; required=bound device before Hive connection events`);
  connection=({online:'connected',offline:'reconnecting'}[request.value])??request.value;networkUnavailable=request.value==='offline';revision++;
  return {message:`模拟 Hive 连接已设为 ${request.value}；正式页面将在下一次只读核对时更新。`};
 };
 w.__beeMockControls['runtime-write-result']=request=>{
  if(!current())throw new Error(`PREVIEW_SESSION_STALE: fixture=${generation}; required=current preview fixture before write result event`);
  if(!['confirmed','unknown-next'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=runtime-write-result; value=${request.value}; required=confirmed,unknown-next`);
  unknownNext=request.value==='unknown-next';
  return {message:unknownNext?'下一次贡献启停将提交后丢失回执；正式页面只读核对原操作。':'贡献启停回执已恢复正常。'};
 };
 if(autoService){
  w.__beeMockControls['account-service']=request=>{
   if(!['ready','failed','restart','stale','fresh'].includes(request.value))throw new Error(`PREVIEW_SERVICE_INVALID: value=${request.value}; required=ready,failed,restart,stale,fresh`);
   if(request.value==='stale'||request.value==='fresh')staleSupply=request.value==='stale';
   else if(request.value==='restart'){local='starting';preparingUntil=Date.now()+600;activeRun=crypto.randomUUID().replaceAll('-','');}
   else {prepareFailure=request.value==='failed';local=prepareFailure?'failed':'running';preparingUntil=0;}
   if(request.value==='failed')runtimeOperation={id:crypto.randomUUID().replaceAll('-','')+'0'.repeat(16),kind:'start',platform:null,state:'failed',revision:revision+1,error:{platform:'openai',code:'preparation_failed',check:'service_prepare',message:'service_prepare: local worker unavailable; simulated_failure=true; required=ready worker',evidence:{confirmed:'false'}}};
   if(['ready','restart'].includes(request.value))runtimeOperation=null;
   revision++;
   return {message:'模拟服务条件已更新，平台接单选择保持不变。'};
  };
  w.__beeMockControls['supply-write-result']=request=>{
   if(!['confirmed','unknown-next'].includes(request.value))throw new Error(`PREVIEW_SUPPLY_RESULT_INVALID: value=${request.value}; required=confirmed,unknown-next`);
   supplyUnknownNext=request.value==='unknown-next';return {message:'接单操作回执条件已更新。'};
  };
  w.__beeMockControls['account-operation-result']=request=>{
   if(!['confirmed','unknown-next'].includes(request.value))throw new Error(`PREVIEW_ACCOUNT_RESULT_INVALID: value=${request.value}; required=confirmed,unknown-next`);
   w.actionUnknown=request.value==='unknown-next';return {message:'账号操作回执条件已更新。'};
  };
 }
 const lostReceipt=command=>{
  if(!unknownNext)return;
  unknownNext=false;
  throw Object.assign(new Error(`RESPONSE_TIMEOUT: ${command} preview response lost; submitted=true; operation_id=${runtimeOperation.id}; result=unconfirmed`),{code:'RESPONSE_TIMEOUT'});
 };
 const finishBinding=()=>{
  for(const p of ['openai','claude']){const {features,revision:previousRevision}=accounts[p];accounts[p]={...accountFixture(p),features,revision:previousRevision+1};w.paused[p]=true;}
  w.bindingRevision=(w.bindingRevision??1)+1;w.networkRevision=(w.networkRevision??0)+1;w.effectiveProxy='';
  w.__beePreviewBindingChanged({bound:true});
 };
 const original=w.__TAURI_INTERNALS__.invoke;
 let instance=(await original('bridge_status')).metadata.instance;
 deviceSession=createPreviewDeviceSession({scene:id==='switch-first-launch'?'device-unbound':id,origin,current,instance,onConfigurationChanged:next=>{origin=next.hive;w.bindingRevision=(w.bindingRevision??1)+1;},onCompleted:finishBinding,onRevoked:()=>{bound=false;connection='rejected';revision++;}});
 const networkSession=createPreviewNetworkSession({scene:id,origin,current,invoke:original,instance,context:()=>({...w.__beeMockRuntimeContext(),local,bound}),applyNetwork:next=>{
  w.effectiveProxy=next.proxy;w.networkRevision=next.revision;revision++;
  if(local==='running'){activeRun=crypto.randomUUID().replaceAll('-','');revision++;}
 }});
 const profileAccounts=new Map();
 const switchSession=createPreviewSwitchSession({scene:id,origin,instance,original,current,onInitial:args=>deviceSession.invoke('device_begin',args),onCommit:next=>{
  profileAccounts.set(origin,{accounts:clone(w.accounts),paused:clone(w.paused)});origin=next.hive;instance=next.instance;w.currentHiveProfile=next.profile_id;const saved=profileAccounts.get(origin);for(const platform of ['openai','claude']){w.accounts[platform]=saved?clone(saved.accounts[platform]):accountFixture(platform);w.paused[platform]=saved?.paused[platform]??false;}if(id==='switch-account-error')w.accounts.openai.candidate={...w.accounts.openai.candidate,state:'unavailable',error:{code:'source_unavailable',check:'file_read',platform:'openai',message:'B OpenAI source read rejected: permission_denied=true; current Hive remains B',evidence:{permission_denied:'true'}}};local=Object.values(w.accounts).some(account=>account.selection.state==='selected')?'running':'waiting';connection='connected';bound=true;activeRun=next.instance;revision++;w.emit(next.instance);
 }});
 const reads={openai:0,claude:0};
 w.__beePreviewActivate=()=>{reads.openai=0;reads.claude=0;};
 const businessError=(code,message,instance,details)=>({...instance?{instance}:{},result:{error:{code,message,...details?{details}:{}}}});
 const supply=platform=>{
  const reasons=[];
  if(w.paused[platform])reasons.push('manually_paused');
  if(w.accounts[platform].selection.state!=='selected')reasons.push('not_configured');
  if(local!=='running'||connection!=='connected')reasons.push('offline');
  if(id==='supply-blocked')reasons.push('authorization_unavailable','quota_unknown','plan_not_configured');
  if(id==='supply-partial'&&platform==='claude')reasons.push('model_unavailable');
  if(id==='account-expired'&&platform==='openai')reasons.push('authorization_unavailable');
  if(!autoService&&id==='account-error'&&platform==='openai')reasons.push('codex_source_unavailable');
  if(autoService&&w.accounts[platform].selection.state==='selected'){
   const a=w.accounts[platform];
   if(preparingAccounts.has(platform))reasons.push('authorization_unavailable');
   if(a.candidate.error)reasons.push(`${platform==='openai'?'codex':'claude'}_source_unavailable`);
   if(a.operation?.kind==='authorize'&&['pending','running','reconciling'].includes(a.operation.state))reasons.push('authorization_unavailable');
  }
  if(platform==='openai'){
   if(id==='quota-over')reasons.push('quota_exhausted');
   if((!autoService&&['account-change','confirm-change'].includes(id))||['quota-unknown','quota-expired'].includes(id))reasons.push('quota_unknown');
   const account=w.accounts.openai;
   if(account.selection.state==='selected'&&account.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint)reasons.push('codex_confirmation_required');
  }
  return {hive:origin,device_id:deviceSession.binding().device_id,platform,paused:w.paused[platform],ready:reasons.length===0,reasons,checked_at:stamp(staleSupply?-60000:id==='check-expired'?-29900:id==='check-sequence'&&reads[platform]===1?-28500:0)};
 };
 const recoveryWriteCodes={account_action:'ACCOUNT_OPERATION_FAILED',authorize_start:'AUTHORIZE_OPERATION_FAILED',runtime_start:'RUNTIME_OPERATION_FAILED',supply_set_paused:'SUPPLY_OPERATION_FAILED',network_apply_saved:'DEVICE_RECOVERY_RECHECK_REQUIRED'};
 w.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
  if(switchSession.handles(command))return switchSession.invoke(command,args);
  const barrier=deviceSession.writeBarrier();
  if(barrier&&Object.hasOwn(recoveryWriteCodes,command)){
   w.calls.push({command,args});
   const error={code:recoveryWriteCodes[command],message:`device recovery transaction unresolved: phase=${barrier.phase} revision=${barrier.revision}; command=${command}; required=completed before admitting a new write worker`,details:{check:'device_recovery_admission',observed_at:stamp(0),evidence:{actual:`phase=${barrier.phase}; revision=${barrier.revision}`,required:'completed'}}};
   if(command==='network_apply_saved')throw Object.assign(new Error(error.message),error);
   return {instance,result:{error}};
  }
  if(deviceSession?.handles(command))return deviceSession.invoke(command,args);
  if(networkSession.handles(command))return networkSession.invoke(command,args);
  if(command==='preferences_read'||command==='preferences_save'){const result=await original(command,args);if(!result.error)w.__beePreviewPreferences?.(result.preferences);return result;}
  if(command==='bridge_status'&&id.startsWith('bridge-')){w.calls.push({command,args});return {state:id==='bridge-starting'?'starting':'failed',...(id==='bridge-failed'?{error:{code:'SIDECAR_EXITED',message:'owned QA sidecar exited; exit=17'}}:{})};}
  if(['update_snapshot','update_check','update_download','update_install'].includes(command)&&id.startsWith('update-')){w.calls.push({command,args});return {operation_id:'preview-update',revision:3,state:id==='update-downloading'?'downloading':id==='update-verified'?'verified':id==='update-unknown'?'installing':'failed',current_version:'0.1.0',target_version:'0.2.0',checked_at:stamp(-3000),downloaded_bytes:1234567890,total_bytes:id==='update-downloading'?null:2147483648,release_notes:'Upstream release notes: '+('A long source note with package verification details. '.repeat(long?30:2)),error:id==='update-failed'?{code:'UPDATE_SIGNATURE_FAILED',message:'signature verification rejected QA package',details:{check:'update_download',observed_at:stamp(0),evidence:{source_type:'minisign',actual:'signature mismatch'}}}:null};}
  if(command==='runtime_start'){
   w.calls.push({command,args});
   if(args.request?.expected_revision!==revision)return businessError('RUNTIME_OPERATION_FAILED',`runtime revision changed: actual=${revision} expected=${args.request?.expected_revision}`,instance);
   if(!['stopped','failed'].includes(local))return businessError('RUNTIME_OPERATION_FAILED',`runtime start rejected: local=${local}; required=stopped or failed`,instance);
   if(!bound)return businessError('RUNTIME_OPERATION_FAILED','runtime start blocked: bound=false; required=verified bound device',instance);
   const resume=args.request.resume_platforms;
   if(!Array.isArray(resume)||resume.length>2||new Set(resume).size!==resume.length||resume.some(p=>!['openai','claude'].includes(p)))return businessError('RUNTIME_OPERATION_FAILED','runtime resume list invalid: required=explicit list of unique known platforms',instance);
   if(!Object.values(w.accounts).some(a=>a.selection.state==='selected'))return businessError('RUNTIME_OPERATION_FAILED','runtime start requires a persisted account selection: selections=0',instance);
   const unselected=resume.find(p=>w.accounts[p].selection.state!=='selected');
   if(unselected)return businessError('RUNTIME_OPERATION_FAILED',`runtime resume requested for unselected platform=${unselected}`,instance);
   const pending=Object.entries(w.accounts).find(([,a])=>a.operation&&['pending','running','reconciling'].includes(a.operation.state));
   if(pending)return businessError('RUNTIME_OPERATION_FAILED',`runtime start blocked: unresolved account operation platform=${pending[0]}; state=${pending[1].operation.state}`,instance);
   const changed=Object.entries(w.accounts).find(([,a])=>a.selection.state==='selected'&&a.candidate.fingerprint&&a.candidate.fingerprint!==a.selection.fingerprint);
   if(changed)return businessError('RUNTIME_OPERATION_FAILED',`runtime account confirmation required: platform=${changed[0]}; candidate differs from persisted selection`,instance);
   local='running';prepareFailure=false;activeRun=crypto.randomUUID().replaceAll('-','');revision++;stopReceipt=null;
   for(const p of resume)w.paused[p]=false;
   runtimeOperation={id:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16),kind:'start',platform:null,state:'succeeded',revision,error:null};
   if(id==='runtime-unknown'){unknown=true;throw new Error('RESPONSE_TIMEOUT: runtime_start preview response lost; submitted=true; result=unconfirmed');}
   lostReceipt(command);
   return {instance,result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_stop'){
   w.calls.push({command,args});
   if(args.expectedRevision!==revision)return businessError('RUNTIME_OPERATION_FAILED',`runtime revision changed: actual=${revision} expected=${args.expectedRevision}`,instance);
   if(local==='stopping')return businessError('RUNTIME_OPERATION_FAILED','runtime stop already in progress: local=stopping',instance);
   local='stopped';revision++;
   runtimeOperation={id:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16),kind:'stop',platform:null,state:'succeeded',revision,error:null};
   stopReceipt={workers_stopped:true,intent_saved:true,session_clean:true};
   lostReceipt(command);
   return {instance,result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_snapshot'){
   for(const [platform,preparation] of preparingAccounts)if(Date.now()>=preparation.deadline){
    preparingAccounts.delete(platform);const account=w.accounts[platform];
    if(account.revision===preparation.revision&&account.authorization.state==='preparing'&&account.selection.fingerprint===preparation.fingerprint){account.authorization.state=local==='running'&&connection==='connected'?'synchronized':'official_identity_verified';if(account.authorization.state==='synchronized')account.hive={...account.hive,state:'ready',fingerprint:account.selection.fingerprint,generation:1};account.revision++;}
   }
   if(autoService&&preparingUntil&&Date.now()>=preparingUntil){local=prepareFailure?'failed':'running';preparingUntil=0;revision++;}
   w.calls.push({command,args});
   if(id==='runtime-accounts-unconfirmed')return businessError('RUNTIME_OPERATION_FAILED','runtime snapshot unavailable; account facts not confirmed',instance);
   if(unknown)return businessError('RUNTIME_OPERATION_FAILED','runtime_snapshot HTTP 503; preview reconciliation unavailable; prior_start=submitted',instance);
   return {instance,result:{runtime:{run_id:runId(),revision,network_revision:w.networkRevision??0,observed_at:stamp(0),local,connection,connection_detail:connectionDetail(),legacy_stop:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:clone(w.accounts[p]),supply:local==='running'&&connection==='connected'&&!id.startsWith('check-')&&!(id==='supply-partial'&&p==='claude')?supply(p):null,selection_revision:w.accounts[p].selection.state==='selected'?1:0}])),operation:clone(runtimeOperation),stop_receipt:clone(stopReceipt)}}};
  }
  if(autoService&&command==='account_action'){
   const previous=w.accounts[args.request.platform]?.operation?.id,pausedBefore=w.paused[args.request.platform];
   try{return await original(command,args);}
   finally{
    w.actionUnknown=false;
    const operation=w.accounts[args.request.platform]?.operation;
    if(operation?.id!==previous&&operation?.state==='succeeded'&&['select','confirm_change'].includes(operation.kind)){const p=args.request.platform,account=w.accounts[p];if(operation.kind==='select')w.paused[p]=pausedBefore;if(local==='waiting')local='running';account.authorization.state='preparing';account.revision++;preparingAccounts.set(p,{deadline:Date.now()+600,revision:account.revision,fingerprint:account.selection.fingerprint});revision++;}
   }
  }
  if(command==='account_detect'||command==='account_snapshot'){
   const p=args.request?.platform??args.platform;
   if(id==='account-reading'&&p==='openai')return hold();
   const reply=await original(command,args);
   const account=w.accounts[p];
   if(autoService&&local==='running'&&connection==='connected'&&account.selection.state==='selected'&&account.candidate.identity_verified&&account.candidate.fingerprint===account.selection.fingerprint&&!account.candidate.error&&!preparingAccounts.has(p)&&!['pending','running','reconciling'].includes(account.operation?.state)){account.authorization.state='synchronized';account.hive={...account.hive,state:'ready',fingerprint:account.selection.fingerprint,generation:1};if(reply.result?.account)reply.result.account=clone(account);}
   return reply;
  }
  if(['supply_status','supply_set_paused'].includes(command)){
   w.calls.push({command,args});const p=args.platform;
   if(command==='supply_set_paused'){
    if(!['openai','claude'].includes(p)||typeof args.paused!=='boolean')return businessError('SUPPLY_OPERATION_FAILED',`supply request rejected: platform=${p}; paused_type=${typeof args.paused}; required=known platform and boolean pause`);
    if(!bound)return businessError('SUPPLY_OPERATION_FAILED','supply write blocked: bound=false; required=verified bound device');
    if(!args.paused&&(local!=='running'||connection!=='connected'||w.accounts[p]?.selection.state!=='selected'))return businessError('SUPPLY_OPERATION_FAILED',`resume blocked: local=${local} connection=${connection} selection=${w.accounts[p]?.selection.state}; required=running connected selected platform=${p}`);
    const account=w.accounts[p];
    if(!args.paused&&account.operation&&['pending','running','reconciling'].includes(account.operation.state))return businessError('SUPPLY_OPERATION_FAILED',`resume blocked: platform=${p}; account_operation=${account.operation.state}; required=no pending account operation`);
    if(!args.paused&&account.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint)return businessError('SUPPLY_OPERATION_FAILED',`resume blocked: account confirmation required; platform=${p}; candidate differs from persisted selection`);
    w.paused[p]=args.paused;
    if(supplyUnknownNext){supplyUnknownNext=false;throw Object.assign(new Error(`RESPONSE_TIMEOUT: supply_set_paused response lost; platform=${p}; submitted=true; result=unconfirmed`),{code:'RESPONSE_TIMEOUT'});}
   }
   if(command==='supply_status'){
    reads[p]++;
    if(networkUnavailable)return businessError('SUPPLY_OPERATION_FAILED',`GET supply_status HTTP 503; platform=${p}; attempt=${reads[p]}; preview upstream unavailable`,undefined,{check:'supply_status',observed_at:stamp(0),evidence:{failure_kind:'http_rejected',http_status:'503',method:'GET',platform:p}});
    if(id==='supply-partial'&&p==='claude')return businessError('SUPPLY_OPERATION_FAILED','GET supply_status HTTP 503; platform=claude; preview upstream unavailable',undefined,{check:'supply_status',observed_at:stamp(0),evidence:{failure_kind:'http_rejected',http_status:'503',method:'GET',platform:'claude'}});
    if(p==='openai'){
     if(id==='check-expired'&&reads[p]>1){phase('expired');return hold();}
     if(['check-waiting','check-retrying'].includes(id)){
      if(id==='check-retrying'&&reads[p]>1){phase('retrying');return hold();}
      phase('waiting');return businessError('SUPPLY_OPERATION_FAILED',`GET supply_status HTTP 503; platform=${p}; attempt=${reads[p]}; preview upstream unavailable`,undefined,{check:'supply_status',observed_at:stamp(0),evidence:{failure_kind:'http_rejected',http_status:'503',method:'GET',platform:p}});
     }
     if(id==='check-background'){phase('background');await wait(1600);}
     if(id==='check-sequence'){
      if(reads[p]===1)phase('current');
      if(reads[p]===2){phase('expired');await wait(1000);phase('waiting');return businessError('SUPPLY_OPERATION_FAILED','GET supply_status HTTP 503; platform=openai; attempt=2; preview upstream unavailable',undefined,{check:'supply_status',observed_at:stamp(0),evidence:{failure_kind:'http_rejected',http_status:'503',method:'GET',platform:p}});}
      if(reads[p]===3){phase('retrying');await wait(3000);phase('recovered');}
     }
     if(id==='check-recovered')phase('recovered');
    }
   }
   return {result:{supply:supply(p)}};
  }
  return original(command,args);
 };
 w.__beePreviewScene=scene.id;
}
