import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountFixture} from './fixtures/native-accounts.mjs';
import {accountPresentation} from '../src/features/accounts/accountPresentation.ts';
import * as presentation from '../src/features/accounts/accountPresentation.ts';
import type {AccountSnapshot} from '../src/system/accounts';
const now=Date.now();
test('waiting permits first official login with verified runtime and source prerequisites',()=>{
 const view=accountFixture('openai') as AccountSnapshot;
 view.features.authorize={available:true,reason:null};
 const input={view,platform:'openai' as const,now,dirty:false,busy:false,unknown:false,submissionBlocked:false,defaultsReady:true,runtime:{local:'waiting'},runtimeBlocked:false};
 assert.equal(presentation.accountActionBlock('authorize',input),null);
 assert.ok(presentation.accountActionBlock('authorize',{...input,runtimeBlocked:true}));
 assert.ok(presentation.accountActionBlock('authorize',{...input,defaultsReady:false}));
});
function selected(){const s=accountFixture('openai') as AccountSnapshot;s.selection={...s.selection,state:'selected',fingerprint:'b'.repeat(64)};s.candidate={...s.candidate,fingerprint:'b'.repeat(64),plan:'plus',expires_at:new Date(now+3600000).toISOString()};return s;}
test('cleared quota retains only same-account history and cannot become current evidence',()=>{
 const s=selected();Object.assign(s.capabilities[0],{status:'ready',observed_at:new Date(now).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:3,reset_at:null}]});
 const history=presentation.rememberAccountQuota(undefined,s,now);
 const latest=selected();latest.candidate.expires_at=new Date(now-1).toISOString();
 const result=accountPresentation(latest,false,now,false,false,history);
 assert.equal(result.quotaState,'stale');assert.equal(result.windows[0]?.used_percent,3);assert.equal(result.observedAt,new Date(now).toISOString());
 assert.equal(latest.capabilities[0].status,'unknown');assert.deepEqual(latest.capabilities[0].windows,[]);
 const emptyReport=structuredClone(latest);emptyReport.capabilities[0].observed_at=new Date(now+1).toISOString();
 assert.equal(accountPresentation(emptyReport,false,now,false,false,history).quotaState,'unknown');
 assert.equal(presentation.rememberAccountQuota(history,emptyReport,now),undefined);
 assert.equal(accountPresentation(latest,true,now,false,false,history).quotaState,'unknown');
 latest.candidate.fingerprint='c'.repeat(64);assert.equal(accountPresentation(latest,false,now,false,false,history).quotaState,'unknown');
 latest.selection.fingerprint='c'.repeat(64);assert.equal(presentation.rememberAccountQuota(history,latest,now),undefined);
});
test('unfinished login maintenance blocks new actions and permits only explicit identity confirmation when required',()=>{
 const view=selected();view.features.authorize={available:true,reason:null};view.features.confirm_change={available:true,reason:null};
 view.candidate={...view.candidate,state:'available',reference:'a'.repeat(48),fingerprint:'d'.repeat(64)};
 view.login_maintenance={operation:{id:'c'.repeat(48),kind:'authorize',platform:'openai',state:'failed',revision:2,error:null},phase:'blocked',source:{directory:null,store:'file'},started_at:'2026-11-01T01:02:03Z',can_recheck:true,error:null};
 const context={autoService:true,view,platform:'openai' as const,now,dirty:false,busy:false,unknown:false,submissionBlocked:false,defaultsReady:true,runtime:{local:'running'},runtimeBlocked:false};
 assert.match(presentation.accountActionBlock('authorize',context)!.message,/维护/);
 assert.ok(presentation.accountActionBlock('confirm_change',context));
 view.login_maintenance.phase='confirmation_required';
 assert.equal(presentation.accountActionBlock('confirm_change',context),null);
 assert.ok(presentation.accountActionBlock('authorize',context));
 view.login_maintenance.phase='restored';
 assert.equal(presentation.accountActionBlock('authorize',context),null);
});
test('selection identifies the account and mismatched candidate never lends its quota',()=>{const s=selected();s.candidate.fingerprint='c'.repeat(64);assert.deepEqual(accountPresentation(s,false,now),{identity:'bbbbbbbbbbbbbbbb',plan:null,expiresAt:null,observedAt:null,windows:[],quotaState:'unknown'});});
test('unknown stays unknown; fresh windows preserve null, scopes and raw 120 percent',()=>{const s=selected();assert.deepEqual(accountPresentation(s,false,now).windows,[]);s.capabilities[0]={...s.capabilities[0],status:'ready',observed_at:new Date(now).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:120,reset_at:null},{scope:'opus',seconds:604800,used_percent:null,reset_at:null}]};const p=accountPresentation(s,false,now);assert.equal(p.quotaState,'current');assert.deepEqual(p.windows,s.capabilities[0].windows);assert.equal(accountPresentation(s,true,now).quotaState,'unknown');s.capabilities[0].windows[0].reset_at=new Date(now-1).toISOString();assert.equal(accountPresentation(s,false,now).quotaState,'stale');});
test('fresh matching Hive wins over stale official and expiry invalidates official',()=>{const s=selected();for(const c of s.capabilities)Object.assign(c,{status:'ready',observed_at:new Date(now).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:c.origin==='official'?20:40,reset_at:null}]});s.hive.fingerprint=s.selection.fingerprint;assert.equal(accountPresentation(s,false,now).windows[0].used_percent,20);s.capabilities[0].valid_until=new Date(now-1).toISOString();assert.equal(accountPresentation(s,false,now).windows[0].used_percent,40);s.candidate.expires_at=new Date(now-1).toISOString();assert.equal(accountPresentation(s,false,now).quotaState,'stale');s.hive.fingerprint=null;assert.equal(accountPresentation(s,false,now).quotaState,'stale');});

