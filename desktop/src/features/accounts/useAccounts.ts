import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource,AccountActionRequest} from '../../system/accounts';
import type {AuthorizeClient} from '../../system/authorize';
import {failure,platforms} from '../supply/useSupply';
export const accountPending=(s:AccountSnapshot|undefined)=>!!s?.operation&&['pending','running','reconciling'].includes(s.operation.state);
export function useAccounts(client:AccountClient|undefined,enabled:boolean,authorizer?:AuthorizeClient){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState('');
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,string>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[uncertain,setUncertain]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const completedLogins=useRef(new Set<string>()),writing=useRef({openai:false,claude:false});
 const [writeBusy,setWriteBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const epochs=useRef({openai:0,claude:0}),active=useRef(true),running=useRef({openai:false,claude:false});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const run=useCallback(async(platform:AccountPlatform,operation:()=>Promise<AccountSnapshot>,detected=false,write=false)=>{
  if(running.current[platform])return;
  running.current[platform]=true;if(write){writing.current[platform]=true;setWriteBusy(v=>({...v,[platform]:true}));}const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  try{
   const view=await operation();
   if(active.current&&epoch===epochs.current[platform]){
    setViews(v=>({...v,[platform]:view}));setUncertain(v=>({...v,[platform]:false}));
    const login=view.operation?.kind==='authorize'&&view.operation.state==='succeeded'?view.operation.id:undefined;
    if(detected||login&&!completedLogins.current.has(login))setDirty(v=>({...v,[platform]:false}));
    if(login)completedLogins.current.add(login);
   }
  }catch(cause){if(active.current&&epoch===epochs.current[platform]){setErrors(v=>({...v,[platform]:failure(cause)}));if(write)setUncertain(v=>({...v,[platform]:true}));}}
  finally{if(write){writing.current[platform]=false;if(active.current)setWriteBusy(v=>({...v,[platform]:false}));}if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));}}
 },[]);
 const read=useCallback(async(platform:AccountPlatform,refresh:boolean,operationId?:string)=>{
  if(!client)return;
  await run(platform,async()=>{if(operationId&&authorizer)await authorizer.status(operationId);return client.snapshot(platform,refresh);});
 },[client,run,authorizer]);
 useEffect(()=>{
  if(!enabled||!client)return;let current=true;
  void client.defaults().then(v=>{if(current){setDefaults(v);setDefaultsError('');}},e=>{if(current)setDefaultsError(failure(e));});
  for(const p of platforms)void read(p,true);
  return()=>{current=false;};
 },[enabled,client,read]);
 useEffect(()=>{
  if(!enabled)return;
  const pending=platforms.filter(p=>accountPending(views[p])&&!busy[p]&&!errors[p]&&!uncertain[p]&&views[p]?.operation?.state!=='reconciling');
  if(!pending.length)return;
  const timer=setTimeout(()=>{for(const p of pending)void read(p,false,views[p]?.operation?.kind==='authorize'?views[p]?.operation?.id:undefined);},400);
  return()=>clearTimeout(timer);
 },[enabled,views,busy,errors,uncertain,read]);
 const sourceFor=(p:AccountPlatform)=>sources[p]??{directory:null,store:defaults?.platforms.find(d=>d.platform===p)?.default_store??'file'};
 return {defaults,defaultsError,views,errors,busy,sources,dirty,uncertain,writeBusy,
  edit(platform:AccountPlatform,source:AccountSource){
   if(accountPending(views[platform])||writing.current[platform]||uncertain[platform])return;
   client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  },
  detect(platform:AccountPlatform,mode:'local'|'official'){if(client&&defaults)void run(platform,()=>client.detect({platform,...sourceFor(platform),mode}),true);},
  refresh(platform:AccountPlatform){void read(platform,true,views[platform]?.operation?.kind==='authorize'?views[platform]?.operation?.id:undefined);},
  action(platform:AccountPlatform,action:AccountActionRequest['action']){
   const view=views[platform];if(!client||!view||uncertain[platform])return;
   void run(platform,()=>client.action({platform,action,revision:view.revision,candidate_ref:action==='clear_selection'?'':view.candidate.reference??'',confirmed:true}),false,true);
  },
  authorize(platform:AccountPlatform){
   const view=views[platform];if(!client||!authorizer||!view||uncertain[platform])return;
   void run(platform,async()=>{await authorizer.start({platform,source:sourceFor(platform),expected_revision:view.revision});return client.snapshot(platform,false);},false,true);
  },
  cancelAuthorize(platform:AccountPlatform){
   const id=views[platform]?.operation?.id;if(!client||!authorizer||!id)return;
   void run(platform,async()=>{await authorizer.cancel(id);return client.snapshot(platform,false);},false,true);
  }
 };
}
export type AccountsModel=ReturnType<typeof useAccounts>;
