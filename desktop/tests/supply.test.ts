import {normalizeFailure} from '../src/system/failures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupplyClient, decodeSupplyReply, supplyReasons } from '../src/system/supply.ts';
const binding={hive:'https://hive.example',deviceId:'device-1'};
const now=Date.now();
const good={hive:binding.hive,device_id:binding.deviceId,platform:'openai',paused:false,ready:false,reasons:['offline'],checked_at:new Date(now).toISOString()};
const reply=(supply:unknown)=>({result:{supply}});
test('supply decoder accepts explicit false, both platforms and all matching reasons',()=>{
 assert.deepEqual(decodeSupplyReply(reply(good),binding,'openai',undefined,now),good);
 for(const platform of ['openai','claude'] as const)for(const reason of supplyReasons.filter(r=>!(platform==='openai'?r.startsWith('claude_'):r.startsWith('codex_')))){
  const supply={...good,platform,paused:reason==='manually_paused',reasons:[reason]};
  assert.deepEqual(decodeSupplyReply(reply(supply),binding,platform,undefined,now),supply);
 }
 assert.equal(decodeSupplyReply(reply({...good,ready:true,reasons:[]}),binding,'openai',false,now).ready,true);
});
test('supply decoder rejects missing, null, incorrect types, owner mismatch and invariants without leaking payload',()=>{
 const invalid:unknown[]=[null,{},[],{...good,credential:'SECRET_PAYLOAD'},{...good,hive:'https://other.test'},{...good,device_id:'other-device'},{...good,platform:'claude'},{...good,paused:null},{...good,ready:'false'},{...good,reasons:null},{...good,reasons:['offline','offline']},{...good,reasons:['SECRET_PAYLOAD']},{...good,reasons:['claude_source_unavailable']},{...good,ready:true},{...good,paused:true},{...good,checked_at:'yesterday'},{...good,checked_at:new Date(now+1000).toISOString()},{...good,checked_at:'2026-02-30T00:00:00Z'}];
 for(const key of Object.keys(good)){const missing={...good} as Record<string,unknown>;delete missing[key];invalid.push(missing);}
 for(const item of invalid)assert.throws(()=>decodeSupplyReply(reply(item),binding,'openai',undefined,now),error=>error instanceof Error&&error.message.includes('SUPPLY_REPLY_INVALID')&&!error.message.includes('SECRET_PAYLOAD'));
 assert.throws(()=>decodeSupplyReply(reply(good),binding,'openai',true,now),/paused.*required=true/);
 assert.throws(()=>decodeSupplyReply(reply({...good,paused:null}),binding,'openai',undefined,now),/actual_type=null/);

 assert.throws(()=>decodeSupplyReply({result:{supply:good,error:{code:'X',message:'HTTP 503'}}},binding,'openai',undefined,now),/SUPPLY_REPLY_INVALID/);
});
test('business failures retain method and HTTP evidence; failed writes are never replayed',async()=>{
 const calls:unknown[]=[];const client=createSupplyClient(async(command,args)=>{calls.push([command,args]);return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:'PUT /api/bee/platforms/openai HTTP 503; result unconfirmed'}}};},binding);
 await assert.rejects(client.setPaused('openai',false),/PUT .* HTTP 503/);
 assert.deepEqual(calls,[['supply_set_paused',{platform:'openai',paused:false}]]);
 await assert.rejects(client.status('openai'),/HTTP 503/);assert.equal(calls.length,2);
});
test('same-platform clients serialize across replacement bindings and validate before IPC',async()=>{
 let release!:()=>void;let active=0,max=0;const calls:string[]=[];
 const invoke=async(command:string,args?:Record<string,unknown>)=>{calls.push(command);max=Math.max(max,++active);if(calls.length===1)await new Promise<void>(r=>release=r);active--;return reply({...good,platform:args?.platform,checked_at:new Date().toISOString()});};
 const first=createSupplyClient(invoke,binding),second=createSupplyClient(invoke,binding);
 const a=first.status('openai'),b=second.status('openai');await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);release();await Promise.all([a,b]);assert.equal(max,1);
 await assert.rejects(first.status('bad' as 'openai'),/platform/);await assert.rejects(first.setPaused('openai','false' as unknown as boolean),/paused/);await assert.rejects(first.setPaused('openai',undefined as unknown as boolean),/paused/);assert.equal(calls.length,2);
});

