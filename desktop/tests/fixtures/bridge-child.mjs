import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, appendFileSync } from 'node:fs';

const mode = process.argv[2];
if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
if (mode === 'stubborn' || mode === 'ping-timeout' || mode === 'account-timeout') setInterval(() => {}, 1000);
if (mode === 'exit') process.exit(9);
if (mode === 'diagnostic-exit') {
  process.stderr.write('management initialization failed: E42 Authorization=MARKER-A Cookie=MARKER-C token=MARKER-T confirmation_id=MARKER-I /Users/MARKER-P model_input=MARKER-IN model_output=MARKER-OUT\n', () => process.exit(9));
}
let exitSnapshot;
let startupOperation=null,startupRuntimeRevision;
let bootstrapProxy='',bootstrapRevision=0;
let restores=0;
let restoreSnapshots=0;
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if(mode.startsWith('startup-')&&request.method!=='hello') {
    const config=JSON.parse(readFileSync(process.argv[4],'utf8'));
    appendFileSync(`${process.argv[4]}.calls`,request.method+'\n');
    startupRuntimeRevision??=config.runtime_revision??0;
    const reply=result=>process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');
    const networkRevision=config.network_revision??bootstrapRevision;
    const runtime={...JSON.parse(readFileSync(new URL('../../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot,revision:config.apply?startupRuntimeRevision:bootstrapRevision,network_revision:networkRevision,...(config.apply?{operation:startupOperation,stop_receipt:startupOperation?{workers_stopped:true,intent_saved:true,session_clean:true}:null}:{})};
    switch(request.method){
      case 'device_context': reply(config.corrupt?{error:{code:'DEVICE_CONTEXT_INVALID',message:'saved local configuration JSON rejected'},binding_revision:config.binding_revision??1}:config.unbound?{error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'no saved binding'},binding_revision:config.binding_revision??1}:{context:{hive:'https://hive.example',name:'Saved Mac',device_id:'device',owner_id:'owner',binding_revision:config.binding_revision??1}});return;
      case 'device_status': reply(config.rejected?{error:{code:'device_replaced',message:'GET identity HTTP 401',details:{check:'device_identity',observed_at:new Date().toISOString(),evidence:{http_status:'401',remote_code:'device_replaced',target_origin:'https://hive.example'}}}}:config.unbound?{device:{state:'unbound'}}:{device:{state:'bound',hive:'https://hive.example',name:'Saved Mac',identity:{id:'device',name:'Saved Mac',owner_id:'owner',owner_email:'owner@example.com'}}});return;
      case 'device_recovery_prepare':
      case 'device_recovery_confirm':
      case 'device_recovery_status': {
        const keys=Object.keys(request.params).sort().join(',');
        if(keys!==(request.method==='device_recovery_confirm'?'decision,expected_revision,operation_id':''))throw new Error('invalid recovery params');
        const phase=config.recovery_phase??'awaiting_confirmation';
        const identity={id:'new-device',name:'Recovered Mac',owner_id:'owner',owner_email:'owner@example.com'};
        reply({recovery:{operation_id:'a'.repeat(48),revision:1,phase,old_identity:{...identity,id:'device',name:'Saved Mac'},new_identity:phase==='completed'?identity:null,pairing:['pending','draining'].includes(phase)?{code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2030-01-01T00:00:00Z'}:null,failure:null,...(config.recovery_extra?{credential:'SECRET'}:{})}});return;
      }
      case 'runtime_snapshot':reply({runtime});return;
      case 'runtime_verify':writeFileSync(`${process.argv[4]}.verify`,'entered');setTimeout(()=>reply(config.bad_data?{error:{code:'STARTUP_DATA_INVALID',message:'protected account schema rejected'}}:{verified:true}),config.delay??0);return;
      case 'runtime_stop':
        if(!config.apply||request.params.reason!=='network_change'||request.params.expected_revision!==startupRuntimeRevision)throw new Error('invalid network stop');
        startupOperation={id:'b'.repeat(48),kind:'stop',platform:null,state:'succeeded',revision:++startupRuntimeRevision,error:null};reply({operation:startupOperation});return;
      case 'runtime_restore':
        if(!config.apply)throw new Error('startup recheck repeated runtime restore');
        startupOperation={id:'c'.repeat(48),kind:'start',platform:null,state:'succeeded',revision:++startupRuntimeRevision,error:null};reply({operation:startupOperation});return;
      case 'runtime_start': throw new Error('recovery must not call runtime_start');
      case 'runtime_configure_network':bootstrapRevision=request.params.revision;bootstrapProxy=request.params.connect_proxy;reply({configured:true});return;
      case 'network_status':reply({network:{effective_revision:networkRevision,effective_proxy:bootstrapProxy,paths:{relay:bootstrapProxy?'local_proxy':'direct',official:bootstrapProxy?'openai=local_proxy;claude=local_proxy':'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'}}});return;
      case 'account_detect':reply({account:{platform:request.params.platform,operation:null}});return;
      case 'account_defaults':reply({defaults:{platforms:[]}});return;
      case 'shutdown':input.close();process.stdin.destroy();return;
      default:reply({alive:true});return;
    }
  }
  if(mode==='owned-exit-bootstrap'&&['device_status','network_status'].includes(request.method)) {
    const result=request.method==='device_status'?{device:{state:'bound',hive:'https://hive.example',identity:{id:'device',name:'Saved Mac',owner_id:'owner',owner_email:'owner@example.com'}}}:{network:{effective_revision:bootstrapRevision,effective_proxy:bootstrapProxy,paths:{relay:bootstrapProxy?'local_proxy':'direct',official:bootstrapProxy?'openai=local_proxy;claude=local_proxy':'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'}}};
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');return;
  }
  if(mode==='owned-exit-slow'  && request.method==='device_status') {
    setTimeout(()=>process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result:{error:{code:'DEVICE_OPERATION_FAILED',message:'test device unavailable'}}})+'\n'),300);return;
  }
  if(mode.startsWith('owned-exit') && request.method.startsWith('runtime_')) {
    exitSnapshot ??= JSON.parse(readFileSync(new URL('../../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot;
    let result;
    if(mode==='owned-exit-bootstrap'&&request.method==='runtime_configure_network') {
      bootstrapProxy=request.params.connect_proxy;bootstrapRevision=request.params.revision;
      exitSnapshot={...exitSnapshot,network_revision:bootstrapRevision,revision:exitSnapshot.revision+1};result={configured:true};
    } else if(request.method==='runtime_verify') {result={verified:true};
    } else if(request.method==='runtime_stop') {
      if(!['app_exit','update'].includes(request.params.reason)) throw new Error('exit reason not fixed');
      const operation={id:'b'.repeat(48),kind:'stop',platform:null,state:'pending',revision:++exitSnapshot.revision,error:null};
      result={operation};
      exitSnapshot={...exitSnapshot,local:'stopped',connection:'disconnected',revision:exitSnapshot.revision+1,
        operation:{...operation,id:(mode==='owned-exit-wrong-operation'?'c':'b').repeat(48),state:'succeeded',revision:exitSnapshot.revision+1},
        stop_receipt:{workers_stopped:true,intent_saved:!['owned-exit-save-failure','owned-exit-restore-failure-stop-failure'].includes(mode),session_clean:!['owned-exit-save-failure','owned-exit-restore-failure-stop-failure'].includes(mode)}};
    } else if(request.method==='runtime_restore') {
      if(++restores>1) throw new Error('restore repeated');
      const operation={id:'d'.repeat(48),kind:'start',platform:null,state:'pending',revision:++exitSnapshot.revision,error:null};
      result={operation};
      exitSnapshot={...exitSnapshot,run_id:'f'.repeat(32),local:mode==='owned-exit-restore-idle'?'starting':'running',connection:'connected',revision:exitSnapshot.revision+1,operation:{...operation,
        id:(mode==='owned-exit-restore-wrong-operation'?'e':'d').repeat(48),
        state:mode.includes('restore-failure')?'failed':mode==='owned-exit-restore-idle'?'running':'succeeded',revision:exitSnapshot.revision+1,
        error:mode.includes('restore-failure')?{platform:'openai',code:'upgrade_data_invalid',check:'recovery_data',message:'fixture account schema rejected',evidence:{}}:null}};
    } else {
      if(mode==='owned-exit-restore-idle' && restores && ++restoreSnapshots>=2) {
        exitSnapshot={...exitSnapshot,run_id:null,local:'stopped',connection:'disconnected',revision:exitSnapshot.revision+1,
          operation:{...exitSnapshot.operation,state:'succeeded',revision:exitSnapshot.revision+1}};
      }
      result={runtime:exitSnapshot};
    }
    process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'f'.repeat(32),result})+'\n');return;
  }
  if(mode==='account-timeout'  && request.method!=='hello')return;
  if(mode==='runtime'&&['device_status','network_status'].includes(request.method)) {
    const result=request.method==='device_status'?{device:{state:'bound',hive:'https://hive.example',identity:{id:'device',name:'Saved Mac',owner_id:'owner',owner_email:'owner@example.com'}}}:{network:{effective_revision:0,effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'}}};
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
    ? { bee_version: 'fixture', os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'x64' ? 'amd64' : process.arch, capabilities: (mode.startsWith('owned-exit')||mode.startsWith('startup-'))?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','runtime_restore']:mode==='authorize'?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network','authorize_start','authorize_status','authorize_cancel']:mode==='runtime'?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action','runtime_snapshot','runtime_start','runtime_stop','runtime_configure_network']:accountMode?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action']:supplyMode ? ['ping', 'shutdown', 'device_status', 'device_begin', 'supply_status', 'supply_set_paused'] : ['device','slow-device'].includes(mode) ? ['ping', 'shutdown', 'device_status', 'device_begin'] : ['ping', 'shutdown'] }
    : request.method === 'device_status' ? { error: { code: 'DEVICE_OPERATION_FAILED', message: 'GET identity HTTP 503' } } : { alive: true };
  if(request.method==='hello'&&mode.startsWith('startup-'))result.capabilities.push('device_context','runtime_verify','device_recovery_prepare','device_recovery_confirm','device_recovery_status');
  const reply = JSON.stringify({ protocol: mode === 'version' ? 2 : 1, id: request.id, instance: 'f'.repeat(32), result }) + '\n';
  if (mode === 'slow-device' && request.method === 'device_status') {
    setTimeout(() => process.stdout.write(reply), 800);
  } else if (mode === 'split') {
    process.stdout.write(reply.slice(0, 7));
    setTimeout(() => process.stdout.write(reply.slice(7)), 15);
  } else process.stdout.write(reply);
});
