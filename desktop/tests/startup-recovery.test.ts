import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopState} from '../src/system/desktopState.ts';
import {createDeviceClient} from '../src/system/device.ts';
import {createDiagnosticsClient} from '../src/system/diagnostics.ts';
const diagnosticReport=()=>({id:'b'.repeat(48),instance:'a'.repeat(32),run_id:null,network_revision:2,binding_revision:1,started_at:'2026-10-26T03:30:00Z',finished_at:null,state:'running',checks:[]});
import {decodeStartupStatus} from '../src/system/bridge.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const startup=(instance:string,revision=1)=>({state:'blocked' as const,failure:{code:'device_replaced',check:'device_identity',observedAt:null,evidence:{},message:'HTTP 401'},instance,binding_revision:1,network_revision:0,observed_at:null,revision});
test('startup status survives a bridge query that settles later and rejects old instances',async t=>{
 const instance='a'.repeat(32);let bridgeListener:any,startupListener:any;
 let resolveBridge!:(v:any)=>void;const native=new Promise(resolve=>{resolveBridge=resolve;});
 const model=createDesktopState({bridge:{status:()=>native,onStatus:async(fn:any)=>{bridgeListener=fn;return()=>{};},onStartup:async(fn:any)=>{startupListener=fn;return()=>{};},startupStatus:async()=>startup(instance)} as any,device:{} as any,runtime:()=>({}) as any});t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 resolveBridge({state:'ready',metadata:{instance}});await tick();assert.equal(model.getSnapshot().startup?.failure?.code,'device_replaced');
 bridgeListener({state:'ready',metadata:{instance:'b'.repeat(32)}});startupListener(startup(instance,99));assert.equal(model.getSnapshot().startup,undefined);
 startupListener(startup('b'.repeat(32),2));startupListener({...startup('b'.repeat(32),1),state:'ready',failure:null});assert.equal(model.getSnapshot().startup?.state,'blocked');
});
test('binding replacement invalidates operation generations and clears old facts before new reads',async t=>{
 const instance='a'.repeat(32);let binding=1,hold=false,release!:(v:any)=>void,startupListener:any;
 const runtime={revision:1,network_revision:0,local:'stopped',run_id:null,platforms:{}};
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{startupListener=fn;return()=>{};}} as any,device:{recoveryOpen:async()=>{throw new Error('unused recovery browser')},recoveryPrepare:async()=>{throw new Error('unused recovery')},recoveryConfirm:async()=>{throw new Error('unused recovery')},recoveryStatus:async()=>{throw new Error('unused recovery')},context:async()=>({hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:binding}),status:async()=>({state:'unbound'}),begin:async()=>{throw Error('unexpected write');},open:async()=>{throw Error('unexpected browser action');}},runtime:()=>({snapshot:async()=>hold?new Promise(resolve=>{release=resolve;}):runtime}) as any,intervalMs:100000});t.after(()=>model.dispose());model.subscribe(()=>{});await tick();const before=model.generation();
 binding=2;hold=true;const reading=model.refresh();await tick();assert.ok(model.generation()>before);assert.equal(model.getSnapshot().runtime,undefined);assert.equal(model.getSnapshot().deviceContext?.binding_revision,2);
 hold=false;release(runtime);await reading;await tick();
 startupListener({...startup(instance,3),state:'ready',failure:null});assert.equal(model.getSnapshot().startup,undefined);
 startupListener({...startup(instance,4),binding_revision:2,network_revision:99});assert.equal(model.getSnapshot().startup,undefined);
});
test('startup decoder rejects malformed context and state/failure contradictions',()=>{
 const good={state:'ready',failure:null,instance:'a'.repeat(32),binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:1};
 assert.equal(decodeStartupStatus(good).state,'ready');
 for(const change of [{extra:true},{state:'blocked'},{instance:'old'},{revision:1.5},{binding_revision:-1},{observed_at:'2026-02-30T00:00:00Z'},{failure:{code:'X',message:'failure'}}])assert.throws(()=>decodeStartupStatus({...good,...change}),/STARTUP_STATUS_INVALID/);
});
test('rejected identity retains local runtime and context without resuming old account workers',async t=>{
 const calls:string[]=[];const instance='a'.repeat(32);
 const context={hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:1};
 const deps:any={bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{}},device:{status:async()=>{throw {code:'device_replaced',message:'HTTP 401',details:{check:'device_identity',observed_at:new Date().toISOString(),evidence:{http_status:'401',remote_code:'device_replaced'}}};},context:async()=>context},runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',run_id:null,platforms:{}})}),accounts:()=>({defaults:async()=>({platforms:[]}),snapshot:async()=>{calls.push('snapshot');throw Error('old worker must not resume');},detect:async()=>{calls.push('detect');return {};}}),intervalMs:100000};
 const model=createDesktopState(deps);t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 assert.equal(model.getSnapshot().runtime?.local,'stopped');
 assert.deepEqual((model.getSnapshot() as any).deviceContext,context);
 assert.equal(model.getSnapshot().deviceError?.code,'device_replaced');
 assert.equal(calls.includes('snapshot'),false);
});


