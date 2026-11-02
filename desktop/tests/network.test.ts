import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkClient,decodeNetworkSnapshot,decodeNetworkTestReply} from '../src/system/network.ts';
import {defaultPreferences} from '../src/system/preferences.ts';

const snapshot=()=>({saved_revision:2,effective_revision:1,saved_proxy:'http://127.0.0.1:7890',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=environment_proxy',hive:'process_environment',official_login:'official_client'},pending_restart:true,error:null});
const testReply=()=>({protocol:1,id:'2',instance:'a'.repeat(32),result:{network_test:{observed_at:'2026-10-27T00:00:00Z',checks:['local_proxy','openai_read_only','claude_read_only'].map(id=>({id,status:'ok',message:'Endpoint reachable; HTTP 401 does not prove authorization',path:'local_proxy',http_status:id==='local_proxy'?null:401}))}}});

test('network snapshot decodes the seven fixed saved and effective fields',()=>{
 assert.deepEqual(decodeNetworkSnapshot(snapshot()),snapshot());
 for(const mutate of [(v:any)=>v.scope='secret',(v:any)=>v.saved_revision=2**53,(v:any)=>v.pending_restart='true',(v:any)=>delete v.error,(v:any)=>v.paths.official='https://PRIVATE_PROXY_SECRET',(v:any)=>v.effective_proxy='http://u:PRIVATE_PROXY_SECRET@127.0.0.1:7890',(v:any)=>v.paths.relay=['direct']]){
  const value=snapshot();mutate(value);assert.throws(()=>decodeNetworkSnapshot(value),e=>e instanceof Error&&!e.message.includes('PRIVATE_PROXY_SECRET'));
 }
 const failed={...snapshot(),effective_revision:0,effective_proxy:'',paths:{...snapshot().paths,relay:'unknown',official:'unknown'},error:{code:'BRIDGE_NOT_READY',message:'bridge state=starting; required=ready'}};
 assert.deepEqual(decodeNetworkSnapshot(failed),failed);
 assert.throws(()=>decodeNetworkSnapshot({...failed,error:null}));
});

test('network tests accept exactly the three fixed checks and preserve HTTP evidence',()=>{
 const reply=testReply();assert.equal(decodeNetworkTestReply(reply).checks[1].http_status,401);
 for(const mutate of [(v:any)=>v.result.network_test.checks[0].id='arbitrary_endpoint',(v:any)=>v.result.network_test.checks.reverse(),(v:any)=>delete v.result.network_test.checks[0].http_status,(v:any)=>v.result.network_test.checks[1].http_status=600,(v:any)=>v.result.network_test.checks[1].path='http://PRIVATE_PROXY_SECRET',(v:any)=>v.result.network_test.observed_at='2026-02-30T00:00:00Z',(v:any)=>v.result.network_test.checks[0].message='unsafe\nvalue',(v:any)=>v.result.network_test.token='PRIVATE_PROXY_SECRET']){
  const value=testReply();mutate(value);assert.throws(()=>decodeNetworkTestReply(value),e=>e instanceof Error&&!e.message.includes('PRIVATE_PROXY_SECRET'));
 }
});

test('network client uses fixed native commands and revisioned scope-free save input',async()=>{
 const calls:unknown[]=[];
 const client=createNetworkClient(async(command,args)=>{calls.push([command,args]);if(command==='network_test')return testReply();if(command==='network_save_proxy')return {preferences:{...defaultPreferences(),revision:3},error:null};return snapshot();});
 await client.snapshot();await client.test('http://[::1]:7890');await client.saveProxy({proxy:'http://127.0.0.1:7890',origin:'https://hive.example',expectedRevision:2});await client.applySaved(true);
 assert.deepEqual(calls,[['network_snapshot',{}],['network_test',{proxy:'http://[::1]:7890'}],['network_save_proxy',{proxy:'http://127.0.0.1:7890',origin:'https://hive.example',expectedRevision:2}],['network_apply_saved',{confirmed:true}]]);
});

test('network client rejects unsafe proxy, origin, revision, scope and unconfirmed restart before invocation',async()=>{
 let calls=0;const client=createNetworkClient(async()=>{calls++;return snapshot();});
 for(const proxy of ['http://localhost:7890','http://remote.example:7890','socks5://127.0.0.1:7890','http://u:PRIVATE_PROXY_SECRET@127.0.0.1:7890'])await assert.rejects(()=>client.test(proxy));
 for(const request of [{proxy:'',origin:'https://hive.example/path',expectedRevision:0},{proxy:'',origin:'https://u:p@hive.example',expectedRevision:0},{proxy:'',origin:'http://remote.example',expectedRevision:0},{proxy:'',origin:null,expectedRevision:-1},{proxy:'',origin:null,expectedRevision:2**53},{proxy:'',origin:null,expectedRevision:0,scope:'injected'}])await assert.rejects(()=>client.saveProxy(request));
 await assert.rejects(()=>client.applySaved(false));assert.equal(calls,0);
});

test('network client preserves failed save and failed apply snapshots',async()=>{
 const failed={...snapshot(),error:{code:'NETWORK_STOP_UNCONFIRMED',message:'workers_stopped=false; all proofs required'}};
 const preferences={preferences:defaultPreferences(),error:{code:'PREFERENCES_REVISION_CONFLICT',message:'revision actual=2 expected=0'}};
 const client=createNetworkClient(async command=>command==='network_save_proxy'?preferences:failed);
 assert.deepEqual(await client.applySaved(true),failed);
 assert.deepEqual(await client.saveProxy({proxy:'',origin:null,expectedRevision:0}),preferences);
});

test('network stage feedback preserves concrete producer cause while naming only its proven failed stage',async()=>{
 const {presentFailure}=await import('../src/presentation/problems.ts');
 const {normalizeFailure}=await import('../src/system/failures.ts');
 for(const check of ['network_stop','network_configure','network_configure_readback','network_restore']){
  const problem=presentFailure(normalizeFailure({code:'RUNTIME_TIMEOUT',message:'owned runtime timed out: actual=40000ms required=30000ms',details:{check,observed_at:'2026-10-30T12:00:00Z',evidence:{actual:'40000',required:'30000'}}},'network_apply'),'en');
  assert.match(problem.summary,/stop|configuration|restor/i);assert.match(problem.details,/actual=40000ms/);assert.match(problem.details,/RUNTIME_TIMEOUT/);assert.equal(problem.action,null);
 }
});
