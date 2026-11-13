import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { beeRoot, cli, isMain, run as runProcess } from './process.mjs';
import { beeTarget, buildBee } from './build-bee.mjs';
import { publicKeyPacket, releaseRepository, verifyRelease } from './verify-release.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export const packageFormat = target => target.includes('apple') ? 'dmg' : target.includes('windows') ? 'nsis' : 'appimage';
export function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function releaseInputs({ root = beeRoot, env = process.env, mode = 'candidate' } = {}) {
  if (!['candidate', 'production'].includes(mode)) throw new Error(`release mode invalid: actual=${mode}; required=candidate|production`);
  const pkg = readJson(join(root, 'desktop/package.json'));
  const config = readJson(join(root, 'desktop/src-tauri/tauri.conf.json'));
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'desktop/src-tauri/Cargo.toml'), 'utf8'))?.[1];
  const version = env.BEE_RELEASE_VERSION || pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`release version malformed: actual=${version}; required=SemVer`);
  for (const [name, actual] of [['package.json', pkg.version], ['Cargo.toml', cargo], ['tauri.conf.json', config.version]]) {
    if (actual !== version) throw new Error(`release ${name} version mismatch: actual=${actual}; required=${version}`);
  }
  for (const [field, actual, expected] of [
    ['productName', config.productName, 'Bee'], ['identifier', config.identifier, 'dev.tokhive.bee'],
    ['beforeBuildCommand', config.build?.beforeBuildCommand, 'npm run build'],
    ['frontendDist', config.build?.frontendDist, '../dist'], ['installMode', config.bundle?.windows?.nsis?.installMode, 'currentUser'],
  ]) if (actual !== expected) throw new Error(`release ${field} mismatch: actual=${actual}; required=${expected}`);
  for (const window of config.app?.windows ?? []) if (window.title !== 'Bee') throw new Error(`release window title mismatch: actual=${window.title}; required=Bee`);
  for (const field of ['installerHooks', 'template']) if (config.bundle?.windows?.nsis?.[field]) throw new Error(`release NSIS ${field} unsupported: actual=${config.bundle.windows.nsis[field]}; required=default non-destructive uninstaller`);
  const channel = env.BEE_RELEASE_CHANNEL || 'candidate';
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) throw new Error(`release channel malformed: actual=${channel}; required=lowercase channel name`);
  const endpoint = env.BEE_UPDATE_ENDPOINT || '';
  if (endpoint) {
    let url;
    try { url = new URL(endpoint); } catch { throw new Error(`release endpoint malformed: actual=${endpoint}; required=absolute https: URL`); }
    if (url.username || url.password) throw new Error('release endpoint contains credentials; required=credential-free HTTPS URL');
    if (url.protocol !== 'https:') throw new Error(`release endpoint protocol mismatch: actual=${url.protocol}; required=https:`);
    if (url.hash || url.search) throw new Error(`release endpoint has query/fragment: host=${url.host}; required=static HTTPS manifest`);
  }
  const publicKey = env.BEE_UPDATER_PUBLIC_KEY || '';
  if (publicKey) publicKeyPacket(publicKey);
  const assetBase = env.BEE_RELEASE_ASSET_BASE_URL || '';
  if (assetBase && !new RegExp(`^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/v${version.replaceAll('.', '\\.').replaceAll('-', '\\-')}/$`).test(assetBase)) throw new Error(`release asset base mismatch: actual=${assetBase}; required=https://github.com/<owner>/<repo>/releases/download/v${version}/`);
  if (endpoint && mode === 'production') {
    const repository = releaseRepository(endpoint, channel);
    if (assetBase && new URL(assetBase).pathname.split('/').slice(1, 3).join('/') !== repository) throw new Error(`release asset repository mismatch: actual=${new URL(assetBase).pathname.split('/').slice(1, 3).join('/')}; required=${repository}`);
  }
  const blockers = [];
  for (const [name, value] of [['BEE_RELEASE_VERSION', env.BEE_RELEASE_VERSION], ['BEE_RELEASE_CHANNEL', env.BEE_RELEASE_CHANNEL], ['BEE_UPDATE_ENDPOINT', endpoint], ['BEE_UPDATER_PUBLIC_KEY', publicKey], ['BEE_RELEASE_ASSET_BASE_URL', assetBase]]) if (!value) blockers.push(`${name} missing`);
  if (mode === 'production' && blockers.length) throw new Error(`production release input missing: actual=${blockers.join(', ')}; required=all controlled release inputs`);
  return { mode, version, channel, endpoint, publicKey, assetBase, config, blockers };
}

