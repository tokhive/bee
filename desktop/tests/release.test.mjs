import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildBee } from '../scripts/build-bee.mjs';

const target = 'aarch64-apple-darwin';
const revision = 'a'.repeat(40);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function json(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bee-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  json(join(root, 'desktop/package.json'), { version: '0.1.0' });
  mkdirSync(join(root, 'desktop/src-tauri'), { recursive: true });
  writeFileSync(join(root, 'desktop/src-tauri/Cargo.toml'), '[package]\nname="bee-desktop"\nversion="0.1.0"\n');
  json(join(root, 'desktop/src-tauri/tauri.conf.json'), {
    version: '0.1.0', productName: 'Bee', identifier: 'dev.tokhive.bee',
    app: { windows: [{ label: 'main', title: 'Bee' }] },
    build: { beforeBuildCommand: 'npm run build', frontendDist: '../dist' },
    bundle: { externalBin: ['binaries/bee'], windows: { nsis: { installMode: 'currentUser' } } },
  });
  writeFileSync(join(root, 'TEE_REVISION'), 'b'.repeat(40));
  const run = (command, args) => command === 'git' ? args[0] === 'status' ? '' : revision : `host: ${target}\n`;
  const env = { BEE_RELEASE_VERSION: '0.1.0', BEE_RELEASE_CHANNEL: 'stable', BEE_UPDATE_ENDPOINT: 'https://raw.githubusercontent.com/example/bee/main/releases/stable.json', BEE_UPDATER_PUBLIC_KEY: testSignature(Buffer.from('fixture')).publicKey, BEE_RELEASE_ASSET_BASE_URL: 'https://github.com/example/bee/releases/download/v0.1.0/' };
  return { root, env, run, target };
}
async function prepareModule() {
  assert.equal(existsSync(new URL('../scripts/prepare-release.mjs', import.meta.url)), true, 'release preparation implementation is missing');
  return import('../scripts/prepare-release.mjs');
}
async function verifyModule() {
  assert.equal(existsSync(new URL('../scripts/verify-release.mjs', import.meta.url)), true, 'release verifier implementation is missing');
  return import('../scripts/verify-release.mjs');
}