test('decoder independently enforces the platform whitelist',()=>{
 assert.throws(()=>decodeSupplyReply(reply({...good,platform:'invalid'}),binding,'invalid' as 'openai',undefined,now),/platform.*required=openai,claude/);
});

for(const [value,actualType] of [[undefined,'undefined'],[null,'null'],['false','string']] as const){
 test(`invalid paused ${actualType} reports its actual type before IPC`,async()=>{
  let calls=0;const client=createSupplyClient(async()=>{calls++;return reply(good);},binding);
  await assert.rejects(client.setPaused('openai',value as unknown as boolean),new RegExp(`request paused actual_type=${actualType}; required=boolean`));
  assert.equal(calls,0);
 });
}

test('shared supply model preserves per-platform failures and never repeats an uncertain write',async()=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 const writes:string[]=[];let failRead=false;
 const model=createSupplyModel({status:async platform=>{if(failRead&&platform==='openai')throw new Error('GET HTTP 503');return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async(platform,paused)=>{writes.push(platform);if(platform==='openai')throw new Error('PUT HTTP 503 uncertain');return {...good,platform,paused,reasons:paused?['manually_paused']:['offline'],checked_at:new Date().toISOString()};}});
 model.start();await model.read();assert.equal(model.getSnapshot().views.claude?.platform,'claude');
 await model.writeAll(true);assert.deepEqual(writes,['openai','claude']);assert.match(model.getSnapshot().errors.openai?.message??'',/PUT HTTP 503/);assert.equal(model.getSnapshot().views.claude?.paused,true);
 await model.write('openai',true);assert.deepEqual(writes,['openai','claude']);
 failRead=true;await model.read();assert.match(model.getSnapshot().errors.openai?.message??'',/GET HTTP 503/);assert.equal(model.getSnapshot().views.claude?.platform,'claude');model.stop();
});
test('pending account confirmation blocks writes in the shared supply model',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0;
 const model=createSupplyModel({status:async platform=>({...good,platform,reasons:['codex_confirmation_required'],checked_at:new Date().toISOString()}),setPaused:async()=>{writes++;return good as any;}});
 t.after(()=>model.stop());model.start();await model.read();await model.write('openai',false);assert.equal(writes,0);await model.write('openai',true);assert.equal(writes,1);model.stop();
});

test('coordinated supply consumes adopted snapshots and routes every read through the shared refresh',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let gets=0,refreshes=0,writes=0;
 const model=createSupplyModel({status:async platform=>{gets++;return {...good,platform};},setPaused:async(platform,paused)=>{writes++;return {...good,platform,paused,reasons:paused?['manually_paused']:['offline'],checked_at:new Date().toISOString()};}});
 t.after(()=>model.stop());
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()},claude:{...good,platform:'claude' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{refreshes++;model.adopt({views,error:null,busy:false});});
 model.start();model.adopt({views,error:null,busy:false});
 await model.read();assert.equal(refreshes,1);assert.equal(gets,0);
 await model.write('openai',true);assert.equal(writes,1);assert.equal(refreshes,2);assert.equal(gets,0);
 model.adopt({views,error:normalizeFailure('central GET failed: HTTP 503','supply_read'),busy:false});assert.equal(model.canWrite('claude'),false);
 model.adopt({views,error:null,busy:true});assert.equal(model.canWrite('claude'),true);
});

