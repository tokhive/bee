import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopState} from '../src/system/desktopState.ts';
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
 const model=createDesktopState({bridge:{status:async()=>({state:'ready',metadata:{instance}}),onStatus:async()=>()=>{},onStartup:async(fn:any)=>{startupListener=fn;return()=>{};}} as any,device:{context:async()=>({hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:binding}),status:async()=>({state:'unbound'}),begin:async()=>{throw Error('unexpected write');},open:async()=>{throw Error('unexpected browser action');}},runtime:()=>({snapshot:async()=>hold?new Promise(resolve=>{release=resolve;}):runtime}) as any,intervalMs:100000});t.after(()=>model.dispose());model.subscribe(()=>{});await tick();const before=model.generation();
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
