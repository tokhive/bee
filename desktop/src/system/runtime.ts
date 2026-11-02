import type {DeviceInvoke} from './device';
import type {AccountError,AccountPlatform,AccountSnapshot} from './accounts';
import {decodeAccountReply,decodeAccountError} from './accounts.ts';
import type {SupplyView} from './supply';
import {decodeSupplyReply} from './supply.ts';

export interface RuntimeOperation {id:string;kind:'start'|'stop';platform:null;state:'pending'|'running'|'reconciling'|'succeeded'|'failed'|'cancelled';revision:number;error:AccountError|null}
export interface StopReceipt {workers_stopped:boolean;intent_saved:boolean;session_clean:boolean}
export interface ConnectionFailure {code:'dns_failed'|'tls_failed'|'connection_refused'|'timeout'|'http_rejected'|'connection_closed'|'synchronization_failed'|'ownership_unconfirmed'|'unknown_failure';stage:'connect'|'heartbeat'|'synchronize';occurred_at:string;message:string;evidence:Record<string,string>}
export interface ConnectionDetail {failure:ConnectionFailure|null;retry:'idle'|'attempting'|'scheduled'|'halted';next_retry_at:string|null}
export interface RuntimeSnapshot {
 run_id:string|null;revision:number;network_revision:number;observed_at:string;
 local:'stopped'|'starting'|'running'|'stopping'|'failed';
 connection:'disconnected'|'connecting'|'connected'|'reconnecting'|'rejected'|'occupied';
 connection_detail:ConnectionDetail|null;
 platforms:Record<AccountPlatform,{account:AccountSnapshot;supply:SupplyView|null;selection_revision:number}>;
 operation:RuntimeOperation|null;stop_receipt:StopReceipt|null;
}
export interface RuntimeStartRequest {expected_revision:number;resume_platforms:AccountPlatform[]}
export interface RuntimeClient {snapshot():Promise<RuntimeSnapshot>;start(request:RuntimeStartRequest):Promise<RuntimeOperation>;stop(expectedRevision:number):Promise<RuntimeOperation>}
export type RuntimeFactory=(instance:string)=>RuntimeClient;
function invalid(message:string):never{throw new Error(`RUNTIME_REPLY_INVALID: ${message}`);}
function object(value:unknown,fields:string[],at:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(`${at} requires object`);
 const o=value as Record<string,unknown>;
 if(Object.keys(o).some(k=>!fields.includes(k))||fields.some(k=>!(k in o)))invalid(`${at} has missing or unknown fields`);
 return o;
}
function integer(value:unknown,at:string){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)invalid(`${at} requires nonnegative safe integer`);}
function oneOf(value:unknown,allowed:unknown[],at:string){if(!allowed.includes(value))invalid(`${at} requires known value`);}
function timestamp(value:unknown,at:string,scheduled=false){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString().slice(0,19)!==value.slice(0,19)||(!scheduled&&Date.parse(value)>Date.now()+5000))invalid(`${at} requires a valid observed UTC timestamp`);}
function connectionDetail(value:unknown):void {
 if(value===null)return;
 const d=object(value,['failure','retry','next_retry_at'],'connection_detail');
 oneOf(d.retry,['idle','attempting','scheduled','halted'],'connection_detail.retry');
 if(d.retry==='scheduled')timestamp(d.next_retry_at,'next_retry_at',true);
 else if(d.next_retry_at!==null)invalid('next_retry_at requires null unless scheduled');
 if(d.failure===null)return;
 const f=object(d.failure,['code','stage','occurred_at','message','evidence'],'connection_detail.failure');
 oneOf(f.code,['dns_failed','tls_failed','connection_refused','timeout','http_rejected','connection_closed','synchronization_failed','ownership_unconfirmed','unknown_failure'],'connection_detail.failure.code');
 oneOf(f.stage,['connect','heartbeat','synchronize'],'connection_detail.failure.stage');timestamp(f.occurred_at,'connection_detail.failure.occurred_at');
 const bytes=(v:string)=>new TextEncoder().encode(v).length;
 if(typeof f.message!=='string'||bytes(f.message)>32768)invalid('connection failure message requires bounded text');
 if(!f.evidence||typeof f.evidence!=='object'||Array.isArray(f.evidence))invalid('connection failure evidence requires object');
 const allowed=['target_origin','path','http_status','remote_code','response_body','owned_session','consecutive_conflicts'];
 for(const [key,v]of Object.entries(f.evidence)){
  if(!allowed.includes(key)||typeof v!=='string'||bytes(v)>32768)invalid('connection failure evidence key or value rejected');
  if(key==='target_origin'){
   let u:URL;try{u=new URL(v);}catch{invalid('connection target_origin requires safe origin');}
   // Evidence preserves Go's origin spelling; validate its original authority
   // before URL parsing can normalize host case, ports or numeric IP forms.
   if(!/^https?:\/\/[^/?#@\\\s]+$/.test(v))invalid('connection target_origin shape rejected: safe_scheme_and_authority=false; required=HTTP(S) scheme and authority only');
   const authority=v.slice(v.indexOf('://')+3);
   const hostname=authority.startsWith('[')?authority.slice(0,authority.indexOf(']')+1):authority.split(':')[0];
   const ipv4=/^127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/.test(hostname)&&hostname.split('.').every(part=>Number(part)<=255);
   const ipv6=hostname.startsWith('[')&&(u.hostname==='[::1]'||/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(u.hostname));
   const loopback=hostname==='localhost'||ipv4||ipv6;
   if(u.username||u.password||u.search||u.hash||(u.protocol!=='https:'&&!(u.protocol==='http:'&&loopback)))invalid('connection target_origin requires safe origin');
  }
  if(key==='path'&&!/^\/api\/bee\/[a-z0-9/_-]+$/.test(v))invalid('connection path rejected');
  if(key==='http_status'&&!/^[1-5]\d{2}$/.test(v))invalid('connection HTTP rejection status rejected');
  if(key==='remote_code'&&!/^[a-z][a-z0-9_]{0,127}$/.test(v))invalid('connection remote code rejected');
  if(key==='owned_session'&&v!=='true'&&v!=='false')invalid('connection ownership evidence rejected');
  if(key==='consecutive_conflicts'&&(!/^(0|[1-9]\d*)$/.test(v)||!Number.isSafeInteger(Number(v))))invalid('connection conflict evidence rejected');
 }
}
function operation(value:unknown):RuntimeOperation{
 const o=object(value,['id','kind','platform','state','revision','error'],'operation');
 if(typeof o.id!=='string'||!/^[a-f0-9]{48}$/.test(o.id))invalid('operation.id requires 48 lowercase hex');
 oneOf(o.kind,['start','stop'],'operation.kind');oneOf(o.platform,[null],'operation.platform');oneOf(o.state,['pending','running','reconciling','succeeded','failed','cancelled'],'operation.state');integer(o.revision,'operation.revision');decodeAccountError(o.error,'openai');
 return o as unknown as RuntimeOperation;
}
function result(reply:unknown,instance:string,key:string):unknown{
 if(!reply||typeof reply!=='object'||(reply as {instance?:unknown}).instance!==instance)invalid('reply.instance differs from current child');
 const result=(reply as {result:unknown}).result;
 if(result&&typeof result==='object'&&'error'in result){const r=object(result,['error'],'result');const e=object(r.error,['code','message'],'error');if(e.code!=='RUNTIME_OPERATION_FAILED'||typeof e.message!=='string')invalid('runtime error envelope rejected');throw new Error(`${e.code}: ${e.message}`);}
 return object(result,[key],'result')[key];
}
export function decodeRuntimeOperation(reply:unknown,instance:string):RuntimeOperation{return operation(result(reply,instance,'operation'));}
export function decodeRuntimeSnapshot(reply:unknown,instance:string):RuntimeSnapshot{
 const s=object(result(reply,instance,'runtime'),['run_id','revision','network_revision','observed_at','local','connection','connection_detail','platforms','operation','stop_receipt'],'runtime');
 if(s.run_id!==null&&(typeof s.run_id!=='string'||!/^[a-f0-9]{32}$/.test(s.run_id)))invalid('run_id requires null or 32 lowercase hex');
 integer(s.revision,'revision');integer(s.network_revision,'network_revision');timestamp(s.observed_at,'observed_at');
 oneOf(s.local,['stopped','starting','running','stopping','failed'],'local');oneOf(s.connection,['disconnected','connecting','connected','reconnecting','rejected','occupied'],'connection');
 connectionDetail(s.connection_detail);
 const platforms=object(s.platforms,['openai','claude'],'platforms');
 for(const platform of ['openai','claude'] as const){
  const p=object(platforms[platform],['account','supply','selection_revision'],`platforms.${platform}`);integer(p.selection_revision,'selection_revision');decodeAccountReply({instance,result:{account:p.account}},platform,instance);
  if(p.supply!==null){const supply=p.supply as SupplyView;if(typeof supply.hive!=='string'||typeof supply.device_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(supply.device_id))invalid('supply binding rejected');decodeSupplyReply({result:{supply}}, {hive:supply.hive,deviceId:supply.device_id},platform);}
 }
 if(s.operation!==null)operation(s.operation);
 if(s.stop_receipt!==null){const receipt=object(s.stop_receipt,['workers_stopped','intent_saved','session_clean'],'stop_receipt');for(const [key,v]of Object.entries(receipt))if(typeof v!=='boolean')invalid(`stop_receipt.${key} requires boolean`);}
 return s as unknown as RuntimeSnapshot;
}
export function createRuntimeClient(invoke:DeviceInvoke,instance:string):RuntimeClient{
 let revision=-1;
 function observe<T extends {revision:number}>(value:T):T {
  if(value.revision<revision)invalid('reply revision is older than the last observed revision');
  revision=value.revision;
  return value;
 }
 return {
  async snapshot(){const s=decodeRuntimeSnapshot(await invoke('runtime_snapshot',{}),instance);return observe(s);},
  async start(request){integer(request.expected_revision,'request.expected_revision');if(!Array.isArray(request.resume_platforms)||request.resume_platforms.length>2||new Set(request.resume_platforms).size!==request.resume_platforms.length||request.resume_platforms.some(p=>p!=='openai'&&p!=='claude'))invalid('resume_platforms requires unique known platforms');return observe(decodeRuntimeOperation(await invoke('runtime_start',{request}),instance));},
  async stop(expectedRevision){integer(expectedRevision,'request.expected_revision');return observe(decodeRuntimeOperation(await invoke('runtime_stop',{expectedRevision}),instance));}
 };
}
