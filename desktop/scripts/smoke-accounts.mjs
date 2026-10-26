// Read-only packaged DTO smoke: never detect sources or refresh Hive.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {decodeAccountDefaults,decodeAccountReply} from '../src/system/accounts.ts';
const binary=process.argv[2];
if(!binary)throw new Error('smoke binary missing; required=absolute path to packaged Bee');
const child=spawn(binary,['desktop'],{stdio:['pipe','pipe','pipe']});
const closed=once(child,'close');let diagnostics='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4096);});
let sequence=0,instance;const pending=new Map();
const input=createInterface({input:child.stdout});
input.on('line',line=>{const frame=JSON.parse(line);const request=pending.get(frame.id);if(request){pending.delete(frame.id);clearTimeout(request.timer);frame.error?request.reject(new Error(frame.error.code)):request.resolve(frame);}});
function request(method,params={}){return new Promise((resolve,reject)=>{const id=`smoke-${++sequence}`;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`packaged ${method} exceeded 15000ms`));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({protocol:1,id,method,params})+'\n');});}
try{
 const hello=await request('hello');instance=hello.instance;
 assert.deepEqual(hello.result.capabilities,['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action']);
 const defaults=decodeAccountDefaults(await request('account_defaults'),instance);assert.equal(defaults.platforms.length,2);
 for(const platform of ['openai','claude']){const account=decodeAccountReply(await request('account_snapshot',{platform,refresh:false}),platform,instance);assert.equal(account.candidate.state,'not_checked');assert.equal(account.selection.state,'not_selected');assert.equal(account.hive.state,'not_checked');console.log(`${platform}: public snapshot decoded; no source or Hive read`);}
 assert.equal((await request('ping')).result.alive,true);await request('shutdown');child.stdin.end();const [code]=await closed;assert.equal(code,0,`owned child exit=${code}; ${diagnostics}`);
 console.log('PASS packaged account defaults/snapshots, TypeScript DTO decode, ping and owned child shutdown');
}finally{input.close();if(child.exitCode===null)child.kill();for(const p of pending.values())clearTimeout(p.timer);}
