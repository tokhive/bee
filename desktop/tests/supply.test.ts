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
test('clients serialize even across replacement bindings and validate before IPC',async()=>{
 let release!:()=>void;let active=0,max=0;const calls:string[]=[];
 const invoke=async(command:string,args?:Record<string,unknown>)=>{calls.push(command);max=Math.max(max,++active);if(calls.length===1)await new Promise<void>(r=>release=r);active--;return reply({...good,platform:args?.platform,checked_at:new Date().toISOString()});};
 const first=createSupplyClient(invoke,binding),second=createSupplyClient(invoke,binding);
 const a=first.status('openai'),b=second.status('claude');await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);release();await Promise.all([a,b]);assert.equal(max,1);
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
 await model.writeAll(true);assert.deepEqual(writes,['openai','claude']);assert.match(model.getSnapshot().errors.openai??'',/PUT HTTP 503/);assert.equal(model.getSnapshot().views.claude?.paused,true);
 await model.write('openai',true);assert.deepEqual(writes,['openai','claude']);
 failRead=true;await model.read();assert.match(model.getSnapshot().errors.openai??'',/GET HTTP 503/);assert.equal(model.getSnapshot().views.claude?.platform,'claude');model.stop();
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
 model.setCoordinated(async()=>{refreshes++;model.adopt({views,error:'',busy:false});});
 model.start();model.adopt({views,error:'',busy:false});
 await model.read();assert.equal(refreshes,1);assert.equal(gets,0);
 await model.write('openai',true);assert.equal(writes,1);assert.equal(refreshes,2);assert.equal(gets,0);
 model.adopt({views,error:'central GET failed: HTTP 503',busy:false});assert.equal(model.canWrite('claude'),false);
 model.adopt({views,error:'',busy:true});assert.equal(model.canWrite('claude'),false);
});

test('coordinated supply preserves an uncertain write until an explicit refreshed adoption',async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let writes=0,refreshes=0,pauses=0;
 const model=createSupplyModel({status:async()=>{throw new Error('unexpected independent GET');},setPaused:async()=>{writes++;throw new Error('PUT HTTP 503 uncertain');}});
 t.after(()=>model.stop());
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{refreshes++;model.adopt({views,error:'',busy:false});},()=>{pauses++;});model.start();model.adopt({views,error:'',busy:false});
 await model.write('openai',true);assert.match(model.getSnapshot().errors.openai??'',/PUT HTTP 503 uncertain/);assert.equal(pauses,1);assert.equal(refreshes,0);
 model.adopt({views,error:'',busy:false});await model.write('openai',true);assert.equal(writes,1);
 await model.read();assert.equal(refreshes,1);assert.equal(model.getSnapshot().errors.openai,undefined);assert.equal(model.canWrite('openai',true),true);
});
test('a stopped supply owner cannot pause a newer coordinator when its write fails late',async()=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let rejectWrite!:(reason:Error)=>void,pauses=0;
 const model=createSupplyModel({status:async()=>good as any,setPaused:()=>new Promise((_resolve,reject)=>{rejectWrite=reject;})});
 model.setCoordinated(async()=>{},()=>{pauses++;});model.start();model.adopt({views:{openai:{...good,platform:'openai',checked_at:new Date().toISOString()}},error:'',busy:false});
 const write=model.write('openai',true);model.stop();rejectWrite(new Error('old owner write failed after replacement'));await write;
 assert.equal(pauses,0);assert.equal(model.getSnapshot().errors.openai,undefined);
});
for(const outcome of ['success','failure'])test(`a previous supply generation cannot refresh or pause its replacement after late ${outcome}`,async(t)=>{
 const {createSupplyModel}=await import('../src/features/supply/useSupply.ts');let finishWrite!:()=>void,refreshes=0,pauses=0;
 const model=createSupplyModel({status:async()=>good as any,setPaused:()=>new Promise((resolve,reject)=>{finishWrite=()=>outcome==='success'?resolve(good as any):reject(new Error('old generation write failed'));})});
 t.after(()=>model.stop());
 const views={openai:{...good,platform:'openai' as const,checked_at:new Date().toISOString()}};
 model.setCoordinated(async()=>{refreshes++;},()=>{pauses++;});model.start();model.adopt({views,error:'',busy:false});
 const write=model.write('openai',true);model.stop();model.start();model.adopt({views,error:'',busy:false});finishWrite();await write;
 assert.equal(refreshes,0);assert.equal(pauses,0);assert.equal(model.getSnapshot().errors.openai,undefined);assert.equal(model.canWrite('openai',true),true);
});