test('valid_until determines freshness without imposing a ten minute report age',()=>{const s=selected();Object.assign(s.capabilities[0],{status:'ready',observed_at:new Date(now-3600000).toISOString(),valid_until:new Date(now+3600000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:null,reset_at:null}]});assert.equal(accountPresentation(s,false,now).quotaState,'current');assert.equal(accountPresentation(s,false,now).windows[0].used_percent,null);s.capabilities[0].windows=[];assert.equal(accountPresentation(s,false,now).quotaState,'unknown');});

test('historical quota carries the observation actually used and never borrows a different identity',()=>{
 const s=selected();s.hive.fingerprint=s.selection.fingerprint;
 const stamp=new Date(now-3600000).toISOString();Object.assign(s.capabilities[1],{status:'stale',observed_at:stamp,windows:[{scope:'',seconds:18000,used_percent:120,reset_at:null}]});
 assert.equal((accountPresentation(s,false,now) as any).observedAt,stamp);
 s.hive.fingerprint='c'.repeat(64);assert.equal((accountPresentation(s,false,now) as any).observedAt,null);
});
test('remote identity failure leaves fresh local quota current and marks retained fresh Hive quota unconfirmed',()=>{
 const s=selected();s.hive.fingerprint=s.selection.fingerprint;
 for(const c of s.capabilities)Object.assign(c,{status:'ready',observed_at:new Date(now).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:20,reset_at:null}]});
 assert.equal(accountPresentation(s,false,now,false,true).quotaState,'current');
 s.capabilities[0]={...s.capabilities[0],status:'unknown',observed_at:null,windows:[]};
 assert.equal(accountPresentation(s,false,now,false,true).quotaState,'unconfirmed');
});
test('candidate expiry and changed source explain blocked submission; official login requires stopped runtime',()=>{
 const block=(presentation as any).accountActionBlock;assert.equal(typeof block,'function');
 const s=selected();s.selection.state='not_selected';s.features.select={available:true,reason:null};s.features.authorize={available:true,reason:null};s.candidate.state='available';s.candidate.reference='a'.repeat(48);
 const input={view:s,platform:'openai',now,dirty:false,busy:false,unknown:false,submissionBlocked:false,defaultsReady:true,runtime:{local:'stopped'},runtimeBlocked:false};
 assert.equal(block('select',input),null);
 s.candidate.expires_at=new Date(now+30000).toISOString();assert.match(block('select',input).message,/过期|重新读取/);
 assert.equal(block('select',{...input,dirty:true}).target.section,'source');
 assert.deepEqual(block('authorize',{...input,runtime:{local:'running'}}).target,{page:'overview',section:'runtime'});
 assert.deepEqual(block('select',{...input,submissionBlocked:true}).target,{page:'overview',section:'device'});
 // Device identity cannot bar the independent, stopped official-client login.
 assert.equal(block('authorize',{...input,submissionBlocked:true}),null);
 const sharedReadFailure={code:'RESPONSE_TIMEOUT',check:'runtime_snapshot',observedAt:null,evidence:{actual:'no runtime response'},message:'runtime read response lost'};
 const sharedBlock=block('select',{...input,submissionBlocked:true,sharedReadFailure});
 assert.match(sharedBlock.message,/共享状态读取未确认/);assert.doesNotMatch(sharedBlock.message,/恢复设备身份/);assert.deepEqual(sharedBlock.target,{page:'overview',section:'runtime'});
 assert.deepEqual(block('select',{...input,submissionBlocked:true,sharedReadFailure:{...sharedReadFailure,check:'account_defaults'}}).target,{page:'accounts',section:'source',platform:'openai'});
});

