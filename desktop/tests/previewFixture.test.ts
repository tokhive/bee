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

test('switch target recovery never publishes the target identity to the current device route',async t=>{
 const call=await preview(t,'switch-target-recovery');
 const {createHiveSwitchClient}=await import('../src/system/hiveSwitch.ts');
 const switching=createHiveSwitchClient(call),device=createDeviceClient(call);
 const source=await device.status();const state=await switching.snapshot();
 assert.equal(state.operation?.phase,'preparing_target');
 await assert.rejects(()=>switching.target.status(),(e:any)=>e.code==='invalid_device_credential');
 const transaction=await switching.target.recoveryPrepare();await switching.target.recoveryConfirm(transaction.operation_id,transaction.revision,'begin_pairing');
 assert.equal((await switching.target.recoveryStatus()).phase,'pending');
 assert.deepEqual(await device.status(),source);
 assert.equal((await switching.snapshot()).profiles.current_profile,state.profiles.current_profile);
});

test('first launch exposes profile-required gate then accepts original device_begin and retains the original pairing',async t=>{
 const call=await preview(t,'switch-first-launch');const {createHiveSwitchClient}=await import('../src/system/hiveSwitch.ts');const switching=createHiveSwitchClient(call),device=createDeviceClient(call);
 assert.equal((await call<any>('bridge_status')).error.code,'HIVE_PROFILE_REQUIRED');assert.equal((await switching.snapshot()).profiles.current_profile,null);
 const pending=await device.begin('https://first-hive.example','First Mac');assert.equal(pending.state,'pending');
 assert.equal((await switching.snapshot()).profiles.profiles[0].origin,'https://first-hive.example');assert.deepEqual(await device.status(),pending);
});

test('switch preview keeps profile account selections across A to B to A',async t=>{
 const call=await preview(t,'switch-saved');const {createHiveSwitchClient}=await import('../src/system/hiveSwitch.ts');const switching=createHiveSwitchClient(call);
 const initial=await switching.snapshot(),first=await switching.start('https://target-hive.example','Target Mac');
 await switching.target.begin('','Target Mac');await switching.target.open();await switching.target.status();
 let state=first;for(let i=0;i<8&&state.operation?.phase!=='succeeded';i++)state=await switching.observe();
 assert.equal(state.operation?.phase,'succeeded');assert.notEqual(state.profiles.current_profile,initial.profiles.current_profile);
 assert.equal((window as any).accounts.openai.selection.state,'not_selected');
 const back=await switching.start('https://hive.example','Bee Desktop');assert.notEqual(back.operation?.id,first.operation?.id);
 state=back;for(let i=0;i<8&&state.operation?.phase!=='succeeded';i++)state=await switching.observe();
 assert.equal(state.profiles.current_profile,initial.profiles.current_profile);assert.equal(state.operation?.phase,'succeeded');
 assert.equal((window as any).accounts.openai.selection.state,'selected');assert.equal((await createDeviceClient(call).status()).hive,'https://hive.example');
});


test('switch mock public fields match the final native serialized DTO definitions',async t=>{
 const call=await preview(t,'switch-waiting');const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src-tauri/src/hive_switch.rs',import.meta.url),'utf8'),profiles=await readFile(new URL('../src-tauri/src/profiles.rs',import.meta.url),'utf8');
 const state=await call<any>('hive_switch_snapshot');
 const fields=(text:string,name:string)=>{const body=text.match(new RegExp('struct '+name+' \\{([\\s\\S]*?)\\n\\}'));assert.ok(body,name+' native struct must remain inspectable');return [...body[1].matchAll(/pub (\w+):/g)].map(([,name])=>name).sort();};
 for(const [name,value]of [['SwitchSnapshot',state],['SwitchRecord',state.operation],['SwitchLeg',state.operation.source],['Observation',state.observation],['SwitchActions',state.actions],['CurrentScope',state.current_scope],['ProfileIdentity',state.profile_identities[0]]])assert.deepEqual(Object.keys(value).sort(),fields(source,name));
 for(const [name,value]of [['ProfileIndex',state.profiles],['ProfileEntry',state.profiles.profiles[0]]])assert.deepEqual(Object.keys(value).sort(),fields(profiles,name));
});
