import type {SystemBridge,BridgeStatus} from './bridge';
import type {DeviceClient,DeviceView} from './device';
import type {AccountFactory,AccountDefaults,AccountSnapshot} from './accounts';
import type {SupplyFactory,SupplyView} from './supply';
import type {RuntimeFactory,RuntimeSnapshot} from './runtime';
export interface DesktopSnapshot {native:BridgeStatus;device?:DeviceView;deviceError:string;runtime?:RuntimeSnapshot;defaults?:AccountDefaults;accounts:Partial<Record<'openai'|'claude',AccountSnapshot>>;accountErrors:Partial<Record<'openai'|'claude',string>>;supplies:Partial<Record<'openai'|'claude',SupplyView>>;error:string;busy:boolean}
export interface DesktopDeps{bridge:SystemBridge;device:DeviceClient;runtime:RuntimeFactory;accounts?:AccountFactory;supply?:SupplyFactory;intervalMs?:number}
const failure=(e:unknown)=>e instanceof Error?e.message:typeof e==='object'&&e!==null&&'message'in e?String(e.message):'DESKTOP_REFRESH_FAILED: native snapshot lookup failed';
/** One application owner. Pages subscribe without starting independent polling. */
export function createDesktopState(deps:DesktopDeps){
 let state:DesktopSnapshot={native:{state:'starting'},deviceError:'',accounts:{},accountErrors:{},supplies:{},error:'',busy:false};
 let disposed=false,started=false,epoch=0,pendingEpoch=0,paused=false,unlisten:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,nextRefresh:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<DesktopSnapshot>)=>{if(disposed)return;state={...state,...next};listeners.forEach(fn=>fn());};
 function accept(status:BridgeStatus){
  if(disposed)return;
  const changed=status.metadata?.instance!==state.native.metadata?.instance||status.state!==state.native.state;
  if(changed){epoch++;paused=false;clearTimeout(timer);const generation=epoch,instance=status.metadata?.instance;publish({native:status,device:undefined,deviceError:'',runtime:undefined,defaults:undefined,accounts:{},accountErrors:{},supplies:{},error:'',busy:false});if(status.state==='ready')queueMicrotask(()=>{if(!disposed&&epoch===generation&&state.native.metadata?.instance===instance)void refresh().catch(()=>undefined);});}
  else publish({native:status});
 }
 function begin(){if(started||disposed)return;started=true;let received=false;
  void deps.bridge.onStatus(v=>{received=true;accept(v);}).then(off=>{if(disposed)off();else unlisten=off;},e=>publish({error:failure(e)}));
  void deps.bridge.status().then(v=>{if(!received)accept(v);},e=>{if(!received)publish({error:failure(e)});});
 }
 async function refresh():Promise<void>{
  if(disposed)return;if(!started)begin();paused=false;
  if(pending){if(pendingEpoch!==epoch){nextRefresh??=pending.then(()=>{nextRefresh=undefined;return refresh();});return nextRefresh;}return pending;}
  const instance=state.native.metadata?.instance;if(state.native.state!=='ready'||!instance)return;
  clearTimeout(timer);const generation=epoch;pendingEpoch=generation;publish({busy:true});
  const current=()=>!disposed&&epoch===generation&&state.native.metadata?.instance===instance;
  const task=(async()=>{let device:DeviceView|undefined,deviceError='';try{
   const runtime=deps.runtime(instance),accounts=deps.accounts?.(instance);
   try{device=await deps.device.status();}catch(e){if(!current())return;deviceError=failure(e);}
   if(!current())return;
   const [next,defaults]=await Promise.all([runtime.snapshot(),!state.defaults&&accounts?accounts.defaults():Promise.resolve(state.defaults)]);
   if(!current())return;
   if(deviceError){publish({deviceError,defaults,error:''});throw new Error(deviceError);}
   if(state.runtime&&(next.revision<state.runtime.revision||next.network_revision<state.runtime.network_revision))throw new Error('DESKTOP_STALE_RESULT: runtime or network revision regressed');
   const views:DesktopSnapshot['accounts']={},accountErrors:DesktopSnapshot['accountErrors']={},supplies:DesktopSnapshot['supplies']={};
   const supply=device?.state==='bound'&&device.hive&&device.identity?deps.supply?.({hive:device.hive,deviceId:device.identity.id}):undefined;
   for(const platform of ['openai','claude'] as const){
    if(!current())return;
    let account:AccountSnapshot|undefined;
    try{account=await accounts?.snapshot(platform,true);}catch(e){if(!current())return;accountErrors[platform]=failure(e);}
    let observedSupply:SupplyView|undefined;
    try{observedSupply=await supply?.status(platform);}catch(e){if(current())publish({device,deviceError,error:failure(e),busy:false});return;}
    if(!current())return;
    const view=next.platforms[platform];
    const fresh=account&&(!view||account.revision>=view.account.revision)?account:view?.account;
    if(fresh){views[platform]=fresh;if(view)next.platforms[platform]={...view,account:fresh};}
    if(observedSupply)supplies[platform]=observedSupply;else if(view?.supply)supplies[platform]=view.supply;
   }
   if(!current())return;
   publish({device,deviceError,runtime:next,defaults,accounts:views,accountErrors,supplies,error:''});
  }catch(e){if(current()&&!deviceError)publish({device,deviceError,error:failure(e)});if(deviceError)throw e;}finally{pending=undefined;if(current()){
   publish({busy:false});
   const operationPending=Object.values(state.accounts).some(v=>v.operation&&['pending','running'].includes(v.operation.state));
   const moving=state.runtime?.local==='starting'||state.runtime?.local==='stopping'||operationPending;
   const delay=moving?400:state.device?.state==='pending'||state.device?.state==='draining'?(state.device.poll_interval_seconds??2)*1000:deps.intervalMs??10000;
   if(!paused&&!state.error)timer=setTimeout(()=>void refresh().catch(()=>undefined),delay);
  }}})();
  pending=task;return task;
 }
 return {subscribe(fn:()=>void){if(disposed)return()=>{};listeners.add(fn);begin();return()=>{listeners.delete(fn);};},getSnapshot:()=>state,refresh,generation:()=>epoch,
  pause(){paused=true;epoch++;clearTimeout(timer);publish({busy:false});},
  dispose(){disposed=true;epoch++;clearTimeout(timer);unlisten?.();listeners.clear();}};
}
export type DesktopState=ReturnType<typeof createDesktopState>;
