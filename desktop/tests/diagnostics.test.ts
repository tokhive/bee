import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import {en} from '../src/i18n/en.ts';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
import {decodeRuntimeSnapshot} from '../src/system/runtime.ts';
import {createPreferencesClient} from '../src/system/preferences.ts';
import {createDiagnosticsClient, decodeDiagnosticReport, decodeLogPage, decodeDiagnosticExport} from '../src/system/diagnostics.ts';

const instance='b'.repeat(32), id='a'.repeat(48), run='c'.repeat(32);
export const diagnosticReport=()=>({id,instance,run_id:run,network_revision:2,binding_revision:0,started_at:'2026-10-26T03:30:00Z',finished_at:null as string|null,state:'running',checks:[{id:'hive',platform:null,status:'pass',observed_at:'2026-10-26T03:30:01Z',code:'hive_identity_verified',evidence:{method:'GET',path:'/api/bee/identity'},next_action:'diagnostics'}]});
const reply=(report=diagnosticReport())=>({instance,result:{report}});
const log=()=>({time:'2026-10-26T03:30:01Z',level:'info',module:'diagnostics',platform:null,code:'hive_identity_verified',evidence:{method:'GET'}});
const exported=()=>({product:'Bee',app_version:'0.1.0',bee_version:'dev',os:'darwin',arch:'arm64',report:diagnosticReport(),logs:[log()],truncated:false,truncated_sections:[]});
test('diagnostics accepts explicit waiting while preserving the absence of contribution',()=>{
 const entry={...log(),module:'runtime',code:'runtime_waiting',evidence:{local:'waiting',connection:'connected'}};
 assert.deepEqual(decodeLogPage({entries:[entry],next_cursor:null,truncated:false}).entries,[entry]);
 const report=diagnosticReport() as import('../src/system/diagnostics.ts').DiagnosticReport;
 report.run_id=null;
 report.checks=[{id:'runtime',platform:null,status:'skipped',observed_at:entry.time,code:entry.code,evidence:entry.evidence,next_action:'overview'}];
 assert.deepEqual(decodeDiagnosticReport({instance,result:{report}},instance),report);
});

