import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, symlinkSync, readlinkSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectPreflight } from '../scripts/preflight.mjs';
import { extractArchive, prepareTee } from '../scripts/prepare-tee.mjs';
import { beeTarget, buildBee } from '../scripts/build-bee.mjs';

const versions = {
  go: 'go version go1.27.3 darwin/arm64', rustc: 'rustc 1.94.0 (test)',
  cargo: 'cargo 1.94.0 (test)', git: 'git version 2.39.3',
  'xcode-select': '/Applications/Xcode.app/Contents/Developer',
  xcrun: '/Applications/Xcode.app/Contents/Developer/usr/bin/clang',
};
const runTool = (command, args) => command === 'sw_vers' ? '15.7.7'
  : command === 'xcrun' && args?.[0] === '--show-sdk-version' ? '14.4' : versions[command] ?? '';

test('preflight accepts the approved macOS toolchain and rejects macOS/SDK below 13', () => {
  const current = { platform: 'darwin', arch: 'arm64', nodeVersion: '24.22.1', run: runTool };
  assert.equal(collectPreflight(current).ok, true);
  for (const command of ['sw_vers', 'xcrun']) {
    const report = collectPreflight({ ...current, run: (cmd, args) =>
      cmd === command && (cmd === 'sw_vers' || args[0] === '--show-sdk-version') ? '12.0' : runTool(cmd, args) });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some(c => !c.ok && c.actual === '12.0'));
  }
});

test('preflight reports actual and required versions instead of accepting old tools', () => {
  const result = collectPreflight({ platform: 'darwin', arch: 'arm64', nodeVersion: '20.19.4', run: (cmd) => cmd === 'go' ? 'go version go1.26.5 darwin/arm64' : runTool(cmd) });
  assert.equal(result.ok, false);
  assert.match(result.checks.find(c => c.name === 'Node').actual, /20\.19\.4/);
  assert.match(result.checks.find(c => c.name === 'Go').actual, /1\.26\.5/);
  assert.match(result.checks.find(c => c.name === 'Go').expected, /1\.27\.3/);
});

test('preflight reports a missing native tool and fails for unsupported systems', () => {
  const result = collectPreflight({ platform: 'darwin', arch: 'arm64', nodeVersion: '24.22.1', run: cmd => { if (cmd === 'xcrun') throw Error('ENOENT: xcrun'); return runTool(cmd); } });
  assert.equal(result.ok, false);
  assert.match(result.checks.find(c => !c.ok).actual, /ENOENT: xcrun/);
  assert.equal(collectPreflight({ platform: 'freebsd', arch: 'x64', nodeVersion: '24.22.1', run: runTool }).ok, false);
});

test('target mapping preserves all five approved OS/architecture pairs', () => {
  for (const [triple, os, arch, suffix] of [
    ['aarch64-apple-darwin', 'darwin', 'arm64', ''], ['x86_64-apple-darwin', 'darwin', 'amd64', ''],
    ['x86_64-pc-windows-msvc', 'windows', 'amd64', '.exe'],
    ['x86_64-unknown-linux-gnu', 'linux', 'amd64', ''], ['aarch64-unknown-linux-gnu', 'linux', 'arm64', ''],
  ]) assert.deepEqual(beeTarget(triple), { goos: os, goarch: arch, suffix });
  assert.throws(() => beeTarget('aarch64-pc-windows-msvc'), /aarch64-pc-windows-msvc/);
});

