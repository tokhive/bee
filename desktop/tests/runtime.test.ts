import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRuntimeClient,decodeRuntimeSnapshot,decodeRuntimeOperation} from '../src/system/runtime.ts';
const fixture=JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8'));
const reply=(runtime:unknown)=>({instance:'current',result:{runtime}});
test('runtime decodes zero-account waiting without presenting a platform as ready',()=>{
 const waiting={...fixture.snapshot,local:'waiting',connection:'connected'};
 const view=decodeRuntimeSnapshot(reply(waiting),'current');
 assert.equal(view.local,'waiting');
 assert.equal(view.run_id,null);
 for(const platform of ['openai','claude'] as const){
  assert.equal(view.platforms[platform].account.selection.state,'not_selected');
  assert.equal(view.platforms[platform].supply,null);
 }
});
test('runtime uses the shared Go/Rust contract and preserves absent supply',()=>{
 assert.deepEqual(decodeRuntimeSnapshot(reply(fixture.snapshot),'current'),fixture.snapshot);
 assert.deepEqual(decodeRuntimeOperation({instance:'current',result:{operation:fixture.operation}},'current'),fixture.operation);
});
test('runtime rejects stale instance, unknown states and unsafe revisions without echoing payload',()=>{
 for(const mutate of [(v:any)=>v.local='SECRET_PAYLOAD',(v:any)=>v.revision=2**53,(v:any)=>v.run_id='SECRET_PAYLOAD',(v:any)=>delete v.stop_receipt,(v:any)=>v.platforms.openai.account.platform='claude',(v:any)=>v.platforms.openai.supply={},(v:any)=>v.operation={...fixture.operation,confirmation_id:'SECRET_PAYLOAD'}]){
  const bad=structuredClone(fixture.snapshot);mutate(bad);assert.throws(()=>decodeRuntimeSnapshot(reply(bad),'current'),e=>e instanceof Error&&!e.message.includes('SECRET_PAYLOAD'));
 }
 assert.throws(()=>decodeRuntimeSnapshot(reply(fixture.snapshot),'previous'),/instance/);
});
test('runtime client sends only fixed typed commands and rejects older snapshots',async()=>{
 const calls:unknown[]=[];let revision=3;
 const client=createRuntimeClient(async(command,args)=>{calls.push([command,args]);return command==='runtime_snapshot'?reply({...fixture.snapshot,revision}):{instance:'current',result:{operation:{...fixture.operation,kind:command==='runtime_start'?'start':'stop',revision:command==='runtime_start'?4:5}}};},'current');
 await client.snapshot();revision=2;await assert.rejects(client.snapshot(),/revision/);
 await client.start({expected_revision:3,resume_platforms:['openai']});await client.stop(3);
 assert.deepEqual(calls.slice(2),[['runtime_start',{request:{expected_revision:3,resume_platforms:['openai']}}],['runtime_stop',{expectedRevision:3}]]);
 await assert.rejects(client.start({expected_revision:3,resume_platforms:['openai','openai']}),/platform/);
});

test('runtime operation receipts advance the same revision gate as snapshots',async()=>{
 let next:any=reply({...fixture.snapshot,revision:1});
 const client=createRuntimeClient(async()=>next,'current');
 await client.snapshot();
 next={instance:'current',result:{operation:{...fixture.operation,revision:9}}};
 await client.start({expected_revision:1,resume_platforms:[]});
 next=reply({...fixture.snapshot,revision:2});
 await assert.rejects(client.snapshot(),/revision/);
 next=reply({...fixture.snapshot,revision:10});await client.snapshot();
 next={instance:'current',result:{operation:{...fixture.operation,kind:'stop',revision:9}}};
 await assert.rejects(client.stop(10),/revision/);
});

test('runtime requires an explicit nullable connection detail',()=>{
 const missing=structuredClone(fixture.snapshot);delete missing.connection_detail;
 assert.throws(()=>decodeRuntimeSnapshot(reply(missing),'current'),/missing/);
 const explicit={...fixture.snapshot,connection_detail:null};
 assert.deepEqual(decodeRuntimeSnapshot(reply(explicit),'current'),explicit);
});
test('legacy stop conversion exposes progress and requires strict platform-bound recovery evidence',()=>{
 const view:any={...fixture.snapshot,legacy_stop:{phase:'reconciling',platforms:['openai'],error:null,can_recheck:true}};
 assert.deepEqual(decodeRuntimeSnapshot(reply(view),'current').legacy_stop,view.legacy_stop);
 for(const mutate of [(v:any)=>delete v.legacy_stop,(v:any)=>v.legacy_stop.phase='unknown',(v:any)=>v.legacy_stop.platforms=['openai','openai'],(v:any)=>v.legacy_stop.platforms=['unknown'],(v:any)=>v.legacy_stop.can_recheck=null,(v:any)=>v.legacy_stop.error={code:'blocked',check:'upgrade',platform:'unknown',message:'blocked',evidence:{token:'SECRET_PAYLOAD'}},(v:any)=>v.legacy_stop.token='SECRET_PAYLOAD']){
  const bad=structuredClone(view);mutate(bad);assert.throws(()=>decodeRuntimeSnapshot(reply(bad),'current'),e=>e instanceof Error&&!e.message.includes('SECRET_PAYLOAD'));
 }
});