test('diagnostic DTOs accept the Rust nullable fields and fixed event shape',()=>{
 assert.deepEqual(decodeDiagnosticReport(reply(),instance),diagnosticReport());
 const page={entries:[log()],next_cursor:'v1:123:2:1:12345678',truncated:false};
 assert.deepEqual(decodeLogPage(page),page);
 assert.deepEqual(decodeDiagnosticExport(exported(),instance),exported());
});
test('diagnostic report rejects unknown checks, false passes, unsafe evidence and malformed identity without echo',()=>{
 const mutations=[(r:any)=>r.instance='d'.repeat(32),(r:any)=>r.run_id='MARKER',(r:any)=>r.network_revision=2**53,(r:any)=>r.checks[0].id='MARKER',(r:any)=>r.checks[0].code='unknown',(r:any)=>r.checks[0].status='MARKER',(r:any)=>r.checks[0].evidence.token='MARKER',(r:any)=>r.checks[0].evidence.path='/Users/MARKER',(r:any)=>r.checks[0].next_action='MARKER',(r:any)=>r.checks.push(structuredClone(r.checks[0])),(r:any)=>r.started_at='2026-02-30T03:30:00Z',(r:any)=>delete r.finished_at,(r:any)=>r.checks[0].observed_at='2099-01-01T00:00:00Z'];
 for(const mutate of mutations){const r=diagnosticReport();mutate(r);assert.throws(()=>decodeDiagnosticReport(reply(r),instance),e=>e instanceof Error&&!e.message.includes('MARKER'));}
});
test('logs and exports reject free text, invalid filters, malformed truncation and secret metadata',()=>{
 for(const mutate of [(v:any)=>v.entries[0].message='MARKER',(v:any)=>v.entries[0].evidence.http_status='MARKER',(v:any)=>v.entries[0].code='MARKER',(v:any)=>v.next_cursor='MARKER',(v:any)=>v.entries=Array(201).fill(log())]){
  const v:any={entries:[log()],next_cursor:null,truncated:false};mutate(v);assert.throws(()=>decodeLogPage(v),e=>e instanceof Error&&!e.message.includes('MARKER'));
 }
 for(const mutate of [(v:any)=>v.app_version='/Users/MARKER',(v:any)=>v.logs[0].evidence.token='MARKER',(v:any)=>v.truncated_sections=['MARKER'],(v:any)=>{v.truncated_sections=['logs'];}]){
  const v=exported();mutate(v);assert.throws(()=>decodeDiagnosticExport(v,instance),e=>e instanceof Error&&!e.message.includes('MARKER'));
 }
});
test('exports accept the actual development build identity without admitting arbitrary metadata',()=>{
 for(const bee_version of ['dev+d9e9ca44be57','dev+d9e9ca44be57-dirty']){
  const value={...exported(),bee_version};assert.deepEqual(decodeDiagnosticExport(value,instance),value);
 }
 for(const bee_version of ['dev+MARKER','dev+/Users/MARKER','dev+'+'a'.repeat(40),'dev+abcdef012345-secret']){
  assert.throws(()=>decodeDiagnosticExport({...exported(),bee_version},instance),e=>e instanceof Error&&!e.message.includes('MARKER'));
 }
});
test('diagnostics client caches reports without starting on construction and sends only typed commands',async()=>{
 const calls:unknown[]=[];const client=createDiagnosticsClient(async(command,args)=>{calls.push([command,args]);if(command==='diagnostic_logs')return {entries:[],next_cursor:null,truncated:false};if(command==='diagnostics_export')return exported();return reply();},instance,2,run);
 assert.equal(client.getSnapshot(),null);assert.equal(calls.length,0);
 await client.start();await client.snapshot(id);await client.cancel(id);
 await client.logs({cursor:null,limit:20,module:null,platform:null,level:null});
 await client.export(id,true);
 assert.equal(client.getSnapshot()?.id,id);
 assert.deepEqual(calls,[['diagnostics_start',{}],['diagnostics_snapshot',{id}],['diagnostics_cancel',{id}],['diagnostic_logs',{query:{cursor:null,limit:20,module:null,platform:null,level:null}}],['diagnostics_export',{reportId:id,includeLogs:true}]]);
 await assert.rejects(client.snapshot('MARKER'),/id/);
 await assert.rejects(client.logs({cursor:null,limit:201,module:null,platform:null,level:null}),/limit/);
 assert.equal(calls.length,5);
});
test('safe native logs remain readable without a management instance while report actions fail before transport',async()=>{
 const calls:string[]=[];const page={entries:[log()],next_cursor:null,truncated:false};
 const client=createDiagnosticsClient(async command=>{calls.push(command);return page;},undefined);
 assert.deepEqual(await client.logs({cursor:null,limit:20,module:null,platform:null,level:null}),page);
 for(const action of [()=>client.start(),()=>client.snapshot(id),()=>client.cancel(id),()=>client.export(id,false)])await assert.rejects(action,/management instance.*missing/);
 assert.deepEqual(calls,['diagnostic_logs']);assert.equal(client.getSnapshot(),null);
});
test('network/run context changes invalidate the cache and discard in-flight replies',async()=>{
 let resolve!:(v:unknown)=>void;const client=createDiagnosticsClient(()=>new Promise(r=>{resolve=r;}),instance,2,run);
 const pending=client.start();client.setContext(3,run);resolve(reply());
 await assert.rejects(pending,/context|revision/);assert.equal(client.getSnapshot(),null);
 const next=client.start();client.setContext(3,'d'.repeat(32));resolve(reply({...diagnosticReport(),network_revision:3}));
 await assert.rejects(next,/context|run/);assert.equal(client.getSnapshot(),null);
});
test('diagnostics rejects wrong report IDs, old revisions and terminal reports returning to running',async()=>{
 let response:any=reply();const client=createDiagnosticsClient(async()=>response,instance,2,run);
 await client.start();response=reply({...diagnosticReport(),id:'d'.repeat(48)});await assert.rejects(client.snapshot(id),/id/);
 response=reply({...diagnosticReport(),network_revision:1});await assert.rejects(client.snapshot(id),/revision/);
 response=reply({...diagnosticReport(),state:'completed',finished_at:'2026-10-26T03:31:00Z'});await client.snapshot(id);
 response=reply();await assert.rejects(client.snapshot(id),/terminal|regress/);
});

