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

test('native locale metadata is serialized in request order and a failed request does not stop recovery', async () => {
  const {createSystemBridge}=await import('../src/system/bridge.ts');
  globals.isTauri=true;const calls:any[]=[];let release!:()=>void;
  mockIPC(async(command,args)=>{assert.equal(command,'native_locale_sync');calls.push(args);if(calls.length===1){await new Promise<void>(resolve=>{release=resolve;});throw {code:'NATIVE_LOCALE_MENU_FAILED',message:'item=bee-open; actual=denied'};}return null;});
  const bridge=createSystemBridge();assert.equal(typeof bridge.syncNativeLocale,'function');
  const first=bridge.syncNativeLocale!('zh',4);const second=bridge.syncNativeLocale!('en',4);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);release();
  await assert.rejects(first,(cause:any)=>cause.code==='NATIVE_LOCALE_MENU_FAILED'&&cause.message.includes('bee-open'));
  await second;assert.deepEqual(calls.map(v=>v.request.locale),['zh','en']);assert.ok(calls[1].request.sequence>calls[0].request.sequence);
});

test('native locale success requires the exact void receipt',async()=>{
 const {createSystemBridge}=await import('../src/system/bridge.ts');globals.isTauri=true;mockIPC(()=>({accepted:true}));
 await assert.rejects(createSystemBridge().syncNativeLocale!('en',1),(cause:any)=>cause.code==='NATIVE_LOCALE_REPLY_INVALID');
});