test('absent and corrupt binding revisions drive diagnostics and isolate valid to corrupt to recovered state',async t=>{
 const instance='a'.repeat(32);let binding=1,kind='absent',resolve!:(v:any)=>void;
 const device=createDeviceClient(async command=>command==='device_context'?{result:kind==='valid'?{context:{hive:'https://hive.example',name:'Mac',device_id:'device',owner_id:'owner',binding_revision:binding}}:{error:{code:kind==='absent'?'DEVICE_CONTEXT_UNCONFIGURED':'DEVICE_CONTEXT_INVALID',message:'saved local record rejected'},binding_revision:binding}}:{result:{device:{state:'unbound'}}});
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{}} as any,device,runtime:()=>({snapshot:async()=>({revision:1,network_revision:2,local:'stopped',run_id:null,platforms:{}})}) as any,intervalMs:100000});t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 const client=createDiagnosticsClient(async()=>new Promise(r=>{resolve=r;}),instance,2,null,(model.getSnapshot() as any).bindingRevision??0);
 const start=client.start();await tick();resolve({instance,result:{report:{...diagnosticReport(),instance,run_id:null,binding_revision:1}}});assert.equal((await start).binding_revision,1);
 for(const next of ['corrupt','valid','corrupt','valid']) {
  const generation=model.generation();kind=next;binding++;await model.refresh();
  assert.equal((model.getSnapshot() as any).bindingRevision,binding);assert.ok(model.generation()>generation);
  assert.equal(!!model.getSnapshot().deviceContext,next==='valid');assert.equal(model.getSnapshot().deviceError?.code,next==='valid'?undefined:'DEVICE_CONTEXT_INVALID');
  client.setContext(2,null,binding);assert.equal(client.getSnapshot(),null);
 }
 const pending=client.start();await tick();kind='corrupt';binding++;await model.refresh();client.setContext(2,null,(model.getSnapshot() as any).bindingRevision);resolve({instance,result:{report:{...diagnosticReport(),instance,run_id:null,binding_revision:binding-1}}});await assert.rejects(pending,/context changed/);
});

test('stopped management retains the observed startup failure and rejects late events from its retired instance',async t=>{
 const instance='a'.repeat(32);let bridgeListener:any,startupListener:any;
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async(fn:any)=>{bridgeListener=fn;return()=>{};},onStartup:async(fn:any)=>{startupListener=fn;return()=>{};}} as any,device:{} as any,runtime:()=>({}) as any});t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 startupListener(startup(instance,4));bridgeListener({state:'stopped'});
 assert.equal(model.getSnapshot().startup?.failure?.code,'device_replaced');
 bridgeListener({state:'ready',metadata:{instance:'b'.repeat(32)}});startupListener(startup(instance,99));
 assert.equal(model.getSnapshot().startup,undefined);
});

test('blocked startup reads local runtime without querying account maintenance or defaults',async t=>{
 const instance='a'.repeat(32),calls:string[]=[];
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},startupStatus:async()=>({...startup(instance),failure:{...startup(instance).failure,code:'RECOVERY_SESSION_UNCONFIRMED'}})} as any,device:{context:async()=>({hive:'https://hive.example',name:'Mac',device_id:'device',owner_id:'owner',binding_revision:1}),status:async()=>({state:'unbound'})} as any,runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',run_id:null,platforms:{}})}) as any,accounts:()=>({defaults:async()=>{calls.push('defaults');return {platforms:[]};},snapshot:async()=>{calls.push('account');throw Error('maintenance must remain blocked');}}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();await model.refresh();
 assert.equal(model.getSnapshot().runtime?.local,'stopped');assert.equal(model.getSnapshot().startup?.failure?.code,'RECOVERY_SESSION_UNCONFIRMED');assert.deepEqual(calls,[]);
});

