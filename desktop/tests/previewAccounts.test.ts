import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {invoke} from '@tauri-apps/api/core';
import {createAccountClient} from '../src/system/accounts.ts';
import {createAuthorizeClient} from '../src/system/authorize.ts';
import {createRuntimeClient} from '../src/system/runtime.ts';
import {installPreviewFixture} from './fixtures/bee-preview/fixture.mjs';
import {applyPreviewEvent} from './fixtures/bee-preview/control.mjs';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';

async function preview(t:TestContext,scene='account-empty'){
 const previous=['window','location','isTauri'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{parent:{postMessage(){}}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://preview.test',search:''}});
 Object.defineProperty(globalThis,'isTauri',{configurable:true,value:true});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 await installPreviewFixture(scene);
 const status=await invoke<{metadata:{instance:string}}>('bridge_status');
 return {accounts:createAccountClient(invoke,status.metadata.instance),authorize:createAuthorizeClient(invoke,status.metadata.instance),runtime:createRuntimeClient(invoke,status.metadata.instance)};
}

test('actual preview detection respects missing sources instead of treating a fixed scene as a response',async t=>{
 const {accounts}=await preview(t);
 const missing=await accounts.detect({platform:'openai',directory:null,store:'file',mode:'local'});
 assert.equal(missing.candidate.state,'source_missing');
 assert.equal(missing.candidate.reference,null);
 assert.ok(missing.revision>1,'a source observation must advance the current snapshot');
 assert.equal(missing.candidate.error?.check,'source_read');
});

const event=(request:{action:string;[key:string]:unknown})=>applyPreviewEvent({session:(window as unknown as {__beePreviewSession:string}).__beePreviewSession,...request});

test('a revoked device retains the missing selected source through formal local detection',async t=>{
 const {accounts}=await preview(t,'device-revoked-source-missing');
 const initial=await accounts.snapshot('openai',false);
 assert.equal(initial.candidate.state,'source_missing');
 const current=await accounts.detect({platform:'openai',directory:null,store:'file',mode:'local'});
 assert.equal(current.candidate.state,'source_missing');
 assert.equal(current.selection.state,'selected');
 assert.equal(current.candidate.error?.check,'source_read');
});

test('source repair is scoped to its source and only detection produces a new candidate',async t=>{
 const {accounts}=await preview(t);
 const missing=await accounts.detect({platform:'openai',directory:null,store:'file',mode:'local'});
 event({action:'account-source',platform:'openai',directory:null,store:'file',value:'available'});
 assert.deepEqual((await accounts.snapshot('openai',false)).candidate,missing.candidate);
 assert.deepEqual((await accounts.snapshot('openai',true)).candidate,missing.candidate);
 const local=await accounts.detect({platform:'openai',directory:'/tmp/codex',store:'auto',mode:'local'});
 assert.equal(local.candidate.state,'available');
 assert.equal(local.candidate.identity_verified,false);
 assert.equal(local.candidate.source?.store,'file');
 const official=await accounts.detect({platform:'openai',directory:'/tmp/codex',store:'file',mode:'official'});
 assert.equal(official.candidate.identity_verified,true);
 assert.equal(official.authorization.state,'official_identity_verified');
 const other=await accounts.detect({platform:'openai',directory:'/tmp/other',store:'file',mode:'local'});
 assert.equal(other.candidate.state,'source_missing');
 event({action:'account-source',platform:'openai',directory:'/tmp/other',store:'file',value:'denied'});
 const denied=await accounts.detect({platform:'openai',directory:'/tmp/other',store:'file',mode:'official'});
 assert.equal(denied.candidate.state,'permission_denied');
 assert.equal(denied.candidate.reference,null);
 assert.equal(denied.candidate.error?.evidence.permission_denied,'true');
});

test('login result appears in formal snapshots as a candidate and new platform logins own distinct IDs',async t=>{
 const {accounts,authorize,runtime}=await preview(t);
 const before=await accounts.snapshot('openai',false);
 const first=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:before.revision});
 assert.equal(first.state,'running');
 event({action:'login-result',platform:'openai',operationId:first.id,value:'succeeded'});
 const complete=await accounts.snapshot('openai',false);
 assert.equal(complete.operation?.id,first.id);
 assert.equal(complete.operation?.state,'succeeded');
 assert.equal(complete.candidate.state,'available');
 assert.equal(complete.candidate.identity_verified,true);
 assert.equal(complete.selection.state,'not_selected');
 assert.deepEqual((await runtime.snapshot()).platforms.openai.account,complete);
 const claude=await accounts.snapshot('claude',false);
 const second=await authorize.start({platform:'claude',source:{directory:null,store:'keychain'},expected_revision:claude.revision});
 assert.notEqual(second.id,first.id);
 event({action:'login-result',platform:'claude',operationId:second.id,value:'succeeded'});
 assert.equal((await accounts.snapshot('claude',false)).operation?.state,'succeeded');
 assert.equal((await authorize.status(first.id)).platform,'openai');
 const calls=(window as unknown as {calls:{command:string}[]}).calls;
 assert.equal(calls.filter(c=>c.command==='authorize_start').length,2);
 assert.equal(calls.filter(c=>c.command==='account_action').length,0);
});