function fixture(t, links = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bee-desktop-tooling-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  mkdirSync(source);
  function git(...args) {
    const r = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.eol', 'lf');
  writeFileSync(join(source, 'go.mod'), 'module example.test/pinned\n\ngo 1.27.3\n');
  writeFileSync(join(source, '.gitattributes'), 'excluded export-ignore\n');
  writeFileSync(join(source, 'excluded'), 'must not be exported');
  const longPath = 'long-'.repeat(25) + '.txt';
  writeFileSync(join(source, longPath), 'long path from git archive\n');
  git('add', '.');
  // Populate Git's index directly so the fixture needs no symlink privilege.
  for (const [name, target] of Object.entries(links)) {
    const blob = spawnSync('git', ['-C', source, 'hash-object', '-w', '--stdin'], { input: target, encoding: 'utf8' });
    assert.equal(blob.status, 0, blob.stderr);
    git('update-index', '--add', '--cacheinfo', `120000,${blob.stdout.trim()},${name}`);
  }
  git('-c', 'user.name=Bee tooling tests', '-c', 'user.email=bee@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const revision = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'TEE_REVISION'), revision + '\n');
  return { root, source, revision, longPath };
}

test('TEE export matches git archive and the existing shell cache marker', t => {
  const f = fixture(t);
  prepareTee(f);
  const dest = join(f.root, '.cache/reclaim-tee');
  assert.equal(readFileSync(join(dest, f.longPath), 'utf8'), 'long path from git archive\n');
  assert.equal(existsSync(join(dest, 'excluded')), false);
  const archive = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', f.source, 'archive', f.revision]);
  const expected = createHash('sha256').update(archive.stdout).digest('hex');
  assert.equal(readFileSync(join(dest, '.archive-sha256'), 'utf8'), expected + '  -\n');
  prepareTee(f);
});

test('TEE archive keeps pinned blob LF bytes and canonical SHA despite CRLF Git configuration', t => {
  const f = fixture(t, { 'service-link': 'go.mod' });
  function git(...args) {
    const result = spawnSync('git', ['-C', f.source, ...args]);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  }
  git('config', 'core.autocrlf', 'true');
  git('config', 'core.eol', 'crlf');
  const canonical = git('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', f.revision);
  assert.notDeepEqual(git('archive', f.revision), canonical, 'Fixture must reproduce configured CRLF archive conversion');
  const destination = prepareTee({ ...f, platform: 'win32' });
  for (const name of [f.longPath, 'go.mod', 'service-link']) {
    const blobPath = name === 'service-link' ? 'go.mod' : name;
    assert.deepEqual(readFileSync(join(destination, name)), git('show', `${f.revision}:${blobPath}`), `${name}: must match original LF Git blob`);
  }
  assert.equal(readFileSync(join(destination, '.archive-sha256'), 'utf8'), createHash('sha256').update(canonical).digest('hex') + '  -\n');
  prepareTee({ ...f, platform: 'win32' });
  assert.equal(git('config', 'core.autocrlf').toString().trim(), 'true');
  assert.equal(git('config', 'core.eol').toString().trim(), 'crlf');
});

test('TEE refuses altered cache content and preserves the existing data', t => {
  const f = fixture(t);
  prepareTee(f);
  const file = join(f.root, '.cache/reclaim-tee/go.mod');
  writeFileSync(file, 'changed cache');
  assert.throws(() => prepareTee(f), /go\.mod.*(mismatch|不匹配)/);
  assert.equal(readFileSync(file, 'utf8'), 'changed cache');
});

test('Windows TEE export copies archive file targets and revalidates the deterministic cache', t => {
  const f = fixture(t, { 'service-link': 'go.mod', 'nested/chain': '../service-link' });
  const destination = prepareTee({ ...f, platform: 'win32' });
  for (const name of ['service-link', 'nested/chain']) {
    assert.equal(lstatSync(join(destination, name)).isFile(), true, `${name} must be a regular file on Windows`);
    assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(destination, 'go.mod')));
  }
  const archive = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', f.source, 'archive', f.revision]);
  assert.equal(readFileSync(join(destination, '.archive-sha256'), 'utf8'), createHash('sha256').update(archive.stdout).digest('hex') + '  -\n');
  prepareTee({ ...f, platform: 'win32' });
});

test('POSIX TEE export keeps archive symlinks and revalidates them', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, { 'service-link': 'go.mod' });
  const destination = prepareTee({ ...f, platform: 'darwin' });
  assert.equal(lstatSync(join(destination, 'service-link')).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(destination, 'service-link')), 'go.mod');
  prepareTee({ ...f, platform: 'darwin' });
});

for (const name of ['service-link', 'go.mod', '.archive-sha256']) {
  test(`Windows TEE cache rejects tampered ${name} and preserves existing bytes`, t => {
    const f = fixture(t, { 'service-link': 'go.mod' });
    const destination = prepareTee({ ...f, platform: 'win32' });
    const file = join(destination, name);
    writeFileSync(file, 'tampered Windows cache');
    assert.throws(() => prepareTee({ ...f, platform: 'win32' }), error => error.message.includes(name) && /SHA256 mismatch/.test(error.message));
    assert.equal(readFileSync(file, 'utf8'), 'tampered Windows cache');
  });
}

