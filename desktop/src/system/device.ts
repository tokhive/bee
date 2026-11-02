import {throwBridgeError,safeOrigin,decodeBridgeError,normalizeFailure,type UiFailure} from './failures.ts';
export interface DeviceIdentity { id: string; name: string; owner_id: string; owner_email: string }
export interface DeviceView {
  state: 'unbound' | 'pending' | 'draining' | 'expired' | 'bound' | 'pairing';
 recovery?:DeviceRecoveryView;
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
export type DeviceRecoveryPhase='awaiting_confirmation'|'creating'|'creation_unknown'|'pending'|'draining'|'redeeming'|'redemption_unknown'|'awaiting_owner_confirmation'|'saving'|'completed'|'expired'|'blocked';
export interface DeviceRecoveryView {operation_id:string;revision:number;phase:DeviceRecoveryPhase;old_identity:DeviceIdentity|null;new_identity:DeviceIdentity|null;pairing:{code:string;verification_url:string;expires_at:string}|null;failure:{code:string;message:string;details?:{check:string;observed_at:string;evidence:Record<string,string>}}|null}
export interface DeviceClient {
 recoveryPrepare():Promise<DeviceRecoveryView>;
 recoveryConfirm(operation_id:string,expected_revision:number,decision:'begin_pairing'|'adopt_owner'|'renew_expired'):Promise<DeviceRecoveryView>;
 recoveryStatus():Promise<DeviceRecoveryView>;
 recoveryOpen():Promise<DeviceRecoveryView>;
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
  const fields = ['state','hive','name','verification_url','user_code','expires_at','poll_interval_seconds','identity','recovery'];
  if (Object.keys(view).some(key => !fields.includes(key))) return invalid('unexpected device field');
  if (!['unbound','pending','draining','expired','bound','pairing'].includes(String(view.state))) return invalid('unrecognized device state');
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
  if(view.recovery!==undefined){
   const r=decodeDeviceRecoveryReply({result:{recovery:view.recovery}});
   if(r.old_identity!==null)return invalid('initial pairing cannot contain an old binding');
   const expected=r.phase==='completed'?'bound':r.phase==='pending'?'pending':r.phase==='draining'?'draining':r.phase==='expired'?'expired':'pairing';
   if(view.state!==expected)return invalid('initial pairing state conflicts with transaction phase');
   if(view.state==='bound'&&['id','name','owner_id','owner_email'].some(k=>(view.identity as Record<string,unknown>)[k] !== (r.new_identity as unknown as Record<string,unknown>)?.[k]))return invalid('initial pairing identity differs from completed transaction');
   if((view.state==='pending'||view.state==='draining')&&(!r.pairing||r.pairing.code!==view.user_code||r.pairing.verification_url!==view.verification_url||r.pairing.expires_at!==view.expires_at))return invalid('initial pairing fields differ from transaction');
   if(r.pairing&&new URL(r.pairing.verification_url).origin!==new URL(String(view.hive)).origin)return invalid('initial pairing URL differs from saved Hive');
  } else if(view.state==='pairing')return invalid('pairing state requires recovery transaction');
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
    async recoveryPrepare(){return decodeDeviceRecoveryReply(await invoke('device_recovery_prepare'));},
    async recoveryConfirm(operation_id,expected_revision,decision){return decodeDeviceRecoveryReply(await invoke('device_recovery_confirm',{operation_id,expected_revision,decision}));},
    async recoveryStatus(){return decodeDeviceRecoveryReply(await invoke('device_recovery_status'));},
    async recoveryOpen(){return decodeDeviceRecoveryReply(await invoke('device_open'));},
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

export function decodeDeviceRecoveryReply(reply:unknown):DeviceRecoveryView {
 if(!record(reply)||!record(reply.result))return invalid('recovery result missing');
 const result=reply.result;
 if('error'in result){if(Object.keys(result).length!==1)return invalid('recovery error fields rejected');throwBridgeError(result.error,'DEVICE_RECOVERY_INVALID');}
 if(Object.keys(result).length!==1||!record(result.recovery))return invalid('recovery envelope rejected');
 const r=result.recovery;
 const fields=['operation_id','revision','phase','old_identity','new_identity','pairing','failure'];
 if(Object.keys(r).length!==fields.length||!fields.every(k=>Object.hasOwn(r,k)))return invalid('recovery fields rejected');
 if(typeof r.operation_id!=='string'||!/^[a-f0-9]{48}$/.test(r.operation_id)||!Number.isSafeInteger(r.revision)||Number(r.revision)<1||!['awaiting_confirmation','creating','creation_unknown','pending','draining','redeeming','redemption_unknown','awaiting_owner_confirmation','saving','completed','expired','blocked'].includes(String(r.phase)))return invalid('recovery metadata rejected');
 for(const identity of [r.old_identity,r.new_identity])if(identity!==null){
  if(!record(identity)||Object.keys(identity).length!==4||!['id','name','owner_id','owner_email'].every(k=>typeof identity[k]==='string'&&identity[k]!==''&&!/[\p{Cc}]/u.test(identity[k] as string))||!['id','owner_id'].every(k=>/^[A-Za-z0-9_-]{1,128}$/.test(identity[k] as string))||[...(identity.name as string)].length>80||(identity.owner_email as string).length>320)return invalid('recovery identity rejected');
 }
 if(r.pairing!==null){
  const p=r.pairing;if(!record(p)||Object.keys(p).length!==3||!['code','verification_url','expires_at'].every(k=>typeof p[k]==='string')||!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(p.code as string)||!Number.isFinite(Date.parse(p.expires_at as string)))return invalid('recovery pairing rejected');
  let u:URL;try{u=new URL(p.verification_url as string)}catch{return invalid('recovery URL rejected')}
  if(!safeOrigin(u.origin)||u.username||u.password||u.hash||u.pathname!=='/devices/pair'||u.searchParams.size!==1||u.searchParams.get('code')!==p.code)return invalid('recovery URL rejected');
 }
 if(['pending','draining','redeeming','redemption_unknown'].includes(String(r.phase))&&r.pairing===null)return invalid('recovery phase requires pairing');
 if(['saving','completed','awaiting_owner_confirmation'].includes(String(r.phase))&&r.new_identity===null)return invalid('recovery phase requires new identity');
 if(r.failure!==null)decodeBridgeError(r.failure,'DEVICE_RECOVERY_INVALID');
 return structuredClone(r) as unknown as DeviceRecoveryView;
}
