import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {invoke} from '@tauri-apps/api/core';
import {createDeviceClient} from '../src/system/device.ts';
import {createRuntimeClient} from '../src/system/runtime.ts';
import {createDiagnosticsClient} from '../src/system/diagnostics.ts';
import {createNetworkClient} from '../src/system/network.ts';
import {createPreferencesClient} from '../src/system/preferences.ts';
import {decodeStartupStatus} from '../src/system/bridge.ts';
import {createAccountClient} from '../src/system/accounts.ts';
import {createAuthorizeClient} from '../src/system/authorize.ts';
import {createSupplyClient} from '../src/system/supply.ts';
import {installPreviewFixture} from './fixtures/bee-preview/fixture.mjs';
import {applyPreviewEvent} from './fixtures/bee-preview/control.mjs';
async function preview(t:TestContext,scene='device-unbound'){
 const previous=['window','location','isTauri'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{parent:{postMessage(){}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://preview.test',search:''}});
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 await installPreviewFixture(scene);
 const w=window as any,instance=(await invoke<any>('bridge_status')).metadata.instance;
 return {device:createDeviceClient(invoke),runtime:createRuntimeClient(invoke,instance),instance,approve:(fields={})=>applyPreviewEvent({session:w.__beePreviewSession,action:'device-approval',value:'approve',...w.__beeMockDeviceContext?.(),...fields})};
}

test('first pairing preserves the submitted Hive and device name through normal context and status reads',async t=>{
 const {device}=await preview(t);
 const pending=await device.begin('https://custom-hive.example','Design Laptop');
 assert.equal(pending.state,'pending');
 assert.equal(pending.hive,'https://custom-hive.example');
 assert.equal(pending.name,'Design Laptop');
 assert.equal(pending.recovery?.old_identity,null);
 assert.ok(pending.recovery?.operation_id);
 const context=await device.context!();
 assert.ok('device_id'in context);
 assert.equal(context.hive,'https://custom-hive.example');
 assert.equal(context.name,'Design Laptop');
 assert.equal(context.device_id,null);
 assert.deepEqual(await device.status(),pending);
});

test('external approval completes the original first pairing only through status and resets contribution context',async t=>{
 const {device,runtime,approve}=await preview(t);
 const pending=await device.begin('https://custom-hive.example','Design Laptop');
 const before=await device.context!();
 approve();
 assert.equal((await device.context!() as any).device_id,null);
 const bound=await device.status();
 assert.equal(bound.state,'bound');
 assert.equal(bound.recovery!.operation_id,pending.recovery!.operation_id);
 assert.equal(bound.identity!.name,'Design Laptop');
 const context=await device.context!();
 assert.ok('device_id'in context);
 assert.equal(context.device_id,bound.identity!.id);
 assert.equal(context.hive,'https://custom-hive.example');
 assert.ok(context.binding_revision>before.binding_revision);
 const state=await runtime.snapshot();
 assert.equal(state.local,'stopped');assert.equal(state.connection,'connected');
 assert.equal(state.run_id,null);assert.equal(state.operation,null);
 assert.equal(state.platforms.openai.account.selection.state,'not_selected');
 assert.equal(state.platforms.claude.account.selection.state,'not_selected');
 assert.deepEqual((window as any).paused,{openai:true,claude:true});
});

test('credential recovery validates confirmations and replays accepted decisions without replacing the transaction',async t=>{
 const {device,approve,runtime}=await preview(t,'device-recovery-confirm');
 const prepared=await device.recoveryPrepare();
 assert.equal(prepared.phase,'awaiting_confirmation');
 for(const [id,revision,decision]of [[prepared.operation_id,prepared.revision,'adopt_owner'],['f'.repeat(48),prepared.revision,'begin_pairing'],[prepared.operation_id,prepared.revision-1,'begin_pairing']] as const){
  await assert.rejects(()=>device.recoveryConfirm(id,revision,decision));
  assert.deepEqual(await device.recoveryStatus(),prepared);
 }
 const pending=await device.recoveryConfirm(prepared.operation_id,prepared.revision,'begin_pairing');
 assert.equal(pending.phase,'pending');
 assert.equal(pending.operation_id,prepared.operation_id);
 assert.deepEqual(await device.recoveryConfirm(prepared.operation_id,prepared.revision,'begin_pairing'),pending);
 await assert.rejects(()=>device.recoveryConfirm(pending.operation_id,pending.revision,'adopt_owner'));
 const stable=await device.recoveryStatus();
 assert.equal(stable.phase,'pending');assert.deepEqual(stable.pairing,pending.pairing);
 approve();
 assert.equal((await device.context!() as any).device_id,prepared.old_identity!.id);
 const owner=await device.recoveryStatus();assert.equal(owner.phase,'awaiting_owner_confirmation');
 assert.deepEqual(await device.recoveryConfirm(prepared.operation_id,prepared.revision,'begin_pairing'),owner);
 const completed=await device.recoveryConfirm(owner.operation_id,owner.revision,'adopt_owner');
 assert.equal(completed.phase,'completed');
 assert.deepEqual(await device.recoveryConfirm(owner.operation_id,owner.revision,'adopt_owner'),completed);
 assert.deepEqual(await device.recoveryConfirm(prepared.operation_id,prepared.revision,'begin_pairing'),completed);
 await assert.rejects(()=>device.recoveryConfirm(completed.operation_id,completed.revision,'adopt_owner'));
 const context=await device.context!();assert.ok('device_id'in context);
 assert.equal(context.device_id,completed.new_identity!.id);
 const startup=decodeStartupStatus(await invoke('startup_recheck'));
 assert.equal(startup.state,'ready');assert.equal(startup.binding_revision,context.binding_revision);
 const state=await runtime.snapshot();assert.equal(state.local,'stopped');assert.equal(state.connection,'connected');
 assert.equal(state.platforms.openai.account.selection.state,'not_selected');
});

test('recovery preparation rejects a valid credential and unresolved account work without replacing saved context',async t=>{
 const {device}=await preview(t,'stopped'),before=await device.context!();
 await assert.rejects(()=>device.recoveryPrepare(),/credential remains accepted/);
 assert.deepEqual(await device.context!(),before);
 await installPreviewFixture('device-recovery-confirm');
 (window as any).accounts.openai.operation={id:'f'.repeat(48),state:'running'};
 await assert.rejects(()=>device.recoveryPrepare(),/pending.*openai/);
 await assert.rejects(()=>device.recoveryStatus(),/no credential recovery transaction/);
});

test('each seeded recovery phase rejects decisions from another phase and preserves the original transaction',async t=>{
 await preview(t);
 const scenes=['recovery-pending','recovery-draining','recovery-creation-unknown','recovery-redemption-unknown','recovery-owner','recovery-saving','recovery-completed'];
 for(const scene of scenes){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke),before=await device.recoveryStatus();
  const invalid=before.phase==='awaiting_owner_confirmation'?'begin_pairing':'adopt_owner';
  await assert.rejects(()=>device.recoveryConfirm(before.operation_id,before.revision,invalid),/recovery decision rejected/,scene);
  const after=await device.recoveryStatus();
  assert.equal(after.operation_id,before.operation_id,scene);assert.equal(after.phase,before.phase,scene);assert.deepEqual(after.pairing,before.pairing,scene);
 }
});

test('renewing a remotely expired pairing preserves its operation and accepted renewal can be replayed',async t=>{
 const {device}=await preview(t,'recovery-pending');
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const pending=await device.recoveryStatus();t.mock.timers.tick(600001);
 const expired=await device.recoveryStatus();assert.equal(expired.phase,'expired');
 await assert.rejects(()=>device.recoveryConfirm(expired.operation_id,expired.revision,'begin_pairing'));
 const renewed=await device.recoveryConfirm(expired.operation_id,expired.revision,'renew_expired');
 assert.equal(renewed.phase,'pending');assert.equal(renewed.operation_id,pending.operation_id);
 assert.notEqual(renewed.pairing!.code,pending.pairing!.code);
 assert.deepEqual(await device.recoveryConfirm(expired.operation_id,expired.revision,'renew_expired'),renewed);
});

test('unknown creation cannot be approved or recreated and unknown redemption only reads its original transaction',async t=>{
 await preview(t);
 for(const scene of ['device-creation-unknown','recovery-creation-unknown']){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke),initial=scene.startsWith('device-');
  const before=initial?(await device.status()).recovery!:await device.recoveryStatus();
  const w=window as any;
  assert.throws(()=>applyPreviewEvent({session:w.__beePreviewSession,action:'device-approval',value:'approve',...w.__beeMockDeviceContext()}),/creation_unknown/);
  if(initial)assert.deepEqual((await device.begin('https://hive.example','Bee Desktop')).recovery,before);
  else await assert.rejects(()=>device.recoveryConfirm(before.operation_id,before.revision,'renew_expired'));
  assert.deepEqual(initial?(await device.status()).recovery:await device.recoveryStatus(),before);
 }
 for(const scene of ['device-redemption-unknown','recovery-redemption-unknown']){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke),initial=scene.startsWith('device-');
  const before=initial?(await device.status()).recovery!:await device.recoveryStatus(),w=window as any;
  assert.equal((initial?(await device.status()).recovery!:await device.recoveryStatus()).operation_id,before.operation_id);
  applyPreviewEvent({session:w.__beePreviewSession,action:'device-approval',value:'approve',...w.__beeMockDeviceContext()});
  const after=initial?(await device.status()).recovery!:await device.recoveryStatus();
  assert.equal(after.operation_id,before.operation_id);assert.equal(after.phase,initial?'completed':'awaiting_owner_confirmation');
  assert.deepEqual(after.pairing,before.pairing);
  assert.equal((w.calls as any[]).filter(c=>['device_begin','device_recovery_prepare','device_recovery_confirm'].includes(c.command)).length,0);
 }
});

