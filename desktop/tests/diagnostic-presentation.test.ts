import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DiagnosticCheck} from '../src/system/diagnostics.ts';
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
