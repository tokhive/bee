import {normalizeFailure} from '../src/system/failures.ts';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDesktopState} from '../src/system/desktopState.ts';
const ready=(instance:string)=>({state:'ready',metadata:{instance,bee_version:'test',os:'darwin',arch:'arm64'}});
const runtime=(network_revision=0)=>({revision:1,network_revision,local:'stopped',platforms:{},run_id:null});
function fixture(){let listener:(v:any)=>void=()=>{};let calls=0;let current:any=runtime();const deps:any={bridge:{status:async()=>ready('a'),onStatus:async(fn:any)=>{listener=fn;return()=>{};}},device:{status:async()=>({state:'unbound'})},runtime:()=>({snapshot:async()=>{calls++;return current;}}),intervalMs:100000};return {deps,emit:(v:any)=>listener(v),calls:()=>calls,set:(v:any)=>{current=v;}};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('one coordinator shares snapshots across subscriptions without page-triggered reads',async()=>{const f=fixture();const m=createDesktopState(f.deps);let updates=0;const off=m.subscribe(()=>updates++);await tick();const calls=f.calls();const second=m.subscribe(()=>updates++);await tick();assert.equal(f.calls(),calls);await Promise.all([m.refresh(),m.refresh()]);assert.equal(f.calls(),calls+1);assert.ok(updates>0);off();second();m.dispose();await m.refresh();assert.equal(f.calls(),calls+1);});
test('old child and network revision results never replace current state',async()=>{const f=fixture();const m=createDesktopState(f.deps);m.subscribe(()=>{});await tick();f.set(runtime(3));await m.refresh();assert.equal(m.getSnapshot().runtime?.network_revision,3);f.set(runtime(2));await m.refresh();assert.equal(m.getSnapshot().runtime?.network_revision,3);f.emit(ready('b'));await tick();assert.equal(m.getSnapshot().native.metadata?.instance,'b');m.dispose();});
test('coordinator refreshes stopped account and supply observations once for all pages',async t=>{
 const f=fixture();let accountReads=0,supplyReads=0;
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string,refresh:boolean)=>{assert.equal(refresh,true);accountReads++;return {platform,revision:4,issues:[]};}});
 f.deps.supply=()=>({status:async(platform:string)=>{supplyReads++;return {platform,checked_at:new Date().toISOString()};}});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(accountReads,2);assert.equal(supplyReads,2);assert.equal(m.getSnapshot().runtime?.platforms.openai.account.revision,4);assert.ok(m.getSnapshot().supplies.claude);
 m.subscribe(()=>{});await tick();assert.equal(accountReads,2);m.dispose();
});
// S1's approved automatic read recovery now runs through the single S2 owner.
test('failed platform reads retry after ten seconds without hiding the other platform or overlapping',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const f=fixture();let active=0,max=0,reads=0,failed=true;
 f.deps.intervalMs=10000;
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.supply=()=>({status:async(platform:string)=>{reads++;active++;max=Math.max(max,active);await Promise.resolve();active--;if(failed&&platform==='openai')throw new Error('SUPPLY_READ_FAILED: HTTP 503');return {platform,checked_at:new Date().toISOString()};}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(reads,2);assert.equal(max,2);assert.match(m.getSnapshot().supplyErrors.openai?.message??'',/HTTP 503/);
 assert.ok(m.getSnapshot().supplies.claude);assert.equal(m.getSnapshot().error,null);
 t.mock.timers.tick(9999);await tick();assert.equal(reads,2);
 failed=false;t.mock.timers.tick(1);await tick();assert.equal(reads,4);assert.equal(max,2);
 assert.ok(m.getSnapshot().supplies.openai);assert.deepEqual(m.getSnapshot().supplyErrors,{});
});
test('uncertain writes invalidate late results and recover with one read after ten seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const f=fixture();f.deps.intervalMs=10000;const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 m.pause();const before=f.calls();t.mock.timers.tick(9999);await tick();assert.equal(f.calls(),before);
 t.mock.timers.tick(1);await tick();assert.equal(f.calls(),before+1);
});
test('a runtime receipt floor retains its machine code and blocks automatic reads after ten seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const f=fixture();f.deps.intervalMs=10000;const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 m.recordRuntimeReceipt(9);await m.refresh();
 const failure=m.getSnapshot().error,reads=f.calls();
 t.mock.timers.tick(10000);await tick();
 assert.deepEqual({code:failure?.code,evidence:failure?.evidence,reads:f.calls()},{code:'DESKTOP_STALE_RESULT',evidence:{actual:'1',required:'runtime revision >=9 from confirmed operation receipt'},reads});
 assert.equal(m.getSnapshot().runtime?.revision,1);
});
test('one account snapshot failure stays on that platform and leaves the other readable',async t=>{
 const f=fixture();
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string)=>{if(platform==='openai')throw new Error('ACCOUNT_OPERATION_FAILED: source_read permission_denied=true');return {platform,revision:2,issues:[]};}});
 f.deps.supply=()=>({status:async(platform:string)=>({platform,checked_at:new Date().toISOString()})});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().error,null);
 assert.match(m.getSnapshot().accountErrors.openai?.message??'',/permission_denied=true/);
 assert.equal(m.getSnapshot().accountErrors.claude,undefined);
 assert.equal(m.getSnapshot().accounts.claude?.revision,2);
});
test('device read failure stays on the device and still publishes account defaults',async t=>{
 const f=fixture();
 f.deps.device.status=async()=>{throw new Error('DEVICE_OPERATION_FAILED: GET identity HTTP 503');};
 f.deps.accounts=()=>({defaults:async()=>({platforms:[{platform:'openai'}]}),snapshot:async(platform:string)=>({platform,revision:1,issues:[]})});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().error,null);
 assert.match(m.getSnapshot().deviceError?.message??'',/HTTP 503/);
 assert.equal(m.getSnapshot().defaults?.platforms.length,1);
 assert.equal(m.getSnapshot().accounts.claude,undefined);
});
test('replacement refresh starts after the status listener returns',async t=>{
 const f=fixture();let inside=false,reads=0;
 f.deps.runtime=()=>({snapshot:async()=>{assert.equal(inside,false);reads++;return runtime();}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 const before=reads;inside=true;f.emit(ready('b'));inside=false;assert.equal(reads,before);
 await tick();assert.equal(m.getSnapshot().native.metadata?.instance,'b');assert.equal(reads,before+1);
});
test('a superseded initial status rejection cannot block a ready event',async t=>{
 const f=fixture();let reject!:(e:Error)=>void;f.deps.bridge.status=()=>new Promise((_,no)=>{reject=no;});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});f.emit(ready('a'));await tick();reject(new Error('STALE_INITIAL_STATUS_READ_REJECTED'));await tick();assert.equal(m.getSnapshot().error,null);assert.equal(m.getSnapshot().native.state,'ready');
});