test('failed first startup read keeps account maintenance blocked until a verified receipt',async t=>{
 const instance='a'.repeat(32),calls:string[]=[];let listener:any;
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{listener=fn;return()=>{};},startupStatus:async()=>{throw {code:'STARTUP_READ_FAILED',message:'native startup receipt unavailable'};}} as any,device:{context:async()=>({hive:'https://hive.example',name:'Mac',device_id:'device',owner_id:'owner',binding_revision:1}),status:async()=>({state:'unbound'})} as any,runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',run_id:null,platforms:{}})}) as any,accounts:()=>({defaults:async()=>{calls.push('defaults');return {platforms:[]};},snapshot:async()=>{calls.push('account');throw Error('maintenance must remain blocked');}}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();await model.refresh();
 assert.equal(model.getSnapshot().startupReadError?.code,'STARTUP_READ_FAILED');assert.equal(calls.length,0);
 listener({...startup(instance,2),state:'ready',failure:null});
 assert.equal(model.getSnapshot().startupReadError,null);
 await tick();assert.ok(calls.includes('defaults'));
});


test('startup observation exposes exhausted retries and still accepts late terminal events',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-11T00:00:00Z')});
 const instance='a'.repeat(32);let reads=0,listener:any;
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{listener=fn;return()=>{};},startupStatus:async()=>{if(++reads===1)return {...startup(instance),state:'checking',failure:null,observed_at:new Date().toISOString()};throw Error('startup IPC unavailable');}} as any,device:{} as any,runtime:()=>({}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 for(const delay of [2000,1000,2000,4000]){t.mock.timers.tick(delay);await tick();}
 assert.equal(reads,5);assert.equal(model.getSnapshot().startupObservation,'stopped');
 t.mock.timers.tick(40000);await tick();assert.equal(reads,5);
 listener({...startup(instance,2),state:'ready',failure:null});
 assert.equal(model.getSnapshot().startup?.state,'ready');assert.equal(model.getSnapshot().startupObservation,'idle');
});

test('startup network bootstrap owns remote device checks until it finishes',async t=>{
 const instance='a'.repeat(32);let remoteReads=0,listener:any;
 const checking={...startup(instance),state:'checking',failure:null};
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{listener=fn;return()=>{};},startupStatus:async()=>checking} as any,device:{context:async()=>({binding_revision:1}),status:async()=>{remoteReads++;return {state:'unbound'};}} as any,runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',platforms:{}})}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();await model.refresh();
 assert.equal(remoteReads,0,'device_status must not conflict with startup runtime_configure_network');
 listener({...checking,state:'ready',revision:2});await tick();
 assert.ok(remoteReads>0,'ordinary identity observation resumes after startup');
});

test('manual startup retry refreshes context before accepting a newer network receipt',async t=>{
 const instance='a'.repeat(32);let network=0;
 const deps:any={bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},startupStatus:async()=>startup(instance),startupRetry:async()=>{network=1;return {...startup(instance,2),state:'ready',failure:null,network_revision:network};}},device:{context:async()=>({binding_revision:1}),status:async()=>({state:'unbound'})},runtime:()=>({snapshot:async()=>({revision:network+1,network_revision:network,local:'waiting',platforms:{}})}),intervalMs:100000};
 const model=createDesktopState(deps);t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 await model.retryStartup();
 assert.equal(model.getSnapshot().runtime?.network_revision,1);
 assert.equal(model.getSnapshot().startup?.state,'ready');
});

const settle=async()=>{for(let i=0;i<12;i++)await tick();};

for(const initial of ['checking','unavailable'])test(`automatic startup confirms a newer network receipt after ${initial}`,async t=>{
 const instance='a'.repeat(32);let network=0,listener:any;
 const checking={...startup(instance),state:'checking',failure:null};
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{listener=fn;return()=>{};},startupStatus:async()=>{if(initial==='unavailable')throw {code:'STARTUP_READ_TIMEOUT',message:'startup read timed out'};return checking;}} as any,device:{context:async()=>({binding_revision:1}),status:async()=>({state:'unbound'})} as any,runtime:()=>({snapshot:async()=>({revision:network+1,network_revision:network,local:'waiting',run_id:null,platforms:{}})}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await settle();
 assert.equal(model.getSnapshot().runtime?.network_revision,0);
 network=1;
 listener({...checking,state:'ready',network_revision:1,revision:2});
 await settle();
 assert.equal(model.getSnapshot().runtime?.network_revision,1);
 assert.equal(model.getSnapshot().startup?.state,'ready');
 assert.equal(model.getSnapshot().startupReadError,null);
});