// Minisign packets use key-id plus Ed25519, including a signed trusted comment.
function testSignature(bytes, algorithm = 'ED') {
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const id = Buffer.alloc(8, 7);
  const signed = sign(null, algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes, pair.privateKey);
  const comment = 'timestamp:1700000000\\tfile:Bee.app.tar.gz\\tversion:0.1.0';
  return {
    publicKey: Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), id, key]).toString('base64')}\n`).toString('base64'),
    signature: Buffer.from(`untrusted comment: signature\n${Buffer.concat([Buffer.from(algorithm), id, signed]).toString('base64')}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signed, Buffer.from(comment)]), pair.privateKey).toString('base64')}\n`).toString('base64'),
  };
}

test('release sidecar embeds the App version and rejects a different real binary version', t => {
  const f = fixture(t);
  let linker;
  const run = (command, args) => {
    if (command === 'rustc') return `host: ${target}\n`;
    if (command === 'git') return revision;
    if (command === 'go' && args[0] === 'version') return 'go version go1.27.3 darwin/arm64';
    if (command === 'go') { linker = args.find(arg => arg.startsWith('-ldflags')); writeFileSync(args[args.indexOf('-o') + 1], 'compiled fixture'); return ''; }
    if (command === '/usr/bin/otool') return ' minos 13.0\n';
    return 'bee dev+wrong darwin/arm64';
  };
  assert.throws(() => buildBee({ ...f, run, releaseVersion: '0.1.0' }), /beeVersion.*dev\+wrong.*0\.1\.0/);
  assert.match(linker, /-X main\.version=0\.1\.0/);
});

test('release preparation fixes Bee/native/current-user identity without changing application id', async t => {
  const f = fixture(t);
  const { prepareRelease } = await prepareModule();
  const result = prepareRelease({ ...f, mode: 'candidate' });
  const conf = JSON.parse(readFileSync(result.configPath));
  assert.equal(conf.productName, 'Bee');
  assert.equal(conf.identifier, 'dev.tokhive.bee');
  assert.equal(conf.app.windows[0].title, 'Bee');
  assert.equal(conf.build.beforeBuildCommand, 'npm run build');
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(conf.plugins.updater.requireSignedVersion, true);
  assert.equal(conf.bundle.windows.nsis.hooks, undefined, 'do not add uninstall data deletion hooks');
  assert.equal(result.manifest.status, 'candidate');
  assert.equal(result.manifest.revision, revision);
  assert.equal(result.manifest.target, target);
});

test('candidate without production inputs stays explicitly unsigned and disables updater artifacts', async t => {
  const f = fixture(t);
  const { prepareRelease } = await prepareModule();
  const prepared = prepareRelease({ ...f, env: {}, mode: 'candidate' });
  const conf = JSON.parse(readFileSync(prepared.configPath));
  assert.equal(conf.bundle.createUpdaterArtifacts, false);
  assert.equal(prepared.manifest.status, 'candidate');
  assert.ok(prepared.manifest.blockers.includes('BEE_UPDATER_PUBLIC_KEY missing'));
  assert.equal(JSON.stringify(prepared).includes('TAURI_SIGNING_PRIVATE_KEY'), false);
});

test('candidate clears configured Windows signing identities and commands', async t => {
  const f = fixture(t), path = join(f.root, 'desktop/src-tauri/tauri.conf.json');
  const config = JSON.parse(readFileSync(path));
  config.bundle.windows.certificateThumbprint = 'existing-user-identity';
  config.bundle.windows.signCommand = 'existing-user-sign-tool';
  json(path, config);
  const { prepareRelease } = await prepareModule();
  const prepared = prepareRelease({ ...f, mode: 'candidate' });
  const result = JSON.parse(readFileSync(prepared.configPath));
  assert.equal(result.bundle.windows.certificateThumbprint, undefined);
  assert.equal(result.bundle.windows.signCommand, undefined);
});

for (const [field, value, error] of [
  ['BEE_RELEASE_VERSION', '0.2.0', /package\.json.*0\.1\.0.*0\.2\.0/],
  ['BEE_UPDATE_ENDPOINT', 'http://example.com/latest.json', /endpoint.*http:.*https:/],
  ['BEE_UPDATE_ENDPOINT', 'https://user:secret@example.com/latest.json', /credentials/],
  ['BEE_UPDATER_PUBLIC_KEY', '', /BEE_UPDATER_PUBLIC_KEY.*missing/],
  ['BEE_UPDATER_PUBLIC_KEY', 'invalid', /public key.*(base64|packet)/],
  ['BEE_RELEASE_CHANNEL', '../stable', /channel/],
  ['BEE_RELEASE_ASSET_BASE_URL', 'https://example.com/file/', /asset base/],
  ['BEE_RELEASE_ASSET_BASE_URL', 'https://github.com/other/repo/releases/download/v0.1.0/', /repository/],
  ['BEE_UPDATE_ENDPOINT', 'https://example.com/stable.json', /endpoint.*repository/],
  ['BEE_UPDATE_ENDPOINT', 'https://raw.githubusercontent.com/example/bee:9443/main/stable/latest.json', /endpoint/],
  ['BEE_UPDATE_ENDPOINT', 'https://raw.githubusercontent.com/example/bee/main/stable/latest.json', /endpoint.*filename/],
]) test(`production rejects unsafe ${field} before writing output`, async t => {
  const f = fixture(t);
  const { prepareRelease } = await prepareModule();
  assert.throws(() => prepareRelease({ ...f, mode: 'production', env: { ...f.env, [field]: value } }), error);
  assert.equal(existsSync(join(f.root, '.cache/desktop-release')), false);
});

test('production refuses an uncommitted source tree while candidate records it', async t => {
  const f = fixture(t);
  const { prepareRelease } = await prepareModule();
  const run = (command, args) => command === 'git' && args[0] === 'status' ? ' M desktop/src/main.tsx' : f.run(command, args);
  assert.throws(() => prepareRelease({ ...f, run, mode: 'production' }), /source tree.*desktop\/src\/main\.tsx/);
  assert.equal(prepareRelease({ ...f, run, mode: 'candidate' }).manifest.workingTreeDirty, true);
});

test('production source stays clean after CI writes root desktop evidence', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, '.gitignore'), readFileSync(new URL('../../.gitignore', import.meta.url)));
  const git = args => {
    const result = spawnSync('git', ['-C', f.root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Bee release tests', '-c', 'user.email=bee@example.invalid', 'commit', '--quiet', '-m', 'source fixture']);
  mkdirSync(join(f.root, 'desktop-ci-evidence'));
  writeFileSync(join(f.root, 'desktop-ci-evidence/preflight.log'), 'actual native tool evidence');
  const { prepareRelease } = await prepareModule();
  const prepared = prepareRelease({ ...f, mode: 'production', run: (command, args) => command === 'git' ? git(args) : f.run(command, args) });
  assert.equal(prepared.manifest.workingTreeDirty, false);
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']).trim(), '');
  mkdirSync(join(f.root, 'other', 'desktop-ci-evidence'), { recursive: true });
  writeFileSync(join(f.root, 'other/desktop-ci-evidence/source.txt'), 'must remain visible');
  assert.match(git(['status', '--porcelain', '--untracked-files=normal']), /other\//, 'ignore only the CI root output directory');
});

for (const [file, edit, evidence] of [
  ['desktop/src-tauri/Cargo.toml', () => '[package]\nversion="0.9.0"\n', /Cargo\.toml.*0\.9\.0/],
  ['desktop/src-tauri/tauri.conf.json', value => ({ ...value, productName: 'Bee Dev' }), /productName.*Bee Dev/],
  ['desktop/src-tauri/tauri.conf.json', value => ({ ...value, build: { ...value.build, beforeBuildCommand: 'npm run build:demo' } }), /beforeBuildCommand.*demo/],
  ['desktop/src-tauri/tauri.conf.json', value => ({ ...value, bundle: { ...value.bundle, windows: { nsis: { installMode: 'perMachine' } } } }), /installMode.*perMachine.*currentUser/],
  ['desktop/src-tauri/tauri.conf.json', value => ({ ...value, bundle: { ...value.bundle, windows: { nsis: { installMode: 'currentUser', installerHooks: './delete-data.nsh' } } } }), /installerHooks/],
]) test(`release rejects unsafe source configuration: ${evidence}`, async t => {
  const f = fixture(t);
  const path = join(f.root, file);
  writeFileSync(path, file.endsWith('json') ? JSON.stringify(edit(JSON.parse(readFileSync(path)))) : edit());
  const { prepareRelease } = await prepareModule();
  assert.throws(() => prepareRelease({ ...f, mode: 'production' }), evidence);
});

test('release verifier refuses PATH Bee and a package payload with different version, target, or commit', async t => {
  const f = fixture(t);
  const { verifyPayload } = await verifyModule();
  const source = { revision, teeRevision: 'b'.repeat(40), target, goos: 'darwin', goarch: 'arm64', beeVersion: '0.1.0', binarySha256: digest('payload') };
  const payload = join(f.root, 'Bee.app/Contents/MacOS');
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, 'bee'), 'payload');
  const calls = [];
  const options = { payload: dirname(dirname(payload)), source, expected: { version: '0.1.0', target, revision, teeRevision: 'b'.repeat(40) }, run: (command, args) => { calls.push(command); return command === 'go' ? `build vcs.revision=${revision}\n build GOOS=darwin\n build GOARCH=arm64\n` : 'bee 0.1.0 darwin/arm64'; } };
  assert.equal(verifyPayload(options).beeVersion, '0.1.0');
  assert.equal(calls[0], join(payload, 'bee'));
  for (const [field, value] of [['beeVersion', 'dev'], ['target', 'x86_64-apple-darwin'], ['revision', 'c'.repeat(40)]]) {
    assert.throws(() => verifyPayload({ ...options, source: { ...source, [field]: value } }), new RegExp(`${field}.*${value}`));
  }
  assert.throws(() => verifyPayload({ ...options, run: () => 'bee 0.2.0 darwin/arm64' }), /version.*0\.2\.0.*0\.1\.0/);
  writeFileSync(join(payload, 'bee'), 'changed bytes');
  assert.throws(() => verifyPayload(options), /SHA256.*actual=.*required=/);
});

test('Tauri updater signature verification checks actual asset, key id, and trusted comment', async () => {
  const { verifyUpdaterSignature } = await verifyModule();
  const bytes = Buffer.from('real updater bytes');
  for (const algorithm of ['ED', 'Ed']) {
    const { publicKey, signature } = testSignature(bytes, algorithm);
    assert.equal(verifyUpdaterSignature(bytes, signature, publicKey, '0.1.0'), true);
    assert.throws(() => verifyUpdaterSignature(bytes, signature, publicKey, '0.2.0'), /signed version/);
    assert.throws(() => verifyUpdaterSignature(Buffer.from('changed'), signature, publicKey, '0.1.0'), /updater signature/);
    const changed = Buffer.from(signature, 'base64').toString().replace('timestamp:1700000000', 'timestamp:1700000001');
    assert.throws(() => verifyUpdaterSignature(bytes, Buffer.from(changed).toString('base64'), publicKey), /trusted comment/);
    assert.throws(() => verifyUpdaterSignature(bytes, signature, testSignature(bytes).publicKey), /key id|signature/);
  }
});

test('unsigned candidate cannot be promoted to formal by a manifest status or claimed evidence', async t => {
  const f = fixture(t);
  const { verifyRelease } = await verifyModule();
  const { prepareRelease } = await prepareModule();
  const prepared = prepareRelease({ ...f, mode: 'candidate' });
  assert.throws(() => verifyRelease({ artifacts: prepared.output, formal: true, run: f.run }), /package|artifacts|production/);
});

test('packaged App architecture must match its Bee release target', async () => {
  const release = await verifyModule();
  assert.equal(typeof release.verifyAppArchitecture, 'function', 'App architecture verification missing');
  const macho = Buffer.alloc(32); macho.writeUInt32LE(0xfeedfacf); macho.writeUInt32LE(0x0100000c, 4);
  assert.equal(release.verifyAppArchitecture(macho, 'aarch64-apple-darwin'), true);
  assert.throws(() => release.verifyAppArchitecture(macho, 'x86_64-apple-darwin'), /App architecture.*actual=.*required=/);
  const pe = Buffer.alloc(128); pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.write('PE\0\0', 64); pe.writeUInt16LE(0x8664, 68);
  assert.equal(release.verifyAppArchitecture(pe, 'x86_64-pc-windows-msvc'), true);
  const elf = Buffer.alloc(64); elf.write('\x7fELF'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18);
  assert.equal(release.verifyAppArchitecture(elf, 'aarch64-unknown-linux-gnu'), true);
  assert.throws(() => release.verifyAppArchitecture(elf, 'x86_64-unknown-linux-gnu'), /App architecture/);
});

test('verified signed AppImage emits a candidate manifest and rejects later asset tampering', async t => {
  const f = fixture(t), target = 'aarch64-unknown-linux-gnu';
  const { prepareRelease } = await prepareModule();
  const { verifyRelease } = await verifyModule();
  const bytes = Buffer.from('signed AppImage fixture'), signed = testSignature(bytes);
  const run = (command, args, options) => {
    if (command === 'rustc') return `host: ${target}\n`;
    if (args[0] === '--appimage-extract') {
      const payload = join(options.cwd, 'squashfs-root');
      mkdirSync(join(payload, 'usr/bin'), { recursive: true });
      writeFileSync(join(payload, 'Bee.desktop'), '[Desktop Entry]\nName=Bee\n');
      writeFileSync(join(payload, 'usr/bin/bee'), 'payload');
      const elf = Buffer.alloc(64); elf.write('\x7fELF'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18);
      writeFileSync(join(payload, 'usr/bin/bee-desktop'), elf);
      return '';
    }
    if (command === 'go') return `build vcs.revision=${revision}\nbuild GOOS=linux\nbuild GOARCH=arm64\nbuild vcs.modified=false`;
    if (command.endsWith('/bee')) return 'bee 0.1.0 linux/arm64';
    return f.run(command, args);
  };
  const prepared = prepareRelease({ ...f, target, run, mode: 'production', env: { ...f.env, BEE_UPDATER_PUBLIC_KEY: signed.publicKey } });
  const name = 'Bee_0.1.0_aarch64.AppImage';
  writeFileSync(join(prepared.output, name), bytes);
  writeFileSync(join(prepared.output, name + '.sig'), signed.signature);
  const assets = [{ name, role: 'installer', sha256: digest(bytes), size: bytes.length }, { name: name + '.sig', role: 'signature', sha256: digest(signed.signature), size: Buffer.byteLength(signed.signature) }];
  json(join(prepared.output, 'release-manifest.json'), { ...prepared.manifest, assets });
  json(join(prepared.output, 'bee.source.json'), { revision, teeRevision: 'b'.repeat(40), target, goos: 'linux', goarch: 'arm64', beeVersion: '0.1.0', binarySha256: digest('payload') });
  const report = verifyRelease({ artifacts: prepared.output, formal: true, run });
  assert.equal(report.status, 'signed-candidate');
  assert.equal(report.updater.verified, true);
  assert.equal(JSON.parse(readFileSync(join(prepared.output, 'update-manifest.json'))).platforms['linux-aarch64'].bee.version, '0.1.0');
  assert.throws(() => verifyRelease({ artifacts: prepared.output, formal: true, run: (command, args, options) => command === 'go' ? run(command, args, options).replace('vcs.modified=false', 'vcs.modified=true') : run(command, args, options) }), /vcs.modified.*true.*false/);
  writeFileSync(join(prepared.output, name), 'tampered');
  assert.throws(() => verifyRelease({ artifacts: prepared.output, formal: true, run }), /size|SHA256/);
  assert.equal(existsSync(join(prepared.output, 'update-manifest.json')), false, 'failed verification must remove stale publishable manifest');
});

test('macOS updater archive must contain exactly the same App and Bee bytes as its DMG', async t => {
  const f = fixture(t), release = await verifyModule();
  assert.equal(typeof release.verifyMacUpdateArchive, 'function', 'macOS updater payload check missing');
  const bundle = join(f.root, 'archive/Bee.app'), source = join(bundle, 'Contents/MacOS');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'bee'), 'matching Bee');
  writeFileSync(join(source, 'bee-desktop'), 'matching App');
  json(join(bundle, 'Contents/Info.plist'), { CFBundleName: 'Bee', CFBundleIdentifier: 'dev.tokhive.bee', CFBundleShortVersionString: '0.1.0', CFBundleExecutable: 'bee-desktop' });
  mkdirSync(join(bundle, 'Contents/Resources')); writeFileSync(join(bundle, 'Contents/Resources/icon.icns'), 'matching resources');
  mkdirSync(join(bundle, 'Contents/_CodeSignature')); writeFileSync(join(bundle, 'Contents/_CodeSignature/CodeResources'), 'matching signature seal');
  const archive = join(f.root, 'Bee.app.tar.gz');
  const pack = () => { const result = spawnSync('tar', ['-czf', archive, '-C', join(f.root, 'archive'), 'Bee.app']); assert.equal(result.status, 0, result.stderr?.toString()); };
  pack();
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === '/usr/bin/tar') { const result = spawnSync('tar', args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; }
    if (command === '/usr/bin/plutil') {
      try { return JSON.parse(readFileSync(args.at(-1)))[args[1]]; }
      catch (cause) { throw Error(`plutil failed for ${args.at(-1)}: ${cause.message}`); }
    }
    if (command === '/usr/bin/openssl') return 'subject=CN = Developer ID Application: Controlled Fixture\nsha256 Fingerprint=fixture';
    if (['/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/xcrun'].includes(command)) return '';
    throw Error(`unexpected signing fixture command: ${command}`);
  };
  assert.equal(typeof release.macBundleTree, 'function', 'complete App tree snapshot missing');
  const options = { archive, artifacts: f.root, packagedSha256: digest('matching Bee'), appSha256: digest('matching App'), bundleTree: release.macBundleTree(bundle), expected: { version: '0.1.0' }, formal: false, run };
  assert.equal(release.verifyMacUpdateArchive(options), true);
  assert.ok(calls.some(call => call.command === '/usr/bin/codesign' && call.args.includes('--strict')));
  assert.equal(calls.some(call => call.command === '/usr/bin/openssl'), false, 'candidate seal verification does not claim Developer ID');
  assert.equal(release.verifyMacUpdateArchive({ ...options, formal: true }), true);
  assert.ok(calls.some(call => call.command === '/usr/bin/openssl'), 'formal archive verifies Developer ID');
  assert.ok(calls.some(call => call.command === '/usr/bin/xcrun' && call.args[0] === 'stapler'));
  assert.throws(() => release.verifyMacUpdateArchive({ ...options, run: (command, args) => command === '/usr/bin/codesign' ? (() => { throw Error('signature check failed: actual status=1; required=valid full App seal'); })() : run(command, args) }), /signature check failed/);
  writeFileSync(join(source, 'bee'), 'other Bee'); pack();
  assert.throws(() => release.verifyMacUpdateArchive(options), /updater Bee SHA256/);
  writeFileSync(join(source, 'bee'), 'matching Bee');
  for (const relative of ['Contents/Info.plist', 'Contents/_CodeSignature/CodeResources', 'Contents/Resources/icon.icns']) {
    const path = join(bundle, relative), original = readFileSync(path);
    rmSync(path); pack();
    assert.throws(() => release.verifyMacUpdateArchive(options), /Info\.plist|CodeResources|tree/, `${relative} missing must fail`);
    writeFileSync(path, original); writeFileSync(path, relative.endsWith('plist') ? JSON.stringify({ CFBundleName: 'Bee', CFBundleIdentifier: 'wrong.application.id', CFBundleShortVersionString: '0.1.0', CFBundleExecutable: 'bee-desktop' }) : 'corrupt resource'); pack();
    assert.throws(() => release.verifyMacUpdateArchive(options), /CFBundleIdentifier|CodeResources|tree/, `${relative} corrupt must fail`);
    writeFileSync(path, original);
  }
  const plist = join(bundle, 'Contents/Info.plist'), original = readFileSync(plist);
  json(plist, { ...JSON.parse(original), CFBundleShortVersionString: '0.2.0' }); pack();
  assert.throws(() => release.verifyMacUpdateArchive(options), /CFBundleShortVersionString.*0\.2\.0.*0\.1\.0/);
  writeFileSync(plist, 'invalid plist'); pack();
  assert.throws(() => release.verifyMacUpdateArchive(options), /plutil failed.*Info\.plist/);
});

test('macOS updater rejects an archive containing only the two executable hashes', async t => {
  const f = fixture(t), release = await verifyModule();
  const source = join(f.root, 'archive/Bee.app/Contents/MacOS');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'bee'), 'matching Bee'); writeFileSync(join(source, 'bee-desktop'), 'matching App');
  const archive = join(f.root, 'incomplete.app.tar.gz');
  const result = spawnSync('tar', ['-czf', archive, '-C', join(f.root, 'archive'), 'Bee.app']);
  assert.equal(result.status, 0, result.stderr?.toString());
  const run = (command, args) => { assert.equal(command, '/usr/bin/tar'); const result = spawnSync('tar', args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  assert.throws(() => release.verifyMacUpdateArchive({ archive, artifacts: f.root, packagedSha256: digest('matching Bee'), appSha256: digest('matching App'), expected: { version: '0.1.0' }, formal: true, run }), /Info\.plist|signature|structure/);
});

test('Windows signature verifier binds installer paths as a literal -File parameter', async t => {
  const f = fixture(t), release = await verifyModule();
  assert.equal(typeof release.verifyWindowsSignature, 'function', 'Windows -File signature verification missing');
  const packagePath = join(f.root, 'Bee Installer & [stable] 0.1.0.exe');
  writeFileSync(packagePath, 'fixture installer');
  let scriptPath;
  const options = { packagePath, directory: f.root, run: (command, args) => {
    assert.equal(command, 'powershell.exe');
    assert.equal(args.includes('-Command'), false);
    scriptPath = args[args.indexOf('-File') + 1];
    assert.equal(args[args.indexOf('-PackagePath') + 1], packagePath);
    const script = readFileSync(scriptPath, 'utf8');
    assert.match(script, /param\([\s\S]*\[string\]\$PackagePath/);
    assert.match(script, /Get-AuthenticodeSignature -LiteralPath \$PackagePath/);
    assert.equal(script.includes(packagePath), false, 'path data never becomes PowerShell source');
    return JSON.stringify({ status: 'Valid', subject: 'Controlled CI signer', thumbprint: '1234' });
  } };
  assert.equal(release.verifyWindowsSignature(options).status, 'Valid');
  assert.equal(existsSync(scriptPath), false, 'temporary script removed after verification');
  assert.throws(() => release.verifyWindowsSignature({ ...options, run: () => JSON.stringify({ status: 'NotSigned', thumbprint: null }) }), /Authenticode status.*NotSigned.*Valid/);
  assert.equal(existsSync(scriptPath), false);
});

test('macOS updater checks a real ad-hoc App seal after extracting the archive', { skip: process.platform !== 'darwin' }, async t => {
  const f = fixture(t), release = await verifyModule(), bundle = join(f.root, 'native/Bee.app');
  mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true }); mkdirSync(join(bundle, 'Contents/Resources'));
  const bee = join(bundle, 'Contents/MacOS/bee'), app = join(bundle, 'Contents/MacOS/bee-desktop');
  cpSync('/bin/echo', bee); cpSync('/usr/bin/true', app);
  writeFileSync(join(bundle, 'Contents/Resources/icon.icns'), 'sealed fixture resource');
  const native = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    if (result.status !== 0) throw Error(`${command} failed: exit=${result.status}; stderr=${result.stderr}`);
    return result.stdout;
  };
  native('/usr/bin/plutil', ['-convert', 'xml1', '-o', join(bundle, 'Contents/Info.plist'), '-'], { input: JSON.stringify({ CFBundleName: 'Bee', CFBundleIdentifier: 'dev.tokhive.bee', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '0.1.0', CFBundleExecutable: 'bee-desktop', CFBundlePackageType: 'APPL' }) });
  for (const path of [bee, app, bundle]) native('/usr/bin/codesign', ['--force', '--sign', '-', path]);
  const archive = join(f.root, 'native.app.tar.gz'), pack = () => native('/usr/bin/tar', ['-czf', archive, '-C', join(f.root, 'native'), 'Bee.app'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  pack();
  const options = { archive, artifacts: f.root, packagedSha256: digest(readFileSync(bee)), appSha256: digest(readFileSync(app)), bundleTree: release.macBundleTree(bundle), expected: { version: '0.1.0' }, formal: false };
  assert.equal(release.verifyMacUpdateArchive(options), true);
  writeFileSync(join(bundle, 'Contents/Resources/icon.icns'), 'tampered sealed resource'); pack();
  assert.throws(() => release.verifyMacUpdateArchive({ ...options, bundleTree: release.macBundleTree(bundle) }), /codesign.*failed[\s\S]*(sealed resource|resource envelope|invalid|modified)/);
});

test('Windows PowerShell resolves a literal path with spaces and shell punctuation', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t), release = await verifyModule();
  const packagePath = join(f.root, 'Bee Installer & [stable] 0.1.0.ps1');
  writeFileSync(packagePath, '# unsigned signature-input fixture; never executed\n');
  assert.throws(() => release.verifyWindowsSignature({ packagePath, directory: f.root }), /Windows Authenticode status mismatch: actual=NotSigned; required=Valid/);
});