for (const [reason, links, evidence] of [
  ['absolute', { 'service-link': '/go.mod' }, /service-link.*\/go\.mod/],
  ['Windows absolute', { 'service-link': 'C:\\go.mod' }, /service-link.*C:/],
  ['escaping', { 'service-link': '../outside' }, /service-link.*\.\.\/outside/],
  ['missing', { 'service-link': 'missing-file' }, /service-link.*missing-file/],
  ['missing intermediate directory', { 'service-link': 'missing-dir/../go.mod' }, /service-link.*missing-dir/],
  ['file as intermediate directory', { 'service-link': 'go.mod/../go.mod' }, /service-link.*go\.mod/],
  ['cyclic', { 'service-link': 'other-link', 'other-link': 'service-link' }, /cyc.*(service-link|other-link)/i],
  ['directory', { 'service-link': 'nested', 'nested/child': '../go.mod' }, /service-link.*nested/],
]) {
  test(`TEE archive rejects ${reason} link targets before creating a cache`, t => {
    const f = fixture(t, links);
    assert.throws(() => prepareTee({ ...f, platform: 'win32' }), evidence);
    assert.equal(existsSync(join(f.root, '.cache/reclaim-tee')), false);
    assert.deepEqual(readdirSync(join(f.root, '.cache')), []);
  });
}

function tarArchive(entries, endMarker = true) {
  const blocks = entries.flatMap(({ name, type = '0', content = '', link = '' }) => {
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    header.write(link, 157, 100);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
  });
  if (endMarker) blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

for (const [reason, entries, endMarker, evidence] of [
  ['special target', [{ name: 'alias', type: '2', link: 'special' }, { name: 'special', type: '6' }], true, /special.*actualType=6/],
  ['non-directory parent', [{ name: 'parent', content: 'file' }, { name: 'parent/child', content: 'child' }], true, /parent\/child.*parent/],
  ['duplicate path', [{ name: 'duplicate' }, { name: 'duplicate' }], true, /duplicate/],
  ['missing end marker', [{ name: 'last' }], false, /end marker missing/],
]) {
  test(`TEE validates the complete archive before writing: ${reason}`, t => {
    const f = fixture(t);
    const destination = join(f.root, 'extract');
    mkdirSync(destination);
    const archive = tarArchive([{ name: 'first-file', content: 'must not be written' }, ...entries], endMarker);
    assert.throws(() => extractArchive(archive, destination, 'win32'), evidence);
    assert.deepEqual(readdirSync(destination), []);
  });
}

test('TEE extraction refuses an existing destination entry without following its symlink', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const destination = join(f.root, 'extract');
  mkdirSync(destination);
  symlinkSync(f.source, join(destination, 'outside'));
  assert.throws(() => extractArchive(tarArchive([{ name: 'outside/injected', content: 'must not escape' }]), destination, 'win32'), /destination.*required=empty real directory/);
  assert.equal(existsSync(join(f.source, 'injected')), false);
  assert.equal(readlinkSync(join(destination, 'outside')), f.source);
});

test('TEE link resolution refuses a missing archive target even when the existing cache supplies it', t => {
  const f = fixture(t, { 'service-link': 'missing-file' });
  const destination = join(f.root, '.cache/reclaim-tee');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'missing-file'), 'untrusted cache bytes');
  assert.throws(() => prepareTee({ ...f, platform: 'win32' }), /symlink target missing.*service-link.*missing-file/);
  assert.deepEqual(readdirSync(destination), ['missing-file']);
  assert.equal(readFileSync(join(destination, 'missing-file'), 'utf8'), 'untrusted cache bytes');
});

test('TEE refuses a symlink cache without changing its target', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.cache'));
  symlinkSync(f.source, join(f.root, '.cache/reclaim-tee'));
  assert.throws(() => prepareTee(f), /(symbolic|symlink|符号链接)/);
  assert.equal(readlinkSync(join(f.root, '.cache/reclaim-tee')), f.source);
});

test('TEE rejects an invalid revision before creating a cache', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'TEE_REVISION'), 'main\n');
  assert.throws(() => prepareTee({ root: f.root, source: f.source }), /main.*40/);
  assert.equal(existsSync(join(f.root, '.cache')), false);
});

test('sidecar build rejects a Rust target mismatch before running Go', t => {
  const f = fixture(t);
  let compiled = false;
  assert.throws(() => buildBee({ root: f.root, target: 'aarch64-apple-darwin', run: (cmd) => { if (cmd === 'rustc') return 'host: x86_64-apple-darwin\n'; compiled = true; return ''; } }), /x86_64-apple-darwin.*aarch64-apple-darwin/);
  assert.equal(compiled, false);
});

