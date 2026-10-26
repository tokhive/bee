import type {DeviceInvoke} from './device';
import type {AccountOperation,AccountPlatform,AccountSource} from './accounts';
import {decodeAuthorizeValue,validateAuthorizeRequest} from './accounts.ts';

export interface AuthorizeRequest {platform:AccountPlatform;source:AccountSource;expected_revision:number}
export interface AuthorizeClient {
 start(request:AuthorizeRequest):Promise<AccountOperation>;
 status(operationId:string):Promise<AccountOperation>;
 cancel(operationId:string):Promise<AccountOperation>;
}
export type AuthorizeFactory=(instance:string)=>AuthorizeClient;
function invalid(message:string):never {throw new Error(`AUTHORIZE_REPLY_INVALID: ${message}`);}
function operationID(id:string):void {if(typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id))invalid('operation ID requires 48 lowercase hex');}
export function decodeAuthorizeOperation(reply:unknown,instance:string):AccountOperation {
 if(!reply||typeof reply!=='object'||(reply as {instance?:unknown}).instance!==instance)invalid('reply.instance differs from current child');
 const r=(reply as {result?:unknown}).result;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==1)invalid('result requires a single operation or error');
 if('error'in r){const e=r.error;if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).length!==2||!('code'in e)||e.code!=='AUTHORIZE_OPERATION_FAILED'||!('message'in e)||typeof e.message!=='string'||e.message.length>32768)invalid('authorization error envelope rejected');throw new Error(`${e.code}: ${e.message}`);}
 if(!('operation'in r))invalid('result.operation missing');
 return decodeAuthorizeValue(r.operation);
}
export function createAuthorizeClient(invoke:DeviceInvoke,instance:string):AuthorizeClient {
 const revisions=new Map<string,number>();const platforms=new Map<string,AccountPlatform>();
 function observe(op:AccountOperation,expectedID?:string,platform?:AccountPlatform){
  if(expectedID&&op.id!==expectedID)invalid('operation ID differs from request');
  if((platform&&op.platform!==platform)||(platforms.has(op.id)&&platforms.get(op.id)!==op.platform))invalid('operation platform differs from request');
  if(op.revision<(revisions.get(op.id)??-1))invalid('operation revision is older than the last receipt');
  revisions.set(op.id,op.revision);platforms.set(op.id,op.platform);return op;
 }
 return {
  async start(request){validateAuthorizeRequest(request);return observe(decodeAuthorizeOperation(await invoke('authorize_start',{request}),instance),undefined,request.platform);},
  async status(operationId){operationID(operationId);return observe(decodeAuthorizeOperation(await invoke('authorize_status',{operationId}),instance),operationId);},
  async cancel(operationId){operationID(operationId);return observe(decodeAuthorizeOperation(await invoke('authorize_cancel',{operationId}),instance),operationId);}
 };
}