test('candidate actions require confirmation, revision, live source and matching candidate; connect and change stay paused',async t=>{
 const {accounts,authorize,runtime}=await preview(t);
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 let current=await accounts.snapshot('openai',false);
 const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});
 event({action:'login-result',platform:'openai',operationId:login.id,value:'succeeded'});
 current=await accounts.snapshot('openai',false);
 const request={platform:'openai' as const,action:'select' as const,revision:current.revision,candidate_ref:current.candidate.reference!,confirmed:true};
 for(const change of [{confirmed:false},{revision:current.revision-1},{candidate_ref:'0'.repeat(48)}]){
  await assert.rejects(accounts.action({...request,...change}));
  assert.deepEqual(await accounts.snapshot('openai',false),current);
 }
 event({action:'account-source',platform:'openai',directory:null,store:'file',value:'denied'});
 await assert.rejects(accounts.action(request));
 assert.equal((await accounts.snapshot('openai',false)).selection.state,'not_selected');
 event({action:'account-source',platform:'openai',directory:null,store:'file',value:'available'});
 current=await accounts.detect({platform:'openai',directory:null,store:'file',mode:'official'});
 current=await accounts.action({...request,revision:current.revision,candidate_ref:current.candidate.reference!});
 assert.equal(current.selection.state,'selected');
 assert.equal((window as unknown as {paused:{openai:boolean}}).paused.openai,true);
 assert.equal((await runtime.snapshot()).local,'running');
 t.mock.timers.tick(601);
 await runtime.snapshot();
 current=await accounts.snapshot('openai',false);
 assert.equal(current.authorization.state,'synchronized');
 assert.equal(current.hive.state,'ready');
 assert.equal(current.hive.fingerprint,current.selection.fingerprint);
 const selected=current.selection.fingerprint;
 const next=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});
 assert.notEqual(next.id,login.id);
 event({action:'login-result',platform:'openai',operationId:next.id,value:'succeeded'});
 current=await accounts.snapshot('openai',false);
 assert.equal(current.selection.fingerprint,selected);
 assert.notEqual(current.candidate.fingerprint,selected);
 const changed=await accounts.action({platform:'openai',action:'confirm_change',revision:current.revision,candidate_ref:current.candidate.reference!,confirmed:true});
 assert.equal(changed.selection.fingerprint,current.candidate.fingerprint);
 assert.equal((window as unknown as {paused:{openai:boolean}}).paused.openai,true);
});

