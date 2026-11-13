const clone=value=>structuredClone(value);
const stamp=()=>new Date().toISOString();
const problem=(code,message,check)=>Object.assign(new Error(message),{code,details:{check,observed_at:stamp(),evidence:{actual:message}}});

export function createPreviewNetworkSession({scene,origin,current,invoke,instance,context,applyNetwork}){
 const w=window;
 let fault='none',report=null,reportSequence=0,readFailed=scene==='diagnostics-read-failed',stayRunning=['diagnostics-running','diagnostics-read-failed'].includes(scene);
 w.__beeMockDiagnosticContext=()=>({reportId:report?.id??null});
 w.__beeMockControls['network-fault']=request=>{
  if(!current())throw problem('PREVIEW_SESSION_STALE','preview network condition session is no longer current; event rejected','preview_network_fault');
  if(!['none','save','apply','unknown'].includes(request.value))throw problem('PREVIEW_CONTROL_INVALID',`action=network-fault; value=${request.value}; required=none,save,apply,unknown`,'preview_network_fault');
  fault=request.value;
  return {message:`模拟网络条件已设为 ${fault}；请在正式页面操作或核对当前配置。`};
 };
 w.__beeMockControls['diagnostics-result']=request=>{
  if(!current())throw problem('PREVIEW_SESSION_STALE','preview diagnostic session is no longer current; event rejected','preview_diagnostics_result');
  if(!['completed','read-failed','available'].includes(request.value))throw problem('PREVIEW_CONTROL_INVALID',`action=diagnostics-result; value=${request.value}; required=completed,read-failed,available`,'preview_diagnostics_result');
  if(!report||request.reportId!==report.id)throw problem('PREVIEW_DIAGNOSTIC_STALE',`diagnostic event report id rejected: received=${request.reportId}; current=${report?.id??'none'}; required=current original report`,'preview_diagnostics_result');
  const state=context();
  if(report.run_id!==state.run_id||report.network_revision!==state.network_revision||report.binding_revision!==state.binding_revision)throw problem('PREVIEW_DIAGNOSTIC_CONTEXT_CHANGED',`diagnostic event context changed: report_run=${report.run_id} current_run=${state.run_id}; report_network=${report.network_revision} current_network=${state.network_revision}; report_binding=${report.binding_revision} current_binding=${state.binding_revision}`,'preview_diagnostics_result');
  readFailed=request.value==='read-failed';
  if(request.value==='completed'){stayRunning=false;if(report?.state==='running')report={...report,state:'completed',finished_at:stamp()};}
  return {message:`模拟诊断结果已设为 ${request.value}；请在正式页面核对原报告。`};
 };
 const readPreferences=async()=>{const value=await invoke('preferences_read',{});if(value.error)throw value.error;return value;};
 const scope=()=>{const state=context();return {origin:state.hive??origin,device:state.bound?(state.device_id??'fixture-device'):null};};
 const savedProxy=preferences=>{const current=scope();return preferences.proxies.find(entry=>entry.origin===current.origin&&entry.device_scope===current.device)?.connect_proxy??'';};
 const network=async(error=null)=>{
  const {preferences}=await readPreferences(),saved=savedProxy(preferences),effective=w.effectiveProxy??'';
  return {saved_revision:preferences.revision,effective_revision:w.networkRevision??0,saved_proxy:saved,effective_proxy:effective,paths:{relay:effective?'local_proxy':'direct',official:`openai=${effective?'local_proxy':'direct'};claude=${effective?'local_proxy':'direct'}`,hive:'process_environment',official_login:'official_client'},pending_restart:saved!==effective,error};
 };
 const reportChecks=()=>{
  const now=stamp();
  if(scene.startsWith('diagnostics-'))return [{id:'device',platform:null,status:'fail',code:'http_rejected',observed_at:now,evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:'invalid_device_credential'},next_action:'diagnostics'},{id:'source',platform:'openai',status:'fail',code:'source_missing',observed_at:now,evidence:{source_type:'file'},next_action:'accounts'},{id:'proxy',platform:null,status:'pass',code:'network_policy_observed',observed_at:now,evidence:{},next_action:'settings'}];
  return [{id:'hive',platform:null,status:'pass',code:'hive_identity_verified',observed_at:now,evidence:{method:'GET',path:'/api/bee/identity',http_status:'200'},next_action:'diagnostics'},{id:'source',platform:'claude',status:'skipped',code:'source_not_selected',observed_at:now,evidence:{selected:'false'},next_action:'accounts'}];
 };
 const commands=new Set(['network_snapshot','network_save_proxy','network_apply_saved','diagnostics_start','diagnostics_snapshot','diagnostics_cancel','diagnostics_export']);
 return {handles:command=>commands.has(command),async invoke(command,args){
  if(!current())throw problem('PREVIEW_SESSION_STALE','preview network session is no longer current; request rejected',command);
  w.calls.push({command,args});
  if(command==='network_snapshot')return network();
  if(command==='network_save_proxy'){
   const {preferences}=await readPreferences();
   if(args.expectedRevision!==preferences.revision)throw problem('PREFERENCES_REVISION_CONFLICT',`proxy save rejected: expected_revision=${args.expectedRevision} current_revision=${preferences.revision}`,'network_save_proxy');
   if(fault==='save')throw problem('PREFERENCES_WRITE_FAILED','proxy private file publish failed: kind=PermissionDenied os_code=13; saved preferences unchanged','network_save_proxy');
   const currentScope=scope(),deviceScope=currentScope.device,target=context().bound?currentScope.origin:args.origin;
   if(!target)throw problem('PREFERENCES_ORIGIN_REQUIRED','proxy draft save rejected: origin=null; required=explicit draft Hive origin','network_save_proxy');
   const proxies=preferences.proxies.filter(entry=>!(entry.origin===target&&entry.device_scope===deviceScope));
   proxies.push({origin:target,device_scope:deviceScope,connect_proxy:args.proxy});
   const saved=await invoke('preferences_save',{request:{expected_revision:preferences.revision,preferences:{...preferences,proxies}}});
   if(saved.error)throw saved.error;
   return saved;
  }
  if(command==='network_apply_saved'){
   if(args.confirmed!==true)return network({code:'NETWORK_CONFIRMATION_REQUIRED',message:'network restart was not explicitly confirmed; confirmed=false; contribution unchanged'});
   const state=context();
   if(!state.bound)throw problem('NETWORK_DEVICE_REQUIRED','applying a contribution proxy requires a verified paired device; bound=false','network_apply_saved');
   const {preferences}=await readPreferences(),proxy=savedProxy(preferences);
   if(fault==='apply')return network({code:'NETWORK_RUNTIME_UNCONFIRMED',message:'runtime observation failed before network stop: runtime_snapshot response unavailable; configuration and contribution unchanged',details:{check:'network_observe',observed_at:stamp(),evidence:{actual:'runtime_snapshot unavailable',required:'confirmed current owned runtime before stop'}}});
   if(proxy!==(w.effectiveProxy??''))applyNetwork({proxy,revision:Math.max((w.networkRevision??0)+1,preferences.revision)});
   if(fault==='unknown'){fault='none';throw problem('RESPONSE_TIMEOUT','RESPONSE_TIMEOUT: network_apply_saved response lost; submitted=true; result=unconfirmed; read current network and runtime state','network_apply_saved');}
   return network();
  }
  if(command==='diagnostics_start'){
   const state=context(),now=stamp(),finished=scene.startsWith('diagnostics-')&&!['diagnostics-running','diagnostics-read-failed'].includes(scene);
   report={id:(++reportSequence).toString(16).padStart(48,'0'),instance,run_id:state.run_id,network_revision:state.network_revision,binding_revision:state.binding_revision,started_at:now,finished_at:finished?now:null,state:finished?'completed':'running',checks:reportChecks()};
  }
  else {
   if(!report||(args.id??args.reportId)!==report.id)return {instance,result:{error:{code:'DIAGNOSTICS_OPERATION_FAILED',message:`diagnostic report id rejected: received=${args.id??args.reportId}; current=${report?.id??'none'}; required=current original report`}}};
   const state=context();
   if(report.run_id!==state.run_id||report.network_revision!==state.network_revision||report.binding_revision!==state.binding_revision)return {instance,result:{error:{code:'DIAGNOSTICS_OPERATION_FAILED',message:`diagnostic report context changed: report_run=${report.run_id} current_run=${state.run_id}; report_network=${report.network_revision} current_network=${state.network_revision}; report_binding=${report.binding_revision} current_binding=${state.binding_revision}`}}};
  }
  if(command==='diagnostics_snapshot'&&readFailed)throw problem('REPORT_READ_FAILED',`REPORT_READ_FAILED: original report read failed; report_id=${report.id}; actual=preview read unavailable; required=readable original report`,'diagnostics_snapshot');
  if(command==='diagnostics_snapshot'&&report.state==='running'&&!stayRunning)report={...report,state:'completed',finished_at:stamp()};
  if(command==='diagnostics_cancel'&&report.state==='running')report={...report,state:'cancelled',finished_at:stamp()};
  if(command==='diagnostics_export')return {product:'Bee',app_version:'0.1.0',bee_version:'dev',os:'darwin',arch:'arm64',report:clone(report),logs:args.includeLogs?[{time:report.started_at,level:'info',module:'diagnostics',platform:null,code:'hive_identity_verified',evidence:{method:'GET'}}]:[],truncated:false,truncated_sections:[]};
  const captured=clone(report);
  if(w.diagnosticDelay)await new Promise(resolve=>setTimeout(resolve,w.diagnosticDelay));
  return {instance,result:{report:captured}};
 }};
}
