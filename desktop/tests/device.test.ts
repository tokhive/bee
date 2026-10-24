import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceClient, decodeDeviceReply } from '../src/system/device.ts';

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
test('native device client uses fixed commands and no frontend config path', async () => {
 const calls:unknown[]=[];
 const client=createDeviceClient(async (command,args)=>{calls.push([command,args]);return {result:{device:{state:'unbound'}}};});
 await client.status();await client.begin('https://hive.example','Mac');await client.open();
 assert.deepEqual(calls,[['device_status',undefined],['device_begin',{hive:'https://hive.example',name:'Mac'}],['device_open',undefined]]);
});
