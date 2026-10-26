import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorizeClient,decodeAuthorizeOperation} from '../src/system/authorize.ts';
const id='a'.repeat(48);
const op={id,kind:'authorize',platform:'openai',state:'running',revision:2,error:null};
const reply=(operation:unknown)=>({instance:'current',result:{operation}});
test('official login uses fixed start/status/cancel requests and platform/revision checks',async()=>{
 const calls:unknown[]=[];let next:any=op;
 const client=createAuthorizeClient(async(command,args)=>{calls.push([command,args]);return reply(next);},'current');
 const request={platform:'openai' as const,source:{directory:null,store:'file'},expected_revision:0};
 await client.start(request);await client.status(id);await client.cancel(id);
 assert.deepEqual(calls,[['authorize_start',{request}],['authorize_status',{operationId:id}],['authorize_cancel',{operationId:id}]]);
 next={...op,revision:1};await assert.rejects(client.status(id),/revision/);
 next={...op,id:'b'.repeat(48)};await assert.rejects(client.status(id),/ID/);
 next={...op,platform:'claude'};await assert.rejects(client.start(request),/platform/);
 const count=calls.length;await assert.rejects(client.start({...request,source:{directory:'relative',store:'file'}}));await assert.rejects(client.cancel('bad'));assert.equal(calls.length,count);
});
test('official login rejects stale instance and private payload without exposing values',()=>{
 assert.throws(()=>decodeAuthorizeOperation(reply(op),'previous'),/instance/);
 for(const change of [{kind:'start'},{platform:null},{state:'PRIVATE_SECRET'},{revision:2**53},{confirmation_id:'PRIVATE_SECRET'},{error:{token:'PRIVATE_SECRET'}}]){
  assert.throws(()=>decodeAuthorizeOperation(reply({...op,...change}),'current'),e=>e instanceof Error&&!e.message.includes('PRIVATE_SECRET'));
 }
});
