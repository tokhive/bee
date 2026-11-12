const clone=v=>structuredClone(v),stamp=()=>new Date().toISOString();
const sourceId='1'.repeat(32),targetId='2'.repeat(32),targetInstance='b'.repeat(32);
const identity={id:'target-device',name:'Target Mac',owner_id:'target-owner',owner_email:'target-owner@example.test'};
const failure=(code,message)=>({code,message,details:{check:'hive_switch_target',observed_at:stamp(),evidence:code==='invalid_device_credential'?{http_status:'401',path:'/api/bee/identity',remote_code:code}:{actual:message}}});
const replyError=(code,message)=>({result:{error:failure(code,message)}});
export function createPreviewSwitchSession({scene,origin,instance,original,current,onCommit,onInitial}){
 const w=window,first=scene==='switch-first-launch',targetRecovery=scene==='switch-target-recovery';
 const profile=(id,url)=>({id,origin:url,raw_origin:url,binding_revision:1,binding_digest:null,blockers:[]});
 let profiles=first?[]:[profile(sourceId,origin),profile(targetId,'https://target-hive.example')],currentProfile=first?null:sourceId,indexRevision=first?0:1,committedOperation=null;
 let operationNumber=0,currentInstance=instance;
 const sourceIdentity={id:'dev-1',name:'Bee Desktop',owner_id:'owner-1',owner_email:'owner@example.test'};
 const identities=new Map([[sourceId,sourceIdentity]]);
 let operation=null,paused=false,flow=false,round=0,targetView={state:'unbound'},recovery=null,approved=false,revoked=targetRecovery,observations=0,targetProfile=targetId;
 const leg=id=>({profile:id,binding_revision:1,binding_digest:null,instance:id===currentProfile?currentInstance:targetInstance,process_binding_revision:1,network_revision:0,operation:null,seal:null,release:null,status:null,pending:null,workers_stopped:false,child_reaped:false,ipc_empty:false,verified:false});
 const beginOperation=(phase='preparing_target')=>({version:1,id:'e'.repeat(46)+(++operationNumber).toString(16).padStart(2,'0'),source:leg(currentProfile??sourceId),target:leg(targetProfile),phase,source_index_operation:null,commit_revision:null,committed:false,cancel_requested:false,quit_requested:false,observation_round:1,observation_started:stamp(),query_failures:0,observation_last:null,observation_blocked:false,failure:null});
 const commit=()=>{currentProfile=operation.target.profile;currentInstance=operation.target.instance;indexRevision++;committedOperation=operation.id;operation.committed=true;operation.commit_revision=indexRevision;const savedIdentity=identities.get(currentProfile)??identity;identities.set(currentProfile,savedIdentity);onCommit({profile_id:currentProfile,hive:profiles.find(p=>p.id===currentProfile).origin,identity:savedIdentity,instance:currentInstance});};
 if(scene.startsWith('switch-')&&!first&&scene!=='switch-saved'){
  operation=beginOperation(({'switch-waiting':'draining_source','switch-unknown':'draining_source','switch-paused':'draining_source','switch-handoff':'connecting_target','switch-success':'succeeded','switch-account-error':'succeeded','switch-failed':'failed','switch-cancelled':'cancelled'}[scene])??'preparing_target');
  if(operation.phase==='draining_source')operation.source.status={current:{work:scene==='switch-unknown'?null:{executions:2,unknown_terminations:1,unsettled:1}}};
  if(scene==='switch-unknown'){operation.source.pending='drain_begin';operation.failure=failure('RESPONSE_TIMEOUT','GET original device-drain result unavailable; original operation retained');}
  if(scene==='switch-paused')paused=true;
  if(scene==='switch-handoff'){operation.source.child_reaped=true;operation.source.workers_stopped=true;operation.source.ipc_empty=true;}
  if(['switch-success','switch-account-error'].includes(scene))commit();
 }
 const pending=()=>!!operation&&!['succeeded','failed','cancelled'].includes(operation.phase);
 const scope=()=>first&&!currentProfile||operation?.source.child_reaped&&!operation.committed?null:{profile_id:currentProfile,instance:currentInstance};
 const snapshot=()=>({profile_identities:profiles.filter(p=>identities.has(p.id)).map(p=>({profile_id:p.id,name:identities.get(p.id).name,owner_id:identities.get(p.id).owner_id,owner_email:identities.get(p.id).owner_email})),profiles:{version:1,revision:indexRevision,profiles:clone(profiles),current_profile:currentProfile,committed_operation:committedOperation,migration_id:null,migration_blockers:[],historical_conflicts:[]},operation:clone(operation),observation:{state:pending()?(paused?'paused':'observing'):'idle',reason:paused?'本轮自动观察已到 60 秒；原切换仍保留。':null,next_query_at:pending()&&!paused?new Date(Date.now()+2000).toISOString():null},actions:{can_cancel:pending()&&!operation.committed&&!operation.cancel_requested,can_continue:pending()&&paused,can_observe:pending()&&!paused,target_pairing:pending()&&operation.phase==='preparing_target'},current_scope:scope()});
 const targetURL=()=>profiles.find(p=>p.id===(operation?.target.profile??targetProfile)).origin;
 const targetIdentity=()=>identities.get(operation?.target.profile??targetProfile)??identity;
 const targetDevice=()=>({state:'bound',hive:targetURL(),name:targetIdentity().name,identity:targetIdentity()});
 const advanceTarget=()=>{if(!approved)return;approved=false;if(recovery){recovery={...recovery,revision:recovery.revision+1,phase:'awaiting_owner_confirmation',new_identity:identity};}else {targetView=targetDevice();identities.set(operation.target.profile,targetView.identity);}};
 const nextPhase=()=>{
  if(!flow||paused||!pending())return;
  if(operation.phase==='preparing_target'){if(revoked||recovery&&recovery.phase!=='completed'||targetView.state!=='bound')return;operation.phase='draining_source';operation.source.status={current:{work:{executions:2,unknown_terminations:1,unsettled:1}}};return;}
  if(operation.phase==='draining_source'){if(++observations<2)return;operation.source.status={current:{work:{executions:0,unknown_terminations:0,unsettled:0}}};operation.phase='stopping_source';return;}
  if(operation.phase==='stopping_source'){operation.source.child_reaped=true;operation.source.workers_stopped=true;operation.source.ipc_empty=true;operation.phase='connecting_target';return;}
  if(operation.phase==='connecting_target'){commit();operation.phase='releasing_target';return;}
  if(operation.phase==='releasing_target')operation.phase='succeeded';
 };
 const handles=command=>command.startsWith('hive_switch_')||command==='bridge_status'||first&&!currentProfile&&['startup_status','startup_recheck','device_begin'].includes(command)||scope()===null&&['startup_status','startup_recheck','device_status','device_context','runtime_snapshot','device_recovery_status','bridge_pending_requests'].includes(command)||currentProfile!==sourceId&&['device_context','device_status','device_recovery_status','startup_status','startup_recheck','bridge_pending_requests'].includes(command);
 return {handles,scope,snapshot,async invoke(command,args={}){
  if(!current())throw new Error('PREVIEW_SESSION_STALE: switch request belongs to an old fixture');
  if(command==='bridge_status'){const status=await original(command,args);const s=scope();return s?{...status,profile_id:s.profile_id,metadata:{...status.metadata,instance:s.instance}}:{state:'failed',profile_id:currentProfile,error:{code:'HIVE_PROFILE_REQUIRED',message:currentProfile?'Current child safely reaped; durable switch still pending':'No current Hive profile; enter Hive address and device name'}};}
  if(first&&!currentProfile){if(command==='device_begin'){const result=await onInitial(args);profiles=[profile(sourceId,args.hive)];currentProfile=sourceId;indexRevision++;return result;}if(command==='startup_status'||command==='startup_recheck')throw {code:'HIVE_PROFILE_REQUIRED',message:'No current Hive; device_begin is required'};}
  if(command.startsWith('hive_switch_')){
   w.calls.push({command,args});
   if(command==='hive_switch_snapshot')return snapshot();
   if(command==='hive_switch_start'){
    if(pending())return snapshot();let url;try{url=new URL(args.origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();}catch{throw {code:'HIVE_ORIGIN_INVALID',message:'Hive address rejected: '+args.origin+'; required=HTTPS service origin'};}
    const saved=profiles.find(p=>p.origin===url.origin);if(saved?.id===currentProfile)throw {code:'HIVE_SWITCH_SAME_PROFILE',message:'Hive already current: '+url.origin};
    targetProfile=saved?.id??String(profiles.length+1).repeat(32);if(!saved){profiles.push(profile(targetProfile,url.origin));indexRevision++;}operation=beginOperation();observations=0;paused=false;flow=true;recovery=null;approved=false;targetView=identities.has(targetProfile)?targetDevice():{state:'unbound'};return snapshot();
   }
   if(command==='hive_switch_observe'){advanceTarget();nextPhase();return snapshot();}
   if(command==='hive_switch_continue'){paused=false;flow=true;round++;operation.observation_round++;operation.source.pending=null;operation.failure=null;return snapshot();}
   if(command==='hive_switch_cancel'){if(pending()&&!operation.committed){operation.cancel_requested=true;operation.phase='cancelled';operation.source.child_reaped=false;}return snapshot();}
   if(command==='hive_switch_quit'){if(args.decision==='continue_waiting'){paused=false;flow=true;return snapshot();}operation.quit_requested=true;operation.cancel_requested=true;return snapshot();}
   if(command==='hive_switch_target_status'){advanceTarget();return revoked?replyError('invalid_device_credential','GET /api/bee/identity HTTP 401 invalid_device_credential; target Hive does not accept saved credential'):{result:{device:clone(targetView)}};}
   if(command==='hive_switch_target_begin'){targetView={state:'pending',hive:targetURL(),name:args.name,user_code:'ABCD-EFGH',verification_url:targetURL()+'/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+600000).toISOString(),poll_interval_seconds:2};return {result:{device:clone(targetView)}};}
   if(command==='hive_switch_target_recovery_prepare'){recovery??={operation_id:'c'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:{...identity,owner_email:'last-target-owner@example.test',owner_id:'last-target-owner'},new_identity:null,pairing:null,failure:failure('invalid_device_credential','Target Hive rejects saved credential')};return {result:{recovery:clone(recovery)}};}
   if(command==='hive_switch_target_recovery_status'){advanceTarget();return recovery?{result:{recovery:clone(recovery)}}:replyError('DEVICE_RECOVERY_NONE','No target credential recovery transaction exists');}
   if(command==='hive_switch_target_recovery_confirm'){
    if(args.operationId!==recovery?.operation_id||args.expectedRevision!==recovery?.revision)return replyError('DEVICE_RECOVERY_PRECONDITION','Target recovery confirmation has stale transaction revision');
    if(args.decision==='adopt_owner'){recovery={...recovery,phase:'completed',revision:recovery.revision+1,failure:null};revoked=false;targetView=targetDevice();identities.set(operation.target.profile,targetView.identity);}
    else recovery={...recovery,phase:'pending',revision:recovery.revision+1,pairing:{code:'ABCD-EFGH',verification_url:targetURL()+'/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+600000).toISOString()},failure:null};
    return {result:{recovery:clone(recovery)}};
   }
   if(command==='hive_switch_target_open'){approved=true;return recovery?{result:{recovery:clone(recovery)}}:{result:{device:clone(targetView)}};}
   throw new Error('MOCK_COMMAND_UNKNOWN: command='+command+'; required=registered Hive switch command');
  }
  if(scope()===null)throw {code:'HIVE_SWITCH_CURRENT_UNAVAILABLE',message:'Source child reaped; target handoff pending; ordinary commands unavailable'};
  if(currentProfile!==sourceId){
   if(command==='device_status')return {result:{device:{state:'bound',hive:profiles.find(p=>p.id===currentProfile).origin,name:identities.get(currentProfile).name,identity:identities.get(currentProfile)}}};
   if(command==='device_context')return {result:{context:{hive:targetURL(),name:identity.name,device_id:identity.id,owner_id:identity.owner_id,binding_revision:1}}};
   if(command==='device_recovery_status')return replyError('DEVICE_RECOVERY_NONE','No current recovery transaction');
   if(command==='bridge_pending_requests')return {instance:targetInstance,requests:[]};
   if(command==='startup_status'||command==='startup_recheck')return {state:'ready',failure:null,instance:targetInstance,binding_revision:1,network_revision:0,observed_at:stamp(),revision:1};
  }
  return original(command,args);
 }};
}
