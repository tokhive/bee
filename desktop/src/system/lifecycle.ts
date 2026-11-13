import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Unlisten } from './bridge';

// The native side exposes a receipt only, never the callback URL or its fields.
export async function onLoginReturn(listener: () => void): Promise<Unlisten> {
  if (!isTauri()) return () => {};
  let active = true;
  const unlisten = await listen<unknown>('bee://login-return', event => {
    if (active && event.payload === true) listener();
  });
  const stop = () => {
    if (!active) return;
    active = false;
    void Promise.resolve(unlisten()).catch((cause: unknown) => console.error('注销 Bee 登录返回提示订阅失败：', cause));
  };
  try {
    if (await invoke<unknown>('login_return_received') === true && active) listener();
  } catch (cause) {
    stop();
    throw cause;
  }
  return stop;
}
