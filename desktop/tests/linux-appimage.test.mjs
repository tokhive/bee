import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

let implementation = {};
try { implementation = await import('../scripts/smoke-linux-appimage.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
function subject(name) {
  assert.equal(typeof implementation[name], 'function', `missing AppImage smoke behavior: ${name}`);
  return implementation[name];
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bee-appimage-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  mkdirSync(join(packageRoot, 'usr/bin'), { recursive: true });
  const binaryPath = join(packageRoot, 'usr/bin/bee');
  writeFileSync(binaryPath, 'actual packaged Bee bytes');
  const source = {
    revision: 'a'.repeat(40), teeRevision: 'b'.repeat(40),
    target: 'aarch64-unknown-linux-gnu', goos: 'linux', goarch: 'arm64',
    go: 'go version go1.27.3 linux/arm64', beeVersion: 'dev+test',
    binarySha256: createHash('sha256').update(readFileSync(binaryPath)).digest('hex'),
  };
  const sourcePath = join(root, 'bee.source.json');
  writeFileSync(sourcePath, JSON.stringify(source));
  return { root, packageRoot, binaryPath, sourcePath, source, target: source.target,
    revision: source.revision, teeRevision: source.teeRevision };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfE0AAAAASUVORK5CYII=', 'base64');
function observeOptions(t, extra = {}) {
  const { root } = fixture(t);
  return {
    program: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    evidenceDir: join(root, 'observation'), startupMs: 800, observeMs: 150, pollMs: 20,
    findWindows: async pid => [{ id: '42', pid, title: 'fixture window' }],
    screenshot: async (_window, path) => writeFileSync(path, png),
    ...extra,
  };
}

test('packaged Bee must match the pinned source metadata and actual bytes', t => {
  const f = fixture(t);
  const result = subject('verifyPackagedBee')(f);
  assert.equal(result.binarySha256, f.source.binarySha256);
  assert.equal(result.source.revision, f.revision);
});
test('changed packaged Bee fails with actual and required hash evidence', t => {
  const f = fixture(t);
  writeFileSync(f.binaryPath, 'packager changed bytes');
  assert.throws(() => subject('verifyPackagedBee')(f), /packaged Bee SHA256 mismatch: actual=[a-f0-9]{64}; required=[a-f0-9]{64}/);
});
test('a package from another source revision is refused', t => {
  const f = fixture(t);
  assert.throws(() => subject('verifyPackagedBee')({ ...f, revision: 'c'.repeat(40) }), /revision mismatch: actual=.*aaaa.*required=.*cccc/);
});
test('packaged Bee symlink cannot resolve outside the extracted package', t => {
  const f = fixture(t);
  rmSync(f.binaryPath);
  const outside = join(f.root, 'outside-bee');
  writeFileSync(outside, 'actual packaged Bee bytes');
  symlinkSync(outside, f.binaryPath);
  assert.throws(() => subject('verifyPackagedBee')(f), /packaged Bee path escapes package/);
});
test('real child survives the observation period; cleanup leaves unrelated process alive', async t => {
  const outsider = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { outsider.once('spawn', resolve); outsider.once('error', reject); });
  t.after(() => outsider.kill());
  const options = observeOptions(t, { args: ['-e', `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'}); setInterval(() => {}, 1000);`] });
  const report = await subject('observeOwnedProcess')(options);
  assert.equal(report.ok, true);
  assert.ok(report.observedMs >= options.observeMs);
  assert.ok(report.processes.some(row => row.pid !== report.pid), 'real descendant must be captured');
  assert.deepEqual(report.cleanup.liveRemaining, []);
  assert.equal(process.kill(outsider.pid, 0), true, 'unrelated process must remain alive');
  assert.ok(existsSync(join(options.evidenceDir, 'window.png')));
});
test('real launch clears inherited extraction and color overrides only in its child environment', async t => {
  const names = ['APPIMAGE_EXTRACT_AND_RUN', 'NO_CLEANUP', 'FORCE_COLOR', 'NO_COLOR'];
  const env = { ...process.env, BEE_SMOKE_ENV_FIXTURE: 'preserved', ...Object.fromEntries(names.map(name => [name, '1'])) };
  const before = { ...env };
  const options = observeOptions(t, { env, args: ['-e', `console.log(JSON.stringify(process.env)); setInterval(() => {}, 1000);`] });
  await subject('observeOwnedProcess')(options);
  const childEnv = JSON.parse(readFileSync(join(options.evidenceDir, 'stdout.log'), 'utf8').trim());
  for (const name of names) assert.equal(childEnv[name], undefined, `${name} must not alter the recorded launch mode or child output`);
  assert.equal(childEnv.BEE_SMOKE_ENV_FIXTURE, 'preserved');
  assert.deepEqual(env, before, 'caller environment must remain unchanged');
});
test('spawn failure is nonzero evidence rather than an observation success', async t => {
  const options = observeOptions(t, { program: '/bee-test-nonexistent-executable' });
  await assert.rejects(subject('observeOwnedProcess')(options), /spawn.*ENOENT/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.match(report.error, /ENOENT/);
});
test('a live child with no window fails and is cleaned up', async t => {
  const options = observeOptions(t, { startupMs: 120, findWindows: async () => [] });
  await assert.rejects(subject('observeOwnedProcess')(options), /no owned visible window.*actual=.*required=/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.deepEqual(report.cleanup.liveRemaining, []);
});
test('an unrelated window cannot satisfy native startup', async t => {
  const options = observeOptions(t, { startupMs: 120,
    findWindows: async () => [{ id: '8', pid: process.pid, title: 'unrelated window' }] });
  await assert.rejects(subject('observeOwnedProcess')(options), /no owned visible window/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.lastWindows[0].pid, process.pid);
});
test('early nonzero exit retains stderr and actual exit code', async t => {
  const options = observeOptions(t, { args: ['-e', 'console.error("fixture native failure E42"); process.exit(7)'], findWindows: async () => [] });
  await assert.rejects(subject('observeOwnedProcess')(options), /early exit.*code=7.*E42/s);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.exit.code, 7);
  assert.equal(report.ok, false);
});
test('exit zero before completing the visible observation still fails', async t => {
  const options = observeOptions(t, { args: ['-e', 'setTimeout(() => process.exit(0), 200)'], observeMs: 450 });
  await assert.rejects(subject('observeOwnedProcess')(options), /early exit.*code=0/);
});
test('a window that disappears during observation is not considered a startup pass', async t => {
  let reads = 0;
  const options = observeOptions(t, { findWindows: async pid => ++reads < 3 ? [{ id: '42', pid, title: 'fixture' }] : [] });
  await assert.rejects(subject('observeOwnedProcess')(options), /observed window disappeared/);
});
test('screenshot failure stops observation and still cleans the owned process', async t => {
  const options = observeOptions(t, { screenshot: async () => { throw new Error('fixture screenshot failed E43'); } });
  await assert.rejects(subject('observeOwnedProcess')(options), /screenshot failed E43/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.deepEqual(report.cleanup.liveRemaining, []);
});