test('authorization rejects conflicts and isolates cancellation, replaced operations, source changes and reset',async t=>{
 const {accounts,authorize}=await preview(t);
 const initial=await accounts.snapshot('openai',false);
 await assert.rejects(authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:initial.revision-1}));
 assert.deepEqual(await accounts.snapshot('openai',false),initial);
 const first=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:initial.revision});
 await assert.rejects(authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:first.revision}));
 await assert.rejects(accounts.detect({platform:'openai',directory:'/tmp/different',store:'file',mode:'local'}));
 (window as unknown as {fail:string}).fail='openai';
 await assert.rejects(accounts.detect({platform:'openai',directory:null,store:'file',mode:'local'}));
 (window as unknown as {fail:string}).fail='';
 assert.equal((await authorize.cancel(first.id)).state,'cancelled');
 assert.throws(()=>event({action:'login-result',platform:'openai',operationId:first.id,value:'succeeded'}),/PREVIEW_LOGIN_STALE/);
 const current=await accounts.snapshot('openai',false);
 const second=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});
 assert.notEqual(first.id,second.id);
 await assert.rejects(authorize.status(first.id));
 assert.throws(()=>event({action:'login-result',platform:'claude',operationId:second.id,value:'succeeded'}),/PREVIEW_LOGIN_STALE/);
 event({action:'account-source',platform:'openai',directory:'/tmp/other',store:'file',value:'available'});
 assert.equal((await accounts.snapshot('openai',false)).operation?.state,'running');
 event({action:'account-source',platform:'openai',directory:null,store:'file',value:'available'});
 const invalidated=await accounts.snapshot('openai',false);
 assert.equal(invalidated.operation?.state,'failed');
 assert.equal(invalidated.operation?.error?.code,'source_changed');
 assert.throws(()=>event({action:'login-result',platform:'openai',operationId:second.id,value:'succeeded'}),/PREVIEW_LOGIN_STALE/);
 assert.equal((await accounts.snapshot('openai',false)).candidate.reference,null);
 const session=(window as unknown as {__beePreviewSession:string}).__beePreviewSession;
 await installPreviewFixture('account-empty');
 assert.throws(()=>applyPreviewEvent({session,action:'login-result',platform:'openai',operationId:second.id,value:'succeeded'}),/PREVIEW_SESSION_STALE/);
});

test('running-service login pauses its platform without restarting service; namespace and duplicate guards preserve accounts',async t=>{
 const {accounts,authorize,runtime}=await preview(t,'running');
 const initial=await accounts.snapshot('openai',false);
 const before=await runtime.snapshot(),otherPaused=(window as any).paused.claude;
 const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:initial.revision});
 assert.equal(login.state,'running');
 const admitted=await accounts.snapshot('openai',false);
 assert.deepEqual(admitted.selection,initial.selection);
 assert.equal((window as any).paused.openai,true);
 assert.equal((window as any).paused.claude,otherPaused);
 const running=await runtime.snapshot();
 assert.equal(running.local,'running');assert.equal(running.run_id,before.run_id);
 await assert.rejects(authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:admitted.revision}),/operation_pending/);
 assert.deepEqual(await accounts.snapshot('openai',false),admitted);
 assert.equal((window as any).calls.filter((c:any)=>['runtime_start','runtime_stop'].includes(c.command)).length,0);
 await installPreviewFixture('account-empty');
 const claude=await accounts.snapshot('claude',false);
 await assert.rejects(authorize.start({platform:'claude',source:{directory:null,store:'file'},expected_revision:claude.revision}));
 assert.deepEqual(await accounts.snapshot('claude',false),claude);
});

