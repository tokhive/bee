import type {RefreshStatus} from '../../system/desktopState';
import {requestNotSent,type UiFailure} from '../../system/failures';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource,AccountActionRequest,AccountOperation} from '../../system/accounts';
import type {AuthorizeClient} from '../../system/authorize';
import type {RuntimeSnapshot} from '../../system/runtime';
import {failure,platforms} from '../supply/useSupply';
export const accountPending=(s:AccountSnapshot|undefined)=>!!s?.operation&&['pending','running','reconciling'].includes(s.operation.state);
const noAccountErrors:Partial<Record<AccountPlatform,UiFailure>>={};
export interface CoordinatedAccounts {refreshStatus?:RefreshStatus;accountRefresh?:Partial<Record<AccountPlatform,RefreshStatus>>;sourceDirectories?:Partial<Record<AccountPlatform,string>>;setSourceDirectory?:(platform:AccountPlatform,value:string)=>void;defaults?:AccountDefaults;error:UiFailure|null;deviceError?:UiFailure|null;accountErrors?:Partial<Record<AccountPlatform,UiFailure>>;refresh:()=>Promise<void>;pause?:()=>void;generation?:()=>number;recordReceipt?:(platform:AccountPlatform,revision:number)=>void;snapshot?:()=>{runtime?:RuntimeSnapshot;error:UiFailure|null;deviceError?:UiFailure|null;accountErrors:Partial<Record<AccountPlatform,UiFailure>>;accountRefresh?:Partial<Record<AccountPlatform,RefreshStatus>>;busy:boolean}}
export function useAccounts(client:AccountClient|undefined,enabled:boolean,authorizer?:AuthorizeClient,runtime?:RuntimeSnapshot,autoRead=false,coordinated?:CoordinatedAccounts){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState<UiFailure|null>(null);
 const [clock,setClock]=useState(0);
 useEffect(()=>{if(!enabled||!autoRead)return;const timer=setInterval(()=>setClock(v=>v+1),10000);return()=>clearInterval(timer);},[enabled,autoRead]);
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,UiFailure>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[uncertain,setUncertain]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const completedLogins=useRef(new Set<string>()),writing=useRef({openai:false,claude:false});
 const [writeBusy,setWriteBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 // An ignored old reply or unchanged error must still schedule the next poll.
 const [settled,setSettled]=useState({openai:0,claude:0});
 const [sourceReadFailed,setSourceReadFailed]=useState<Partial<Record<AccountPlatform,UiFailure>>>({});
 const autoReadPreviously=useRef(false);
 const detectedSources=useRef(new Map<string,string>()),officialReads=useRef(new Map<string,string>());
 const epochs=useRef({openai:0,claude:0}),active=useRef(true),running=useRef({openai:false,claude:false});
 const requests=useRef<Partial<Record<AccountPlatform,Promise<void>>>>({}),latest=useRef<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),verified=useRef({openai:false,claude:false});
 const localUnconfirmed=useRef<Partial<Record<AccountPlatform,boolean>>>({});
 const revisions=useRef({openai:-1,claude:-1}),unconfirmedRevisions=useRef<Partial<Record<AccountPlatform,number>>>({});
 const external=!!coordinated,refreshCentral=coordinated?.refresh,pauseCentral=coordinated?.pause,centralError=coordinated?.error??null,accountErrors=coordinated?.accountErrors??noAccountErrors;
 const savedDefaults=external?coordinated?.defaults:defaults;
 const deviceError=coordinated?.deviceError;
 const currentRuntime=useRef(runtime);currentRuntime.current=runtime;
 const observedRuntime=useRef(runtime);
 const resolutions=useRef<Partial<Record<AccountPlatform,{previous:RuntimeSnapshot|undefined;detected:boolean;local:boolean}>>>({});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const publish=useCallback((platform:AccountPlatform,view:AccountSnapshot,detected=false)=>{
  if(view.revision<revisions.current[platform])return false;
  revisions.current[platform]=view.revision;latest.current[platform]=view;verified.current[platform]=true;setViews(v=>({...v,[platform]:view}));
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
   if(centralError||accountErrors[p]){verified.current[p]=false;continue;}
   const resolved=resolution&&runtime!==resolution.previous;
   if((!dirty[p]||resolved&&resolution.detected)&&(next.revision>revisions.current[p]||!verified.current[p]||resolved))publish(p,next,!!(resolved&&resolution.detected));
   const minimum=unconfirmedRevisions.current[p];
   if(external&&(!deviceError||resolution?.local||localUnconfirmed.current[p])&&!accountPending(next)&&(minimum===undefined?resolved:next.revision>minimum)){
    delete unconfirmedRevisions.current[p];delete localUnconfirmed.current[p];setUncertain(v=>({...v,[p]:false}));
   }
   if(external&&(observationChanged||resolved)&&next.revision>=revisions.current[p]&&!sourceReadFailed[p])setErrors(v=>v[p]&&v[p]?.code!=='ACCOUNT_CONTEXT_CHANGED'?{...v,[p]:undefined}:v);
   if(resolved&&(!deviceError||resolution.local))delete resolutions.current[p];
  }
  observedRuntime.current=runtime;
 },[enabled,runtime,busy,dirty,publish,centralError,deviceError,accountErrors,external,sourceReadFailed]);
 const central=useRef(coordinated);central.current=coordinated;
 const dirtySource=useRef(dirty);dirtySource.current=dirty;
 const run=useCallback((platform:AccountPlatform,operation:(current?:AccountSnapshot)=>Promise<AccountSnapshot|AccountOperation|void>,detected=false,write=false,confirm=false,cancel=false,local=false):Promise<void>=>{
  if(writing.current[platform]||!write&&running.current[platform])return Promise.resolve();
  const started=central.current?.generation?.();
  const execute=()=>{
   const writeRevision=revisions.current[platform];
   running.current[platform]=true;const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));
   const current=()=>active.current&&epoch===epochs.current[platform]&&central.current?.generation?.()===started;
   const request=(async()=>{
    try{
     const result=await operation(latest.current[platform]);
     if(!current())return;
     if(result)central.current?.recordReceipt?.(platform,result.revision);
     const view=result&&'selection'in result?result:undefined;
     if(view&&publish(platform,view,detected))setErrors(v=>({...v,[platform]:undefined}));
     if(refreshCentral){
      resolutions.current[platform]={previous:currentRuntime.current,detected,local:local||!write};
      if(write)setUncertain(v=>({...v,[platform]:true}));
      if(central.current?.snapshot?.().busy)await refreshCentral();
      if(!current())return;
      await refreshCentral();
     }else if(view&&confirm&&!accountPending(view)&&(unconfirmedRevisions.current[platform]===undefined||view.revision>unconfirmedRevisions.current[platform]!)){
      delete unconfirmedRevisions.current[platform];setUncertain(v=>({...v,[platform]:false}));
     }
    }catch(cause){if(current()){
     const problem=failure(cause,'account_operation');
     verified.current[platform]=false;setErrors(v=>({...v,[platform]:problem}));
     if(write&&!requestNotSent(problem)){localUnconfirmed.current[platform]=local;unconfirmedRevisions.current[platform]=writeRevision;setUncertain(v=>({...v,[platform]:true}));pauseCentral?.();}
    }}finally{if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSettled(v=>({...v,[platform]:v[platform]+1}));}}
   })().finally(()=>{if(requests.current[platform]===request)delete requests.current[platform];});
   requests.current[platform]=request;return request;
  };
  if(!write)return execute();
  const runtimeIntent=currentRuntime.current;
  const intent=latest.current[platform],epoch=epochs.current[platform],prior=requests.current[platform];
  const identity=(s:AccountSnapshot|undefined)=>JSON.stringify([s?.selection.state,s?.selection.fingerprint,s?.hive.fingerprint,s?.hive.generation,s?.candidate.reference,!!s?.candidate.expires_at&&Date.parse(s.candidate.expires_at)>Date.now()+30000,s?.features,s?.operation?.id,cancel&&s?.operation&&['pending','running'].includes(s.operation.state)?'cancellable':s?.operation?.state]);
  const expected=identity(intent);
  writing.current[platform]=true;setWriteBusy(v=>({...v,[platform]:true}));
  const rejectSubmission=(check:string,actual:string,required:string)=>{
   if(!active.current||central.current?.generation?.()!==started)return;
   setErrors(v=>({...v,[platform]:failure({code:'ACCOUNT_CONTEXT_CHANGED',message:check+': actual='+actual+'; required='+required,details:{check,observed_at:new Date().toISOString(),evidence:{actual,required}}},check)}));
  };
  return (async()=>{
   if(prior)await prior;
   if(!active.current||central.current?.generation?.()!==started)return;
   if(epoch!==epochs.current[platform]){rejectSubmission('account_source_epoch','source epoch='+epochs.current[platform],'source epoch='+epoch);return;}
   if(central.current?.snapshot?.().busy&&refreshCentral)await refreshCentral();
   if(!active.current||central.current?.generation?.()!==started)return;
   if(epoch!==epochs.current[platform]){rejectSubmission('account_source_epoch','source epoch='+epochs.current[platform],'source epoch='+epoch);return;}
   const observation=central.current?.snapshot?.();
   if(observation){
    if(observation.error||!local&&observation.deviceError||observation.accountErrors[platform]){setErrors(v=>({...v,[platform]:observation.error??(!local?observation.deviceError:undefined)??observation.accountErrors[platform]}));return;}
    const next=observation.runtime?.platforms[platform].account;
    if(next&&!dirtySource.current[platform]&&next.revision>=revisions.current[platform])publish(platform,next);
   }
   if(local&&!cancel){
    const next=observation?.runtime??currentRuntime.current;
    if(!next||!['stopped','failed'].includes(next.local)||next.local!==runtimeIntent?.local||next.run_id!==runtimeIntent?.run_id){rejectSubmission('authorize_runtime',JSON.stringify({local:next?.local??'missing',run_id:next?.run_id??null}),'same stopped local runtime; local='+runtimeIntent?.local+'; run_id='+(runtimeIntent?.run_id??'null'));return;}
   }
   if(!verified.current[platform]){rejectSubmission('account_verification','verified=false','current verified account observation');return;}
   if(expected!==identity(latest.current[platform])){rejectSubmission('account_submission_identity','account identity or candidate changed; revision='+revisions.current[platform],'same account identity and candidate as confirmed');return;}
   await execute();
  })().catch(cause=>{if(active.current&&epoch===epochs.current[platform]&&central.current?.generation?.()===started){verified.current[platform]=false;setErrors(v=>({...v,[platform]:failure(cause,'account_operation')}));}}).finally(()=>{writing.current[platform]=false;if(active.current)setWriteBusy(v=>({...v,[platform]:false}));});
 },[publish,refreshCentral,pauseCentral]);
 const detectLocal=useCallback(async(platform:AccountPlatform,source:AccountSource)=>{
  const epoch=epochs.current[platform];
  try{
   const view=await client!.detect({platform,...source,mode:'local'});
   // Source access failures are valid snapshots with candidate.error, not IPC rejections.
   if(active.current&&epoch===epochs.current[platform])setSourceReadFailed(v=>({...v,[platform]:!view.candidate.source&&view.candidate.error?failure(view.candidate.error,'source_read'):undefined}));
   return view;
  }
  catch(cause){if(active.current&&epoch===epochs.current[platform]){setSourceReadFailed(v=>({...v,[platform]:failure(cause,'account_operation')}));setDirty(v=>({...v,[platform]:true}));}throw cause;}
 },[client]);
 const read=useCallback(async(platform:AccountPlatform,refresh:boolean,operationId?:string)=>{
  if(!client)return;
  await run(platform,async()=>{if(refreshCentral)return;if(operationId&&authorizer)await authorizer.status(operationId);return client.snapshot(platform,refresh);},false,false,true);
 },[client,run,authorizer,refreshCentral]);
 useEffect(()=>{
  if(!enabled||!client||external)return;let current=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{void client.defaults().then(v=>{if(current){setDefaults(v);setDefaultsError(null);}},e=>{if(current){setDefaultsError(failure(e,'account_defaults'));timer=setTimeout(load,10000);}});};
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
 useEffect(()=>poll('openai'),[enabled,views.openai,busy.openai,errors.openai,uncertain.openai,settled.openai,read,external]);
 useEffect(()=>poll('claude'),[enabled,views.claude,busy.claude,errors.claude,uncertain.claude,settled.claude,read,external]);
 useEffect(()=>{
  if(autoRead&&!autoReadPreviously.current){for(const p of platforms)if(sourceReadFailed[p]){detectedSources.current.delete(p);setErrors(v=>({...v,[p]:undefined}));}}
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
 return {submissionBlocked:!!centralError||!!deviceError,sharedFailure:centralError??deviceError??null,refreshStatus:coordinated?.refreshStatus,accountRefresh:coordinated?.accountRefresh,sourceDirectories:coordinated?.sourceDirectories??{},setSourceDirectory:coordinated?.setSourceDirectory,defaults:savedDefaults,defaultsError:centralError||defaultsError,views,errors:{...errors,...accountErrors,...(centralError?{openai:centralError,claude:centralError}:{})},busy,sources,dirty,uncertain,writeBusy,sourceReadFailed,
  edit(platform:AccountPlatform,source:AccountSource){
   if(accountPending(views[platform])||writing.current[platform]||uncertain[platform])return;
   if(JSON.stringify(sourceFor(platform))===JSON.stringify(source))return;
   delete resolutions.current[platform];verified.current[platform]=false;
   setSourceReadFailed(v=>({...v,[platform]:undefined}));client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:undefined}));
  },
  detect(platform:AccountPlatform,mode:'local'|'official'){if(client&&savedDefaults&&!centralError)void run(platform,()=>client.detect({platform,...sourceFor(platform),mode}),true);},
  refresh(platform:AccountPlatform){void read(platform,true,views[platform]?.operation?.kind==='authorize'?views[platform]?.operation?.id:undefined);},
  action(platform:AccountPlatform,action:AccountActionRequest['action']){
   const view=views[platform];if(!client||!view||uncertain[platform]||centralError)return;
   void run(platform,current=>client.action({platform,action,revision:current!.revision,candidate_ref:action==='clear_selection'?'':current!.candidate.reference??'',confirmed:true}),false,true);
  },
  authorize(platform:AccountPlatform){
   const view=views[platform];if(!client||!authorizer||!view||uncertain[platform]||centralError)return;
   void run(platform,async current=>{const receipt=await authorizer.start({platform,source:sourceFor(platform),expected_revision:current!.revision});return refreshCentral?receipt:client.snapshot(platform,false);},false,true,false,false,true);
  },
  cancelAuthorize(platform:AccountPlatform){
   const id=views[platform]?.operation?.id;if(!client||!authorizer||!id)return;
   void run(platform,async current=>{if(current?.operation?.id!==id||!['pending','running'].includes(current.operation.state))return current;const receipt=await authorizer.cancel(id);return refreshCentral?receipt:client.snapshot(platform,false);},false,true,false,true,true);
  }
 };
}
export type AccountsModel=ReturnType<typeof useAccounts>;