test('stale session operation revision phase and captured legacy approval cannot change current binding',async t=>{
 const {device,approve}=await preview(t),w=window as any;
 await device.begin('https://custom-hive.example','Design Laptop');
 const pending=await device.status(),legacy=w.__beePreviewApprove,oldHandler=w.__beeMockControls['device-approval'];
 assert.throws(()=>approve({session:'previous-session'}),/PREVIEW_SESSION_STALE/);
 assert.throws(()=>approve({operationId:'f'.repeat(48)}),/PREVIEW_DEVICE_STALE/);
 assert.throws(()=>approve({expectedRevision:pending.recovery!.revision+1}),/PREVIEW_DEVICE_STALE/);
 assert.equal((await device.context!() as any).device_id,null);
 approve();await device.status();
 assert.throws(()=>legacy(),/PREVIEW_DEVICE_STALE|PREVIEW_DEVICE_PHASE/);
 assert.throws(()=>approve(),/PREVIEW_DEVICE_PHASE/);
 const current=await device.context!();
 await installPreviewFixture('device-unbound');
 const fresh=createDeviceClient(invoke);await fresh.begin('https://new-hive.example','New Laptop');
 assert.throws(()=>legacy(),/PREVIEW_SESSION_STALE/);
 assert.throws(()=>oldHandler({session:w.__beePreviewSession,value:'approve',...w.__beeMockDeviceContext()}),/PREVIEW_SESSION_STALE/);
 assert.equal((await fresh.context!() as any).device_id,null);assert.notDeepEqual(await fresh.context!(),current);
});

