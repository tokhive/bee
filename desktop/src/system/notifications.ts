import {decodeBridgeError} from './failures.ts';
import type {DeviceInvoke} from './device';
import type {BridgeError} from './bridge';
export type NotificationPermission='granted'|'denied'|'prompt';
export interface NotificationDeliverySnapshot{error:BridgeError|null;retryable_count:number;pending_count:number;uncertain_count:number;check_sequence:number}
export interface NotificationRetryReceipt{retryable_count:number}
export interface AutostartSnapshot{desired:boolean;registered:boolean|null;error:BridgeError|null}
function invalid():never{throw new Error('OS_STATE_INVALID: native permission or registration schema rejected');}
export function decodePermission(value:unknown):NotificationPermission{if(value!=='granted'&&value!=='denied'&&value!=='prompt')invalid();return value;}
export function decodeAutostart(value:unknown):AutostartSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const o=value as Record<string,unknown>;
 if(Object.keys(o).length!==3||!['desired','registered','error'].every(k=>k in o)||typeof o.desired!=='boolean'||(o.registered!==null&&typeof o.registered!=='boolean'))invalid();
 if(o.error!==null)decodeBridgeError(o.error,'OS_STATE_INVALID');
 return value as AutostartSnapshot;
}
export function createNotificationsClient(invoke:DeviceInvoke){return {
 async permission(){return decodePermission(await invoke('notification_permission',{}));},
 async enable(){return decodePermission(await invoke('notification_enable',{}));},
 async autostartStatus(){return decodeAutostart(await invoke('autostart_status',{}));},
 async autostartSet(enabled:boolean){if(typeof enabled!=='boolean')invalid();return decodeAutostart(await invoke('autostart_set',{enabled}));},
 async deliveryStatus():Promise<NotificationDeliverySnapshot>{
  return decodeDeliveryStatus(await invoke('notification_delivery_status',{}));
 },
 async retry():Promise<NotificationRetryReceipt>{
  return decodeRetryReceipt(await invoke('notification_retry',{}));
 },
};}
function notificationEvidence(value:unknown):string{
 if(typeof value==='number'||typeof value==='boolean'||value==null)return String(value);
 if(typeof value==='string')return `type=string length=${value.length}`;
 if(Array.isArray(value))return `type=array length=${value.length}`;
 return `type=${typeof value}`;
}
function notificationObject(value:unknown,fields:string[],check:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`OS_STATE_INVALID: ${check} requires an object; actual=${notificationEvidence(value)}`);
 const object=value as Record<string,unknown>;
 if(Object.keys(object).length!==fields.length||!fields.every(field=>field in object))throw new Error(`OS_STATE_INVALID: ${check} fields rejected; field_count=${Object.keys(object).length}; missing_fields=${fields.filter(field=>!(field in object)).join(',')}; required_fields=${fields.join(',')}`);
 return object;
}
function notificationCounter(object:Record<string,unknown>,field:string,check:string){
 const value=object[field];if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error(`OS_STATE_INVALID: ${check}.${field} requires a non-negative safe integer; actual=${notificationEvidence(value)}`);
}
export function decodeDeliveryStatus(value:unknown):NotificationDeliverySnapshot{
 const object=notificationObject(value,['error','retryable_count','pending_count','uncertain_count','check_sequence'],'notification_delivery_status');
 for(const field of ['retryable_count','pending_count','uncertain_count','check_sequence'])notificationCounter(object,field,'notification_delivery_status');
 if(object.error!==null)decodeBridgeError(object.error,'OS_STATE_INVALID');
 return value as NotificationDeliverySnapshot;
}
export function decodeRetryReceipt(value:unknown):NotificationRetryReceipt{
 const object=notificationObject(value,['retryable_count'],'notification_retry');notificationCounter(object,'retryable_count','notification_retry');return value as NotificationRetryReceipt;
}
