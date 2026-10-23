import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { onLoginReturn } from '../src/system/lifecycle.ts';

const globals = globalThis as typeof globalThis & { isTauri?: boolean };
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
afterEach(() => { clearMocks(); delete globals.isTauri; });

test('冷启动回跳仅恢复 boolean 提示；订阅先于快照以免丢失回跳', async () => {
  globals.isTauri = true;
  const calls: string[] = [];
  mockIPC(command => {
    calls.push(command);
    if (command === 'plugin:event|listen') return 1;
    if (command === 'login_return_received') return true;
    if (command === 'plugin:event|unlisten') return;
    throw new Error(`unexpected lifecycle command=${command}`);
  });
  let received = 0;
  const stop = await onLoginReturn(() => { received++; });
  assert.equal(received, 1);
  assert.deepEqual(calls, ['plugin:event|listen', 'login_return_received']);
  stop(); stop();
});

test('后台回跳仅接受 true 收据，卸载后不再更新页面', async () => {
  globals.isTauri = true;
  const subscriptions = new Map<number, string>();
  mockIPC((command, args) => {
    const event = args as { handler: number; eventId: number; event: string; payload: unknown };
    if (command === 'plugin:event|listen') { subscriptions.set(event.handler, event.event); return event.handler; }
    if (command === 'plugin:event|unlisten') { subscriptions.delete(event.eventId); return; }
    if (command === 'login_return_received') return false;
    if (command === 'plugin:event|emit') {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, value: unknown): void } };
      for (const [id, name] of subscriptions) if (name === event.event) runtime.__TAURI_INTERNALS__.runCallback(id, { event: event.event, payload: event.payload });
      return;
    }
    throw new Error(`unexpected lifecycle command=${command}`);
  });
  let received = 0;
  const stop = await onLoginReturn(() => { received++; });
  await emit('bee://login-return', { code: 'never-display', state: 'never-store' });
  assert.equal(received, 0);
  await emit('bee://login-return', true);
  assert.equal(received, 1);
  stop(); stop();
  await new Promise(resolve => setImmediate(resolve));
  await emit('bee://login-return', true);
  assert.equal(received, 1);
});

test('普通浏览器不伪造回跳提示', async () => {
  let received = false;
  (await onLoginReturn(() => { received = true; }))();
  assert.equal(received, false);
});
