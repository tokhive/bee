import {normalizeFailure,type UiFailure} from './failures.ts';
import type {SystemBridge,BridgeStatus,StartupStatus,PendingRequest,RequestSettled} from './bridge';
import type {DeviceClient,DeviceView,DeviceContext,DeviceRecoveryView} from './device';
import type {AccountFactory,AccountDefaults,AccountSnapshot,AccountPlatform} from './accounts';
import type {SupplyFactory,SupplyView} from './supply';
import type {RuntimeFactory,RuntimeSnapshot} from './runtime';
import type {DiagnosticReport} from './diagnostics';
export interface RefreshStatus {state:'idle'|'reading'|'scheduled'|'blocked'|'waiting';nextRetryAt:string|null;lastConfirmedAt:string|null}
export interface DesktopSnapshot {
 native:BridgeStatus;startup?:StartupStatus;startupReadError?:UiFailure|null;startupObservation?:'active'|'stopped'|'idle';deviceContext?:DeviceContext;bindingRevision?:number;deviceContextFailure?:UiFailure;
 recovery?:DeviceRecoveryView;recoveryError?:UiFailure|null;
 device?:DeviceView;deviceError:UiFailure|null;runtime?:RuntimeSnapshot;defaults?:AccountDefaults;
 accounts:Partial<Record<AccountPlatform,AccountSnapshot>>;accountErrors:Partial<Record<AccountPlatform,UiFailure>>;
 supplies:Partial<Record<AccountPlatform,SupplyView>>;supplyErrors:Partial<Record<AccountPlatform,UiFailure>>;
 supplyPlatform?:AccountPlatform|null;error:UiFailure|null;busy:boolean;
 refresh:RefreshStatus;accountRefresh:Partial<Record<AccountPlatform,RefreshStatus>>;supplyRefresh:Partial<Record<AccountPlatform,RefreshStatus>>;
 diagnosticFailure?:UiFailure|null;
}
export interface DesktopDeps {openaiQueries?:boolean;bridge:SystemBridge;device:DeviceClient;runtime:RuntimeFactory;accounts?:AccountFactory;supply?:SupplyFactory;intervalMs?:number;random?:()=>number}
const platforms=['openai','claude'] as const;
export const idleRefresh=():RefreshStatus=>({state:'idle',nextRetryAt:null,lastConfirmedAt:null});
const status=(previous:RefreshStatus|undefined,state:RefreshStatus['state'],nextRetryAt:string|null=null):RefreshStatus=>({...previous??idleRefresh(),state,nextRetryAt});
const confirmed=():RefreshStatus=>({state:'idle',nextRetryAt:null,lastConfirmedAt:new Date().toISOString()});
const failure=(e:unknown,check='desktop_refresh')=>normalizeFailure(e,check);
/** The only application polling owner. A page subscription never starts another reader. */
export function createDesktopState(deps:DesktopDeps){
 let state:DesktopSnapshot={native:{state:'starting'},deviceError:null,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,busy:false,refresh:idleRefresh(),accountRefresh:{},supplyRefresh:{}};
 let disposed=false,started=false,epoch=0,pendingEpoch=0,blocked=false;
 let unlistenSettled:(()=>void)|undefined;
 let unlisten:(()=>void)|undefined,unlistenStartup:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,nextRefresh:Promise<void>|undefined;
 let startupTimer:ReturnType<typeof setTimeout>|undefined,startupReading=false,startupFailures=0;
 const startupBegan=Date.now();
 const startupUnverified=()=>deps.bridge.startupStatus?state.startup?.state!=='ready':!!state.startup&&state.startup.state!=='ready';
 let runtimeReceiptRevision=-1,accountReceiptRevisions:Partial<Record<AccountPlatform,number>>={};
 let deviceObservedAt:string|null=null,diagnosticObservedAt:string|null=null;
 const listeners=new Set<()=>void>();
 const publish=(next:Partial<DesktopSnapshot>)=>{if(disposed)return;state={...state,...next};listeners.forEach(fn=>fn());};
 type Resource='context'|'device'|'recovery'|'runtime'|`account:${AccountPlatform}`|`supply:${AccountPlatform}`;
 type Gate={failures:number;at:number;terminal:boolean;waiting?:string};
 const gates=new Map<Resource,Gate>();let nativePending:PendingRequest[]=[];let automaticRound=false;
 const gate=(key:Resource)=>{let g=gates.get(key);if(!g){g={failures:0,at:0,terminal:false};gates.set(key,g);}return g;};
 const laneBlocked=(platform?:AccountPlatform)=>nativePending.some(r=>!platform||r.platform===null||!['account_detect','account_snapshot','supply_status'].includes(r.method)||r.platform===platform);
 const allowed=(key:Resource)=>{const g=gate(key);return !g.terminal&&!g.waiting&&(!g.failures&&!automaticRound||Date.now()>=g.at);};
 const limited=(g:Gate)=>deps.openaiQueries&&['account:openai','supply:openai'].some(k=>gates.get(k as Resource)===g);
 const backoff=(g:Gate,problem?:UiFailure)=>{if(limited(g)){delete g.waiting;if(g.failures>3){g.terminal=true;return;}g.at=Date.now()+[1000,2000,4000][g.failures-1];return;}const delay=[2000,4000,8000,16000,30000][Math.min(g.failures-1,4)];g.at=Date.now()+Math.max(Math.round(delay*(0.8+0.2*(deps.random??Math.random)())),Number(problem?.evidence.retry_after_seconds??0)*1000);delete g.waiting;};
 const succeed=(key:Resource)=>{gates.set(key,{failures:0,at:Date.now()+(deps.intervalMs??10000),terminal:false});};
 const fail=(key:Resource,problem:UiFailure)=>{
  const g=gate(key);g.failures++;
  const kind=problem.evidence.failure_kind??problem.code,http=problem.evidence.http_status;
  g.terminal=!!http&&['401','403'].includes(http)||!(['timeout','dns_temporary','connection_closed','connection_refused','REQUEST_NOT_SENT','REQUEST_QUEUE_TIMEOUT','REQUEST_NOT_QUEUED','RESPONSE_TIMEOUT','deadline'].includes(kind)||['http_rejected','rate_limited'].includes(kind)&&['429','502','503','504'].includes(http));
  if(problem.code==='RESPONSE_TIMEOUT'&&problem.evidence.in_flight==='true'&&problem.evidence.request_id){
   g.terminal=false;g.waiting=problem.evidence.request_id;g.at=0;
   if(!nativePending.some(r=>r.id===g.waiting))nativePending.push({id:g.waiting,method:problem.evidence.method??'runtime_snapshot',platform:problem.evidence.platform==='openai'||problem.evidence.platform==='claude'?problem.evidence.platform:null});
  }else if(!g.terminal)backoff(g,problem);
 };
 const resourceStatus=(key:Resource,previous:RefreshStatus|undefined,normalAt?:number):RefreshStatus=>{
  const g=gate(key),platform=key.includes(':')?key.split(':')[1] as AccountPlatform:undefined;
  if(g.terminal||platform&&(gate('context').terminal||gate('device').terminal||gate('recovery').terminal))return status(previous,'blocked');
  if(g.waiting||laneBlocked(platform))return status(previous,'waiting');
  if(g.failures)return status(previous,'scheduled',new Date(g.at).toISOString());
  return status(previous,'scheduled',g.at?new Date(g.at).toISOString():normalAt?new Date(normalAt).toISOString():null);
 };
 function updateStatuses(normalAt?:number){
  const shared=(['context','device','recovery','runtime'] as Resource[]).find(k=>gate(k).terminal||gate(k).waiting||gate(k).failures)||'runtime';
  publish({refresh:resourceStatus(shared,state.refresh,normalAt),accountRefresh:Object.fromEntries(platforms.map(p=>[p,resourceStatus(`account:${p}`,state.accountRefresh[p],normalAt)])),supplyRefresh:Object.fromEntries(platforms.map(p=>[p,resourceStatus(`supply:${p}`,state.supplyRefresh[p],normalAt)]))});
 }
 async function readPending(){
  if(!deps.bridge.pendingRequests)return;
  const instance=state.native.metadata?.instance,generation=epoch;
  const observed=await deps.bridge.pendingRequests();if(disposed||generation!==epoch||observed.instance!==instance)return;
  nativePending=observed.requests;
  for(const g of gates.values())if(g.waiting&&!nativePending.some(r=>r.id===g.waiting))backoff(g);
 }
 function acceptSettled(event:RequestSettled){
  if(disposed||event.instance!==state.native.metadata?.instance)return;
  nativePending=nativePending.filter(r=>r.id!==event.id);
  for(const g of gates.values())if(g.waiting===event.id)backoff(g);
  updateStatuses();if(!pending)schedule(deps.intervalMs??10000);
 }
 const repair=()=>{for(const [key,g]of gates)if(g.terminal)gates.delete(key);blocked=false;};
 const mapStatus=(map:DesktopSnapshot['accountRefresh'],kind:RefreshStatus['state'],at:string|null=null)=>Object.fromEntries(platforms.map(p=>[p,status(map[p],kind,at)]));
 const reset=()=>({recovery:undefined,recoveryError:null,device:undefined,deviceContext:undefined,bindingRevision:undefined,deviceContextFailure:undefined,deviceError:null,runtime:undefined,defaults:undefined,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},supplyPlatform:null,error:null,diagnosticFailure:null,refresh:idleRefresh(),accountRefresh:{},supplyRefresh:{}});
 const acceptStartup=(next:StartupStatus)=>{
  if(disposed||next.instance&&state.native.metadata?.instance&&next.instance!==state.native.metadata.instance)return;
  if(next.state!=='checking'){
   if(state.bindingRevision!==undefined&&next.binding_revision!==null&&next.binding_revision!==state.bindingRevision)return;
   if(state.runtime&&next.network_revision!==null&&next.network_revision!==state.runtime.network_revision)return;
  }
  if(state.startup&&next.revision<state.startup.revision)return;
  const becameReady=next.state==='ready'&&state.startup?.state!=='ready',generation=epoch;
  publish({startup:next,startupReadError:null});
  if(next.state!=='checking'){clearTimeout(startupTimer);publish({startupObservation:'idle'});}
  if(becameReady)void Promise.resolve(pending).then(()=>{if(!disposed&&epoch===generation&&state.startup?.state==='ready')void refresh();});
 };
 function accept(native:BridgeStatus){
  if(disposed)return;
  const changed=native.metadata?.instance!==state.native.metadata?.instance||native.state!==state.native.state;
  if(!changed){publish({native});return;}
  const previousInstance=state.native.metadata?.instance??state.startup?.instance;
  epoch++;blocked=false;gates.clear();nativePending=[];runtimeReceiptRevision=-1;accountReceiptRevisions={};deviceObservedAt=diagnosticObservedAt=null;clearTimeout(timer);
  const generation=epoch,instance=native.metadata?.instance,startup=(!instance&&native.state!=='ready'||state.startup?.instance===instance)?state.startup:undefined;
  publish({...reset(),native,startup,busy:false});
  if(native.state==='ready')queueMicrotask(()=>{if(!disposed&&epoch===generation&&state.native.metadata?.instance===instance){if(previousInstance&&previousInstance!==instance)void readStartup();void refresh();}});
 }
 async function readStartup(){
  if(disposed||startupReading||!deps.bridge.startupStatus)return;
  startupReading=true;publish({startupObservation:'active'});
  try{const next=await deps.bridge.startupStatus();startupFailures=0;publish({startupReadError:null});acceptStartup(next);}
  catch(cause){startupFailures++;publish({startupReadError:failure(cause,'startup_status')});}
  finally{
   startupReading=false;
   if(!disposed&&state.startup?.state!=='ready'&&state.startup?.state!=='blocked'){
    if(startupFailures>3||Date.now()-startupBegan>=60000)publish({startupObservation:'stopped'});
    else startupTimer=setTimeout(()=>void readStartup(),Math.min(startupFailures?[1000,2000,4000][startupFailures-1]:2000,60000-(Date.now()-startupBegan)));
   }
  }
 }
 function begin(){
  if(started||disposed)return;started=true;let received=false;
  void deps.bridge.onStatus(v=>{received=true;accept(v);}).then(off=>{if(disposed)off();else unlisten=off;},e=>publish({error:failure(e)}));
  if(deps.bridge.onRequestSettled)void deps.bridge.onRequestSettled(acceptSettled).then(off=>{if(disposed)off();else unlistenSettled=off;},e=>publish({error:failure(e,'pending_requests')}));
  if(deps.bridge.onStartup)void deps.bridge.onStartup(acceptStartup).then(off=>{if(disposed)off();else unlistenStartup=off;},e=>publish({startupReadError:failure(e,'startup_status')}));
  if(deps.bridge.startupStatus)void readStartup();
  void deps.bridge.status().then(v=>{if(!received)accept(v);},e=>{if(!received)publish({error:failure(e)});});
 }
 function schedule(delay:number){
  clearTimeout(timer);const generation=epoch,normalAt=Date.now()+delay;
  for(const g of gates.values())if(!g.failures&&g.at)g.at=Math.min(g.at,normalAt);
  const retryTimes=[...gates.values()].filter(g=>!g.terminal&&!g.waiting).map(g=>g.at).filter(at=>at>Date.now());
  const at=Math.min(normalAt,...retryTimes,...(nativePending.length?[Date.now()+2000]:[]));
  timer=setTimeout(()=>{timer=undefined;if(!disposed&&epoch===generation)void refresh(true);},Math.max(1,at-Date.now()));
  updateStatuses(normalAt);
 }
 async function refresh(automatic=false):Promise<void>{
  if(disposed)return;if(!started)begin();
  if(pending){if(pendingEpoch!==epoch){nextRefresh??=pending.then(()=>{nextRefresh=undefined;return refresh();});return nextRefresh;}return pending;}
  const instance=state.native.metadata?.instance;if(state.native.state!=='ready'||!instance)return;
  clearTimeout(timer);timer=undefined;automaticRound=automatic;let generation=epoch;pendingEpoch=generation;
  publish({busy:true});
  const current=()=>!disposed&&epoch===generation&&state.native.metadata?.instance===instance;
  const task=(async()=>{
   let device=state.device,deviceError:UiFailure|null=state.deviceError;
   try{
    await readPending();if(!current())return;
    const runtime=deps.runtime(instance),accounts=deps.accounts?.(instance);
    let deviceContext=state.deviceContext,bindingRevision=state.bindingRevision,deviceContextFailure=state.deviceContextFailure,scopeMayHaveChanged=false;
    const observeContext=(local:Awaited<ReturnType<NonNullable<DeviceClient['context']>>>)=>{
     if(deviceError===deviceContextFailure)deviceError=null;
     bindingRevision=local.binding_revision;
     deviceContext='failure'in local?undefined:local;
     deviceContextFailure='failure'in local?local.failure:undefined;
     if(deviceContextFailure&&deviceContextFailure.code!=='DEVICE_CONTEXT_UNCONFIGURED')deviceError=deviceContextFailure;
    };
    if(deps.device.context&&!laneBlocked()&&allowed('context'))try{observeContext(await deps.device.context());succeed('context');}
    catch(e){deviceContextFailure=deviceError=failure(e,'device_context');fail('context',deviceError);await readPending();}
    if(!current())return;
    if(state.bindingRevision!==undefined&&bindingRevision!==state.bindingRevision){
     epoch++;generation=epoch;pendingEpoch=generation;gates.clear();runtimeReceiptRevision=-1;accountReceiptRevisions={};deviceObservedAt=diagnosticObservedAt=null;device=undefined;
     publish({...reset(),deviceContext,bindingRevision,deviceContextFailure,startup:undefined,refresh:status(undefined,'reading')});
    }else publish({deviceContext,bindingRevision,deviceContextFailure});
    let recovery=state.recovery,recoveryError:UiFailure|null=state.recoveryError??null;
    if(deps.device.recoveryStatus&&!gate('context').failures&&!laneBlocked()&&allowed('recovery'))try{
     scopeMayHaveChanged=true;
     const nextRecovery=await deps.device.recoveryStatus();if(!current())return;
     if(recovery&&(recovery.operation_id===nextRecovery.operation_id&&nextRecovery.revision<recovery.revision||recovery.operation_id!==nextRecovery.operation_id&&recovery.phase!=='completed'))throw {code:'DESKTOP_STALE_RESULT',message:'recovery observation conflicts with the current transaction; actual='+nextRecovery.operation_id+':'+nextRecovery.revision+' required='+recovery.operation_id+':'+recovery.revision,details:{check:'device_recovery_status',observed_at:new Date().toISOString(),evidence:{actual:nextRecovery.operation_id+':'+nextRecovery.revision,required:recovery.operation_id+':'+recovery.revision}}};
     recovery=nextRecovery;recoveryError=null;succeed('recovery');
    }catch(e){if(!current())return;const problem=failure(e,'device_recovery_status');if(problem.code==='DEVICE_RECOVERY_NONE'){recovery=undefined;recoveryError=null;succeed('recovery');}else {recoveryError=problem;fail('recovery',problem);await readPending();}}
    if(!current())return;
    if(!gate('context').failures&&(!deviceContextFailure||deviceContextFailure.code==='DEVICE_CONTEXT_UNCONFIGURED')&&!laneBlocked()&&allowed('device'))try{scopeMayHaveChanged=true;publish({refresh:status(state.refresh,'reading')});device=await deps.device.status();deviceError=null;succeed('device');deviceObservedAt=new Date().toISOString();if(!diagnosticObservedAt||Date.parse(deviceObservedAt)>Date.parse(diagnosticObservedAt))publish({diagnosticFailure:null});}catch(e){if(!current())return;deviceError=failure(e,'device_status');fail('device',deviceError);await readPending();}
    if(!current())return;
    // Both status methods can save the active configuration before their final receipt fails.
    // Re-observe local scope on success AND failure before publishing any subsequent scoped fact.
    if(deps.device.context&&scopeMayHaveChanged&&!gate('context').failures&&!laneBlocked()){
     let local:Awaited<ReturnType<NonNullable<DeviceClient['context']>>>;
     try{local=await deps.device.context();if(!current())return;succeed('context');}
     catch(e){if(!current())return;const problem=failure(e,'device_context');fail('context',problem);publish({deviceError:problem,deviceContextFailure:problem});await readPending();return;}
     const previousBinding=bindingRevision;observeContext(local);

     if(local.binding_revision!==previousBinding){
      epoch++;generation=epoch;pendingEpoch=generation;gates.clear();runtimeReceiptRevision=-1;accountReceiptRevisions={};deviceObservedAt=diagnosticObservedAt=null;
      if('failure'in local||device?.state!=='bound'||device.identity?.id!==local.device_id||device.hive!==local.hive)device=undefined;

      publish({...reset(),deviceContext,bindingRevision,deviceContextFailure,startup:undefined,refresh:status(undefined,'reading')});
     }
    }
    publish({recovery,recoveryError});
    // Runtime and defaults form the shared read. Validate all shared floors BEFORE publishing any of it.
    let next=state.runtime,defaults=state.defaults,runtimeRead=false;
    if(!laneBlocked()&&allowed('runtime')){
     try{[next,defaults]=await Promise.all([runtime.snapshot(),!state.defaults&&accounts&&!startupUnverified()?accounts.defaults():Promise.resolve(state.defaults)]);succeed('runtime');runtimeRead=true;}
     catch(e){const problem=failure(e,'runtime_snapshot');fail('runtime',problem);publish({error:problem});await readPending();}
    }
    if(!next){publish({device,deviceError,recovery,recoveryError});return;}
    if(!current())return;
    const minimum=Math.max(runtimeReceiptRevision,state.runtime?.revision??-1);
    if(next.revision<minimum||state.runtime&&next.network_revision<state.runtime.network_revision)throw {
     code:'DESKTOP_STALE_RESULT',evidence:{actual:String(next.revision),required:'runtime revision >='+minimum+' from confirmed operation receipt'},
     message:'runtime revision actual='+next.revision+'; required>='+minimum+' from confirmed operation receipt; network actual='+next.network_revision+' required>='+(state.runtime?.network_revision??0)
    };
    const networkChanged=state.runtime&&state.runtime.network_revision!==next.network_revision;
    if(networkChanged){repair();diagnosticObservedAt=null;publish({diagnosticFailure:null});}
    if(deviceError||recoveryError||startupUnverified()){
     // Local runtime observations may confirm login/cancellation, but never resume an old Hive write worker.
     const localAccounts={...state.accounts},errors={...state.accountErrors},refreshes={...state.accountRefresh};
     for(const platform of platforms){
      const account=next.platforms[platform]?.account;
      const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1);
      if(!account||account.revision<minimum){
       errors[platform]=failure({code:'DESKTOP_STALE_RESULT',evidence:{actual:String(account?.revision??'missing'),required:'account revision >='+minimum},message:'local account revision platform='+platform+' actual='+(account?.revision??'missing')+'; required>='+minimum+' from last confirmed observation'},'account_snapshot');
       refreshes[platform]=status(refreshes[platform],'blocked');
      }else{localAccounts[platform]=account;delete errors[platform];refreshes[platform]=status(refreshes[platform],'blocked');}
     }
     publish({device,deviceError,runtime:next,defaults,error:null,accounts:localAccounts,accountErrors:errors,accountRefresh:refreshes,refresh:status(state.refresh,'idle'),supplyRefresh:mapStatus(state.supplyRefresh,'blocked')});return;
    }
    publish({device,deviceError,runtime:next,defaults,...(runtimeRead?{error:null,refresh:confirmed()}:{})});
    const supply=device?.state==='bound'&&device.hive&&device.identity?deps.supply?.({hive:device.hive,deviceId:device.identity.id}):undefined;
    await Promise.all(platforms.map(async platform=>{
     const readAccount=async()=>{
      if(laneBlocked(platform)||!allowed(`account:${platform}`))return;
      if(!accounts){
       const account=next.platforms[platform]?.account;
       if(account)publish({accounts:{...state.accounts,[platform]:account},accountRefresh:{...state.accountRefresh,[platform]:confirmed()}});
       return;
      }
      publish({accountRefresh:{...state.accountRefresh,[platform]:status(state.accountRefresh[platform],'reading')}});
      try{
       const account=await accounts.snapshot(platform,!(deps.openaiQueries&&platform==='openai'));if(!current())return;
       const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1,next.platforms[platform]?.account.revision??-1);
       if(account.revision<minimum)throw {code:'DESKTOP_STALE_RESULT',evidence:{actual:String(account.revision),required:'account revision >='+minimum},message:'account revision platform='+platform+' actual='+account.revision+'; required>='+minimum+' from last confirmed observation'};
       const errors={...state.accountErrors};delete errors[platform];
       const embedded=account.hive?.error??account.capabilities?.find(c=>c.origin==='hive'&&c.error)?.error;
       if(embedded){const problem=failure(embedded,'account_snapshot');errors[platform]=problem;fail(`account:${platform}`,problem);await readPending();if(!current())return;}else succeed(`account:${platform}`);
       const runtime=state.runtime!,view=runtime.platforms[platform];
       publish({accounts:{...state.accounts,[platform]:account},accountErrors:errors,accountRefresh:{...state.accountRefresh,[platform]:embedded?resourceStatus(`account:${platform}`,state.accountRefresh[platform]):confirmed()},runtime:{...runtime,platforms:{...runtime.platforms,...(view?{[platform]:{...view,account}}:{})}}});
      }catch(e){if(!current())return;
       let problem=failure(e,'account_snapshot');fail(`account:${platform}`,problem);await readPending();if(!current())return;
       const minimum=Math.max(accountReceiptRevisions[platform]??-1,state.accounts[platform]?.revision??-1),actual=next.platforms[platform]?.account.revision;
       if(minimum>=0&&(actual===undefined||actual<minimum)){gate(`account:${platform}`).terminal=true;problem=failure({...problem,evidence:{...problem.evidence,actual:String(actual??'missing'),required:'account revision >='+minimum},message:problem.message+'; account revision platform='+platform+' actual='+(actual??'missing')+'; required>='+minimum+' from last confirmed observation'},'account_snapshot');}
       publish({accountErrors:{...state.accountErrors,[platform]:problem},accountRefresh:{...state.accountRefresh,[platform]:status(state.accountRefresh[platform],'idle')}});
      }
     };
     const readSupply=async()=>{
      if(laneBlocked(platform)||!allowed(`supply:${platform}`))return;
      if(!supply){const view=next.platforms[platform]?.supply;if(view)publish({supplies:{...state.supplies,[platform]:view},supplyRefresh:{...state.supplyRefresh,[platform]:confirmed()}});return;}
      publish({supplyRefresh:{...state.supplyRefresh,[platform]:status(state.supplyRefresh[platform],'reading')}});
      try{const view=await supply.status(platform);if(!current())return;succeed(`supply:${platform}`);const errors={...state.supplyErrors};delete errors[platform];publish({supplies:{...state.supplies,[platform]:view},supplyErrors:errors,supplyRefresh:{...state.supplyRefresh,[platform]:confirmed()}});}
      catch(e){if(current()){const problem=failure(e,'supply_read');fail(`supply:${platform}`,problem);publish({supplyErrors:{...state.supplyErrors,[platform]:problem},supplyRefresh:{...state.supplyRefresh,[platform]:status(state.supplyRefresh[platform],'idle')}});await readPending();}}
     };
     await readAccount();await readSupply();
    }));
   }catch(e){if(current()){const problem=failure(e);if(problem.code==='DESKTOP_STALE_RESULT')blocked=true;else fail('runtime',problem);publish({device,deviceError,error:problem});}}
   finally{
    if(current()){
     publish({busy:false,supplyPlatform:null});
     if(blocked)publish({refresh:status(state.refresh,'blocked'),accountRefresh:mapStatus(state.accountRefresh,'blocked'),supplyRefresh:mapStatus(state.supplyRefresh,'blocked')});
     else{
      const moving=state.runtime?.local==='starting'||state.runtime?.local==='stopping'||Object.values(state.accounts).some(v=>v.operation&&['pending','running'].includes(v.operation.state));
      schedule(moving?400:state.recovery?.phase==='pending'||state.recovery?.phase==='draining'?2000:state.device?.state==='pending'||state.device?.state==='draining'?(state.device.poll_interval_seconds??2)*1000:deps.intervalMs??10000);
     }
    }
   }
  })();
  pending=task;
  try{await task;}finally{if(pending===task)pending=undefined;}
 }
 function acceptDiagnosticReport(report:DiagnosticReport){
  if(disposed||report.instance!==state.native.metadata?.instance||report.binding_revision!==state.bindingRevision||report.network_revision!==state.runtime?.network_revision||report.run_id!==state.runtime?.run_id)return;
  for(const check of report.checks){
   if(check.id!=='hive'||check.platform!==null||check.status!=='fail'||!['device_replaced','http_rejected','identity_mismatch'].includes(check.code))continue;
   if(!Number.isFinite(Date.parse(check.observed_at))||deviceObservedAt&&Date.parse(check.observed_at)<=Date.parse(deviceObservedAt)||diagnosticObservedAt&&Date.parse(check.observed_at)<=Date.parse(diagnosticObservedAt))continue;
   diagnosticObservedAt=check.observed_at;
   const evidence:Record<string,string>={};for(const key of ['http_status','path'] as const)if(check.evidence[key])evidence[key]=check.evidence[key];if(check.evidence.server_code)evidence.remote_code=check.evidence.server_code;
   const code=check.code==='http_rejected'&&check.evidence.method==='GET'&&evidence.path==='/api/bee/identity'&&evidence.http_status==='401'&&evidence.remote_code==='invalid_device_credential'?'invalid_device_credential':check.code;
   publish({diagnosticFailure:failure({code,message:'Hive identity check '+check.code+(evidence.http_status?' HTTP '+evidence.http_status:''),details:{check:'device_identity',observed_at:check.observed_at,evidence}},'device_identity')});
  }
 }
 return {
  async observeStartup(){const next=await (deps.bridge.startupQuery?.()??deps.bridge.startupStatus?.());if(next)acceptStartup(next);},
  async retryStartup(){if(!deps.bridge.startupRetry)return;const next=await deps.bridge.startupRetry();acceptStartup(next);if(next.state==='ready'){repair();await refresh();}},
  async recheckStartup(){await readPending();if(nativePending.length)return refresh();if(!deps.bridge.startupRecheck){repair();return refresh();}const next=await deps.bridge.startupRecheck();if(next.state==='ready')repair();await refresh();acceptStartup(next);},
  recheckOpenaiReads(){
   if(pending)return pending;
   if(laneBlocked('openai'))return Promise.resolve();
   for(const key of ['account:openai','supply:openai'] as Resource[])gates.delete(key);
   return refresh();
  },
  acceptDiagnosticReport,
  subscribe(fn:()=>void){if(disposed)return()=>{};listeners.add(fn);begin();return()=>{listeners.delete(fn);};},getSnapshot:()=>state,refresh,generation:()=>epoch,
  recordRuntimeReceipt(revision:number){repair();runtimeReceiptRevision=Math.max(runtimeReceiptRevision,revision);},
  recordAccountReceipt(platform:AccountPlatform,revision:number,confirmedOperation=true){if(confirmedOperation)for(const key of [`account:${platform}`,`supply:${platform}`] as Resource[])if(gate(key).terminal)gates.delete(key);accountReceiptRevisions[platform]=Math.max(accountReceiptRevisions[platform]??-1,revision);},
  pause(){epoch++;clearTimeout(timer);for(const g of gates.values())if(!g.failures)g.at=Date.now()+(deps.intervalMs??10000);publish({busy:false,supplyPlatform:null});schedule(deps.intervalMs??10000);},
  dispose(){disposed=true;epoch++;clearTimeout(timer);clearTimeout(startupTimer);unlisten?.();unlistenStartup?.();unlistenSettled?.();listeners.clear();}
 };
}
export type DesktopState=ReturnType<typeof createDesktopState>;
