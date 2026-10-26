import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {SupplyClient,SupplyPlatform,SupplyView} from '../../system/supply';
export const platforms:SupplyPlatform[]=['openai','claude'];
export const failure=(cause:unknown):string=>cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message'in cause?`${'code'in cause?String(cause.code)+': ':''}${String(cause.message)}`:String(cause);
interface SupplyState {views:Partial<Record<SupplyPlatform,SupplyView>>;errors:Partial<Record<SupplyPlatform,string>>;busy:boolean;now:number}
export function createSupplyModel(client:SupplyClient){
 let pendingPlatforms:SupplyPlatform[]=[];
 let state:SupplyState={views:{},errors:{},busy:false,now:Date.now()},active=false,blocked=false,generation=0;
 let timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<SupplyState>)=>{state={...state,...next};listeners.forEach(listener=>listener());};
 const usable=(p:SupplyPlatform,paused=false)=>!blocked&&!state.errors[p]&&!!state.views[p]&&(paused||!pendingPlatforms.includes(p)&&!state.views[p]!.reasons.some(r=>r.endsWith('_confirmation_required')))&&Date.now()-Date.parse(state.views[p]!.checked_at)<=30000;
 const canWrite=(p:SupplyPlatform,paused=false)=>active&&!state.busy&&usable(p,paused);
 function scheduleExpiry(){clearTimeout(expiry);const times=Object.values(state.views).map(v=>Date.parse(v.checked_at)+30001).filter(t=>t>Date.now());if(times.length)expiry=setTimeout(()=>publish({now:Date.now()}),Math.max(0,Math.min(...times)-Date.now()));}
 function run(writes?:{platform:SupplyPlatform;paused:boolean}[]):Promise<void>{
  if(!active||state.busy)return pending??Promise.resolve();
  if(writes&&(blocked||!writes.every(w=>canWrite(w.platform,w.paused)))){publish({now:Date.now()});return Promise.resolve();}
  clearTimeout(timer);publish({busy:true});const epoch=generation;
  const operation=(async()=>{
   const errors={...state.errors},views={...state.views};
   for(const platform of writes?writes.map(w=>w.platform):platforms){
    if(!active||generation!==epoch)return;
    try{const write=writes?.find(w=>w.platform===platform);if(write&&!usable(platform,write.paused))throw new Error('SUPPLY_WRITE_BLOCKED: platform snapshot is no longer writable; required=fresh verified state without pending account change');views[platform]=write?await client.setPaused(platform,write.paused):await client.status(platform);delete errors[platform];}
    catch(cause){errors[platform]=failure(cause);}
    if(!active||generation!==epoch)return;
    publish({views:{...views},errors:{...errors},now:Date.now()});
   }
   if(!active||generation!==epoch)return;
   publish({busy:false});scheduleExpiry();
   // Any uncertain write/read requires an explicit GET, never an automatic PUT.
   if(!Object.keys(errors).length)timer=setTimeout(()=>void run(),10000);
  })();pending=operation;return operation;
 }
 return {subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>state,setBlocked(value:boolean){blocked=value;},setPending(value:SupplyPlatform[]){pendingPlatforms=value;},
  start(){if(active)return;active=true;generation++;},stop(){active=false;generation++;clearTimeout(timer);clearTimeout(expiry);publish({busy:false});},
  read:()=>run(),write:(platform:SupplyPlatform,paused:boolean)=>run([{platform,paused}]),writeAll:(paused:boolean)=>run(platforms.map(platform=>({platform,paused}))),canWrite};
}
export type SupplyModel=ReturnType<typeof createSupplyModel>;
export interface SharedSupply {model:SupplyModel;state:SupplyState;blocked:boolean}
export function useSupply(client:SupplyClient|undefined,enabled:boolean,blocked:boolean,pending:SupplyPlatform[]=[]):SharedSupply|undefined {
 const model=useMemo(()=>client?createSupplyModel(client):undefined,[client]);
 const empty=useMemo<SupplyState>(()=>({views:{},errors:{},busy:false,now:Date.now()}),[]);
 const state=useSyncExternalStore(model?.subscribe??(()=>()=>{}),model?.getSnapshot??(()=>empty));
 model?.setBlocked(blocked);model?.setPending(pending);
 useEffect(()=>{if(!model||!enabled)return;model.start();let active=true;queueMicrotask(()=>{if(active)void model.read();});return()=>{active=false;model.stop();};},[model,enabled]);
 return model?{model,state,blocked}:undefined;
}