test('an account receipt floor retains the failing read evidence and resets with its native instance',async t=>{
 const f=fixture();let fail=false;
 f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string)=>{if(fail&&platform==='openai')throw {code:'http_rejected',message:'GET account HTTP 503',details:{check:'account_read',observed_at:'2026-10-30T12:00:00Z',evidence:{http_status:'503',target_origin:'https://hive.example'}}};return {platform,revision:1,issues:[]};}});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 m.recordAccountReceipt('openai',9);fail=true;await m.refresh();
 assert.match(m.getSnapshot().accountErrors.openai?.message??'',/GET account HTTP 503/);
 assert.match(m.getSnapshot().accountErrors.openai?.message??'',/actual=1; required>=9/);
 assert.equal(m.getSnapshot().accountErrors.openai?.code,'http_rejected');
 assert.equal(m.getSnapshot().accountErrors.openai?.evidence.http_status,'503');
 assert.equal(m.getSnapshot().accountErrors.claude,undefined);
 fail=false;f.emit(ready('b'));await tick();assert.deepEqual(m.getSnapshot().accountErrors,{});assert.equal(m.getSnapshot().accounts.openai?.revision,1);
});

for(const slow of ['openai','claude'] as const)test('shared and independent platform facts publish before slow '+slow+' account',async t=>{
 const f=fixture();let release!:(v:any)=>void;const reads:string[]=[];
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string)=>{reads.push(platform);if(platform===slow)return new Promise(r=>release=r);return {platform,revision:2,issues:[]};}});
 f.deps.supply=()=>({status:async(platform:string)=>({platform,checked_at:new Date().toISOString()})});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().device?.state,'bound');assert.equal(m.getSnapshot().runtime?.local,'stopped');
 const fast=slow==='openai'?'claude':'openai';assert.equal(m.getSnapshot().accounts[fast]?.revision,2);assert.equal(m.getSnapshot().accountRefresh[slow]?.state,'reading');
 assert.deepEqual(reads.sort(),['claude','openai']);release({platform:slow,revision:2,issues:[]});await m.refresh();
});
test('refresh exposes only the timer actually scheduled and blocked floors never publish stale runtime',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(),m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().refresh.state,'scheduled');assert.equal(Date.parse(m.getSnapshot().refresh.nextRetryAt!),Date.now()+100000);
 const lastRuntime=m.getSnapshot().runtime,lastConfirmed=m.getSnapshot().refresh.lastConfirmedAt;const observations:any[]=[];m.subscribe(()=>observations.push(m.getSnapshot()));m.recordRuntimeReceipt(9);await m.refresh();
 assert.equal(m.getSnapshot().refresh.state,'blocked');assert.equal(m.getSnapshot().refresh.nextRetryAt,null);
 assert.ok(observations.every(s=>s.runtime===lastRuntime&&s.refresh.lastConfirmedAt===lastConfirmed),'receipt floor prevents every staged runtime publication and confirmation');
 const calls=f.calls();t.mock.timers.tick(100000);await tick();assert.equal(f.calls(),calls);
});
test('failed platform reads retain confirmed history and its real retry time',async t=>{
 const f=fixture();let failed=false;f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string)=>{if(failed&&platform==='openai')throw {code:'timeout',message:'GET account timed out'};return {platform,revision:1,issues:[]};}});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();const confirmed=m.getSnapshot().accountRefresh.openai!.lastConfirmedAt;
 failed=true;await m.refresh();assert.equal(m.getSnapshot().accounts.openai?.revision,1);assert.equal(m.getSnapshot().accountErrors.openai?.code,'timeout');assert.equal(m.getSnapshot().accountRefresh.openai!.lastConfirmedAt,confirmed);assert.equal(m.getSnapshot().accountRefresh.openai!.state,'scheduled');
});
test('diagnostic identity observations are scoped and cannot turn HTTP success into runtime ready',async t=>{
 const f=fixture();f.deps.device.context=async()=>({hive:'https://hive.example',name:'Mac',device_id:'device',owner_id:'owner',binding_revision:1});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 const now=new Date(Date.now()+1).toISOString(),report:any={instance:'a',binding_revision:1,network_revision:0,run_id:null,checks:[{id:'hive',platform:null,status:'fail',code:'device_replaced',observed_at:now,evidence:{http_status:'401',server_code:'device_replaced',path:'/api/bee/identity'}}]};
 assert.equal(typeof m.acceptDiagnosticReport,'function');m.acceptDiagnosticReport(report);assert.equal(m.getSnapshot().diagnosticFailure?.code,'device_replaced');
 for(const wrong of [{instance:'other'},{binding_revision:0},{network_revision:1},{run_id:'old'},{checks:[{...report.checks[0],code:'http_rejected',observed_at:new Date(Date.parse(now)-1).toISOString()}]}]){m.acceptDiagnosticReport({...report,...wrong});assert.equal(m.getSnapshot().diagnosticFailure?.code,'device_replaced');}
 m.acceptDiagnosticReport({...report,checks:[{...report.checks[0],status:'pass',code:'hive_identity_verified'}]});assert.equal(m.getSnapshot().runtime?.local,'stopped');assert.equal(m.getSnapshot().startup,undefined);
});

test('supply progress follows its platform request rather than another platform busy flag',async()=>{
 const {supplyProgress}=await import('../src/features/supply/useSupply.ts');
 const now=Date.now(),view={checked_at:new Date(now-31000).toISOString()};
 const state:any={views:{openai:view},errors:{},now,busy:true,operation:'read',activePlatform:'claude',supplyRefresh:{openai:{state:'scheduled',nextRetryAt:new Date(now+10000).toISOString(),lastConfirmedAt:null}}};
 assert.equal(supplyProgress(state,'openai',now),'waiting');
 state.supplyRefresh.openai={state:'blocked',nextRetryAt:null,lastConfirmedAt:null};assert.equal(supplyProgress(state,'openai',now),'blocked');
 state.supplyRefresh.openai={state:'reading',nextRetryAt:null,lastConfirmedAt:null};assert.equal(supplyProgress(state,'openai',now),'checking');
});
