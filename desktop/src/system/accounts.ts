import type {DeviceInvoke} from './device';
import type {SupplyPlatform} from './supply';
import {supplyReasons} from './supply.ts';
export type AccountPlatform=SupplyPlatform;
export interface AccountError {code:string;check:string;platform:string;message:string;evidence:Record<string,string>}
export interface AccountSource {directory:string|null;store:string}
export interface AccountFact {state:string;fingerprint:string|null;observed_at:string|null;error:AccountError|null}
export interface AccountWindow {scope:string;seconds:number;used_percent:number|null;reset_at:string|null}
export interface AccountCapabilities {origin:'official'|'hive';status:string;observed_at:string|null;metadata_observed_at:string|null;valid_until:string|null;retry_at:string|null;plan:string|null;windows:AccountWindow[];models:{id:string;account_supported:boolean|null;market_open:null;accepting:null}[];error:AccountError|null}
export interface AccountAvailability {available:boolean;reason:string|null}
export interface AccountOperation {id:string;kind:"select"|"clear_selection"|"confirm_change";platform:AccountPlatform;state:"pending"|"running"|"reconciling"|"succeeded"|"failed"|"cancelled";revision:number;error:AccountError|null}
export interface AccountSnapshot {operation:AccountOperation|null;platform:AccountPlatform;revision:number;candidate:{state:string;reference:string|null;source:AccountSource|null;fingerprint:string|null;plan:string|null;expires_at:string|null;identity_verified:boolean;observed_at:string|null;error:AccountError|null};selection:AccountFact;hive:AccountFact&{pending_fingerprint:string|null;generation:number|null};authorization:AccountFact;capabilities:AccountCapabilities[];features:Record<'detect'|'check'|'select'|'confirm_change'|'remove'|'clear_selection'|'authorize'|'system_notifications',AccountAvailability>;issues:{code:string;platform:AccountPlatform;fingerprint:string|null;message:string;notify:boolean}[];checked_at:string|null}
export interface AccountDefault {platform:AccountPlatform;directory:string;default_store:string;stores:{store:string;supported:boolean;reason:string|null}[]}
export interface AccountDefaults {platforms:AccountDefault[]}
export interface AccountDetectRequest extends AccountSource {platform:AccountPlatform;mode:'local'|'official'}
export interface AccountActionRequest {platform:AccountPlatform;revision:number;candidate_ref:string;action:'select'|'confirm_change'|'remove'|'clear_selection';confirmed:boolean}
export interface AccountClient {defaults():Promise<AccountDefaults>;snapshot(platform:AccountPlatform,refresh:boolean):Promise<AccountSnapshot>;detect(request:AccountDetectRequest):Promise<AccountSnapshot>;action(request:AccountActionRequest):Promise<AccountSnapshot>;invalidate(platform:AccountPlatform):void}
export type AccountFactory=(instance:string)=>AccountClient;
type Validator=(value:unknown,at:string)=>void;
const invalid=(evidence:string):never=>{throw new Error(`ACCOUNT_REPLY_INVALID: ${evidence}`);};
const kind=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
const object=(v:unknown,at:string):Record<string,unknown>=>{if(typeof v!=='object'||v===null||Array.isArray(v))invalid(`${at} actual_type=${kind(v)}; required=object`);return v as Record<string,unknown>;};
const shape=(fields:Record<string,Validator>):Validator=>(v,at)=>{const o=object(v,at);if(Object.keys(o).some(k=>!(k in fields)))invalid(`${at} unknown field; required=public fields`);for(const [k,check]of Object.entries(fields)){if(!(k in o))invalid(`${at}.${k} missing; required=present`);check(o[k],`${at}.${k}`);}};
const text:Validator=(v,at)=>{if(typeof v!=='string'||v.length>8192||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))invalid(`${at} actual_type=${kind(v)}; required=bounded text`);};
const bool:Validator=(v,at)=>{if(typeof v!=='boolean')invalid(`${at} actual_type=${kind(v)}; required=boolean`);};
const integer:Validator=(v,at)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)invalid(`${at} required=nonnegative safe integer`);};
const oneOf=(values:readonly unknown[]):Validator=>(v,at)=>{if(!values.includes(v))invalid(`${at} required=known value`);};
const nullable=(check:Validator):Validator=>(v,at)=>{if(v!==null)check(v,at);};
const pattern=(regex:RegExp):Validator=>(v,at)=>{if(typeof v!=='string'||!regex.test(v))invalid(`${at} required=valid public identifier`);};
const list=(check:Validator,max:number):Validator=>(v,at)=>{if(!Array.isArray(v)||v.length>max)invalid(`${at} required=bounded array`);(v as unknown[]).forEach((item,i)=>check(item,`${at}[${i}]`));};
const timestamp:Validator=(v,at)=>{text(v,at);if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString().slice(0,19)!==v.slice(0,19))invalid(`${at} required=valid UTC RFC3339 timestamp`);};
const directory:Validator=(v,at)=>{if(typeof v!=='string'||!v||new TextEncoder().encode(v).length>4096||/[\u0000-\u001f\u007f]/.test(v)||!(/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(v)))invalid(`${at} required=absolute directory of 1..4096 UTF-8 bytes without control characters`);};
const digest=nullable(pattern(/^[a-f0-9]{64}$/));
const stores=(platform:AccountPlatform)=>platform==='openai'?['auto','file','keyring']:['file','keychain'];
const plans=(platform:AccountPlatform)=>platform==='openai'?['free','go','plus','pro','prolite','promax','team','business','enterprise','edu']:['pro','max','team','enterprise'];
const publicError=(platform:AccountPlatform)=>nullable(shape({code:pattern(/^[a-z][a-z0-9_]{0,79}$/),check:pattern(/^[a-z][a-z0-9_]{0,79}$/),platform:oneOf([platform,'unknown']),message:text,evidence:(v,at)=>{const o=object(v,at);const keys=['not_found','permission_denied','os_error','cause','parsed','profile_scope','inference_scope','expires_at','source_revision_match','http_status','path','transport_failed','confirmed'];for(const [k,val]of Object.entries(o)){if(!keys.includes(k))invalid(`${at} unknown evidence field`);text(val,`${at}.${k}`);}}}));
const available=shape({available:bool,reason:nullable(pattern(/^[a-z][a-z0-9_]{0,127}$/))});
function result(reply:unknown,instance:string,key:string):unknown {
 const o=object(reply,'reply');if(o.instance!==instance)invalid('reply.instance mismatch; required=current management instance');
 const r=object(o.result,'result');
 if('error'in r){shape({error:shape({code:oneOf(['ACCOUNT_OPERATION_FAILED']),message:text})})(r,'result');const e=r.error as {code:string;message:string};throw new Error(`${e.code}: ${e.message}`);}
 shape({[key]:()=>{}})(r,'result');return r[key];
}
export function decodeAccountReply(reply:unknown,platform:AccountPlatform,instance:string):AccountSnapshot {
 oneOf(['openai','claude'])(platform,'platform');const value=result(reply,instance,'account');
 const fact={state:pattern(/^[a-z][a-z0-9_]{0,79}$/),fingerprint:digest,observed_at:nullable(timestamp),error:publicError(platform)};
 const capability=shape({origin:oneOf(['official','hive']),status:oneOf(['unknown','ready','stale',...supplyReasons]),observed_at:nullable(timestamp),metadata_observed_at:nullable(timestamp),valid_until:nullable(timestamp),retry_at:nullable(timestamp),plan:nullable(oneOf(plans(platform))),windows:list(shape({scope:oneOf(platform==='openai'?['']:['','opus','sonnet','oauth_apps']),seconds:oneOf(platform==='openai'?[18000,604800,2592000]:[18000,604800]),used_percent:nullable((v,at)=>{integer(v,at);if((v as number)>10000)invalid(`${at} required=0..10000 percent`);}),reset_at:nullable(timestamp)}),5),models:list(shape({id:pattern(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),account_supported:nullable(bool),market_open:oneOf([null]),accepting:oneOf([null])}),32),error:publicError(platform)});
 shape({platform:oneOf([platform]),revision:integer,operation:nullable(shape({id:pattern(/^[a-f0-9]{48}$/),kind:oneOf(["select","clear_selection","confirm_change"]),platform:oneOf([platform]),state:oneOf(["pending","running","reconciling","succeeded","failed","cancelled"]),revision:integer,error:publicError(platform)})),candidate:shape({state:fact.state,reference:nullable(pattern(/^[a-f0-9]{48}$/)),source:nullable(shape({directory:nullable(directory),store:oneOf(stores(platform))})),fingerprint:digest,plan:nullable(oneOf(plans(platform))),expires_at:nullable(timestamp),identity_verified:bool,observed_at:nullable(timestamp),error:publicError(platform)}),selection:shape({...fact,state:oneOf(['not_selected','selected'])}),hive:shape({...fact,pending_fingerprint:digest,generation:nullable(integer)}),authorization:shape(fact),capabilities:list(capability,2),features:shape(Object.fromEntries(['detect','check','select','confirm_change','remove','clear_selection','authorize','system_notifications'].map(k=>[k,available]))),issues:list(shape({code:pattern(/^[a-z][a-z0-9_]{0,79}$/),platform:oneOf([platform]),fingerprint:digest,message:text,notify:bool}),32),checked_at:nullable(timestamp)})(value,'account');
 const account=value as AccountSnapshot;
 for(const [at,value]of [['candidate.observed_at',account.candidate.observed_at],['hive.observed_at',account.hive.observed_at],['authorization.observed_at',account.authorization.observed_at],['checked_at',account.checked_at],...account.capabilities.flatMap(c=>[[c.origin+'.observed_at',c.observed_at],[c.origin+'.metadata_observed_at',c.metadata_observed_at]])])if(value&&Date.parse(value)>Date.now()+5000)invalid(`${at} required=observation no later than now+5s`);
 if(account.capabilities.length!==2||account.capabilities[0].origin!=='official'||account.capabilities[1].origin!=='hive')invalid('capabilities required=official,hive in order');
 for(const key of ['confirm_change','remove','authorize','system_notifications'] as const)if(account.features[key].available)invalid(`features.${key} required=dependency unavailable in this build`);
 return account;
}
export function decodeAccountDefaults(reply:unknown,instance:string):AccountDefaults {
 const value=result(reply,instance,'defaults');shape({platforms:list((v,at)=>{const p=object(v,at).platform;oneOf(['openai','claude'])(p,`${at}.platform`);shape({platform:oneOf([p]),directory,default_store:oneOf(stores(p as AccountPlatform)),stores:list(shape({store:oneOf(stores(p as AccountPlatform)),supported:bool,reason:nullable(text)}),3)})(v,at);},2)})(value,'defaults');
 const defaults=value as AccountDefaults;if(defaults.platforms.length!==2||defaults.platforms[0].platform!=='openai'||defaults.platforms[1].platform!=='claude')invalid('defaults.platforms required=openai,claude in order');return defaults;
}
export function createAccountClient(invoke:DeviceInvoke,instance:string):AccountClient {
 const epochs={openai:0,claude:0};
 async function request(platform:AccountPlatform,command:string,args:Record<string,unknown>,version:number){
  const reply=await invoke(command,args);if(version!==epochs[platform])throw new Error('ACCOUNT_RESULT_SUPERSEDED: source request superseded');return decodeAccountReply(reply,platform,instance);
 }
 return {defaults:async()=>decodeAccountDefaults(await invoke('account_defaults',{}),instance),invalidate(platform){epochs[platform]++;},
  snapshot(platform,refresh){oneOf(['openai','claude'])(platform,'request.platform');bool(refresh,'request.refresh');return request(platform,'account_snapshot',{platform,refresh},epochs[platform]);},
  async detect(input){shape({platform:oneOf(['openai','claude']),directory:nullable(directory),store:oneOf(stores(input.platform)),mode:oneOf(['local','official'])})(input,'request');return request(input.platform,'account_detect',{request:input},++epochs[input.platform]);},
  async action(input){shape({platform:oneOf(['openai','claude']),revision:integer,candidate_ref:input.action==='clear_selection'?pattern(/^(?:[a-f0-9]{48})?$/):pattern(/^[a-f0-9]{48}$/),action:oneOf(['select','confirm_change','remove','clear_selection']),confirmed:bool})(input,'request');return request(input.platform,'account_action',{request:input},++epochs[input.platform]);}
 };
}