test('custom Hive recovery retires old proxy and diagnostic scopes while preserving saved preferences',async t=>{
 const {device,runtime,approve,instance}=await preview(t),w=window as any;
 await device.begin('https://design-hive.example','Design Laptop');approve();await device.status();
 const first=await device.context!();assert.ok('device_id'in first);
 const network=createNetworkClient(invoke),preferences=createPreferencesClient(invoke);
 await network.saveProxy({proxy:'http://127.0.0.1:7890',origin:null,expectedRevision:(await preferences.read()).preferences.revision});
 const saved=await preferences.read();
 assert.deepEqual(saved.preferences.proxies,[{origin:'https://design-hive.example',device_scope:first.device_id,connect_proxy:'http://127.0.0.1:7890'}]);
 await network.applySaved(true);
 const previous=await runtime.snapshot(),diagnostics=createDiagnosticsClient(invoke,instance,previous.network_revision,previous.run_id,first.binding_revision),old=await diagnostics.start();
 const oldBindingEvent={session:w.__beePreviewSession,action:'device-credential',value:'revoke',...w.__beeMockDeviceContext()};
 applyPreviewEvent(oldBindingEvent);
 assert.equal(decodeStartupStatus(await invoke('startup_status')).state,'blocked');
 await assert.rejects(()=>device.status(),/device_replaced/);
 const prepared=await device.recoveryPrepare();
 await device.recoveryConfirm(prepared.operation_id,prepared.revision,'begin_pairing');approve();
 const owner=await device.recoveryStatus();
 await device.recoveryConfirm(owner.operation_id,owner.revision,'adopt_owner');
 const latest=await device.context!();assert.ok('device_id'in latest);
 assert.equal(latest.hive,'https://design-hive.example');assert.notEqual(latest.device_id,first.device_id);
 assert.throws(()=>applyPreviewEvent(oldBindingEvent),/PREVIEW_DEVICE_BINDING_STALE/);
 assert.deepEqual(await preferences.read(),saved);
 const reset=await network.snapshot();assert.equal(reset.saved_proxy,'');assert.equal(reset.effective_proxy,'');assert.equal(reset.pending_restart,false);
 await assert.rejects(()=>diagnostics.snapshot(old.id),/context changed/);
 assert.throws(()=>applyPreviewEvent({session:w.__beePreviewSession,action:'diagnostics-result',value:'completed',reportId:old.id}),/context changed/);
 const state=await runtime.snapshot();diagnostics.setContext(state.network_revision,state.run_id,latest.binding_revision);
 const report=await diagnostics.start();assert.notEqual(report.id,old.id);assert.equal(report.binding_revision,latest.binding_revision);assert.equal(report.network_revision,state.network_revision);
 assert.equal(decodeStartupStatus(await invoke('startup_recheck')).state,'ready');
 assert.equal((await runtime.snapshot()).connection,'connected');
});

