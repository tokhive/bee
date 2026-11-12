import {installPreviewFixture} from './bee-preview/fixture.mjs';
const w=window,params=new URLSearchParams(location.search);
await installPreviewFixture(params.get('scene')??'device-unbound');
const invoke=w.__TAURI_INTERNALS__.invoke,holds=new Map(),receipts=new Map();
const control=w.__firstLaunchTest={
 instance:null,
 ready(instance){this.instance=instance;w.emit(instance);},
 hold(command){let release;const promise=new Promise(resolve=>release=resolve);holds.set(command,{promise,release});},
 release(command){const item=holds.get(command);holds.delete(command);item?.release();},
 holdReceipt(command){let release;const promise=new Promise(resolve=>release=resolve);receipts.set(command,{promise,release});},
 releaseReceipt(command){const item=receipts.get(command);receipts.delete(command);item?.release();},
 recoveryFailure:null,contextFailure:null,contextOverride:null,deviceOverride:null,beginFailure:null,completeBeginReceipt:false,devicePatch:null,completedMutation:null,recordRevision:params.has('recordRevision')?Number(params.get('recordRevision')):null,loseCompletion:false,holdAfterLost:false,
 async refresh(){w.dispatchEvent(new Event('focus'));w.emitStartup(await invoke('startup_status'));},
 async forceRefresh(){const instance=(await invoke('bridge_status')).metadata.instance;const base={instance,failure:null,network_revision:null,observed_at:new Date().toISOString()};w.emitStartup({...base,state:'checking',binding_revision:null,revision:100});w.emitStartup({...base,state:'ready',binding_revision:lastBinding,revision:101});},
};
if(params.get('hold'))control.hold(params.get('hold'));
if(params.has('recoveryFailure'))control.recoveryFailure={code:'DEVICE_REPLY_INVALID',message:'recovery record JSON invalid: expected object; actual=truncated'};
if(params.has('contextFailure'))control.contextFailure={code:'DEVICE_CONTEXT_INVALID',message:'configuration read permission_denied=true; path=/isolated/config; required=readable saved configuration'};
if(params.has('displayName'))w.__beeMockSetHiveDisplayName(params.get('displayName'));
if(params.has('completed')){w.__beePreviewApprove();await invoke('device_status');}
let lastBinding;
w.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
 const replyInstance=control.instance;
 if(holds.has(command))await holds.get(command).promise;
 if(command==='device_begin'&&control.beginFailure)return {result:{error:control.beginFailure}};
 if(command==='device_recovery_status'&&control.recoveryFailure)return {result:{error:control.recoveryFailure}};
 if(command==='device_context'&&control.contextFailure)return {result:{binding_revision:w.bindingRevision??1,error:control.contextFailure}};
 const result=await invoke(command,args);
 if(replyInstance&&result&&Object.hasOwn(result,'instance'))result.instance=replyInstance;
 if(receipts.has(command))await receipts.get(command).promise;
 if(command==='device_context'&&control.contextOverride)result.result={context:structuredClone(control.contextOverride)};
 if(command==='device_status'&&control.deviceOverride)result.result={device:structuredClone(control.deviceOverride)};
 if(command==='device_context'){
  if(result.result?.context?.device_id){const context=result.result.context;if(control.completedMutation==='context-owner')context.owner_id='unexpected-owner';if(control.completedMutation==='context-name')context.name='unexpected local name';if(control.completedMutation==='context-hive')context.hive='https://unexpected-hive.example';}
  const binding=result.result?.context?.binding_revision??result.result?.binding_revision;
  lastBinding=binding;
 }
 if(command==='device_status'&&result.result?.device?.state==='bound'&&control.loseCompletion){control.loseCompletion=false;if(control.holdAfterLost)control.hold('device_status');return {result:{error:{code:'RESPONSE_TIMEOUT',message:'device status receipt lost after local identity save; result unconfirmed'}}};}
 if(command==='device_status'&&result.result?.device?.state==='bound'){const device=result.result.device,mutation=control.completedMutation;if(mutation==='operation')device.recovery.operation_id='f'.repeat(48);if(mutation==='view-name')device.name='unexpected bound display name';const field={'new-id':'id','new-name':'name','new-owner':'owner_id','new-email':'owner_email'}[mutation];if(field)device.recovery.new_identity[field]=field==='owner_email'?'unexpected@example.test':'unexpected-identity';}
 if(command==='device_status'&&result.result?.device?.recovery&&control.recordRevision!==null)result.result.device.recovery.revision=control.recordRevision;
 if(command==='device_status'&&control.devicePatch&&result.result?.device)return {result:{device:{...result.result.device,...structuredClone(control.devicePatch)}}};
 return command==='device_begin'&&control.completeBeginReceipt?await invoke('device_status'):result;
};
await import('/src/main.tsx');
w.__firstLaunchReady=true;
