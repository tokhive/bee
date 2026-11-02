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
