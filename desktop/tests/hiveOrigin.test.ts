import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {normalizeHiveOrigin} from '../src/system/hiveOrigin.ts';

const fixture=JSON.parse(readFileSync(new URL('../../beewire/testdata/hive-origin-contract.json',import.meta.url),'utf8')) as {accepted:{input:string;key:string}[];rejected:string[]};
test('Hive keys follow the shared origin contract and preserve distinct aliases',()=>{
 for(const sample of fixture.accepted)assert.equal(normalizeHiveOrigin(sample.input),sample.key,sample.input);
 for(const input of fixture.rejected)assert.throws(()=>normalizeHiveOrigin(input),/Hive origin rejected/,input);
});
