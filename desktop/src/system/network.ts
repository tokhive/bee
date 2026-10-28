import type {DeviceInvoke} from './device';
import type {BridgeError} from './bridge';
import {decodePreferences,validateProxy} from './preferences.ts';
import type {PreferencesSnapshot} from './preferences';

export type NetworkPath='direct'|'environment_proxy'|'local_proxy';
export interface NetworkPaths {relay:'direct'|'local_proxy'|'unknown';official:string;hive:'process_environment';official_login:'official_client'}
export interface NetworkSnapshot {saved_revision:number;effective_revision:number;saved_proxy:string;effective_proxy:string;paths:NetworkPaths;pending_restart:boolean;error:BridgeError|null}
export interface NetworkCheck {id:'local_proxy'|'openai_read_only'|'claude_read_only';status:'ok'|'failed'|'skipped';message:string;path:NetworkPath;http_status:number|null}
export interface NetworkTestResult {observed_at:string;checks:NetworkCheck[]}
export interface SaveProxyRequest {proxy:string;origin:string|null;expectedRevision:number}
export interface NetworkClient {snapshot():Promise<NetworkSnapshot>;test(proxy:string):Promise<NetworkTestResult>;saveProxy(request:SaveProxyRequest):Promise<PreferencesSnapshot>;applySaved(confirmed:boolean):Promise<NetworkSnapshot>}

function invalid(check:string):never {throw new Error(`NETWORK_REPLY_INVALID: ${check}`);}
function object(value:unknown,fields:string[],at:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(`${at} requires object`);
 const record=value as Record<string,unknown>;
 if(Object.keys(record).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(record,key)))invalid(`${at} has missing or unknown fields`);
 return record;
}
function integer(value:unknown,at:string){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)invalid(`${at} requires nonnegative safe integer`);}
function error(value:unknown){if(value===null)return;const e=object(value,['code','message'],'error');if(typeof e.code!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code)||typeof e.message!=='string'||e.message.length>32768)invalid('error requires bounded public code and message');}
function proxy(value:unknown,at:string){if(typeof value!=='string')invalid(`${at} requires string`);validateProxy(value);}
function origin(value:unknown){
 if(value===null)return;
 if(typeof value!=='string'||value.length>2048)invalid('draft origin requires bounded canonical origin');
 let url:URL;try{url=new URL(value);}catch{return invalid('draft origin URL parsing failed');}
 const local=url.hostname==='localhost'||url.hostname==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(url.hostname);
 if(!(url.protocol==='https:'||url.protocol==='http:'&&local)||url.origin!==value||url.username||url.password||url.search||url.hash||url.pathname!=='/')invalid('draft origin requires canonical HTTPS (HTTP only on loopback)');
}
const pathValues:NetworkPath[]=['direct','environment_proxy','local_proxy'];
const officialPaths=new Set(pathValues.flatMap(openai=>pathValues.map(claude=>`openai=${openai};claude=${claude}`)));
export function decodeNetworkSnapshot(value:unknown):NetworkSnapshot {
 const snapshot=object(value,['saved_revision','effective_revision','saved_proxy','effective_proxy','paths','pending_restart','error'],'network snapshot');
 integer(snapshot.saved_revision,'saved_revision');integer(snapshot.effective_revision,'effective_revision');proxy(snapshot.saved_proxy,'saved_proxy');proxy(snapshot.effective_proxy,'effective_proxy');error(snapshot.error);
 const paths=object(snapshot.paths,['relay','official','hive','official_login'],'paths');
 const unknown=snapshot.error!==null&&snapshot.effective_revision===0&&snapshot.effective_proxy===''&&paths.relay==='unknown'&&paths.official==='unknown';
 if(!unknown&&(typeof paths.relay!=='string'||!['direct','local_proxy'].includes(paths.relay)||typeof paths.official!=='string'||!officialPaths.has(paths.official)))invalid('paths require fixed relay and official traffic summaries');
 if(paths.hive!=='process_environment'||paths.official_login!=='official_client')invalid('Hive and official login require fixed traffic summaries');
 if(typeof snapshot.pending_restart!=='boolean'||snapshot.saved_proxy!==snapshot.effective_proxy&&!snapshot.pending_restart)invalid('pending_restart must be boolean and reflect a different saved proxy');
 return structuredClone(snapshot) as unknown as NetworkSnapshot;
}
export function decodeNetworkTestReply(value:unknown):NetworkTestResult {
 const envelope=object(value,['protocol','id','instance','result'],'network test reply');
 if(envelope.protocol!==1||typeof envelope.id!=='string'||envelope.id.length===0||envelope.id.length>80||typeof envelope.instance!=='string'||!/^[a-f0-9]{32}$/.test(envelope.instance))invalid('test reply requires protocol 1, bounded ID and owned instance');
 const result=object(object(envelope.result,['network_test'],'result').network_test,['observed_at','checks'],'network test');
 if(typeof result.observed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result.observed_at)||!Number.isFinite(Date.parse(result.observed_at))||new Date(result.observed_at).toISOString().slice(0,19)!==result.observed_at.slice(0,19))invalid('test observation requires valid UTC timestamp');
 if(!Array.isArray(result.checks)||result.checks.length!==3)invalid('test requires exactly three fixed checks');
 const ids=['local_proxy','openai_read_only','claude_read_only'];
 for(const [index,value]of result.checks.entries()){
  const check=object(value,['id','status','message','path','http_status'],'network check');
  if(check.id!==ids[index]||typeof check.status!=='string'||!['ok','failed','skipped'].includes(check.status)||!pathValues.includes(check.path as NetworkPath))invalid('test check requires fixed ID, status and path');
  if(typeof check.message!=='string'||check.message.length>1024||/[\u0000-\u001f\u007f-\u009f]/u.test(check.message))invalid('test check message requires bounded safe text');
  if(check.http_status!==null&&(typeof check.http_status!=='number'||!Number.isInteger(check.http_status)||check.http_status<100||check.http_status>599))invalid('test check HTTP status requires null or integer 100..599');
 }
 return structuredClone(result) as unknown as NetworkTestResult;
}
export function createNetworkClient(invoke:DeviceInvoke):NetworkClient {
 return {
  async snapshot(){return decodeNetworkSnapshot(await invoke('network_snapshot',{}));},
  async test(value){proxy(value,'draft proxy');return decodeNetworkTestReply(await invoke('network_test',{proxy:value}));},
  async saveProxy(request){object(request,['proxy','origin','expectedRevision'],'save proxy request');proxy(request.proxy,'saved proxy');origin(request.origin);integer(request.expectedRevision,'expectedRevision');return decodePreferences(await invoke('network_save_proxy',{proxy:request.proxy,origin:request.origin,expectedRevision:request.expectedRevision}));},
  async applySaved(confirmed){if(confirmed!==true)invalid('network restart requires explicit confirmation');return decodeNetworkSnapshot(await invoke('network_apply_saved',{confirmed}));},
 };
}
