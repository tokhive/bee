import type {DeviceInvoke} from './device';
import type {AccountError,AccountPlatform,AccountSnapshot} from './accounts';
import {decodeAccountReply,decodeAccountError} from './accounts.ts';
import type {SupplyView} from './supply';
import {decodeSupplyReply} from './supply.ts';

export interface RuntimeOperation {id:string;kind:'start'|'stop';platform:null;state:'pending'|'running'|'reconciling'|'succeeded'|'failed'|'cancelled';revision:number;error:AccountError|null}
export interface StopReceipt {workers_stopped:boolean;intent_saved:boolean;session_clean:boolean}
export interface RuntimeSnapshot {
 run_id:string|null;revision:number;network_revision:number;observed_at:string;
 local:'stopped'|'starting'|'running'|'stopping'|'failed';
 connection:'disconnected'|'connecting'|'connected'|'reconnecting'|'rejected'|'occupied';
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
function timestamp(value:unknown,at:string){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString().slice(0,19)!==value.slice(0,19)||Date.parse(value)>Date.now()+5000)invalid(`${at} requires a valid observed UTC timestamp`);}
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
 const s=object(result(reply,instance,'runtime'),['run_id','revision','network_revision','observed_at','local','connection','platforms','operation','stop_receipt'],'runtime');
 if(s.run_id!==null&&(typeof s.run_id!=='string'||!/^[a-f0-9]{32}$/.test(s.run_id)))invalid('run_id requires null or 32 lowercase hex');
 integer(s.revision,'revision');integer(s.network_revision,'network_revision');timestamp(s.observed_at,'observed_at');
 oneOf(s.local,['stopped','starting','running','stopping','failed'],'local');oneOf(s.connection,['disconnected','connecting','connected','reconnecting','rejected','occupied'],'connection');
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
