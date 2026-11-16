import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFailure} from '../src/system/failures.ts';
import {presentFailure} from '../src/presentation/problems.ts';

// Keep the first red run an assertion failure when the new module is absent.
const updater: any = await import('../src/system/updater.ts').catch(() => ({}));
const initial = (change: Record<string, unknown> = {}) => ({
  operation_id: null, revision: 0, state: 'idle', current_version: '0.1.0', target_version: null,
  checked_at: null, downloaded_bytes: 0, total_bytes: null, release_notes: null, error: null, ...change,
});
const available = (change: Record<string, unknown> = {}) => initial({operation_id: 'op-a', revision: 2, state: 'available', target_version: '0.2.0', checked_at: '2026-10-27T01:02:03Z', release_notes: '<script>alert(1)</script>\nPlain notes', ...change});
function decode(value: unknown) {
  assert.equal(typeof updater.decodeUpdateSnapshot, 'function', 'UpdateSnapshot decoder must exist');
  return updater.decodeUpdateSnapshot(value);
}
function client(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  assert.equal(typeof updater.createUpdateClient, 'function', 'fixed-command UpdateClient must exist');
  return updater.createUpdateClient(invoke);
}

test('snapshot decoder accepts exact states and retains plain release notes', () => {
  for (const state of ['idle','checking','current','available','downloading','verified','stopping','installing','failed']) {
    const value = state === 'idle' ? initial() : available({state, error: state === 'failed' ? {code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; required=200'} : null});
    assert.deepEqual(decode(value), value);
  }
});

test('snapshot decoder fails closed on unknown fields, states, unsafe bytes, errors and invalid calendar dates', () => {
  for (const [change, field] of [
    [{url:'https://untrusted.example'}, 'unknown'], [{state:'completed'},'state'], [{revision:2 ** 53},'revision'],
    [{downloaded_bytes:-1},'downloaded_bytes'], [{total_bytes:2 ** 53},'total_bytes'],
    [{downloaded_bytes:11,total_bytes:10},'downloaded_bytes'], [{checked_at:'2026-02-30T00:00:00Z'},'checked_at'],
    [{checked_at:'2026-10-27'},'checked_at'], [{error:{code:'BAD',message:'bad',secret:'DO_NOT_ECHO'}},'unknown'],
    [{operation_id:''},'operation_id'], [{current_version:''},'current_version'],
  ] as const) {
    assert.throws(() => decode(available(change)), (cause: unknown) => cause instanceof Error && cause.message.includes(field) && cause.message.includes('actual') && !cause.message.includes('DO_NOT_ECHO'));
  }
  assert.throws(() => decode({...available(), target_version: undefined}), /target_version/);
});

test('update client invokes only fixed commands and installs an exact verified receipt with explicit confirmation', async () => {
  let next = initial(); const calls: unknown[] = [];
  const api = client(async (command, args) => {calls.push([command,args]); return next;});
  await api.snapshot(); next = available({state:'checking',revision:1}); await api.check();
  next = available(); await api.snapshot(); next = available({state:'downloading',revision:3}); await api.download();
  next = available({state:'verified',revision:4,downloaded_bytes:10,total_bytes:10}); await api.snapshot();
  next = available({state:'stopping',revision:5,downloaded_bytes:10,total_bytes:10});
  await api.install({operation_id:'op-a',expected_revision:4,confirmed:true});
  assert.deepEqual(calls,[['update_snapshot',undefined],['update_check',undefined],['update_snapshot',undefined],['update_download',undefined],['update_snapshot',undefined],['update_install',{request:{operation_id:'op-a',expected_revision:4,confirmed:true}}]]);
});

test('unverified, old, cross-operation, duplicate and source-injected install requests never reach native code', async () => {
  let next = available(); let installs = 0;
  const api = client(async command => {if (command === 'update_install') installs++;return next;});
  await api.snapshot(); const request = {operation_id:'op-a',expected_revision:2,confirmed:true};
  await assert.rejects(api.install(request), /verified/);
  next = available({state:'verified',revision:3}); await api.snapshot();
  for (const bad of [{...request,expected_revision:2},{...request,operation_id:'op-b',expected_revision:3},{...request,expected_revision:3,confirmed:false},{...request,expected_revision:3,url:'https://untrusted.example'}]) await assert.rejects(api.install(bad), /UPDATE_/);
  next = available({state:'stopping',revision:4}); await api.install({...request,expected_revision:3});
  await assert.rejects(api.install({...request,expected_revision:3}), /UPDATE_/);
  assert.equal(installs,1);
});

test('client rejects stale revision, conflicting equal revisions, changed versions and cross-operation download receipts', async () => {
  let next = available({revision:5}); const api = client(async () => next); await api.snapshot();
  for (const change of [{revision:4},{release_notes:'changed without revision'},{revision:6,current_version:'9.0.0'},{revision:6,target_version:'0.3.0'}]) {
    next = available(change); await assert.rejects(api.snapshot(), /UPDATE_REPLY_INVALID.*(revision|version)/);
  }
  next = available({operation_id:'op-b',revision:6}); await assert.rejects(api.download(), /operation_id/);
});

test('late snapshot cannot replace a newer explicit check operation', async () => {
  let release!: (value: unknown) => void;
  const api = client(async command => command === 'update_snapshot' ? new Promise(resolve => {release=resolve;}) : available({operation_id:'op-new',revision:9,state:'checking'}));
  const stale = api.snapshot(); await api.check(); release(available({revision:10}));
  await assert.rejects(stale, (cause:any) => cause.code === 'UPDATE_RESULT_SUPERSEDED' && /generation/.test(cause.message));
  assert.equal(api.getSession().error,null,'superseded background reads must not overwrite a newer action with an error');
});

test('a late rejected snapshot cannot publish its failure into a newer check session', async () => {
  let reject!: (cause:unknown) => void;
  const api = client(async command => command === 'update_snapshot' ? new Promise((_resolve,rejectRead) => {reject=rejectRead;}) : available({operation_id:'op-new',revision:9,state:'checking'}));
  const stale=api.snapshot();await api.check();reject({code:'UPDATE_CHECK_FAILED',message:'old background read failed'});
  await assert.rejects(stale,(cause:any)=>cause.code==='UPDATE_RESULT_SUPERSEDED');
  assert.equal(api.getSession().error,null);
  assert.equal(api.getSession().snapshot.operation_id,'op-new');
});

test('download cannot repeat while an operation is active and native BridgeError evidence stays visible', async () => {
  let next = available({state:'downloading'}); let calls=0;
  const api = client(async () => {calls++;return next;}); await api.snapshot();
  await assert.rejects(api.download(), /available/); assert.equal(calls,1);
  const broken = client(async () => {throw {code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; body=unavailable'};});
  await assert.rejects(broken.check(), /UPDATE_CHECK_FAILED: manifest HTTP 503; body=unavailable/);
});

test('native update rejections retain the exact machine failure and safe evidence through presentation', async () => {
 const details={check:'update_check',observed_at:'2026-11-02T12:00:00Z',evidence:{http_status:'503',actual:'manifest unavailable',required:'HTTP 200'}};
 const api=client(async()=>{throw {code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; body=unavailable',details};});
 let failure;
 try{await api.check();assert.fail('check must reject');}catch(cause){failure=normalizeFailure(cause,'update_operation');}
 assert.equal(failure.code,'UPDATE_CHECK_FAILED');assert.equal(failure.check,'update_check');assert.deepEqual(failure.evidence,details.evidence);
 for(const locale of ['zh','en'] as const){const shown=presentFailure(failure,locale);assert.match(shown.details,/manifest HTTP 503/);assert.ok(!shown.summary.includes('原因尚未确认'));assert.ok(!shown.summary.includes('reason has not been confirmed'));}
});

test('unknown check and download receipts stay locked after identical or unrelated readbacks',async()=>{
 for(const stage of ['check','download'] as const){let next=available(),writes=0;const api=client(async(command)=>{if(command==='update_snapshot')return next;writes++;throw {code:'IPC_TIMEOUT',message:'native response missing; outcome unknown'};});await api.snapshot();await assert.rejects(api[stage]());await api.snapshot();assert.equal(api.getSession().uncertain,stage);await assert.rejects(api.check());assert.equal(writes,1);next=available({revision:3,state:stage==='check'?'available':'verified',operation_id:stage==='check'?'op-b':'op-a'});await api.snapshot();assert.equal(api.getSession().uncertain,null);}
});

test('invalid mutation replies remain uncertain and a proven unsent installation can be explicitly retried',async()=>{
 let next=available({state:'verified',revision:3}),mode='bad',installs=0;
 const api=client(async(command)=>{if(command==='update_snapshot')return next;installs++;if(mode==='bad')return {...next,unknown:true};if(mode==='unsent')throw {code:'REQUEST_NOT_SENT',message:'native request not dispatched'};return next;});await api.snapshot();await assert.rejects(api.install({operation_id:'op-a',expected_revision:3,confirmed:true}));assert.equal(api.getSession().uncertain,'install');await api.snapshot();assert.equal(api.getSession().uncertain,'install');await assert.rejects(api.check());assert.equal(installs,1);
 const unsent=client(async(command)=>{if(command==='update_snapshot')return next;if(mode==='unsent')throw {code:'REQUEST_NOT_SENT',message:'native request not dispatched'};return available({state:'stopping',revision:4});});mode='unsent';await unsent.snapshot();await assert.rejects(unsent.install({operation_id:'op-a',expected_revision:3,confirmed:true}));assert.equal(unsent.getSession().attemptedInstall,null);mode='ok';await unsent.install({operation_id:'op-a',expected_revision:3,confirmed:true});
});