test('first pairing validates input and repeated begin preserves the saved transaction and configuration',async t=>{
 const {device}=await preview(t);
 for(const [hive,name]of [['http://public.example','Laptop'],['https://hive.example/path','Laptop'],['https://hive.example','  '],['https://hive.example','bad\nname'],['https://hive.example','x'.repeat(81)]])await assert.rejects(()=>device.begin(hive,name));
 assert.equal((await device.status()).state,'unbound');
 const first=await device.begin('https://custom-hive.example/','  工作电脑  ');
 assert.equal(first.name,'工作电脑');assert.equal(first.hive,'https://custom-hive.example');
 assert.deepEqual(await device.begin('https://custom-hive.example','Different name'),first);
 await assert.rejects(()=>device.begin('https://other-hive.example','Laptop'),/desktop Hive change rejected/);
 assert.deepEqual(await device.status(),first);
});

test('initial expired pairing renews only on begin and a stale approval cannot approve the replacement token',async t=>{
 const {device,approve}=await preview(t,'device-expired'),w=window as any;
 const expired=await device.status(),stale=w.__beePreviewApprove;
 assert.equal(expired.state,'expired');assert.throws(()=>approve(),/PREVIEW_DEVICE_PHASE/);
 const renewed=await device.begin('https://hive.example','Bee Desktop');
 assert.equal(renewed.state,'pending');assert.equal(renewed.recovery!.operation_id,expired.recovery!.operation_id);
 assert.notEqual(renewed.user_code,expired.recovery!.pairing!.code);
 assert.throws(()=>stale(),/PREVIEW_DEVICE_STALE/);
 approve();assert.equal((await device.status()).state,'bound');
});

test('seeded pending and draining pairings continue the original operation after external approval',async t=>{
 await preview(t);
 for(const scene of ['device-pending','device-draining','recovery-pending','recovery-draining']){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke),initial=scene.startsWith('device-'),w=window as any;
  const before=initial?(await device.status()).recovery!:await device.recoveryStatus();
  applyPreviewEvent({session:w.__beePreviewSession,action:'device-approval',value:'approve',...w.__beeMockDeviceContext()});
  const after=initial?(await device.status()).recovery!:await device.recoveryStatus();
  assert.equal(after.operation_id,before.operation_id);assert.equal(after.phase,initial?'completed':'awaiting_owner_confirmation');
  assert.equal((w.calls as any[]).filter(c=>['device_begin','device_recovery_prepare','device_recovery_confirm'].includes(c.command)).length,0);
 }
});

test('recoveryOpen keeps pending and draining original transactions available without a device write',async t=>{
 await preview(t);
 for(const scene of ['recovery-pending','recovery-draining']){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke),before=await device.recoveryStatus();
  assert.deepEqual(await device.recoveryOpen(),before);
  assert.deepEqual(await device.recoveryStatus(),before);
  assert.equal((window as any).calls.filter((c:any)=>['device_begin','device_recovery_prepare','device_recovery_confirm'].includes(c.command)).length,0);
 }
});

