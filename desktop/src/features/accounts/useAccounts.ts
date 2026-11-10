import type {RefreshStatus} from '../../system/desktopState';
import {requestNotSent,type UiFailure} from '../../system/failures';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource,AccountActionRequest,AccountOperation} from '../../system/accounts';
import {accountConfirmationKey} from '../../system/accounts';
import type {CodexLoginProgress} from '../../system/codexLogin.contract';
import {createOperationQuery,type QueryState} from '../../system/operationQuery';
import type {AuthorizeClient} from '../../system/authorize';
import type {RuntimeSnapshot} from '../../system/runtime';
import {failure,platforms} from '../supply/useSupply';
export const accountPending=(s:AccountSnapshot|undefined)=>!!s?.operation&&['pending','running','reconciling'].includes(s.operation.state)||!!s?.login_maintenance&&s.login_maintenance.phase!=='restored';
const noAccountErrors:Partial<Record<AccountPlatform,UiFailure>>={};
export interface CoordinatedAccounts {autoService?:boolean;openaiSource?:AccountSource;sourceReady?:boolean;saveOpenaiSource?:(source:AccountSource)=>Promise<AccountSource>;recheckOpenaiReads?:()=>Promise<void>;refreshStatus?:RefreshStatus;accountRefresh?:Partial<Record<AccountPlatform,RefreshStatus>>;sourceDirectories?:Partial<Record<AccountPlatform,string>>;setSourceDirectory?:(platform:AccountPlatform,value:string)=>void;defaults?:AccountDefaults;error:UiFailure|null;deviceError?:UiFailure|null;accountErrors?:Partial<Record<AccountPlatform,UiFailure>>;refresh:()=>Promise<void>;pause?:()=>void;generation?:()=>number;recordReceipt?:(platform:AccountPlatform,revision:number,confirmedOperation?:boolean)=>void;snapshot?:()=>{runtime?:RuntimeSnapshot;error:UiFailure|null;deviceError?:UiFailure|null;accountErrors:Partial<Record<AccountPlatform,UiFailure>>;accountRefresh?:Partial<Record<AccountPlatform,RefreshStatus>>;busy:boolean}}
export function useAccounts(client:AccountClient|undefined,enabled:boolean,authorizer?:AuthorizeClient,runtime?:RuntimeSnapshot,autoRead=false,coordinated?:CoordinatedAccounts){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState<UiFailure|null>(null);
 const [clock,setClock]=useState(0);
 useEffect(()=>{if(!enabled||!autoRead)return;const timer=setInterval(()=>setClock(v=>v+1),10000);return()=>clearInterval(timer);},[enabled,autoRead]);
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,UiFailure>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[uncertain,setUncertain]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const [openaiJourney,setOpenaiJourney]=useState<{kind:'first'|'intake'|'change'|'relogin'|'repair';revision:number;operationId?:string;completed?:string}>();
 const [openaiDraft,setOpenaiDraft]=useState<AccountSource>(),[sourceSaving,setSourceSaving]=useState(false),[sourceSaveError,setSourceSaveError]=useState<UiFailure>();
 const sourceSavingRef=useRef(false);
 const [originalAccountQuery,setOriginalAccountQuery]=useState<QueryState<AccountSnapshot>>();
 const originalAccountReader=useRef<ReturnType<typeof createOperationQuery<AccountSnapshot>>|undefined>(undefined);
 const [loginProgress,setLoginProgress]=useState<QueryState<CodexLoginProgress>>(),[loginOpenError,setLoginOpenError]=useState<UiFailure>();
 const loginQuery=useRef<ReturnType<typeof createOperationQuery<CodexLoginProgress>>|undefined>(undefined);
 const [openingLogin,setOpeningLogin]=useState(false);const openingLoginRef=useRef(false);
 const completedLogins=useRef(new Set<string>()),writing=useRef({openai:false,claude:false});
 const [loginFlows,setLoginFlows]=useState<Partial<Record<AccountPlatform,{confirmation:string|null;rechecked:boolean;checking:boolean}>>>({});
 const [writeBusy,setWriteBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const [cancelUnconfirmed,setCancelUnconfirmed]=useState<Partial<Record<AccountPlatform,{operationId:string;failure:UiFailure}>>>({});
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
 const resolutions=useRef<Partial<Record<AccountPlatform,{previous:RuntimeSnapshot|undefined;detected:boolean;local:boolean;generation:number|undefined;operation?:AccountOperation}>>>({});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const publish=useCallback((platform:AccountPlatform,view:AccountSnapshot,detected=false)=>{
  if(view.revision<revisions.current[platform])return false;
  revisions.current[platform]=view.revision;latest.current[platform]=view;verified.current[platform]=true;setViews(v=>({...v,[platform]:view}));
  const login=view.operation?.kind==='authorize'&&view.operation.state==='succeeded'?view.operation.id:undefined;
  if(detected||login&&!completedLogins.current.has(login))setDirty(v=>({...v,[platform]:false}));
  if(login&&!completedLogins.current.has(login)){
   completedLogins.current.add(login);
   setSourceReadFailed(v=>({...v,[platform]:undefined}));
  }
  return true;
 },[]);
 useEffect(()=>{
  if(!enabled||!runtime)return;
  const observationChanged=runtime!==observedRuntime.current;
  for(const p of platforms){
   if(running.current[p])continue;
   const next=runtime.platforms[p].account,resolution=resolutions.current[p];
   if(centralError||accountErrors[p]){verified.current[p]=false;continue;}
   const resolved=resolution&&runtime!==resolution.previous&&resolution.generation===coordinated?.generation?.();
   if((!dirty[p]||resolved&&resolution.detected)&&(next.revision>revisions.current[p]||!verified.current[p]||resolved))publish(p,next,!!(resolved&&resolution.detected));
   const minimum=unconfirmedRevisions.current[p];
   const receipt=resolution?.operation,observed=next.operation;
   const ownedTerminal=!!resolved&&!!receipt&&observed?.id===receipt.id&&observed.kind===receipt.kind&&observed.platform===p&&['succeeded','failed','cancelled'].includes(observed.state)&&next.revision>=Math.max(receipt.revision,revisions.current[p])&&observed.revision>=receipt.revision;
   const confirmed=receipt?ownedTerminal:!accountPending(next)&&(minimum===undefined?resolved:next.revision>minimum);
   if(external&&(!deviceError||resolution?.local||localUnconfirmed.current[p])&&confirmed){
    delete unconfirmedRevisions.current[p];delete localUnconfirmed.current[p];setUncertain(v=>({...v,[p]:false}));
   }
   if(external&&(observationChanged||resolved)&&next.revision>=revisions.current[p]&&!sourceReadFailed[p])setErrors(v=>v[p]&&v[p]?.code!=='ACCOUNT_CONTEXT_CHANGED'?{...v,[p]:undefined}:v);
   if(resolved&&(!receipt||ownedTerminal)&&(!deviceError||resolution.local))delete resolutions.current[p];
  }
  observedRuntime.current=runtime;
 },[enabled,runtime,busy,dirty,publish,centralError,deviceError,accountErrors,external,sourceReadFailed]);
 const central=useRef(coordinated);central.current=coordinated;
 const dirtySource=useRef(dirty);dirtySource.current=dirty;
 const run=useCallback((platform:AccountPlatform,operation:(current?:AccountSnapshot)=>Promise<AccountSnapshot|AccountOperation|void>,detected=false,write=false,confirm=false,cancel=false,local=false):Promise<void>=>{
  if(platform==='openai'&&sourceSavingRef.current||writing.current[platform]||!write&&running.current[platform])return Promise.resolve();
  const started=central.current?.generation?.();
  const execute=()=>{
   const writeRevision=revisions.current[platform];
   running.current[platform]=true;const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));
   const current=()=>active.current&&epoch===epochs.current[platform]&&central.current?.generation?.()===started;
   const request=(async()=>{
    let receiptOperation:AccountOperation|undefined;
    try{
     const result=await operation(latest.current[platform]);
     if(!current())return;
     if(result)central.current?.recordReceipt?.(platform,result.revision,write);
     const view=result&&'selection'in result?result:undefined;
     if(write&&result)receiptOperation='selection'in result?result.operation??undefined:result;
     if(view&&publish(platform,view,detected))setErrors(v=>({...v,[platform]:undefined}));
     if(refreshCentral){
      const previous=resolutions.current[platform];
      resolutions.current[platform]={previous:currentRuntime.current,detected,local:write?local:previous?.operation?previous.local:true,generation:receiptOperation?started:previous?.operation?previous.generation:started,operation:receiptOperation??previous?.operation};
      if(write)setUncertain(v=>({...v,[platform]:true}));
      if(central.current?.snapshot?.().busy)await refreshCentral();
      if(!current())return;
      await refreshCentral();
     }else if(view&&confirm&&!accountPending(view)&&(unconfirmedRevisions.current[platform]===undefined||view.revision>unconfirmedRevisions.current[platform]!)){
      delete unconfirmedRevisions.current[platform];setUncertain(v=>({...v,[platform]:false}));
     }
    }catch(cause){if(current()){
     const problem=failure(cause,cancel?'authorize_cancel':'account_operation');
     verified.current[platform]=false;setErrors(v=>({...v,[platform]:problem}));
     if(write&&!requestNotSent(problem)){
      localUnconfirmed.current[platform]=local;unconfirmedRevisions.current[platform]=writeRevision;setUncertain(v=>({...v,[platform]:true}));
      const owned=receiptOperation??(cancel?latest.current[platform]?.operation:undefined);
      pauseCentral?.();
      if(owned)resolutions.current[platform]={previous:currentRuntime.current,detected,local,generation:central.current?.generation?.(),operation:owned};
     }
    }}finally{if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSettled(v=>({...v,[platform]:v[platform]+1}));}}
   })().finally(()=>{if(requests.current[platform]===request)delete requests.current[platform];});
   requests.current[platform]=request;return request;
  };
  if(!write)return execute();
  const runtimeIntent=currentRuntime.current;
  const intent=latest.current[platform],epoch=epochs.current[platform],prior=requests.current[platform];
  const identity=(s:AccountSnapshot|undefined)=>accountConfirmationKey(s,Date.now(),cancel);
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
    if(!next||!(central.current?.autoService?['stopped','waiting','failed','running']:['stopped','waiting','failed']).includes(next.local)||next.local!==runtimeIntent?.local||next.run_id!==runtimeIntent?.run_id){rejectSubmission('authorize_runtime',JSON.stringify({local:next?.local??'missing',run_id:next?.run_id??null}),'same admitted local runtime; local='+runtimeIntent?.local+'; run_id='+(runtimeIntent?.run_id??'null'));return;}
   }
   if(!verified.current[platform]){rejectSubmission('account_verification','verified=false','current verified account observation');return;}
   if(expected!==identity(latest.current[platform])){rejectSubmission('account_submission_identity','account identity or candidate changed; revision='+revisions.current[platform],'same account identity and candidate as confirmed');return;}
   await execute();
  })().catch(cause=>{if(active.current&&epoch===epochs.current[platform]&&central.current?.generation?.()===started){verified.current[platform]=false;setErrors(v=>({...v,[platform]:failure(cause,'account_operation')}));}}).finally(()=>{writing.current[platform]=false;if(active.current)setWriteBusy(v=>({...v,[platform]:false}));});
 },[publish,refreshCentral,pauseCentral]);
 const detectLocal=useCallback(async(platform:AccountPlatform,source:AccountSource,mode:'local'|'official'='local')=>{
  const epoch=epochs.current[platform];
  try{
   const view=await client!.detect({platform,...source,mode});
   // Source access failures are valid snapshots with candidate.error, not IPC rejections.
   if(active.current&&epoch===epochs.current[platform])setSourceReadFailed(v=>({...v,[platform]:!view.candidate.source&&view.candidate.error?failure(view.candidate.error,'source_read'):undefined}));
   return view;
  }
  catch(cause){if(active.current&&epoch===epochs.current[platform]){setSourceReadFailed(v=>({...v,[platform]:failure(cause,'account_operation')}));setDirty(v=>({...v,[platform]:true}));}throw cause;}
 },[client]);
 const read=useCallback(async(platform:AccountPlatform,refresh:boolean,operationId?:string)=>{
  if(!client)return;
  await run(platform,async()=>{if(refreshCentral&&!(refresh&&latest.current[platform]?.login_maintenance?.can_recheck))return;if(operationId&&authorizer&&!latest.current[platform]?.login_maintenance)await authorizer.status(operationId);return client.snapshot(platform,refresh);},false,false,true);
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
   if(p==='openai'&&coordinated?.sourceReady===false)continue;
   if(coordinated?.accountRefresh?.[p]?.state==='waiting'||busy[p]||running.current[p]||accountErrors[p]||errors[p]||uncertain[p]||accountPending(views[p]))continue;
   const source=sources[p]??(p==='openai'?coordinated?.openaiSource:undefined)??{directory:null,store:savedDefaults.platforms.find(d=>d.platform===p)?.default_store??'file'};
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
 },[enabled,autoRead,client,savedDefaults,centralError,accountErrors,coordinated?.accountRefresh,coordinated?.openaiSource,coordinated?.sourceReady,sources,busy,errors,uncertain,views,dirty,clock,run,detectLocal]);
 const sourceFor=(p:AccountPlatform)=>sources[p]??(p==='openai'?coordinated?.openaiSource:undefined)??{directory:null,store:savedDefaults?.platforms.find(d=>d.platform===p)?.default_store??'file'};
 const editSource=(platform:AccountPlatform,source:AccountSource)=>{
   if(accountPending(views[platform])||writing.current[platform]||uncertain[platform])return;
   if(JSON.stringify(sourceFor(platform))===JSON.stringify(source))return;
   delete resolutions.current[platform];verified.current[platform]=false;setLoginFlows(v=>({...v,[platform]:undefined}));
   setSourceReadFailed(v=>({...v,[platform]:undefined}));client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:undefined}));
 };
 useEffect(()=>{const journey=openaiJourney,view=views.openai;if(journey?.completed&&(errors.openai||accountErrors.openai||centralError||dirty.openai||view?.candidate.error||view?.authorization.error||view?.hive.error||deviceError||view?.operation?.error||view?.selection.fingerprint!==journey.completed||view?.candidate.identity_verified&&view.candidate.fingerprint!==journey.completed))setOpenaiJourney(undefined);},[views.openai,errors.openai,accountErrors.openai,centralError,deviceError,dirty.openai,openaiJourney]);
 const originalOperation=views.openai?.operation;
 const accountOperationID=originalOperation&&['select','confirm_change'].includes(originalOperation.kind)?openaiJourney?.operationId??originalOperation.id:undefined;
 useEffect(()=>{
  if(!enabled||!client||!accountOperationID){setOriginalAccountQuery(undefined);return;}
  const query=createOperationQuery({id:accountOperationID,read:async id=>{
   const snapshot=await client.snapshot('openai',false);
   if(snapshot.operation?.id!==id)throw {code:'ACCOUNT_ORIGINAL_UNAVAILABLE',message:'Original account operation record changed: actual='+(snapshot.operation?.id??'missing')+'; required='+id,details:{check:'account_original_query',observed_at:new Date().toISOString(),evidence:{actual:snapshot.operation?.id??'missing',required:id}}};
   return snapshot;
  },settled:s=>!!s.operation&&['succeeded','failed','cancelled'].includes(s.operation.state),retryable:cause=>['RESPONSE_TIMEOUT','REQUEST_NOT_SENT','CONNECTION_LOST'].includes(failure(cause).code),publish:state=>{
   setOriginalAccountQuery(state);if(state.value&&active.current){publish('openai',state.value);if(state.phase==='settled')setUncertain(v=>({...v,openai:false}));}
  }});
  originalAccountReader.current=query;void query.start();
  return()=>{query.dispose();if(originalAccountReader.current===query)originalAccountReader.current=undefined;};
 },[enabled,client,accountOperationID,publish]);
 const loginID=views.openai?.operation?.kind==='authorize'?views.openai.operation.id:views.openai?.login_maintenance?.operation.id;
 useEffect(()=>{
  if(!enabled||!authorizer?.progress||!loginID){setLoginProgress(undefined);return;}
  const query=createOperationQuery({id:loginID,read:id=>authorizer.progress!(id),settled:p=>p.phase==='finished'||!!p.blocker,
   retryable:cause=>['RESPONSE_TIMEOUT','REQUEST_NOT_SENT','CONNECTION_LOST'].includes(failure(cause,'authorize_progress').code),
   publish:setLoginProgress,limitMs:600000,intervalMs:1000});
  loginQuery.current=query;setLoginOpenError(undefined);void query.start();
  return()=>{query.dispose();if(loginQuery.current===query)loginQuery.current=undefined;};
 },[enabled,authorizer,loginID]);
 return {recheckCurrentOpenai:()=>central.current?.recheckOpenaiReads?.(),originalAccountQuery,queryOriginalAccount:()=>originalAccountReader.current?.start(),openaiJourney,completeOpenai:(fingerprint:string)=>setOpenaiJourney(v=>v?{...v,completed:fingerprint}:v),dismissOpenai:()=>setOpenaiJourney(undefined),sourceFor,openaiDraft,setOpenaiDraft,sourceSaving,sourceSaveError,loginProgress,loginOpenError,openingLogin,
  queryLogin(){return loginQuery.current?.start();},
  async openLoginPage(){
   if(!loginID||!authorizer?.open||openingLoginRef.current)return;
   openingLoginRef.current=true;setOpeningLogin(true);
   try{const receipt=await authorizer.open(loginID);if(active.current){setLoginOpenError(receipt.error?failure(receipt.error,'browser_opener'):undefined);void loginQuery.current?.start();}}
   catch(cause){if(active.current)setLoginOpenError(failure(cause,'browser_opener'));}
   finally{openingLoginRef.current=false;if(active.current)setOpeningLogin(false);}
  },
  async saveOpenaiSource(){
   if(!openaiDraft||!central.current?.saveOpenaiSource||sourceSavingRef.current||accountPending(latest.current.openai)||uncertain.openai||writing.current.openai)return;
   sourceSavingRef.current=true;setSourceSaving(true);setSourceSaveError(undefined);
   const generation=central.current.generation?.();
   try{
    const saved=await central.current.saveOpenaiSource(openaiDraft);
    if(!active.current||generation!==central.current?.generation?.())return;
    sourceSavingRef.current=false;editSource('openai',saved);setOpenaiDraft(undefined);setOpenaiJourney({kind:'repair',revision:revisions.current.openai});
    await run('openai',async()=>{const local=await detectLocal('openai',saved);if(!local.candidate.source||local.candidate.error)return local;return detectLocal('openai',saved,'official');},true);
   }catch(cause){if(active.current)setSourceSaveError(failure(cause,'preferences_save'));}
   finally{sourceSavingRef.current=false;if(active.current)setSourceSaving(false);}
  },
  autoService:!!coordinated?.autoService,submissionBlocked:!!centralError||!!deviceError,sharedReadFailure:centralError,deviceFailure:deviceError,readFailures:{...accountErrors,...(centralError?{openai:centralError,claude:centralError}:{})},cancelUnconfirmed,sharedFailure:centralError??deviceError??null,refreshStatus:coordinated?.refreshStatus,accountRefresh:coordinated?.accountRefresh,sourceDirectories:coordinated?.sourceDirectories??{},setSourceDirectory:coordinated?.setSourceDirectory,loginFlows,
  openLogin(platform:AccountPlatform,confirmation:string){setLoginFlows(v=>({...v,[platform]:{confirmation,rechecked:false,checking:false}}));},
  dismissLogin(platform:AccountPlatform){setLoginFlows(v=>({...v,[platform]:undefined}));},
  recheckLogin(platform:AccountPlatform,mode:'local'|'official'){
   if(!client||!savedDefaults||centralError||running.current[platform]||writing.current[platform]||uncertain[platform]||accountPending(views[platform]))return;
   const generation=central.current?.generation?.();
   setLoginFlows(v=>({...v,[platform]:{confirmation:null,rechecked:false,checking:true}}));
   const request=run(platform,()=>detectLocal(platform,sourceFor(platform),mode),true),epoch=epochs.current[platform];
   void request.finally(()=>{if(active.current&&epochs.current[platform]===epoch&&central.current?.generation?.()===generation)setLoginFlows(v=>({...v,[platform]:{confirmation:null,rechecked:true,checking:false}}));});
  },
  defaults:savedDefaults,defaultsError:centralError||defaultsError,views,errors:{...errors,...accountErrors,...(centralError?{openai:centralError,claude:centralError}:{})},busy,sources,dirty,uncertain,writeBusy,sourceReadFailed,
  edit:editSource,
  detect(platform:AccountPlatform,mode:'local'|'official'){if(client&&savedDefaults&&!centralError)void run(platform,()=>detectLocal(platform,sourceFor(platform),mode),true);},
  refresh(platform:AccountPlatform){void read(platform,true,views[platform]?.operation?.kind==='authorize'?views[platform]?.operation?.id:undefined);},
  action(platform:AccountPlatform,action:AccountActionRequest['action']){
   const view=views[platform];if(!client||!view||uncertain[platform]||centralError)return;
   if(platform==='openai'&&action!=='clear_selection')setOpenaiJourney(v=>({kind:action==='confirm_change'?'change':v?.kind==='first'?'first':'intake',revision:view.revision}));
   void run(platform,async current=>{const result=await client.action({platform,action,revision:current!.revision,candidate_ref:action==='clear_selection'?'':current!.candidate.reference??'',confirmed:true});if(platform==='openai'&&active.current)setOpenaiJourney(v=>v?{...v,operationId:result.operation?.id}:v);return result;},false,true);
  },
  authorize(platform:AccountPlatform){
   const view=views[platform];if(!client||!authorizer||!view||uncertain[platform]||centralError)return;
   if(platform==='openai')setOpenaiJourney({kind:view.selection.state==='selected'?'relogin':'first',revision:view.revision});
   if(platform==='claude')setLoginFlows(v=>({...v,[platform]:{confirmation:null,rechecked:false,checking:false}}));
   void run(platform,async current=>{setCancelUnconfirmed(v=>({...v,[platform]:undefined}));const receipt=await authorizer.start({platform,source:sourceFor(platform),expected_revision:current!.revision});if(platform==='openai'&&active.current)setOpenaiJourney(v=>v?{...v,operationId:receipt.id}:v);return refreshCentral?receipt:client.snapshot(platform,false);},false,true,false,false,true);
  },
  cancelAuthorize(platform:AccountPlatform){
   const id=views[platform]?.operation?.id;if(!client||!authorizer||!id)return;
   void run(platform,async current=>{
    if(current?.operation?.id!==id||!['pending','running'].includes(current.operation.state))return current;
    const epoch=epochs.current[platform],generation=central.current?.generation?.();
    setCancelUnconfirmed(v=>({...v,[platform]:undefined}));
    let receipt:AccountOperation;
    try{receipt=await authorizer.cancel(id);}
    catch(cause){
     const problem=failure(cause,'authorize_cancel');
     if(active.current&&epochs.current[platform]===epoch&&central.current?.generation?.()===generation&&!requestNotSent(problem))setCancelUnconfirmed(v=>({...v,[platform]:{operationId:id,failure:problem}}));
     throw cause;
    }
    return refreshCentral?receipt:client.snapshot(platform,false);
   },false,true,false,true,true);
  }
 };
}
export type AccountsModel=ReturnType<typeof useAccounts>;
