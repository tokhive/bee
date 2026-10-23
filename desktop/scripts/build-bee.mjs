import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { beeRoot, isMain, run as runProcess, cli } from './process.mjs';

const targets = {
  'aarch64-apple-darwin': { goos: 'darwin', goarch: 'arm64', suffix: '' },
  'x86_64-apple-darwin': { goos: 'darwin', goarch: 'amd64', suffix: '' },
  'x86_64-pc-windows-msvc': { goos: 'windows', goarch: 'amd64', suffix: '.exe' },
  'x86_64-unknown-linux-gnu': { goos: 'linux', goarch: 'amd64', suffix: '' },
  'aarch64-unknown-linux-gnu': { goos: 'linux', goarch: 'arm64', suffix: '' },
};

export function beeTarget(target) {
  if (!Object.hasOwn(targets, target)) throw new Error(`unsupported Rust target: actual=${target}; required=${Object.keys(targets).join(', ')}`);
  return targets[target];
}

export function buildBee({ root = beeRoot, target, run = runProcess } = {}) {
  const host = /^host: (.+)$/m.exec(run('rustc', ['-vV'], { cwd: root }))?.[1];
  target ??= host;
  const { goos, goarch, suffix } = beeTarget(target);
  if (host !== target) throw new Error(`native sidecar target mismatch: actual Rust host=${host}; required target=${target}`);
  const version = run('go', ['version'], { cwd: root }).trim();
  if (!/\bgo1\.27\.3\s/.test(version)) throw new Error(`Go toolchain mismatch: actual=${version}; required=go1.27.3`);
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  const teeRevision = readFileSync(join(root, 'TEE_REVISION'), 'utf8').trim();
  const outputDir = join(root, 'desktop/src-tauri/binaries');
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, `bee-${target}${suffix}`);
  const buildEnv = { ...process.env, GOOS: goos, GOARCH: goarch };
  if (goos === 'darwin') buildEnv.MACOSX_DEPLOYMENT_TARGET = '13.0';
  // Match linuxdeploy's final RUNPATH before provenance hashes these bytes.
  const linkerArgs = goos === 'linux' ? ['-ldflags=-r=$ORIGIN/../lib'] : [];
  run('go', ['build', '-trimpath', ...linkerArgs, '-o', output, './cmd/bee'], { cwd: root, env: buildEnv });
  if (goos === 'darwin') {
    const loadCommands = run('/usr/bin/otool', ['-l', output], { cwd: root });
    const minimum = /^\s*minos\s+(\S+)\s*$/m.exec(loadCommands)?.[1];
    if (!/^13\.0(?:\.0)?$/.test(minimum ?? '')) throw new Error(`built Bee macOS minimum mismatch: actual=${minimum ?? '<missing LC_BUILD_VERSION minos>'}; required=13.0`);
  }
  const binaryVersion = run(output, ['version'], { cwd: root }).trim();
  const reported = /^bee (\S+) (\S+)$/.exec(binaryVersion);
  if (!reported || reported[2] !== `${goos}/${goarch}`) throw new Error(`built Bee version target mismatch: actual=${binaryVersion}; required=bee <version> ${goos}/${goarch}`);
  const binarySha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(output + '.source.json', JSON.stringify({ revision, teeRevision, target, goos, goarch, go: version, beeVersion: reported[1], binarySha256 }, null, 2) + '\n');
  console.log(`Bee sidecar built: ${output}; revision=${revision}; target=${target}`);
  return output;
}

if (isMain(import.meta.url)) cli(() => {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--target')) throw new Error(`invalid build-bee arguments: actual=${JSON.stringify(args)}; required=[--target <Rust triple>]`);
  buildBee({ target: args[1] });
});