test('recoveryOpen rejects every non-browser phase with its explicit failure and preserves the transaction',async t=>{
 await preview(t);
 for(const scene of ['device-recovery-confirm','recovery-owner','recovery-completed','recovery-creation-unknown','recovery-redemption-unknown','recovery-saving']){
  await installPreviewFixture(scene);const device=createDeviceClient(invoke);
  const before=scene==='device-recovery-confirm'?await device.recoveryPrepare():await device.recoveryStatus();
  await assert.rejects(()=>device.recoveryOpen(),error=>error instanceof Error&&'code'in error&&error.code==='DEVICE_RECOVERY_OPEN_PHASE'&&error.message.includes('phase='+before.phase),scene);
  assert.deepEqual(await device.recoveryStatus(),before,scene);
 }
 await installPreviewFixture('recovery-pending');const device=createDeviceClient(invoke);
 t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.tick(600001);
 const expired=await device.recoveryStatus();assert.equal(expired.phase,'expired');
 await assert.rejects(()=>device.recoveryOpen(),error=>error instanceof Error&&'code'in error&&error.code==='DEVICE_RECOVERY_OPEN_PHASE');
 assert.deepEqual(await device.recoveryStatus(),expired);
});

test('every unresolved initial or recovery transaction blocks cross-domain writes and preserves original work',async t=>{
 await preview(t);
 const scenes=['device-awaiting-confirmation','device-creating','device-creation-unknown','device-pending','device-draining','device-redeeming','device-redemption-unknown','device-saving','device-expired','device-recovery-confirm','recovery-pending','recovery-draining','recovery-creation-unknown','recovery-redemption-unknown','recovery-owner','recovery-saving'];
 for(const scene of scenes){
  await installPreviewFixture(scene);const w=window as any,instance=(await invoke<any>('bridge_status')).metadata.instance;
  const device=createDeviceClient(invoke),account=createAccountClient(invoke,instance),authorize=createAuthorizeClient(invoke,instance),runtime=createRuntimeClient(invoke,instance),network=createNetworkClient(invoke);
  const transaction=scene==='device-recovery-confirm'?await device.recoveryPrepare():scene.startsWith('recovery-')?await device.recoveryStatus():(await device.status()).recovery!;
  const originalAccount=await account.snapshot('openai',false),originalRuntime=await runtime.snapshot(),originalPause=structuredClone(w.paused),originalPreferences=await createPreferencesClient(invoke).read(),originalNetwork=await network.snapshot();
  const context=await device.context!();assert.ok('device_id'in context);
  const supply=createSupplyClient(invoke,{hive:context.hive,deviceId:context.device_id??'unbound'});
  for(const action of ['clear_selection','select','confirm_change','remove'] as const)await assert.rejects(()=>account.action({platform:'openai',revision:originalAccount.revision,candidate_ref:originalAccount.candidate.reference??'a'.repeat(48),action,confirmed:true}),/device recovery transaction unresolved: phase=/,scene+':'+action);
  await assert.rejects(()=>authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:originalAccount.revision}),/device recovery transaction unresolved: phase=/,scene+':authorize');
  await assert.rejects(()=>runtime.start({expected_revision:originalRuntime.revision,resume_platforms:[]}),/device recovery transaction unresolved: phase=/,scene+':runtime');
  for(const paused of [false,true])await assert.rejects(()=>supply.setPaused('openai',paused),/device recovery transaction unresolved: phase=/,scene+':supply');
  await assert.rejects(()=>network.applySaved(true),/device recovery transaction unresolved: phase=/,scene+':network');
  assert.deepEqual(await account.snapshot('openai',false),originalAccount,scene);
  assert.deepEqual(w.paused,originalPause,scene);assert.deepEqual(await createPreferencesClient(invoke).read(),originalPreferences,scene);assert.deepEqual(await network.snapshot(),originalNetwork,scene);
  const after=await runtime.snapshot();for(const key of ['local','connection','revision','network_revision','run_id','operation'] as const)assert.deepEqual(after[key],originalRuntime[key],scene+':'+key);
  const unchanged=scene==='device-recovery-confirm'||scene.startsWith('recovery-')?await device.recoveryStatus():(await device.status()).recovery;
  assert.deepEqual(unchanged,transaction,scene);
  // Detect refreshes a candidate without admitting a write worker; the Go API
  // permits it during recovery, unlike selection and official login creation.
  assert.equal((await account.detect({platform:'openai',directory:null,store:'file',mode:'local'})).platform,'openai',scene);
 }
});