test('sidecar build records the actual binary version, target and SHA256', t => {
  const f = fixture(t);
  const binary = Buffer.from('compiled fixture bytes');
  const output = buildBee({ root: f.root, target: 'aarch64-apple-darwin', run: (command, args) => {
    if (command === 'rustc') return 'host: aarch64-apple-darwin\n';
    if (command === 'git') return f.revision;
    if (command === 'go' && args[0] === 'version') return 'go version go1.27.3 darwin/arm64';
    if (command === 'go' && args[0] === 'build') { writeFileSync(args[args.indexOf('-o')+1], binary); return ''; }
    if (command === '/usr/bin/otool') return 'cmd LC_BUILD_VERSION\n platform 1\n minos 13.0\n sdk 14.4\n';
    return 'bee dev+fixture darwin/arm64\n';
  } });
  const source = JSON.parse(readFileSync(output + '.source.json', 'utf8'));
  assert.equal(source.beeVersion, 'dev+fixture');
  assert.equal(source.binarySha256, createHash('sha256').update(binary).digest('hex'));
  assert.equal(source.target, 'aarch64-apple-darwin');
  assert.equal(source.revision, f.revision);
});

for (const target of ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc']) {
  test(`sidecar build presets AppImage RUNPATH only for Linux: ${target}`, t => {
    const f = fixture(t);
    const { goos, goarch } = beeTarget(target);
    let buildArgs, buildEnvironment;
    const output = buildBee({ root: f.root, target, run: (command, args, options) => {
      if (command === 'rustc') return `host: ${target}\n`;
      if (command === 'git') return f.revision;
      if (command === 'go' && args[0] === 'version') return `go version go1.27.3 ${goos}/${goarch}`;
      if (command === 'go' && args[0] === 'build') {
        buildArgs = args;
        buildEnvironment = options.env;
        writeFileSync(args[args.indexOf('-o') + 1], 'final linked fixture bytes');
        return '';
      }
      if (command === '/usr/bin/otool') return 'cmd LC_BUILD_VERSION\n minos 13.0\n';
      return `bee dev+fixture ${goos}/${goarch}\n`;
    } });
    const linkerArgs = buildArgs.filter(arg => arg.startsWith('-ldflags'));
    assert.deepEqual(linkerArgs, goos === 'linux' ? ['-ldflags=-r=$ORIGIN/../lib'] : []);
    assert.equal(buildEnvironment.CGO_ENABLED, process.env.CGO_ENABLED, 'preserve existing CGO selection');
    assert.equal(JSON.parse(readFileSync(output + '.source.json')).binarySha256,
      createHash('sha256').update(readFileSync(output)).digest('hex'));
  });
}

test('macOS sidecar enforces deployment target 13 and rejects a newer actual minimum', t => {
  const f = fixture(t);
  let buildEnvironment;
  const run = (command, args, options) => {
    if (command === 'rustc') return 'host: aarch64-apple-darwin\n';
    if (command === 'git') return f.revision;
    if (command === 'go' && args[0] === 'version') return 'go version go1.27.3 darwin/arm64';
    if (command === 'go' && args[0] === 'build') { buildEnvironment = options.env; writeFileSync(args[args.indexOf('-o')+1], 'binary'); return ''; }
    if (command === '/usr/bin/otool') return 'cmd LC_BUILD_VERSION\n platform 1\n minos 14.4\n sdk 14.4\n';
    return 'bee dev+fixture darwin/arm64\n';
  };
  assert.throws(() => buildBee({ root: f.root, target: 'aarch64-apple-darwin', run }), /min.*14\.4.*13\.0/);
  assert.equal(buildEnvironment.MACOSX_DEPLOYMENT_TARGET, '13.0');
});

test('sidecar build rejects a binary reporting a different OS or architecture', t => {
  const f = fixture(t);
  assert.throws(() => buildBee({ root: f.root, target: 'aarch64-apple-darwin', run: (command, args) => {
    if (command === 'rustc') return 'host: aarch64-apple-darwin\n';
    if (command === 'git') return f.revision;
    if (command === 'go' && args[0] === 'version') return 'go version go1.27.3 darwin/arm64';
    if (command === 'go' && args[0] === 'build') { writeFileSync(args[args.indexOf('-o')+1], 'binary'); return ''; }
    if (command === '/usr/bin/otool') return 'cmd LC_BUILD_VERSION\n platform 1\n minos 13.0\n sdk 14.4\n';
    return 'bee dev windows/amd64\n';
  } }), /windows\/amd64.*darwin\/arm64/);
});
