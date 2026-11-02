// Real Bee child, no pairing, official source detection, login or contribution.
// macOS UserConfigDir depends on HOME: never redirect HOME or touch that config.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {arch,platform,tmpdir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {decodeAccountDefaults,decodeAccountReply} from '../src/system/accounts.ts';
import {decodeRuntimeSnapshot} from '../src/system/runtime.ts';
import {decodeDiagnosticReport} from '../src/system/diagnostics.ts';
import {decodeNetworkSnapshot} from '../src/system/network.ts';

const capabilities=['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','runtime_restore','authorize_start','authorize_status','authorize_cancel','diagnostics_start','diagnostics_snapshot','diagnostics_cancel','network_status','network_test','notification_snapshot','device_context','runtime_verify','device_recovery_prepare','device_recovery_confirm','device_recovery_status'];
const [binary,evidenceArgument,...extra]=process.argv.slice(2);
if(!binary||!isAbsolute(binary)||extra.length)throw new Error(`smoke arguments rejected: binary_absolute=${!!binary&&isAbsolute(binary)} extra_count=${extra.length}; required=<absolute Bee binary> [evidence directory]`);
const temporary=mkdtempSync(join(tmpdir(),'bee-experience-smoke-'));
const evidenceDir=evidenceArgument?resolve(evidenceArgument):join(temporary,'evidence');
mkdirSync(evidenceDir,{recursive:true});
const configDir=join(temporary,'config');
const workDir=join(temporary,'work');
mkdirSync(configDir);mkdirSync(workDir);
const childEnv={...process.env};
// These are process-local overrides. The user's HOME and global env are intact.
const isolated=platform()==='linux'||platform()==='win32';
if(platform()==='linux')childEnv.XDG_CONFIG_HOME=configDir;
if(platform()==='win32'){
 for(const key of Object.keys(childEnv))if(key.toUpperCase()==='APPDATA')delete childEnv[key];
 childEnv.APPDATA=configDir;
}
const report={schema_version:1,ok:false,scope:'real sidecar read-only protocol; not native OS acceptance',started_at:new Date().toISOString(),host:{os:platform(),arch:arch(),node:process.version},binary_sha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),configuration:isolated?'temporary UserConfigDir; empty working directory':'no configuration-dependent command; empty working directory; HOME unchanged',checks:[],not_covered:['paired doctor and authenticated Hive/official requests','real HTTP CONNECT or environment-proxy routing','Rust log rotation/export and actual download receipt','preferences persistence and system language/theme','native notification permission, delivery and click','native autostart registration, close/reopen and application exit'],stderr_bytes:0};
const child=spawn(binary,['desktop'],{cwd:workDir,env:childEnv,stdio:['pipe','pipe','pipe']});
let instance,sequence=0,transportFailure;
const pending=new Map();
const closed=new Promise(resolveClose=>{
 child.once('error',error=>{fail(error);resolveClose({code:null,signal:null,spawn_error:error.code});});
 child.once('close',(code,signal)=>{if(pending.size)fail(new Error(`owned child closed with pending_requests=${pending.size}; exit=${code} signal=${signal}; required=response before close`));resolveClose({code,signal});});
});
child.stderr.on('data',chunk=>{report.stderr_bytes+=chunk.length;});
child.stdin.on('error',error=>fail(error));
const input=createInterface({input:child.stdout});
function fail(error){
 transportFailure??=error;
 for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}
 pending.clear();
}
input.on('line',line=>{
 try{
  assert.ok(Buffer.byteLength(line)<=1048576,`reply frame bytes=${Buffer.byteLength(line)}; maximum=1048576`);
  const frame=JSON.parse(line);
  assert.equal(frame.protocol,1,'reply protocol must be 1');
  assert.match(frame.instance,/^[a-f0-9]{32}$/,'reply instance must be 32 lowercase hex');
  if(instance)assert.equal(frame.instance,instance,'reply must belong to the owned management instance');
  assert.equal(Object.hasOwn(frame,'result')!==Object.hasOwn(frame,'error'),true,'reply requires exactly one result/error');
  assert.deepEqual(Object.keys(frame).sort(),['protocol','id','instance',Object.hasOwn(frame,'result')?'result':'error'].sort(),'reply must use the fixed envelope');
  const request=pending.get(frame.id);
  assert.ok(request,`reply ID has no pending request: id_bytes=${typeof frame.id==='string'?frame.id.length:-1}; required=owned request ID`);
  pending.delete(frame.id);clearTimeout(request.timer);request.resolve(frame);
 }catch(error){fail(error);}
});
function request(method,params={}){
 if(transportFailure)return Promise.reject(transportFailure);
 return new Promise((resolveRequest,reject)=>{
  const id=`experience-${++sequence}`;
  const timer=setTimeout(()=>{pending.delete(id);const error=new Error(`sidecar response timeout: method=${method} id=${id} waited_ms=15000; required=reply within 15000ms`);reject(error);fail(error);},15000);
  pending.set(id,{resolve:resolveRequest,reject,timer});
  child.stdin.write(JSON.stringify({protocol:1,id,method,params})+'\n');
 });
}
async function success(method,params={}){
 const frame=await request(method,params);
 assert.equal(frame.error,undefined,`${method} protocol failure: ${JSON.stringify(frame.error)}`);
 assert.equal(frame.result?.error,undefined,`${method} business failure: ${JSON.stringify(frame.result?.error)}`);
 return frame;
}
async function rejected(method,params){
 const frame=await request(method,params);
 assert.equal(frame.error?.code,'INVALID_REQUEST',`${method} invalid parameters must be rejected before service access; actual=${JSON.stringify(frame.error??frame.result)}`);
 assert.equal(typeof frame.error.message,'string',`${method} rejection requires diagnostic evidence`);
 report.checks.push({check:`${method} strict parameters`,outcome:'pass'});
}
async function awaitClosed(){
 return Promise.race([closed,delay(3000,undefined,{ref:false}).then(()=>{throw new Error('owned child wait/reap timeout: waited_ms=3000; required=close event');})]);
}
let failure;
try{
 const hello=await success('hello');instance=hello.instance;
 assert.deepEqual(hello.result.capabilities,capabilities,'current Bee must declare all 29 ordered capabilities');
 report.metadata=hello.result;report.checks.push({check:'complete capabilities and owned instance',outcome:'pass'});
 const defaults=decodeAccountDefaults(await success('account_defaults'),instance);
 assert.deepEqual(defaults.platforms.map(value=>value.platform),['openai','claude']);
 for(const accountPlatform of ['openai','claude']){
  const account=decodeAccountReply(await success('account_snapshot',{platform:accountPlatform,refresh:false}),accountPlatform,instance);
  assert.equal(account.candidate.state,'not_checked');assert.equal(account.selection.state,'not_selected');assert.equal(account.hive.state,'not_checked');
 }
 report.checks.push({check:'TypeScript defaults/public account snapshots; no source or Hive read',outcome:'pass'});
 const runtime=decodeRuntimeSnapshot(await success('runtime_snapshot'),instance);
 assert.equal(runtime.local,'stopped');assert.equal(runtime.connection,'disconnected');assert.equal(runtime.run_id,null);
 report.checks.push({check:'S1 runtime snapshot starts stopped without restore/start',outcome:'pass'});
 const network=(await success('network_status')).result.network;
 assert.deepEqual(Object.keys(network).sort(),['effective_revision','effective_proxy','paths'].sort());
 decodeNetworkSnapshot({...network,saved_revision:0,saved_proxy:'',pending_restart:false,error:null});
 assert.equal(network.effective_revision,0);assert.equal(network.effective_proxy,'');
 report.checks.push({check:'in-memory effective network policy; no connectivity request',outcome:'pass'});
 await rejected('diagnostics_start',{path:'forbidden'});
 await rejected('diagnostics_snapshot',{id:'invalid'});
 await rejected('diagnostics_cancel',{id:'invalid'});
 for(const proxy of ['socks5://127.0.0.1:7890','http://localhost:7890','http://user:pass@127.0.0.1:7890','http://192.0.2.1:7890'])await rejected('network_test',{proxy});
 await rejected('notification_snapshot',{identity:'forbidden'});
 for(const method of ['diagnostics_snapshot','diagnostics_cancel']){
  const frame=await request(method,{id:'0'.repeat(48)});
  assert.equal(frame.error,undefined);
  assert.equal(frame.result?.error?.code,'DIAGNOSTICS_OPERATION_FAILED',`${method} unknown report must return a business error; actual=${JSON.stringify(frame.result)}`);
 }
 report.checks.push({check:'unknown diagnostic report fails without opening a device session',outcome:'pass'});
 if(isolated){
  const notifications=(await success('notification_snapshot')).result.notifications;
  assert.deepEqual(notifications.facts,[]);assert.equal(notifications.network_revision,0);
  let diagnostic=decodeDiagnosticReport(await success('diagnostics_start'),instance);
  const deadline=Date.now()+5000;
  while(diagnostic.state==='running'&&Date.now()<deadline){await delay(20);diagnostic=decodeDiagnosticReport(await success('diagnostics_snapshot',{id:diagnostic.id}),instance);}
  assert.equal(diagnostic.state,'completed','empty isolated device diagnostic must finish within 5000ms');
  assert.equal(diagnostic.checks.find(check=>check.id==='device').code,'device_not_paired');
  assert.equal(diagnostic.checks.some(check=>check.status==='pass'),false,'unpaired report cannot claim successful checks');
  decodeDiagnosticReport(await success('diagnostics_cancel',{id:diagnostic.id}),instance);
  assert.deepEqual(readdirSync(configDir),['tokhive']);
  assert.deepEqual(readdirSync(join(configDir,'tokhive')),['bee-desktop.json.lock'],'read-only unpaired commands may create only their owned config lock');
  report.checks.push({check:'isolated unpaired diagnostic start/snapshot/cancel and empty notification facts',outcome:'pass'});
 }else{
  report.checks.push({check:'configuration-dependent diagnostics/notification snapshots',outcome:'skipped',reason:`${platform()} UserConfigDir cannot be isolated by XDG_CONFIG_HOME/APPDATA; HOME redirection forbidden`});
 }
 assert.equal((await success('ping')).result.alive,true);
 assert.equal((await success('shutdown')).result.stopped,true);child.stdin.end();
 report.child_exit=await awaitClosed();assert.deepEqual(report.child_exit,{code:0,signal:null});
 assert.equal(transportFailure,undefined,'owned child must close without an invalid or unmatched reply');
 report.checks.push({check:'healthy ping after rejected requests; owned child shutdown/wait',outcome:'pass'});
 report.ok=true;
}catch(error){failure=error;report.failure={name:error.name,message:error.message};}
finally{
 input.close();
 for(const request of pending.values())clearTimeout(request.timer);
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
 try{report.child_exit??=await awaitClosed();}catch(error){
  failure??=error;report.ok=false;report.cleanup_failure=error.message;
  // Kill only this spawned child; never enumerate or terminate another Bee.
  child.kill('SIGKILL');
  try{report.child_exit=await awaitClosed();}catch(reapError){report.cleanup_failure+=`; ${reapError.message}`;}
 }
 report.finished_at=new Date().toISOString();
 writeFileSync(join(evidenceDir,'smoke.json'),JSON.stringify(report,null,2)+'\n');
 // Retain the default evidence file, removing only the isolated working/config dirs.
 rmSync(workDir,{recursive:true,force:true});rmSync(configDir,{recursive:true,force:true});
}
console.log(`${report.ok?'PASS':'FAIL'} real sidecar read-only smoke; config_dependent=${isolated?'isolated':'skipped'}; evidence=${join(evidenceDir,'smoke.json')}; native_OS_acceptance=not_covered`);
if(failure)throw failure;
