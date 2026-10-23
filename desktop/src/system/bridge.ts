export interface BridgeError { code: string; message: string }
export interface BridgeStatus {
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  metadata?: { bee_version: string; os: string; arch: string; instance: string };
  error?: BridgeError;
}
export interface BridgeReply { protocol: 1; id: string; instance: string; result: { alive: true } }
export type Unlisten = () => void;
export interface SystemBridge {
  status(): Promise<BridgeStatus>;
  ping(): Promise<BridgeReply>;
  onStatus(listener: (status: BridgeStatus) => void): Promise<Unlisten>;
}

export function createSystemBridge(): SystemBridge {
  const unavailable: BridgeError = { code: 'NATIVE_UNAVAILABLE', message: '当前页面没有 Tauri 原生运行环境，无法检查内置 Bee。' };
  if (!isTauri()) return {
    async status() { return { state: 'failed', error: unavailable }; },
    async ping() { throw unavailable; },
    async onStatus(listener) { listener({ state: 'failed', error: unavailable }); return () => {}; },
  };
  return {
    status: () => invoke<BridgeStatus>('bridge_status'),
    ping: () => invoke<BridgeReply>('bridge_request', { method: 'ping' }),
    async onStatus(listener) {
      let active = true;
      const unlisten = await listen<BridgeStatus>('bee://bridge-status', event => { if (active) listener(event.payload); });
      return () => {
        if (active) {
          active = false;
          void Promise.resolve(unlisten()).catch((cause: unknown) => console.error('注销 Bee 管理状态订阅失败：', cause));
        }
      };
    },
  };
}
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
