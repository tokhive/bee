import {normalizeFailure,type UiFailure} from './failures.ts';
import type {SystemBridge,BridgeStatus,StartupStatus} from './bridge';
import type {DeviceClient,DeviceView,DeviceContext} from './device';
import type {AccountFactory,AccountDefaults,AccountSnapshot} from './accounts';
import type {SupplyFactory,SupplyView} from './supply';
import type {RuntimeFactory,RuntimeSnapshot} from './runtime';
export interface DesktopSnapshot {native:BridgeStatus;startup?:StartupStatus;deviceContext?:DeviceContext;bindingRevision?:number;deviceContextFailure?:UiFailure;device?:DeviceView;deviceError:UiFailure|null;runtime?:RuntimeSnapshot;defaults?:AccountDefaults;accounts:Partial<Record<'openai'|'claude',AccountSnapshot>>;accountErrors:Partial<Record<'openai'|'claude',UiFailure>>;supplies:Partial<Record<'openai'|'claude',SupplyView>>;supplyErrors:Partial<Record<'openai'|'claude',UiFailure>>;supplyPlatform?:'openai'|'claude'|null;error:UiFailure|null;busy:boolean}
export interface DesktopDeps{bridge:SystemBridge;device:DeviceClient;runtime:RuntimeFactory;accounts?:AccountFactory;supply?:SupplyFactory;intervalMs?:number}
const failure=(e:unknown,check='desktop_refresh')=>normalizeFailure(e,check);
/** One application owner. Pages subscribe without starting independent polling. */
export function createDesktopState(deps:DesktopDeps){
 let state:DesktopSnapshot={native:{state:'starting'},deviceError:null,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,busy:false};
 let disposed=false,started=false,epoch=0,pendingEpoch=0,paused=false,unlisten:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,nextRefresh:Promise<void>|undefined;
 let runtimeReceiptRevision=-1,accountReceiptRevisions:Partial<Record<'openai'|'claude',number>>={};
 let unlistenStartup:(()=>void)|undefined;
 const acceptStartup=(status:StartupStatus)=>{
  if(disposed||status.instance&&state.native.metadata?.instance&&status.instance!==state.native.metadata.instance)return;
  if(status.state!=='checking'){
   if(state.bindingRevision!==undefined&&status.binding_revision!==null&&status.binding_revision!==state.bindingRevision)return;
   if(state.runtime&&status.network_revision!==null&&status.network_revision!==state.runtime.network_revision)return;
  }
  if(state.startup&&status.revision<state.startup.revision)return;
  publish({startup:status});
 };
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<DesktopSnapshot>)=>{if(disposed)return;state={...state,...next};listeners.forEach(fn=>fn());};
 function accept(status:BridgeStatus){
  if(disposed)return;
  const changed=status.metadata?.instance!==state.native.metadata?.instance||status.state!==state.native.state;
  if(changed){epoch++;paused=false;runtimeReceiptRevision=-1;accountReceiptRevisions={};clearTimeout(timer);const generation=epoch,instance=status.metadata?.instance;const startup=status.state==='ready'&&state.startup?.instance===instance?state.startup:undefined;publish({native:status,device:undefined,deviceContext:undefined,bindingRevision:undefined,deviceContextFailure:undefined,startup,deviceError:null,runtime:undefined,defaults:undefined,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,busy:false});if(status.state==='ready')queueMicrotask(()=>{if(!disposed&&epoch===generation&&state.native.metadata?.instance===instance)void refresh().catch(()=>undefined);});}
  else publish({native:status});
 }
 function begin(){if(started||disposed)return;started=true;let received=false;
  void deps.bridge.onStatus(v=>{received=true;accept(v);}).then(off=>{if(disposed)off();else unlisten=off;},e=>publish({error:failure(e)}));
  if(deps.bridge.onStartup)void deps.bridge.onStartup(acceptStartup).then(off=>{if(disposed)off();else unlistenStartup=off;},e=>publish({error:failure(e,'startup_status')}));
  if(deps.bridge.startupStatus)void deps.bridge.startupStatus().then(acceptStartup,e=>publish({error:failure(e,'startup_status')}));
  void deps.bridge.status().then(v=>{if(!received)accept(v);},e=>{if(!received)publish({error:failure(e)});});
 }
 async function refresh():Promise<void>{
  if(disposed)return;if(!started)begin();paused=false;
  if(pending){if(pendingEpoch!==epoch){nextRefresh??=pending.then(()=>{nextRefresh=undefined;return refresh();});return nextRefresh;}return pending;}
  const instance=state.native.metadata?.instance;if(state.native.state!=='ready'||!instance)return;
  clearTimeout(timer);let generation=epoch;pendingEpoch=generation;publish({busy:true});
  const current=()=>!disposed&&epoch===generation&&state.native.metadata?.instance===instance;
  const task=(async()=>{let device:DeviceView|undefined,deviceError:UiFailure|null=null;try{
   const runtime=deps.runtime(instance),accounts=deps.accounts?.(instance);
   let deviceContext:DeviceContext|undefined,bindingRevision:number|undefined,deviceContextFailure:UiFailure|undefined;
   if(deps.device.context)try{
    const local=await deps.device.context();bindingRevision=local.binding_revision;
    if('failure'in local){deviceContextFailure=local.failure;if(local.failure.code!=='DEVICE_CONTEXT_UNCONFIGURED')deviceError=local.failure;}
    else deviceContext=local;
   }catch(e){deviceContextFailure=deviceError=failure(e,'device_context');}
   if(!current())return;
   const bindingChanged=state.bindingRevision!==undefined&&bindingRevision!==state.bindingRevision;
   if(bindingChanged){epoch++;generation=epoch;pendingEpoch=generation;runtimeReceiptRevision=-1;accountReceiptRevisions={};publish({deviceContext,bindingRevision,deviceContextFailure,device:undefined,startup:undefined,runtime:undefined,defaults:undefined,accounts:{},supplies:{},accountErrors:{},supplyErrors:{},error:null});}
   else publish({deviceContext,bindingRevision,deviceContextFailure});
   try{device=await deps.device.status();}catch(e){if(!current())return;deviceError??=failure(e,'device_status');}
   if(!current())return;
   const [next,defaults]=await Promise.all([runtime.snapshot(),!state.defaults&&accounts?accounts.defaults():Promise.resolve(state.defaults)]);
   if(!current())return;
   if(state.runtime&&(next.revision<state.runtime.revision||next.network_revision<state.runtime.network_revision))throw {code:'DESKTOP_STALE_RESULT',message:'runtime or network revision regressed'};
   if(deviceError){publish({device:undefined,deviceError,runtime:next,defaults,accounts:{},supplies:{},accountErrors:{},supplyErrors:{},error:null});return;}
   const views:DesktopSnapshot['accounts']={},accountErrors:DesktopSnapshot['accountErrors']={},supplies:DesktopSnapshot['supplies']={},supplyErrors:DesktopSnapshot['supplyErrors']={};
   const supply=device?.state==='bound'&&device.hive&&device.identity?deps.supply?.({hive:device.hive,deviceId:device.identity.id}):undefined;
   for(const platform of ['openai','claude'] as const){
    if(!current())return;
    let account:AccountSnapshot|undefined;
    try{account=await accounts?.snapshot(platform,true);}catch(e){if(!current())return;accountErrors[platform]=failure(e,'account_snapshot');}
    let observedSupply:SupplyView|undefined;
    publish({supplyPlatform:platform});
    try{observedSupply=await supply?.status(platform);}catch(e){if(!current())return;supplyErrors[platform]=failure(e,'supply_read');}
    if(!current())return;
    const view=next.platforms[platform];
    const fresh=account&&(!view||account.revision>=view.account.revision)?account:view?.account;
    if(fresh){views[platform]=fresh;if(view)next.platforms[platform]={...view,account:fresh};}
    if(observedSupply)supplies[platform]=observedSupply;else if(!supply&&view?.supply)supplies[platform]=view.supply;else if(state.supplies[platform])supplies[platform]=state.supplies[platform];
   }
   if(!current())return;
   if(next.revision<runtimeReceiptRevision)throw {code:'DESKTOP_STALE_RESULT',evidence:{actual:String(next.revision),required:`runtime revision >=${runtimeReceiptRevision} from confirmed operation receipt`},message:`runtime revision actual=${next.revision}; required>=${runtimeReceiptRevision} from confirmed operation receipt`};
   for(const platform of ['openai','claude'] as const){
    const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1),actual=views[platform]?.revision;
    if(minimum>=0&&(actual===undefined||actual<minimum)){
     const previous=accountErrors[platform];
     accountErrors[platform]=failure({...previous,code:previous?.code??'DESKTOP_STALE_RESULT',evidence:{...previous?.evidence,actual:String(actual??'missing'),required:`account revision >=${minimum}`},message:`${previous?.message?previous.message+'; ':''}account revision platform=${platform} actual=${actual??'missing'}; required>=${minimum} from last confirmed observation`},'account_snapshot');
     if(state.accounts[platform]){views[platform]=state.accounts[platform];next.platforms[platform]={...next.platforms[platform],account:state.accounts[platform]!};}
    }
   }
   publish({device,deviceError,runtime:next,defaults,accounts:views,accountErrors,supplies,supplyErrors,error:null});
  }catch(e){if(current()){const message=failure(e);if(message.code==='DESKTOP_STALE_RESULT')paused=true;publish({device:deviceError?undefined:device,deviceError,error:deviceError?null:message});}}finally{pending=undefined;if(current()){
   publish({busy:false,supplyPlatform:null});
   const operationPending=Object.values(state.accounts).some(v=>v.operation&&['pending','running'].includes(v.operation.state));
   const moving=state.runtime?.local==='starting'||state.runtime?.local==='stopping'||operationPending;
   const delay=moving?400:state.device?.state==='pending'||state.device?.state==='draining'?(state.device.poll_interval_seconds??2)*1000:deps.intervalMs??10000;
   if(!paused)timer=setTimeout(()=>void refresh().catch(()=>undefined),delay);
  }}})();
  pending=task;return task;
 }
 return {async recheckStartup(){if(!deps.bridge.startupRecheck)return refresh();const next=await deps.bridge.startupRecheck();await refresh();acceptStartup(next);},subscribe(fn:()=>void){if(disposed)return()=>{};listeners.add(fn);begin();return()=>{listeners.delete(fn);};},getSnapshot:()=>state,refresh,generation:()=>epoch,
  recordRuntimeReceipt(revision:number){runtimeReceiptRevision=Math.max(runtimeReceiptRevision,revision);},
  recordAccountReceipt(platform:'openai'|'claude',revision:number){accountReceiptRevisions[platform]=Math.max(accountReceiptRevisions[platform]??-1,revision);},
  pause(){paused=true;epoch++;clearTimeout(timer);publish({busy:false,supplyPlatform:null});const generation=epoch;timer=setTimeout(()=>{if(!disposed&&epoch===generation)void refresh().catch(()=>undefined);},10000);},
  dispose(){disposed=true;epoch++;clearTimeout(timer);unlisten?.();unlistenStartup?.();listeners.clear();}};
}
export type DesktopState=ReturnType<typeof createDesktopState>;