test('completed first pairing and recovery release the cross-domain barrier for explicit user actions',async t=>{
 await preview(t);
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 for(const scene of ['device-pending','device-recovery-confirm']){
  await installPreviewFixture(scene);const w=window as any,instance=(await invoke<any>('bridge_status')).metadata.instance;
  const device=createDeviceClient(invoke),account=createAccountClient(invoke,instance),authorize=createAuthorizeClient(invoke,instance),runtime=createRuntimeClient(invoke,instance),network=createNetworkClient(invoke);
  if(scene==='device-recovery-confirm'){const ready=await device.recoveryPrepare();await device.recoveryConfirm(ready.operation_id,ready.revision,'begin_pairing');}
  applyPreviewEvent({session:w.__beePreviewSession,action:'device-approval',value:'approve',...w.__beeMockDeviceContext()});
  if(scene==='device-pending')await device.status();else{const owner=await device.recoveryStatus();await device.recoveryConfirm(owner.operation_id,owner.revision,'adopt_owner');}
  const candidate=await account.detect({platform:'openai',directory:null,store:'file',mode:'official'});
  const selected=await account.action({platform:'openai',revision:candidate.revision,candidate_ref:candidate.candidate.reference!,action:'select',confirmed:true});assert.equal(selected.selection.state,'selected');
  t.mock.timers.tick(601);
  const prepared=await runtime.snapshot();assert.equal(prepared.local,'stopped');
  const current=await account.snapshot('openai',false);assert.equal(current.authorization.state,'official_identity_verified');
  const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});assert.equal(login.state,'running');
  assert.equal((await authorize.cancel(login.id)).state,'cancelled');assert.equal((await authorize.status(login.id)).state,'cancelled');
  assert.equal((await network.applySaved(true)).error,null);
  const initial=await runtime.snapshot();await runtime.start({expected_revision:initial.revision,resume_platforms:[]});
  const context=await device.context!();assert.ok('device_id'in context);
  const supply=createSupplyClient(invoke,{hive:context.hive,deviceId:context.device_id!});assert.equal((await supply.setPaused('openai',true)).paused,true);
  await runtime.stop((await runtime.snapshot()).revision);assert.equal((await runtime.snapshot()).local,'stopped');
 }
});

test('unbound and incomplete pairing stay disconnected without inventing a heartbeat failure or retry plan',async t=>{
 await preview(t);
 for(const scene of ['device-unbound','device-pending','device-draining','device-creation-unknown','device-redemption-unknown','recovery-pending']){
  await installPreviewFixture(scene);const instance=(await invoke<any>('bridge_status')).metadata.instance;
  const state=await createRuntimeClient(invoke,instance).snapshot();assert.equal(state.connection,'disconnected',scene);assert.equal(state.connection_detail,null,scene);
 }
 for(const scene of ['runtime-offline','runtime-disconnected']){
  await installPreviewFixture(scene);const instance=(await invoke<any>('bridge_status')).metadata.instance;
  const state=await createRuntimeClient(invoke,instance).snapshot();assert.equal(state.connection_detail?.retry,'scheduled',scene);assert.equal(state.connection_detail?.failure?.code,'connection_closed',scene);assert.ok(state.connection_detail?.next_retry_at,scene);
 }
});

test('temporary device identity rejection preserves structured HTTP evidence through the formal Client',async t=>{
 const {device}=await preview(t,'device-error');
 await assert.rejects(()=>device.status(),error=>{
  assert.ok(error instanceof Error);
  const observed=error as Error&{code:string;details:{check:string;observed_at:string;evidence:Record<string,string>}};
  assert.equal(observed.code,'http_rejected');assert.equal(observed.details.check,'device_identity');
  assert.ok(Number.isFinite(Date.parse(observed.details.observed_at)));
  assert.equal(observed.details.evidence.http_status,'503');
  assert.equal(observed.details.evidence.path,'/api/bee/identity');
  assert.equal(observed.details.evidence.target_origin,'https://hive.example');
  assert.equal(observed.details.evidence.response_body,'Hive upstream temporarily unavailable');
  return true;
 });
});
