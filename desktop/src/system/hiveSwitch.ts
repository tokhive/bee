import {decodeDeviceReply,decodeDeviceRecoveryReply,type DeviceClient,type DeviceInvoke} from './device.ts';
import type {BridgeError} from './bridge.ts';
import {decodeBridgeError} from './failures.ts';
export const switchPhases=['preparing_target','draining_source','stopping_source','connecting_target','committing_current','releasing_target','restoring_source','succeeded','failed','cancelled'] as const;
export type SwitchPhase=typeof switchPhases[number];
export interface HiveProfile {id:string;origin:string;raw_origin:string;binding_revision:number;binding_digest:string|null;blockers:string[]}
export interface SwitchWork {executions:number;unknown_terminations:number;unsettled:number}
export interface SwitchLeg {profile:string;binding_revision:number|null;binding_digest:string|null;instance:string|null;process_binding_revision:number|null;network_revision:number;operation:unknown;seal:unknown;release:unknown;status:({current:{work:SwitchWork|null}}&Record<string,unknown>)|null;pending:string|null;workers_stopped:boolean;child_reaped:boolean;ipc_empty:boolean;verified:boolean}
export interface SwitchOperation {version:number;id:string;source:SwitchLeg;target:SwitchLeg;phase:SwitchPhase;source_index_operation:string|null;commit_revision:number|null;committed:boolean;cancel_requested:boolean;quit_requested:boolean;observation_round:number;observation_started:string|null;query_failures:number;observation_last:string|null;observation_blocked:boolean;failure:BridgeError|null}
export interface HiveSwitchSnapshot {
 profile_identities:{profile_id:string;name:string;owner_id:string;owner_email:string}[];
 profiles:{version:number;revision:number;profiles:HiveProfile[];current_profile:string|null;committed_operation:string|null;migration_id:string|null;migration_blockers:string[];historical_conflicts:{origin:string;canonical_origin:string;source:string}[]};
 operation:SwitchOperation|null;observation:{state:'idle'|'observing'|'paused'|'blocked';reason:string|null;next_query_at:string|null};
 actions:{can_cancel:boolean;can_continue:boolean;can_observe:boolean;target_pairing:boolean};current_scope:{profile_id:string;instance:string}|null;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const nullableString=(v:unknown)=>v===null||typeof v==='string';
function invalid(path:string,value:unknown,required:string):never{throw new Error(`HIVE_SWITCH_REPLY_INVALID: ${path}=${typeof value==='object'?`object(fields=${Object.keys(value??{}).length})`:typeof value==='string'?`string(length=${value.length})`:String(value)}; required=${required}`);}
function fields(v:unknown,keys:string[],path:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k)))invalid(path,object(v)?Object.keys(v):typeof v,keys.join(','));}
export function decodeHiveSwitchSnapshot(value:unknown):HiveSwitchSnapshot {
 fields(value,['profiles','operation','observation','actions','current_scope','profile_identities'],'snapshot');
 const p=value.profiles;fields(p,['version','revision','profiles','current_profile','committed_operation','migration_id','migration_blockers','historical_conflicts'],'profiles');
 if(p.version!==1||!integer(p.revision)||!Array.isArray(p.profiles)||!Array.isArray(p.migration_blockers)||!p.migration_blockers.every(v=>typeof v==='string')||!Array.isArray(p.historical_conflicts)||!['current_profile','committed_operation','migration_id'].every(k=>nullableString(p[k])))invalid('profiles',p,'version 1, safe revision and explicit index fields');
 for(const entry of p.profiles){fields(entry,['id','origin','raw_origin','binding_revision','binding_digest','blockers'],'profile');if(!['id','origin','raw_origin'].every(k=>typeof entry[k]==='string'&&entry[k])||!integer(entry.binding_revision)||!nullableString(entry.binding_digest)||!Array.isArray(entry.blockers)||!entry.blockers.every(v=>typeof v==='string'))invalid('profile',entry,'public profile with safe revision and blockers');}
 const ids=p.profiles.map(v=>v.id);if(new Set(ids).size!==ids.length||p.current_profile!==null&&!ids.includes(p.current_profile))invalid('current_profile',p.current_profile,'unique registered profile');
 if(!Array.isArray(value.profile_identities))invalid('profile_identities',value.profile_identities,'local public identity list');
 if(new Set(value.profile_identities.map(identity=>object(identity)?identity.profile_id:null)).size!==value.profile_identities.length)invalid('profile_identities',value.profile_identities,'one saved identity per profile');
 for(const identity of value.profile_identities){fields(identity,['profile_id','name','owner_id','owner_email'],'profile_identity');if(!ids.includes(identity.profile_id)||!Object.values(identity).every(v=>typeof v==='string'&&v))invalid('profile_identity',identity,'saved public identity for registered profile');}
 for(const conflict of p.historical_conflicts){fields(conflict,['origin','canonical_origin','source'],'historical_conflict');if(!Object.values(conflict).every(v=>typeof v==='string'))invalid('historical_conflict',conflict,'public strings');}
 fields(value.observation,['state','reason','next_query_at'],'observation');if(!['idle','observing','paused','blocked'].includes(String(value.observation.state))||!nullableString(value.observation.reason)||!nullableString(value.observation.next_query_at))invalid('observation',value.observation,'bounded state and nullable reason/time');
 fields(value.actions,['can_cancel','can_continue','can_observe','target_pairing'],'actions');if(!Object.values(value.actions).every(v=>typeof v==='boolean'))invalid('actions',value.actions,'native boolean capabilities');
 if(value.current_scope!==null){fields(value.current_scope,['profile_id','instance'],'current_scope');if(value.current_scope.profile_id!==p.current_profile||typeof value.current_scope.instance!=='string'||!value.current_scope.instance)invalid('current_scope',value.current_scope,'current profile and fixed child instance');}
 const op=value.operation;
 if(op!==null){
  fields(op,['version','id','source','target','phase','source_index_operation','commit_revision','committed','cancel_requested','quit_requested','observation_round','observation_started','query_failures','observation_last','observation_blocked','failure'],'operation');
  if(op.version!==1||typeof op.id!=='string'||!/^[a-f0-9]{48}$/.test(op.id)||!switchPhases.includes(op.phase as SwitchPhase)||!['committed','cancel_requested','quit_requested','observation_blocked'].every(k=>typeof op[k]==='boolean')||!integer(op.observation_round)||!integer(op.query_failures)||op.commit_revision!==null&&!integer(op.commit_revision)||!nullableString(op.source_index_operation)||!nullableString(op.observation_started)||!nullableString(op.observation_last))invalid('operation',op,'version 1, original ID, phase and persisted observation');
  for(const name of ['source','target']){
   const leg=op[name];fields(leg,['profile','binding_revision','binding_digest','instance','process_binding_revision','network_revision','operation','seal','release','status','pending','workers_stopped','child_reaped','ipc_empty','verified'],name);
   if(!ids.includes(leg.profile)||!['binding_digest','instance','pending'].every(k=>nullableString(leg[k]))||!['binding_revision','process_binding_revision'].every(k=>leg[k]===null||integer(leg[k]))||!integer(leg.network_revision)||!['workers_stopped','child_reaped','ipc_empty','verified'].every(k=>typeof leg[k]==='boolean'))invalid(name,leg,'registered profile and typed process evidence');
   if(leg.status!==null){if(!object(leg.status)||!object(leg.status.current)||!Object.hasOwn(leg.status.current,'work'))invalid(name+'.status',leg.status,'native status.current.work');const work=leg.status.current.work;if(work!==null){fields(work,['executions','unknown_terminations','unsettled'],name+'.current.work');if(!Object.values(work).every(integer))invalid(name+'.current.work',work,'known nonnegative safe integer counts or null');}}
  }
  if(op.source===op.target||(op.source as Record<string,unknown>).profile===(op.target as Record<string,unknown>).profile)invalid('operation profiles',op.id,'distinct source and target');
  if(op.failure!==null)decodeBridgeError(op.failure,'HIVE_SWITCH_REPLY_INVALID');
 }
 return structuredClone(value) as unknown as HiveSwitchSnapshot;
}
export const switchPending=(s:HiveSwitchSnapshot|undefined)=>!!s?.operation&&!['succeeded','failed','cancelled'].includes(s.operation.phase);
export interface HiveSwitchClient {
 snapshot():Promise<HiveSwitchSnapshot>;start(origin:string,name:string):Promise<HiveSwitchSnapshot>;observe():Promise<HiveSwitchSnapshot>;cancel():Promise<HiveSwitchSnapshot>;continue():Promise<HiveSwitchSnapshot>;quit(decision:'continue_waiting'|'cancel_and_quit'):Promise<HiveSwitchSnapshot>;target:DeviceClient;
 onExitRequest?(listener:(operationId:string)=>void):Promise<()=>void>;
}
export function createHiveSwitchClient(invoke:DeviceInvoke,onExitRequest?:HiveSwitchClient['onExitRequest']):HiveSwitchClient {
 const snapshot=async(command:string,args?:Record<string,unknown>)=>decodeHiveSwitchSnapshot(await invoke(command,args));
 return {snapshot:()=>snapshot('hive_switch_snapshot'),start:(origin,name)=>snapshot('hive_switch_start',{origin,name}),observe:()=>snapshot('hive_switch_observe'),cancel:()=>snapshot('hive_switch_cancel'),continue:()=>snapshot('hive_switch_continue'),quit:decision=>snapshot('hive_switch_quit',{decision}),onExitRequest,
 target:{status:async()=>decodeDeviceReply(await invoke('hive_switch_target_status')),begin:async(_hive,name)=>decodeDeviceReply(await invoke('hive_switch_target_begin',{name})),open:async()=>decodeDeviceReply(await invoke('hive_switch_target_open')),recoveryPrepare:async()=>decodeDeviceRecoveryReply(await invoke('hive_switch_target_recovery_prepare')),recoveryStatus:async()=>decodeDeviceRecoveryReply(await invoke('hive_switch_target_recovery_status')),recoveryConfirm:async(operationId,expectedRevision,decision)=>decodeDeviceRecoveryReply(await invoke('hive_switch_target_recovery_confirm',{operationId,expectedRevision,decision})),recoveryOpen:async()=>decodeDeviceRecoveryReply(await invoke('hive_switch_target_open'))}};
}
