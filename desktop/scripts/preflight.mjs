import { isMain, run as runProcess, cli } from './process.mjs';

export function collectPreflight({ platform = process.platform, arch = process.arch, nodeVersion = process.versions.node, run = runProcess } = {}) {
  const checks = [];
  const check = (name, expected, read, accepts = value => value.length > 0) => {
    try {
      const actual = read().trim();
      checks.push({ name, actual, expected, ok: accepts(actual) });
    } catch (error) { checks.push({ name, actual: error.message, expected, ok: false }); }
  };
  check('Node', '24.x LTS', () => nodeVersion, v => /^24\./.test(v));
  check('Go', 'go1.27.3', () => run('go', ['version']), v => /\bgo1\.27\.3\s/.test(v));
  check('Rust', '1.94.0 (rust-toolchain.toml)', () => run('rustc', ['--version']), v => /^rustc 1\.94\.0\s/.test(v));
  check('Cargo', '1.94.0', () => run('cargo', ['--version']), v => /^cargo 1\.94\.0\s/.test(v));
  check('Git', 'Git installed', () => run('git', ['--version']), v => /^git version /.test(v));
  check('Target', 'darwin arm64/x64; win32 x64; linux arm64/x64', () => `${platform}/${arch}`, () =>
    (platform === 'win32' && arch === 'x64') || (['darwin', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch)));
  if (platform === 'darwin') {
    const atLeast13 = value => /^\d+\.\d+(?:\.\d+)?$/.test(value) && Number(value.split('.')[0]) >= 13;
    check('macOS', '13.0 or newer', () => run('sw_vers', ['-productVersion']), atLeast13);
    check('Xcode', 'selected developer directory', () => run('xcode-select', ['-p']));
    check('Clang / system WebKit', 'Xcode clang and macOS system WebKit', () => run('xcrun', ['--find', 'clang']));
    check('macOS SDK', '13.0 or newer', () => run('xcrun', ['--show-sdk-version']), atLeast13);
  } else if (platform === 'linux') {
    check('C compiler', 'cc available', () => run('cc', ['--version']));
    for (const pkg of ['webkit2gtk-4.1', 'gtk+-3.0', 'ayatana-appindicator3-0.1', 'librsvg-2.0']) {
      check(pkg, 'pkg-config development package installed', () => run('pkg-config', ['--modversion', pkg]));
    }
  } else if (platform === 'win32') {
    check('MSVC', 'Visual Studio C++ x64 tools', () => run('where.exe', ['cl.exe']));
    check('WebView2', 'installed Edge WebView2 runtime', () => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$keys=@('HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\*','HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\*','HKCU:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\*'); $r=Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.name -eq 'Microsoft Edge WebView2 Runtime' -and $_.pv -ne '0.0.0.0' }; if (!$r) { Write-Error 'WebView2 Runtime registry entry missing'; exit 1 }; $r | ForEach-Object { $_.pv }"]));
  }
  return { ok: checks.every(c => c.ok), checks };
}

if (isMain(import.meta.url)) cli(() => {
  const report = collectPreflight();
  for (const c of report.checks) console.log(`${c.ok ? 'OK' : 'FAIL'} ${c.name}: actual=${c.actual}; required=${c.expected}`);
  if (!report.ok) process.exitCode = 1;
});
