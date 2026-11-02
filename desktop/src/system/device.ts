import {throwBridgeError,safeOrigin,decodeBridgeError,normalizeFailure,type UiFailure} from './failures.ts';
export interface DeviceIdentity { id: string; name: string; owner_id: string; owner_email: string }
export interface DeviceView {
  state: 'unbound' | 'pending' | 'draining' | 'expired' | 'bound';
  hive?: string;
  name?: string;
  verification_url?: string;
  user_code?: string;
  expires_at?: string;
  poll_interval_seconds?: number;
  identity?: DeviceIdentity;
}
export interface DeviceContext {hive:string;name:string;device_id:string|null;owner_id:string|null;binding_revision:number}
export interface DeviceContextFailure {binding_revision:number;failure:UiFailure}
export interface DeviceClient {
 context?():Promise<DeviceContext|DeviceContextFailure>;
  status(): Promise<DeviceView>;
  begin(hive: string, name: string): Promise<DeviceView>;
  open(): Promise<DeviceView>;
}
export type DeviceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalid(check: string): never { throw new Error(`DEVICE_REPLY_INVALID: ${check}`); }
export function decodeDeviceReply(reply: unknown): DeviceView {
  if (!record(reply) || !record(reply.result)) return invalid('missing result object');
  const { result } = reply;
  if ('error' in result) {
    if(Object.keys(result).length!==1)return invalid('error result contains unexpected fields');
    throwBridgeError(result.error,'DEVICE_REPLY_INVALID');
  }
  const view = result.device;
  if (!record(view)) return invalid('missing device object');
  const fields = ['state','hive','name','verification_url','user_code','expires_at','poll_interval_seconds','identity'];
  if (Object.keys(view).some(key => !fields.includes(key))) return invalid('unexpected device field');
  if (!['unbound','pending','draining','expired','bound'].includes(String(view.state))) return invalid('unrecognized device state');
  for (const key of ['hive','name','verification_url','user_code','expires_at']) {
    if (key in view && typeof view[key] !== 'string') return invalid(`device ${key} must be a string`);
  }
  if (view.state !== 'unbound' && (!view.hive || !view.name)) return invalid('configured device requires Hive and name');
  if (view.state === 'bound') {
    const identity = view.identity;
    if (!record(identity) || Object.keys(identity).some(key=>!['id','name','owner_id','owner_email'].includes(key)) || !['id','name','owner_id','owner_email'].every(key=>typeof identity[key]==='string' && identity[key]!=='')) return invalid('bound device requires public identity');
  } else if (view.identity !== undefined) return invalid('unverified device cannot expose an identity');
  if (view.state === 'pending' || view.state === 'draining') {
    if (!Number.isInteger(view.poll_interval_seconds) || Number(view.poll_interval_seconds)<1 || Number(view.poll_interval_seconds)>60 || typeof view.expires_at !== 'string' || !Number.isFinite(Date.parse(view.expires_at))) return invalid('pairing requires expiry and bounded poll interval');
    if (typeof view.user_code !== 'string' || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(view.user_code)) return invalid('pairing code format rejected');
    let url: URL, hive: URL;
    try { url = new URL(String(view.verification_url)); hive = new URL(String(view.hive)); } catch { return invalid('pairing URL is invalid'); }
    if (url.origin !== hive.origin || url.username || url.password || url.hash || url.pathname !== '/devices/pair' || url.searchParams.size!==1 || url.searchParams.get('code')!==view.user_code || !['https:','http:'].includes(url.protocol)) return invalid('pairing URL must match configured Hive and code');
  }
  return view as unknown as DeviceView;
}
export function decodeDeviceContext(reply:unknown):DeviceContext {
 if(!record(reply)||!record(reply.result))return invalid('context requires result');
 if('error'in reply.result){if(Object.keys(reply.result).length!==1)return invalid('context failure fields rejected');throwBridgeError(reply.result.error,'DEVICE_CONTEXT_INVALID');}
 if(Object.keys(reply.result).length!==1||!record(reply.result.context))return invalid('context result requires only context');
 const c=reply.result.context;
 if(Object.keys(c).length!==5||!['hive','name','device_id','owner_id','binding_revision'].every(k=>Object.hasOwn(c,k)))return invalid('context fields missing or unknown');
 if(typeof c.hive!=='string'||typeof c.name!=='string'||!c.name.trim()||[...c.name].length>80||/[\p{Cc}]/u.test(c.name)||!Number.isSafeInteger(c.binding_revision)||Number(c.binding_revision)<=0)return invalid('context metadata or revision rejected');
 if(!safeOrigin(c.hive))return invalid('context requires canonical secure origin');
 const id=(v:unknown)=>v===null||typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
 if(!id(c.device_id)||!id(c.owner_id)||(c.device_id===null)!==(c.owner_id===null))return invalid('context requires paired public identifiers');
 return structuredClone(c) as unknown as DeviceContext;
}
export function createDeviceClient(invoke: DeviceInvoke): DeviceClient {
  return {
    async context() {
     const reply=await invoke('device_context');
     if(record(reply)&&record(reply.result)&&'error'in reply.result&&'binding_revision'in reply.result){
       const r=reply.result;
       if(Object.keys(r).length!==2||!Number.isSafeInteger(r.binding_revision)||Number(r.binding_revision)<=0)return invalid('context failure requires only error and positive safe binding revision');
       const error=decodeBridgeError(r.error,'DEVICE_CONTEXT_INVALID');
       if(!['DEVICE_CONTEXT_UNCONFIGURED','DEVICE_CONTEXT_INVALID'].includes(error.code))return invalid('context revision requires local binding observation failure');
       return {binding_revision:Number(r.binding_revision),failure:normalizeFailure(error,'device_context')};
     }
     return decodeDeviceContext(reply);
   },
    async status() { return decodeDeviceReply(await invoke('device_status')); },
    async begin(hive, name) { return decodeDeviceReply(await invoke('device_begin', {hive, name})); },
    async open() { return decodeDeviceReply(await invoke('device_open')); },
  };
}
