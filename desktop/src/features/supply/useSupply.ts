import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {SupplyClient,SupplyPlatform,SupplyView} from '../../system/supply';
export const platforms:SupplyPlatform[]=['openai','claude'];
export const failure=(cause:unknown):string=>cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message'in cause?`${'code'in cause?String(cause.code)+': ':''}${String(cause.message)}`:String(cause);
export interface SupplyState {views:Partial<Record<SupplyPlatform,SupplyView>>;errors:Partial<Record<SupplyPlatform,string>>;busy:boolean;now:number;operation:'idle'|'read'|'write';activePlatform:SupplyPlatform|null;retryAt:number|null}
export function supplyFresh(state:SupplyState,platform:SupplyPlatform,now=Date.now()):boolean {
 const view=state.views[platform];
 return Boolean(view&&!state.errors[platform]&&Math.max(state.now,now)-Date.parse(view.checked_at)<=30000);
}
export function supplyProgress(state:SupplyState,platform:SupplyPlatform,now=Date.now()):'waiting'|'retrying'|'checking'|null {
 if(state.errors[platform])return state.operation==='read'&&state.activePlatform===platform?'retrying':'waiting';
 if(state.operation==='write'&&state.activePlatform===platform)return 'checking';
 if(supplyFresh(state,platform,now))return null;
 return state.operation==='read'&&state.views[platform]?'checking':null;
}
export interface CoordinatedSupply {views:Partial<Record<SupplyPlatform,SupplyView>>;errors?:Partial<Record<SupplyPlatform,string>>;activePlatform?:SupplyPlatform|null;error:string;busy:boolean;refresh:()=>Promise<void>;pause?:()=>void}
export function createSupplyModel(client:SupplyClient){
 let pendingPlatforms:SupplyPlatform[]=[];
 let state:SupplyState={views:{},errors:{},busy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null},active=false,blocked=false,generation=0;
 let timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 let coordinatedRefresh:(()=>Promise<void>)|undefined,coordinatedPause:(()=>void)|undefined,externalBusy=false,externalError='',adoptions=0,awaitingExplicitAdoption=false,localBusy=false;
 let writeErrors:Partial<Record<SupplyPlatform,string>>={},externalErrors:Partial<Record<SupplyPlatform,string>>={};
 let observedViews:CoordinatedSupply['views']|undefined,uncertainViews:CoordinatedSupply['views']|undefined;
 const adoptedErrors=()=>externalError?{...writeErrors,...externalErrors,openai:externalError,claude:externalError}:{...writeErrors,...externalErrors};
 const publish=(next:Partial<SupplyState>)=>{state={...state,...next};listeners.forEach(listener=>listener());};
 const usable=(p:SupplyPlatform,paused=false)=>!blocked&&!state.errors[p]&&!!state.views[p]&&(paused||!pendingPlatforms.includes(p)&&!state.views[p]!.reasons.some(r=>r.endsWith('_confirmation_required')))&&Date.now()-Date.parse(state.views[p]!.checked_at)<=30000;
 const canWrite=(p:SupplyPlatform,paused=false)=>active&&!state.busy&&usable(p,paused);
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
 function run(writes?:{platform:SupplyPlatform;paused:boolean}[]):Promise<void>{
  if(!active)return Promise.resolve();
  if(state.busy)return pending??Promise.resolve();
  if(pending){const epoch=generation;return pending.then(()=>{if(active&&generation===epoch)return run(writes);});}
  if(writes&&(blocked||!writes.every(w=>canWrite(w.platform,w.paused)))){publish({now:Date.now()});return Promise.resolve();}
  clearTimeout(timer);localBusy=true;publish({busy:true,operation:writes?'write':'read',activePlatform:null,retryAt:null});const epoch=generation;
  if(coordinatedRefresh&&!writes){
   const refresh=coordinatedRefresh,version=adoptions;
   const operation=(async()=>{
    try{await refresh();if(!active||generation!==epoch)return;if(adoptions>version&&!externalError&&!externalBusy)writeErrors={};else awaitingExplicitAdoption=true;}
    catch(cause){if(active&&generation===epoch)externalError=failure(cause);}
    finally{if(active&&generation===epoch){localBusy=false;publish({busy:externalBusy,operation:externalBusy?'read':'idle',activePlatform:null,errors:adoptedErrors(),now:Date.now()});scheduleExpiry();}}
   })();const tracked=operation.finally(()=>{if(pending===tracked)pending=undefined;});pending=tracked;return tracked;
  }
  const operation=(async()=>{
   const errors=coordinatedRefresh?{...writeErrors}:{...state.errors},views={...state.views};let writeFailed=false;
   for(const platform of writes?writes.map(w=>w.platform):platforms){
    if(!active||generation!==epoch)return;
    publish({activePlatform:platform});
    try{const write=writes?.find(w=>w.platform===platform);if(write&&!usable(platform,write.paused))throw new Error('SUPPLY_WRITE_BLOCKED: platform snapshot is no longer writable; required=fresh verified state without pending account change');const result=write?await client.setPaused(platform,write.paused):await client.status(platform);if(!coordinatedRefresh)views[platform]=result;delete errors[platform];}
    catch(cause){errors[platform]=failure(cause);if(writes&&active&&generation===epoch){writeFailed=true;uncertainViews=observedViews;coordinatedPause?.();}}
    if(!active||generation!==epoch)return;
    if(coordinatedRefresh){writeErrors={...errors};publish({errors:adoptedErrors(),now:Date.now()});}
    else publish({views:{...views},errors:{...errors},now:Date.now()});
    scheduleExpiry();
   }
   if(!active||generation!==epoch)return;
   if(coordinatedRefresh&&writes&&!writeFailed){try{await coordinatedRefresh();}catch(cause){externalError=failure(cause);}if(!active||generation!==epoch)return;}
   localBusy=false;publish({busy:externalBusy,operation:externalBusy?'read':'idle',activePlatform:null,retryAt:Object.keys(errors).length?Date.now()+10000:null,...(coordinatedRefresh?{errors:adoptedErrors()}:{} )});scheduleExpiry();
   // Any uncertain write/read requires an explicit GET, never an automatic PUT.
   if(!coordinatedRefresh)timer=setTimeout(()=>void run(),10000);
  })();const tracked=operation.finally(()=>{if(pending===tracked)pending=undefined;});pending=tracked;return tracked;
 }
 return {subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>state,setBlocked(value:boolean){blocked=value;},setPending(value:SupplyPlatform[]){pendingPlatforms=value;},
  setCoordinated(refresh?:()=>Promise<void>,pause?:()=>void){coordinatedRefresh=refresh;coordinatedPause=pause;if(refresh)clearTimeout(timer);},
  adopt(value:Pick<CoordinatedSupply,'views'|'errors'|'activePlatform'|'error'|'busy'>){if(!active||!coordinatedRefresh)return;adoptions++;externalBusy=value.busy;externalError=value.error;externalErrors=value.errors??{};observedViews=value.views;
   if(uncertainViews&&value.views!==uncertainViews&&!externalBusy&&!externalError){writeErrors={};uncertainViews=undefined;}if(awaitingExplicitAdoption&&!externalBusy&&!externalError){writeErrors={};awaitingExplicitAdoption=false;}publish({views:{...value.views},errors:adoptedErrors(),busy:localBusy||externalBusy,operation:localBusy?state.operation:externalBusy?'read':'idle',activePlatform:localBusy?state.activePlatform:value.activePlatform??null,now:Date.now()});scheduleExpiry();},
  start(){if(active)return;active=true;generation++;},stop(){active=false;generation++;localBusy=false;awaitingExplicitAdoption=false;clearTimeout(timer);clearTimeout(expiry);publish({busy:false,operation:'idle',activePlatform:null,retryAt:null});},
  read:()=>run(),write:(platform:SupplyPlatform,paused:boolean)=>run([{platform,paused}]),writeAll:(paused:boolean)=>run(platforms.map(platform=>({platform,paused}))),canWrite};
}
export type SupplyModel=ReturnType<typeof createSupplyModel>;
export interface SharedSupply {model:SupplyModel;state:SupplyState;blocked:boolean}
export function useSupply(client:SupplyClient|undefined,enabled:boolean,blocked:boolean,pending:SupplyPlatform[]=[],coordinated?:CoordinatedSupply):SharedSupply|undefined {
 const model=useMemo(()=>client?createSupplyModel(client):undefined,[client]);
 const empty=useMemo<SupplyState>(()=>({views:{},errors:{},busy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null}),[]);
 const state=useSyncExternalStore(model?.subscribe??(()=>()=>{}),model?.getSnapshot??(()=>empty));
 model?.setBlocked(blocked);model?.setPending(pending);
 model?.setCoordinated(coordinated?.refresh,coordinated?.pause);
 const external=!!coordinated;
 useEffect(()=>{if(!model||!enabled)return;model.start();let active=true;if(!external)queueMicrotask(()=>{if(active)void model.read();});return()=>{active=false;model.stop();};},[model,enabled,external]);
 useEffect(()=>{if(model&&enabled&&coordinated)model.adopt(coordinated);},[model,enabled,coordinated?.views,coordinated?.errors,coordinated?.activePlatform,coordinated?.error,coordinated?.busy]);
 return model?{model,state,blocked}:undefined;
}
