import type {BridgeError} from './bridge';
export interface UiFailure {code:string;check:string;observedAt:string|null;evidence:Record<string,string>;message:string}
export interface FailureDetails {check:string;observed_at:string;evidence:Record<string,string>}
export const requestMethods='hello ping shutdown device_status device_begin device_context device_recovery_prepare device_recovery_confirm device_recovery_status account_defaults account_detect account_snapshot account_action supply_status supply_set_paused authorize_start authorize_status authorize_cancel authorize_progress authorize_open diagnostics_start diagnostics_snapshot diagnostics_cancel runtime_snapshot runtime_start runtime_stop runtime_restore runtime_configure_network runtime_enable_presence runtime_verify network_status network_test notification_snapshot'.split(' ');
export const failureKinds='timeout dns_temporary dns_failed tls_failed connection_refused connection_closed http_rejected unknown_failure'.split(' ');
export function retryEvidence(key:string,value:string):boolean|undefined {
 const integer=(max:number)=>/^(0|[1-9]\d{0,15})$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<=max;
 if(key==='request_id')return /^shell-[1-9]\d{0,19}$/.test(value)&&BigInt(value.slice(6))<=18446744073709551615n;
 if(key==='method')return ['GET','PUT','POST',...requestMethods].includes(value);
 if(key==='platform')return ['none','openai','claude'].includes(value);
 if(key==='phase')return ['queue','write','response','http_start','http_end','http_error'].includes(value);
 if(key==='failure_kind')return failureKinds.includes(value);
 if(['fully_sent','in_flight'].includes(key))return ['true','false'].includes(value);
 if(['queue_ms','execution_ms','elapsed_ms'].includes(key))return integer(Number.MAX_SAFE_INTEGER);
 if(key==='retry_after_seconds')return integer(2147483647);
 return undefined;
}
const keys=['request_id','method','platform','phase','queue_ms','execution_ms','elapsed_ms','retry_after_seconds','fully_sent','in_flight','failure_kind','target_origin','path','http_status','remote_code','response_body','source_type','actual','required'];
const accountKeys=['not_found','permission_denied','os_error','cause','parsed','profile_scope','inference_scope','expires_at','source_revision_match','transport_failed','confirmed'];
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const bytes=(v:string)=>new TextEncoder().encode(v).length;
export function safeFailureText(value:string):string {
 let result=value.replace(/\b(?:bee_|beep_|sk-)[A-Za-z0-9_-]{8,}/g,'[redacted]')
  .replace(/\bBearer\s+[^\s,;"']+/gi,'Bearer [redacted]')
  .replace(/((?:"|')?(?:authorization|credential|token|secret|password|api[_-]?key)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi,'$1[redacted]')
  .replace(/(?:https?|wss?|socks5h?):\/\/[^\s<>"']+/gi,raw=>{
   try{const url=new URL(raw);if(url.username||url.password)return `${url.protocol}//${url.host}${url.pathname}`;return raw.split(/[?#]/,1)[0];}catch{return '[redacted URL]';}
  }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,'�');
 if(bytes(result)>32768)result=`failure text bytes=${bytes(result)}; maximum=32768; text omitted`;
 return result;
}
export function validFailureTime(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value))return false;
 const parsed=Date.parse(value);return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,19)===value.slice(0,19)&&parsed<=Date.now()+5000;
}
export function safeOrigin(value:string):boolean {
 try {
  const u=new URL(value);
  if(!/^https?:\/\/[^/?#@\\\s]+$/.test(value))return false;
  const authority=value.slice(value.indexOf('://')+3);
  const hostname=authority.startsWith('[')?authority.slice(0,authority.indexOf(']')+1):authority.split(':')[0];
  const ipv4=/^127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/.test(hostname)&&hostname.split('.').every(part=>Number(part)<=255);
  const ipv6=hostname.startsWith('[')&&(u.hostname==='[::1]'||/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(u.hostname));
  return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&(hostname==='localhost'||ipv4||ipv6));
 }catch{return false;}
}

/** Fixed private protocol validation; never serializes unknown exception objects. */
export function decodeBridgeError(value:unknown,invalidCode='BRIDGE_REPLY_INVALID'):BridgeError {
 const invalid=(check:string):never=>{throw new Error(`${invalidCode}: ${check}`);};
 if(!record(value)||Object.keys(value).some(k=>!['code','message','details'].includes(k))||!Object.hasOwn(value,'code')||!Object.hasOwn(value,'message'))return invalid('error fields actual=missing or unknown; required=code,message and optional details');
 if(typeof value.code!=='string'||! /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value.code)||typeof value.message!=='string'||!value.message||bytes(value.message)>32768)return invalid('error requires public code and nonempty message at most 32768 bytes');
 if('details'in value){
  const d=value.details;
  if(!record(d)||Object.keys(d).length!==3||!['check','observed_at','evidence'].every(k=>Object.hasOwn(d,k)))return invalid('details fields rejected; required=check,observed_at,evidence');
  if(typeof d.check!=='string'||! /^[a-z][a-z0-9_]{0,79}$/.test(d.check)||!validFailureTime(d.observed_at)||!record(d.evidence))return invalid('details requires bounded public check, valid UTC observation and evidence object');
  for(const [key,v]of Object.entries(d.evidence)){
   if(!keys.includes(key)||typeof v!=='string'||bytes(v)>32768||safeFailureText(v)!==v)return invalid(`details evidence rejected at key=${keys.includes(key)?key:'unknown'}; required=fixed safe fields at most 32768 bytes`);
   if(retryEvidence(key,v)===false)return invalid(`details evidence ${key} rejected; required=fixed retry evidence value`);
   if(key==='target_origin'&&!safeOrigin(v)||key==='path'&&!/^\/api\/bee\/[a-z0-9/_-]+$/.test(v)||key==='http_status'&&!/^[1-5][0-9]{2}$/.test(v)||key==='remote_code'&&!/^[a-z][a-z0-9_]{0,127}$/.test(v)||key==='source_type'&&!/^[a-z][a-z0-9_]{0,79}$/.test(v))return invalid(`details evidence ${key} rejected; required=safe public value`);
  }
 }
 return structuredClone(value) as unknown as BridgeError;
}
export function throwBridgeError(value:unknown,invalidCode?:string):never {
 const e=decodeBridgeError(value,invalidCode);throw Object.assign(new Error(e.message),{code:e.code,...(e.details?{details:e.details}:{})});
}
/** Preserve known fields only. Translation belongs to rendering, never state. */
export function normalizeFailure(cause:unknown,check:string):UiFailure {
 const fallback:UiFailure={code:'unknown_failure',check,observedAt:null,evidence:{},message:safeFailureText(typeof cause==='string'?cause:cause instanceof Error?cause.message:record(cause)&&typeof cause.message==='string'?cause.message:'Failure without a public message')};
 if(!record(cause))return fallback;
 if(typeof cause.code==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(cause.code))fallback.code=cause.code;
 if(typeof cause.check==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(cause.check))fallback.check=cause.check;
 if(validFailureTime(cause.observedAt))fallback.observedAt=cause.observedAt;
 const account=typeof cause.check==='string'&&(typeof cause.platform==='string'||Object.hasOwn(cause,'observedAt'));
 const source=record(cause.evidence)?cause.evidence:null;
 if(account&&source&&validFailureTime(source.observed_at))fallback.observedAt=source.observed_at;
 if(source)for(const [k,v]of Object.entries(source))if((keys.includes(k)||account&&accountKeys.includes(k))&&typeof v==='string')fallback.evidence[k]=safeFailureText(v);
 if('details'in cause){
  try{const e=decodeBridgeError({code:fallback.code,message:fallback.message,details:cause.details});if(e.details){fallback.check=e.details.check;fallback.observedAt=e.details.observed_at;fallback.evidence={...e.details.evidence};}}
  catch{ return {...fallback,code:'FAILURE_DETAILS_INVALID',evidence:{},message:safeFailureText(`Failure details rejected; required=valid safe private protocol fields; original=${fallback.message}`)}; }
 }
 return fallback;
}

/** Reserved native transport codes prove this attempt emitted no request bytes. */
export const requestNotSent=(failure:UiFailure):boolean=>['REQUEST_NOT_SENT','REQUEST_QUEUE_TIMEOUT','REQUEST_NOT_QUEUED'].includes(failure.code);