function startupNetworkFixture(){
 const instance='a'.repeat(32);
 let listener:any,nativeListener:any,network=0,binding=1,runtimeReads=0,accountReads=0,contextError:any,runtimeError:any;
 let readOverride:(()=>Promise<any>)|undefined;
 const checking={...startup(instance),state:'checking',failure:null};
 const snapshot=()=>({revision:network+1,network_revision:network,local:'waiting',run_id:null,platforms:{}});
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async(fn:any)=>{nativeListener=fn;return()=>{};},onStartup:async(fn:any)=>{listener=fn;return()=>{};},startupStatus:async()=>checking} as any,device:{context:async()=>{if(contextError)throw contextError;return {binding_revision:binding};},status:async()=>({state:'unbound'})} as any,runtime:()=>({snapshot:async()=>{runtimeReads++;if(runtimeError)throw runtimeError;return readOverride?readOverride():snapshot();}}) as any,accounts:()=>({defaults:async()=>{accountReads++;return {platforms:[]};},snapshot:async()=>{accountReads++;throw Error('no account in fixture');}}) as any,intervalMs:100000});
 return {model,snapshot,ready:(revision=2)=>({...checking,state:'ready',network_revision:1,revision}),emit:(v:any)=>listener(v),emitNative:(v:any)=>nativeListener(v),network:(v:number)=>{network=v;},binding:(v:number)=>{binding=v;},hold:(fn?:()=>Promise<any>)=>{readOverride=fn;},failContext:(v:any)=>{contextError=v;},failRuntime:(v:any)=>{runtimeError=v;},reads:()=>runtimeReads,accountReads:()=>accountReads};
}

test('network confirmation joins an old read then observes again and coalesces duplicate receipts',async t=>{
 const f=startupNetworkFixture();t.after(()=>f.model.dispose());f.model.subscribe(()=>{});await settle();
 const old=f.snapshot();let release!:(v:any)=>void;
 f.hold(()=>new Promise(resolve=>{release=resolve;}));const pending=f.model.refresh();await settle();
 const before=f.reads();f.network(1);f.emit(f.ready());f.emit(f.ready());await settle();
 assert.equal(f.reads(),before);assert.equal(f.accountReads(),0);assert.notEqual(f.model.getSnapshot().startup?.state,'ready');
 f.hold();release(old);await pending;await settle();
 assert.ok(f.reads()>before,'must issue a read after the old in-flight observation');
 assert.equal(f.model.getSnapshot().runtime?.network_revision,1);assert.equal(f.model.getSnapshot().startup?.state,'ready');
});

for(const actual of [0,2])test(`fresh network ${actual} cannot confirm a ready receipt for network 1`,async t=>{
 const f=startupNetworkFixture();t.after(()=>f.model.dispose());f.model.subscribe(()=>{});await settle();
 f.network(actual);f.emit(f.ready());await settle();
 assert.notEqual(f.model.getSnapshot().startup?.state,'ready');assert.equal(f.accountReads(),0);
 assert.equal(f.model.getSnapshot().startupReadError?.code,'STARTUP_STATUS_REJECTED');
 assert.match(f.model.getSnapshot().startupReadError!.message,new RegExp(`required=network_revision=${actual}`));
 const reads=f.reads();await settle();assert.equal(f.reads(),reads,'failed confirmation must not create a retry loop');
});

for(const source of ['context','runtime'])test(`failed ${source} observation cannot confirm a newer startup receipt`,async t=>{
 const f=startupNetworkFixture();t.after(()=>f.model.dispose());f.model.subscribe(()=>{});await settle();
 const error={code:'READ_FAILED',message:`${source} observation unavailable`};
 f.network(1);if(source==='context')f.failContext(error);else f.failRuntime(error);
 f.emit(f.ready());await settle();
 assert.notEqual(f.model.getSnapshot().startup?.state,'ready');assert.equal(f.accountReads(),0);
 assert.equal(f.model.getSnapshot().startupReadError?.code,'READ_FAILED');
});

