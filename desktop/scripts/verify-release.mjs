import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beeTarget } from './build-bee.mjs';
import { cli, isMain, run as runProcess } from './process.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function equal(field, actual, required) {
  if (actual !== required) throw new Error(`release ${field} mismatch: actual=${actual}; required=${required}`);
}
function base64(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) throw new Error(`${name} base64 malformed: required=canonical base64 packet`);
  return Buffer.from(value.trim(), 'base64');
}
export function publicKeyPacket(value) {
  const lines = base64(value, 'updater public key').toString('utf8').trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment:')) throw new Error(`updater public key packet malformed: actual lines=${lines.length}; required=minisign public key`);
  const packet = base64(lines[1], 'updater public key');
  if (packet.length !== 42 || packet.subarray(0, 2).toString() !== 'Ed') throw new Error(`updater public key packet malformed: actual bytes=${packet.length}; required=42 byte Ed25519 packet`);
  return packet;
}

export function verifyUpdaterSignature(bytes, encoded, publicKey, version) {
  const key = publicKeyPacket(publicKey);
  const lines = base64(encoded, 'updater signature').toString('utf8').trim().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment:') || !lines[2].startsWith('trusted comment: ')) throw new Error(`updater signature packet malformed: actual lines=${lines.length}; required=four minisign lines`);
  const packet = base64(lines[1], 'updater signature');
  const algorithm = packet.subarray(0, 2).toString();
  if (packet.length !== 74 || !['Ed', 'ED'].includes(algorithm)) throw new Error(`updater signature algorithm/length mismatch: actual algorithm=${algorithm}, bytes=${packet.length}; required=Ed|ED,74`);
  equal('updater signature key id', packet.subarray(2, 10).toString('hex'), key.subarray(2, 10).toString('hex'));
  const cryptoKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' });
  const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const signature = packet.subarray(10);
  if (!verify(null, message, cryptoKey, signature)) throw new Error(`updater signature verification failed: assetSHA256=${hash(bytes)}; required=signature by configured update key`);
  const comment = lines[2].slice('trusted comment: '.length);
  if (!verify(null, Buffer.concat([signature, Buffer.from(comment)]), cryptoKey, base64(lines[3], 'updater trusted comment'))) throw new Error('updater trusted comment signature verification failed; required=untampered signed version');
  if (version) {
    const signedVersion = comment.split(/\t|\\t/).find(part => part.startsWith('version:'))?.slice('version:'.length);
    equal('updater signed version', signedVersion ?? '<missing>', version);
  }
  return true;
}

export function releaseRepository(endpoint, channel) {
  const url = new URL(endpoint), parts = url.pathname.split('/').slice(1);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) throw new Error(`release channel malformed: actual=${channel}; required=lowercase channel name`);
  if (parts.at(-1) !== `${channel}.json`) throw new Error(`release endpoint channel filename mismatch: actual=${parts.at(-1)}; required=${channel}.json`);
  const github = url.hostname === 'github.com' && parts.length >= 6 && parts[2] === 'releases' && (parts[3] === 'download' || (parts[3] === 'latest' && parts[4] === 'download'));
  const raw = url.hostname === 'raw.githubusercontent.com' && parts.length >= 5;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || (!github && !raw) || !parts.slice(0, 2).every(part => /^[A-Za-z0-9_.-]+$/.test(part))) throw new Error(`release endpoint repository mismatch: host=${url.host}; path=${url.pathname}; required=controlled HTTPS GitHub repository channel JSON`);
  return parts.slice(0, 2).join('/');
}

