import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource,AccountActionRequest} from '../../system/accounts';
import type {AuthorizeClient} from '../../system/authorize';
import type {RuntimeSnapshot} from '../../system/runtime';
import {failure,platforms} from '../supply/useSupply';
export const accountPending=(s:AccountSnapshot|undefined)=>!!s?.operation&&['pending','running','reconciling'].includes(s.operation.state);
export function useAccounts(client:AccountClient|undefined,enabled:boolean,authorizer?:AuthorizeClient,runtime?:RuntimeSnapshot,autoRead=false){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState('');
 const [clock,setClock]=useState(0);
 useEffect(()=>{if(!enabled||!autoRead)return;const timer=setInterval(()=>setClock(v=>v+1),10000);return()=>clearInterval(timer);},[enabled,autoRead]);
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,string>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[uncertain,setUncertain]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const completedLogins=useRef(new Set<string>()),writing=useRef({openai:false,claude:false});
 const [writeBusy,setWriteBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 // An ignored old reply or unchanged error must still schedule the next poll.
 const [settled,setSettled]=useState({openai:0,claude:0});
 const [sourceReadFailed,setSourceReadFailed]=useState<Partial<Record<AccountPlatform,string>>>({});
 const autoReadPreviously=useRef(false);
 const detectedSources=useRef(new Map<string,string>()),officialReads=useRef(new Map<string,string>());
 const epochs=useRef({openai:0,claude:0}),active=useRef(true),running=useRef({openai:false,claude:false});
 const requests=useRef<Partial<Record<AccountPlatform,Promise<void>>>>({}),latest=useRef<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),verified=useRef({openai:false,claude:false});
 const revisions=useRef({openai:-1,claude:-1}),unconfirmedRevisions=useRef<Partial<Record<AccountPlatform,number>>>({});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const publish=useCallback((platform:AccountPlatform,view:AccountSnapshot,detected=false)=>{
  if(view.revision<revisions.current[platform])return false;
  revisions.current[platform]=view.revision;latest.current[platform]=view;setViews(v=>({...v,[platform]:view}));
  const login=view.operation?.kind==='authorize'&&view.operation.state==='succeeded'?view.operation.id:undefined;
  if(detected||login&&!completedLogins.current.has(login))setDirty(v=>({...v,[platform]:false}));
  if(login)completedLogins.current.add(login);
  return true;
 },[]);
 useEffect(()=>{
  if(!enabled||!runtime)return;
  for(const p of platforms){const next=runtime.platforms[p].account;if(!running.current[p]&&!dirty[p]&&next.revision>revisions.current[p])publish(p,next);}
  // Runtime observations keep revisions fresh but never resolve an uncertain write.
 },[enabled,runtime,busy,dirty,publish]);
 const run=useCallback((platform:AccountPlatform,operation:(current?:AccountSnapshot)=>Promise<AccountSnapshot>,detected=false,write=false,confirm=false,cancel=false):Promise<void>=>{
  if(writing.current[platform]||!write&&running.current[platform])return Promise.resolve();
  const execute=()=>{
   const writeRevision=revisions.current[platform];
   running.current[platform]=true;const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));
   const request=(async()=>{
    try{
     const view=await operation(latest.current[platform]);
     if(active.current&&epoch===epochs.current[platform]&&publish(platform,view,detected)){
      verified.current[platform]=true;setErrors(v=>({...v,[platform]:''}));
      if(confirm&&!accountPending(view)&&(unconfirmedRevisions.current[platform]===undefined||view.revision>unconfirmedRevisions.current[platform]!)){delete unconfirmedRevisions.current[platform];setUncertain(v=>({...v,[platform]:false}));}
     }
    }catch(cause){if(active.current&&epoch===epochs.current[platform]){verified.current[platform]=false;setErrors(v=>({...v,[platform]:failure(cause)}));if(write){unconfirmedRevisions.current[platform]=writeRevision;setUncertain(v=>({...v,[platform]:true}));}}}
    finally{if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSettled(v=>({...v,[platform]:v[platform]+1}));}}
   })().finally(()=>{if(requests.current[platform]===request)delete requests.current[platform];});
   requests.current[platform]=request;return request;
  };
  if(!write)return execute();
  const intent=latest.current[platform],epoch=epochs.current[platform],prior=requests.current[platform];
  const identity=(s:AccountSnapshot|undefined)=>JSON.stringify([s?.selection.state,s?.selection.fingerprint,s?.hive.fingerprint,s?.hive.generation,s?.candidate.reference,!!s?.candidate.expires_at&&Date.parse(s.candidate.expires_at)>Date.now()+30000,s?.features,s?.operation?.id,cancel&&s?.operation&&['pending','running'].includes(s.operation.state)?'cancellable':s?.operation?.state]);
  const expected=identity(intent);
  writing.current[platform]=true;setWriteBusy(v=>({...v,[platform]:true}));
  return (async()=>{
   await prior;
   if(!active.current||epoch!==epochs.current[platform]||!verified.current[platform]||expected!==identity(latest.current[platform]))return;
   await execute();
  })().finally(()=>{writing.current[platform]=false;if(active.current)setWriteBusy(v=>({...v,[platform]:false}));});
 },[publish]);
 const detectLocal=useCallback(async(platform:AccountPlatform,source:AccountSource)=>{
  const epoch=epochs.current[platform];
  try{
   const view=await client!.detect({platform,...source,mode:'local'});
   // Source access failures are valid snapshots with candidate.error, not IPC rejections.
   if(active.current&&epoch===epochs.current[platform])setSourceReadFailed(v=>({...v,[platform]:!view.candidate.source&&view.candidate.error?JSON.stringify(view.candidate.error):''}));
   return view;
  }
  catch(cause){if(active.current&&epoch===epochs.current[platform]){setSourceReadFailed(v=>({...v,[platform]:failure(cause)}));setDirty(v=>({...v,[platform]:true}));}throw cause;}
 },[client]);
 const read=useCallback(async(platform:AccountPlatform,refresh:boolean,operationId?:string)=>{
  if(!client)return;
  await run(platform,async()=>{if(operationId&&authorizer)await authorizer.status(operationId);return client.snapshot(platform,refresh);},false,false,true);
 },[client,run,authorizer]);
 useEffect(()=>{
  if(!enabled||!client)return;let current=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{void client.defaults().then(v=>{if(current){setDefaults(v);setDefaultsError('');}},e=>{if(current){setDefaultsError(failure(e));timer=setTimeout(load,10000);}});};
  load();
  for(const p of platforms)void read(p,true);
  return()=>{current=false;clearTimeout(timer);};
 },[enabled,client,read]);
 const poll=(p:AccountPlatform)=>{
  if(!enabled||busy[p]||(!errors[p]&&!uncertain[p]&&!accountPending(views[p])))return;
  // A stopped reconciliation worker resumes only on a refreshed snapshot; this never resubmits the account action.
  const recovering=!!errors[p]||!!uncertain[p]||views[p]?.operation?.state==='reconciling';
  const timer=setTimeout(()=>void read(p,recovering,views[p]?.operation?.kind==='authorize'?views[p]?.operation?.id:undefined),recovering?10000:400);
  return()=>clearTimeout(timer);
 };
 useEffect(()=>poll('openai'),[enabled,views.openai,busy.openai,errors.openai,uncertain.openai,settled.openai,read]);
 useEffect(()=>poll('claude'),[enabled,views.claude,busy.claude,errors.claude,uncertain.claude,settled.claude,read]);
 useEffect(()=>{
  if(autoRead&&!autoReadPreviously.current){for(const p of platforms)if(sourceReadFailed[p]){detectedSources.current.delete(p);setErrors(v=>({...v,[p]:''}));}}
  autoReadPreviously.current=autoRead;
 },[autoRead,sourceReadFailed]);
 useEffect(()=>{
  if(!enabled||!autoRead||!client||!defaults)return;
  for(const p of platforms){
   if(busy[p]||running.current[p]||errors[p]||uncertain[p]||accountPending(views[p]))continue;
   const source=sources[p]??{directory:null,store:defaults.platforms.find(d=>d.platform===p)?.default_store??'file'};
   const key=JSON.stringify(source);
   if(detectedSources.current.get(p)!==key){
    detectedSources.current.set(p,key);
    void run(p,()=>detectLocal(p,source),true);
    continue;
   }
   const view=views[p],fingerprint=view?.selection.fingerprint;
   if(dirty[p]||!view||view.selection.state!=='selected'||!fingerprint||view.candidate.fingerprint!==fingerprint)continue;
   const official=view.capabilities.find(c=>c.origin==='official'),now=Date.now();
   if(official?.retry_at&&Date.parse(official.retry_at)>now)continue;
   const isCurrent=(view:AccountSnapshot)=>{const c=view.capabilities.find(c=>c.origin==='official');return c?.status==='ready'&&!!c.observed_at&&!!c.valid_until&&Date.parse(c.valid_until)>Date.now()&&!c.windows.some(w=>w.reset_at&&Date.parse(w.reset_at)<=Date.now());};
   if(isCurrent(view))continue;
   if(view.candidate.expires_at&&Date.parse(view.candidate.expires_at)<=now)continue;
   const officialKey=p+key+fingerprint;
   const stamp=(view:AccountSnapshot)=>{const c=view.capabilities.find(c=>c.origin==='official');return JSON.stringify([c?.status,c?.observed_at,c?.valid_until,c?.retry_at,!!c?.retry_at&&Date.parse(c.retry_at)<=Date.now(),isCurrent(view)]);};
   if(officialReads.current.get(officialKey)===stamp(view))continue;
   officialReads.current.set(officialKey,stamp(view));
   void run(p,async()=>{const next=await client.detect({platform:p,...source,mode:'official'});officialReads.current.set(officialKey,stamp(next));return next;},true);
  }
 },[enabled,autoRead,client,defaults,sources,busy,errors,uncertain,views,dirty,clock,run,detectLocal]);
 const sourceFor=(p:AccountPlatform)=>sources[p]??{directory:null,store:defaults?.platforms.find(d=>d.platform===p)?.default_store??'file'};
 return {defaults,defaultsError,views,errors,busy,sources,dirty,uncertain,writeBusy,sourceReadFailed,
  edit(platform:AccountPlatform,source:AccountSource){
   if(accountPending(views[platform])||writing.current[platform]||uncertain[platform])return;
   if(JSON.stringify(sourceFor(platform))===JSON.stringify(source))return;
   setSourceReadFailed(v=>({...v,[platform]:''}));client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  },
  detect(platform:AccountPlatform,mode:'local'|'official'){if(client&&defaults)void run(platform,()=>client.detect({platform,...sourceFor(platform),mode}),true);},
  refresh(platform:AccountPlatform){void read(platform,true,views[platform]?.operation?.kind==='authorize'?views[platform]?.operation?.id:undefined);},
  action(platform:AccountPlatform,action:AccountActionRequest['action']){
   const view=views[platform];if(!client||!view||uncertain[platform])return;
   void run(platform,current=>client.action({platform,action,revision:current!.revision,candidate_ref:action==='clear_selection'?'':current!.candidate.reference??'',confirmed:true}),false,true);
  },
  authorize(platform:AccountPlatform){
   const view=views[platform];if(!client||!authorizer||!view||uncertain[platform])return;
   void run(platform,async current=>{await authorizer.start({platform,source:sourceFor(platform),expected_revision:current!.revision});return client.snapshot(platform,false);},false,true);
  },
  cancelAuthorize(platform:AccountPlatform){
   const id=views[platform]?.operation?.id;if(!client||!authorizer||!id)return;
   void run(platform,async current=>{if(current?.operation?.id!==id||!['pending','running'].includes(current.operation.state))return current!;await authorizer.cancel(id);return client.snapshot(platform,false);},false,true,false,true);
  }
 };
}
export type AccountsModel=ReturnType<typeof useAccounts>;