for(const replacement of ['blocked','instance','binding','disposed'])test(`pending network confirmation cannot survive ${replacement}`,async t=>{
 const f=startupNetworkFixture(),published:string[]=[];t.after(()=>f.model.dispose());f.model.subscribe(()=>{published.push(f.model.getSnapshot().startup?.state??'none');});await settle();
 let release!:(v:any)=>void;f.hold(()=>new Promise(resolve=>{release=resolve;}));
 // Binding changes must be seen by the fresh read after the older in-flight read.
 if(replacement==='binding'){void f.model.refresh();await settle();}
 f.network(1);f.emit(f.ready());await settle();
 if(replacement==='blocked')f.emit({...startup('a'.repeat(32),3),network_revision:0});
 if(replacement==='instance')f.emitNative({state:'ready',metadata:{instance:'b'.repeat(32)}});
 if(replacement==='binding')f.binding(2);
 if(replacement==='disposed')f.model.dispose();
 f.hold();release(f.snapshot());await settle();
 if(replacement==='binding')await f.model.refresh();
 assert.notEqual(f.model.getSnapshot().startup?.state,'ready');assert.equal(f.accountReads(),0);
 assert.ok(!published.includes('ready'),'must never transiently unlock a superseded receipt');
 if(replacement==='blocked')assert.equal(f.model.getSnapshot().startup?.failure?.code,'device_replaced');
});

test('an older startup event cannot cancel a newer confirmation or unlock a wrong binding',async t=>{
 const f=startupNetworkFixture();t.after(()=>f.model.dispose());f.model.subscribe(()=>{});await settle();
 let release!:(v:any)=>void;f.hold(()=>new Promise(resolve=>{release=resolve;}));f.network(1);f.emit(f.ready(4));await settle();
 f.emit({...startup('a'.repeat(32),3),network_revision:0});
 f.hold();release(f.snapshot());await settle();
 assert.equal(f.model.getSnapshot().startup?.state,'ready');assert.equal(f.model.getSnapshot().startup?.revision,4);
 f.emit({...f.ready(5),binding_revision:2});await settle();
 assert.notEqual(f.model.getSnapshot().startup?.state,'ready');
 assert.match(f.model.getSnapshot().startupReadError!.message,/binding_revision=2/);
});

