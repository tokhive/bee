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
test('failed supply read stops the cycle until explicit refresh and never overlaps platforms',async t=>{
 const f=fixture();let active=0,max=0,reads=0,failed=true;f.deps.intervalMs=5;
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.supply=()=>({status:async()=>{reads++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;if(failed)throw new Error('SUPPLY_READ_FAILED: HTTP 503');return {checked_at:new Date().toISOString()};}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await new Promise(r=>setTimeout(r,30));
 assert.equal(reads,1);assert.equal(max,1);assert.match(m.getSnapshot().error,/HTTP 503/);
 failed=false;await m.refresh();assert.ok(m.getSnapshot().supplies.openai);assert.equal(m.getSnapshot().error,'');
});
test('uncertain writes pause automatic observations until explicit refresh',async t=>{
 const f=fixture();f.deps.intervalMs=5;const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 m.pause();const before=f.calls();await new Promise(r=>setTimeout(r,20));assert.equal(f.calls(),before);
 await m.refresh();assert.equal(f.calls(),before+1);
});
test('one account snapshot failure stays on that platform and leaves the other readable',async t=>{
 const f=fixture();
 f.deps.device.status=async()=>({state:'bound',hive:'https://hive.example',identity:{id:'device'}});
 f.deps.accounts=()=>({defaults:async()=>({platforms:[]}),snapshot:async(platform:string)=>{if(platform==='openai')throw new Error('ACCOUNT_OPERATION_FAILED: source_read permission_denied=true');return {platform,revision:2,issues:[]};}});
 f.deps.supply=()=>({status:async(platform:string)=>({platform,checked_at:new Date().toISOString()})});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().error,'');
 assert.match(m.getSnapshot().accountErrors.openai??'',/permission_denied=true/);
 assert.equal(m.getSnapshot().accountErrors.claude,undefined);
 assert.equal(m.getSnapshot().accounts.claude?.revision,2);
});
test('device read failure stays on the device and still publishes account defaults',async t=>{
 const f=fixture();
 f.deps.device.status=async()=>{throw new Error('DEVICE_OPERATION_FAILED: GET identity HTTP 503');};
 f.deps.accounts=()=>({defaults:async()=>({platforms:[{platform:'openai'}]}),snapshot:async(platform:string)=>({platform,revision:1,issues:[]})});
 f.set({...runtime(),platforms:{openai:{account:{revision:1}},claude:{account:{revision:1}}}});
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});await tick();
 assert.equal(m.getSnapshot().error,'');
 assert.match(m.getSnapshot().deviceError,/HTTP 503/);
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
 const m=createDesktopState(f.deps);t.after(()=>m.dispose());m.subscribe(()=>{});f.emit(ready('a'));await tick();reject(new Error('STALE_INITIAL_STATUS_READ_REJECTED'));await tick();assert.equal(m.getSnapshot().error,'');assert.equal(m.getSnapshot().native.state,'ready');
});
