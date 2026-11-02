import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeBridgeError,normalizeFailure,safeFailureText} from '../src/system/failures.ts';
import {presentFailure} from '../src/presentation/problems.ts';
import {formatDate,formatNumber,translate} from '../src/i18n/index.ts';
import {validNavigationTarget} from '../src/app/navigation.ts';
const observed='2026-10-30T12:00:00Z';
const failure=(code='http_rejected')=>normalizeFailure({code,message:'GET /api/bee/identity: HTTP 503; upstream maintenance',details:{check:'device_identity',observed_at:observed,evidence:{target_origin:'https://hive.test',path:'/api/bee/identity',http_status:'503',response_body:'upstream maintenance'}}},'device_status');
test('Chinese 503 device feedback includes fact, target, impact and safe original in one notice',()=>{
 const result=presentFailure(failure(),'zh');
 assert.match(result.summary,/503/);assert.match(result.summary,/Hive/);assert.match(result.impact,/设备/);assert.match(result.details,/https:\/\/hive.test/);assert.match(result.details,/upstream maintenance/);assert.equal(result.action,null);
});
test('device replacement keeps its exact cause and provides the device entry',()=>{
 const problem=presentFailure({...failure('device_replaced'),evidence:{http_status:'401',remote_code:'device_replaced'}},'zh');
 assert.match(problem.summary,/替换/);assert.doesNotMatch(problem.summary,/未确认|代理/);assert.deepEqual(problem.action,{page:'overview',section:'device'});
});
test('selected source missing and denied access do not claim the whole machine has no login',()=>{
 const missing=normalizeFailure({code:'source_missing',check:'source_read',platform:'openai',message:'file absent',evidence:{not_found:'true',permission_denied:'false'}},'detect');
 const denied=normalizeFailure({code:'permission_denied',check:'source_read',platform:'openai',message:'access denied',evidence:{not_found:'false',permission_denied:'true'}},'detect');
 assert.match(presentFailure(missing,'zh').summary,/所选|选定/);assert.doesNotMatch(presentFailure(missing,'zh').summary,/本机未登录|没有.*登录/);
 assert.match(presentFailure(denied,'zh').summary,/权限/);assert.doesNotMatch(presentFailure(denied,'zh').summary,/未找到/);
 assert.match(presentFailure({...denied,code:'source_unavailable'},'zh').summary,/权限/);
});

test('recovery navigation rejects invalid page/section/platform combinations and types',()=>{
 assert.equal(validNavigationTarget({page:'accounts',section:'source',platform:'openai'}),true);
 for(const target of [{page:'overview',section:'source'},{page:'settings',section:'source'},{page:'accounts',platform:['openai']},{page:'accounts',platform:{toString:()=> 'openai'}}])assert.equal(validNavigationTarget(target),false);
});
test('the same stored error immediately renders in either locale and unknown codes do not invent a reason',()=>{
 const value=failure('device_replaced'),before=structuredClone(value);
 assert.match(presentFailure(value,'zh').summary,/替换/);assert.match(presentFailure(value,'en').summary,/replaced/);assert.deepEqual(value,before);
 const unknown=presentFailure({...value,code:'future_reason',evidence:{}},'zh');assert.match(unknown.summary,/失败/);assert.doesNotMatch(unknown.summary,/替换|权限|代理|断开/);assert.equal(unknown.action,null);assert.match(unknown.details,/future_reason/);
});
test('normalization never serializes arbitrary exceptions or sensitive text',()=>{
 const value=normalizeFailure({message:'Bearer TEST_SECRET token=TOKEN_SECRET https://user:pass@hive.test/x?key=URL_SECRET#fragment',privateKey:'PRIVATE_SECRET'},'read');
 const text=JSON.stringify(value);for(const secret of ['TEST_SECRET','TOKEN_SECRET','URL_SECRET','fragment','user:pass','PRIVATE_SECRET'])assert.ok(!text.includes(secret),secret);
 assert.deepEqual(value.evidence,{});assert.match(value.message,/redacted/);
 assert.ok(!safeFailureText('https://hive.test?token=SECRET').includes('SECRET'));
});
test('private details enforce fields, calendar, future bounds, safe evidence and lengths while legacy errors remain valid',()=>{
 assert.deepEqual(decodeBridgeError({code:'LEGACY',message:'safe'}),{code:'LEGACY',message:'safe'});
 const good={code:'http_rejected',message:'safe',details:{check:'device_identity',observed_at:observed,evidence:{}}};
 assert.deepEqual(decodeBridgeError(good),good);
 for(const details of [null,{...good.details,x:1},{...good.details,observed_at:'2026-02-30T00:00:00Z'},{...good.details,observed_at:'2099-01-01T00:00:00Z'},{...good.details,evidence:{token:'secret'}},{...good.details,evidence:{http_status:'0'}},{...good.details,evidence:{actual:'token=SECRET'}},{...good.details,evidence:{response_body:'x'.repeat(32769)}}])assert.throws(()=>decodeBridgeError({...good,details}),/BRIDGE_REPLY_INVALID/);
});

test('details preserve all safe Go origin spellings and reject unsafe authority spellings',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../../desktopbridge/testdata/connection-origin-contract.json',import.meta.url),'utf8'));
 for(const item of fixture.accepted){const origin=item.hive;const e=decodeBridgeError({code:'http_rejected',message:'failure',details:{check:'device_identity',observed_at:observed,evidence:{target_origin:origin}}});assert.equal(e.details?.evidence.target_origin,origin);}
 for(const origin of fixture.rejected)assert.throws(()=>decodeBridgeError({code:'http_rejected',message:'failure',details:{check:'device_identity',observed_at:observed,evidence:{target_origin:origin}}}));
});

