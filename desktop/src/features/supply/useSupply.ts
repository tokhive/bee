import type {RefreshStatus} from '../../system/desktopState';
import {normalizeFailure,requestNotSent,type UiFailure} from '../../system/failures.ts';
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {SupplyClient,SupplyPlatform,SupplyView} from '../../system/supply';
export const platforms:SupplyPlatform[]=['openai','claude'];
export const failure=(cause:unknown,check='supply_read'):UiFailure=>normalizeFailure(cause,check);
export interface SupplyState {views:Partial<Record<SupplyPlatform,SupplyView>>;errors:Partial<Record<SupplyPlatform,UiFailure>>;busy:boolean;writeBusy:boolean;now:number;operation:'idle'|'read'|'write';activePlatform:SupplyPlatform|null;retryAt:number|null;refreshStatus?:RefreshStatus;supplyRefresh?:Partial<Record<SupplyPlatform,RefreshStatus>>}
export function supplyFresh(state:SupplyState,platform:SupplyPlatform,now=Date.now()):boolean {
 const view=state.views[platform];
 return Boolean(view&&!['waiting','blocked'].includes(state.supplyRefresh?.[platform]?.state??'')&&!state.errors[platform]&&Math.max(state.now,now)-Date.parse(view.checked_at)<=30000);
}
export function supplyProgress(state:SupplyState,platform:SupplyPlatform,now=Date.now()):'inflight'|'waiting'|'retrying'|'checking'|'blocked'|'stale'|null {
 const refresh=state.supplyRefresh?.[platform];
 if(refresh){
  if(state.operation==='write'&&state.activePlatform===platform)return 'checking';
  if(refresh.state==='waiting')return 'inflight';
  if(supplyFresh(state,platform,now))return null;
  if(refresh.state==='reading')return state.errors[platform]?'retrying':'checking';
  if(refresh.state==='scheduled'&&refresh.nextRetryAt)return 'waiting';
  return refresh.state==='blocked'?'blocked':'stale';
 }
 if(state.errors[platform])return state.operation==='read'&&state.activePlatform===platform?'retrying':'waiting';
 if(state.operation==='write'&&state.activePlatform===platform)return 'checking';
 if(supplyFresh(state,platform,now))return null;
 return state.operation==='read'&&state.views[platform]?'checking':null;
}
export interface CoordinatedSupply {views:Partial<Record<SupplyPlatform,SupplyView>>;errors?:Partial<Record<SupplyPlatform,UiFailure>>;activePlatform?:SupplyPlatform|null;refreshStatus?:RefreshStatus;supplyRefresh?:Partial<Record<SupplyPlatform,RefreshStatus>>;error:UiFailure|null;busy:boolean;refresh:()=>Promise<void>;pause?:()=>void;snapshot?:()=>SupplyObservation;writeContext?:Partial<Record<SupplyPlatform,string>>}
type SupplyObservation=Pick<CoordinatedSupply,'views'|'errors'|'activePlatform'|'error'|'busy'|'writeContext'|'refreshStatus'|'supplyRefresh'>;
export function createSupplyModel(client:SupplyClient){
 let pendingPlatforms:SupplyPlatform[]=[];
 let writeContext:Partial<Record<SupplyPlatform,string>>={};
 const writeVersions:Record<SupplyPlatform,number>={openai:0,claude:0};
 let state:SupplyState={views:{},errors:{},busy:false,writeBusy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null},active=false,blocked=false,generation=0;
 let timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 let coordinatedRefresh:(()=>Promise<void>)|undefined,coordinatedPause:(()=>void)|undefined,externalBusy=false,externalError:UiFailure|null=null,adoptions=0,awaitingExplicitAdoption=false,localBusy=false;
 let writeErrors:Partial<Record<SupplyPlatform,UiFailure>>={},externalErrors:Partial<Record<SupplyPlatform,UiFailure>>={};
 let coordinatedSnapshot:(()=>SupplyObservation)|undefined;
 let observedViews:CoordinatedSupply['views']|undefined,uncertainViews:CoordinatedSupply['views']|undefined;
 const adoptedErrors=()=>externalError?{...writeErrors,...externalErrors,openai:externalError,claude:externalError}:{...writeErrors,...externalErrors};
 const publish=(next:Partial<SupplyState>)=>{state={...state,...next};listeners.forEach(listener=>listener());};
 const readFailed=(cause:unknown,affected:SupplyPlatform[]=platforms)=>{uncertainViews=observedViews;for(const p of affected)writeErrors[p]=failure(cause);publish({errors:adoptedErrors(),now:Date.now()});};
 const usable=(p:SupplyPlatform,paused=false)=>!blocked&&supplyFresh(state,p)&&(paused||!pendingPlatforms.includes(p)&&!state.views[p]!.reasons.some(r=>r.endsWith('_confirmation_required')))&&Date.now()-Date.parse(state.views[p]!.checked_at)<=30000;
 const canWrite=(p:SupplyPlatform,paused=false)=>active&&!state.writeBusy&&usable(p,paused);
 function scheduleExpiry(){
  clearTimeout(expiry);
  const times=Object.values(state.views).map(v=>Date.parse(v.checked_at)+30001).filter(time=>time>Date.now());
  if(times.length)expiry=setTimeout(()=>{
   publish({now:Date.now()});
   scheduleExpiry();
   // An expiry during an existing request joins it; never starts a parallel read.
   if(!coordinatedRefresh&&(!Object.keys(state.errors).length||state.busy))void run();
  },Math.max(0,Math.min(...times)-Date.now()));
 }
 function run(writes?:{platform:SupplyPlatform;paused:boolean;version:number}[]):Promise<void>{
  if(!active)return Promise.resolve();
  if(state.busy)return pending??Promise.resolve();
  if(pending){const epoch=generation;return pending.then(()=>{if(active&&generation===epoch)return run(writes);});}
  if(writes&&(blocked||!writes.every(w=>w.version===writeVersions[w.platform]&&usable(w.platform,w.paused)))){publish({now:Date.now()});return Promise.resolve();}
  if(!writes&&state.writeBusy)return Promise.resolve();
  clearTimeout(timer);localBusy=true;publish({busy:true,operation:writes?'write':'read',activePlatform:null,retryAt:null});const epoch=generation;
  if(coordinatedRefresh&&!writes){
   const refresh=coordinatedRefresh,version=adoptions;
   const operation=(async()=>{
    try{await refresh();if(!active||generation!==epoch)return;if(coordinatedSnapshot)adopt(coordinatedSnapshot());if(adoptions>version&&!externalError&&!externalBusy)writeErrors={};else awaitingExplicitAdoption=true;}
    catch(cause){if(active&&generation===epoch)readFailed(cause);}
    finally{if(active&&generation===epoch){localBusy=false;publish({busy:externalBusy,operation:externalBusy?'read':'idle',activePlatform:null,errors:adoptedErrors(),now:Date.now()});scheduleExpiry();}}
   })();const tracked=operation.finally(()=>{if(pending===tracked)pending=undefined;});pending=tracked;return tracked;
  }
  const operation=(async()=>{
   const errors=coordinatedRefresh?{...writeErrors}:{...state.errors},views={...state.views};let writeFailed=false;
   for(const platform of writes?writes.map(w=>w.platform):platforms){
    if(!active||generation!==epoch)return;
    publish({activePlatform:platform});
    const write=writes?.find(w=>w.platform===platform);
    if(write&&write.version!==writeVersions[platform])continue;
    try{if(write&&!usable(platform,write.paused))throw new Error('SUPPLY_WRITE_BLOCKED: platform snapshot is no longer writable; required=fresh verified state without pending account change');const result=write?await client.setPaused(platform,write.paused):await client.status(platform);if(!coordinatedRefresh)views[platform]=result;delete errors[platform];}
    catch(cause){errors[platform]=failure(cause,writes?'supply_write':'supply_read');if(writes&&active&&generation===epoch){writeFailed=true;uncertainViews=observedViews;if(!requestNotSent(errors[platform]!))coordinatedPause?.();}}
    if(!active||generation!==epoch)return;
    if(coordinatedRefresh){writeErrors={...errors};publish({errors:adoptedErrors(),now:Date.now()});}
    else publish({views:{...views},errors:{...errors},now:Date.now()});
    scheduleExpiry();
   }
   if(!active||generation!==epoch)return;
   if(coordinatedRefresh&&writes&&!writeFailed){try{if(externalBusy)await coordinatedRefresh();if(!active||generation!==epoch)return;await coordinatedRefresh();if(active&&generation===epoch&&coordinatedSnapshot)adopt(coordinatedSnapshot());}catch(cause){if(active&&generation===epoch)readFailed(cause,writes.map(w=>w.platform));}if(!active||generation!==epoch)return;}
   localBusy=false;publish({busy:externalBusy,operation:externalBusy?'read':'idle',activePlatform:null,retryAt:Object.keys(errors).length?Date.now()+10000:null,...(coordinatedRefresh?{errors:adoptedErrors()}:{} )});scheduleExpiry();
   // Any uncertain write/read requires an explicit GET, never an automatic PUT.
   if(!coordinatedRefresh)timer=setTimeout(()=>void run(),10000);
  })();const tracked=operation.finally(()=>{if(pending===tracked)pending=undefined;});pending=tracked;return tracked;
 }
 function setWriteContext(next:Partial<Record<SupplyPlatform,string>>){for(const p of platforms)if(next[p]!==writeContext[p])writeVersions[p]++;writeContext={...next};}
 function adopt(value:SupplyObservation){if(!active||!coordinatedRefresh)return;adoptions++;externalBusy=value.busy;externalError=value.error;externalErrors=value.errors??{};observedViews=value.views;
  if(value.writeContext)setWriteContext(value.writeContext);
  if(uncertainViews&&value.views!==uncertainViews&&!externalBusy&&!externalError){writeErrors={};uncertainViews=undefined;}if(awaitingExplicitAdoption&&!externalBusy&&!externalError){writeErrors={};awaitingExplicitAdoption=false;}publish({refreshStatus:value.refreshStatus,supplyRefresh:value.supplyRefresh,views:{...value.views},errors:adoptedErrors(),busy:localBusy||externalBusy,operation:localBusy?state.operation:externalBusy?'read':'idle',activePlatform:localBusy?state.activePlatform:value.activePlatform??null,now:Date.now()});scheduleExpiry();
 }
 function write(writes:{platform:SupplyPlatform;paused:boolean}[]):Promise<void>{
  if(coordinatedSnapshot)adopt(coordinatedSnapshot());
  if(!writes.every(w=>canWrite(w.platform,w.paused))){publish({now:Date.now()});return Promise.resolve();}
  const epoch=generation,intent=writes.map(w=>({...w,version:writeVersions[w.platform]})),waitForCentral=externalBusy;
  publish({writeBusy:true});
  return (async()=>{
   if(pending)await pending;
   if(!active||epoch!==generation)return;
   if(waitForCentral&&coordinatedRefresh){
    await coordinatedRefresh();if(!active||epoch!==generation)return;
    // The account read may precede a slow supply read. Recheck its current identity before PUT.
    await coordinatedRefresh();if(!active||epoch!==generation)return;
    if(coordinatedSnapshot)adopt(coordinatedSnapshot());
   }
   await run(intent);
  })().catch(cause=>{if(active&&epoch===generation)readFailed(cause,writes.map(w=>w.platform));}).finally(()=>{if(active&&epoch===generation)publish({writeBusy:false});});
 }
 return {subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>state,setBlocked(value:boolean){blocked=value;},setPending(value:SupplyPlatform[]){for(const p of platforms)if(value.includes(p)!==pendingPlatforms.includes(p))writeVersions[p]++;pendingPlatforms=value;},setWriteContext,
  setCoordinated(refresh?:()=>Promise<void>,pause?:()=>void,snapshot?:()=>SupplyObservation){coordinatedRefresh=refresh;coordinatedPause=pause;coordinatedSnapshot=snapshot;if(refresh)clearTimeout(timer);},adopt,
  start(){if(active)return;active=true;generation++;},stop(){active=false;generation++;localBusy=false;awaitingExplicitAdoption=false;clearTimeout(timer);clearTimeout(expiry);publish({busy:false,writeBusy:false,operation:'idle',activePlatform:null,retryAt:null});},
  read:()=>run(),write:(platform:SupplyPlatform,paused:boolean)=>write([{platform,paused}]),writeAll:(paused:boolean)=>write(platforms.map(platform=>({platform,paused}))),canWrite};
}
export type SupplyModel=ReturnType<typeof createSupplyModel>;
export interface SharedSupply {model:SupplyModel;state:SupplyState;blocked:boolean}
export function useSupply(client:SupplyClient|undefined,enabled:boolean,blocked:boolean,pending:SupplyPlatform[]=[],coordinated?:CoordinatedSupply,writeContext:Partial<Record<SupplyPlatform,string>>={}):SharedSupply|undefined {
 const model=useMemo(()=>client?createSupplyModel(client):undefined,[client]);
 const empty=useMemo<SupplyState>(()=>({views:{},errors:{},busy:false,writeBusy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null}),[]);
 const state=useSyncExternalStore(model?.subscribe??(()=>()=>{}),model?.getSnapshot??(()=>empty));
 model?.setBlocked(blocked);model?.setPending(pending);model?.setWriteContext(writeContext);
 model?.setCoordinated(coordinated?.refresh,coordinated?.pause,coordinated?.snapshot);
 const external=!!coordinated;
 useEffect(()=>{if(!model||!enabled)return;model.start();let active=true;if(!external)queueMicrotask(()=>{if(active)void model.read();});return()=>{active=false;model.stop();};},[model,enabled,external]);
 useEffect(()=>{if(model&&enabled&&coordinated)model.adopt(coordinated);},[model,enabled,coordinated?.views,coordinated?.errors,coordinated?.activePlatform,coordinated?.error,coordinated?.busy,coordinated?.refreshStatus,coordinated?.supplyRefresh]);
 return model?{model,state,blocked}:undefined;
}