export function prepareRelease({ root = beeRoot, env = process.env, mode = env.BEE_RELEASE_MODE || 'candidate', target, build = false, run = runProcess } = {}) {
  const input = releaseInputs({ root, env, mode });
  const host = /^host: (.+)$/m.exec(run('rustc', ['-vV'], { cwd: root }))?.[1];
  target ??= host;
  beeTarget(target);
  if (host !== target) throw new Error(`release native target mismatch: actual=${host}; required=${target}`);
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error(`release revision malformed: actual=${revision}; required=40 lowercase hex commit`);
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root }).trim();
  if (mode === 'production' && dirty) throw new Error(`production source tree is uncommitted: actual=${dirty}; required=clean exact release commit`);
  const teeRevision = readFileSync(join(root, 'TEE_REVISION'), 'utf8').trim();
  const output = join(root, '.cache/desktop-release');
  if (existsSync(join(output, 'release-manifest.json'))) throw new Error(`release output already exists: actual=${output}; required=archive previous candidate before preparing a new one`);
  mkdirSync(output, { recursive: true });
  const configPath = join(output, 'tauri.release.conf.json');
  const config = structuredClone(input.config);
  config.bundle.targets = [packageFormat(target)];
  config.bundle.createUpdaterArtifacts = mode === 'production';
  config.plugins = { ...config.plugins, updater: { pubkey: input.publicKey, requireSignedVersion: true } };
  // Never use an installed user's Developer ID while making a local candidate.
  if (mode === 'candidate') {
    config.bundle.macOS = { ...config.bundle.macOS, signingIdentity: '-' };
    delete config.bundle.windows.certificateThumbprint;
    delete config.bundle.windows.signCommand;
  }
  if (mode === 'production' && target.includes('windows')) {
    if (!env.BEE_WINDOWS_CERT_THUMBPRINT) throw new Error('Windows release certificate missing: actual=BEE_WINDOWS_CERT_THUMBPRINT empty; required=controlled CI certificate thumbprint');
    config.bundle.windows.certificateThumbprint = env.BEE_WINDOWS_CERT_THUMBPRINT;
    config.bundle.windows.digestAlgorithm = 'sha256';
    config.bundle.windows.timestampUrl = 'http://timestamp.digicert.com';
  }
  save(configPath, config);
  const manifest = { schemaVersion: 1, status: 'candidate', mode, version: input.version, channel: input.channel, target, format: packageFormat(target), revision, workingTreeDirty: Boolean(dirty), teeRevision, endpoint: input.endpoint, publicKey: input.publicKey, assetBase: input.assetBase, configSha256: sha256(readFileSync(configPath)), blockers: [...input.blockers, 'native signing and platform installation evidence not yet verified'], assets: [] };
  const manifestPath = join(output, 'release-manifest.json');
  save(manifestPath, manifest);
  if (build) {
    if (mode === 'production' && env.GITHUB_ACTIONS !== 'true') throw new Error(`production signing environment rejected: actual GITHUB_ACTIONS=${env.GITHUB_ACTIONS ?? '<missing>'}; required=controlled CI signing environment`);
    const buildEnv = { ...env, BEE_RELEASE_MODE: mode, BEE_RELEASE_VERSION: input.version, BEE_RELEASE_CHANNEL: input.channel, BEE_UPDATE_ENDPOINT: input.endpoint, BEE_UPDATER_PUBLIC_KEY: input.publicKey, BEE_RELEASE_ASSET_BASE_URL: input.assetBase, VITE_BEE_DATA_MODE: 'native' };
    if (mode === 'candidate') {
      buildEnv.APPLE_SIGNING_IDENTITY = '-';
      for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'BEE_WINDOWS_CERT_THUMBPRINT']) delete buildEnv[name];
    }
    const binary = buildBee({ root, target, releaseVersion: input.version, run });
    cpSync(binary + '.source.json', join(output, 'bee.source.json'));
    run(process.execPath, [join(root, 'desktop/node_modules/@tauri-apps/cli/tauri.js'), 'build', '--ci', '--config', configPath, '--bundles', packageFormat(target), '--', '--locked'], { cwd: join(root, 'desktop'), env: buildEnv, timeout: 3_600_000 });
    const bundleRoot = join(env.CARGO_TARGET_DIR || join(root, 'desktop/src-tauri/target'), 'release/bundle');
    const suffix = { dmg: '.dmg', nsis: '.exe', appimage: '.AppImage' }[manifest.format];
    const packages = files(bundleRoot).filter(path => path.endsWith(suffix));
    if (packages.length !== 1) throw new Error(`release package count mismatch: directory=${bundleRoot}; actual=${packages.length}; required=1 ${suffix}`);
    const candidates = files(bundleRoot).filter(path => path === packages[0] || /(?:\.app\.tar\.gz|\.AppImage|\.exe)\.sig$|\.app\.tar\.gz$/.test(path));
    for (const path of candidates) {
      const destination = join(output, basename(path));
      cpSync(path, destination, { errorOnExist: true, force: false });
      const bytes = readFileSync(destination);
      manifest.assets.push({ name: basename(path), size: bytes.length, sha256: sha256(bytes), role: path === packages[0] ? 'installer' : path.endsWith('.sig') ? 'signature' : 'updater' });
    }
    save(manifestPath, manifest);
    verifyRelease({ artifacts: output, formal: mode === 'production', run });
  }
  return { output, configPath, manifest };
}

if (isMain(import.meta.url)) cli(() => {
  const args = process.argv.slice(2);
  let mode = process.env.BEE_RELEASE_MODE || 'candidate', target, build = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--mode') mode = args.shift();
    else if (arg === '--target') target = args.shift();
    else if (arg === '--build') build = true;
    else throw new Error(`release argument unsupported: actual=${arg}; required=[--mode candidate|production] [--target <native triple>] [--build]`);
  }
  console.log(JSON.stringify(prepareRelease({ mode, target, build }), null, 2));
});
