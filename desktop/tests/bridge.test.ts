import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { createSystemBridge, type BridgeStatus } from '../src/system/bridge.ts';

const globals = globalThis as typeof globalThis & { isTauri?: boolean };
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
afterEach(() => { clearMocks(); delete globals.isTauri; });

test('浏览器没有原生桥时明确失败，不能模拟握手成功', async () => {
  const bridge = createSystemBridge();
  const status = await bridge.status();
  assert.equal(status.state, 'failed');
  assert.equal(status.error?.code, 'NATIVE_UNAVAILABLE');
  await assert.rejects(bridge.ping(), { code: 'NATIVE_UNAVAILABLE' });
  const states: BridgeStatus[] = [];
  const unlisten = await bridge.onStatus(status => states.push(status));
  assert.equal(states[0].state, 'failed');
  unlisten();
});

test('原生桥仅调用状态和 ping，订阅可重复清理', async () => {
  globals.isTauri = true;
  const state: BridgeStatus = { state: 'ready', metadata: { bee_version: 'fixture', os: 'darwin', arch: 'arm64', instance: 'owned' } };
  const calls: unknown[] = [];
  const subscriptions = new Set<number>();
  mockIPC((command, args) => {
    const event = args as { handler: number; eventId: number; event: string; payload: unknown };
    if (command === 'plugin:event|listen') { subscriptions.add(event.handler); return event.handler; }
    if (command === 'plugin:event|unlisten') { subscriptions.delete(event.eventId); return; }
    if (command === 'plugin:event|emit') {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, value: unknown): void } };
      for (const id of subscriptions) runtime.__TAURI_INTERNALS__.runCallback(id, { event: event.event, payload: event.payload });
      return;
    }
    calls.push([command, args]);
    if (command === 'bridge_status') return state;
    if (command === 'bridge_request') return { protocol: 1, id: 'shell-2', instance: 'owned', result: { alive: true } };
    throw new Error(`unexpected test IPC command=${command}`);
  });
  const bridge = createSystemBridge();
  assert.deepEqual(await bridge.status(), state);
  assert.equal((await bridge.ping()).result.alive, true);
  assert.deepEqual(calls, [['bridge_status', {}], ['bridge_request', { method: 'ping' }]]);
  const states: BridgeStatus[] = [];
  const unlisten = await bridge.onStatus(status => states.push(status));
  await emit('bee://bridge-status', { state: 'failed', error: { code: 'CHILD_EXITED', message: 'owned child exit=9' } });
  assert.equal(states.at(-1)?.state, 'failed');
  unlisten(); unlisten();
  // Tauri's Unlisten type returns void; its IPC removal completes asynchronously.
  await new Promise(resolve => setImmediate(resolve));
  const before = states.length;
  await emit('bee://bridge-status', state);
  assert.equal(states.length, before);
});

test('原生错误保留本次错误码和诊断证据', async () => {
  globals.isTauri = true;
  const error = { code: 'PIPE_WRITE_FAILED', message: 'write owned Bee ping request bytes=63: broken pipe' };
  mockIPC(() => { throw error; });
  await assert.rejects(createSystemBridge().ping(), error);
  await assert.rejects(createSystemBridge().status(), error);
});
