import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationsClient,decodeAutostart,decodePermission} from '../src/system/notifications.ts';
test('OS permission decoder rejects unknown and autostart never infers registration from desire',()=>{assert.equal(decodePermission('prompt'),'prompt');assert.throws(()=>decodePermission('unknown'));assert.deepEqual(decodeAutostart({desired:true,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'query failed'}}),{desired:true,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'query failed'}});for(const bad of [{desired:true,registered:true},{desired:'true',registered:true,error:null},{desired:true,registered:'true',error:null}])assert.throws(()=>decodeAutostart(bad));});
test('permission is requested only at explicit enable and no arbitrary notification payload is exposed',async()=>{const calls:unknown[]=[];const c=createNotificationsClient(async(command,args)=>{calls.push([command,args]);if(command==='autostart_status'||command==='autostart_set')return {desired:false,registered:false,error:null};return 'denied';});await c.permission();assert.deepEqual(calls,[['notification_permission',{}]]);assert.equal(await c.enable(),'denied');await c.autostartStatus();await c.autostartSet(false);assert.deepEqual(calls[1],['notification_enable',{}]);assert.deepEqual(calls[3],['autostart_set',{enabled:false}]);});
test('delivery failure remains observable and retry is an explicit fixed action',async()=>{const calls:unknown[]=[];const c=createNotificationsClient(async(command,args)=>{calls.push([command,args]);return command==='notification_delivery_status'?{error:{code:'NOTIFICATION_SUBMIT_REJECTED',message:'native submit failed: code=7'},retryable_count:2,pending_count:1,uncertain_count:1,check_sequence:4}:{retryable_count:2};});assert.equal((await c.deliveryStatus()).error?.code,'NOTIFICATION_SUBMIT_REJECTED');await c.retry();assert.deepEqual(calls,[['notification_delivery_status',{}],['notification_retry',{}]]);});

test('delivery status strictly validates every counter and preserves authoritative progress',async()=>{
 const status={error:null,retryable_count:0,pending_count:2,uncertain_count:1,check_sequence:7};
 assert.deepEqual(await createNotificationsClient(async()=>status).deliveryStatus(),status);
 for(const field of ['retryable_count','pending_count','uncertain_count','check_sequence'])for(const invalid of [-1,1.5,'2',null,Number.MAX_SAFE_INTEGER+1]){
  await assert.rejects(()=>createNotificationsClient(async()=>({...status,[field]:invalid})).deliveryStatus(),new RegExp(field));
 }
 for(const value of [{error:null},{...status,extra:1}])await assert.rejects(()=>createNotificationsClient(async()=>value).deliveryStatus());
});
test('retry receipt distinguishes accepted failures from a zero-count no-op and rejects legacy or invalid receipts',async()=>{
 for(const count of [0,2])assert.deepEqual(await createNotificationsClient(async()=>({retryable_count:count})).retry(),{retryable_count:count});
 for(const value of [null,{}, {retryable_count:-1},{retryable_count:1.2},{retryable_count:'1'},{retryable_count:1,extra:true}])await assert.rejects(()=>createNotificationsClient(async()=>value).retry());
});

test('invalid status evidence describes the shape without printing arbitrary payloads',async()=>{
 const secret='private-input-must-not-be-rendered';
 for(const value of [secret, {error:null,retryable_count:secret,pending_count:0,uncertain_count:0,check_sequence:0}]){
  await assert.rejects(()=>createNotificationsClient(async()=>value).deliveryStatus(),error=>{
   assert.match(String(error),/OS_STATE_INVALID/);assert.match(String(error),/string/);assert.ok(!String(error).includes(secret));return true;
  });
 }
});