test('coordinated supply preserves an uncertain write until an explicit refreshed adoption',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0,refreshes=0,pauses=0;
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;throw new Error('PUT HTTP 503 uncertain');}});
 t.after(()=>model.stop());
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{refreshes++;model.adopt({views,error:null,busy:false});},()=>{pauses++;});model.start();model.adopt({views,error:null,busy:false});
 await model.write('openai',true);assert.match(model.getSnapshot().errors.openai?.message??'',/PUT HTTP 503 uncertain/);assert.equal(pauses,1);assert.equal(refreshes,0);
 model.adopt({views,error:null,busy:false});await model.write('openai',true);assert.equal(writes,1);
 await model.read();assert.equal(refreshes,1);assert.equal(model.getSnapshot().errors.openai,undefined);assert.equal(model.canWrite('openai',true),true);
});
test('a stopped supply owner cannot pause a newer coordinator when its write fails late',async()=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let rejectWrite!:(reason:Error)=>void,pauses=0;
 const model=createSupplyModel({status:async()=>good as any,setPaused:()=>new Promise((_resolve,reject)=>{rejectWrite=reject;})});
 model.setCoordinated(async()=>{},()=>{pauses++;});model.start();model.adopt({views:{openai:{...good,platform:'openai',checked_at:new Date().toISOString()}},error:null,busy:false});
 const write=model.write('openai',true);model.stop();rejectWrite(new Error('old owner write failed after replacement'));await write;
 assert.equal(pauses,0);assert.equal(model.getSnapshot().errors.openai,undefined);
});
for(const outcome of ['success','failure'])test(`a previous supply generation cannot refresh or pause its replacement after late ${outcome}`,async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let finishWrite!:()=>void,refreshes=0,pauses=0;
 const model=createSupplyModel({status:async()=>good as any,setPaused:()=>new Promise((resolve,reject)=>{finishWrite=()=>outcome==='success'?resolve(good as any):reject(new Error('old generation write failed'));})});
 t.after(()=>model.stop());
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{refreshes++;},()=>{pauses++;});model.start();model.adopt({views,error:null,busy:false});
 const write=model.write('openai',true);model.stop();model.start();model.adopt({views,error:null,busy:false});finishWrite();await write;
 assert.equal(refreshes,0);assert.equal(pauses,0);assert.equal(model.getSnapshot().errors.openai,undefined);assert.equal(model.canWrite('openai',true),true);
});
const flushSupply=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('a fresh background read keeps supply writable and one explicit write waits for it',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 let slow=false,release=()=>{},writes=0;
 const model=createSupplyModel({status:async platform=>{if(slow&&platform==='openai')await new Promise<void>(r=>release=r);return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async(platform,paused)=>{writes++;return {...good,platform,paused,reasons:paused?['manually_paused']:['offline'],checked_at:new Date().toISOString()} as any;}});
 t.after(()=>model.stop());model.start();await model.read();slow=true;const reading=model.read();
 assert.equal(model.canWrite('openai',true),true);
 const first=model.write('openai',true),duplicate=model.write('openai',true);assert.equal(model.canWrite('openai',true),false);assert.equal(writes,0);
 slow=false;release();await Promise.all([reading,first,duplicate]);assert.equal(writes,1);assert.equal(model.canWrite('openai',false),true);
});
for(const outcome of ['failed','expired','stopped'])test('a waiting supply write is cancelled when its refreshed state is '+outcome,async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});let slow=false,release=()=>{},writes=0;
 const model=createSupplyModel({status:async platform=>{if(slow&&platform==='openai'){await new Promise<void>(r=>release=r);if(outcome==='failed')throw new Error('GET HTTP 503');}return {...good,platform,checked_at:new Date(now).toISOString()};},setPaused:async()=>{writes++;return good as any;}});
 t.after(()=>model.stop());model.start();await model.read();slow=true;const reading=model.read(),writing=model.write('openai',true);
 if(outcome==='expired')t.mock.timers.tick(30001);if(outcome==='stopped')model.stop();release();await Promise.all([reading,writing]);assert.equal(writes,0);
});
test('failed supply reads retry every ten seconds and preserve the other fresh platform',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});
 const calls:string[]=[];let fail=true;
 const model=createSupplyModel({status:async platform=>{calls.push(platform);if(platform==='openai'&&fail)throw new Error('GET openai HTTP 503');return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async()=>{throw new Error('unexpected PUT');}});
 t.after(()=>model.stop());model.start();await model.read();
 assert.equal(model.getSnapshot().retryAt,now+10000);assert.equal(model.getSnapshot().operation,'idle');
 assert.equal(model.canWrite('claude',true),true);assert.equal(model.canWrite('openai',true),false);
 t.mock.timers.tick(9999);await flushSupply();assert.equal(calls.length,2);
 t.mock.timers.tick(1);await flushSupply();assert.equal(calls.length,4);assert.equal(model.getSnapshot().retryAt,now+20000);
 fail=false;t.mock.timers.tick(10000);await flushSupply();assert.equal(calls.length,6);assert.deepEqual(model.getSnapshot().errors,{});assert.equal(model.getSnapshot().retryAt,null);
});
test('supply retries are GET only after uncertain writes and slow reads never overlap',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});
 let writes=0,reads=0,release:(()=>void)|undefined;let slow=false;
 const model=createSupplyModel({status:async platform=>{reads++;if(slow)await new Promise<void>(r=>release=r);return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async()=>{writes++;throw new Error('PUT HTTP 503 uncertain');}});
 t.after(()=>model.stop());model.start();await model.read();await model.write('openai',true);assert.equal(writes,1);
 slow=true;t.mock.timers.tick(10000);await flushSupply();assert.equal(reads,3);assert.equal(model.getSnapshot().operation,'read');assert.equal(model.getSnapshot().activePlatform,'openai');
 t.mock.timers.tick(60000);void model.read();await flushSupply();assert.equal(reads,3);assert.equal(writes,1);
 slow=false;release?.();await flushSupply();assert.equal(reads,4);assert.equal(model.getSnapshot().busy,false);assert.equal(writes,1);
});
test('supply progress stays quiet for fresh background reads and expires while a request is pending',async(t)=>{
 const {createSupplyModel,supplyProgress}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});
 let release:(()=>void)|undefined,slow=false;
 const model=createSupplyModel({status:async platform=>{if(slow)await new Promise<void>(r=>release=r);return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async()=>good as any});
 t.after(()=>model.stop());model.start();await model.read();slow=true;
 t.mock.timers.tick(10000);await flushSupply();assert.equal(supplyProgress(model.getSnapshot(),'openai'),null);
 t.mock.timers.tick(20001);await flushSupply();assert.equal(supplyProgress(model.getSnapshot(),'openai'),'checking');assert.equal(model.getSnapshot().now,now+30001);assert.equal(model.canWrite('openai',true),false);
 slow=false;release?.();await flushSupply();assert.equal(supplyProgress(model.getSnapshot(),'openai'),null);
});
test('expiry triggers a read and late stopped results cannot publish or schedule retries',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});
 let reads=0,release:(()=>void)|undefined;
 const model=createSupplyModel({status:async platform=>{reads++;if(reads>2)await new Promise<void>(r=>release=r);return {...good,platform,checked_at:new Date(Date.now()-25000).toISOString()};},setPaused:async()=>good as any});
 model.start();await model.read();t.mock.timers.tick(5001);await flushSupply();assert.equal(reads,3);
 const view=model.getSnapshot().views.openai;model.stop();release?.();await flushSupply();t.mock.timers.tick(60000);await flushSupply();assert.equal(reads,3);assert.equal(model.getSnapshot().views.openai,view);assert.equal(model.getSnapshot().operation,'idle');assert.equal(model.getSnapshot().retryAt,null);
});
test('expiry does not shorten a failed read retry interval',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});let reads=0,fail=false;
 const model=createSupplyModel({status:async platform=>{reads++;if(fail&&platform==='openai')throw new Error('GET HTTP 503');return {...good,platform,checked_at:new Date(Date.now()-25000).toISOString()};},setPaused:async()=>good as any});
 t.after(()=>model.stop());model.start();await model.read();fail=true;await model.read();
 t.mock.timers.tick(5001);await flushSupply();assert.equal(reads,4);
 t.mock.timers.tick(4999);await flushSupply();assert.equal(reads,6);
});
test('restarting a stopped model waits for its old request and discards the late result',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let reads=0,release!:()=>void,active=0,maxActive=0;
 const model=createSupplyModel({status:async platform=>{reads++;maxActive=Math.max(maxActive,++active);if(reads===1)await new Promise<void>(r=>release=r);active--;return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async()=>good as any});
 t.after(()=>model.stop());model.start();const old=model.read();model.stop();model.start();const next=model.read();assert.equal(reads,1);release();await Promise.all([old,next]);assert.equal(reads,3);assert.equal(maxActive,1);assert.equal(model.getSnapshot().views.claude?.platform,'claude');
});
test('each platform expires on its own timestamp during a slow shared read',async(t)=>{
 const {createSupplyModel,supplyProgress}=await import('../src/features/supply/useSupply.ts');
 t.mock.timers.enable({apis:['setTimeout','Date'],now});let slow=false;
 const model=createSupplyModel({status:async platform=>{if(slow)await new Promise<void>(()=>{});return {...good,platform,checked_at:new Date(Date.now()-(platform==='openai'?1000:0)).toISOString()};},setPaused:async()=>good as any});
 t.after(()=>model.stop());model.start();await model.read();slow=true;
 t.mock.timers.tick(10000);await flushSupply();t.mock.timers.tick(19001);await flushSupply();assert.equal(supplyProgress(model.getSnapshot(),'openai'),'checking');assert.equal(supplyProgress(model.getSnapshot(),'claude'),null);
 t.mock.timers.tick(1000);await flushSupply();assert.equal(model.getSnapshot().now,now+30001);assert.equal(supplyProgress(model.getSnapshot(),'claude'),'checking');
});
test('first supply load is quiet and retry progress follows the platform actually being read',async(t)=>{
 const {createSupplyModel,supplyProgress}=await import('../src/features/supply/useSupply.ts');
 const releases:Array<()=>void>=[];
 const model=createSupplyModel({status:async()=>{await new Promise<void>(resolve=>releases.push(resolve));throw new Error('GET HTTP 503');},setPaused:async()=>good as any});
 t.after(()=>model.stop());model.start();const initial=model.read();
 assert.equal(supplyProgress(model.getSnapshot(),'openai'),null);assert.equal(supplyProgress(model.getSnapshot(),'claude'),null);
 releases.shift()!();await flushSupply();releases.shift()!();await initial;
 const retry=model.read();assert.equal(supplyProgress(model.getSnapshot(),'openai'),'retrying');assert.equal(supplyProgress(model.getSnapshot(),'claude'),'waiting');
 releases.shift()!();await flushSupply();assert.equal(supplyProgress(model.getSnapshot(),'openai'),'waiting');assert.equal(supplyProgress(model.getSnapshot(),'claude'),'retrying');
 releases.shift()!();await retry;
});