test('native payload download waits for matching receipt and keeps success, failure and unknown distinct',async t=>{
 const {downloadPayload}=await import('../src/features/diagnostics/report.ts');
 assert.equal(typeof downloadPayload,'function');
 const callbacks=new Map<number,(event:unknown)=>void>(),subscriptions=new Set<number>();let sequence=0,clicks=0;
 const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 t.after(()=>{if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else Reflect.deleteProperty(globalThis,'window');if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else Reflect.deleteProperty(globalThis,'document');Reflect.deleteProperty(globalThis,'isTauri');});
 Object.assign(globalThis,{isTauri:true,window:{__TAURI_INTERNALS__:{transformCallback(fn:(e:unknown)=>void){callbacks.set(++sequence,fn);return sequence;},unregisterCallback(id:number){callbacks.delete(id);},async invoke(command:string,args:any){if(command==='plugin:event|listen'){subscriptions.add(args.handler);return args.handler;}if(command==='plugin:event|unlisten'){subscriptions.delete(args.eventId);return;}throw Error('unexpected transport command');}},__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener(_event:string,id:number){callbacks.delete(id);}}},document:{body:{append(){}},createElement(){return {href:'',download:'',click(){assert.ok(subscriptions.size>0);clicks++;},remove(){}};}}});
 t.mock.method(URL,'createObjectURL',()=>`blob:report-${clicks}`);t.mock.method(URL,'revokeObjectURL',()=>{});
 t.mock.timers.enable({apis:['setTimeout']});
 const finish=(url:string,success:boolean)=>{for(const callback of callbacks.values())callback({payload:{url,success}});};
 const first=downloadPayload(new Blob(['{}']),'bee-diagnostics.json');await setImmediate();
 finish('blob:other',true);assert.equal(subscriptions.size,1);finish('blob:report-0',true);
 assert.equal(await first,'completed');assert.equal(callbacks.size,0);assert.equal(subscriptions.size,0);
 const second=downloadPayload(new Blob(['{}']),'bee-diagnostics.json');await setImmediate();finish('blob:report-1',false);await assert.rejects(second,/success=false/);
 const third=downloadPayload(new Blob(['{}']),'bee-diagnostics.json');await setImmediate();t.mock.timers.tick(30001);assert.equal(await third,'unconfirmed');assert.equal(callbacks.size,0);
});

