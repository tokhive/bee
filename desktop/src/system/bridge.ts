import {normalizeFailure,decodeBridgeError,validFailureTime,type UiFailure,type FailureDetails} from './failures.ts';
export interface BridgeError { code: string; message: string; details?:FailureDetails }
export interface BridgeStatus {
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  metadata?: { bee_version: string; os: string; arch: string; instance: string };
  error?: BridgeError;
}
export interface BridgeReply { protocol: 1; id: string; instance: string; result: { alive: true } }
export interface DownloadResult { url: string; success: boolean }
export type Unlisten = () => void;
export type NotificationPage = 'overview'|'accounts'|'diagnostics'|'settings';
export interface StartupStatus {state:'checking'|'ready'|'blocked';failure:UiFailure|null;instance:string|null;binding_revision:number|null;network_revision:number|null;observed_at:string|null;revision:number}
export function decodeStartupStatus(value:unknown):StartupStatus {
 const invalid=():never=>{throw new Error('STARTUP_STATUS_INVALID: required=bounded status, raw failure and current context');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>,fields=['state','failure','instance','binding_revision','network_revision','observed_at','revision'];
 if(Object.keys(v).length!==fields.length||!fields.every(k=>Object.hasOwn(v,k))||!['checking','ready','blocked'].includes(String(v.state)))return invalid();
 const revision=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 if(!revision(v.revision)||v.instance!==null&&(typeof v.instance!=='string'||!/^[a-f0-9]{32}$/.test(v.instance))||['binding_revision','network_revision'].some(k=>v[k]!==null&&!revision(v[k]))||v.observed_at!==null&&!validFailureTime(v.observed_at)||(v.state==='blocked')!==(v.failure!==null))return invalid();
 const failure=v.failure===null?null:normalizeFailure(decodeBridgeError(v.failure,'STARTUP_STATUS_INVALID'),'startup_check');
 return {...v,failure} as unknown as StartupStatus;
}
export interface SystemBridge {
 startupStatus?():Promise<StartupStatus>;
 startupRecheck?():Promise<StartupStatus>;
 onStartup?(listener:(status:StartupStatus)=>void):Promise<Unlisten>;
  status(): Promise<BridgeStatus>;
  ping(): Promise<BridgeReply>;
  onStatus(listener: (status: BridgeStatus) => void): Promise<Unlisten>;
  onDownload(listener: (result: DownloadResult) => void): Promise<Unlisten>;
  onNotification?(listener: (page:NotificationPage) => void):Promise<Unlisten>;
}

export function createSystemBridge(): SystemBridge {
  const unavailable: BridgeError = { code: 'NATIVE_UNAVAILABLE', message: '当前页面没有 Tauri 原生运行环境，无法检查内置 Bee。' };
  if (!isTauri()) return {
    async status() { return { state: 'failed', error: unavailable }; },
    async ping() { throw unavailable; },
    async onStatus(listener) { listener({ state: 'failed', error: unavailable }); return () => {}; },
    async onDownload() { throw unavailable; },
    async onNotification() { return () => {}; },
  };
  return {
    status: () => invoke<BridgeStatus>('bridge_status'),
 startupStatus: async()=>decodeStartupStatus(await invoke('startup_status')),
 startupRecheck: async()=>decodeStartupStatus(await invoke('startup_recheck')),
 async onStartup(listener){let active=true;const off=await listen<unknown>('bee://startup-status',event=>{if(active)listener(decodeStartupStatus(event.payload));});return()=>{active=false;off();};},
    ping: () => invoke<BridgeReply>('bridge_request', { method: 'ping' }),
    async onNotification(listener) {
      let active=true;
      const off=await listen<unknown>('bee://notification-navigation',event=>{
        if(active&&typeof event.payload==='string'&&['overview','accounts','diagnostics','settings'].includes(event.payload))listener(event.payload as NotificationPage);
      });
      return()=>{if(active){active=false;off();}};
    },
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
