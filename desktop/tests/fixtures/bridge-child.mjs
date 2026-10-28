import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync } from 'node:fs';

const mode = process.argv[2];
if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
if (mode === 'stubborn' || mode === 'ping-timeout' || mode === 'account-timeout') setInterval(() => {}, 1000);
if (mode === 'exit') process.exit(9);
if (mode === 'diagnostic-exit') {
  process.stderr.write('management initialization failed: E42 Authorization=MARKER-A Cookie=MARKER-C token=MARKER-T confirmation_id=MARKER-I /Users/MARKER-P model_input=MARKER-IN model_output=MARKER-OUT\n', () => process.exit(9));
}
let exitSnapshot;
let restores=0;
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if(mode==='owned-exit-slow' && request.method==='device_status') {
    setTimeout(()=>process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result:{error:{code:'DEVICE_OPERATION_FAILED',message:'test device unavailable'}}})+'\n'),300);return;
  }
  if(mode.startsWith('owned-exit') && request.method.startsWith('runtime_')) {
    exitSnapshot ??= JSON.parse(readFileSync(new URL('../../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot;
    let result;
    if(request.method==='runtime_stop') {
      if(!['app_exit','update'].includes(request.params.reason)) throw new Error('exit reason not fixed');
      const operation={id:'b'.repeat(48),kind:'stop',platform:null,state:'pending',revision:++exitSnapshot.revision,error:null};
      result={operation};
      exitSnapshot={...exitSnapshot,local:'stopped',connection:'disconnected',revision:exitSnapshot.revision+1,
        operation:{...operation,id:(mode==='owned-exit-wrong-operation'?'c':'b').repeat(48),state:'succeeded',revision:exitSnapshot.revision+1},
        stop_receipt:{workers_stopped:true,intent_saved:mode!=='owned-exit-save-failure',session_clean:mode!=='owned-exit-save-failure'}};
    } else if(request.method==='runtime_restore') {
      if(++restores>1) throw new Error('restore repeated');
      result={operation:{id:'d'.repeat(48),kind:'start',platform:null,state:'succeeded',revision:exitSnapshot.revision,error:null}};
    } else result={runtime:exitSnapshot};
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');return;
  }
  if(mode==='account-timeout'  && request.method!=='hello')return;
  if(mode==='runtime'&&['device_status','network_status'].includes(request.method)) {
    const result=request.method==='device_status'?{device:{state:'bound',hive:'https://hive.example',identity:{id:'device',owner_id:'owner'}}}:{network:{effective_revision:0,effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'}}};
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');return;
  }
  if(mode==='runtime'&&request.method.startsWith('runtime_')) {
    const fixture=JSON.parse(readFileSync(new URL('../../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8'));
    const keys=Object.keys(request.params).sort().join(',');
    const required={runtime_snapshot:'',runtime_start:'expected_revision,resume_platforms',runtime_stop:'expected_revision,reason'};
    if(keys!==required[request.method]||request.method==='runtime_stop'&&request.params.reason!=='user_stop') {
      process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),error:{code:'FIXTURE_PARAMS_REJECTED',message:'runtime params or fixed stop reason rejected'}})+'\n');return;
    }
    const result=request.method==='runtime_snapshot'?{runtime:fixture.snapshot}:{operation:{...fixture.operation,kind:request.method==='runtime_start'?'start':'stop'}};
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');return;
  }
  if(mode==='authorize'&&request.method.startsWith('authorize_')) {
    const keys=Object.keys(request.params).sort().join(',');
    const required=request.method==='authorize_start'?'expected_revision,platform,source':'operation_id';
    if(keys!==required) {process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),error:{code:'FIXTURE_PARAMS_REJECTED',message:'authorization params differ from contract'}})+'\n');return;}
    const operation={id:'a'.repeat(48),kind:'authorize',platform:request.params.platform??'openai',state:request.method==='authorize_cancel'?'cancelled':'running',revision:1,error:null};
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result:{operation}})+'\n');return;
  }
  const supplyMode = ['supply', 'supply-error'].includes(mode);
  const accountMode=['accounts','slow-account','account-timeout'].includes(mode);
  if(accountMode&&request.method.startsWith('account_')) {
    const keys=Object.keys(request.params).sort().join(',');
    const required={account_defaults:'',account_detect:'directory,mode,platform,store',account_snapshot:'platform,refresh',account_action:'action,candidate_ref,confirmed,platform,revision'};
    if(keys!==required[request.method]){process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),error:{code:'FIXTURE_PARAMS_REJECTED',message:'account params differ from fixed contract'}})+'\n');return;}
    const result=request.method==='account_defaults'?{defaults:{platforms:[]}}:request.method==='account_action'?{error:{code:'ACCOUNT_OPERATION_FAILED',message:'runtime ownership proof absent'}}:{account:{platform:request.params.platform,operation:null}};
    const reply=JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n';
    if(mode==='slow-account')setTimeout(()=>process.stdout.write(reply),800);else process.stdout.write(reply);return;
  }
  if (supplyMode && request.method.startsWith('supply_')) {
    const keys = Object.keys(request.params).sort().join(',');
    const valid = ['openai', 'claude'].includes(request.params.platform)
      && (request.method === 'supply_status' && keys === 'platform'
        || request.method === 'supply_set_paused' && keys === 'paused,platform' && typeof request.params.paused === 'boolean');
    if (!valid) {
      process.stdout.write(JSON.stringify({ protocol: 1, id: request.id, instance: 'f'.repeat(32), error: { code: 'FIXTURE_PARAMS_REJECTED', message: 'supply method or params differ from the fixed whitelist' } }) + '\n');
      return;
    }
    const result = mode === 'supply-error'
      ? { error: { code: 'SUPPLY_OPERATION_FAILED', message: 'GET /api/bee/platforms/openai: HTTP 503' } }
      : { supply: { hive: 'https://hive.example', device_id: 'fixture-device', platform: request.params.platform, paused: request.params.paused ?? false, ready: false, reasons: request.params.paused ? ['manually_paused'] : ['offline'], checked_at: '2026-10-24T00:00:00Z' } };
    process.stdout.write(JSON.stringify({ protocol: 1, id: request.id, instance: 'f'.repeat(32), result }) + '\n');
    return;
  }
  if (request.method === 'ping' && mode === 'ping-timeout') return;
  if (mode === 'timeout') return;
  if (mode === 'utf8') { process.stdout.write(Buffer.from([255, 10])); return; }
  const result = request.method === 'hello'
    ? { bee_version: 'fixture', os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'x64' ? 'amd64' : process.arch, capabilities: mode.startsWith('owned-exit')?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','runtime_restore']:mode==='authorize'?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','authorize_start','authorize_status','authorize_cancel']:mode==='runtime'?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network']:accountMode?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action']:supplyMode ? ['ping', 'shutdown', 'device_status', 'device_begin', 'supply_status', 'supply_set_paused'] : ['device','slow-device'].includes(mode) ? ['ping', 'shutdown', 'device_status', 'device_begin'] : ['ping', 'shutdown'] }
    : request.method === 'device_status' ? { error: { code: 'DEVICE_OPERATION_FAILED', message: 'GET identity HTTP 503' } } : { alive: true };
  const reply = JSON.stringify({ protocol: mode === 'version' ? 2 : 1, id: request.id, instance: 'f'.repeat(32), result }) + '\n';
  if (mode === 'slow-device' && request.method === 'device_status') {
    setTimeout(() => process.stdout.write(reply), 800);
  } else if (mode === 'split') {
    process.stdout.write(reply.slice(0, 7));
    setTimeout(() => process.stdout.write(reply.slice(7)), 15);
  } else process.stdout.write(reply);
});
