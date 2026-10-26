import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRuntimeClient,decodeRuntimeSnapshot,decodeRuntimeOperation} from '../src/system/runtime.ts';
const fixture=JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8'));
const reply=(runtime:unknown)=>({instance:'current',result:{runtime}});
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
