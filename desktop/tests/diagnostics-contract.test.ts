import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {decodeDiagnosticReport, decodeLogPage} from '../src/system/diagnostics.ts';

test('diagnostic reports and logs retain the public server codes emitted by the Go bridge',()=>{
  const source=readFileSync(new URL('../../agent/desktop_device.go',import.meta.url),'utf8');
  const safeCode=source.split('func safeCode(')[1]?.split('\nfunc ')[0];
  assert.ok(safeCode,'Go public-code producer must be inspectable');
  const codes=new Set([...safeCode.matchAll(/"([a-z_]+)"/g)].map(([,code])=>code));
  assert.ok(codes.has('device_connected'),'the producer must include the current Hive connection rejection code');
  const instance='b'.repeat(32),time='2026-10-27T00:00:00Z';
  const report=(code:string)=>({id:'a'.repeat(48),instance,run_id:null,network_revision:0,binding_revision:0,started_at:time,finished_at:null,state:'running',checks:[{id:'hive',platform:null,status:'fail',observed_at:time,code:'http_rejected',evidence:{http_status:'409',server_code:code},next_action:'diagnostics'}]});
  const logs=(code:string)=>({entries:[{time,level:'error',module:'diagnostics',platform:null,code:'http_rejected',evidence:{http_status:'409',server_code:code}}],next_cursor:null,truncated:false});
  for(const code of codes){
    assert.equal(decodeDiagnosticReport({instance,result:{report:report(code)}},instance).checks[0].evidence.server_code,code);
    assert.equal(decodeLogPage(logs(code)).entries[0].evidence.server_code,code);
  }
  for(const code of ['future_unapproved_code','Authorization=SECRET_MARKER']){
    assert.throws(()=>decodeDiagnosticReport({instance,result:{report:report(code)}},instance),/outside public contract/);
    assert.throws(()=>decodeLogPage(logs(code)),/outside public contract/);
  }
});

test('failure history retains the same evidence as the account error',()=>{
 const entry={time:'2026-11-17T00:00:00Z',level:'error',module:'bridge',platform:null,code:'failure_observed',evidence:{check:'hive_request',failure_code:'http_rejected',failure_message:'Hive /api/bee/maintenance: HTTP 503; tee_unavailable; TEE inbox public key not configured'}};
 assert.deepEqual(decodeLogPage({entries:[entry],next_cursor:null,truncated:false}).entries[0],entry);
 for(const message of ['Authorization: Bearer SECRET','password=SECRET','refresh_token=SECRET','cookie=SECRET','-----BEGIN PRIVATE KEY-----SECRET','/Users/PRIVATE/auth.json']) {
  assert.throws(()=>decodeLogPage({entries:[{...entry,evidence:{...entry.evidence,failure_message:message}}],next_cursor:null,truncated:false}));
 }
});

 test('sanitized remote body remains readable through log validation',()=>{
 const message='HTTP 503; response_body={"error":{"message":"upstream unavailable","refresh_token":[redacted],"revision":9007199254740993}}';
 const entry={time:'2026-11-17T00:00:00Z',level:'error',module:'bridge',platform:null,code:'failure_observed',evidence:{check:'hive_request',failure_code:'http_rejected',failure_message:message}};
 assert.equal(decodeLogPage({entries:[entry],next_cursor:null,truncated:false}).entries[0].evidence.failure_message,message);
 });
