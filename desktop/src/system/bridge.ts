export interface BridgeError { code: string; message: string }
export interface BridgeStatus {
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  metadata?: { bee_version: string; os: string; arch: string; instance: string };
  error?: BridgeError;
}
export interface BridgeReply { protocol: 1; id: string; instance: string; result: { alive: true } }
export interface DownloadResult { url: string; success: boolean }
export type Unlisten = () => void;
export interface SystemBridge {
  status(): Promise<BridgeStatus>;
  ping(): Promise<BridgeReply>;
  onStatus(listener: (status: BridgeStatus) => void): Promise<Unlisten>;
  onDownload(listener: (result: DownloadResult) => void): Promise<Unlisten>;
}

export function createSystemBridge(): SystemBridge {
  const unavailable: BridgeError = { code: 'NATIVE_UNAVAILABLE', message: '当前页面没有 Tauri 原生运行环境，无法检查内置 Bee。' };
  if (!isTauri()) return {
    async status() { return { state: 'failed', error: unavailable }; },
    async ping() { throw unavailable; },
    async onStatus(listener) { listener({ state: 'failed', error: unavailable }); return () => {}; },
    async onDownload() { throw unavailable; },
  };
  return {
    status: () => invoke<BridgeStatus>('bridge_status'),
    ping: () => invoke<BridgeReply>('bridge_request', { method: 'ping' }),
    async onDownload(listener) {
      let active = true;
      const eventName = 'bee://download-finished';
      // Pinned API 2.12.4's listen() loses its callback ID on registration
      // rejection. Own that ID so a failed retry cannot retain its closure.
      const handler = transformCallback<Event<DownloadResult>>(event => {
        const result = event.payload;
        if (active && result && typeof result.url === 'string' && typeof result.success === 'boolean') listener(result);
      });
      let eventId: number;
      try {
        eventId = await invoke<number>('plugin:event|listen', { event: eventName, target: { kind: 'Any' }, handler });
      } catch (cause) {
        active = false;
        const runtime = window as unknown as { __TAURI_INTERNALS__: { unregisterCallback(id: number): void } };
        runtime.__TAURI_INTERNALS__.unregisterCallback(handler);
        throw cause;
      }
      return () => {
        if (active) {
          active = false;
          window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(eventName, eventId);
          void invoke('plugin:event|unlisten', { event: eventName, eventId }).catch((cause: unknown) => console.error('注销报告下载结果订阅失败：', cause));
        }
      };
    },
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
import { invoke, isTauri, transformCallback } from '@tauri-apps/api/core';
import { listen, type Event } from '@tauri-apps/api/event';
