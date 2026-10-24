import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2];
if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
if (mode === 'stubborn' || mode === 'ping-timeout') setInterval(() => {}, 1000);
if (mode === 'exit') process.exit(9);
if (mode === 'diagnostic-exit') {
  process.stderr.write('management initialization failed: E42\n', () => process.exit(9));
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'ping' && mode === 'ping-timeout') return;
  if (mode === 'timeout') return;
  if (mode === 'utf8') { process.stdout.write(Buffer.from([255, 10])); return; }
  const result = request.method === 'hello'
    ? { bee_version: 'fixture', os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'x64' ? 'amd64' : process.arch, capabilities: ['device','slow-device'].includes(mode) ? ['ping', 'shutdown', 'device_status', 'device_begin'] : ['ping', 'shutdown'] }
    : request.method === 'device_status' ? { error: { code: 'DEVICE_OPERATION_FAILED', message: 'GET identity HTTP 503' } } : { alive: true };
  const reply = JSON.stringify({ protocol: mode === 'version' ? 2 : 1, id: request.id, instance: 'fixture-instance', result }) + '\n';
  if (mode === 'slow-device' && request.method === 'device_status') {
    setTimeout(() => process.stdout.write(reply), 800);
  } else if (mode === 'split') {
    process.stdout.write(reply.slice(0, 7));
    setTimeout(() => process.stdout.write(reply.slice(7)), 15);
  } else process.stdout.write(reply);
});