for(const outcome of ['changed','changed-back','runtime-stopped'])test('a waiting supply resume is cancelled after context '+outcome,async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');
 let slow=false,release=()=>{},writes=0;
 const model=createSupplyModel({status:async platform=>{if(slow&&platform==='openai')await new Promise<void>(r=>release=r);return {...good,platform,checked_at:new Date().toISOString()};},setPaused:async()=>{writes++;return good as any;}});
 t.after(()=>model.stop());model.start();model.setWriteContext({openai:'account-A:running'});await model.read();
 slow=true;const reading=model.read(),writing=model.write('openai',false);
 model.setWriteContext({openai:outcome==='runtime-stopped'?'account-A:stopped':'account-B:running'});
 if(outcome==='changed-back')model.setWriteContext({openai:'account-A:running'});
 release();await Promise.all([reading,writing]);assert.equal(writes,0);
});

test('a supply click observes central busy before the React adoption effect and cancels a changed identity',async t=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0,refreshes=0,release!:()=>void;
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 let current={views,error:null,busy:false,writeContext:{openai:'account-A'}};
 const reading=new Promise<void>(resolve=>release=resolve);
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;return good as any;}});
 t.after(()=>model.stop());model.setCoordinated(async()=>{refreshes++;await reading;},undefined,()=>current);model.start();model.adopt(current);
 current={...current,busy:true};const first=model.write('openai',false),duplicate=model.write('openai',false);
 await flushSupply();const submittedWhileReading=writes;
 current={...current,busy:false,writeContext:{openai:'account-B'}};release();await Promise.all([first,duplicate]);
 assert.equal(submittedWhileReading,0);assert.equal(writes,0);assert.ok(refreshes>0);
});