export function createUpdateManifest({ manifest, asset, bytes, signature }) {
  const { goos } = beeTarget(manifest.target);
  const requiredSuffix = { darwin: '.app.tar.gz', windows: '.exe', linux: '.AppImage' }[goos];
  if (basename(asset.name) !== asset.name || !asset.name.endsWith(requiredSuffix)) throw new Error(`updater asset format mismatch: actual=${asset.name}; target=${manifest.target}; required=${requiredSuffix}`);
  equal('updater asset size', bytes.length, asset.size);
  equal('updater asset SHA256', hash(bytes), asset.sha256);
  const base = new URL(manifest.assetBase);
  const repository = releaseRepository(manifest.endpoint, manifest.channel);
  equal('updater asset repository', base.origin + base.pathname, `https://github.com/${repository}/releases/download/v${manifest.version}/`);
  if (base.username || base.password || base.search || base.hash) throw new Error('updater asset base contains credentials/query/fragment; required=pinned static repository asset path');
  verifyUpdaterSignature(bytes, signature, manifest.publicKey, manifest.version);
  const platform = { 'aarch64-apple-darwin': 'darwin-aarch64', 'x86_64-apple-darwin': 'darwin-x86_64', 'x86_64-pc-windows-msvc': 'windows-x86_64', 'x86_64-unknown-linux-gnu': 'linux-x86_64', 'aarch64-unknown-linux-gnu': 'linux-aarch64' }[manifest.target];
  return { version: manifest.version, notes: 'Bee release candidate. Native acceptance required before publication.', pub_date: new Date().toISOString(), platforms: { [platform]: { url: new URL(asset.name, base).href, signature, bee: { channel: manifest.channel, target: manifest.target, version: manifest.version, sha256: asset.sha256, size: asset.size } } } };
}

export function verifyPayload({ payload, source, expected, signedSeal = false, run = runProcess }) {
  const { goos, goarch, suffix } = beeTarget(expected.target);
  for (const [field, value] of Object.entries({ target: expected.target, revision: expected.revision, teeRevision: expected.teeRevision, beeVersion: expected.version, goos, goarch })) equal(`source ${field}`, source[field], value);
  const path = join(resolve(payload), goos === 'darwin' ? 'Contents/MacOS/bee' : goos === 'linux' ? 'usr/bin/bee' : `bee${suffix}`);
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`packaged Bee missing or non-regular: actual=${path}; required=package-contained real Bee (PATH lookup forbidden)`);
  const packagedSha256 = hash(readFileSync(path));
  if (!signedSeal) equal('packaged Bee SHA256', packagedSha256, source.binarySha256);
  const version = run(path, ['version'], { cwd: payload }).trim();
  equal('packaged Bee version/architecture', version, `bee ${expected.version} ${goos}/${goarch}`);
  const build = run('go', ['version', '-m', path], { cwd: payload });
  for (const [field, required] of [['vcs.revision', expected.revision], ['GOOS', goos], ['GOARCH', goarch]]) {
    const actual = new RegExp(`(?:^|\\s)${field.replace('.', '\\.')}=(\\S+)`).exec(build)?.[1];
    equal(`packaged Bee build ${field}`, actual ?? '<missing>', required);
  }
  if (expected.mode === 'production') equal('packaged Bee build vcs.modified', /(?:^|\s)vcs\.modified=(\S+)/.exec(build)?.[1] ?? '<missing>', 'false');
  return { path, beeVersion: expected.version, sourceSha256: source.binarySha256, packagedSha256, signedSeal };
}

export function verifyAppArchitecture(bytes, target) {
  const { goos, goarch } = beeTarget(target);
  let actual = '<unrecognized executable header>';
  let required;
  if (goos === 'darwin') {
    required = goarch === 'arm64' ? 0x0100000c : 0x01000007;
    if (bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf) actual = bytes.readUInt32LE(4);
  } else if (goos === 'windows') {
    required = 0x8664;
    if (bytes.length >= 64 && bytes.subarray(0, 2).toString() === 'MZ') {
      const offset = bytes.readUInt32LE(60);
      if (offset <= bytes.length - 6 && bytes.subarray(offset, offset + 4).equals(Buffer.from('PE\0\0'))) actual = bytes.readUInt16LE(offset + 4);
    }
  } else {
    required = goarch === 'arm64' ? 183 : 62;
    if (bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from('\x7fELF')) && bytes[4] === 2 && bytes[5] === 1) actual = bytes.readUInt16LE(18);
  }
  equal(`App architecture (${target})`, actual, required);
  return true;
}