const boundContext={hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:1};
const stoppedRuntime={revision:1,network_revision:0,local:'stopped',run_id:null,platforms:{}};
const identityBody='{"error":{"code":"invalid_device_credential","message":"invalid device credential","param":null,"type":"authentication_error"}}';
function identityDetails(code:string,kind:string,http?:string,extra:Record<string,string>={}){
 const evidence:Record<string,string>={elapsed_ms:'3',failure_kind:kind,method:'GET',path:'/api/bee/identity',phase:'http_error',...(http?{http_status:http}:{}),...(code==='invalid_device_credential'?{remote_code:code}:{}),...extra};
 return {check:'device_identity',observed_at:new Date().toISOString(),evidence};
}
function identityThrow(code:string,kind:string,http?:string,message?:string){
 return {code,message:message??`${code}: GET /api/bee/identity${http?' HTTP '+http:''}`,details:identityDetails(code,kind,http)};
}
function blockedIdentity(instance:string,code:string,kind:string,http?:string,revision=2,binding=1,network=0){
 const failure=identityThrow(code,kind,http);
 return {state:'blocked' as const,failure:{code:failure.code,check:'device_identity' as const,observedAt:failure.details.observed_at,evidence:failure.details.evidence,message:failure.message},instance,binding_revision:binding,network_revision:network,observed_at:failure.details.observed_at,revision,can_retry:false,recovering:false};
}
const identityCases=[
 {code:'invalid_device_credential',kind:'http_rejected',http:'401'},
 {code:'http_rejected',kind:'http_rejected',http:'503'},
 {code:'timeout',kind:'timeout'},
 {code:'connection_refused',kind:'connection_refused'},
] as const;
function boundIdentityDeps(instance:string,overrides:any){
 let remoteReads=0;
 const device={
  context:async()=>boundContext,
  recoveryStatus:async()=>{throw {code:'DEVICE_RECOVERY_NONE',message:'no device recovery transaction exists; prepare explicitly first'};},
  status:async()=>{remoteReads++;throw identityThrow(overrides.code,overrides.kind,overrides.http);},
  ...(overrides.device??{}),
 };
 return {remoteReads:()=>remoteReads,deps:{scope:{profile_id:'1'.repeat(32),instance},bridge:{status:async()=>({state:'ready',profile_id:'1'.repeat(32),metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async()=>()=>{},...(overrides.bridge??{})},device,runtime:()=>({snapshot:async()=>stoppedRuntime}),intervalMs:100000,...(overrides.deps??{})}};
}
function visibleIdentity(snapshot:ReturnType<ReturnType<typeof createDesktopState>['getSnapshot']>,code:string){
 const failure=snapshot.deviceError??(snapshot.startup?.state==='blocked'?snapshot.startup.failure:null)??snapshot.startupReadError??null;
 assert.ok(failure,`identity failure ${code} must leave loading; startup=${snapshot.startup?.state??'none'} deviceError=${snapshot.deviceError?.code??'none'} startupReadError=${snapshot.startupReadError?.code??'none'}`);
 assert.equal(failure!.code,code);
 assert.ok(snapshot.deviceContext?.device_id&&snapshot.deviceContext.owner_id&&(snapshot.deviceError||snapshot.recoveryError||snapshot.startup?.state==='blocked'),`saved bound identity ${code} must admit workspace after backend failure`);
}

test('startup decoder keeps invalid_device_credential from the observed identity HTTP 401 evidence',()=>{
 const observed_at='2026-11-20T02:54:08.321Z';
 const failure={code:'invalid_device_credential',message:'bound desktop device rejected; automatic pairing forbidden: invalid_device_credential: GET /api/bee/identity: HTTP 401, code="invalid_device_credential", error_json_valid=true: Hive request rejected: HTTP 401; code="invalid_device_credential"; required=HTTP 2xx; invalid device credential; verify the Hive address and local configuration; response_body='+identityBody,details:{check:'device_identity',observed_at,evidence:{elapsed_ms:'3',failure_kind:'http_rejected',http_status:'401',method:'GET',path:'/api/bee/identity',phase:'http_error',remote_code:'invalid_device_credential',response_body:identityBody,target_origin:'http://127.0.0.1:18080'}}};
 const status={state:'blocked',failure,instance:'a'.repeat(32),binding_revision:1,network_revision:0,observed_at:'2026-11-20T02:54:09.122Z',revision:2,can_retry:false,recovering:false};
 const decoded=decodeStartupStatus(status);
 assert.equal(decoded.state,'blocked');
 assert.equal(decoded.failure?.code,'invalid_device_credential');
 assert.equal(decoded.failure?.check,'device_identity');
 assert.equal(decoded.failure?.evidence.remote_code,'invalid_device_credential');
 assert.equal(decoded.failure?.evidence.http_status,'401');
 assert.match(decoded.failure!.evidence.response_body,/invalid_device_credential/);
});

for(const variant of identityCases)test(`hung startup_status still surfaces bound ${variant.code} and then reads the device`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-20T02:54:08Z')});
 const instance='a'.repeat(32);
 const {remoteReads,deps}=boundIdentityDeps(instance,{...variant,bridge:{startupStatus:()=>new Promise(()=>{})}});
 const model=createDesktopState(deps as any);t.after(()=>model.dispose());model.subscribe(()=>{});
 await settle();
 assert.equal(model.getSnapshot().startup,undefined);
 assert.equal(model.getSnapshot().deviceError,null);
 assert.equal(model.getSnapshot().startupReadError??null,null);
 assert.equal(remoteReads(),0);
 t.mock.timers.tick(2000);await settle();
 assert.ok(remoteReads()>0,`device.status must run after hung startup_status for ${variant.code}`);
 visibleIdentity(model.getSnapshot(),variant.code);
});

test('blocked identity receipt rejected for a newer local binding still keeps the concrete failure',async t=>{
 const instance='a'.repeat(32);let binding=1,remoteReads=0,revision=1;
 const failure=blockedIdentity(instance,'invalid_device_credential','http_rejected','401',2);
 const model=createDesktopState({scope:{profile_id:'1'.repeat(32),instance},bridge:{status:async()=>({state:'ready',profile_id:'1'.repeat(32),metadata:{instance}}),onStatus:async()=>()=>{},startupStatus:async()=>binding===1?{...failure,state:'ready',failure:null,revision,binding_revision:1,network_revision:0}:{...failure,revision:revision+1,binding_revision:1}} as any,device:{context:async()=>({...boundContext,binding_revision:binding}),recoveryStatus:async()=>{throw {code:'DEVICE_RECOVERY_NONE',message:'no device recovery transaction exists; prepare explicitly first'};},status:async()=>{remoteReads++;if(binding===1)return {state:'bound',hive:'https://hive.example',name:'Saved Mac',identity:{id:'device',name:'Saved Mac',owner_id:'owner',owner_email:'owner@example.test'}};throw identityThrow('invalid_device_credential','http_rejected','401');}} as any,runtime:()=>({snapshot:async()=>stoppedRuntime}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await settle();
 assert.equal(model.getSnapshot().startup?.state,'ready');
 const firstReads=remoteReads;
 binding=2;revision=2;await model.refresh();await settle();
 assert.ok(remoteReads>firstReads,'dropped blocked identity must not keep owning device_status');
 visibleIdentity(model.getSnapshot(),'invalid_device_credential');
});

test('blocked identity before onStartup registration is recovered from startup_status',async t=>{
 const instance='a'.repeat(32);
 const blocked=blockedIdentity(instance,'timeout','timeout');
 let registered=false;
 const {remoteReads,deps}=boundIdentityDeps(instance,{code:'timeout',kind:'timeout',bridge:{onStartup:async()=>{await tick();registered=true;return()=>{};},startupStatus:async()=>blocked}});
 const model=createDesktopState(deps as any);t.after(()=>model.dispose());model.subscribe(()=>{});await settle();
 assert.equal(registered,true);
 visibleIdentity(model.getSnapshot(),'timeout');
 assert.ok(model.getSnapshot().startup?.state==='blocked'||remoteReads()>0);
});

test('undecodable startup receipt releases device reads and keeps the identity failure',async t=>{
 const instance='a'.repeat(32);
 const {remoteReads,deps}=boundIdentityDeps(instance,{code:'connection_refused',kind:'connection_refused',bridge:{startupStatus:async()=>{throw new Error('STARTUP_STATUS_INVALID: details evidence rejected at key=response_body; required=fixed safe fields at most 32768 bytes');}}});
 const model=createDesktopState(deps as any);t.after(()=>model.dispose());model.subscribe(()=>{});await settle();
 assert.ok(remoteReads()>0);
 visibleIdentity(model.getSnapshot(),'connection_refused');
});

test('bound identity recovers after startup_recheck then fails again with the same code',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-20T02:54:08Z')});
 const instance='a'.repeat(32);let blocked=true,remoteReads=0;
 const model=createDesktopState({scope:{profile_id:'1'.repeat(32),instance},bridge:{status:async()=>({state:'ready',profile_id:'1'.repeat(32),metadata:{instance}}),onStatus:async()=>()=>{},startupStatus:()=>new Promise(()=>{}),startupRecheck:async()=>blocked?blockedIdentity(instance,'http_rejected','http_rejected','503',blocked?2:3):{state:'ready',failure:null,instance,binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:3,can_retry:false}} as any,device:{context:async()=>boundContext,recoveryStatus:async()=>{throw {code:'DEVICE_RECOVERY_NONE',message:'no device recovery transaction exists; prepare explicitly first'};},status:async()=>{remoteReads++;if(blocked)throw identityThrow('http_rejected','http_rejected','503');return {state:'bound',hive:'https://hive.example',name:'Saved Mac',identity:{id:'device',name:'Saved Mac',owner_id:'owner',owner_email:'owner@example.test'}};}} as any,runtime:()=>({snapshot:async()=>stoppedRuntime}) as any,intervalMs:100000});
 t.after(()=>model.dispose());model.subscribe(()=>{});await settle();t.mock.timers.tick(2000);await settle();
 visibleIdentity(model.getSnapshot(),'http_rejected');assert.ok(remoteReads>0);
 blocked=false;await model.recheckStartup();await settle();
 assert.equal(model.getSnapshot().startup?.state,'ready');assert.equal(model.getSnapshot().deviceError,null);
 blocked=true;await model.recheckStartup();await settle();
 visibleIdentity(model.getSnapshot(),'http_rejected');
});