test('native diagnostics and settings copy have complete English translations without translating evidence values',()=>{
 const source=['../src/features/diagnostics/NativeDiagnosticsPage.tsx','../src/features/settings/NativeSettingsPage.tsx'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8')).join('\n');
 const keys=[...source.matchAll(/(['"])([^'"\n]*[\u4e00-\u9fff][^'"\n]*)\1/g)].map(match=>match[2]);
 const missing=[...new Set(keys)].filter(key=>!Object.hasOwn(en,key));
 assert.deepEqual(missing,[]);
 for(const key of new Set(keys))assert.doesNotMatch(en[key],/[\u4e00-\u9fff]/);
});

test('native fixtures use real instance/runtime/preferences contracts and isolate download subscriptions',async t=>{
 const saved=Object.getOwnPropertyDescriptor(globalThis,'window');
 const windowFixture:any={};Object.defineProperty(globalThis,'window',{value:windowFixture,configurable:true});
 t.after(()=>{if(saved)Object.defineProperty(globalThis,'window',saved);else Reflect.deleteProperty(globalThis,'window');});
 installAccountFixture({runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 const native=windowFixture.__TAURI_INTERNALS__,invoke=native.invoke;
 const status=await invoke('bridge_status',{});assert.match(status.metadata.instance,/^[a-f0-9]{32}$/);
 const snapshot=decodeRuntimeSnapshot(await invoke('runtime_snapshot',{}),status.metadata.instance);assert.equal(snapshot.platforms.openai.account.capabilities.length,2);
 const preferences=await createPreferencesClient(invoke).read();assert.equal(preferences.preferences.version,1);
 const client=createDiagnosticsClient(invoke,status.metadata.instance,0,null,1);const first=await client.start();assert.equal(first.state,'running');assert.equal((await client.snapshot(first.id)).state,'completed');
 let bridgeEvents=0,downloads=0;const bridgeHandler=native.transformCallback(()=>bridgeEvents++),downloadHandler=native.transformCallback(()=>downloads++);
 await invoke('plugin:event|listen',{event:'bee://bridge-status',handler:bridgeHandler});await invoke('plugin:event|listen',{event:'bee://download-finished',handler:downloadHandler});
 windowFixture.emit('d'.repeat(32));windowFixture.emitDownload('blob:test',true);assert.equal(bridgeEvents,1);assert.equal(downloads,1);
});

test('diagnostic reports logs and exports retain defined detailed supply reason evidence',()=>{
 for(const platform of ['openai','claude'])for(const reason of ['account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted']){
  const r={...diagnosticReport(),checks:[{id:'supply',platform,status:'fail',observed_at:'2026-10-26T03:30:01Z',code:'supply_blocked',evidence:{reason},next_action:'overview'}]};
  assert.deepEqual(decodeDiagnosticReport({instance,result:{report:r}},instance),r);
  const event={...log(),platform,code:'supply_blocked',evidence:{reason}};
  const page={entries:[event],next_cursor:null,truncated:false};
  assert.deepEqual(decodeLogPage(page),page);
  const data={...exported(),report:r,logs:[event]};
  assert.deepEqual(decodeDiagnosticExport(data,instance),data);
  assert.throws(()=>decodeDiagnosticReport({instance,result:{report:{...r,checks:[{...r.checks[0],evidence:{reason:'unrecognized_reason'}}]}}},instance),/DIAGNOSTICS_REPLY_INVALID/);
 }
});
test('binding changes invalidate cached and in-flight diagnostic reports',async()=>{
 let resolve!:(value:unknown)=>void;
 const client=createDiagnosticsClient(()=>new Promise(r=>{resolve=r;}),instance,2,run,1);
 const pending=client.start();client.setContext(2,run,2);
 resolve(reply({...diagnosticReport(),binding_revision:1}));
 await assert.rejects(pending,/context changed/);
 assert.equal(client.getSnapshot(),null);
});
test('completed reports cannot be displayed or exported under a replacement binding',async()=>{
 let requests=0;const terminal={...diagnosticReport(),binding_revision:1,state:'completed',finished_at:'2026-10-26T03:30:02Z'};
 const client=createDiagnosticsClient(async()=>{requests++;return reply(terminal);},instance,2,run,1);
 await client.start();assert.equal(client.getSnapshot()?.state,'completed');client.setContext(2,run,2);assert.equal(client.getSnapshot(),null);
 await assert.rejects(client.export(id,false),/current cached report/);assert.equal(requests,1);
});


test('lost start receipt fences another start until the diagnostic scope changes',async()=>{
 let starts=0,lose=true;
 const client=createDiagnosticsClient(async()=>{starts++;if(lose)throw {code:'IPC_TIMEOUT',message:'start accepted but receipt lost'};return reply();},instance,2,run);
 await assert.rejects(client.start());
 await assert.rejects(client.start());
 assert.equal(starts,1,'an unknown start must never be replayed');
 assert.equal(client.getSnapshot(),null);
 lose=false;client.setContext(3,run);
 await assert.rejects(client.start(),/revision/);assert.equal(starts,2);
});
test('lost cancel receipt permits only reading the original ID, never another cancel',async()=>{
 const commands:string[]=[];let state='running';
 const client=createDiagnosticsClient(async(command,args)=>{commands.push(command);if(command==='diagnostics_cancel')throw {code:'IPC_TIMEOUT',message:'cancel receipt lost'};return reply({...diagnosticReport(),state,finished_at:state==='running'?null:'2026-10-26T03:31:00Z'});},instance,2,run);
 await client.start();await assert.rejects(client.cancel(id));await assert.rejects(client.cancel(id));
 assert.equal(commands.filter(c=>c==='diagnostics_cancel').length,1);
 state='cancelled';assert.equal((await client.snapshot(id)).state,'cancelled');assert.equal(client.getSnapshot()?.id,id);
});
test('concurrent reads of the original report share one request and preserve its last checks on failure',async()=>{
 let release!:(value:unknown)=>void,reads=0;
 const client=createDiagnosticsClient(async command=>{if(command==='diagnostics_snapshot'){reads++;return new Promise(resolve=>release=resolve);}return reply();},instance,2,run);
 await client.start();const one=client.snapshot(id),two=client.snapshot(id);assert.equal(reads,1);
 release(reply());await Promise.all([one,two]);assert.equal(client.getSnapshot()?.checks.length,1);
});

test('a failed read after unknown cancellation retains both exact failures in the scoped session',async()=>{
 const client=createDiagnosticsClient(async command=>{if(command==='diagnostics_cancel')throw {code:'IPC_TIMEOUT',message:'cancel reply lost: request sent'};if(command==='diagnostics_snapshot')throw {code:'IPC_TIMEOUT',message:'original report read failed: attempt=1'};return reply();},instance,2,run);
 await client.start();await assert.rejects(client.cancel(id));await assert.rejects(client.snapshot(id));
 assert.match(client.getSession().failure!.message,/cancel reply lost/);assert.match(client.getSession().readFailure!.message,/original report read failed/);assert.equal(client.getSnapshot()?.id,id);
});
test('a late original report read cannot replace a newer explicitly started diagnostic in the same scope',async()=>{
 let release!:(value:unknown)=>void,starts=0;
 const client=createDiagnosticsClient(async command=>{if(command==='diagnostics_snapshot')return new Promise(resolve=>release=resolve);starts++;return reply({...diagnosticReport(),id:starts===1?id:'d'.repeat(48),state:'completed',finished_at:'2026-10-26T03:31:00Z'});},instance,2,run);
 await client.start();const old=client.snapshot(id);await client.start();release(reply({...diagnosticReport(),state:'completed',finished_at:'2026-10-26T03:31:00Z'}));
 await assert.rejects(old,/superseded/);assert.equal(client.getSnapshot()?.id,'d'.repeat(48));
});

test('a running cancel receipt remains unconfirmed and only a terminal read settles it',async()=>{
 let state='running',cancels=0;
 const client=createDiagnosticsClient(async command=>{if(command==='diagnostics_cancel')cancels++;return reply({...diagnosticReport(),state,finished_at:state==='running'?null:'2026-10-26T03:31:00Z'});},instance,2,run);
 await client.start();await client.cancel(id);assert.equal(client.getSession().cancel,'unknown');await assert.rejects(client.cancel(id));
 await client.snapshot(id);assert.equal(client.getSession().cancel,'unknown');state='cancelled';await client.snapshot(id);assert.equal(client.getSession().cancel,'idle');assert.equal(cancels,1);
});
test('a late export payload or delivery receipt cannot alter a newer report session',async()=>{
 for(const delayed of ['payload','delivery']){
  let release!:(value:any)=>void,starts=0,deliveries=0;
  const terminal={...diagnosticReport(),state:'completed',finished_at:'2026-10-26T03:31:00Z'};
  const client=createDiagnosticsClient(async command=>{if(command==='diagnostics_export'){const payload={...exported(),logs:[],report:terminal};if(delayed==='payload')return new Promise(resolve=>release=resolve);return payload;}starts++;return reply({...terminal,id:starts===1?id:'d'.repeat(48)});},instance,2,run);
  await client.start();const pending=client.download(id,false,async()=>{deliveries++;return new Promise(resolve=>release=resolve);});
  if(delayed==='delivery')await setImmediate();await client.start();release(delayed==='payload'?{...exported(),logs:[],report:terminal}:'completed');
  await assert.rejects(pending,/superseded/);assert.equal(client.getSession().download,'idle');assert.equal(client.getSession().downloadFailure,null);assert.equal(deliveries,delayed==='payload'?0:1);
 }
});

test('safe request lifecycle logs preserve bounded retry and HTTP failure evidence',()=>{
 const entry={...log(),code:'request_timed_out',evidence:{request_id:'shell-89',method:'supply_status',platform:'openai',phase:'response',queue_ms:'3',execution_ms:'15000',fully_sent:'true',in_flight:'true'}};
 assert.equal(decodeLogPage({entries:[entry],next_cursor:null,truncated:false}).entries[0].evidence.request_id,'shell-89');
 for(const code of ['request_settled','request_http_started','request_http_finished','request_http_failed'])assert.equal(decodeLogPage({entries:[{...entry,code,evidence:{method:'POST',phase:'http_error',elapsed_ms:'12000',retry_after_seconds:'30',failure_kind:'dns_temporary',path:'/api/bee/pairings/redeem'}}],next_cursor:null,truncated:false}).entries[0].code,code);
 for(const value of ['temporary_network','tls_failure','secret'])assert.throws(()=>decodeLogPage({entries:[{...entry,evidence:{failure_kind:value}}],next_cursor:null,truncated:false}),/contract/);
});