export function macBundleTree(bundle) {
  const tree = {};
  function visit(relative) {
    const path = join(bundle, relative), stat = lstatSync(path);
    if (stat.isDirectory()) {
      tree[relative] = { type: 'directory' };
      for (const name of readdirSync(path).sort()) visit(relative ? relative + '/' + name : name);
    } else if (stat.isFile()) tree[relative] = { type: 'file', mode: stat.mode & 0o777, sha256: hash(readFileSync(path)) };
    else if (stat.isSymbolicLink()) tree[relative] = { type: 'symlink', target: readlinkSync(path) };
    else throw new Error(`macOS App tree entry unsupported: path=${path}; actualMode=${stat.mode}; required=directory, file, or sealed symlink`);
  }
  visit('');
  return tree;
}

function verifyMacIdentity(bundle, expected, run) {
  for (const [name, type] of [['Contents', 'directory'], ['Contents/MacOS', 'directory'], ['Contents/Resources', 'directory'], ['Contents/_CodeSignature', 'directory'], ['Contents/Info.plist', 'file'], ['Contents/_CodeSignature/CodeResources', 'file']]) {
    const path = join(bundle, name);
    const stat = existsSync(path) ? lstatSync(path) : null;
    if (!stat || (type === 'file' ? !stat.isFile() : !stat.isDirectory()) || stat.isSymbolicLink()) throw new Error(`macOS App structure ${name} invalid: actual=${stat?.mode ?? '<missing>'}; required=real ${type}`);
  }
  for (const [key, required] of [['CFBundleShortVersionString', expected.version], ['CFBundleIdentifier', 'dev.tokhive.bee'], ['CFBundleName', 'Bee'], ['CFBundleExecutable', 'bee-desktop']]) equal(`App ${key}`, run('/usr/bin/plutil', ['-extract', key, 'raw', join(bundle, 'Contents/Info.plist')]).trim(), required);
}

export function verifyMacUpdateArchive({ archive, artifacts, packagedSha256, appSha256, bundleTree, expected, formal = false, run = runProcess }) {
  const directory = mkdtempSync(join(artifacts, '.updater-inspect-'));
  try {
    const names = run('/usr/bin/tar', ['-tzf', archive]).trim().split('\n');
    for (const name of names) if (!name.startsWith('Bee.app/') || name.split('/').includes('..')) throw new Error(`macOS updater archive path mismatch: actual=${name}; required=Bee.app-contained path`);
    run('/usr/bin/tar', ['-xzf', archive, '-C', directory]);
    for (const [name, required] of [['bee', packagedSha256], ['bee-desktop', appSha256]]) {
      const path = join(directory, 'Bee.app/Contents/MacOS', name);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`macOS updater executable non-regular: actual=${path}; required=real package file`);
      equal(`macOS updater ${name === 'bee' ? 'Bee' : 'App'} SHA256`, hash(readFileSync(path)), required);
    }
    const bundle = join(directory, 'Bee.app');
    verifyMacIdentity(bundle, expected, run);
    if (!bundleTree) throw new Error('macOS updater reference App tree missing: required=full verified DMG bundle tree');
    const actualTree = macBundleTree(bundle);
    // File contents, signature resources, permissions, and links must match.
    // Stapling extended attributes are outside this file tree; no file is excluded.
    for (const name of new Set([...Object.keys(bundleTree), ...Object.keys(actualTree)])) equal(`macOS updater App tree ${name || '.'}`, JSON.stringify(actualTree[name]) ?? '<missing>', JSON.stringify(bundleTree[name]) ?? '<absent>');
    verifyMacSeal(bundle, null, directory, formal, run);
    return true;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function verifyMacSeal(bundle, packagePath, directory, formal, run) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  if (!formal) return { seal: 'verified', identity: 'not-production-verified' };
  const prefix = join(directory, 'signing-cert');
  run('/usr/bin/codesign', ['--display', '--extract-certificates', prefix, bundle]);
  const certificate = run('/usr/bin/openssl', ['x509', '-inform', 'DER', '-in', prefix + '0', '-noout', '-subject', '-fingerprint', '-sha256']);
  if (!/CN\s*=\s*Developer ID Application:/.test(certificate)) throw new Error(`macOS signing identity mismatch: actual=${certificate.trim()}; required=Developer ID Application certificate`);
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle]);
  run('/usr/bin/xcrun', ['stapler', 'validate', bundle]);
  if (packagePath) run('/usr/bin/xcrun', ['stapler', 'validate', packagePath]);
  return { seal: 'verified', developerId: certificate.trim(), gatekeeper: 'accepted', notarization: 'stapled-validated' };
}

