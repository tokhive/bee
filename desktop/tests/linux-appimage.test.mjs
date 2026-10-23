import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

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
  let width = 1000, height = 700;
  return {
    program: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    evidenceDir: join(root, 'observation'), startupMs: 800, observeMs: 150, pollMs: 20,
    findWindows: async pid => [{ id: '42', pid, title: 'fixture window' }],
    screenshot: async (_window, path) => writeFileSync(path, png),
    captureDesktop: async path => writeFileSync(path, png),
    resizeWindow: async (_window, requestedWidth, requestedHeight) => { width = requestedWidth; height = requestedHeight; },
    inspectWindow: async () => ({ geometry: `WINDOW=42\nX=0\nY=0\nWIDTH=${width}\nHEIGHT=${height}\nSCREEN=0`, tree: 'fixture window tree' }),
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
test('captures initial and final owned window plus desktop after the actual observation interval', async t => {
  const captures = [];
  const options = observeOptions(t, {
    screenshot: async (_window, path) => { captures.push({ path, at: Date.now() }); writeFileSync(path, png); },
  });
  const report = await subject('observeOwnedProcess')(options);
  assert.equal(captures.length, 2);
  assert.ok(captures[0].path.endsWith('window.initial.png'));
  assert.ok(captures[1].path.endsWith('window.png'));
  assert.ok(captures[1].at - captures[0].at >= options.observeMs);
  assert.deepEqual(report.samples.map(sample => sample.phase), ['initial', 'final']);
  for (const sample of report.samples) {
    assert.ok(Date.parse(sample.completedAt) >= Date.parse(sample.startedAt));
    assert.ok(sample.processes.some(row => row.pid === report.pid));
    assert.match(sample.geometry, sample.phase === 'initial' ? /WIDTH=1000\nHEIGHT=700/ : /WIDTH=860\nHEIGHT=600/);
    assert.equal(sample.tree, 'fixture window tree');
  }
  assert.ok(existsSync(join(options.evidenceDir, 'root.png')));
  assert.ok(report.samples[1].elapsedMs >= options.observeMs);
});
test('final desktop capture failure retains first screenshot and cleans the owned child', async t => {
  const options = observeOptions(t, { captureDesktop: async () => { throw new Error('fixture desktop capture failed E44'); } });
  await assert.rejects(subject('observeOwnedProcess')(options), /desktop capture failed E44/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.ok(existsSync(join(options.evidenceDir, 'window.initial.png')));
  assert.deepEqual(report.cleanup.liveRemaining, []);
});
test('minimum client resize targets only the same owned window and starts observation after resize', async t => {
  let resizedAt;
  let size = [1000, 700];
  const captures = [];
  const requests = [];
  const options = observeOptions(t, {
    findWindows: async pid => [{ id: '8', pid: process.pid }, { id: '42', pid }],
    resizeWindow: async (window, width, height) => {
      requests.push({ ...window, width, height });
      await delay(180);
      size = [width, height];
      resizedAt = Date.now();
    },
    inspectWindow: async () => ({ geometry: `WIDTH=${size[0]}\nHEIGHT=${size[1]}`, tree: 'fixture tree' }),
    screenshot: async (_window, path) => { captures.push(Date.now()); writeFileSync(path, png); },
  });
  const report = await subject('observeOwnedProcess')(options);
  assert.deepEqual(requests, [{ id: '42', pid: report.pid, width: 860, height: 600 }]);
  assert.ok(captures[1] - resizedAt >= options.observeMs, 'resize latency must not count toward observation');
  assert.ok(report.observedMs >= options.observeMs);
  assert.deepEqual(report.resize.requested, { width: 860, height: 600 });
  assert.deepEqual(report.resize.actual, { width: 860, height: 600 });
  assert.equal(report.resize.geometry, 'WIDTH=860\nHEIGHT=600');
  assert.ok(Date.parse(report.resize.completedAt) >= Date.parse(report.resize.startedAt));
  assert.deepEqual(report.samples[1].actual, { width: 860, height: 600 });
  assert.deepEqual(report.finalGeometry.actual, { width: 860, height: 600 });
  assert.match(report.scope, /client.*size.*startup/);
  assert.match(report.scope, /no.*readiness/);
});

async function rejectAndCheckCleanup(options, expected) {
  await assert.rejects(subject('observeOwnedProcess')(options), expected);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.deepEqual(report.cleanup.liveRemaining, []);
  assert.equal(report.cleanup.parentClosed, true);
  return report;
}

test('resize exit success cannot replace actual minimum geometry', async t => {
  const options = observeOptions(t, { resizeWindow: async () => {} });
  const report = await rejectAndCheckCleanup(options, /client size mismatch.*actual=.*1000.*700.*required=.*860.*600/s);
  assert.match(report.resize.geometry, /WIDTH=1000/);
  assert.equal(existsSync(join(options.evidenceDir, 'window.png')), false);
});

for (const [label, geometry] of [
  ['missing', 'HEIGHT=600'], ['inline', 'WIDTH=860 HEIGHT=600'],
  ['illegal', 'WIDTH=860px\nHEIGHT=600'], ['negative', 'WIDTH=-860\nHEIGHT=600'],
  ['duplicate', 'WIDTH=860\nWIDTH=860\nHEIGHT=600'],
  ['conflicting', 'WIDTH=860\nHEIGHT=600\nHEIGHT=700'],
]) {
  test(`minimum geometry rejects ${label} fields with raw evidence and cleanup`, async t => {
    let resized = false;
    const options = observeOptions(t, {
      resizeWindow: async () => { resized = true; },
      inspectWindow: async () => ({ geometry: resized ? geometry : 'WIDTH=1000\nHEIGHT=700' }),
    });
    const report = await rejectAndCheckCleanup(options, /invalid client geometry.*actual=.*required=/);
    assert.equal(report.resize.geometry, geometry);
    assert.ok(report.error.includes(JSON.stringify(geometry)));
  });
}

for (const phase of ['before final capture', 'after final capture']) {
  test(`minimum geometry rebound ${phase} fails and cleans the child`, async t => {
    let reads = 0, captured = false;
    const options = observeOptions(t, {
      inspectWindow: async () => ({ geometry: ++reads === 1 || (phase === 'before final capture' ? reads >= 3 : captured)
        ? 'WIDTH=1000\nHEIGHT=700' : 'WIDTH=860\nHEIGHT=600' }),
      captureDesktop: async path => { writeFileSync(path, png); captured = true; },
    });
    await rejectAndCheckCleanup(options, /client size mismatch.*actual=.*1000.*700.*required=.*860.*600/s);
    assert.equal(existsSync(join(options.evidenceDir, 'window.png')), phase === 'after final capture');
  });
}

for (const reason of ['fixture resize refused exit=19 stderr=E45', 'spawnSync xdotool ETIMEDOUT']) {
  test(`resize failure preserves ${reason} and cleans the child`, async t => {
    const options = observeOptions(t, { resizeWindow: async () => { throw new Error(reason); } });
    const report = await rejectAndCheckCleanup(options, /client resize failed.*actual=.*required=.*860.*600/s);
    assert.ok(report.error.includes(reason));
    assert.equal(report.observedMs, undefined);
  });
}

for (const phase of ['before resize', 'during resize']) {
  test(`ownership loss ${phase} refuses success and cleans the child`, async t => {
    let owned = true, resized = false;
    const options = observeOptions(t, {
      findWindows: async pid => [{ id: '42', pid: owned ? pid : process.pid }],
      screenshot: async (_window, path) => { writeFileSync(path, png); if (phase === 'before resize') owned = false; },
      resizeWindow: async () => { resized = true; owned = false; },
      inspectWindow: async () => ({ geometry: resized ? 'WIDTH=860\nHEIGHT=600' : 'WIDTH=1000\nHEIGHT=700' }),
    });
    await rejectAndCheckCleanup(options, /observed window disappeared.*actual=.*required=/s);
    assert.equal(resized, phase === 'during resize');
  });
}

for (const timeout of [false, true]) {
  test(`default resize command ${timeout ? 'has a hard timeout' : 'preserves nonzero command evidence'} without X11`, async t => {
    const options = observeOptions(t, { resizeWindow: undefined });
    const bin = join(options.evidenceDir, '..', 'bin');
    mkdirSync(bin);
    const calls = join(bin, 'calls.json');
    writeFileSync(join(bin, 'xdotool'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\n${timeout ? 'setInterval(() => {}, 1000);' : 'console.error("fixture xdotool E46"); process.exit(19);'}\n`, { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const report = await rejectAndCheckCleanup(options, timeout ? /client resize failed.*ETIMEDOUT/s : /client resize failed.*exit=19.*E46/s);
      assert.deepEqual(JSON.parse(readFileSync(calls)), ['windowsize', '--sync', '42', '860', '600']);
      assert.equal(report.resize.timeoutMs, 5000);
      assert.match(report.error, /required=860x600 client window within 5000ms/);
      assert.equal(report.observedMs, undefined);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
}
test('window ownership lost during final capture cannot pass observation', async t => {
  let disappeared = false;
  const options = observeOptions(t, {
    findWindows: async pid => disappeared ? [] : [{ id: '42', pid, title: 'fixture window' }],
    captureDesktop: async path => { writeFileSync(path, png); disappeared = true; },
  });
  await assert.rejects(subject('observeOwnedProcess')(options), /observed window disappeared/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.deepEqual(report.cleanup.liveRemaining, []);
});
for (const loss of ['child exit', 'ownership reassignment']) {
  test(`final geometry ${loss} cannot pass with valid minimum dimensions`, async t => {
    let captured = false, owned = true, childPid;
    const options = observeOptions(t, {
      findWindows: async pid => { childPid = pid; return [{ id: '42', pid: owned ? pid : process.pid }]; },
      captureDesktop: async path => { writeFileSync(path, png); captured = true; },
      inspectWindow: async () => {
        if (captured) {
          if (loss === 'child exit') {
            writeFileSync(join(options.evidenceDir, 'exit-request'), 'exit');
            const deadline = Date.now() + 3000;
            while (true) {
              try { process.kill(childPid, 0); }
              catch (error) { if (error.code === 'ESRCH') break; throw error; }
              assert.ok(Date.now() < deadline, `fixture child exit wait expired: actual pid=${childPid} still exists at ${Date.now()}; required=exit during final geometry read by ${deadline}`);
              await delay(10);
            }
          } else owned = false;
        }
        return { geometry: 'WIDTH=860\nHEIGHT=600' };
      },
    });
    if (loss === 'child exit') options.args = ['-e', `setInterval(() => {
      if (require('node:fs').existsSync(${JSON.stringify(join(options.evidenceDir, 'exit-request'))})) {
        console.error('fixture final geometry exit E47'); process.exit(7);
      }
    }, 10);`];
    const report = await rejectAndCheckCleanup(options, loss === 'child exit'
      ? /native app early exit: code=7; signal=null; stderr=.*E47/s
      : /observed window disappeared.*actual=.*required=/s);
    assert.deepEqual(report.finalGeometry.actual, { width: 860, height: 600 });
    assert.equal(report.observedMs, undefined);
    assert.ok(existsSync(join(options.evidenceDir, 'root.png')));
    if (loss === 'child exit') {
      assert.equal(report.exit.code, 7);
      assert.match(readFileSync(join(options.evidenceDir, 'stderr.log'), 'utf8'), /E47/);
    } else assert.deepEqual(report.lastWindows, [{ id: '42', pid: process.pid }]);
  });
}
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
  // The process snapshot can lose ownership before Node delivers the exit event.
  await assert.rejects(subject('observeOwnedProcess')(options), /native app early exit: code=0; signal=null; stderr=|observed window disappeared: actual=/);
  const report = JSON.parse(readFileSync(join(options.evidenceDir, 'observation.json')));
  assert.equal(report.ok, false);
  assert.equal(report.exit.code, 0);
  assert.equal(report.exit.signal, null);
  assert.equal(report.cleanup.parentClosed, true);
  assert.deepEqual(report.cleanup.liveRemaining, []);
  assert.equal(report.observedMs, undefined);
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
