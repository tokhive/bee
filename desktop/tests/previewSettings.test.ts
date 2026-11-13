import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {invoke} from '@tauri-apps/api/core';
import {createPreferencesClient} from '../src/system/preferences.ts';
import {createNotificationsClient} from '../src/system/notifications.ts';
import {installPreviewFixture} from './fixtures/bee-preview/fixture.mjs';
import {applyPreviewEvent} from './fixtures/bee-preview/control.mjs';

function control(action:string,value:string){
 const session=(window as unknown as {__beePreviewSession:string}).__beePreviewSession;
 return applyPreviewEvent({session,action,value});
}

async function preview(t:TestContext,scene='settings-general'){
 const previous=['window','location','isTauri'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{parent:{postMessage(){}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://preview.test',search:'?theme=light&locale=zh'}});
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 await installPreviewFixture(scene);
 return {preferences:createPreferencesClient(invoke),notifications:createNotificationsClient(invoke)};
}

test('actual preview preferences preserve saved content and reject a stale revision without writing',async t=>{
 const {preferences}=await preview(t);
 const initial=await preferences.read();
 const saved=await preferences.save(0,{...initial.preferences,language:'en',theme:'dark'});
 assert.equal(saved.error,null);
 assert.equal(saved.preferences.revision,1);
 assert.equal(saved.preferences.language,'en');
 assert.equal(saved.preferences.theme,'dark');
 const rejected=await preferences.save(0,{...initial.preferences,language:'zh',theme:'light'});
 assert.equal(rejected.error?.code,'PREFERENCES_REVISION_CONFLICT');
 assert.match(rejected.error!.message,/actual=1.*required=0/);
 assert.deepEqual(rejected.preferences,saved.preferences);
 assert.deepEqual(await preferences.read(),saved);
});

test('notification preference and granted system permission remain independent across later reads',async t=>{
 const {preferences,notifications}=await preview(t);
 assert.equal(await notifications.permission(),'prompt');
 assert.equal(await notifications.enable(),'granted');
 assert.equal(await notifications.permission(),'granted');
 assert.equal((await preferences.read()).preferences.notifications_enabled,false);
 const initial=await preferences.read();
 await preferences.save(0,{...initial.preferences,notifications_enabled:true});
 assert.equal(await notifications.permission(),'granted');
});

test('denied notification permission requires an external system change before it can recover',async t=>{
 const {notifications}=await preview(t);
 control('notification-permission','denied');
 assert.equal(await notifications.permission(),'denied');
 assert.equal(await notifications.enable(),'denied');
 assert.equal(await notifications.permission(),'denied');
 control('notification-permission','granted');
 assert.equal(await notifications.permission(),'granted');
 assert.throws(()=>control('notification-permission','unknown'),/PREVIEW_CONTROL_INVALID/);
 assert.equal(await notifications.permission(),'granted');
});

test('autostart registration failure preserves desired preference and only a later explicit operation registers',async t=>{
 const {preferences,notifications}=await preview(t);
 assert.deepEqual(await notifications.autostartStatus(),{desired:false,registered:false,error:null});
 control('autostart-registration','fail');
 const failed=await notifications.autostartSet(true);
 assert.equal(failed.desired,true);
 assert.equal(failed.registered,false);
 assert.equal(failed.error?.code,'AUTOSTART_REGISTER_FAILED');
 assert.match(failed.error!.message,/desired=true.*os_code=13/);
 const saved=await preferences.read();
 assert.equal(saved.preferences.autostart_desired,true);
 assert.equal(saved.preferences.revision,1);
 assert.deepEqual(await notifications.autostartStatus(),{desired:true,registered:false,error:null});
 control('autostart-registration','available');
 assert.deepEqual(await notifications.autostartStatus(),{desired:true,registered:false,error:null});
 assert.deepEqual(await notifications.autostartSet(true),{desired:true,registered:true,error:null});
 assert.equal((await preferences.read()).preferences.revision,2);
 assert.deepEqual(await notifications.autostartStatus(),{desired:true,registered:true,error:null});
});