const failure={code:'dns_failed',stage:'connect',occurred_at:'2026-10-26T00:00:00Z',message:'lookup hive.test: no such host',evidence:{target_origin:'https://hive.test',path:'/api/bee/agent'}};
const detail={failure,retry:'scheduled',next_retry_at:'2099-01-01T00:00:00Z'};
test('runtime accepts observed failures and actual scheduled retry times',()=>{
 for(const code of ['dns_failed','tls_failed','connection_refused','timeout','http_rejected','connection_closed','synchronization_failed','ownership_unconfirmed','unknown_failure'])
  for(const stage of ['connect','heartbeat','synchronize'])
   assert.equal(decodeRuntimeSnapshot(reply({...fixture.snapshot,connection_detail:{...detail,failure:{...failure,code,stage}}}),'current').connection_detail?.failure?.code,code);
 for(const retry of ['idle','attempting','halted'])assert.equal(decodeRuntimeSnapshot(reply({...fixture.snapshot,connection_detail:{failure:null,retry,next_retry_at:null}}),'current').connection_detail?.retry,retry);
 assert.equal(decodeRuntimeSnapshot(reply({...fixture.snapshot,connection_detail:{...detail,next_retry_at:'2026-10-26T00:00:00Z'}}),'current').connection_detail?.retry,'scheduled');
});
test('runtime rejects malformed or unsafe connection details',()=>{
 for(const bad of [undefined,{}, {...detail,extra:true},{...detail,retry:'waiting'},{...detail,next_retry_at:null},{...detail,retry:'idle'}, {...detail,next_retry_at:'2026-02-30T00:00:00Z'},
 {...detail,failure:{...failure,code:'guessed'}},{...detail,failure:{...failure,stage:'proxy'}},{...detail,failure:{...failure,occurred_at:'2099-01-01T00:00:00Z'}},
 {...detail,failure:{...failure,message:'x'.repeat(32769)}},{...detail,failure:{...failure,evidence:{authorization:'secret'}}},{...detail,failure:{...failure,evidence:{http_status:401}}},
 {...detail,failure:{...failure,evidence:{target_origin:'https://user:secret@hive.test/?token=secret'}}}, {...detail,failure:{...failure,evidence:{path:'/api/bee/agent?token=secret'}}},
 {...detail,failure:{...failure,evidence:{response_body:'x'.repeat(32769)}}}, {...detail,failure:{...failure,evidence:{http_status:'600'}}}, {...detail,failure:{...failure,evidence:{owned_session:'yes'}}},
 {...detail,failure:{...failure,evidence:{consecutive_conflicts:'-1'}}}, {...detail,failure:{...failure,evidence:{remote_code:'unsafe code'}}}, {...detail,failure:{...failure,evidence:null}},
 {...detail,failure:{...failure,message:5}}, {...detail,failure:{...failure,extra:true}}]){
 const snapshot={...fixture.snapshot,connection_detail:bad};if(bad===undefined)delete snapshot.connection_detail;
 assert.throws(()=>decodeRuntimeSnapshot(reply(snapshot),'current'),/RUNTIME_REPLY_INVALID/);
 }
});

test('runtime connection origin rejects lookalike loopback domains',()=>{
 assert.throws(()=>decodeRuntimeSnapshot(reply({...fixture.snapshot,connection_detail:{...detail,failure:{...failure,evidence:{target_origin:'http://127.evil.example'}}}}),'current'),/origin/);
});

const originFixture=JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/connection-origin-contract.json',import.meta.url),'utf8'));
for(const sample of originFixture.accepted){
 test(`runtime consumes the actual Go connection origin ${sample.hive}`,()=>{
  const snapshot={...fixture.snapshot,connection_detail:sample.connection_detail};
  assert.deepEqual(decodeRuntimeSnapshot(reply(snapshot),'current'),snapshot);
 });
}
test('runtime rejects unsafe original origin structures and non-loopback HTTP hosts',()=>{
 for(const origin of originFixture.rejected){
  const d={...detail,failure:{...failure,evidence:{target_origin:origin}}};
  assert.throws(()=>decodeRuntimeSnapshot(reply({...fixture.snapshot,connection_detail:d}),'current'),/origin/,origin);
 }
});
