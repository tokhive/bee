import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {clearMocks, mockIPC} from '@tauri-apps/api/mocks';
import {createAccountClient} from '../src/system/accounts.ts';
import {createAuthorizeClient} from '../src/system/authorize.ts';
import {createSystemBridge} from '../src/system/bridge.ts';
import {createDeviceClient, type DeviceInvoke} from '../src/system/device.ts';
import {createDiagnosticsClient} from '../src/system/diagnostics.ts';
import {onLoginReturn} from '../src/system/lifecycle.ts';
import {createNetworkClient} from '../src/system/network.ts';
import {createNotificationsClient} from '../src/system/notifications.ts';
import {createPreferencesClient, defaultPreferences} from '../src/system/preferences.ts';
import {createRuntimeClient} from '../src/system/runtime.ts';
import {createSupplyClient} from '../src/system/supply.ts';
import {createUpdateClient} from '../src/system/updater.ts';

const rust = (module:string) => readFileSync(new URL(`../src-tauri/src/${module}.rs`, import.meta.url), 'utf8');
const registry = rust('lib').match(/tauri::generate_handler!\[([\s\S]*?)\]/)![1];
const commands = new Map([...registry.matchAll(/(\w+)::(\w+)/g)].map(([, module, name]) => {
  const signature = rust(module).match(new RegExp(`#\\[tauri::command\\]\\s*pub (?:async )?fn ${name}(?:<[^\\n]+>)?\\(([\\s\\S]*?)\\)\\s*->`));
  assert.ok(signature, `${module}::${name}: registered command must have an inspectable default Tauri argument naming policy`);
  const fields = [...signature[1].matchAll(/(?:^|\n)\s*(?:mut )?(\w+):\s*([^\n]+)/g)]
    .map(([, key, type]) => [key.replace(/_([a-z])/g, (_, c:string) => c.toUpperCase()), type.trim().replace(/,$/, '')] as const)
    .filter(([, type]) => !/^tauri::(?:State|AppHandle)/.test(type));
  return [name, fields] as const;
}));

