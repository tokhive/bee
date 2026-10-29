import {accountFixture,installAccountFixture} from '../native-accounts.mjs';
import {getScene} from './scenarios.mjs';
const clone=value=>structuredClone(value);
const stamp=offset=>new Date(Date.now()+offset).toISOString();
const hold=()=>new Promise(()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function installPreviewFixture(id){
 const scene=getScene(id),w=window;
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
 accounts.claude.candidate.state='missing';
 const empty=['account-empty','account-reading','confirm-login'].includes(id);
 if(empty){accounts.openai=accountFixture('openai');accounts.openai.candidate.state='missing';}
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
 let local=['stopped','runtime-unknown','confirm-login','confirm-select','confirm-change','confirm-clear','account-candidate','account-empty','account-change'].includes(id)||id.startsWith('device-')&&id!=='device-bound'?'stopped':'running';
 if(id==='runtime-starting')local='starting';if(id==='runtime-stopping')local='stopping';
 if(local==='stopped'&&w.accounts.openai.selection.state==='selected')w.paused.openai=true;
 let unknown=false,revision=1,runtimeOperation=null,stopReceipt=null;
 let deviceStage=id==='device-unbound'?'unbound':id==='device-pending'?'pending':id==='device-expired'?'expired':'bound';
 let pairingExpiresAt=stamp(600000);
 const original=w.__TAURI_INTERNALS__.invoke;
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
  return {hive:'https://hive.example',device_id:'dev-1',platform,paused:w.paused[platform],ready:reasons.length===0,reasons,checked_at:stamp(id==='check-expired'?-29900:id==='check-sequence'&&reads[platform]===1?-28500:0)};
 };
 w.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
  if(command==='device_status'||command==='device_begin'||command==='device_open'){
   w.calls.push({command,args});
   if(id==='device-error')return businessError('DEVICE_OPERATION_FAILED','GET /device identity HTTP 503; preview upstream unavailable');
   if(command==='device_begin'){deviceStage='pending';pairingExpiresAt=stamp(600000);}
   if(command==='device_open'&&deviceStage==='pending')deviceStage='bound';
   const state=deviceStage;
   const device=state==='unbound'?{state}:{state,hive:'https://hive.example',name:'Bee Desktop'};
   if(state==='bound')device.identity={id:'dev-1',name:'Bee Desktop',owner_id:'owner-1',owner_email:'owner@example.test'};
   if(state==='pending')Object.assign(device,{user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:pairingExpiresAt,poll_interval_seconds:2});
   return {result:{device}};
  }
  if(command==='runtime_start'){
   w.calls.push({command,args});local='running';revision++;stopReceipt=null;
   runtimeOperation={id:'e'.repeat(48),kind:'start',platform:null,state:'succeeded',revision,error:null};
   if(id==='runtime-unknown'){unknown=true;throw new Error('RESPONSE_TIMEOUT: runtime_start preview response lost; submitted=true; result=unconfirmed');}
   return {instance:'fixture',result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_stop'){
   w.calls.push({command,args});local='stopped';revision++;
   runtimeOperation={id:'e'.repeat(48),kind:'stop',platform:null,state:'succeeded',revision,error:null};
   stopReceipt={workers_stopped:true,intent_saved:true,session_clean:true};
   return {instance:'fixture',result:{operation:clone(runtimeOperation)}};
  }
  if(command==='runtime_snapshot'){
   w.calls.push({command,args});
   if(unknown)return businessError('RUNTIME_OPERATION_FAILED','runtime_snapshot HTTP 503; preview reconciliation unavailable; prior_start=submitted','fixture');
   return {instance:'fixture',result:{runtime:{run_id:local==='stopped'?null:'a'.repeat(32),revision,network_revision:0,observed_at:stamp(0),local,connection:local==='running'?(id==='runtime-disconnected'?'disconnected':'connected'):local==='starting'?'connecting':'disconnected',platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:clone(w.accounts[p]),supply:null,selection_revision:w.accounts[p].selection.state==='selected'?1:0}])),operation:clone(runtimeOperation),stop_receipt:clone(stopReceipt)}}};
  }
  if(command==='account_detect'||command==='account_snapshot'){
   w.calls.push({command,args});const p=args.request?.platform??args.platform;
   if(id==='account-reading'&&p==='openai')return hold();
   return {instance:'fixture',result:{account:clone(w.accounts[p])}};
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