test('a queued supply click reports a rejected central read without submitting or rejecting its caller',async t=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0;
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;return good as any;}});
 t.after(()=>model.stop());model.setCoordinated(async()=>{throw new Error('DEVICE_OPERATION_FAILED: GET identity HTTP 503');});model.start();model.adopt({views,error:null,busy:true});
 await assert.doesNotReject(model.write('openai',true));assert.equal(writes,0);
 assert.match(model.getSnapshot().errors.openai?.message??'',/GET identity HTTP 503/);assert.equal(model.getSnapshot().writeBusy,false);
});

test('a successful supply PUT stays blocked after a failed readback until a fresh supply observation',async t=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0;
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;return {...views.openai,paused:true,reasons:['manually_paused']};}});
 t.after(()=>model.stop());model.setCoordinated(async()=>{throw new Error('DEVICE_OPERATION_FAILED: GET identity HTTP 503');});model.start();model.adopt({views,error:null,busy:false});
 await model.write('openai',true);assert.equal(writes,1);
 model.adopt({views,error:null,busy:false});assert.match(model.getSnapshot().errors.openai?.message??'',/GET identity HTTP 503/);assert.equal(model.canWrite('openai',true),false);
 await model.write('openai',true);assert.equal(writes,1);
 model.adopt({views:{openai:{...views.openai,paused:true,reasons:['manually_paused']}},error:null,busy:false});assert.equal(model.getSnapshot().errors.openai,undefined);assert.equal(model.canWrite('openai',false),true);
});

