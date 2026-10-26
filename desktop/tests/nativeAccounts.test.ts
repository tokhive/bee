import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountClient,decodeAccountReply,decodeAccountDefaults} from '../src/system/accounts.ts';
export const fixtureAccount=(platform='openai')=>({platform,revision:1,candidate:{state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),plan:platform==='openai'?'plus':'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:false,observed_at:'2026-10-26T00:00:00.123456789Z',error:null},selection:{state:'not_selected',fingerprint:null,observed_at:null,error:null},hive:{state:'unbound',fingerprint:null,pending_fingerprint:null,generation:null,observed_at:null,error:null},authorization:{state:'local_structure_only',fingerprint:null,observed_at:null,error:null},capabilities:['official','hive'].map(origin=>({origin,status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null})),features:Object.fromEntries(['detect','check','select','confirm_change','remove','clear_selection','authorize','system_notifications'].map(key=>[key,{available:['detect','check'].includes(key),reason:['detect','check'].includes(key)?null:'runtime_ownership_and_source_barrier_required'}])),issues:[],checked_at:'2026-10-26T00:00:00Z'});
const wrap=(account:unknown,instance='one')=>({id:'fixture',instance,result:{account}});
test('account decoder accepts full public DTO and nanosecond UTC timestamps, preserving unknowns and 120%',()=>{
 const account=fixtureAccount();account.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:120,reset_at:'2099-01-01T00:00:00Z'}] as never[];
 assert.deepEqual(decodeAccountReply(wrap(account),'openai','one'),account);
});
test('account decoder rejects missing, unknown, unsafe identity/time/quota fields without echoing payload',()=>{
 const mutations:((a:any)=>void)[]=[a=>{delete a.candidate},a=>a.token='SECRET_PAYLOAD',a=>a.platform='claude',a=>a.revision=1.1,a=>a.candidate.fingerprint='SECRET_PAYLOAD',a=>a.candidate.observed_at='2026-02-30T00:00:00Z',a=>a.candidate.expires_at=0,a=>a.candidate.plan='SECRET_PAYLOAD',a=>a.candidate.source.directory='relative',a=>a.candidate.source.store='keychain',a=>a.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:-1,reset_at:null}],a=>a.capabilities[0].models=[{id:'user@private.test',account_supported:true,market_open:null,accepting:null}],a=>a.capabilities[0].models=[{id:'gpt-5',account_supported:true,market_open:true,accepting:null}],a=>a.hive.confirmation_id='SECRET_PAYLOAD',a=>a.hive.pending_fingerprint='SECRET_PAYLOAD',a=>a.features.select.available=true];
 for(const mutate of mutations){const account=fixtureAccount();mutate(account);assert.throws(()=>decodeAccountReply(wrap(account),'openai','one'),e=>e instanceof Error&&e.message.includes('ACCOUNT_REPLY_INVALID')&&!e.message.includes('SECRET_PAYLOAD'));}
 assert.throws(()=>decodeAccountReply(wrap(fixtureAccount(),'old'),'openai','one'),/instance/);
});
test('defaults decode both platform store capabilities and reject unknown fields',()=>{
 const defaults={platforms:[{platform:'openai',directory:'/tmp/codex',default_store:'auto',stores:[{store:'auto',supported:true,reason:null},{store:'file',supported:true,reason:null},{store:'keyring',supported:false,reason:'macOS required'}]},{platform:'claude',directory:'/tmp/claude',default_store:'file',stores:[{store:'file',supported:true,reason:null},{store:'keychain',supported:false,reason:'macOS required'}]}]};
 assert.deepEqual(decodeAccountDefaults({instance:'one',result:{defaults}},'one'),defaults);
 assert.throws(()=>decodeAccountDefaults({instance:'one',result:{defaults:{...defaults,secret:'SECRET_PAYLOAD'}}},'one'),/ACCOUNT_REPLY_INVALID/);
});
test('typed client sends fixed commands, never replays writes, and invalidates old source promises',async()=>{
 const calls:unknown[]=[];let release!:(value:unknown)=>void;
 const client=createAccountClient(async(command,args)=>{calls.push([command,args]);if(command==='account_detect')return new Promise(resolve=>{release=resolve;});return wrap(fixtureAccount());},'one');
 const pending=client.detect({platform:'openai',directory:null,store:'file',mode:'local'});client.invalidate('openai');release(wrap(fixtureAccount()));await assert.rejects(pending,/superseded/);
 await client.snapshot('openai',false);
 assert.deepEqual(calls as unknown, [['account_detect',{request:{platform:'openai',directory:null,store:'file',mode:'local'}}],['account_snapshot',{platform:'openai',refresh:false}]]);
 await assert.rejects(client.detect({platform:'openai',directory:'relative',store:'file',mode:'local'}),/directory/);assert.equal(calls.length,2);
 const failing=createAccountClient(async(command,args)=>{calls.push([command,args]);return {instance:'one',result:{error:{code:'ACCOUNT_OPERATION_FAILED',message:'runtime proof absent; check=runtime_ownership'}}};},'one');
 await assert.rejects(failing.action({platform:'openai',revision:1,candidate_ref:'a'.repeat(48),action:'select',confirmed:true}),/runtime_ownership/);assert.equal(calls.length,3);
});
