import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeDiagnosticReport,type DiagnosticCheck} from '../src/system/diagnostics.ts';
import {partitionChecks} from '../src/features/diagnostics/presentation.ts';

const check=(id:DiagnosticCheck['id'],platform:DiagnosticCheck['platform'],status:DiagnosticCheck['status'],code:string):DiagnosticCheck=>({id,platform,status,code,observed_at:'2026-10-28T03:00:00Z',evidence:{http_status:'401'},next_action:platform?'accounts':'settings'});

test('presentation preserves each check and every reason while prioritizing device and platform issues',()=>{
 const checks=[check('device',null,'fail','device_not_paired'),check('authorization','openai','fail','authorization_expired'),check('quota','openai','warning','quota_exhausted'),check('source','claude','skipped','source_not_selected'),check('hive',null,'pass','hive_identity_verified'),check('quota','claude','fail','quota_exhausted')];
 const before=structuredClone(checks);const sections=partitionChecks(checks);
 assert.deepEqual(sections.issues.device,[checks[0]]);
 assert.deepEqual(sections.issues.openai,[checks[1],checks[2]]);
 assert.deepEqual(sections.issues.claude,[checks[5]]);
 assert.deepEqual(sections.unfinished,[checks[3]]);assert.deepEqual(sections.passed,[checks[4]]);
 const all=[...sections.issues.device,...sections.issues.openai,...sections.issues.claude,...sections.unfinished,...sections.passed];
 assert.equal(all.length,checks.length);assert.equal(new Set(all).size,checks.length);
 assert.ok(checks.every(value=>all.includes(value)));assert.deepEqual(checks,before);
});

test('empty, pending and unknown observations never become passed checks',()=>{
 assert.deepEqual(partitionChecks([]),{issues:{device:[],openai:[],claude:[]},unfinished:[],passed:[]});
 const checks=[check('source','openai','skipped','pending'),check('source','claude','skipped','unknown')];
 const result=partitionChecks(Object.freeze(checks));assert.deepEqual(result.unfinished,checks);assert.deepEqual(result.passed,[]);
});

test('diagnostic presentation separates local binding proof and exact remote recovery targets',async()=>{
 const {presentDiagnosticCheck}=await import('../src/features/diagnostics/presentation.ts');
 assert.equal(presentDiagnosticCheck(check('device',null,'pass','device_binding_valid')).message,'本机绑定信息完整；远端身份需单独核对。');
 assert.deepEqual(presentDiagnosticCheck(check('hive',null,'fail','device_replaced')).target,{page:'overview',section:'device'});
 assert.deepEqual(presentDiagnosticCheck(check('source','claude','fail','source_missing')).target,{page:'accounts',section:'source',platform:'claude'});
 assert.equal(presentDiagnosticCheck({...check('supply','openai','warning','supply_blocked'),evidence:{reason:'market_not_open'}}).target,null);
 assert.equal(presentDiagnosticCheck(check('source','openai','skipped','unknown_code')).message,'此项结果尚未确认，请查看检查详情。');
});

const hiveIdentityFailure=(change:Partial<DiagnosticCheck>={}):DiagnosticCheck=>{
 const instance='a'.repeat(32),observed_at='2026-10-28T03:00:00Z';
 return decodeDiagnosticReport({instance,result:{report:{id:'b'.repeat(48),instance,run_id:null,network_revision:0,binding_revision:0,started_at:observed_at,finished_at:observed_at,state:'completed',checks:[{id:'hive',platform:null,status:'fail',observed_at,code:'http_rejected',evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:'invalid_device_credential'},next_action:'diagnostics',...change}]}}},instance).checks[0];
};

test('real Hive device replacement DTO overrides its generic diagnostics next action',async()=>{
 const {presentDiagnosticCheck}=await import('../src/features/diagnostics/presentation.ts');
 const result=presentDiagnosticCheck(hiveIdentityFailure({code:'device_replaced',evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:'device_replaced'}}));
 assert.equal(result.message,'此设备已被替换，原设备凭据已撤销。');assert.deepEqual(result.target,{page:'overview',section:'device'});
});

test('only proven Hive identity 401 evidence presents an invalid device credential recovery',async()=>{
 const {presentDiagnosticCheck}=await import('../src/features/diagnostics/presentation.ts');
 const original=hiveIdentityFailure(),result=presentDiagnosticCheck(original);
 assert.equal(result.message,'Hive 已拒绝此设备凭据。');assert.deepEqual(result.target,{page:'overview',section:'device'});
 const changes:Partial<DiagnosticCheck>[]=[{id:'account',platform:'openai'},{evidence:{...original.evidence,path:'/api/bee/platforms/openai/account'}},{evidence:{...original.evidence,http_status:'403'}},{evidence:{...original.evidence,server_code:'unavailable'}},{evidence:{path:'/api/bee/identity',http_status:'401',server_code:'invalid_device_credential'}},{status:'pass',code:'hive_identity_verified'}];
 for(const change of changes){
  const presented=presentDiagnosticCheck(hiveIdentityFailure(change));assert.notEqual(presented.message,result.message);assert.equal(presented.target,null);
 }
});
