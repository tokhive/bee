import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {SupplyClient,SupplyPlatform,SupplyView} from '../../system/supply';
export const platforms:SupplyPlatform[]=['openai','claude'];
export const failure=(cause:unknown):string=>cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message'in cause?`${'code'in cause?String(cause.code)+': ':''}${String(cause.message)}`:String(cause);
export interface SupplyState {views:Partial<Record<SupplyPlatform,SupplyView>>;errors:Partial<Record<SupplyPlatform,string>>;busy:boolean;writeBusy:boolean;now:number;operation:'idle'|'read'|'write';activePlatform:SupplyPlatform|null;retryAt:number|null}
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
export function createSupplyModel(client:SupplyClient){
 let pendingPlatforms:SupplyPlatform[]=[];
 let writeContext:Partial<Record<SupplyPlatform,string>>={};
 const writeVersions:Record<SupplyPlatform,number>={openai:0,claude:0};
 let state:SupplyState={views:{},errors:{},busy:false,writeBusy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null},active=false,blocked=false,generation=0;
 let timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<SupplyState>)=>{state={...state,...next};listeners.forEach(listener=>listener());};
 const usable=(p:SupplyPlatform,paused=false)=>!blocked&&!state.errors[p]&&!!state.views[p]&&(paused||!pendingPlatforms.includes(p)&&!state.views[p]!.reasons.some(r=>r.endsWith('_confirmation_required')))&&Date.now()-Date.parse(state.views[p]!.checked_at)<=30000;
 const canWrite=(p:SupplyPlatform,paused=false)=>active&&!state.writeBusy&&usable(p,paused);
 function scheduleExpiry(){
  clearTimeout(expiry);
  const times=Object.values(state.views).map(v=>Date.parse(v.checked_at)+30001).filter(time=>time>Date.now());
  if(times.length)expiry=setTimeout(()=>{
   publish({now:Date.now()});
   scheduleExpiry();
   // An expiry during an existing request joins it; never starts a parallel read.
   if(!Object.keys(state.errors).length||state.busy)void run();
  },Math.max(0,Math.min(...times)-Date.now()));
 }
 function run(writes?:{platform:SupplyPlatform;paused:boolean;version:number}[]):Promise<void>{
  if(!active)return Promise.resolve();
  if(state.busy)return pending??Promise.resolve();
  // A stopped generation may still have an IPC in flight. Wait before reactivation.
  if(pending){const epoch=generation;return pending.then(()=>{if(active&&generation===epoch)return run(writes);});}
  if(writes&&(blocked||!writes.every(w=>w.version===writeVersions[w.platform]&&usable(w.platform,w.paused)))){publish({now:Date.now()});return Promise.resolve();}
  if(!writes&&state.writeBusy)return Promise.resolve();
  clearTimeout(timer);
  publish({busy:true,operation:writes?'write':'read',activePlatform:null,retryAt:null});
  const epoch=generation;
  const operation=(async()=>{
   const errors={...state.errors},views={...state.views};
   for(const platform of writes?writes.map(w=>w.platform):platforms){
    if(!active||generation!==epoch)return;
    publish({activePlatform:platform});
    const write=writes?.find(w=>w.platform===platform);
    if(write&&write.version!==writeVersions[platform])continue;
    try{if(write&&!usable(platform,write.paused))throw new Error('SUPPLY_WRITE_BLOCKED: platform snapshot is no longer writable; required=fresh verified state without pending account change');views[platform]=write?await client.setPaused(platform,write.paused):await client.status(platform);delete errors[platform];}
    catch(cause){errors[platform]=failure(cause);}
    if(!active||generation!==epoch)return;
    publish({views:{...views},errors:{...errors},now:Date.now()});
    scheduleExpiry();
   }
   if(!active||generation!==epoch)return;
   const retryAt=Object.keys(errors).length?Date.now()+10000:null;
   publish({busy:false,operation:'idle',activePlatform:null,retryAt});
   // Only reads are scheduled, including after an uncertain write.
   timer=setTimeout(()=>void run(),10000);
  })();
  const tracked=operation.finally(()=>{if(pending===tracked)pending=undefined;});
  pending=tracked;return tracked;
 }
 function write(writes:{platform:SupplyPlatform;paused:boolean}[]):Promise<void>{
  if(!writes.every(w=>canWrite(w.platform,w.paused)))return Promise.resolve();
  const epoch=generation;
  const intent=writes.map(w=>({...w,version:writeVersions[w.platform]}));
  publish({writeBusy:true});
  return (async()=>{
   await pending;
   if(!active||epoch!==generation)return;
   // Recheck the refreshed report before sending this one explicit change.
   await run(intent);
  })().finally(()=>{if(active&&epoch===generation)publish({writeBusy:false});});
 }
 return {subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>state,setBlocked(value:boolean){blocked=value;},setPending(value:SupplyPlatform[]){for(const p of platforms)if(value.includes(p)!==pendingPlatforms.includes(p))writeVersions[p]++;pendingPlatforms=value;},
  setWriteContext(next:Partial<Record<SupplyPlatform,string>>){for(const p of platforms)if(next[p]!==writeContext[p])writeVersions[p]++;writeContext={...next};},
  start(){if(active)return;active=true;generation++;},stop(){active=false;generation++;clearTimeout(timer);clearTimeout(expiry);publish({busy:false,writeBusy:false,operation:'idle',activePlatform:null,retryAt:null});},
  read:()=>run(),write:(platform:SupplyPlatform,paused:boolean)=>write([{platform,paused}]),writeAll:(paused:boolean)=>write(platforms.map(platform=>({platform,paused}))),canWrite};
}
export type SupplyModel=ReturnType<typeof createSupplyModel>;
export interface SharedSupply {model:SupplyModel;state:SupplyState;blocked:boolean}
export function useSupply(client:SupplyClient|undefined,enabled:boolean,blocked:boolean,pending:SupplyPlatform[]=[],writeContext:Partial<Record<SupplyPlatform,string>>={}):SharedSupply|undefined {
 const model=useMemo(()=>client?createSupplyModel(client):undefined,[client]);
 const empty=useMemo<SupplyState>(()=>({views:{},errors:{},busy:false,writeBusy:false,now:Date.now(),operation:'idle',activePlatform:null,retryAt:null}),[]);
 const state=useSyncExternalStore(model?.subscribe??(()=>()=>{}),model?.getSnapshot??(()=>empty));
 model?.setBlocked(blocked);model?.setPending(pending);model?.setWriteContext(writeContext);
 useEffect(()=>{if(!model||!enabled)return;model.start();let active=true;queueMicrotask(()=>{if(active)void model.read();});return()=>{active=false;model.stop();};},[model,enabled]);
 return model?{model,state,blocked}:undefined;
}
