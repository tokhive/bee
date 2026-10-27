import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreferencesClient, decodePreferences, defaultPreferences, validateProxy} from '../src/system/preferences.ts';

test('native preferences defaults and strict public schema exclude demo state and secrets',()=>{
 const prefs=defaultPreferences();
 assert.equal(prefs.language,'system');assert.equal(prefs.theme,'system');
 assert.equal(prefs.notifications_enabled,false);assert.equal(prefs.autostart_desired,false);
 assert.deepEqual(decodePreferences({preferences:prefs,error:null}).preferences,prefs);
 for(const mutate of [(p:any)=>p.token='SECRET_MARKER',(p:any)=>p.version=2,(p:any)=>p.revision=2**53,(p:any)=>p.theme='secret',(p:any)=>p.language=['en'],(p:any)=>p.theme=['dark'],(p:any)=>p.proxies=[{origin:'https://hive.example/path',device_scope:null,connect_proxy:''}],(p:any)=>p.proxies=[{origin:'http://remote.example',device_scope:null,connect_proxy:''}]]){
  const bad=structuredClone(prefs);mutate(bad);
  assert.throws(()=>decodePreferences({preferences:bad,error:null}), e=>e instanceof Error&&!e.message.includes('SECRET_MARKER'));
 }
 for(const origin of ['https://user@hive.example','https://u:p@hive.example'])assert.throws(()=>decodePreferences({preferences:{...prefs,proxies:[{origin,device_scope:null,connect_proxy:''}]},error:null}));
});
test('proxy validation accepts only explicit loopback IP HTTP with port and no credentials',()=>{
 for(const proxy of ['', 'http://127.0.0.1:7890','http://[::1]:7890'])assert.equal(validateProxy(proxy),proxy);
 for(const proxy of ['http://localhost:7890','http://127.0.0.1','http://u:p@127.0.0.1:7890','socks5://127.0.0.1:7890','http://192.168.1.1:7890','http://127.0.0.1:0','http://127.0.0.1:7890/path','http://127.0.0.1:7890?q=1','http://127.1:7890'])assert.throws(()=>validateProxy(proxy));
});
test('native preferences client sends revisioned commands and preserves failure snapshot',async()=>{
 const calls:unknown[]=[];let next:any={preferences:defaultPreferences(),error:null};
 const client=createPreferencesClient(async(command,args)=>{calls.push([command,args]);return next;});
 await client.read();
 next={preferences:{...defaultPreferences(),revision:1,language:'en'},error:null};
 const saved=await client.save(0,{...defaultPreferences(),language:'en'});
 assert.equal(saved.preferences.revision,1);
 next={preferences:saved.preferences,error:{code:'PREFERENCES_REVISION_CONFLICT',message:'revision actual=1 required=0'}};
 assert.equal((await client.save(0,defaultPreferences())).preferences.language,'en');
 assert.deepEqual(calls[0],['preferences_read',{}]);
 assert.equal((calls[1] as any)[1].request.expected_revision,0);
});