export function verifyWindowsSignature({ packagePath, directory, run = runProcess }) {
  const scriptPath = join(directory, 'verify-authenticode.ps1');
  const script = `param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $PackagePath
[pscustomobject]@{status=[string]$signature.Status;subject=$signature.SignerCertificate.Subject;thumbprint=$signature.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress
`;
  writeFileSync(scriptPath, script, { flag: 'wx' });
  try {
    const signing = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-PackagePath', packagePath]));
    equal('Windows Authenticode status', signing.status, 'Valid');
    if (!signing.thumbprint) throw new Error('Windows signing identity missing: actual=empty certificate thumbprint; required=verified Authenticode signer');
    return signing;
  } finally { rmSync(scriptPath, { force: true }); }
}

function inspectPackage({ artifacts, manifest, packagePath, source, formal, run }) {
  const directory = mkdtempSync(join(artifacts, '.inspect-'));
  let mounted = false;
  try {
    let payload = join(directory, 'payload');
    mkdirSync(payload);
    let signing = { platform: 'linux', platformSignature: 'not-applicable' };
    if (manifest.format === 'dmg') {
      run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', payload, packagePath]);
      mounted = true;
      const apps = readdirSync(payload).filter(name => name.endsWith('.app'));
      equal('DMG App count', apps.length, 1);
      const bundle = join(payload, apps[0]);
      equal('DMG product', apps[0], 'Bee.app');
      verifyMacIdentity(bundle, manifest, run);
      const appBytes = readFileSync(join(bundle, 'Contents/MacOS/bee-desktop'));
      verifyAppArchitecture(appBytes, manifest.target);
      signing = verifyMacSeal(bundle, packagePath, directory, formal, run);
      return { ...verifyPayload({ payload: bundle, source, expected: manifest, signedSeal: true, run }), appSha256: hash(appBytes), bundleTree: macBundleTree(bundle), signing };
    }
    if (manifest.format === 'appimage') {
      run(packagePath, ['--appimage-extract'], { cwd: payload });
      payload = join(payload, 'squashfs-root');
      const desktopFiles = readdirSync(payload).filter(name => name.endsWith('.desktop'));
      equal('AppImage desktop entry count', desktopFiles.length, 1);
      const desktop = readFileSync(join(payload, desktopFiles[0]), 'utf8');
      if (!/^Name=Bee$/m.test(desktop)) throw new Error(`AppImage desktop Name mismatch: actual=${/^Name=(.*)$/m.exec(desktop)?.[1]}; required=Bee`);
    } else {
      run('7z', ['x', '-y', `-o${payload}`, packagePath]);
      if (formal) {
        signing = verifyWindowsSignature({ packagePath, directory, run });
      }
    }
    verifyAppArchitecture(readFileSync(join(payload, manifest.format === 'appimage' ? 'usr/bin/bee-desktop' : 'bee-desktop.exe')), manifest.target);
    return { ...verifyPayload({ payload, source, expected: manifest, run }), signing };
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', join(directory, 'payload')]);
    rmSync(directory, { recursive: true, force: true });
  }
}

