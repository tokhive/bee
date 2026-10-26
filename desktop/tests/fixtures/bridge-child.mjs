import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2];
if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
if (mode === 'stubborn' || mode === 'ping-timeout' || mode === 'account-timeout') setInterval(() => {}, 1000);
if (mode === 'exit') process.exit(9);
if (mode === 'diagnostic-exit') {
  process.stderr.write('management initialization failed: E42\n', () => process.exit(9));
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if(mode==='account-timeout' && request.method!=='hello')return;
  const supplyMode = ['supply', 'supply-error'].includes(mode);
  const accountMode=['accounts','slow-account','account-timeout'].includes(mode);
  if(accountMode&&request.method.startsWith('account_')) {
    const keys=Object.keys(request.params).sort().join(',');
    const required={account_defaults:'',account_detect:'directory,mode,platform,store',account_snapshot:'platform,refresh',account_action:'action,candidate_ref,confirmed,platform,revision'};
    if(keys!==required[request.method]){process.stdout.write(JSON.stringify({protocol:1,id:request.id,instance:'fixture-instance',error:{code:'FIXTURE_PARAMS_REJECTED',message:'account params differ from fixed contract'}})+'\n');return;}
    const result=request.method==='account_defaults'?{defaults:{platforms:[]}}:request.method==='account_action'?{error:{code:'ACCOUNT_OPERATION_FAILED',message:'runtime ownership proof absent'}}:{account:{platform:request.params.platform,operation:null}};
    const reply=JSON.stringify({protocol:1,id:request.id,instance:'fixture-instance',result})+'\n';
    if(mode==='slow-account')setTimeout(()=>process.stdout.write(reply),800);else process.stdout.write(reply);return;
  }
  if (supplyMode && request.method.startsWith('supply_')) {
    const keys = Object.keys(request.params).sort().join(',');
    const valid = ['openai', 'claude'].includes(request.params.platform)
      && (request.method === 'supply_status' && keys === 'platform'
        || request.method === 'supply_set_paused' && keys === 'paused,platform' && typeof request.params.paused === 'boolean');
    if (!valid) {
      process.stdout.write(JSON.stringify({ protocol: 1, id: request.id, instance: 'fixture-instance', error: { code: 'FIXTURE_PARAMS_REJECTED', message: 'supply method or params differ from the fixed whitelist' } }) + '\n');
      return;
    }
    const result = mode === 'supply-error'
      ? { error: { code: 'SUPPLY_OPERATION_FAILED', message: 'GET /api/bee/platforms/openai: HTTP 503' } }
      : { supply: { hive: 'https://hive.example', device_id: 'fixture-device', platform: request.params.platform, paused: request.params.paused ?? false, ready: false, reasons: request.params.paused ? ['manually_paused'] : ['offline'], checked_at: '2026-10-24T00:00:00Z' } };
    process.stdout.write(JSON.stringify({ protocol: 1, id: request.id, instance: 'fixture-instance', result }) + '\n');
    return;
  }
  if (request.method === 'ping' && mode === 'ping-timeout') return;
  if (mode === 'timeout') return;
  if (mode === 'utf8') { process.stdout.write(Buffer.from([255, 10])); return; }
  const result = request.method === 'hello'
    ? { bee_version: 'fixture', os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'x64' ? 'amd64' : process.arch, capabilities: accountMode?['ping','shutdown','device_status','device_begin','supply_status','supply_set_paused','account_defaults','account_detect','account_snapshot','account_action']:supplyMode ? ['ping', 'shutdown', 'device_status', 'device_begin', 'supply_status', 'supply_set_paused'] : ['device','slow-device'].includes(mode) ? ['ping', 'shutdown', 'device_status', 'device_begin'] : ['ping', 'shutdown'] }
    : request.method === 'device_status' ? { error: { code: 'DEVICE_OPERATION_FAILED', message: 'GET identity HTTP 503' } } : { alive: true };
  const reply = JSON.stringify({ protocol: mode === 'version' ? 2 : 1, id: request.id, instance: 'fixture-instance', result }) + '\n';
  if (mode === 'slow-device' && request.method === 'device_status') {
    setTimeout(() => process.stdout.write(reply), 800);
  } else if (mode === 'split') {
    process.stdout.write(reply.slice(0, 7));
    setTimeout(() => process.stdout.write(reply.slice(7)), 15);
  } else process.stdout.write(reply);
});