test('invalid detail rejection retains the safe original failure without unsafe evidence',()=>{
 const result=normalizeFailure({code:'http_rejected',message:'HTTP 503 upstream maintenance; token=TOKEN_SECRET',details:{check:'device_identity',observed_at:observed,evidence:{token:'SECRET'}}},'device_status');
 assert.equal(result.code,'FAILURE_DETAILS_INVALID');assert.match(result.message,/HTTP 503 upstream maintenance/);assert.ok(!result.message.includes('TOKEN_SECRET'));assert.deepEqual(result.evidence,{});
});
test('explicit locale formatting and placeholders follow the App language',()=>{
 const date='2026-10-30T12:34:56Z';
 for(const locale of ['zh','en']as const){
  const tag=locale==='zh'?'zh-CN':'en-US';
  assert.equal(formatNumber(12345.67,locale),new Intl.NumberFormat(tag).format(12345.67));
  assert.equal(formatDate(date,locale,{timeZone:'UTC'}),new Intl.DateTimeFormat(tag,{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'}).format(new Date(date)));
  const text=translate('Hive 拒绝了本次请求（HTTP {status}）。',locale,{status:503});assert.match(text,/503/);assert.doesNotMatch(text,/\{status\}/);
 }
 assert.notEqual(formatDate(date,'zh'),formatDate(date,'en'));
});

test('saved context rejection has a known local impact and an available diagnostic next step in both locales',()=>{
 const original='saved device name length rejected; actual=characters=81; required=characters<=80';
 const value=normalizeFailure({code:'DEVICE_CONTEXT_INVALID',message:original,details:{check:'device_context',observed_at:observed,evidence:{actual:'characters=81',required:'characters<=80'}}},'startup_check');
 for(const locale of ['zh','en'] as const){
  const problem=presentFailure(value,locale);
  assert.doesNotMatch(problem.summary,/尚未确认|cause is unconfirmed/i);assert.match(problem.summary,locale==='zh'?/本机.*配置.*校验/:/saved.*device.*configuration.*validation/i);
  assert.match(problem.impact,locale==='zh'?/诊断报告.*支持.*修复.*重新检查/:/diagnostic report.*support.*repair.*recheck/i);
  assert.deepEqual(problem.action,{page:'diagnostics'});if(locale==='en')assert.doesNotMatch(problem.actionLabel!,/\p{Script=Han}/u);assert.match(problem.details,/characters=81/);assert.match(problem.details,/characters<=80/);assert.ok(problem.details.includes(original));
 }
 const absent=presentFailure({...value,code:'DEVICE_CONTEXT_UNCONFIGURED'},'zh');assert.match(absent.summary,/尚未配置/);assert.deepEqual(absent.action,{page:'overview',section:'device'});
});
test('network apply blocker explains the explicit settings action before recheck without guessing from messages',()=>{
 for(const locale of ['zh','en'] as const){
  const value=normalizeFailure({code:'NETWORK_APPLY_REQUIRED',message:'saved network revision=4 effective=2'},'startup_check');
  const problem=presentFailure(value,locale);
  assert.match(problem.summary,locale==='zh'?/网络.*尚未应用/:/network.*not.*applied/i);assert.match(problem.impact,locale==='zh'?/设置.*网络.*应用.*重新检查/:/settings.*network.*apply.*recheck/i);assert.deepEqual(problem.action,{page:'settings',section:'network'});assert.match(problem.details,/revision=4 effective=2/);
  const unknown=presentFailure({...value,code:'future_reason',message:'NETWORK_APPLY_REQUIRED'},locale);assert.equal(unknown.action,null);
 }
});

test('known unsent failures use the App locale and retain evidence without guessing from messages',()=>{
 for(const code of ['REQUEST_NOT_SENT','REQUEST_QUEUE_TIMEOUT','REQUEST_NOT_QUEUED'])for(const locale of ['zh','en']as const){
  const problem=presentFailure(normalizeFailure({code,message:'fixture queue expired before first byte; actual=16 required<16'},'account_operation'),locale);
  assert.match(problem.summary,locale==='zh'?/未发送.*未提交/:/not sent.*not submitted/i);
  assert.match(problem.impact,locale==='zh'?/不会自动重试.*确认/:/not.*automatically.*confirm/i);assert.match(problem.details,/actual=16 required<16/);
 }
 const unknown=presentFailure(normalizeFailure({code:'RESPONSE_TIMEOUT',message:'REQUEST_NOT_SENT'},'account_operation'),'en');assert.doesNotMatch(unknown.summary,/not submitted/i);
});

test('unsent classification uses validated codes and rejects malformed details',async()=>{
 const {requestNotSent}=await import('../src/system/failures.ts');
 assert.equal(requestNotSent(normalizeFailure(new Error('REQUEST_NOT_SENT: not sent'),'write')),false);
 assert.equal(requestNotSent(normalizeFailure({code:'REQUEST_NOT_SENT',message:'safe',details:{check:'write',observed_at:observed,evidence:{token:'secret'}}},'write')),false);
 assert.equal(requestNotSent(normalizeFailure({code:'RESPONSE_TIMEOUT',message:'no bytes sent'},'write')),false);
});