test('failed login can recover and an accepted action with unknown receipt is only read back',async t=>{
 const {accounts,authorize,runtime}=await preview(t);
 let current=await accounts.snapshot('openai',false);
 const failed=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});
 event({action:'login-result',platform:'openai',operationId:failed.id,value:'failed'});
 current=await accounts.snapshot('openai',false);
 assert.equal(current.operation?.state,'failed');
 assert.equal(current.operation?.error?.check,'official_process');
 assert.equal(current.candidate.reference,null);
 const recovered=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:current.revision});
 event({action:'login-result',platform:'openai',operationId:recovered.id,value:'succeeded'});
 current=await accounts.snapshot('openai',false);
 (window as unknown as {actionUnknown:boolean}).actionUnknown=true;
 await assert.rejects(accounts.action({platform:'openai',revision:current.revision,candidate_ref:current.candidate.reference!,action:'select',confirmed:true}),/RESPONSE_TIMEOUT/);
 const checked=await accounts.snapshot('openai',true),again=await runtime.snapshot();
 assert.equal(checked.operation?.kind,'select');
 assert.equal(checked.operation?.state,'succeeded');
 assert.equal(checked.selection.state,'selected');
 assert.equal(again.platforms.openai.account.operation?.id,checked.operation?.id);
 assert.equal((window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='account_action').length,1);
});

test('successful process exit still fails authorization when the owned source cannot be read',async t=>{
 const {accounts,authorize}=await preview(t);
 event({action:'account-source',platform:'openai',directory:null,store:'file',value:'denied'});
 const before=await accounts.snapshot('openai',false);
 const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:before.revision});
 event({action:'login-result',platform:'openai',operationId:login.id,value:'succeeded'});
 const failed=await accounts.snapshot('openai',false);
 assert.equal(failed.operation?.state,'failed');
 assert.equal(failed.operation?.error?.code,'permission_denied');
 assert.equal(failed.operation?.error?.evidence.permission_denied,'true');
 assert.equal(failed.candidate.reference,null);
 assert.equal(failed.selection.state,'not_selected');
});

test('only a proven unsubmitted account confirmation may continue and it keeps its original operation ID',async t=>{
 const {accounts}=await preview(t,'account-change');
 const initial=await accounts.snapshot('openai',false),id='9'.repeat(48);
 initial.operation={id,kind:'confirm_change',platform:'openai',state:'reconciling',revision:initial.revision,error:{code:'account_operation_unconfirmed',platform:'openai',check:'account_change_submission',message:'confirmation response unavailable; submission unconfirmed',evidence:{confirmed:'false'}}};
 installAccountFixture({accounts:{openai:initial,claude:accountFixture('claude')},runtimeEnabled:true});
 const request={platform:'openai' as const,revision:initial.revision,candidate_ref:initial.candidate.reference!,action:'confirm_change' as const,confirmed:true};
 await assert.rejects(accounts.action(request));
 assert.deepEqual(await accounts.snapshot('openai',false),initial);
 initial.operation.error!.code='confirmation_not_submitted';
 initial.operation.error!.message='confirmation was not submitted; required=explicit confirmation to continue';
 installAccountFixture({accounts:{openai:initial,claude:accountFixture('claude')},runtimeEnabled:true});
 const continued=await accounts.action(request);
 assert.equal(continued.operation?.state,'succeeded');
 assert.equal(continued.operation?.id,id);
 assert.equal(continued.selection.fingerprint,initial.candidate.fingerprint);
});

test('preview source observations preserve external quota facts and a changed login cannot inherit the old quota',async t=>{
 const {accounts,authorize}=await preview(t,'quota-expired');
 const original=await accounts.snapshot('openai',false);
 const observed=await accounts.detect({platform:'openai',directory:null,store:'file',mode:'official'});
 assert.deepEqual(observed.capabilities[0],original.capabilities[0]);
 await installPreviewFixture('account-change');
 const nextAccounts=createAccountClient(invoke,(await invoke<{metadata:{instance:string}}>('bridge_status')).metadata.instance);
 const change=await nextAccounts.snapshot('openai',false);
 const checked=await nextAccounts.detect({platform:'openai',directory:null,store:'file',mode:'official'});
 assert.deepEqual(checked.capabilities[0],change.capabilities[0]);
 const login=await authorize.start({platform:'openai',source:{directory:null,store:'file'},expected_revision:checked.revision});
 event({action:'login-result',platform:'openai',operationId:login.id,value:'succeeded'});
 const newIdentity=await nextAccounts.snapshot('openai',false);
 assert.equal(newIdentity.capabilities[0].windows.length,0);
});
