// Isolated packaged DTO/lifecycle smoke; no real credentials, pairing or traffic.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {isAbsolute,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {decodeAccountDefaults,decodeAccountReply} from '../src/system/accounts.ts';
import {decodeRuntimeSnapshot,decodeRuntimeOperation} from '../src/system/runtime.ts';

const binary=process.argv[2];
assert.ok(binary&&isAbsolute(binary),'smoke binary missing; required=absolute path to packaged Bee');
const root=await mkdtemp(join(tmpdir(),'bee-account-runtime-smoke-'));
const config=join(root,'config'),codex=join(root,'.codex'),claude=join(root,'.claude');
const canaries=[join(config,'tokhive','bee.json'),join(root,'Library','Application Support','tokhive','bee.json'),join(codex,'auth.json'),join(claude,'.credentials.json')];
const canary='isolated smoke canary: must remain unchanged\n';
for(const path of canaries){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,canary,{mode:0o600});}
// Override only the child's environment. Do not inherit real credential locations.
const env={...Object.fromEntries(['PATH','SystemRoot','WINDIR','TMPDIR','TMP','TEMP','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),HOME:root,USERPROFILE:root,XDG_CONFIG_HOME:config,APPDATA:config,LOCALAPPDATA:config,CODEX_HOME:codex,CLAUDE_CONFIG_DIR:claude};
const child=spawn(binary,['desktop'],{env,stdio:['pipe','pipe','pipe']});
const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
let sequence=0,instance,spawnFailure;
const pending=new Map();
function failPending(error){for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
child.on('error',error=>{spawnFailure=error;failPending(error);});
child.on('close',(code,signal)=>failPending(new Error(`packaged Bee closed before reply: exit=${code}; signal=${signal}`)));
child.stdin.on('error',failPending);
child.stderr.resume();
const input=createInterface({input:child.stdout});
input.on('line',line=>{
 try{const frame=JSON.parse(line);const p=pending.get(frame.id);if(!p)return;pending.delete(frame.id);clearTimeout(p.timer);frame.error?p.reject(new Error(`packaged bridge error: code=${frame.error.code}`)):p.resolve(frame);}
 catch(error){failPending(error);}
});
function request(method,params={}){
 if(spawnFailure)return Promise.reject(spawnFailure);
 return new Promise((resolve,reject)=>{const id=`smoke-${++sequence}`;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`packaged ${method} exceeded 15000ms`));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({protocol:1,id,method,params})+'\n');});
}
async function waitForOperation(id){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){const snapshot=decodeRuntimeSnapshot(await request('runtime_snapshot'),instance);assert.equal(snapshot.operation?.id,id,'operation identity changed during smoke');if(!['pending','running'].includes(snapshot.operation.state))return snapshot;await delay(25);}
 throw new Error('packaged runtime operation exceeded 15000ms');
}
async function waitForClose(){
 let timer;
 try{return await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('packaged Bee did not exit within 5000ms')),5000);})]);}finally{clearTimeout(timer);}
}
try{
 const hello=await request('hello');instance=hello.instance;
 assert.deepEqual(hello.result.capabilities,['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','runtime_restore','authorize_start','authorize_status','authorize_cancel','diagnostics_start','diagnostics_snapshot','diagnostics_cancel','network_status','network_test','notification_snapshot']);
 const defaults=decodeAccountDefaults(await request('account_defaults'),instance);assert.equal(defaults.platforms.length,2);
 for(const platform of ['openai','claude']){const account=decodeAccountReply(await request('account_snapshot',{platform,refresh:false}),platform,instance);assert.equal(account.candidate.state,'not_checked');assert.equal(account.selection.state,'not_selected');assert.equal(account.hive.state,'not_checked');}
 let snapshot=decodeRuntimeSnapshot(await request('runtime_snapshot'),instance);assert.equal(snapshot.local,'stopped');assert.equal(snapshot.run_id,null);
 const restore=decodeRuntimeOperation(await request('runtime_restore'),instance);snapshot=await waitForOperation(restore.id);assert.equal(snapshot.operation.state,'succeeded');assert.equal(snapshot.local,'stopped');assert.equal(snapshot.connection,'disconnected');
 const stop=decodeRuntimeOperation(await request('runtime_stop',{expected_revision:snapshot.revision,reason:'user_stop'}),instance);snapshot=await waitForOperation(stop.id);assert.equal(snapshot.operation.state,'succeeded');assert.equal(snapshot.local,'stopped');assert.deepEqual(snapshot.stop_receipt,{workers_stopped:true,intent_saved:true,session_clean:true});
 assert.equal((await request('ping')).result.alive,true);await request('shutdown');child.stdin.end();const result=await waitForClose();assert.equal(result.code,0,`owned child exit=${result.code}; signal=${result.signal}`);
 for(const path of canaries)assert.equal(await readFile(path,'utf8'),canary,'isolated CLI or official source canary changed');
 console.log(`PASS packaged Bee ${hello.result.bee_version} ${hello.result.os}/${hello.result.arch}: ${hello.result.capabilities.length} capabilities; TypeScript DTOs; first-use restore stays stopped; complete stop receipt; child reaped; CLI/official canaries unchanged`);
}finally{
 input.close();for(const p of pending.values())clearTimeout(p.timer);
 if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await waitForClose();}
 else await closed;
 await rm(root,{recursive:true,force:true});
}
