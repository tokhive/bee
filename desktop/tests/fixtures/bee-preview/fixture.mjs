import {accountFixture,installAccountFixture} from '../native-accounts.mjs';
import {getScene} from './scenarios.mjs';
const clone=value=>structuredClone(value);
const stamp=offset=>new Date(Date.now()+offset).toISOString();
const hold=()=>new Promise(()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function installPreviewFixture(id){
 const scene=getScene(id),w=window;
 const long=new URLSearchParams(location.search).has('long');
 const origin=long?'https://'+['long-hive-address'.repeat(3),'pairing-verification'.repeat(2),'example'].join('.'):'https://hive.example';
 const phase=value=>{w.__beePreviewPhase=value;w.parent.postMessage({type:'bee-preview-phase',scene:scene.id,phase:value},location.origin);};
 const seeded=(platform,selected=true)=>{
  const a=accountFixture(platform),fingerprint=(platform==='openai'?'b':'c').repeat(64);
  a.candidate={...a.candidate,state:'available',reference:(platform==='openai'?'a':'d').repeat(48),source:{directory:null,store:'file'},fingerprint,plan:platform==='openai'?'plus':'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:stamp(0)};
  if(selected)a.selection={...a.selection,state:'selected',fingerprint,observed_at:stamp(0)};
  a.authorization={...a.authorization,state:'official_identity_verified',fingerprint,observed_at:stamp(0)};
  a.capabilities[0]={...a.capabilities[0],status:'ready',plan:a.candidate.plan,observed_at:stamp(0),metadata_observed_at:stamp(0),valid_until:stamp(3600000),windows:[{scope:'',seconds:18000,used_percent:3,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:2,reset_at:'2099-01-01T00:00:00Z'}]};
  return a;
 };
 const accounts={openai:seeded('openai'),claude:accountFixture('claude')};
 accounts.claude.candidate.state='source_missing';
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
 if(id==='quota-multiple')accounts.claude=seeded('claude');
 if(id==='quota-multiple')accounts.claude.capabilities[0].windows.push({scope:'opus',seconds:604800,used_percent:47,reset_at:'2099-01-01T00:00:00Z'});
 if(id==='quota-over')accounts.openai.capabilities[0].windows[0].used_percent=120;
 if(id==='account-error')accounts.openai.candidate={...accountFixture('openai').candidate,state:'unavailable',error:{code:'source_unavailable',check:'file_read',platform:'openai',message:'无法读取 OpenAI 登录：file_read permission_denied=true；预览模拟权限拒绝。',evidence:{permission_denied:'true',path:'/preview/codex/auth.json'}}};
 installAccountFixture({accounts,runtimeEnabled:true});
 w.paused={openai:id==='supply-paused',claude:false};
 let local=['runtime-no-accounts','runtime-accounts-unconfirmed','device-revoked-source-missing','startup-blocked','stopped','runtime-unknown','confirm-login','confirm-select','confirm-change','confirm-clear','account-candidate','account-empty','account-change'].includes(id)||id.startsWith('device-')&&id!=='device-bound'?'stopped':'running';
 if(id==='runtime-starting')local='starting';if(id==='runtime-stopping')local='stopping';
 if(local==='stopped'&&w.accounts.openai.selection.state==='selected')w.paused.openai=true;
 let previewReport=null;
 if(id==='diagnostics-export-unknown'){w.previewDownloads=[];HTMLAnchorElement.prototype.click=function(){w.previewDownloads.push(this.download);};}
 let unknown=false,revision=1,runtimeOperation=null,stopReceipt=null;
 let deviceStage=id==='device-unbound'?'unbound':id==='device-pending'?'pending':id==='device-expired'?'expired':'bound';
 let pairingExpiresAt=stamp(600000);
 const recoveryPhases={'device-awaiting-confirmation':'awaiting_confirmation','device-creating':'creating','device-creation-unknown':'creation_unknown','device-redeeming':'redeeming','device-redemption-unknown':'redemption_unknown','device-saving':'saving','device-draining':'draining','recovery-pending':'pending','recovery-draining':'draining','recovery-creation-unknown':'creation_unknown','recovery-redemption-unknown':'redemption_unknown','recovery-owner':'awaiting_owner_confirmation','recovery-saving':'saving','recovery-completed':'completed'};
 const oldIdentity={id:'dev-1',name:'Bee Desktop',owner_id:'owner-1',owner_email:'owner@example.test'};
 const newIdentity={id:'dev-2',name:'Bee Desktop',owner_id:'owner-2',owner_email:'new-owner@example.test'};
 const isRecovery=id.startsWith('recovery-');
 let recovery=recoveryPhases[id]?{operation_id:'d'.repeat(48),revision:4,phase:recoveryPhases[id],old_identity:isRecovery?oldIdentity:null,new_identity:['saving','completed','awaiting_owner_confirmation'].includes(recoveryPhases[id])?newIdentity:null,pairing:['pending','draining','redeeming','redemption_unknown'].includes(recoveryPhases[id])?{code:'ABCD-EFGH',verification_url:origin+'/devices/pair?code=ABCD-EFGH',expires_at:pairingExpiresAt}:null,failure:id.endsWith('saving')?{code:'DEVICE_RECOVERY_BLOCKED',message:'atomic local save failed: permission denied; phase=saving',details:{check:'device_recovery_save',observed_at:stamp(0),evidence:{actual:'permission denied',required:'private configuration writable'}}}:null}:null;
 if(recovery||id==='device-recovery-confirm')local='stopped';
 const finishRecovery=()=>{for(const p of ['openai','claude']){const {features,revision:previousRevision}=accounts[p];accounts[p]={...accountFixture(p),features,revision:previousRevision+1};w.paused[p]=true;}w.bindingRevision=(w.bindingRevision??1)+1;local='stopped';revision++;runtimeOperation=null;};
 if(isRecovery&&recovery?.phase==='completed')finishRecovery();
 w.__beePreviewApprove=()=>{if(recovery){recovery={...recovery,revision:recovery.revision+1,phase:recovery.old_identity?'awaiting_owner_confirmation':'completed',new_identity:newIdentity};if(recovery.phase==='completed')finishRecovery();}else{deviceStage='bound';finishRecovery();}};
 if(id==='device-revoked-source-missing')accounts.openai.candidate={...accounts.openai.candidate,state:'source_missing',error:{code:'source_missing',check:'source_read',platform:'openai',message:'selected file missing: /isolated/qa/codex/auth.json',evidence:{not_found:'true',path:'/isolated/qa/codex/auth.json'}}};
 const original=w.__TAURI_INTERNALS__.invoke;
 const instance=(await original('bridge_status')).metadata.instance;
 const reads={openai:0,claude:0};
 w.__beePreviewActivate=()=>{reads.openai=0;reads.claude=0;};
 const businessError=(code,message,instance)=>({...instance?{instance}:{},result:{error:{code,message}}});
 const supply=platform=>{
  const reasons=[];
  if(w.paused[platform])reasons.push('manually_paused');
  if(w.accounts[platform].selection.state!=='selected')reasons.push('not_configured');
  if(local!=='running'||id==='runtime-disconnected')reasons.push('offline');
  if(id==='supply-blocked')reasons.push('authorization_unavailable','quota_unknown','plan_not_configured');
  if(id==='supply-partial'&&platform==='claude')reasons.push('model_unavailable');
  if(id==='account-expired'&&platform==='openai')reasons.push('authorization_unavailable');
  if(id==='account-error'&&platform==='openai')reasons.push('codex_source_unavailable');
  if(platform==='openai'){
   if(id==='quota-over')reasons.push('quota_exhausted');
   if(['quota-unknown','quota-expired','account-change','confirm-change'].includes(id))reasons.push('quota_unknown');
   const account=w.accounts.openai;
   if(account.selection.state==='selected'&&account.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint)reasons.push('codex_confirmation_required');
  }
  return {hive:origin,device_id:recovery?.phase==='completed'?newIdentity.id:'dev-1',platform,paused:w.paused[platform],ready:reasons.length===0,reasons,checked_at:stamp(id==='check-expired'?-29900:id==='check-sequence'&&reads[platform]===1?-28500:0)};
 };
 w.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
  if(command==='preferences_read'){const result=await original(command,args);result.preferences.language=new URLSearchParams(location.search).get('locale')==='en'?'en':'zh';result.preferences.theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light';return result;}
  if(command==='bridge_status'&&id.startsWith('bridge-')){w.calls.push({command,args});return {state:id==='bridge-starting'?'starting':'failed',...(id==='bridge-failed'?{error:{code:'SIDECAR_EXITED',message:'owned QA sidecar exited; exit=17'}}:{})};}
  if((command==='startup_status'||command==='startup_recheck')&&['startup-blocked','device-revoked-source-missing'].includes(id)){w.calls.push({command,args});return {state:'blocked',failure:{code:'device_replaced',message:'GET identity HTTP 401 device_replaced'},instance,binding_revision:1,network_revision:0,observed_at:stamp(0),revision:1};}
  if(command.startsWith('update_')&&id.startsWith('update-')){w.calls.push({command,args});return {operation_id:'preview-update',revision:3,state:id==='update-downloading'?'downloading':id==='update-verified'?'verified':id==='update-unknown'?'installing':'failed',current_version:'0.1.0',target_version:'0.2.0',checked_at:stamp(-3000),downloaded_bytes:1234567890,total_bytes:id==='update-downloading'?null:2147483648,release_notes:'Upstream release notes: '+('A long source note with package verification details. '.repeat(long?30:2)),error:id==='update-failed'?{code:'UPDATE_SIGNATURE_FAILED',message:'signature verification rejected QA package',details:{check:'update_download',observed_at:stamp(0),evidence:{source_type:'minisign',actual:'signature mismatch'}}}:null};}
  if(command==='notification_permission'&&id==='settings-system'){w.calls.push({command,args});return 'denied';}
  if(command==='autostart_status'&&id==='settings-system'){w.calls.push({command,args});return {desired:true,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'QA registration read denied'}};}
  if(command==='diagnostics_export'&&id==='diagnostics-export-unknown'){const result=await original(command,args);result.report=clone(previewReport);return result;}
  if((command==='diagnostics_start'||command==='diagnostics_snapshot')&&id.startsWith('diagnostics-')){const result=await original(command,args);if(command==='diagnostics_snapshot'&&id==='diagnostics-read-failed')throw {code:'REPORT_READ_FAILED',message:'QA original report read failed'};const r=result.result.report;r.run_id=local==='stopped'?null:'a'.repeat(32);r.state=id==='diagnostics-running'||id==='diagnostics-read-failed'?'running':'completed';r.finished_at=r.state==='completed'?stamp(0):null;r.checks=[{id:'device',platform:null,status:'fail',code:'http_rejected',observed_at:stamp(0),evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:'invalid_device_credential'},next_action:'diagnostics'},{id:'source',platform:'openai',status:'fail',code:'source_missing',observed_at:stamp(0),evidence:{source_type:'file'},next_action:'accounts'},{id:'proxy',platform:null,status:'pass',code:'network_policy_observed',observed_at:stamp(0),evidence:{},next_action:'settings'}];previewReport=clone(r);return result;}
  if(command==='device_context'){
   w.calls.push({command,args});
   if(id==='device-unbound'&&deviceStage!=='bound'||id==='device-loading')return {result:{binding_revision:w.bindingRevision??1,error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'no saved configuration'}}};
   const identity=recovery?.phase==='completed'?newIdentity:oldIdentity;
   return {result:{context:{hive:origin,name:'Bee Desktop',device_id:id.startsWith('device-')&&deviceStage!=='bound'?null:identity.id,owner_id:id.startsWith('device-')&&deviceStage!=='bound'?null:identity.owner_id,binding_revision:w.bindingRevision??1}}};
  }
  if(command.startsWith('device_recovery_')){
   w.calls.push({command,args});
   if(command==='device_recovery_prepare')recovery={operation_id:'d'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:oldIdentity,new_identity:null,pairing:null,failure:null};
   if(command==='device_recovery_confirm'){
    if(args.operation_id!==recovery?.operation_id||args.expected_revision!==recovery?.revision)return businessError('DEVICE_RECOVERY_PRECONDITION','confirmation revision differs from current transaction');
    recovery={...recovery,revision:recovery.revision+1,phase:args.decision==='adopt_owner'?'completed':'pending',pairing:args.decision==='adopt_owner'?null:{code:'ABCD-EFGH',verification_url:origin+'/devices/pair?code=ABCD-EFGH',expires_at:pairingExpiresAt}};
    if(recovery.phase==='completed')finishRecovery();
   }
   return recovery&&isRecovery||recovery?.old_identity?{result:{recovery:clone(recovery)}}:businessError('DEVICE_RECOVERY_NONE','no credential recovery transaction exists');
  }
  if(command==='device_status'||command==='device_begin'||command==='device_open'){
   w.calls.push({command,args});
   if(id==='device-loading')return hold();
   if(id==='device-revoked-source-missing'||id==='device-recovery-confirm'&&!recovery||isRecovery&&recovery?.phase!=='completed')return businessError('device_replaced','GET /api/bee/identity HTTP 401 device_replaced');
   if(id==='device-error')return {result:{error:{code:'http_rejected',message:'GET /api/bee/identity HTTP 503; preview upstream unavailable'+(long?'; '+('retry-after observation unavailable; '.repeat(12)):''),details:{check:'device_identity',observed_at:stamp(0),evidence:{target_origin:origin,path:'/api/bee/identity',http_status:'503',response_body:'Hive upstream temporarily unavailable'}}}}};
   if(command==='device_begin'){deviceStage='pending';pairingExpiresAt=stamp(600000);}
   if(command==='device_open'&&recovery?.old_identity)return {result:{recovery:clone(recovery)}};
   const state=recovery&&!recovery.old_identity?(recovery.phase==='completed'?'bound':['pending','draining','expired'].includes(recovery.phase)?recovery.phase:'pairing'):deviceStage;
   const device=state==='unbound'?{state}:{state,hive:origin,name:'Bee Desktop'};
   if(state==='bound')device.identity={id:'dev-1',name:'Bee Desktop',owner_id:'owner-1',owner_email:'owner@example.test'};
   if(state==='pending'||state==='draining')Object.assign(device,{user_code:'ABCD-EFGH',verification_url:origin+'/devices/pair?code=ABCD-EFGH',expires_at:pairingExpiresAt,poll_interval_seconds:2});
   if(recovery&&!recovery.old_identity)device.recovery=clone(recovery);
   if(recovery?.phase==='completed')device.identity=newIdentity;
   return {result:{device}};
  }
  if(command==='runtime_start'){
   w.calls.push({command,args});local='running';revision++;stopReceipt=null;
   runtimeOperation={id:'e'.repeat(48),kind:'start',platform:null,state:'succeeded',revision,error:null};
   if(id==='runtime-unknown'){unknown=true;throw new Error('RESPONSE_TIMEOUT: runtime_start preview response lost; submitted=true; result=unconfirmed');}
   return {instance,result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_stop'){
   w.calls.push({command,args});local='stopped';revision++;
   runtimeOperation={id:'e'.repeat(48),kind:'stop',platform:null,state:'succeeded',revision,error:null};
   stopReceipt={workers_stopped:true,intent_saved:true,session_clean:true};
   return {instance,result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_snapshot'){
   w.calls.push({command,args});
   if(id==='runtime-accounts-unconfirmed')return businessError('RUNTIME_OPERATION_FAILED','runtime snapshot unavailable; account facts not confirmed',instance);
   if(unknown)return businessError('RUNTIME_OPERATION_FAILED','runtime_snapshot HTTP 503; preview reconciliation unavailable; prior_start=submitted',instance);
   return {instance,result:{runtime:{run_id:local==='stopped'?null:'a'.repeat(32),revision,network_revision:0,observed_at:stamp(0),local,connection:local==='running'?({'runtime-disconnected':'reconnecting','runtime-connecting':'connecting','runtime-rejected':'rejected','runtime-occupied':'occupied'}[id]??'connected'):local==='starting'?'connecting':'disconnected',connection_detail:['runtime-disconnected','runtime-connecting','runtime-rejected','runtime-occupied'].includes(id)?{failure:{code:id==='runtime-disconnected'?'connection_closed':id==='runtime-connecting'?'timeout':'http_rejected',stage:id==='runtime-disconnected'?'heartbeat':'connect',occurred_at:stamp(-2000),message:({'runtime-rejected':'Hive rejected QA device credential: HTTP 401','runtime-occupied':'Hive reports an active QA session: HTTP 409','runtime-disconnected':'QA websocket heartbeat connection closed','runtime-connecting':'QA connection attempt is in flight'}[id]),evidence:{...(['runtime-rejected','runtime-occupied'].includes(id)?{http_status:id==='runtime-rejected'?'401':'409'}:{}),path:'/api/bee/connect'}},retry:id==='runtime-connecting'?'attempting':id==='runtime-disconnected'?'scheduled':'halted',next_retry_at:id==='runtime-disconnected'?stamp(12000):null}:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:clone(w.accounts[p]),supply:null,selection_revision:w.accounts[p].selection.state==='selected'?1:0}])),operation:clone(runtimeOperation),stop_receipt:clone(stopReceipt)}}};
  }
  if(command==='account_detect'||command==='account_snapshot'){
   w.calls.push({command,args});const p=args.request?.platform??args.platform;
   if(id==='account-reading'&&p==='openai')return hold();
   return {instance,result:{account:clone(w.accounts[p])}};
  }
  if(command.startsWith('supply_')){
   w.calls.push({command,args});const p=args.platform;
   if(command==='supply_set_paused')w.paused[p]=args.paused;
   if(command==='supply_status'){
    reads[p]++;
    if(id==='supply-partial'&&p==='claude')return businessError('SUPPLY_OPERATION_FAILED','GET supply_status HTTP 503; platform=claude; preview upstream unavailable');
    if(p==='openai'){
     if(id==='check-expired'&&reads[p]>1){phase('expired');return hold();}
     if(['check-waiting','check-retrying'].includes(id)){
      if(id==='check-retrying'&&reads[p]>1){phase('retrying');return hold();}
      phase('waiting');return businessError('SUPPLY_OPERATION_FAILED',`GET supply_status HTTP 503; platform=${p}; attempt=${reads[p]}; preview upstream unavailable`);
     }
     if(id==='check-background'){phase('background');await wait(1600);}
     if(id==='check-sequence'){
      if(reads[p]===1)phase('current');
      if(reads[p]===2){phase('expired');await wait(1000);phase('waiting');return businessError('SUPPLY_OPERATION_FAILED','GET supply_status HTTP 503; platform=openai; attempt=2; preview upstream unavailable');}
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
