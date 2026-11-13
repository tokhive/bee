import {normalizeFailure,decodeBridgeError,validFailureTime,requestMethods,retryEvidence,type UiFailure,type FailureDetails} from './failures.ts';
import {normalizeHiveOrigin} from './hiveOrigin.ts';
export interface BridgeError { code: string; message: string; details?:FailureDetails }
export interface BridgeStatus {
  profile_id?:string|null;
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  metadata?: { bee_version: string; os: string; arch: string; instance: string; capabilities?: string[] };
  error?: BridgeError;
}
export interface BridgeReply { protocol: 1; id: string; instance: string; result: { alive: true } }
export interface DownloadResult { url: string; success: boolean }
export type Unlisten = () => void;
export type NotificationPage = 'overview'|'accounts'|'diagnostics'|'settings';
export interface NotificationSource {profile_id:string;origin:string}
export interface NotificationActivation {target:{page:NotificationPage;source:NotificationSource|null};current_profile:string|null;can_navigate:boolean}
export type NotificationNavigation=NotificationPage|NotificationActivation;
export function decodeNotificationNavigation(value:unknown):NotificationNavigation|null {
 const pages=['overview','accounts','diagnostics','settings'];
 if(typeof value==='string')return pages.includes(value)?value as NotificationPage:null;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>,target=v.target as Record<string,unknown>|null;
 const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
 if(Object.keys(v).length!==3||!Object.hasOwn(v,'current_profile')||v.current_profile!==null&&!id(v.current_profile)||typeof v.can_navigate!=='boolean'||!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).length!==2||typeof target.page!=='string'||!pages.includes(target.page)||!Object.hasOwn(target,'source'))return null;
 if(target.source!==null){
  const source=target.source as Record<string,unknown>;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length!==2||!id(source.profile_id)||typeof source.origin!=='string'||source.origin.length>2048)return null;
  try{if(normalizeHiveOrigin(source.origin)!==source.origin)return null;}catch{return null;}
 }
 return structuredClone(v) as unknown as NotificationActivation;
}
export interface StartupProgress {stage:'connecting'|'checking_previous'|'checking_device'|'preparing_accounts'|'confirming_service';operation_id:string|null;completed:number|null;total:number|null}
export function decodeStartupProgress(value:unknown):StartupProgress {
 const invalid=():never=>{throw new Error('STARTUP_PROGRESS_INVALID: required=real bounded stage, operation and consistent account counts');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const p=value as Record<string,unknown>,fields=['stage','operation_id','completed','total'];
 if(Object.keys(p).length!==fields.length||!fields.every(k=>Object.hasOwn(p,k))||!['connecting','checking_previous','checking_device','preparing_accounts','confirming_service'].includes(String(p.stage))||p.operation_id!==null&&(typeof p.operation_id!=='string'||!/^[a-f0-9]{48}$/.test(p.operation_id))||(p.completed===null)!==(p.total===null)||p.total!==null&&(p.stage!=='preparing_accounts'||typeof p.total!=='number'||!Number.isSafeInteger(p.total)||p.total<1||p.total>2||typeof p.completed!=='number'||!Number.isSafeInteger(p.completed)||p.completed<0||p.completed>p.total))return invalid();
 return structuredClone(p) as unknown as StartupProgress;
}
export interface StartupStatus {progress?:StartupProgress;can_retry?:boolean;recovering?:boolean;state:'checking'|'ready'|'blocked';failure:UiFailure|null;instance:string|null;binding_revision:number|null;network_revision:number|null;observed_at:string|null;revision:number}
export function decodeStartupStatus(value:unknown):StartupStatus {
 const invalid=():never=>{throw new Error('STARTUP_STATUS_INVALID: required=bounded status, raw failure and current context');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>,fields=['state','failure','instance','binding_revision','network_revision','observed_at','revision',...(Object.hasOwn(value,'progress')?['progress']:[]),...(Object.hasOwn(value,'can_retry')?['can_retry']:[]),...(Object.hasOwn(value,'recovering')?['recovering']:[])];
 if(Object.keys(v).length!==fields.length||!fields.every(k=>Object.hasOwn(v,k))||!['checking','ready','blocked'].includes(String(v.state)))return invalid();
 const revision=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 if(!revision(v.revision)||v.instance!==null&&(typeof v.instance!=='string'||!/^[a-f0-9]{32}$/.test(v.instance))||['binding_revision','network_revision'].some(k=>v[k]!==null&&!revision(v[k]))||v.observed_at!==null&&!validFailureTime(v.observed_at)||(v.state==='blocked')!==(v.failure!==null))return invalid();
 if(Object.hasOwn(v,'progress'))decodeStartupProgress(v.progress);
 if(Object.hasOwn(v,'can_retry')&&typeof v.can_retry!=='boolean'||v.can_retry===true&&v.state!=='blocked')return invalid();
 if(Object.hasOwn(v,'recovering')&&typeof v.recovering!=='boolean')return invalid();
 const failure=v.failure===null?null:normalizeFailure(decodeBridgeError(v.failure,'STARTUP_STATUS_INVALID'),'startup_check');
 return {...v,failure} as unknown as StartupStatus;
}
export interface PendingRequest {id:string;method:string;platform:'openai'|'claude'|null}
export interface RequestSettled extends PendingRequest {instance:string;profile_id?:string|null}
export interface PendingRequests {instance:string|null;requests:PendingRequest[]}
function decodePendingRequest(value:unknown,settled=false):PendingRequest|RequestSettled {
 const invalid=():never=>{throw new Error('BRIDGE_PENDING_INVALID: request requires exact bounded id, method, platform and current instance');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>,fields=settled?['instance','id','method','platform',...(Object.hasOwn(v,'profile_id')?['profile_id']:[])]:['id','method','platform'];
 if(Object.keys(v).length!==fields.length||!fields.every(k=>Object.hasOwn(v,k))||typeof v.id!=='string'||retryEvidence('request_id',v.id)!==true||typeof v.method!=='string'||!requestMethods.includes(v.method)||![null,'openai','claude'].includes(v.platform as null)||settled&&(typeof v.instance!=='string'||!/^[a-f0-9]{32}$/.test(v.instance)))return invalid();
 return structuredClone(v) as unknown as PendingRequest|RequestSettled;
}
export const decodeRequestSettled=(value:unknown):RequestSettled=>decodePendingRequest(value,true) as RequestSettled;
export function decodePendingRequests(value:unknown):PendingRequests {
 const invalid=():never=>{throw new Error('BRIDGE_PENDING_INVALID: pending read requires instance and at most 16 unique requests');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==2||!Object.hasOwn(v,'instance')||!Object.hasOwn(v,'requests')||v.instance!==null&&(typeof v.instance!=='string'||!/^[a-f0-9]{32}$/.test(v.instance))||!Array.isArray(v.requests)||v.requests.length>16||v.instance===null&&v.requests.length)return invalid();
 const requests=v.requests.map(r=>decodePendingRequest(r));if(new Set(requests.map(r=>r.id)).size!==requests.length)return invalid();
 return {instance:v.instance as string|null,requests};
}
export interface SystemBridge {
 pendingRequests?():Promise<PendingRequests>;
 onRequestSettled?(listener:(event:RequestSettled)=>void):Promise<Unlisten>;
 syncNativeLocale?(locale:'zh'|'en',revision:number):Promise<void>;
 startupStatus?():Promise<StartupStatus>;
 startupRecheck?():Promise<StartupStatus>;
 startupQuery?():Promise<StartupStatus>;
 startupRetry?():Promise<StartupStatus>;
 onStartup?(listener:(status:StartupStatus)=>void):Promise<Unlisten>;
  status(): Promise<BridgeStatus>;
  ping(): Promise<BridgeReply>;
  onStatus(listener: (status: BridgeStatus) => void): Promise<Unlisten>;
  onDownload(listener: (result: DownloadResult) => void): Promise<Unlisten>;
  onNotification?(listener: (navigation:NotificationNavigation) => void):Promise<Unlisten>;
}

let nativeLocaleSequence=0;
export function createSystemBridge(): SystemBridge {
  let localeQueue:Promise<unknown>=Promise.resolve();
  const unavailable: BridgeError = { code: 'NATIVE_UNAVAILABLE', message: '当前页面没有 Tauri 原生运行环境，无法检查内置 Bee。' };
  if (!isTauri()) return {
    async status() { return { state: 'failed', error: unavailable }; },
    async ping() { throw unavailable; },
    async onStatus(listener) { listener({ state: 'failed', error: unavailable }); return () => {}; },
    async onDownload() { throw unavailable; },
    async onNotification() { return () => {}; },
  };
  return {
    syncNativeLocale(locale,revision) {
      if(!['zh','en'].includes(locale)||!Number.isSafeInteger(revision)||revision<0||nativeLocaleSequence>=Number.MAX_SAFE_INTEGER)return Promise.reject({code:'NATIVE_LOCALE_INPUT',message:'native language metadata requires zh/en, saved safe revision and available sequence'});
      const sequence=++nativeLocaleSequence;
      const result=localeQueue.then(async()=>{const receipt=await invoke<unknown>('native_locale_sync',{request:{locale,revision,sequence}});if(receipt!==null)throw {code:'NATIVE_LOCALE_REPLY_INVALID',message:'native language sync receipt rejected; required=void receipt from native metadata command'};});
      localeQueue=result.catch(()=>{});
      return result;
    },
    status: () => invoke<BridgeStatus>('bridge_status'),
 pendingRequests:async()=>decodePendingRequests(await invoke('bridge_pending_requests')),
 async onRequestSettled(listener){let active=true;const off=await listen<unknown>('bee://request-settled',event=>{if(active)listener(decodeRequestSettled(event.payload));});return()=>{active=false;off();};},
 startupStatus: async()=>decodeStartupStatus(await invoke('startup_status')),
 startupRecheck: async()=>decodeStartupStatus(await invoke('startup_recheck')),
 startupQuery: async()=>decodeStartupStatus(await invoke('startup_query')),
 startupRetry: async()=>decodeStartupStatus(await invoke('startup_retry')),
 async onStartup(listener){let active=true;const off=await listen<unknown>('bee://startup-status',event=>{if(active)listener(decodeStartupStatus(event.payload));});return()=>{active=false;off();};},
    ping: () => invoke<BridgeReply>('bridge_request', { method: 'ping' }),
    async onNotification(listener) {
      let active=true;
      const off=await listen<unknown>('bee://notification-navigation',event=>{
        const navigation=decodeNotificationNavigation(event.payload);
        if(active&&navigation!==null)listener(navigation);
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
