import {throwBridgeError} from './failures.ts';
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
export interface DeviceClient {
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
export function createDeviceClient(invoke: DeviceInvoke): DeviceClient {
  return {
    async status() { return decodeDeviceReply(await invoke('device_status')); },
    async begin(hive, name) { return decodeDeviceReply(await invoke('device_begin', {hive, name})); },
    async open() { return decodeDeviceReply(await invoke('device_open')); },
  };
}