test('detailed supply reasons are accepted without relaxing platform or readiness invariants',()=>{
 for(const platform of ['openai','claude'] as const)for(const reason of ['account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted']){
  const supply={...good,platform,reasons:[reason]};
  assert.deepEqual(decodeSupplyReply(reply(supply),binding,platform,undefined,now),supply);
  for(const invalid of [
   {...supply,reasons:[reason,reason]}, {...supply,ready:true}, {...supply,paused:true},
   {...supply,reasons:[reason,'manually_paused']},
   {...supply,reasons:[reason,platform==='openai'?'claude_source_unavailable':'codex_source_unavailable']},
   {...supply,reasons:[reason,'unrecognized_reason']},
  ])assert.throws(()=>decodeSupplyReply(reply(invalid),binding,platform,undefined,now),/SUPPLY_REPLY_INVALID/);
 }
});

test('independent platform reads reach the transport before a slow platform completes',async()=>{
 let release!:()=>void;const invoked:string[]=[];
 const client=createSupplyClient(async(_command,args)=>{const platform=args!.platform as 'openai'|'claude';invoked.push(platform);if(platform==='openai')await new Promise<void>(resolve=>release=resolve);return reply({...good,platform,checked_at:new Date().toISOString()});},binding);
 const slow=client.status('openai'),fast=client.status('claude');await new Promise(resolve=>setImmediate(resolve));
 try{assert.deepEqual([...invoked],['openai','claude']);}finally{release();await Promise.all([slow,fast]);}
});

test('known unsent supply writes retain evidence without pausing the healthy coordinator',async t=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0,pauses=0;
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;throw {code:'REQUEST_QUEUE_TIMEOUT',message:'fixture before first byte'};}});
 t.after(()=>model.stop());const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{},()=>{pauses++;});model.start();model.adopt({views,error:null,busy:false});
 await model.write('openai',true);assert.equal(pauses,0);assert.equal(model.getSnapshot().errors.openai?.code,'REQUEST_QUEUE_TIMEOUT');
 model.adopt({views:{...views},error:{code:'BRIDGE_NOT_READY',message:'bridge failed',check:'desktop_refresh',observedAt:null,evidence:{}},busy:false});assert.equal(model.canWrite('openai',true),false);
 model.adopt({views:{...views},error:null,busy:false});assert.equal(model.canWrite('openai',true),true);assert.equal(writes,1);
});
import * as accountPresentation from '../src/features/accounts/accountPresentation.ts';

test('all supply reasons identify their actual handling object without false login or resume repairs',()=>{
 const present=(accountPresentation as any).supplyProblem;assert.equal(typeof present,'function');
 const admin=['banned','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted','model_unavailable','plan_not_configured'];
 for(const reason of admin){const p=present(reason,'openai');assert.equal(p.target,null,reason);assert.equal(p.handler,'administrator',reason);assert.ok(p.impact.length>0,reason);}
 for(const reason of ['device_draining','authorization_unavailable','capabilities_unknown','concurrency_full','rate_limited','quota_unknown','quota_exhausted','account_not_registered','not_configured','manually_paused'])assert.equal(present(reason,'claude').target,null,reason);
 assert.match(present('market_not_open','openai').summary,/Hive.*开放/);
 assert.doesNotMatch(present('not_configured','openai').summary,/市场未开放|尚未配置平台账号/);
 assert.deepEqual(present('offline','openai').target,{page:'overview',section:'connection'});
 for(const [platform,prefix]of [['openai','codex'],['claude','claude']] as const){
  assert.deepEqual(present(prefix+'_source_unavailable',platform).target,{page:'accounts',section:'source',platform});
  for(const suffix of ['confirmation_required','authorization_rejected'])assert.deepEqual(present(prefix+'_'+suffix,platform).target,{page:'accounts',section:'account',platform});
 }
});
