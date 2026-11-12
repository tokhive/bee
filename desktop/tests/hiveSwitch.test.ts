import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHiveSwitchClient,decodeHiveSwitchSnapshot} from '../src/system/hiveSwitch.ts';
const profile={id:'a'.repeat(32),origin:'https://hive.example',raw_origin:'https://hive.example',binding_revision:1,binding_digest:null,blockers:[]};
export const emptySnapshot=()=>({profile_identities:[],profiles:{version:1,revision:1,profiles:[profile],current_profile:profile.id,committed_operation:null,migration_id:null,migration_blockers:[],historical_conflicts:[]},operation:null,observation:{state:'idle',reason:null,next_query_at:null},actions:{can_cancel:false,can_continue:false,can_observe:false,target_pairing:false},current_scope:{profile_id:profile.id,instance:'a'.repeat(32)}});
test('native switch snapshot validates current scope and preserves unknown work as unknown',()=>{
 const value=emptySnapshot();assert.deepEqual(decodeHiveSwitchSnapshot(value),value);
 for(const malformed of [{...value,current_scope:{...value.current_scope,profile_id:'missing'}},{...value,profiles:{...value.profiles,revision:-1}},{...value,actions:{...value.actions,can_cancel:'yes'}}])assert.throws(()=>decodeHiveSwitchSnapshot(malformed),/HIVE_SWITCH_REPLY_INVALID/);
});
test('target pairing and recovery use dedicated native commands with original transaction revision',async()=>{
 const calls:any[]=[];const client=createHiveSwitchClient(async(command,args)=>{calls.push({command,args});if(command==='hive_switch_start')return emptySnapshot();if(command.includes('recovery'))return {result:{recovery:{operation_id:'c'.repeat(48),revision:3,phase:'awaiting_confirmation',old_identity:null,new_identity:null,pairing:null,failure:null}}};return {result:{device:{state:'unbound'}}};});
 await client.start('https://target.example','Mac');await client.target.status();await client.target.begin('https://ignored.example','Mac');await client.target.recoveryConfirm('c'.repeat(48),3,'begin_pairing');
 assert.deepEqual(calls,[{command:'hive_switch_start',args:{origin:'https://target.example',name:'Mac'}},{command:'hive_switch_target_status',args:undefined},{command:'hive_switch_target_begin',args:{name:'Mac'}},{command:'hive_switch_target_recovery_confirm',args:{operationId:'c'.repeat(48),expectedRevision:3,decision:'begin_pairing'}}]);
});
