import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';

// CI only: labels select a runner; these checks establish its actual identity.
const target = process.env.BEE_CI_TARGET;
const baseline = process.env.BEE_CI_BASELINE;
const evidenceDir = 'desktop-ci-evidence';
mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  recordedAt: new Date().toISOString(),
  revision: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  target, baseline, platform: platform(), arch: arch(), kernel: release(),
  checks: [],
};
const save = () => writeFileSync(`${evidenceDir}/native.json`, JSON.stringify(evidence, null, 2) + '\n');
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function check(name, actual, expected, ok) {
  evidence.checks.push({ name, actual, expected, ok });
  save();
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}: actual=${JSON.stringify(actual)}; required=${JSON.stringify(expected)}`);
  if (!ok) throw new Error(`${name} mismatch: actual=${JSON.stringify(actual)}; required=${JSON.stringify(expected)}`);
}

try {
  check('CI baseline', baseline, ['minimum', 'current'], ['minimum', 'current'].includes(baseline));
  const targets = {
    'aarch64-apple-darwin': ['darwin', 'arm64', 'darwin', 'arm64'],
    'x86_64-apple-darwin': ['darwin', 'x64', 'darwin', 'amd64'],
    'x86_64-pc-windows-msvc': ['win32', 'x64', 'windows', 'amd64'],
    'x86_64-unknown-linux-gnu': ['linux', 'x64', 'linux', 'amd64'],
    'aarch64-unknown-linux-gnu': ['linux', 'arm64', 'linux', 'arm64'],
  };
  check('CI target', target, Object.keys(targets), Object.hasOwn(targets, target ?? ''));
  const [nodeOS, nodeArch, goOS, goArch] = targets[target];
  check('Native Node host', `${platform()}/${arch()}`, `${nodeOS}/${nodeArch}`, platform() === nodeOS && arch() === nodeArch);
  if (nodeOS === 'darwin') {
    const translated = run('sysctl', ['-in', 'sysctl.proc_translated']);
    check('Native macOS process', translated, '0 or empty (no Rosetta)', ['', '0'].includes(translated));
    const version = run('sw_vers', ['-productVersion']);
    check('macOS baseline', version, 'macOS 13.x', /^13\./.test(version));
  } else if (nodeOS === 'linux') {
    const machine = run('uname', ['-m']);
    const expectedMachine = nodeArch === 'arm64' ? 'aarch64' : 'x86_64';
    check('Native Linux kernel architecture', machine, expectedMachine, machine === expectedMachine);
    const osRelease = Object.fromEntries(readFileSync('/etc/os-release', 'utf8').split('\n')
      .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
      }));
    const expected = baseline === 'minimum' ? '22.04' : '24.04';
    check('Ubuntu baseline', `${osRelease.ID}/${osRelease.VERSION_ID}`, `ubuntu/${expected}`,
      osRelease.ID === 'ubuntu' && osRelease.VERSION_ID === expected);
  } else {
    const cpus = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'ConvertTo-Json -InputObject @(Get-CimInstance Win32_Processor | ForEach-Object { $_.Architecture }) -Compress']));
    check('Native Windows CPU', cpus, 'all CPU Architecture=9 (x64)', cpus.length > 0 && cpus.every(cpu => cpu === 9));
    const os = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,ProductType | ConvertTo-Json -Compress']));
    const expected = baseline === 'minimum' ? 'Windows 10 22H2 workstation (build 19045)' : 'Windows 11 workstation (build >= 22000)';
    const matchesVersion = baseline === 'minimum'
      ? /Windows 10/.test(os.Caption) && Number(os.BuildNumber) === 19045
      : /Windows 11/.test(os.Caption) && Number(os.BuildNumber) >= 22000;
    check('Windows baseline', os, expected, os.ProductType === 1 && matchesVersion);
  }
  const rust = run('rustc', ['-vV']);
  check('Native Rust host', rust, `host: ${target}`, /^host: (.+)$/m.exec(rust)?.[1] === target);
  const go = run('go', ['env', 'GOOS', 'GOARCH', 'GOHOSTOS', 'GOHOSTARCH']).split(/\r?\n/);
  const expectedGo = [goOS, goArch, goOS, goArch];
  check('Native Go build and host', go, expectedGo, JSON.stringify(go) === JSON.stringify(expectedGo));
  evidence.ok = true;
  save();
} catch (error) {
  // Keep the failing command's stderr and status in the same visible report.
  evidence.ok = false;
  evidence.error = { message: error.message, status: error.status, stdout: error.stdout?.toString(), stderr: error.stderr?.toString() };
  save();
  console.error(JSON.stringify(evidence.error, null, 2));
  process.exitCode = 1;
}
