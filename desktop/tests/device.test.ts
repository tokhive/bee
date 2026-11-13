import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceClient, decodeDeviceReply, decodeDeviceContext } from '../src/system/device.ts';
import {readFileSync} from 'node:fs';

test('saved context uses the shared Go origin contract and rejects unsafe or incomplete records',()=>{
 const context={hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:1};
 const origins=JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/connection-origin-contract.json',import.meta.url),'utf8'));
 for(const {hive} of origins.accepted)assert.equal(decodeDeviceContext({result:{context:{...context,hive}}}).hive,hive);
 for(const hive of origins.rejected)assert.throws(()=>decodeDeviceContext({result:{context:{...context,hive}}}));
 for(const value of [{...context,binding_revision:0},{...context,binding_revision:Number.MAX_SAFE_INTEGER+1},{...context,device_id:null},{...context,credential:'SECRET'},{...context,name:'bad\nname'},Object.fromEntries(Object.entries(context).filter(([key])=>key!=='owner_id'))])assert.throws(()=>decodeDeviceContext({result:{context:value}}));
});

test('device replies only expose validated public binding data', () => {
 const view = {state:'pending',hive:'https://hive.example',name:'Mac',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',user_code:'ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString(),poll_interval_seconds:2};
 assert.equal(decodeDeviceReply({result:{device:view}}).state,'pending');
 for(const invalid of [{...view,credential:'secret'}, {...view,verification_url:'https://other.example/devices/pair?code=ABCD-EFGH'}, {state:'bound'}, {...view,state:'unexpected'}]) {
  assert.throws(()=>decodeDeviceReply({result:{device:invalid}}));
 }
});
test('business rejection preserves operation evidence', () => {
 assert.throws(()=>decodeDeviceReply({result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET /api/bee/identity HTTP 503'}}}),/HTTP 503/);
});
test('device rejection retains structured failure before binding validation',()=>{
 const error={code:'device_replaced',message:'GET identity HTTP 401',details:{check:'device_identity',observed_at:new Date().toISOString(),evidence:{target_origin:'https://hive.example',path:'/api/bee/identity',http_status:'401',remote_code:'device_replaced'}}};
 assert.throws(()=>decodeDeviceReply({result:{error}}),cause=>{assert.equal((cause as any).code,error.code);assert.equal((cause as any).message,error.message);assert.deepEqual((cause as any).details,error.details);return true;});
});
test('device error details reject unknown fields and invalid observations',()=>{
 for(const details of [{check:'device_identity',observed_at:'2026-02-30T00:00:00Z',evidence:{}},{check:'device_identity',observed_at:new Date().toISOString(),evidence:{credential:'SECRET'}},{check:'device_identity',observed_at:new Date().toISOString(),evidence:{},extra:true}])assert.throws(()=>decodeDeviceReply({result:{error:{code:'http_rejected',message:'HTTP 503',details}}}),/DEVICE_REPLY_INVALID/);
});
test('native device client uses fixed commands and no frontend config path', async () => {
 const calls:unknown[]=[];
 const client=createDeviceClient(async (command,args)=>{calls.push([command,args]);return {result:{device:{state:'unbound'}}};});
 await client.status();await client.begin('https://hive.example','Mac');await client.open();
 assert.deepEqual(calls,[['device_status',undefined],['device_begin',{hive:'https://hive.example',name:'Mac'}],['device_open',undefined]]);
});


test('native context failures retain only a validated observed binding revision',async()=>{
 for(const code of ['DEVICE_CONTEXT_UNCONFIGURED','DEVICE_CONTEXT_INVALID']) {
  const state=await createDeviceClient(async()=>({result:{error:{code,message:'saved record rejected'},binding_revision:7}})).context!();
  assert.equal(state.binding_revision,7);assert.equal((state as any).failure.code,code);
 }
 for(const result of [{error:{code:'DEVICE_CONTEXT_INVALID',message:'bad'},binding_revision:0},{error:{code:'DEVICE_CONTEXT_INVALID',message:'bad'},binding_revision:1,context:{}},{error:{code:'DEVICE_CONTEXT_INVALID',message:'bad'},binding_revision:Number.MAX_SAFE_INTEGER+1}])await assert.rejects(createDeviceClient(async()=>({result})).context!());
 await assert.rejects(createDeviceClient(async()=>({result:{error:{code:'DEVICE_CONTEXT_FAILED',message:'session ownership unavailable'}}})).context!());
});

test('DeviceRecovery client provides explicit prepare confirm and status operations',async()=>{
 const client=createDeviceClient(async()=>({result:{device:{state:'unbound'}}}));
 for(const method of ['recoveryPrepare','recoveryConfirm','recoveryStatus','recoveryOpen'])assert.equal(typeof (client as any)[method],'function',method);
});

test('DeviceRecovery strict public contract rejects secrets missing fields and conflicting URL',async()=>{
 const mod=await import('../src/system/device.ts');
 const decode=(mod as any).decodeDeviceRecoveryReply;
 assert.equal(typeof decode,'function');
 const base={operation_id:'a'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:{id:'old',name:'Mac',owner_id:'owner',owner_email:'a@example.test'},new_identity:null,pairing:null,failure:null};
 assert.deepEqual(decode({result:{recovery:base}}),base);
 for(const value of [{...base,credential:'secret'},{...base,revision:-1},{...base,phase:'invented'},{...base,new_identity:{...base.old_identity,credential:'secret'}},{...base,pairing:{code:'ABCD-EFGH',verification_url:'https://other.example/wrong?code=ABCD-EFGH',expires_at:new Date().toISOString()}},Object.fromEntries(Object.entries(base).filter(([k])=>k!=='failure'))])assert.throws(()=>decode({result:{recovery:value}}));
 const calls:any[]=[];const client=createDeviceClient(async(command,args)=>{calls.push([command,args]);return {result:{recovery:base}}});
 await client.recoveryPrepare();await client.recoveryConfirm(base.operation_id,1,'begin_pairing');await client.recoveryStatus();await client.recoveryOpen();
 assert.deepEqual(calls,[['device_recovery_prepare',undefined],['device_recovery_confirm',{operationId:base.operation_id,expectedRevision:1,decision:'begin_pairing'}],['device_recovery_status',undefined],['device_open',undefined]]);
});

for(const decision of ['begin_pairing','adopt_owner','renew_expired'] as const)test(`DeviceRecovery ${decision} uses Tauri camelCase arguments`,async()=>{
 const recovery={operation_id:'a'.repeat(48),revision:7,phase:'awaiting_confirmation',old_identity:null,new_identity:null,pairing:null,failure:null};
 const client=createDeviceClient(async(command,args)=>{
  assert.equal(command,'device_recovery_confirm');
  assert.deepEqual(args,{operationId:recovery.operation_id,expectedRevision:recovery.revision,decision});
  return {result:{recovery}};
 });
 assert.deepEqual(await client.recoveryConfirm(recovery.operation_id,recovery.revision,decision),recovery);
});

test('DeviceRecovery initial pairing reports the same public transaction with consistent state',async()=>{
 const recovery={operation_id:'a'.repeat(48),revision:3,phase:'creation_unknown',old_identity:null,new_identity:null,pairing:null,failure:null};
 assert.equal(decodeDeviceReply({result:{device:{state:'pairing',hive:'https://hive.example',name:'Mac',recovery}}}).recovery?.phase,'creation_unknown');
 for(const device of [{state:'pairing',hive:'https://hive.example',name:'Mac'},{state:'bound',hive:'https://hive.example',name:'Mac',identity:{id:'d',name:'Mac',owner_id:'o',owner_email:'a@b.test'},recovery},{state:'pairing',hive:'https://hive.example',name:'Mac',recovery:{...recovery,old_identity:{id:'old',name:'Mac',owner_id:'o',owner_email:'a@b.test'}}}])assert.throws(()=>decodeDeviceReply({result:{device}}));
});
