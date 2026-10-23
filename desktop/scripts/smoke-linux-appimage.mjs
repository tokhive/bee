import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { beeRoot, isMain } from './process.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`command failed: ${program} ${args.join(' ')}; exit=${result.status}; signal=${result.signal}; ${result.error?.message ?? ''}; stderr=${result.stderr}; stdout=${result.stdout}`);
  return result.stdout.trim();
}
function equal(name, actual, expected) {
  if (actual !== expected) throw new Error(`${name} mismatch: actual=${actual}; required=${expected}`);
}

export function verifyPackagedBee({ packageRoot, binaryPath, sourcePath, target, revision, teeRevision }) {
  const actual = realpathSync(binaryPath);
  const inside = relative(realpathSync(packageRoot), actual);
  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error(`packaged Bee path escapes package: actual=${actual}; required root=${packageRoot}`);
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const goarch = target === 'aarch64-unknown-linux-gnu' ? 'arm64' : target === 'x86_64-unknown-linux-gnu' ? 'amd64' : undefined;
  if (!goarch) throw new Error(`unsupported Linux package target: actual=${target}; required=x86_64-unknown-linux-gnu or aarch64-unknown-linux-gnu`);
  for (const [name, expected] of Object.entries({ target, revision, teeRevision, goos: 'linux', goarch, go: `go version go1.27.3 linux/${goarch}` })) equal(name, source[name], expected);
  if (!/^[a-f0-9]{64}$/.test(source.binarySha256)) throw new Error(`invalid source binarySha256: actual=${source.binarySha256}; required=64 lowercase hex characters`);
  const binarySha256 = digest(actual);
  equal('packaged Bee SHA256', binarySha256, source.binarySha256);
  return { binaryPath: actual, binarySha256, source };
}