test('missing source retains selected-account quota history without treating it as current',()=>{
 const before=selected();Object.assign(before.capabilities[0],{status:'ready',observed_at:new Date(now).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:0,reset_at:null},{scope:'',seconds:604800,used_percent:27,reset_at:null}]});
 const history=presentation.rememberAccountQuota(undefined,before,now);
 const missing=selected();missing.candidate={...missing.candidate,state:'source_missing',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,error:{platform:'openai',code:'source_missing',check:'read_file',message:'credential file not found',evidence:{not_found:'true'}}};
 const result=accountPresentation(missing,false,now,false,false,history);
 assert.equal(result.quotaState,'stale');assert.deepEqual(result.windows.map(w=>w.used_percent),[0,27]);assert.equal(result.plan,'plus');assert.equal(result.observedAt,new Date(now).toISOString());
 assert.equal(accountPresentation(missing,true,now,false,false,history).quotaState,'unknown');
 missing.selection.fingerprint='c'.repeat(64);assert.deepEqual(accountPresentation(missing,false,now,false,false,history).windows,[]);
 assert.deepEqual(missing.capabilities[0].windows,[]);
});

test('failed empty capability observation preserves prior quota as history, not a fresh empty report',()=>{
 const before=selected();Object.assign(before.capabilities[0],{status:'ready',observed_at:new Date(now-1000).toISOString(),valid_until:new Date(now+300000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:7,reset_at:null}]});
 const history=presentation.rememberAccountQuota(undefined,before,now);
 const failed=selected();Object.assign(failed.capabilities[0],{status:'unknown',observed_at:new Date(now).toISOString(),windows:[],error:{code:'official_check_failed',check:'capabilities',platform:'openai',message:'proxy connection refused',evidence:{http_status:'0',transport_failed:'true'}}});
 const remembered=presentation.rememberAccountQuota(history,failed,now);
 assert.deepEqual(remembered?.presentation.windows,history?.presentation.windows);assert.equal(remembered?.presentation.observedAt,history?.presentation.observedAt);assert.equal(remembered?.presentation.quotaState,'stale');
 const result=accountPresentation(failed,false,now,false,false,history);
 assert.equal(result.quotaState,'stale');assert.equal(result.windows[0]?.used_percent,7);assert.equal(result.observedAt,before.capabilities[0].observed_at);
 assert.equal(accountPresentation(failed,true,now,false,false,history).windows.length,0);
 failed.selection.fingerprint='c'.repeat(64);assert.equal(accountPresentation(failed,false,now,false,false,history).windows.length,0);
});
