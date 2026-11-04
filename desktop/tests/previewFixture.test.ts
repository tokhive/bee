import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {invoke} from '@tauri-apps/api/core';
import {createSystemBridge} from '../src/system/bridge.ts';
import {onLoginReturn} from '../src/system/lifecycle.ts';
import {createDeviceClient} from '../src/system/device.ts';
import {createPreferencesClient} from '../src/system/preferences.ts';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
import {installPreviewFixture} from './fixtures/bee-preview/fixture.mjs';

async function preview(t:TestContext,scene='running'){
 const previous=['window','location','isTauri'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{parent:{postMessage(){}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://preview.test',search:''}});
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 await installPreviewFixture(scene);
 return invoke;
}

test('actual preview IPC rejects unknown commands instead of returning another domain reply',async t=>{
 const call=await preview(t);
 for(const command of ['unknown_command','update_nonexistent','runtime_nonexistent','diagnostics_nonexistent','supply_nonexistent','device_recovery_nonexistent','authorize_nonexistent']){
  await assert.rejects(()=>call(command,{platform:'openai'}),error=>error instanceof Error&&error.message.includes(command)&&error.message.includes('MOCK_COMMAND_UNKNOWN'));
 }
});

test('shared mock explicitly rejects device actions requiring a configured pairing scenario',async t=>{
 const call=await preview(t);
 installAccountFixture({accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 const device=createDeviceClient(call);
 for(const action of [()=>device.begin('https://hive.example','Fixture'),()=>device.open(),()=>device.recoveryPrepare(),()=>device.recoveryConfirm('d'.repeat(48),1,'begin_pairing')]){
  await assert.rejects(action,error=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='DEVICE_SCENARIO_REQUIRED');
 }
});

test('formal bridge and login lifecycle receive their native reply shapes from the preview',async t=>{
 const call=await preview(t);
 const bridge=createSystemBridge(),status=await bridge.status();
 const reply=await bridge.ping();
 assert.equal(reply.protocol,1);
 assert.equal(reply.instance,status.metadata!.instance);
 assert.equal(typeof reply.id,'string');
 assert.deepEqual(reply.result,{alive:true});
 assert.equal(await call('login_return_received'),false);
 (window as unknown as {loginReturned:boolean}).loginReturned=true;
 assert.equal(await call('login_return_received'),true);
 let returned=0;
 const off=await onLoginReturn(()=>returned++);
 assert.equal(returned,1);
 off();
});

test('preview appearance seeds preferences once and later reads preserve the saved theme',async t=>{
 const call=await preview(t,'settings-general'),preferences=createPreferencesClient(call);
 const initial=await preferences.read();
 assert.equal(initial.preferences.theme,'light');
 const saved=await preferences.save(initial.preferences.revision,{...initial.preferences,theme:'dark'});
 assert.equal(saved.preferences.revision,initial.preferences.revision+1);
 assert.deepEqual(await preferences.read(),saved);
});