export function verifyRelease({ artifacts, formal = false, run = runProcess } = {}) {
  artifacts = resolve(artifacts);
  // A failed recheck must not leave a previous success ready to publish.
  for (const name of ['verification.json', 'update-manifest.json']) rmSync(join(artifacts, name), { force: true });
  const manifest = readJson(join(artifacts, 'release-manifest.json'));
  equal('manifest schema', manifest.schemaVersion, 1);
  if (formal) equal('production mode', manifest.mode, 'production');
  if (formal) equal('production source tree dirty', manifest.workingTreeDirty, false);
  const configPath = join(artifacts, 'tauri.release.conf.json');
  equal('build configuration SHA256', hash(readFileSync(configPath)), manifest.configSha256);
  const config = readJson(configPath);
  equal('build version', config.version, manifest.version);
  equal('build productName', config.productName, 'Bee');
  equal('build identifier', config.identifier, 'dev.tokhive.bee');
  equal('build native frontend', config.build.beforeBuildCommand, 'npm run build');
  equal('build current user installer', config.bundle.windows.nsis.installMode, 'currentUser');
  if (formal) equal('signed version enforcement', config.plugins?.updater?.requireSignedVersion, true);
  if (config.bundle.windows.nsis.installerHooks || config.bundle.windows.nsis.template) throw new Error('release uninstall customization present; required=default preserving user configuration');
  const installers = manifest.assets.filter(asset => asset.role === 'installer');
  equal('installer artifact count', installers.length, 1);
  for (const asset of manifest.assets) {
    if (basename(asset.name) !== asset.name) throw new Error(`release artifact name escapes output: actual=${asset.name}; required=basename`);
    const path = join(artifacts, asset.name);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`release artifact is not regular: actual=${path}; required=regular asset`);
    const bytes = readFileSync(path);
    equal(`${asset.name} size`, bytes.length, asset.size);
    equal(`${asset.name} SHA256`, hash(bytes), asset.sha256);
  }
  const source = readJson(join(artifacts, 'bee.source.json'));
  const inspected = inspectPackage({ artifacts, manifest, packagePath: join(artifacts, installers[0].name), source, formal, run });
  const update = manifest.format === 'dmg' ? manifest.assets.find(asset => asset.role === 'updater' && asset.name.endsWith('.app.tar.gz')) : installers[0];
  const signature = update && manifest.assets.find(asset => asset.name === update.name + '.sig');
  let updater = { verified: false, reason: 'updater asset/signature not present' };
  if (signature && manifest.publicKey) {
    const encoded = readFileSync(join(artifacts, signature.name), 'utf8').trim();
    verifyUpdaterSignature(readFileSync(join(artifacts, update.name)), encoded, manifest.publicKey, manifest.version);
    if (manifest.format === 'dmg') verifyMacUpdateArchive({ archive: join(artifacts, update.name), artifacts, packagedSha256: inspected.packagedSha256, appSha256: inspected.appSha256, bundleTree: inspected.bundleTree, expected: manifest, formal, run });
    updater = { verified: true, asset: update.name, signature: encoded, sha256: update.sha256, size: update.size };
  }
  if (formal && !updater.verified) throw new Error(`production updater signature missing: actual=${updater.reason}; required=signed version-bound update artifact`);
  const report = { status: formal ? 'signed-candidate' : 'candidate', version: manifest.version, revision: manifest.revision, target: manifest.target, inspected, updater, blockers: formal ? ['target native install/upgrade acceptance remains required before publication'] : [...manifest.blockers, 'production signatures and notarization not verified'] };
  if (formal) {
    const updateManifest = createUpdateManifest({ manifest, asset: update, bytes: readFileSync(join(artifacts, updater.asset)), signature: updater.signature });
    writeFileSync(join(artifacts, 'update-manifest.json'), JSON.stringify(updateManifest, null, 2) + '\n');
  }
  writeFileSync(join(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (isMain(import.meta.url)) cli(() => {
  const args = process.argv.slice(2);
  let artifacts, formal = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--artifacts') artifacts = args.shift();
    else if (arg === '--require-signing') formal = true;
    else throw new Error(`verify release argument unsupported: actual=${arg}; required=--artifacts <directory> [--require-signing]`);
  }
  if (!artifacts) throw new Error('release artifacts missing: actual=--artifacts absent; required=release output directory');
  console.log(JSON.stringify(verifyRelease({ artifacts, formal }), null, 2));
});
