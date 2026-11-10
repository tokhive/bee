import {decodeBridgeError,throwBridgeError} from './failures.ts';
import type {DeviceInvoke} from './device';
import type {AccountOperation,AccountPlatform,AccountSource} from './accounts';
import {decodeAuthorizeValue,validateAuthorizeRequest} from './accounts.ts';
import type {CodexLoginExtension,CodexLoginProgress} from './codexLogin.contract';
import {decodeCodexLoginProgress,decodeCodexLoginOpen} from './codexLogin.ts';

export interface AuthorizeRequest {platform:AccountPlatform;source:AccountSource;expected_revision:number}
export interface AuthorizeClient extends Partial<CodexLoginExtension> {
 start(request:AuthorizeRequest):Promise<AccountOperation>;
 status(operationId:string):Promise<AccountOperation>;
 cancel(operationId:string):Promise<AccountOperation>;
}
export type AuthorizeFactory=(instance:string,capabilities?:readonly string[])=>AuthorizeClient;
function invalid(message:string):never {throw new Error(`AUTHORIZE_REPLY_INVALID: ${message}`);}
function operationID(id:string):void {if(typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id))invalid('operation ID requires 48 lowercase hex');}
export function decodeAuthorizeOperation(reply:unknown,instance:string):AccountOperation {
 if(!reply||typeof reply!=='object'||(reply as {instance?:unknown}).instance!==instance)invalid('reply.instance differs from current child');
 const r=(reply as {result?:unknown}).result;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==1)invalid('result requires a single operation or error');
 if('error'in r){const e=decodeBridgeError(r.error,'AUTHORIZE_REPLY_INVALID');if(e.code!=='AUTHORIZE_OPERATION_FAILED')invalid('authorization error code rejected');throwBridgeError(e,'AUTHORIZE_REPLY_INVALID');}
 if(!('operation'in r))invalid('result.operation missing');
 return decodeAuthorizeValue(r.operation);
}
export function createAuthorizeClient(invoke:DeviceInvoke,instance:string,capabilities:readonly string[]=[]):AuthorizeClient {
 const revisions=new Map<string,number>();const platforms=new Map<string,AccountPlatform>();
 const sequences=new Map<string,number>();
 function observeProgress(p:CodexLoginProgress,id:string){
  if(p.sequence<(sequences.get(id)??-1))throw new Error('AUTHORIZE_RESULT_SUPERSEDED: an earlier progress response was discarded');
  observe(p.operation,id,'openai');sequences.set(id,p.sequence);return p;
 }
 function observe(op:AccountOperation,expectedID?:string,platform?:AccountPlatform){
  if(expectedID&&op.id!==expectedID)invalid('operation ID differs from request');
  if((platform&&op.platform!==platform)||(platforms.has(op.id)&&platforms.get(op.id)!==op.platform))invalid('operation platform differs from request');
  if(op.revision<(revisions.get(op.id)??-1))invalid('operation revision is older than the last receipt');
  revisions.set(op.id,op.revision);platforms.set(op.id,op.platform);return op;
 }
 return {
  ...(capabilities.includes('authorize_progress')?{async progress(id:string){operationID(id);return observeProgress(decodeCodexLoginProgress(await invoke('authorize_progress',{operationId:id}),instance,id),id);}}:{}),
  ...(capabilities.includes('authorize_progress')&&capabilities.includes('authorize_open')?{async open(id:string){operationID(id);const receipt=decodeCodexLoginOpen(await invoke('authorize_open',{operationId:id}),instance,id);observeProgress(receipt.progress,id);return receipt;}}:{}),
  async start(request){validateAuthorizeRequest(request);return observe(decodeAuthorizeOperation(await invoke('authorize_start',{request}),instance),undefined,request.platform);},
  async status(operationId){operationID(operationId);return observe(decodeAuthorizeOperation(await invoke('authorize_status',{operationId}),instance),operationId);},
  async cancel(operationId){operationID(operationId);return observe(decodeAuthorizeOperation(await invoke('authorize_cancel',{operationId}),instance),operationId);}
 };
}