// These are the actual Serde input definitions, not a second handwritten mock contract.
const inputSource = ['protocol','runtime_protocol','authorize_protocol','preferences','diagnostic_log','lifecycle','update_install'].map(rust).join('\n');
function checkType(value:unknown, type:string, at:string):void {
  const option = /^Option<(.+)>$/.exec(type);
  if (option) { if (value !== null && value !== undefined) checkType(value, option[1], at); return; }
  const vector = /^Vec<(.+)>$/.exec(type);
  if (vector) { assert.ok(Array.isArray(value), `${at}: required=${type}`); value.forEach((v,i) => checkType(v, vector[1], `${at}[${i}]`)); return; }
  if (/^u(?:16|32|64)$/.test(type)) { assert.ok(Number.isSafeInteger(value) && Number(value) >= 0, `${at}: required=${type} safe integer`); return; }
  if (type === 'String' || type === 'bool') { assert.equal(typeof value, type === 'String' ? 'string' : 'boolean', `${at}: required=${type}`); return; }
  const name = type.split('::').at(-1)!;
  const structure = inputSource.match(new RegExp(`struct ${name}\\s*\\{([^}]+)\\}`));
  if (structure) {
    const fields = [...structure[1].matchAll(/pub (\w+):\s*([^,\n]+)/g)].map(([,key,type]) => [key,type.trim()] as const);
    checkFields(value, fields, at);
  } else {
    // All command-input enums use string serialization; their value whitelists
    // are separately validated by the real clients and Rust protocol tests.
    assert.match(inputSource, new RegExp(`enum ${name}\\b`), `${at}: unsupported Rust input type=${type}`);
    assert.equal(typeof value, 'string', `${at}: required=serialized ${name}`);
  }
}
function checkFields(value:unknown, fields:readonly (readonly [string,string])[], at:string):void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${at}: required=object`);
  const object = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(object).sort(), fields.map(([key]) => key).sort(), `${at}: payload keys differ from the Rust command/Serde definition`);
  fields.forEach(([key,type]) => checkType(object[key], type, `${at}.${key}`));
}
function checkCall(command:string, args:unknown):void {
  const fields = commands.get(command);
  assert.ok(fields, `frontend command=${command} is absent from the native registry`);
  checkFields(args ?? {}, fields, command);
}

test('all registered native commands receive frontend arguments matching the Rust source', async t => {
  const seen = new Set<string>(), stopped = new Error('contract sample stops before native execution');
  const invoke:DeviceInvoke = async (command,args) => { checkCall(command,args); seen.add(command); throw stopped; };
  const sample = async (action:()=>Promise<unknown>) => {
    const before = seen.size;
    await assert.rejects(action, error => error === stopped);
    assert.ok(seen.size > before, 'each sample must exercise an additional registered native command');
  };
  const instance='b'.repeat(32), id='a'.repeat(48);
  const device=createDeviceClient(invoke);
  for (const action of [()=>device.status(),()=>device.begin('https://hive.example','Test Mac'),()=>device.open(),()=>device.context!(),()=>device.recoveryPrepare(),()=>device.recoveryStatus(),()=>device.recoveryConfirm(id,1,'begin_pairing')]) await sample(action);
  const accounts=createAccountClient(invoke,instance);
  for (const action of [()=>accounts.defaults(),()=>accounts.snapshot('openai',true),()=>accounts.detect({platform:'openai',directory:null,store:'auto',mode:'local'}),()=>accounts.action({platform:'openai',revision:1,candidate_ref:id,action:'select',confirmed:true})]) await sample(action);
  const authorize=createAuthorizeClient(invoke,instance);
  for (const action of [()=>authorize.start({platform:'openai',source:{directory:null,store:'auto'},expected_revision:1}),()=>authorize.status(id),()=>authorize.cancel(id)]) await sample(action);
  const runtime=createRuntimeClient(invoke,instance);
  for (const action of [()=>runtime.snapshot(),()=>runtime.start({expected_revision:1,resume_platforms:['openai']}),()=>runtime.stop(1)]) await sample(action);
  const supply=createSupplyClient(invoke,{hive:'https://hive.example',deviceId:'test-device'});
  for (const action of [()=>supply.status('openai'),()=>supply.setPaused('openai',true)]) await sample(action);
  const network=createNetworkClient(invoke);
  for (const action of [()=>network.snapshot(),()=>network.test(''),()=>network.saveProxy({proxy:'',origin:'https://hive.example',expectedRevision:1}),()=>network.applySaved(true)]) await sample(action);
  const preferences=createPreferencesClient(invoke);
  for (const action of [()=>preferences.read(),()=>preferences.save(0,defaultPreferences())]) await sample(action);
  const notifications=createNotificationsClient(invoke);
  for (const action of [()=>notifications.permission(),()=>notifications.enable(),()=>notifications.autostartStatus(),()=>notifications.autostartSet(true),()=>notifications.deliveryStatus(),()=>notifications.retry()]) await sample(action);

  const report={id,instance,run_id:null,network_revision:0,binding_revision:0,started_at:'2026-10-26T03:30:00Z',finished_at:null,state:'running',checks:[]};
  let seedReport=true;
  const diagnostics=createDiagnosticsClient(async(command,args)=>{
    if (seedReport) { checkCall(command,args); seen.add(command); return {instance,result:{report}}; }
    return invoke(command,args);
  },instance);
  await diagnostics.start(); seedReport=false;
  for (const action of [()=>diagnostics.snapshot(id),()=>diagnostics.cancel(id),()=>diagnostics.logs({cursor:null,limit:20,module:null,platform:null,level:null}),()=>diagnostics.export(id,false)]) await sample(action);

  const update={operation_id:'test-update',revision:1,state:'available',current_version:'0.1.0',target_version:'0.2.0',checked_at:'2026-10-27T01:02:03Z',downloaded_bytes:0,total_bytes:null,release_notes:null,error:null};
  await sample(()=>createUpdateClient(invoke).snapshot());
  await sample(()=>createUpdateClient(invoke).check());
  for (const state of ['available','verified'] as const) {
    let seedUpdate=true;
    const updater=createUpdateClient(async(command,args)=>seedUpdate ? {...update,state} : invoke(command,args));
    await updater.snapshot(); seedUpdate=false;
    await sample(()=>state==='available' ? updater.download() : updater.install({operation_id:update.operation_id,expected_revision:1,confirmed:true}));
  }

  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalTauri=Object.getOwnPropertyDescriptor(globalThis,'isTauri');
  Object.defineProperty(globalThis,'window',{value:globalThis,configurable:true});
  Object.defineProperty(globalThis,'isTauri',{value:true,configurable:true});
  t.after(()=>{ clearMocks(); for (const [key,descriptor] of [['window',originalWindow],['isTauri',originalTauri]] as const) { if(descriptor)Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); } });
  mockIPC((command,args)=>command.startsWith('plugin:event|') ? 1 : invoke(command,args as Record<string,unknown>));
  const bridge=createSystemBridge();
  for (const action of [()=>bridge.status(),()=>bridge.pendingRequests!(),()=>bridge.ping(),()=>bridge.startupStatus!(),()=>bridge.startupRecheck!(),()=>bridge.syncNativeLocale!('zh',0),()=>onLoginReturn(()=>{})]) await sample(action);

  // hive_open is the sole inline application invoke rather than a client method.
  const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
  const hive=main.match(/openHive=\{\(\)=>invoke\('([^']+)',(\{\})\)\}/);
  assert.ok(hive,'inline Hive action must retain an inspectable empty native payload');
  await sample(()=>invoke(hive[1],JSON.parse(hive[2])));
  assert.deepEqual([...seen].sort(),[...commands.keys()].sort(),'every registered command must have a frontend argument sample');
  t.diagnostic(`Validated ${seen.size} registered commands against Rust signatures, including nested Serde input fields.`);
});

test('the Rust-derived contract rejects the previous recovery snake_case payload',()=>{
  assert.throws(()=>checkCall('device_recovery_confirm',{operation_id:'a'.repeat(48),expected_revision:1,decision:'begin_pairing'}),/payload keys differ/);
});
