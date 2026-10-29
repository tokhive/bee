import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource,AccountActionRequest} from '../../system/accounts';
import type {AuthorizeClient} from '../../system/authorize';
import type {RuntimeSnapshot} from '../../system/runtime';
import {failure,platforms} from '../supply/useSupply';
export const accountPending=(s:AccountSnapshot|undefined)=>!!s?.operation&&['pending','running','reconciling'].includes(s.operation.state);
const noAccountErrors:Partial<Record<AccountPlatform,string>>={};
export interface CoordinatedAccounts {defaults?:AccountDefaults;error:string;accountErrors?:Partial<Record<AccountPlatform,string>>;refresh:()=>Promise<void>;pause?:()=>void;generation?:()=>number}
export function useAccounts(client:AccountClient|undefined,enabled:boolean,authorizer?:AuthorizeClient,runtime?:RuntimeSnapshot,autoRead=false,coordinated?:CoordinatedAccounts){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState('');
 const [clock,setClock]=useState(0);
 useEffect(()=>{if(!enabled||!autoRead)return;const timer=setInterval(()=>setClock(v=>v+1),10000);return()=>clearInterval(timer);},[enabled,autoRead]);
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,string>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[uncertain,setUncertain]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const completedLogins=useRef(new Set<string>()),writing=useRef({openai:false,claude:false});
 const [writeBusy,setWriteBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const [sourceReadFailed,setSourceReadFailed]=useState<Partial<Record<AccountPlatform,string>>>({});
 const autoReadPreviously=useRef(false);
 const detectedSources=useRef(new Map<string,string>()),officialReads=useRef(new Map<string,string>());
 const epochs=useRef({openai:0,claude:0}),active=useRef(true),running=useRef({openai:false,claude:false});
 const revisions=useRef({openai:-1,claude:-1}),unconfirmedRevisions=useRef<Partial<Record<AccountPlatform,number>>>({});
 const external=!!coordinated,refreshCentral=coordinated?.refresh,pauseCentral=coordinated?.pause,centralError=coordinated?.error??'',accountErrors=coordinated?.accountErrors??noAccountErrors;
 const savedDefaults=external?coordinated?.defaults:defaults;
 const currentRuntime=useRef(runtime);currentRuntime.current=runtime;
 const observedRuntime=useRef(runtime);
 const resolutions=useRef<Partial<Record<AccountPlatform,{previous:RuntimeSnapshot|undefined;detected:boolean}>>>({});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const publish=useCallback((platform:AccountPlatform,view:AccountSnapshot,detected=false)=>{
  if(view.revision<revisions.current[platform])return false;
  revisions.current[platform]=view.revision;setViews(v=>({...v,[platform]:view}));
  const login=view.operation?.kind==='authorize'&&view.operation.state==='succeeded'?view.operation.id:undefined;
  if(detected||login&&!completedLogins.current.has(login))setDirty(v=>({...v,[platform]:false}));
  if(login)completedLogins.current.add(login);
  return true;
 },[]);
 useEffect(()=>{
  if(!enabled||!runtime)return;
  const observationChanged=runtime!==observedRuntime.current;
  for(const p of platforms){
   if(running.current[p])continue;
   const next=runtime.platforms[p].account,resolution=resolutions.current[p];
   if(centralError||accountErrors[p])continue;
   const resolved=resolution&&runtime!==resolution.previous;
   if((!dirty[p]||resolved&&resolution.detected)&&(next.revision>revisions.current[p]||resolved))publish(p,next,!!(resolved&&resolution.detected));
   const minimum=unconfirmedRevisions.current[p];
   if(external&&!accountPending(next)&&(minimum===undefined?resolved:next.revision>minimum)){
    delete unconfirmedRevisions.current[p];setUncertain(v=>({...v,[p]:false}));
   }
   if(external&&(observationChanged||resolved)&&!sourceReadFailed[p])setErrors(v=>v[p]?{...v,[p]:''}:v);
   if(resolved)delete resolutions.current[p];
  }
  observedRuntime.current=runtime;
 },[enabled,runtime,busy,dirty,publish,centralError,accountErrors,external,sourceReadFailed]);
 const run=useCallback(async(platform:AccountPlatform,operation:()=>Promise<AccountSnapshot|void>,detected=false,write=false,confirm=false)=>{
  if(running.current[platform])return;
  const writeRevision=revisions.current[platform],started=coordinated?.generation?.();
  running.current[platform]=true;if(write){writing.current[platform]=true;setWriteBusy(v=>({...v,[platform]:true}));}const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  const current=()=>active.current&&epoch===epochs.current[platform]&&coordinated?.generation?.()===started;
  try{
   const view=await operation();
   if(!current())return;
   if(view)publish(platform,view,detected);
   if(refreshCentral){
    resolutions.current[platform]={previous:currentRuntime.current,detected};
    if(write)setUncertain(v=>({...v,[platform]:true}));
    await refreshCentral();
   }else if(view&&confirm&&!accountPending(view)&&(unconfirmedRevisions.current[platform]===undefined||view.revision>unconfirmedRevisions.current[platform]!)){
    delete unconfirmedRevisions.current[platform];setUncertain(v=>({...v,[platform]:false}));
   }
  }catch(cause){if(current()){
   setErrors(v=>({...v,[platform]:failure(cause)}));
   if(write){unconfirmedRevisions.current[platform]=writeRevision;setUncertain(v=>({...v,[platform]:true}));pauseCentral?.();}
  }}
  finally{if(write){writing.current[platform]=false;if(active.current)setWriteBusy(v=>({...v,[platform]:false}));}if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));}}
 },[publish,refreshCentral,pauseCentral,coordinated?.generation]);
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
  await run(platform,async()=>{if(refreshCentral)return;if(operationId&&authorizer)await authorizer.status(operationId);return client.snapshot(platform,refresh);},false,false,true);
 },[client,run,authorizer,refreshCentral]);
 useEffect(()=>{
  if(!enabled||!client||external)return;let current=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{void client.defaults().then(v=>{if(current){setDefaults(v);setDefaultsError('');}},e=>{if(current){setDefaultsError(failure(e));timer=setTimeout(load,10000);}});};
  load();
  for(const p of platforms)void read(p,true);
  return()=>{current=false;clearTimeout(timer);};
 },[enabled,client,read,external]);
 const poll=(p:AccountPlatform)=>{
  if(!enabled||external||busy[p]||(!errors[p]&&!uncertain[p]&&!accountPending(views[p])))return;
  // A stopped reconciliation worker resumes only on a refreshed snapshot; this never resubmits the account action.
  const recovering=!!errors[p]||!!uncertain[p]||views[p]?.operation?.state==='reconciling';
  const timer=setTimeout(()=>void read(p,recovering,views[p]?.operation?.kind==='authorize'?views[p]?.operation?.id:undefined),recovering?10000:400);
  return()=>clearTimeout(timer);
 };
 useEffect(()=>poll('openai'),[enabled,views.openai,busy.openai,errors.openai,uncertain.openai,read,external]);
 useEffect(()=>poll('claude'),[enabled,views.claude,busy.claude,errors.claude,uncertain.claude,read,external]);
 useEffect(()=>{
  if(autoRead&&!autoReadPreviously.current){for(const p of platforms)if(sourceReadFailed[p]){detectedSources.current.delete(p);setErrors(v=>({...v,[p]:''}));}}
  autoReadPreviously.current=autoRead;
 },[autoRead,sourceReadFailed]);
 useEffect(()=>{
  if(!enabled||!autoRead||!client||!savedDefaults||centralError)return;
  for(const p of platforms){
   if(busy[p]||running.current[p]||accountErrors[p]||errors[p]||uncertain[p]||accountPending(views[p]))continue;
   const source=sources[p]??{directory:null,store:savedDefaults.platforms.find(d=>d.platform===p)?.default_store??'file'};
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
 },[enabled,autoRead,client,savedDefaults,centralError,accountErrors,sources,busy,errors,uncertain,views,dirty,clock,run,detectLocal]);
 const sourceFor=(p:AccountPlatform)=>sources[p]??{directory:null,store:savedDefaults?.platforms.find(d=>d.platform===p)?.default_store??'file'};
 return {defaults:savedDefaults,defaultsError:centralError||defaultsError,views,errors:{...errors,...accountErrors,...(centralError?{openai:centralError,claude:centralError}:{})},busy,sources,dirty,uncertain,writeBusy,sourceReadFailed,
  edit(platform:AccountPlatform,source:AccountSource){
   if(accountPending(views[platform])||writing.current[platform]||uncertain[platform])return;
   if(JSON.stringify(sourceFor(platform))===JSON.stringify(source))return;
   delete resolutions.current[platform];
   setSourceReadFailed(v=>({...v,[platform]:''}));client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  },
  detect(platform:AccountPlatform,mode:'local'|'official'){if(client&&savedDefaults&&!centralError)void run(platform,()=>client.detect({platform,...sourceFor(platform),mode}),true);},
  refresh(platform:AccountPlatform){void read(platform,true,views[platform]?.operation?.kind==='authorize'?views[platform]?.operation?.id:undefined);},
  action(platform:AccountPlatform,action:AccountActionRequest['action']){
   const view=views[platform];if(!client||!view||uncertain[platform]||centralError)return;
   void run(platform,()=>client.action({platform,action,revision:view.revision,candidate_ref:action==='clear_selection'?'':view.candidate.reference??'',confirmed:true}),false,true);
  },
  authorize(platform:AccountPlatform){
   const view=views[platform];if(!client||!authorizer||!view||uncertain[platform]||centralError)return;
   void run(platform,async()=>{await authorizer.start({platform,source:sourceFor(platform),expected_revision:view.revision});if(!refreshCentral)return client.snapshot(platform,false);},false,true);
  },
  cancelAuthorize(platform:AccountPlatform){
   const id=views[platform]?.operation?.id;if(!client||!authorizer||!id)return;
   void run(platform,async()=>{await authorizer.cancel(id);if(!refreshCentral)return client.snapshot(platform,false);},false,true);
  }
 };
}
export type AccountsModel=ReturnType<typeof useAccounts>;
