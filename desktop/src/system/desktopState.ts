import {normalizeFailure,type UiFailure} from './failures.ts';
import type {SystemBridge,BridgeStatus,StartupStatus} from './bridge';
import type {DeviceClient,DeviceView,DeviceContext} from './device';
import type {AccountFactory,AccountDefaults,AccountSnapshot,AccountPlatform} from './accounts';
import type {SupplyFactory,SupplyView} from './supply';
import type {RuntimeFactory,RuntimeSnapshot} from './runtime';
import type {DiagnosticReport} from './diagnostics';
export interface RefreshStatus {state:'idle'|'reading'|'scheduled'|'blocked';nextRetryAt:string|null;lastConfirmedAt:string|null}
export interface DesktopSnapshot {
 native:BridgeStatus;startup?:StartupStatus;deviceContext?:DeviceContext;bindingRevision?:number;deviceContextFailure?:UiFailure;
 device?:DeviceView;deviceError:UiFailure|null;runtime?:RuntimeSnapshot;defaults?:AccountDefaults;
 accounts:Partial<Record<AccountPlatform,AccountSnapshot>>;accountErrors:Partial<Record<AccountPlatform,UiFailure>>;
 supplies:Partial<Record<AccountPlatform,SupplyView>>;supplyErrors:Partial<Record<AccountPlatform,UiFailure>>;
 supplyPlatform?:AccountPlatform|null;error:UiFailure|null;busy:boolean;
 refresh:RefreshStatus;accountRefresh:Partial<Record<AccountPlatform,RefreshStatus>>;supplyRefresh:Partial<Record<AccountPlatform,RefreshStatus>>;
 diagnosticFailure?:UiFailure|null;
}
export interface DesktopDeps {bridge:SystemBridge;device:DeviceClient;runtime:RuntimeFactory;accounts?:AccountFactory;supply?:SupplyFactory;intervalMs?:number}
const platforms=['openai','claude'] as const;
export const idleRefresh=():RefreshStatus=>({state:'idle',nextRetryAt:null,lastConfirmedAt:null});
const status=(previous:RefreshStatus|undefined,state:RefreshStatus['state'],nextRetryAt:string|null=null):RefreshStatus=>({...previous??idleRefresh(),state,nextRetryAt});
const confirmed=():RefreshStatus=>({state:'idle',nextRetryAt:null,lastConfirmedAt:new Date().toISOString()});
const failure=(e:unknown,check='desktop_refresh')=>normalizeFailure(e,check);
/** The only application polling owner. A page subscription never starts another reader. */
export function createDesktopState(deps:DesktopDeps){
 let state:DesktopSnapshot={native:{state:'starting'},deviceError:null,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,busy:false,refresh:idleRefresh(),accountRefresh:{},supplyRefresh:{}};
 let disposed=false,started=false,epoch=0,pendingEpoch=0,blocked=false;
 let unlisten:(()=>void)|undefined,unlistenStartup:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,nextRefresh:Promise<void>|undefined;
 let runtimeReceiptRevision=-1,accountReceiptRevisions:Partial<Record<AccountPlatform,number>>={};
 let deviceObservedAt:string|null=null,diagnosticObservedAt:string|null=null;
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<DesktopSnapshot>)=>{if(disposed)return;state={...state,...next};listeners.forEach(fn=>fn());};
 const mapStatus=(map:DesktopSnapshot['accountRefresh'],kind:RefreshStatus['state'],at:string|null=null)=>Object.fromEntries(platforms.map(p=>[p,status(map[p],kind,at)]));
 const reset=()=>({device:undefined,deviceContext:undefined,bindingRevision:undefined,deviceContextFailure:undefined,deviceError:null,runtime:undefined,defaults:undefined,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,diagnosticFailure:null,refresh:idleRefresh(),accountRefresh:{},supplyRefresh:{}});
 const acceptStartup=(next:StartupStatus)=>{
  if(disposed||next.instance&&state.native.metadata?.instance&&next.instance!==state.native.metadata.instance)return;
  if(next.state!=='checking'){
   if(state.bindingRevision!==undefined&&next.binding_revision!==null&&next.binding_revision!==state.bindingRevision)return;
   if(state.runtime&&next.network_revision!==null&&next.network_revision!==state.runtime.network_revision)return;
  }
  if(state.startup&&next.revision<state.startup.revision)return;
  publish({startup:next});
 };
 function accept(native:BridgeStatus){
  if(disposed)return;
  const changed=native.metadata?.instance!==state.native.metadata?.instance||native.state!==state.native.state;
  if(!changed){publish({native});return;}
  epoch++;blocked=false;runtimeReceiptRevision=-1;accountReceiptRevisions={};deviceObservedAt=diagnosticObservedAt=null;clearTimeout(timer);
  const generation=epoch,instance=native.metadata?.instance,startup=native.state==='ready'&&state.startup?.instance===instance?state.startup:undefined;
  publish({...reset(),native,startup,busy:false});
  if(native.state==='ready')queueMicrotask(()=>{if(!disposed&&epoch===generation&&state.native.metadata?.instance===instance)void refresh();});
 }
 function begin(){
  if(started||disposed)return;started=true;let received=false;
  void deps.bridge.onStatus(v=>{received=true;accept(v);}).then(off=>{if(disposed)off();else unlisten=off;},e=>publish({error:failure(e)}));
  if(deps.bridge.onStartup)void deps.bridge.onStartup(acceptStartup).then(off=>{if(disposed)off();else unlistenStartup=off;},e=>publish({error:failure(e,'startup_status')}));
  if(deps.bridge.startupStatus)void deps.bridge.startupStatus().then(acceptStartup,e=>publish({error:failure(e,'startup_status')}));
  void deps.bridge.status().then(v=>{if(!received)accept(v);},e=>{if(!received)publish({error:failure(e)});});
 }
 function schedule(delay:number){
  clearTimeout(timer);const generation=epoch,at=new Date(Date.now()+delay).toISOString();
  timer=setTimeout(()=>{timer=undefined;if(!disposed&&epoch===generation)void refresh();},delay);
  publish({refresh:status(state.refresh,'scheduled',at),accountRefresh:Object.fromEntries(platforms.map(p=>[p,state.accountRefresh[p]?.state==='blocked'?state.accountRefresh[p]:status(state.accountRefresh[p],'scheduled',at)])),supplyRefresh:Object.fromEntries(platforms.map(p=>[p,state.supplyRefresh[p]?.state==='blocked'?state.supplyRefresh[p]:status(state.supplyRefresh[p],'scheduled',at)]))});
 }
 async function refresh():Promise<void>{
  if(disposed)return;if(!started)begin();
  if(pending){if(pendingEpoch!==epoch){nextRefresh??=pending.then(()=>{nextRefresh=undefined;return refresh();});return nextRefresh;}return pending;}
  const instance=state.native.metadata?.instance;if(state.native.state!=='ready'||!instance)return;
  clearTimeout(timer);timer=undefined;blocked=false;let generation=epoch;pendingEpoch=generation;
  publish({busy:true,refresh:status(state.refresh,'reading'),accountRefresh:mapStatus(state.accountRefresh,'idle'),supplyRefresh:mapStatus(state.supplyRefresh,'idle')});
  const current=()=>!disposed&&epoch===generation&&state.native.metadata?.instance===instance;
  const task=(async()=>{
   let device=state.device,deviceError:UiFailure|null=null;
   try{
    const runtime=deps.runtime(instance),accounts=deps.accounts?.(instance);
    let deviceContext:DeviceContext|undefined,bindingRevision:number|undefined,deviceContextFailure:UiFailure|undefined;
    if(deps.device.context)try{const local=await deps.device.context();bindingRevision=local.binding_revision;if('failure'in local){deviceContextFailure=local.failure;if(local.failure.code!=='DEVICE_CONTEXT_UNCONFIGURED')deviceError=local.failure;}else deviceContext=local;}catch(e){deviceContextFailure=deviceError=failure(e,'device_context');}
    if(!current())return;
    if(state.bindingRevision!==undefined&&bindingRevision!==state.bindingRevision){
     epoch++;generation=epoch;pendingEpoch=generation;runtimeReceiptRevision=-1;accountReceiptRevisions={};deviceObservedAt=diagnosticObservedAt=null;device=undefined;
     publish({...reset(),deviceContext,bindingRevision,deviceContextFailure,startup:undefined,refresh:status(undefined,'reading')});
    }else publish({deviceContext,bindingRevision,deviceContextFailure});
    try{device=await deps.device.status();deviceObservedAt=new Date().toISOString();if(!diagnosticObservedAt||Date.parse(deviceObservedAt)>Date.parse(diagnosticObservedAt))publish({diagnosticFailure:null});}catch(e){if(!current())return;deviceError??=failure(e,'device_status');}
    if(!current())return;
    // Runtime and defaults form the shared read. Validate all shared floors BEFORE publishing any of it.
    const [next,defaults]=await Promise.all([runtime.snapshot(),!state.defaults&&accounts?accounts.defaults():Promise.resolve(state.defaults)]);
    if(!current())return;
    const minimum=Math.max(runtimeReceiptRevision,state.runtime?.revision??-1);
    if(next.revision<minimum||state.runtime&&next.network_revision<state.runtime.network_revision)throw {
     code:'DESKTOP_STALE_RESULT',evidence:{actual:String(next.revision),required:'runtime revision >='+minimum+' from confirmed operation receipt'},
     message:'runtime revision actual='+next.revision+'; required>='+minimum+' from confirmed operation receipt; network actual='+next.network_revision+' required>='+(state.runtime?.network_revision??0)
    };
    const networkChanged=state.runtime&&state.runtime.network_revision!==next.network_revision;
    if(networkChanged){diagnosticObservedAt=null;publish({diagnosticFailure:null});}
    publish({device,deviceError,runtime:next,defaults,error:null,refresh:deviceError?status(state.refresh,'idle'):confirmed()});
    if(deviceError){publish({accountRefresh:mapStatus(state.accountRefresh,'blocked'),supplyRefresh:mapStatus(state.supplyRefresh,'blocked')});return;}
    const supply=device?.state==='bound'&&device.hive&&device.identity?deps.supply?.({hive:device.hive,deviceId:device.identity.id}):undefined;
    await Promise.all(platforms.map(async platform=>{
     const readAccount=async()=>{
      if(!accounts){
       const account=next.platforms[platform]?.account;
       if(account)publish({accounts:{...state.accounts,[platform]:account},accountRefresh:{...state.accountRefresh,[platform]:confirmed()}});
       return;
      }
      publish({accountRefresh:{...state.accountRefresh,[platform]:status(state.accountRefresh[platform],'reading')}});
      try{
       const account=await accounts.snapshot(platform,true);if(!current())return;
       const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1,next.platforms[platform]?.account.revision??-1);
       if(account.revision<minimum)throw {code:'DESKTOP_STALE_RESULT',evidence:{actual:String(account.revision),required:'account revision >='+minimum},message:'account revision platform='+platform+' actual='+account.revision+'; required>='+minimum+' from last confirmed observation'};
       const errors={...state.accountErrors};delete errors[platform];
       const runtime=state.runtime!,view=runtime.platforms[platform];
       publish({accounts:{...state.accounts,[platform]:account},accountErrors:errors,accountRefresh:{...state.accountRefresh,[platform]:confirmed()},runtime:{...runtime,platforms:{...runtime.platforms,...(view?{[platform]:{...view,account}}:{})}}});
      }catch(e){if(!current())return;
       let problem=failure(e,'account_snapshot');
       const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1),actual=next.platforms[platform]?.account.revision;
       if(minimum>=0&&(actual===undefined||actual<minimum))problem=failure({...problem,evidence:{...problem.evidence,actual:String(actual??'missing'),required:'account revision >='+minimum},message:problem.message+'; account revision platform='+platform+' actual='+(actual??'missing')+'; required>='+minimum+' from last confirmed observation'},'account_snapshot');
       publish({accountErrors:{...state.accountErrors,[platform]:problem},accountRefresh:{...state.accountRefresh,[platform]:status(state.accountRefresh[platform],'idle')}});
      }
     };
     const readSupply=async()=>{
      if(!supply){const view=next.platforms[platform]?.supply;if(view)publish({supplies:{...state.supplies,[platform]:view},supplyRefresh:{...state.supplyRefresh,[platform]:confirmed()}});return;}
      publish({supplyRefresh:{...state.supplyRefresh,[platform]:status(state.supplyRefresh[platform],'reading')}});
      try{const view=await supply.status(platform);if(!current())return;const errors={...state.supplyErrors};delete errors[platform];publish({supplies:{...state.supplies,[platform]:view},supplyErrors:errors,supplyRefresh:{...state.supplyRefresh,[platform]:confirmed()}});}
      catch(e){if(current())publish({supplyErrors:{...state.supplyErrors,[platform]:failure(e,'supply_read')},supplyRefresh:{...state.supplyRefresh,[platform]:status(state.supplyRefresh[platform],'idle')}});}
     };
     await Promise.all([readAccount(),readSupply()]);
    }));
   }catch(e){if(current()){const problem=failure(e);if(problem.code==='DESKTOP_STALE_RESULT')blocked=true;publish({device,deviceError,error:problem});}}
   finally{
    if(current()){
     publish({busy:false,supplyPlatform:null});
     if(blocked)publish({refresh:status(state.refresh,'blocked'),accountRefresh:mapStatus(state.accountRefresh,'blocked'),supplyRefresh:mapStatus(state.supplyRefresh,'blocked')});
     else{
      const moving=state.runtime?.local==='starting'||state.runtime?.local==='stopping'||Object.values(state.accounts).some(v=>v.operation&&['pending','running','reconciling'].includes(v.operation.state));
      schedule(moving?400:state.device?.state==='pending'||state.device?.state==='draining'?(state.device.poll_interval_seconds??2)*1000:deps.intervalMs??10000);
     }
    }
   }
  })();
  pending=task;
  try{await task;}finally{if(pending===task)pending=undefined;}
 }
 function acceptDiagnosticReport(report:DiagnosticReport){
  if(disposed||report.instance!==state.native.metadata?.instance||report.binding_revision!==state.bindingRevision||report.network_revision!==state.runtime?.network_revision||report.run_id!==state.runtime?.run_id)return;
  for(const check of report.checks){
   if(check.id!=='hive'||check.platform!==null||check.status!=='fail'||!['device_replaced','http_rejected','identity_mismatch'].includes(check.code))continue;
   if(!Number.isFinite(Date.parse(check.observed_at))||deviceObservedAt&&Date.parse(check.observed_at)<=Date.parse(deviceObservedAt)||diagnosticObservedAt&&Date.parse(check.observed_at)<=Date.parse(diagnosticObservedAt))continue;
   diagnosticObservedAt=check.observed_at;
   const evidence:Record<string,string>={};for(const key of ['http_status','path'] as const)if(check.evidence[key])evidence[key]=check.evidence[key];if(check.evidence.server_code)evidence.remote_code=check.evidence.server_code;
   publish({diagnosticFailure:failure({code:check.code,message:'Hive identity check '+check.code+(evidence.http_status?' HTTP '+evidence.http_status:''),details:{check:'device_identity',observed_at:check.observed_at,evidence}},'device_identity')});
  }
 }
 return {
  async recheckStartup(){if(!deps.bridge.startupRecheck)return refresh();const next=await deps.bridge.startupRecheck();await refresh();acceptStartup(next);},
  acceptDiagnosticReport,
  subscribe(fn:()=>void){if(disposed)return()=>{};listeners.add(fn);begin();return()=>{listeners.delete(fn);};},getSnapshot:()=>state,refresh,generation:()=>epoch,
  recordRuntimeReceipt(revision:number){runtimeReceiptRevision=Math.max(runtimeReceiptRevision,revision);},
  recordAccountReceipt(platform:AccountPlatform,revision:number){accountReceiptRevisions[platform]=Math.max(accountReceiptRevisions[platform]??-1,revision);},
  pause(){blocked=true;epoch++;clearTimeout(timer);publish({busy:false,supplyPlatform:null});schedule(10000);},
  dispose(){disposed=true;epoch++;clearTimeout(timer);unlisten?.();unlistenStartup?.();listeners.clear();}
 };
}
export type DesktopState=ReturnType<typeof createDesktopState>;
