import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {invoke} from '@tauri-apps/api/core';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
import {createRuntimeClient} from '../src/system/runtime.ts';
import {createSupplyClient} from '../src/system/supply.ts';
import {applyPreviewEvent} from './fixtures/bee-preview/control.mjs';
import {installPreviewFixture} from './fixtures/bee-preview/fixture.mjs';

async function preview(t:TestContext,scene='running'){
 const previous=['window','location','isTauri'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{parent:{postMessage(){}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://preview.test',search:''}});
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 await installPreviewFixture(scene);
 const instance=(await invoke<{metadata:{instance:string}}>('bridge_status')).metadata.instance;
 return {runtime:createRuntimeClient(invoke,instance),supply:createSupplyClient(invoke,{hive:'https://hive.example',deviceId:'dev-1'})};
}

test('bound device without accounts stays online while automatic service waits for selection',async t=>{
 const {runtime,supply}=await preview(t,'runtime-no-accounts');
 const state=await runtime.snapshot();
 assert.equal(state.local,'waiting');
 assert.equal(state.run_id,null);
 assert.equal(state.connection,'connected');
 const platform=await supply.status('openai');
 assert.equal(platform.ready,false);
 assert.ok(platform.reasons.includes('not_configured'));
 assert.ok(platform.reasons.includes('offline'));
});

test('stale start or stop and unselected resume are rejected without changing runtime facts',async t=>{
 const {runtime}=await preview(t,'stopped');
 const before=await runtime.snapshot();
 await assert.rejects(()=>runtime.start({expected_revision:before.revision-1,resume_platforms:[]}),/revision/);
 await assert.rejects(()=>runtime.start({expected_revision:before.revision,resume_platforms:['claude']}),/unselected platform=claude/);
 await assert.rejects(()=>runtime.stop(before.revision-1),/revision/);
 const after=await runtime.snapshot();
 assert.equal(after.revision,before.revision);
 assert.equal(after.local,before.local);
 assert.equal(after.operation,null);
});

test('contribution start preserves pause; resume and pause keep runtime supply and run identity consistent',async t=>{
 const {runtime,supply}=await preview(t,'stopped');
 const before=await runtime.snapshot();
 await runtime.start({expected_revision:before.revision,resume_platforms:[]});
 const started=await runtime.snapshot();
 assert.equal(started.local,'running');
 assert.equal(started.connection,'connected');
 assert.ok(started.run_id);
 assert.equal((await supply.status('openai')).paused,true);
 const resumed=await supply.setPaused('openai',false);
 assert.equal(resumed.ready,true);
 const runtimeSupply=(await runtime.snapshot()).platforms.openai.supply;
 assert.equal(runtimeSupply?.paused,resumed.paused);
 assert.equal(runtimeSupply?.ready,resumed.ready);
 assert.deepEqual(runtimeSupply?.reasons,resumed.reasons);
 await supply.setPaused('openai',true);
 const paused=await runtime.snapshot();
 assert.equal(paused.run_id,started.run_id);
 assert.equal(paused.local,'running');
 assert.equal(paused.platforms.openai.supply?.paused,true);
 await runtime.stop(paused.revision);
 const stopped=await runtime.snapshot();
 assert.equal(stopped.local,'stopped');
 assert.equal(stopped.connection,'connected');
 assert.equal(stopped.run_id,null);
 assert.equal((await supply.status('openai')).paused,true);
 assert.equal(stopped.stop_receipt?.workers_stopped,true);
});


test('the shared preview network control revokes ready supply and restores only confirmed current facts',async t=>{
 const {runtime,supply}=await preview(t);
 const event=(value:string)=>applyPreviewEvent({session:(window as any).__beePreviewSession,action:'runtime-connection',value});
 const initial=await runtime.snapshot();
 assert.equal((await supply.status('openai')).ready,true);
 event('offline');
 const disconnected=await runtime.snapshot();
 assert.equal(disconnected.connection,'reconnecting');
 assert.equal(disconnected.connection_detail?.retry,'scheduled');
 assert.equal(disconnected.run_id,initial.run_id);
 assert.equal(disconnected.platforms.openai.supply,null);
 await assert.rejects(()=>supply.status('openai'),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='SUPPLY_OPERATION_FAILED'&&'message'in error&&String(error.message).includes('503'));
 event('online');
 assert.equal((await runtime.snapshot()).connection,'connected');
 assert.equal((await supply.status('openai')).ready,true);
 for(const value of ['connecting','rejected','occupied']){
  event(value);
  const state=await runtime.snapshot();
  assert.equal(state.connection,value);
  assert.equal(state.platforms.openai.supply,null);
  assert.equal((await supply.status('openai')).ready,false);
  if(value!=='connecting')assert.equal(state.connection_detail?.retry,'halted');
 }
 assert.equal((window as any).calls.filter((c:any)=>['runtime_start','runtime_stop','supply_set_paused'].includes(c.command)).length,0);
});

test('unknown start receipt is reconciled through the original operation without a second write',async t=>{
 const {runtime}=await preview(t,'stopped');
 const before=await runtime.snapshot();
 applyPreviewEvent({session:(window as any).__beePreviewSession,action:'runtime-write-result',value:'unknown-next'});
 await assert.rejects(()=>runtime.start({expected_revision:before.revision,resume_platforms:[]}),/result=unconfirmed/);
 const observed=await runtime.snapshot();
 assert.equal(observed.local,'running');
 assert.equal(observed.operation?.kind,'start');
 assert.equal(observed.operation?.state,'succeeded');
 const reconciled=await runtime.snapshot();
 assert.equal(reconciled.operation?.id,observed.operation?.id);
 assert.equal((window as any).calls.filter((c:any)=>c.command==='runtime_start').length,1);
});

test('a second start, changed identity resume and disconnected resume preserve the running service and pause',async t=>{
 const {runtime,supply}=await preview(t,'account-change');
 await supply.setPaused('openai',true);
 const before=await runtime.snapshot();
 assert.equal(before.local,'running');
 await assert.rejects(()=>runtime.start({expected_revision:before.revision,resume_platforms:[]}),/local=running/);
 await assert.rejects(()=>supply.setPaused('openai',false),/account confirmation required/);
 const after=await runtime.snapshot();
 assert.equal(after.local,before.local);
 assert.equal(after.revision,before.revision);
 assert.equal(after.run_id,before.run_id);
 assert.equal((await supply.status('openai')).paused,true);
 applyPreviewEvent({session:(window as any).__beePreviewSession,action:'runtime-connection',value:'offline'});
 const disconnected=await runtime.snapshot();
 await assert.rejects(()=>supply.setPaused('openai',false),/required=running connected selected/);
 const unchanged=await runtime.snapshot();
 for(const key of ['local','connection','revision','run_id','operation'] as const)assert.deepEqual(unchanged[key],disconnected[key]);
 assert.equal((window as any).paused.openai,true);
});


test('shared account fixture applies the same runtime admission, idle presence, and unknown receipt contract',async t=>{
 await preview(t);
 const account=accountFixture('openai') as any;
 account.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};
 installAccountFixture({runtimeEnabled:true,accounts:{openai:account,claude:accountFixture('claude')}});
 const instance=(await invoke<{metadata:{instance:string}}>('bridge_status')).metadata.instance;
 const runtime=createRuntimeClient(invoke,instance),supply=createSupplyClient(invoke,{hive:'https://hive.example',deviceId:'dev-1'});
 const idle=await runtime.snapshot();
 assert.equal(idle.connection,'connected');
 await assert.rejects(()=>runtime.start({expected_revision:idle.revision+1,resume_platforms:[]}),/revision/);
 assert.equal((await runtime.snapshot()).revision,idle.revision);
 await supply.setPaused('openai',true);
 applyPreviewEvent({session:(window as any).__beePreviewSession,action:'runtime-write-result',value:'unknown-next'});
 await assert.rejects(()=>runtime.start({expected_revision:idle.revision,resume_platforms:[]}),/result=unconfirmed/);
 const started=await runtime.snapshot();
 assert.equal(started.local,'running');
 assert.equal((await supply.status('openai')).paused,true);
 assert.equal((window as any).calls.filter((c:any)=>c.command==='runtime_start').length,2);
 await runtime.stop(started.revision);
 const stopped=await runtime.snapshot();
 assert.equal(stopped.local,'stopped');
 assert.equal(stopped.connection,'connected');
 await assert.rejects(()=>supply.setPaused('openai',false),/resume blocked/);
});

test('resuming a platform only removes its manual pause and retains other admission conditions',async t=>{
 const {runtime,supply}=await preview(t,'supply-blocked');
 const initial=await runtime.snapshot();
 await supply.setPaused('openai',true);
 const resumed=await supply.setPaused('openai',false);
 assert.equal(resumed.paused,false);
 assert.equal(resumed.ready,false);
 assert.deepEqual(resumed.reasons,['authorization_unavailable','quota_unknown','plan_not_configured']);
 assert.equal((await runtime.snapshot()).run_id,initial.run_id);
});

test('the disconnected daily scene preserves the running process and schedules reconnect without claiming ready',async t=>{
 const {runtime,supply}=await preview(t,'runtime-offline');
 const state=await runtime.snapshot();
 assert.equal(state.local,'running');
 assert.equal(state.connection,'disconnected');
 assert.equal(state.connection_detail?.retry,'scheduled');
 assert.equal(state.connection_detail?.failure?.code,'connection_closed');
 assert.equal(state.platforms.openai.supply,null);
 await assert.rejects(()=>supply.status('openai'),/503/);
});
