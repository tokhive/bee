import {installPreviewFixture} from './bee-preview/fixture.mjs';
const w=window,params=new URLSearchParams(location.search);
await installPreviewFixture(params.get('scene')??'device-unbound');
const invoke=w.__TAURI_INTERNALS__.invoke,holds=new Map(),receipts=new Map();
const control=w.__firstLaunchTest={
 hold(command){let release;const promise=new Promise(resolve=>release=resolve);holds.set(command,{promise,release});},
 release(command){const item=holds.get(command);holds.delete(command);item?.release();},
 holdReceipt(command){let release;const promise=new Promise(resolve=>release=resolve);receipts.set(command,{promise,release});},
 releaseReceipt(command){const item=receipts.get(command);receipts.delete(command);item?.release();},
 recoveryFailure:null,contextFailure:null,contextOverride:null,deviceOverride:null,beginFailure:null,devicePatch:null,completedMutation:null,recordRevision:params.has('recordRevision')?Number(params.get('recordRevision')):null,loseCompletion:false,holdAfterLost:false,
 async refresh(){w.dispatchEvent(new Event('focus'));w.emitStartup(await invoke('startup_status'));},
 async forceRefresh(){const instance=(await invoke('bridge_status')).metadata.instance;const base={instance,failure:null,network_revision:null,observed_at:new Date().toISOString()};w.emitStartup({...base,state:'checking',binding_revision:null,revision:100});w.emitStartup({...base,state:'ready',binding_revision:lastBinding,revision:101});},
};
if(params.get('hold'))control.hold(params.get('hold'));
if(params.has('recoveryFailure'))control.recoveryFailure={code:'DEVICE_REPLY_INVALID',message:'recovery record JSON invalid: expected object; actual=truncated'};
if(params.has('contextFailure'))control.contextFailure={code:'DEVICE_CONTEXT_INVALID',message:'configuration read permission_denied=true; path=/isolated/config; required=readable saved configuration'};
if(params.has('completed')){w.__beePreviewApprove();await invoke('device_status');}
let lastBinding;
w.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
 if(holds.has(command))await holds.get(command).promise;
 if(command==='device_begin'&&control.beginFailure)return {result:{error:control.beginFailure}};
 if(command==='device_recovery_status'&&control.recoveryFailure)return {result:{error:control.recoveryFailure}};
 if(command==='device_context'&&control.contextFailure)return {result:{binding_revision:w.bindingRevision??1,error:control.contextFailure}};
 const result=await invoke(command,args);
 if(receipts.has(command))await receipts.get(command).promise;
 if(command==='device_context'&&control.contextOverride)result.result={context:structuredClone(control.contextOverride)};
 if(command==='device_status'&&control.deviceOverride)result.result={device:structuredClone(control.deviceOverride)};
 if(command==='device_context'){
  if(control.completedMutation==='context-owner'&&result.result?.context?.device_id)result.result.context.owner_id='unexpected-owner';
  const binding=result.result?.context?.binding_revision??result.result?.binding_revision;
  lastBinding=binding;
 }
 if(command==='device_status'&&result.result?.device?.state==='bound'&&control.loseCompletion){control.loseCompletion=false;if(control.holdAfterLost)control.hold('device_status');return {result:{error:{code:'RESPONSE_TIMEOUT',message:'device status receipt lost after local identity save; result unconfirmed'}}};}
 if(command==='device_status'&&result.result?.device?.state==='bound'&&control.completedMutation==='operation')result.result.device.recovery.operation_id='f'.repeat(48);
 if(command==='device_status'&&result.result?.device?.recovery&&control.recordRevision!==null)result.result.device.recovery.revision=control.recordRevision;
 if(command==='device_status'&&control.devicePatch&&result.result?.device)return {result:{device:{...result.result.device,...structuredClone(control.devicePatch)}}};
 return result;
};
await import('/src/main.tsx');
w.__firstLaunchReady=true;
