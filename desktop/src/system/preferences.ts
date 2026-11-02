import {decodeBridgeError} from './failures.ts';
import type {DeviceInvoke} from './device';

export interface ProxyPreference {origin:string;device_scope:string|null;connect_proxy:string}
export interface DesktopPreferences {version:1;revision:number;language:'system'|'zh'|'en';theme:'system'|'light'|'dark';notifications_enabled:boolean;autostart_desired:boolean;proxies:ProxyPreference[]}
export type PreferenceError = import('./bridge').BridgeError;
export interface PreferencesSnapshot {preferences:DesktopPreferences;error:PreferenceError|null}
export interface PreferencesClient {read():Promise<PreferencesSnapshot>;save(expected:number,preferences:DesktopPreferences):Promise<PreferencesSnapshot>}
export function defaultPreferences():DesktopPreferences {return {version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[]};}
function invalid(check:string):never {throw new Error(`PREFERENCES_INVALID: ${check}`);}
function object(value:unknown,fields:string[],check:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(`${check} requires object`);
 const o=value as Record<string,unknown>;
 if(fields.some(k=>!(k in o))||Object.keys(o).some(k=>!fields.includes(k)))invalid(`${check} has missing or unexpected fields`);
 return o;
}
export function validateProxy(value:string):string {
 if(value==='')return value;
 if(typeof value!=='string'||value.length>256)invalid('proxy requires <=256 characters');
 const authority=/^http:\/\/(\[[0-9a-fA-F:]+\]|(?:\d{1,3}\.){3}\d{1,3}):(\d+)\/?$/.exec(value);
 if(!authority)invalid('proxy requires unauthenticated HTTP, explicit loopback IP and port without path/query');
 const port=Number(authority[2]);if(port<1||port>65535)invalid('proxy port requires 1..65535');
 let url:URL;try{url=new URL(value);}catch{return invalid('proxy URL parsing failed');}
 const host=url.hostname;
 if(host!=='[::1]'&&!/^127\.\d+\.\d+\.\d+$/.test(host))invalid('proxy host requires loopback IP');
 return value;
}
export function decodePreferences(value:unknown):PreferencesSnapshot {
 const snapshot=object(value,['preferences','error'],'snapshot');
 const p=object(snapshot.preferences,['version','revision','language','theme','notifications_enabled','autostart_desired','proxies'],'preferences');
 if(p.version!==1)invalid('version requires 1');
 if(typeof p.revision!=='number'||!Number.isSafeInteger(p.revision)||p.revision<0)invalid('revision requires nonnegative safe integer');
 if(typeof p.language!=='string'||!['system','zh','en'].includes(p.language))invalid('language requires known value');
 if(typeof p.theme!=='string'||!['system','light','dark'].includes(p.theme))invalid('theme requires known value');
 if(typeof p.notifications_enabled!=='boolean'||typeof p.autostart_desired!=='boolean')invalid('notification/autostart preferences require booleans');
 if(!Array.isArray(p.proxies)||p.proxies.length>128)invalid('proxies requires array of at most 128 scopes');
 const scopes=new Set<string>();
 for(const entry of p.proxies){
  const proxy=object(entry,['origin','device_scope','connect_proxy'],'proxy');
  if(typeof proxy.origin!=='string')invalid('origin requires canonical HTTP(S) origin');
  let url:URL;try{url=new URL(proxy.origin);}catch{return invalid('origin URL parsing failed');}
  const local=url.hostname==='localhost'||url.hostname==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if(!(url.protocol==='https:'||url.protocol==='http:'&&local)||url.origin!==proxy.origin)invalid('origin requires canonical HTTPS origin (HTTP only on loopback)');
  if(proxy.device_scope!==null&&(typeof proxy.device_scope!=='string'||!/^[-a-zA-Z0-9_:]{1,256}$/.test(proxy.device_scope)))invalid('device scope requires bounded public identity');
  if(typeof proxy.connect_proxy!=='string')invalid('proxy requires string');validateProxy(proxy.connect_proxy);
  const key=JSON.stringify([proxy.origin,proxy.device_scope]);if(scopes.has(key))invalid('duplicate origin/device scope');scopes.add(key);
 }
 if(snapshot.error!==null){const error=decodeBridgeError(snapshot.error,'PREFERENCES_INVALID');if(!/^PREFERENCES_[A-Z_]+$/.test(error.code)||error.message.length>1024)invalid('error requires bounded public preference code and message');}
 return value as PreferencesSnapshot;
}
export function createPreferencesClient(invoke:DeviceInvoke):PreferencesClient {
 return {
  async read(){return decodePreferences(await invoke('preferences_read',{}));},
  async save(expected,preferences){
   if(!Number.isSafeInteger(expected)||expected<0||expected!==preferences.revision)invalid('save expected revision must match current preferences');
   decodePreferences({preferences,error:null});
   return decodePreferences(await invoke('preferences_save',{request:{expected_revision:expected,preferences}}));
  }
 };
}
