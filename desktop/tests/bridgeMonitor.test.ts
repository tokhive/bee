import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BridgeReply, BridgeStatus, SystemBridge } from '../src/system/bridge.ts';
import { createBridgeMonitor, type BridgeView } from '../src/system/bridgeMonitor.ts';

const ready: BridgeStatus = { state: 'ready', metadata: { bee_version: 'fixture', os: 'darwin', arch: 'arm64', instance: 'owned' } };
const failed: BridgeStatus = { state: 'failed', error: { code: 'CHILD_EXITED', message: 'owned Bee exited: status=9' } };
const reply: BridgeReply = { protocol: 1, id: 'shell-2', instance: 'owned', result: { alive: true } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const views: BridgeView[] = [];
  let listener: (status: BridgeStatus) => void = () => {};
  let removed = 0;
  const bridge: SystemBridge = {
    async status() { return ready; },
    async ping() { return reply; },
    async onStatus(callback) { listener = callback; return () => { removed++; }; },
    async onDownload() { throw new Error('download is outside bridge monitor fixture'); },
  };
  const monitor = createBridgeMonitor(bridge, view => views.push(view));
  return { bridge, monitor, views, event: (status: BridgeStatus) => listener(status), removed: () => removed };
}

test('故障事件先到时，较早 ping 的成功不能重新显示存活', async () => {
  const f = fixture();
  const ping = deferred<BridgeReply>();
  f.bridge.ping = () => ping.promise;
  await f.monitor.start();
  assert.equal(f.views.at(-1)?.status.state, 'ready');
  const checking = f.monitor.check();
  await Promise.resolve();
  f.event(failed);
  ping.resolve(reply);
  await checking;
  assert.equal(f.views.at(-1)?.status.state, 'failed');
  assert.equal(f.views.at(-1)?.alive, false);
  assert.equal(f.views.at(-1)?.checking, false);
  f.monitor.dispose();
});

test('较早状态查询不能覆盖订阅的新故障，销毁后不会再更新', async () => {
  const f = fixture();
  const old = deferred<BridgeStatus>();
  f.bridge.status = () => old.promise;
  const starting = f.monitor.start();
  await Promise.resolve();
  f.event(failed);
  old.resolve(ready);
  await starting;
  assert.equal(f.views.at(-1)?.status.state, 'failed');
  f.monitor.dispose(); f.monitor.dispose();
  assert.equal(f.removed(), 1);
  const before = f.views.length;
  f.event(ready);
  await f.monitor.check();
  assert.equal(f.views.length, before);
});

test('页面提前销毁时，延迟注册的监听仍会清理', async () => {
  const f = fixture();
  const subscription = deferred<() => void>();
  let removed = 0;
  f.bridge.onStatus = () => subscription.promise;
  const starting = f.monitor.start();
  f.monitor.dispose();
  subscription.resolve(() => { removed++; });
  await starting;
  assert.equal(removed, 1);
});

test('存活检查成功与具体调用错误均可见', async () => {
  const f = fixture();
  await f.monitor.start();
  await f.monitor.check();
  assert.equal(f.views.at(-1)?.alive, true);
  const error = { code: 'PIPE_WRITE_FAILED', message: 'request bytes=63: broken pipe' };
  f.bridge.ping = async () => { throw error; };
  await f.monitor.check();
  assert.deepEqual(f.views.at(-1)?.failure, error);
  assert.equal(f.views.at(-1)?.alive, false);
  f.monitor.dispose();
});
