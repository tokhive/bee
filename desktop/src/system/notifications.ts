import type {DeviceInvoke} from './device';
import type {BridgeError} from './bridge';
export type NotificationPermission='granted'|'denied'|'prompt';
export interface AutostartSnapshot{desired:boolean;registered:boolean|null;error:BridgeError|null}
function invalid():never{throw new Error('OS_STATE_INVALID: native permission or registration schema rejected');}
export function decodePermission(value:unknown):NotificationPermission{if(value!=='granted'&&value!=='denied'&&value!=='prompt')invalid();return value;}
export function decodeAutostart(value:unknown):AutostartSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const o=value as Record<string,unknown>;
 if(Object.keys(o).length!==3||!['desired','registered','error'].every(k=>k in o)||typeof o.desired!=='boolean'||(o.registered!==null&&typeof o.registered!=='boolean'))invalid();
 if(o.error!==null){if(!o.error||typeof o.error!=='object'||Array.isArray(o.error))invalid();const e=o.error as Record<string,unknown>;if(Object.keys(e).length!==2||typeof e.code!=='string'||typeof e.message!=='string'||e.message.length>1024)invalid();}
 return value as AutostartSnapshot;
}
export function createNotificationsClient(invoke:DeviceInvoke){return {
 async permission(){return decodePermission(await invoke('notification_permission',{}));},
 async enable(){return decodePermission(await invoke('notification_enable',{}));},
 async autostartStatus(){return decodeAutostart(await invoke('autostart_status',{}));},
 async autostartSet(enabled:boolean){if(typeof enabled!=='boolean')invalid();return decodeAutostart(await invoke('autostart_set',{enabled}));},
 async deliveryStatus():Promise<{error:BridgeError|null}>{
  const value=await invoke('notification_delivery_status',{});
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!('error'in value))invalid();
  const error=(value as {error:unknown}).error;
  decodeAutostart({desired:false,registered:null,error});return value as {error:BridgeError|null};
 },
 async retry(){const value=await invoke('notification_retry',{});if(value!==null)invalid();},
};}
