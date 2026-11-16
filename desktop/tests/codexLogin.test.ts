import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeCodexLoginProgress,decodeCodexLoginOpen} from '../src/system/codexLogin.ts';
import {createAuthorizeClient} from '../src/system/authorize.ts';
import {codexLoginExamples} from './fixtures/codex-login-contract.ts';
const id='a'.repeat(48),instance='codex-login-contract-mock';
test('production progress decoder accepts the bound contract and rejects contradictory or secret fields',()=>{
 for(const value of Object.values(codexLoginExamples))if('progress'in value.result)decodeCodexLoginProgress(value,instance,id);
 const sample=codexLoginExamples.waitingWithLink;
 for(const mutate of [
  (v:any)=>v.instance='old', (v:any)=>v.result.progress.operation.id='b'.repeat(48),
  (v:any)=>v.result.progress.url='PRIVATE_LOGIN_SECRET',
  (v:any)=>v.result.progress.actions.force=true,
  (v:any)=>v.result.progress.phase='finished',
  (v:any)=>v.result.progress.stop_reason='cancelled',
  (v:any)=>v.result.progress.sequence=2**53,
  (v:any)=>v.result.progress.recheck_in_flight=true,
 ]){const value=structuredClone(sample);mutate(value);assert.throws(()=>decodeCodexLoginProgress(value,instance,id),e=>e instanceof Error&&!e.message.includes('PRIVATE_LOGIN_SECRET'));}
 assert.throws(()=>decodeCodexLoginOpen({instance,result:{open:{opened:true,error:{},progress:sample.result.progress}}},instance,id));
});
test('production client only exposes same-instance capabilities and never turns open into start',async()=>{
 const calls:string[]=[];
 let sequence=3;
 const invoke=async(command:string)=>{
  calls.push(command);
  const p={...structuredClone(codexLoginExamples.waitingWithLink.result.progress),sequence};
  return {instance,result:command==='authorize_open'?{open:{opened:true,error:null,progress:p}}:{progress:p}};
 };
 assert.equal(createAuthorizeClient(invoke,instance).progress,undefined);
 const client=createAuthorizeClient(invoke,instance,['authorize_progress','authorize_open']);
 await client.progress!(id);await client.open!(id);
 sequence=2;await assert.rejects(client.progress!(id),/SUPERSEDED/);
 assert.deepEqual(calls,['authorize_progress','authorize_open','authorize_progress']);
});