function groupProcesses(pid) {
  return command('ps', ['-eo', 'pid=,ppid=,pgid=,stat=,comm=']).split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match || Number(match[3]) !== pid) return [];
    return [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), state: match[4], command: match[5] }];
  });
}
async function cleanupGroup(pid, closed) {
  const signals = [];
  function signal(name) {
    try { process.kill(-pid, name); signals.push(name); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  signal('SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (!groupProcesses(pid).some(row => !row.state.startsWith('Z'))) break;
    await delay(50);
  }
  if (groupProcesses(pid).some(row => !row.state.startsWith('Z'))) signal('SIGKILL');
  await Promise.race([closed, delay(3000, undefined, { ref: false }).then(() => { throw new Error(`owned child did not close after cleanup: actual pid=${pid}; required=reaped child within 3000ms`); })]);
  const remaining = groupProcesses(pid);
  const liveRemaining = remaining.filter(row => !row.state.startsWith('Z'));
  if (liveRemaining.length) throw new Error(`owned process group still alive: actual=${JSON.stringify(liveRemaining)}; required=none; group=${pid}`);
  return { signals, liveRemaining, zombies: remaining.filter(row => row.state.startsWith('Z')), parentClosed: true };
}
function findNativeWindows(title) {
  const pattern = `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const result = spawnSync('xdotool', ['search', '--onlyvisible', '--name', pattern], { encoding: 'utf8', timeout: 5000 });
  if (result.status === 1 && !result.error) return [];
  if (result.error || result.status !== 0) throw new Error(`X11 window search failed: title=${title}; exit=${result.status}; ${result.error?.message ?? ''}; stderr=${result.stderr}`);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(id => ({ id,
    pid: Number(command('xdotool', ['getwindowpid', id], { timeout: 5000 })),
    title: command('xdotool', ['getwindowname', id], { timeout: 5000 }),
  }));
}
function childEnvironment(env) {
  const copy = { ...env };
  // A FUSE observation must never inherit the runtime's extraction fallback.
  delete copy.APPIMAGE_EXTRACT_AND_RUN;
  delete copy.NO_CLEANUP;
  delete copy.FORCE_COLOR;
  delete copy.NO_COLOR;
  return copy;
}

// The observation can run on Unix without an X server when window probes are
// supplied by focused tests. The CLI below always requires real Linux/X11.
export async function observeOwnedProcess({ program, args = [], cwd, env = process.env, evidenceDir,
  startupMs = 20_000, observeMs = 10_000, pollMs = 100,
  findWindows = () => findNativeWindows('Bee · 开发验证'),
  screenshot = (window, path) => command('import', ['-window', window.id, path], { timeout: 10_000 }),
  captureDesktop = path => command('import', ['-window', 'root', path], { timeout: 10_000 }),
  resizeWindow = (window, width, height) => command('xdotool', ['windowsize', '--sync', window.id, String(width), String(height)], { timeout: 5000 }),
  inspectWindow = window => ({
    geometry: command('xdotool', ['getwindowgeometry', '--shell', window.id], { timeout: 5000 }),
    tree: command('xwininfo', ['-id', window.id, '-tree'], { timeout: 5000 }),
  }),
}) {
  mkdirSync(evidenceDir, { recursive: true });
  const stdout = join(evidenceDir, 'stdout.log');
  const stderr = join(evidenceDir, 'stderr.log');
  const out = openSync(stdout, 'wx');
  const err = openSync(stderr, 'wx');
  const report = { ok: false, program, args, scope: 'native client window size and startup only; no readiness, content visibility or desktop decoration assertion', processes: [], samples: [] };
  let child, closed, failure;
  try {
    child = spawn(program, args, { cwd, env: childEnvironment(env), detached: true, stdio: ['ignore', out, err] });
    closed = new Promise(resolveClose => child.once('close', (code, signal) => { report.exit = { code, signal }; resolveClose(); }));
    await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
    report.pid = child.pid;
    if (!Number.isInteger(child.pid) || child.pid <= 1 || child.pid === process.pid) throw new Error(`unsafe owned process group: actual=${child.pid}; required=dedicated spawned child PID >1`);
    const started = Date.now();
    let visibleSince, window;
    async function requireOwnedWindow(phase) {
      // Blocking X11 commands can outlast a child exit or window reassignment.
      await delay(0);
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`native app early exit: code=${child.exitCode}; signal=${child.signalCode}; stderr=${readFileSync(stderr, 'utf8').slice(-4096)}`);
      report.processes = groupProcesses(child.pid);
      report.lastWindows = await findWindows(child.pid);
      if (!report.lastWindows.some(candidate => candidate.id === window.id && report.processes.some(row => row.pid === candidate.pid && !row.state.startsWith('Z')))) {
        throw new Error(`observed window disappeared ${phase}: actual=${JSON.stringify({ windows: report.lastWindows, processes: report.processes, exitCode: child.exitCode, signalCode: child.signalCode })}; required=live owned window ${JSON.stringify(window)}`);
      }
    }
    function requireMinimumSize(entry, phase) {
      const actual = {};
      for (const [field, name] of [['WIDTH', 'width'], ['HEIGHT', 'height']]) {
        const lines = typeof entry.geometry === 'string' ? entry.geometry.split(/\r?\n/).filter(line => line.startsWith(field)) : [];
        let reason;
        if (lines.length === 0) reason = 'missing field';
        else if (lines.length > 1) reason = 'duplicate field';
        else if (!new RegExp(`^${field}=\\d+$`).test(lines[0])) reason = 'invalid integer line';
        else if (!Number.isSafeInteger(Number(lines[0].slice(field.length + 1)))) reason = 'unsafe integer';
        if (reason) {
          throw new Error(`invalid client geometry ${phase}: reason=${reason}; actual=${JSON.stringify(entry.geometry)}; field=${field}; matchingLines=${JSON.stringify(lines)}; required=one independent ${field}=<safe integer> line; client size=860x600`);
        }
        actual[name] = Number(lines[0].slice(field.length + 1));
      }
      entry.actual = actual;
      entry.checkedAt = new Date().toISOString();
      if (actual.width !== 860 || actual.height !== 600) throw new Error(`client size mismatch ${phase}: actual=${JSON.stringify(actual)}; geometry=${JSON.stringify(entry.geometry)}; required=860x600 client window ${window.id}`);
    }
    async function capturePng(path, capture) {
      const timing = { path, startedAt: new Date().toISOString() };
      await capture(path);
      const image = readFileSync(path);
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`native screenshot invalid: actual path=${path}; bytes=${image.length}; required=PNG signature`);
      timing.completedAt = new Date().toISOString();
      return timing;
    }
    async function sample(phase) {
      const entry = { phase, startedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
        window, windows: report.lastWindows, processes: groupProcesses(child.pid) };
      report.samples.push(entry);
      Object.assign(entry, await inspectWindow(window));
      if (phase === 'final') requireMinimumSize(entry, 'before final capture');
      entry.windowCapture = await capturePng(join(evidenceDir, phase === 'initial' ? 'window.initial.png' : 'window.png'), path => screenshot(window, path));
      if (phase === 'final') entry.desktopCapture = await capturePng(join(evidenceDir, 'root.png'), captureDesktop);
      entry.completedAt = new Date().toISOString();
    }
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`native app early exit: code=${child.exitCode}; signal=${child.signalCode}; stderr=${readFileSync(stderr, 'utf8').slice(-4096)}`);
      const processes = groupProcesses(child.pid);
      report.processes = processes;
      const windows = await findWindows(child.pid);
      report.lastWindows = windows;
      const owned = windows.filter(candidate => processes.some(row => row.pid === candidate.pid && !row.state.startsWith('Z')));
      if (!window && owned.length) {
        window = owned[0];
        report.window = window;
        await sample('initial');
        await requireOwnedWindow('before resize');
        report.resize = { window, requested: { width: 860, height: 600 }, startedAt: new Date().toISOString(), timeoutMs: 5000 };
        try { await resizeWindow(window, 860, 600); }
        catch (error) {
          throw new Error(`client resize failed: actual=${error.stack ?? String(error)}; window=${JSON.stringify(window)}; required=860x600 client window within 5000ms`, { cause: error });
        }
        Object.assign(report.resize, await inspectWindow(window));
        requireMinimumSize(report.resize, 'after resize');
        await requireOwnedWindow('after resize');
        report.resize.completedAt = new Date().toISOString();
        visibleSince = Date.now();
        report.observationStartedAt = new Date(visibleSince).toISOString();
      } else if (window && !owned.some(candidate => candidate.id === window.id)) {
        throw new Error(`observed window disappeared: actual=${JSON.stringify(windows)}; required window=${JSON.stringify(window)}`);
      }
      if (window && Date.now() - visibleSince >= observeMs) {
        await sample('final');
        // Drain exit events and recheck ownership after blocking X11 captures.
        await delay(0);
        if (child.exitCode !== null || child.signalCode !== null) continue;
        await requireOwnedWindow('after final capture');
        report.finalGeometry = { window, ...(await inspectWindow(window)) };
        requireMinimumSize(report.finalGeometry, 'after final capture');
        report.observedMs = Date.now() - visibleSince;
        report.ok = true;
        break;
      }
      if (!window && Date.now() - started >= startupMs) throw new Error(`no owned visible window: actual=${JSON.stringify(windows)}; required=window belonging to live process group ${child.pid} within ${startupMs}ms`);
      await delay(pollMs);
    }
  } catch (error) {
    failure = error;
    report.ok = false;
    report.error = error.stack ?? String(error);
  } finally {
    closeSync(out);
    closeSync(err);
    if (child?.pid) {
      try { report.cleanup = await cleanupGroup(child.pid, closed); }
      catch (error) {
        report.ok = false;
        report.cleanupError = error.stack ?? String(error);
        failure = failure ? new AggregateError([failure, error], `${failure.message}; cleanup failed: ${error.message}`) : error;
      }
    }
    save(join(evidenceDir, 'observation.json'), report);
  }
  if (failure) throw failure;
  return report;
}

async function smoke() {
  const args = process.argv.slice(2);
  const options = {};
  if (args.length !== 8) throw new Error(`invalid AppImage smoke arguments: actual=${JSON.stringify(args)}; required=--appimage <file> --source <json> --mode <extract|fuse> --evidence <directory>`);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--appimage', '--source', '--mode', '--evidence'].includes(args[i]) || options[args[i]]) throw new Error(`invalid AppImage smoke option: actual=${args[i]}; required=each supported option exactly once`);
    options[args[i]] = args[i + 1];
  }
  const evidenceDir = resolve(options['--evidence']);
  mkdirSync(evidenceDir, { recursive: true });
  const report = { ok: false, mode: options['--mode'], target: process.env.BEE_CI_TARGET, recordedAt: new Date().toISOString(),
    limitations: ['not clean-user installation', 'not tray or UI readiness acceptance', 'signal cleanup is not app menu exit acceptance'] };
  let temporary;
  try {
    equal('smoke host OS', process.platform, 'linux');
    if (process.getuid() === 0) throw new Error('AppImage smoke user mismatch: actual uid=0; required=ordinary non-root runner');
    for (const name of ['DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']) if (!process.env[name]) throw new Error(`native desktop session missing: actual ${name}=unset; required=Xvfb and independent D-Bus session`);
    if (!['extract', 'fuse'].includes(report.mode)) throw new Error(`invalid AppImage launch mode: actual=${report.mode}; required=extract or fuse`);
    const appimage = realpathSync(options['--appimage']);
    report.package = { path: appimage, bytes: statSync(appimage).size, sha256: digest(appimage) };
    const sourcePath = realpathSync(options['--source']);
    report.sourceSha256 = digest(sourcePath);
    const revision = command('git', ['rev-parse', 'HEAD'], { cwd: beeRoot });
    equal('CI checkout revision', process.env.GITHUB_SHA, revision);
    report.revision = revision;
    temporary = mkdtempSync(join(tmpdir(), 'bee-appimage-smoke-'));
    const extracted = spawnSync(appimage, ['--appimage-extract'], { cwd: temporary, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(join(evidenceDir, 'extract.stdout.log'), extracted.stdout ?? '');
    writeFileSync(join(evidenceDir, 'extract.stderr.log'), extracted.stderr ?? '');
    if (extracted.error || extracted.status !== 0) throw new Error(`AppImage extraction failed: exit=${extracted.status}; signal=${extracted.signal}; ${extracted.error?.message ?? ''}; stderr=${extracted.stderr}`);
    const packageRoot = join(temporary, 'squashfs-root');
    const binaryPath = join(packageRoot, 'usr/bin/bee');
    // Record actual bytes even when verification below rejects a changed binary.
    report.packagedBee = { path: binaryPath, sha256: digest(binaryPath) };
    report.provenance = verifyPackagedBee({ packageRoot, binaryPath, sourcePath, target: report.target,
      revision, teeRevision: readFileSync(join(beeRoot, 'TEE_REVISION'), 'utf8').trim() });
    if (report.mode === 'fuse' && !existsSync('/dev/fuse')) throw new Error('FUSE direct launch unavailable: actual /dev/fuse=missing; required=usable FUSE device; no extraction fallback for this mode');
    const program = report.mode === 'fuse' ? appimage : join(packageRoot, 'AppRun');
    const observation = await observeOwnedProcess({ program, cwd: temporary, evidenceDir: join(evidenceDir, 'startup') });
    report.observation = observation;
    equal('AppImage unchanged after smoke', digest(appimage), report.package.sha256);
    report.ok = true;
  } catch (error) {
    report.error = error.stack ?? String(error);
    throw error;
  } finally {
    save(join(evidenceDir, 'smoke.json'), report);
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try { await smoke(); }
  catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
