export function accountFixture(platform) {
 const fact=state=>({state,fingerprint:null,observed_at:null,error:null});
 return {platform,operation:null,login_maintenance:null,revision:1,candidate:{state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null},selection:fact('not_selected'),hive:{...fact('unbound'),pending_fingerprint:null,generation:null},authorization:fact('not_checked'),capabilities:['official','hive'].map(origin=>({origin,status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null})),features:Object.fromEntries(['detect','check','select','confirm_change','remove','clear_selection','authorize','system_notifications'].map(k=>[k,{available:['detect','check'].includes(k),reason:['detect','check'].includes(k)?null:k==='remove'?'runtime_drain_and_detach_required':'runtime_ownership_and_source_barrier_required'}])),issues:[],checked_at:null};
}
export function installAccountFixture({accounts, runtimeEnabled=false,scenarios={},initialPreferences={}}){
 const w=window;w.isTauri=true;w.calls=[];w.delay=0;w.fail='';w.paused={openai:false,claude:true};
 w.__beeMockControls={};
 w.__beeMockControls['notification-permission']=request=>{
  if(!['prompt','granted','denied'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=notification-permission; value=${request.value}; required=prompt,granted,denied`);
  w.notificationPermission=request.value;
  return {message:`模拟通知系统权限已设为 ${request.value}；请在正式页面重新检查系统状态。`};
 };
 w.__beeMockControls['autostart-registration']=request=>{
  if(!['available','fail'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=autostart-registration; value=${request.value}; required=available,fail`);
  w.autostartRegistration=request.value;w.autostartQueryError=null;
  return {message:`模拟自启注册条件已设为 ${request.value}；请在正式页面重新操作启动选项。`};
 };
 w.accountScenarios=scenarios;
 let callback=0,bridgeSequence=0,instance='b'.repeat(32);
 let runtimeRevision=0,local='stopped',operation=null,connection='connected',runtimeUnknownNext=false,runtimeNetworkUnavailable=false,activeRun='a'.repeat(32);
 const runtimeRunId=()=>['starting','running','stopping'].includes(local)?activeRun:null;
 w.__beeMockRuntimeLocal=()=>local;
 w.__beeMockRuntimeContext=()=>({run_id:runtimeRunId(),network_revision:w.networkRevision??0,binding_revision:w.bindingRevision??1,revision:runtimeRevision});
 w.__beePreviewBindingChanged=({bound})=>{local='stopped';connection=bound?'connected':'disconnected';operation=null;runtimeRevision++;};
 w.__beeMockControls['runtime-connection']=request=>{
  if(!['online','offline','connecting','rejected','occupied'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=runtime-connection; value=${request.value}; required=online,offline,connecting,rejected,occupied`);
  connection=({online:'connected',offline:'reconnecting'}[request.value])??request.value;runtimeNetworkUnavailable=request.value==='offline';runtimeRevision++;
  return {message:`模拟 Hive 连接已设为 ${request.value}；正式页面将在下一次只读核对时更新。`};
 };
 w.__beeMockControls['runtime-write-result']=request=>{
  if(!['confirmed','unknown-next'].includes(request.value))throw new Error(`PREVIEW_CONTROL_INVALID: action=runtime-write-result; value=${request.value}; required=confirmed,unknown-next`);
  runtimeUnknownNext=request.value==='unknown-next';return {message:runtimeUnknownNext?'下一次贡献启停将提交后丢失回执；正式页面只读核对原操作。':'贡献启停回执已恢复正常。'};
 };
 const runtimeError=message=>({instance,result:{error:{code:'RUNTIME_OPERATION_FAILED',message}}});
 const runtimeConnectionDetail=()=>{
  if(!['reconnecting','connecting','rejected','occupied'].includes(connection))return null;
  const status=connection==='rejected'?'401':connection==='occupied'?'409':null;
  return {failure:{code:status?'http_rejected':connection==='reconnecting'?'connection_closed':'timeout',stage:connection==='reconnecting'?'heartbeat':'connect',occurred_at:new Date().toISOString(),message:status?`Hive connection rejected: HTTP ${status}; preview ${connection}`:connection==='reconnecting'?'Preview websocket heartbeat connection closed':'Preview connection attempt is in flight',evidence:{...(status?{http_status:status}:{}),path:'/api/bee/connect'}},retry:status?'halted':connection==='reconnecting'?'scheduled':'attempting',next_retry_at:connection==='reconnecting'?new Date(Date.now()+12000).toISOString():null};
 };
 let preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[],...initialPreferences};
 let diagnostic=null,diagnosticSequence=0;
 if(runtimeEnabled)for(const a of Object.values(accounts))for(const key of ['select','clear_selection','confirm_change','authorize'])a.features[key]={available:true,reason:null};
 for(const [platform,features]of Object.entries(scenarios.features??{}))Object.assign(accounts[platform].features,features);
 const op=(kind,platform,revision,state='succeeded')=>({id:(kind==='authorize'?'d':kind==='stop'?'e':'c').repeat(48),kind,platform,state,revision,error:null});
 const finishLogins=()=>{if(w.loginComplete)for(const job of loginJobs.values())if(['pending','running'].includes(job.operation.state))finishAuthorization(job,w.accountScenarios.loginOutcome?.state==='failed'?'failed':'succeeded',w.accountScenarios.loginOutcome?.error);};
 w.accounts=accounts;
 const accountSources=new Map(),detectedSources={};
 const defaultDirectory=p=>p==='openai'?'/tmp/codex':'/tmp/claude';
 const sourceKey=(p,source)=>JSON.stringify([p,source.directory??defaultDirectory(p),source.store==='auto'?'file':source.store]);
 const sourceValue=p=>accounts[p].candidate.state==='source_missing'?'missing':accounts[p].candidate.error?.evidence.permission_denied==='true'?'denied':'available';
 const sourceDefaults=Object.fromEntries(['openai','claude'].map(p=>[p,sourceValue(p)]));
 const emptyOfficial=p=>({...accounts[p].capabilities[0],status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null});
 for(const p of ['openai','claude']){
  const candidate=accounts[p].candidate,source=candidate.source??{directory:null,store:'file'};
  accountSources.set(sourceKey(p,source),{value:sourceValue(p),revision:1,fingerprint:candidate.fingerprint??(p==='openai'?'b':'c').repeat(64),expires_at:candidate.expires_at??'2099-01-01T00:00:00Z',official:scenarios.previewSources?structuredClone(accounts[p].capabilities[0]):null});
  if(candidate.reference)detectedSources[p]={key:sourceKey(p,source),revision:1};
 }
 const sourceRecord=(p,source)=>accountSources.get(sourceKey(p,source))??{value:sourceDefaults[p],revision:0,fingerprint:(p==='openai'?'b':'c').repeat(64),expires_at:'2099-01-01T00:00:00Z',official:scenarios.previewSources?emptyOfficial(p):null};
 const currentSources=Object.fromEntries(['openai','claude'].map(p=>[p,accounts[p].candidate.source??{directory:null,store:p==='openai'?'file':'keychain'}]));
 w.__beeMockAccountContext=()=>Object.fromEntries(['openai','claude'].map(p=>{
  const a=accounts[p],active=!!a.operation&&['pending','running','reconciling'].includes(a.operation.state);
  return [p,{selected:a.selection.state==='selected',candidate:a.candidate.state,changed:!!a.selection.fingerprint&&!!a.candidate.fingerprint&&a.selection.fingerprint!==a.candidate.fingerprint,preparing:a.authorization.state==='preparing',paused:!!w.paused[p],source:currentSources[p],sourceCondition:sourceRecord(p,currentSources[p]).value,active,loginOperation:a.operation?.kind==='authorize'&&['pending','running'].includes(a.operation.state)?a.operation.id:null,refreshAllowed:a.selection.state==='selected'&&!!a.candidate.source&&!active}];
 }));
 const accountControls=w.__beeMockControls;
 accountControls['account-source']=request=>{
  const {platform,directory,store,value}=request;
  if(!['openai','claude'].includes(platform))throw new Error(`PREVIEW_ACCOUNT_PLATFORM_INVALID: platform=${platform}; required=openai or claude`);
  if(!['available','missing','denied'].includes(value))throw new Error(`PREVIEW_SOURCE_VALUE_INVALID: value=${value}; required=available, missing or denied`);
  if(directory!==null&&(typeof directory!=='string'||!directory.startsWith('/')||/[\u0000-\u001f\u007f]/.test(directory)))throw new Error(`PREVIEW_SOURCE_DIRECTORY_INVALID: absolute=${typeof directory==='string'&&directory.startsWith('/')}; required=null or absolute directory`);
  if(!(platform==='openai'?['auto','file','keyring']:['file','keychain']).includes(store))throw new Error(`PREVIEW_SOURCE_STORE_INVALID: platform=${platform}; store=${store}; required=supported platform store`);
  const source={directory,store},record=sourceRecord(platform,source);
  accountSources.set(sourceKey(platform,source),{...record,value,revision:record.revision+1});
  const job=loginJobs.get(accounts[platform].operation?.id);
  if(job&&['pending','running'].includes(job.operation.state)&&sourceKey(platform,job.source)===sourceKey(platform,source))finishAuthorization(job,'failed',publicAccountFailure(platform,'source_changed','official_source_recheck',`official login source changed: previous_revision=${job.sourceRevision}; current_revision=${record.revision+1}; required=unchanged source namespace during the current operation`,{source_revision_match:'false'}));
  return {message:`${platform==='openai'?'OpenAI':'Claude'} 来源已设为${{available:'可读取',missing:'缺失',denied:'拒绝读取'}[value]}；重新读取所选来源后可核对。`};
 };
 const detectAccount=request=>{
  currentSources[request.platform]={directory:request.directory??null,store:request.store};
  const {platform,mode}=request,a=structuredClone(accounts[platform]),source={directory:request.directory,store:request.store==='auto'?'file':request.store},record=sourceRecord(platform,source),official=mode==='official';
  a.revision++;a.checked_at=new Date().toISOString();
  const condition=w.fail===platform?'denied':record.value;
  if(condition!=='available'){
   const denied=condition==='denied',code=denied?'permission_denied':'source_missing';
   const error={code,check:'source_read',platform,message:`source_read ${denied?'permission_denied':'not_found'}=true; directory=${source.directory??defaultDirectory(platform)}; store=${source.store}; required=readable current source`,evidence:{[denied?'permission_denied':'not_found']:'true'}};
   a.candidate={state:code,reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:a.checked_at,error};
   a.authorization={state:code,fingerprint:null,observed_at:a.checked_at,error};delete detectedSources[platform];
   a.capabilities[0]=emptyOfficial(platform);
  }else{
   const cached=a.candidate.identity_verified&&detectedSources[platform]?.key===sourceKey(platform,source)&&detectedSources[platform]?.revision===record.revision;
   a.candidate={state:'available',reference:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16),source,fingerprint:platform==='openai'||official||cached?record.fingerprint:null,plan:platform==='openai'?'plus':'pro',expires_at:w.expiry??record.expires_at,identity_verified:official||cached,observed_at:a.checked_at,error:null};
   a.authorization={state:official||cached?'official_identity_verified':'local_structure_only',fingerprint:a.candidate.fingerprint,observed_at:a.checked_at,error:null};
   if(official&&w.missingProfile){a.candidate.identity_verified=false;a.authorization.error={code:'missing_scope',check:'official_scopes',platform,message:'official check requires user:profile',evidence:{profile_scope:'false',inference_scope:'true'}};}
   a.hive.state='unconfirmed';
   if(w.accountScenarios.candidates?.[platform])a.candidate={...a.candidate,...structuredClone(w.accountScenarios.candidates[platform])};
   detectedSources[platform]={key:sourceKey(platform,source),revision:record.revision};
   if(official||cached)a.capabilities[0]=record.official?structuredClone(record.official):{...a.capabilities[0],status:'ready',observed_at:a.checked_at,metadata_observed_at:a.checked_at,valid_until:new Date(Date.now()+360000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:120,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:null,reset_at:null},...(platform==='claude'?[{scope:'opus',seconds:604800,used_percent:100,reset_at:'2099-01-01T00:00:00Z'}]:[])],models:[{id:platform==='openai'?'gpt-5.4':'claude-opus-4-6',account_supported:true,market_open:null,accepting:null}]};
   else a.capabilities[0]=emptyOfficial(platform);
  }
  accounts[platform]=a;return a;
 };
 const loginJobs=new Map();
 const publicAccountFailure=(p,code,check,message,evidence={})=>({platform:p,code,check,message,evidence});
 const commandFailure=(kind,code,check,actual,required)=>({instance,result:{error:{code:kind==='authorize'?'AUTHORIZE_OPERATION_FAILED':'ACCOUNT_OPERATION_FAILED',message:`${code}: check=${check}; actual=${actual}; required=${required}`}}});
 const freshID=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16);
 const finishAuthorization=(job,value,failure,identity)=>{
  const p=job.platform;
  if(accounts[p].operation?.id!==job.operation.id||!['pending','running'].includes(job.operation.state))throw new Error(`PREVIEW_LOGIN_STALE: platform=${p}; operation=${job.operation.id}; current=${accounts[p].operation?.id??'none'}; state=${job.operation.state}; required=current active login`);
  const currentSource=sourceRecord(p,job.source);
  if(value==='succeeded'&&currentSource.revision!==job.sourceRevision)throw new Error(`PREVIEW_LOGIN_STALE: platform=${p}; operation=${job.operation.id}; source_revision=${currentSource.revision}; required_source_revision=${job.sourceRevision}`);
  if(value==='succeeded'&&currentSource.value==='denied'){
   value='failed';failure=publicAccountFailure(p,'permission_denied','official_source_recheck',`official login exited but source_read permission_denied=true; store=${job.source.store}; required=readable current login source`,{permission_denied:'true'});
  }
  if(value==='succeeded'){
   const record=sourceRecord(p,job.source);
   accountSources.set(sourceKey(p,job.source),{...record,value:'available',revision:record.revision+1,fingerprint:identity==='same'?(accounts[p].selection.fingerprint??record.fingerprint):(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),expires_at:'2099-01-01T00:00:00Z',official:scenarios.previewSources?emptyOfficial(p):null});
   detectAccount({platform:p,...job.source,mode:'official'});
  }else{
   accounts[p].candidate={...accounts[p].candidate,state:'not_checked',reference:null,source:null,fingerprint:null,identity_verified:false,error:null};delete detectedSources[p];
  }
  const a=accounts[p];
  job.operation={...job.operation,state:value==='succeeded'?'succeeded':value==='cancelled'?'cancelled':'failed',revision:++a.revision,error:failure??(value==='failed'?publicAccountFailure(p,'authorization_process_failed','official_process','official login process failed: exit_code=1; required=successful current process exit',{confirmed:'false'}):null)};
  a.operation=structuredClone(job.operation);
  return structuredClone(job.operation);
 };
 if(scenarios.autoService)accountControls['account-refresh']=request=>{
  const p=request.platform,a=accounts[p];
  if(request.value!=='same-account'||!a||a.selection.state!=='selected'||!a.candidate.source||a.operation&&['pending','running','reconciling'].includes(a.operation.state))throw new Error(`PREVIEW_REFRESH_BLOCKED: platform=${p}; selected=${a?.selection.state}; source=${!!a?.candidate.source}; required=selected readable account without active operation`);
  detectAccount({platform:p,...a.candidate.source,mode:'official'});
  return {message:'已模拟同账号后台刷新，接单选择保持不变。'};
 };
 accountControls['login-result']=request=>{
  const {platform,operationId,value}=request,job=loginJobs.get(operationId);
  if(!['succeeded','succeeded-same','failed'].includes(value))throw new Error(`PREVIEW_LOGIN_RESULT_INVALID: value=${value}; required=succeeded, succeeded-same or failed`);
  if(!job||job.platform!==platform)throw new Error(`PREVIEW_LOGIN_STALE: platform=${platform}; operation=${operationId}; required=current owned login for the selected platform`);
  const result=finishAuthorization(job,value==='succeeded-same'?'succeeded':value,undefined,value==='succeeded-same'?'same':'different');
  if(scenarios.autoService&&result.state==='succeeded'&&accounts[platform].selection.state==='selected')return {message:value==='succeeded-same'?'原账号登录已核验，接单保持暂停。':'新身份已核验，等待确认换号。'};
  return {message:`${platform==='openai'?'OpenAI':'Claude'} 登录${result.state==='succeeded'?'已完成核验，仅生成候选，尚未接入':'失败；可在正式账号页核对具体原因后继续'}。`};
 };
 const authorizeCommand=async(command,args)=>{
  if(command==='authorize_start'){
   if(w.loginAdmissionDelay)await new Promise(r=>setTimeout(r,w.loginAdmissionDelay));
   const request=args.request,p=request.platform,a=accounts[p];
   if(a.operation&&['pending','running','reconciling'].includes(a.operation.state))return commandFailure('authorize','operation_pending','platform_operation',a.operation.state,'no active platform operation');
   if(request.expected_revision!==a.revision)return commandFailure('authorize','stale_revision','expected_revision',request.expected_revision,a.revision);
   const currentLocal=w.__beeMockRuntimeLocal?.()??local;
   if(!(scenarios.autoService?['stopped','waiting','failed','running']:['stopped','failed']).includes(currentLocal))return commandFailure('authorize','runtime_dependency','runtime_state',currentLocal,scenarios.autoService?'stopped, waiting, failed or running service':'stopped or failed contribution');
   if(p==='claude'&&request.source.store!=='keychain')return commandFailure('authorize','authorization_namespace_mismatch','official_namespace',request.source.store,'keychain on darwin');
   if(w.accountScenarios.unsupportedStores?.[request.source.store])return commandFailure('authorize','unsupported_store','official_namespace',request.source.store,'supported store');
   for(const [id,job]of loginJobs)if(job.platform===p)loginJobs.delete(id);
   if(scenarios.autoService)w.paused[p]=true;
   const operation={id:freshID(),kind:'authorize',platform:p,state:'running',revision:++a.revision,error:null};
   loginJobs.set(operation.id,{platform:p,source:structuredClone(request.source),sourceRevision:sourceRecord(p,request.source).revision,operation});
   a.operation=structuredClone(operation);a.candidate={...a.candidate,state:'not_checked',reference:null,source:null,fingerprint:null,identity_verified:false,error:null};delete detectedSources[p];
   return {instance,result:{operation:structuredClone(operation)}};
  }
  const job=loginJobs.get(args.operationId);
  if(!job)return commandFailure('authorize','operation_not_owned','operation_id',args.operationId,'latest owned login for its platform');
  if(command==='authorize_cancel'&&w.accountScenarios.cancelUnknown)throw Object.assign(new Error('cancel response lost; owned operation still unconfirmed'),{code:'RESPONSE_TIMEOUT'});
  if(command==='authorize_cancel'&&['pending','running'].includes(job.operation.state))finishAuthorization(job,'cancelled');
  if(command==='authorize_status')finishLogins();
  return {instance,result:{operation:structuredClone(job.operation)}};
 };
 const callbacks=new Map(),subscriptions=new Map();
 const status=()=>({state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance,capabilities:['runtime_inspect_recovery']}});
 const emit=(event,payload)=>{for(const [handler,name]of subscriptions)if(name===event)callbacks.get(handler)?.({payload});};
 w.emitRequestSettled=request=>emit('bee://request-settled',{instance,...request});
 w.emit=id=>{instance=id;emit('bee://bridge-status',status());};w.emitDownload=(url,success)=>emit('bee://download-finished',{url,success});
 w.downloadListenerCount=()=>[...subscriptions.values()].filter(name=>name==='bee://download-finished').length;
 w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event,id)=>{subscriptions.delete(id);callbacks.delete(id);}};
 const supply=p=>{const reasons=[...new Set([...(w.paused[p]?['manually_paused']:[]),...(local!=='running'||connection!=='connected'?['offline']:[]),...(accounts[p].selection.state!=='selected'?['not_configured']:[]),...(w.accountScenarios.reasons?.[p]??[])])];return {hive:'https://hive.example',device_id:'dev-1',platform:p,paused:w.paused[p],ready:reasons.length===0,reasons,checked_at:new Date().toISOString()};};
 const network=()=>{const saved=preferences.proxies[0]?.connect_proxy??'',effective=w.effectiveProxy??'';return {saved_revision:preferences.revision,effective_revision:w.networkRevision??0,saved_proxy:saved,effective_proxy:effective,paths:{relay:effective?'local_proxy':'direct',official:`openai=${effective?'local_proxy':'direct'};claude=${effective?'local_proxy':'direct'}`,hive:'process_environment',official_login:'official_client'},pending_restart:saved!==effective,error:null};};
 const preferenceError=()=>({code:'PREFERENCES_WRITE_FAILED',message:'private file publish failed: kind=PermissionDenied os_code=13'});
 w.__TAURI_INTERNALS__={transformCallback:fn=>{const id=++callback;callbacks.set(id,fn);return id;},unregisterCallback:id=>{callbacks.delete(id);},invoke:async(command,args={})=>{
  if(command==='plugin:event|listen'){subscriptions.set(args.handler,args.event);return args.handler;}if(command==='plugin:event|unlisten'){subscriptions.delete(args.eventId);return;}if(command==='bridge_status')return status();if(command==='bridge_pending_requests')return {instance,requests:w.pendingRequests??[]};
  if(command==='device_recovery_status')return {result:{error:{code:'DEVICE_RECOVERY_NONE',message:'no credential recovery transaction exists'}}};
  if(command==='device_context')return {instance,result:{context:{hive:'https://hive.example',name:'Fixture',device_id:'dev-1',owner_id:'owner-1',binding_revision:w.bindingRevision??1}}};
  if(command==='startup_status'||command==='startup_recheck')return {state:w.deviceFail?'blocked':'ready',failure:w.deviceFail?{code:'device_replaced',message:'HTTP 401 device_replaced'}:null,instance,binding_revision:w.bindingRevision??1,network_revision:w.networkRevision??0,observed_at:new Date().toISOString(),revision:1};
  if(command==='device_status'&&w.deviceFail)return {result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET identity HTTP 503'}}};
  if(command==='device_status')return {result:{device:{state:'bound',hive:'https://hive.example',name:'Fixture',identity:{id:'dev-1',name:'Fixture',owner_id:'owner-1',owner_email:'owner@example.test'}}}};
  w.calls.push({command,args});
  if(['device_begin','device_open','device_recovery_prepare','device_recovery_confirm'].includes(command))return {result:{error:{code:'DEVICE_SCENARIO_REQUIRED',message:`command=${command}; current_scene=shared account fixture; required=preview pairing or recovery scenario`}}};
  if(command==='bridge_request'){
   if(args.method!=='ping')throw new Error(`MOCK_BRIDGE_METHOD_REJECTED: method=${args.method}; required=ping`);
   return {protocol:1,id:String(++bridgeSequence),instance,result:{alive:true}};
  }
  if(command==='login_return_received')return w.loginReturned===true;
  if(['update_snapshot','update_check','update_download','update_install'].includes(command)){
   w.updateSnapshot??={operation_id:null,revision:0,state:'idle',current_version:'0.1.0',target_version:null,checked_at:null,downloaded_bytes:0,total_bytes:null,release_notes:null,error:null};
   if(command==='update_check')w.updateSnapshot={...w.updateSnapshot,operation_id:'fixture-update',revision:w.updateSnapshot.revision+1,state:'available',target_version:'0.2.0',checked_at:new Date().toISOString(),release_notes:'Fixture release notes'};
   if(command==='update_download')w.updateSnapshot={...w.updateSnapshot,revision:w.updateSnapshot.revision+1,state:'verified',downloaded_bytes:200,total_bytes:200};
   if(command==='update_install'){
    if(args.request.operation_id!==w.updateSnapshot.operation_id||args.request.expected_revision!==w.updateSnapshot.revision)throw new Error(`UPDATE_INSTALL_REJECTED: operation or revision differs; expected_revision=${args.request.expected_revision} actual_revision=${w.updateSnapshot.revision}`);
    w.updateSnapshot={...w.updateSnapshot,revision:w.updateSnapshot.revision+1,state:'stopping'};
   }
   return structuredClone(w.updateSnapshot);
  }
  if(command==='native_locale_sync')return null;
  if(['preferences_read','notification_permission','notification_delivery_status','autostart_status'].includes(command)){
   const failure=w.settingsReadFailures?.[command];if(w.settingsReadDelay)await new Promise(resolve=>setTimeout(resolve,w.settingsReadDelay));if(failure)throw failure;
  }
  if(command==='preferences_read')return structuredClone({preferences,error:null});
  if(command==='preferences_save'){
   if(args.request.expected_revision!==preferences.revision)return structuredClone({preferences,error:{code:'PREFERENCES_REVISION_CONFLICT',message:`preferences revision actual=${preferences.revision} required=${args.request.expected_revision}; refresh before saving`}});
   if(args.request.preferences.revision!==args.request.expected_revision||args.request.expected_revision>=Number.MAX_SAFE_INTEGER)return structuredClone({preferences,error:{code:'PREFERENCES_REVISION_CONFLICT',message:`save revision actual=${args.request.preferences.revision} expected=${args.request.expected_revision}; required=current revision below safe integer limit`}});
   if(w.preferencesFail)return structuredClone({preferences,error:preferenceError()});
   preferences=structuredClone({...args.request.preferences,revision:preferences.revision+1});return structuredClone({preferences,error:null});
  }
  if(command==='notification_permission')return w.notificationPermission??'prompt';
  if(command==='notification_enable'){if(!w.notificationPermission||w.notificationPermission==='prompt')w.notificationPermission='granted';return w.notificationPermission;}
  if(command==='notification_delivery_status')return {error:w.notificationDeliveryError??null,retryable_count:w.notificationRetryableCount??0,pending_count:w.notificationPendingCount??0,uncertain_count:w.notificationUncertainCount??0,check_sequence:w.notificationCheckSequence??0};
  if(command==='notification_retry'){
   if(w.notificationRetryDelay)await new Promise(resolve=>setTimeout(resolve,w.notificationRetryDelay));
   const count=w.notificationRetryableCount??0;w.notificationRetryableCount=0;w.notificationPendingCount=(w.notificationPendingCount??0)+count;
   if(w.notificationRetryUnknown)throw {code:'RESPONSE_TIMEOUT',message:'retry receipt unavailable; authorization result unconfirmed: request_id=17'};
   return {retryable_count:count};
  }
  if(command==='autostart_status')return {desired:preferences.autostart_desired,registered:w.autostartQueryError?null:w.autostartRegistered??false,error:w.autostartQueryError??null};
  if(command==='autostart_set'){
   if(w.preferencesFail)throw preferenceError();
   preferences={...preferences,revision:preferences.revision+1,autostart_desired:args.enabled};
   const error=w.autostartRegistration==='fail'?{code:'AUTOSTART_REGISTER_FAILED',message:`autostart register failed: desired=${args.enabled}; kind=PermissionDenied os_code=13; registration unchanged`}:null;
   if(!error)w.autostartRegistered=args.enabled;
   return {desired:args.enabled,registered:w.autostartQueryError?null:w.autostartRegistered??false,error:error??w.autostartQueryError??null};
  }
  if(command==='network_snapshot')return network();
  if(command==='network_save_proxy'){
   if(w.preferencesFail)return structuredClone({preferences,error:preferenceError()});
   preferences={...preferences,revision:preferences.revision+1,proxies:[{origin:args.origin??'https://hive.example',device_scope:'fixture-device',connect_proxy:args.proxy}]};return structuredClone({preferences,error:null});
  }
  if(command==='network_apply_saved'){w.effectiveProxy=preferences.proxies[0]?.connect_proxy??'';w.networkRevision=(w.networkRevision??0)+1;runtimeRevision++;return network();}
  if(command==='network_test')return {protocol:1,id:'fixture-network',instance,result:{network_test:{observed_at:new Date().toISOString(),checks:['local_proxy','openai_read_only','claude_read_only'].map(id=>({id,status:'ok',message:'read-only endpoint reachable',path:args.proxy?'local_proxy':'direct',http_status:id==='local_proxy'?null:200}))}}};
  if(command==='hive_open'){w.openedHive='https://hive.example/';return;}
  if(['diagnostics_start','diagnostics_snapshot','diagnostics_cancel','diagnostics_export'].includes(command)){
   if(command==='diagnostics_start'){
    const now=new Date().toISOString();diagnostic={id:(++diagnosticSequence).toString(16).padStart(48,'0'),instance,run_id:local==='running'?'a'.repeat(32):null,network_revision:w.networkRevision??0,binding_revision:w.bindingRevision??1,started_at:now,finished_at:null,state:'running',checks:[{id:'hive',platform:null,status:'pass',observed_at:now,code:'hive_identity_verified',evidence:{method:'GET',path:'/api/bee/identity',http_status:'200'},next_action:'diagnostics'},{id:'source',platform:'openai',status:'skipped',observed_at:now,code:'source_not_selected',evidence:{selected:'false'},next_action:'accounts'}]};
    const captured=structuredClone(diagnostic);if(w.diagnosticDelay)await new Promise(resolve=>setTimeout(resolve,w.diagnosticDelay));return {instance:captured.instance,result:{report:captured}};
   }
   if(command==='diagnostics_snapshot'&&!w.diagnosticsStayRunning){diagnostic={...diagnostic,state:'completed',finished_at:new Date().toISOString()};}
   if(command==='diagnostics_cancel')diagnostic={...diagnostic,state:'cancelled',finished_at:new Date().toISOString()};
   if(command==='diagnostics_export')return {product:'Bee',app_version:'0.1.0',bee_version:'dev',os:'darwin',arch:'arm64',report:structuredClone(diagnostic),logs:args.includeLogs?[{time:diagnostic.started_at,level:'info',module:'diagnostics',platform:null,code:'hive_identity_verified',evidence:{method:'GET'}}]:[],truncated:false,truncated_sections:[]};
   return {instance,result:{report:structuredClone(diagnostic)}};
  }
  if(command==='diagnostic_logs')return {entries:[{time:new Date().toISOString(),level:args.query.level??'info',module:args.query.module??'diagnostics',platform:args.query.platform,code:'hive_identity_verified',evidence:{method:'GET'}}],next_cursor:args.query.cursor?null:`v1:${'0'.repeat(32)}:2:1:${'a'.repeat(16)}`,truncated:false};
  if(['runtime_snapshot','runtime_start','runtime_stop'].includes(command)){
   if(command==='runtime_start'){
    const request=args.request??{};
    if(request.expected_revision!==runtimeRevision)return runtimeError(`runtime revision changed: actual=${runtimeRevision} expected=${request.expected_revision}`);
    if(!['stopped','failed'].includes(local))return runtimeError(`runtime start rejected: local=${local}; required=stopped or failed`);
    if(!Array.isArray(request.resume_platforms)||request.resume_platforms.length>2||new Set(request.resume_platforms).size!==request.resume_platforms.length||request.resume_platforms.some(p=>!['openai','claude'].includes(p)))return runtimeError('runtime resume list invalid: required=explicit list of unique known platforms');
    if(!Object.values(accounts).some(a=>a.selection.state==='selected'))return runtimeError('runtime start requires a persisted account selection: selections=0');
    const unselected=request.resume_platforms.find(p=>accounts[p].selection.state!=='selected');
    if(unselected)return runtimeError(`runtime resume requested for unselected platform=${unselected}`);
    const pending=Object.entries(accounts).find(([,a])=>a.operation&&['pending','running','reconciling'].includes(a.operation.state));
    if(pending)return runtimeError(`runtime start blocked: unresolved account operation platform=${pending[0]}; state=${pending[1].operation.state}`);
    const changed=Object.entries(accounts).find(([,a])=>a.selection.state==='selected'&&a.candidate.fingerprint&&a.candidate.fingerprint!==a.selection.fingerprint);
    if(changed)return runtimeError(`runtime account confirmation required: platform=${changed[0]}; candidate differs from persisted selection`);
    local='running';activeRun=crypto.randomUUID().replaceAll('-','');operation={...op('start',null,++runtimeRevision),id:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16)};
    for(const p of request.resume_platforms)w.paused[p]=false;
    if(w.runtimeUnknown||runtimeUnknownNext){runtimeUnknownNext=false;throw Object.assign(new Error(`RESPONSE_TIMEOUT: runtime_start response lost; submitted=true; operation_id=${operation.id}; result=unconfirmed`),{code:'RESPONSE_TIMEOUT'});}
    return {instance,result:{operation}};
   }
   if(command==='runtime_stop'){
    if(args.expectedRevision!==runtimeRevision)return runtimeError(`runtime revision changed: actual=${runtimeRevision} expected=${args.expectedRevision}`);
    if(local==='stopping')return runtimeError('runtime stop already in progress: local=stopping');
    local='stopped';operation={...op('stop',null,++runtimeRevision),id:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16)};
    if(runtimeUnknownNext){runtimeUnknownNext=false;throw Object.assign(new Error(`RESPONSE_TIMEOUT: runtime_stop response lost; submitted=true; operation_id=${operation.id}; result=unconfirmed`),{code:'RESPONSE_TIMEOUT'});}
    return {instance,result:{operation}};
   }
   if(w.accountScenarios.runtimeReadFailure)throw {code:'RESPONSE_TIMEOUT',message:'runtime snapshot response lost; shared runtime read unconfirmed',details:{check:'runtime_snapshot',observed_at:new Date().toISOString(),evidence:{actual:'no runtime response',required:'confirmed shared runtime snapshot'}}};
   finishLogins();w.runtimeReadCount=(w.runtimeReadCount??0)+1;return structuredClone({instance,result:{runtime:{run_id:runtimeRunId(),revision:runtimeRevision,network_revision:w.networkRevision??0,observed_at:new Date().toISOString(),local,connection,connection_detail:runtimeConnectionDetail(),legacy_stop:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:(w.runtimeAccounts??accounts)[p],supply:local==='running'&&connection==='connected'?supply(p):null,selection_revision:accounts[p].selection.state==='selected'?1:0}])),operation,stop_receipt:operation?.kind==='stop'?{workers_stopped:true,intent_saved:true,session_clean:true}:null}}});
  }
  if(['authorize_start','authorize_status','authorize_cancel'].includes(command))return authorizeCommand(command,args);
  if(['supply_status','supply_set_paused'].includes(command)){
   const p=args.platform;
   if(command==='supply_set_paused'){
    if(!['openai','claude'].includes(p)||typeof args.paused!=='boolean')return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:`supply request rejected: platform=${p}; paused_type=${typeof args.paused}; required=known platform and boolean pause`}}};
    if(!args.paused&&(local!=='running'||connection!=='connected'||accounts[p].selection.state!=='selected'))return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:`resume blocked: local=${local} connection=${connection} selection=${accounts[p].selection.state}; required=running connected selected platform=${p}`}}};
    const account=accounts[p];
    if(!args.paused&&account.operation&&['pending','running','reconciling'].includes(account.operation.state))return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:`resume blocked: platform=${p}; account_operation=${account.operation.state}; required=no pending account operation`}}};
    if(!args.paused&&account.candidate.fingerprint&&account.candidate.fingerprint!==account.selection.fingerprint)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:`resume blocked: account confirmation required; platform=${p}; candidate differs from persisted selection`}}};
    if(w.supplyFail===p)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:'PUT HTTP 503 result unconfirmed'}}};
    w.paused[p]=args.paused;
   }
   if(command==='supply_status'&&runtimeNetworkUnavailable)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:`GET supply_status HTTP 503; platform=${p}; preview upstream unavailable`,details:{check:'supply_status',observed_at:new Date().toISOString(),evidence:{failure_kind:'http_rejected',http_status:'503',method:'GET',platform:p}}}}};
   return {result:{supply:supply(p)}};
  }
  if(command==='account_defaults')return {instance,result:{defaults:{platforms:['openai','claude'].map(p=>({platform:p,directory:p==='openai'?'/tmp/codex':'/tmp/claude',default_store:p==='openai'?'file':'keychain',stores:(p==='openai'?['auto','file','keyring']:['file','keychain']).map(store=>({store,supported:!w.accountScenarios.unsupportedStores?.[store],reason:w.accountScenarios.unsupportedStores?.[store]??null}))}))}}};
  if(!['account_snapshot','account_detect','account_action'].includes(command))throw new Error(`MOCK_COMMAND_UNKNOWN: command=${command}; required=registered native command or supported event subscription`);
  const platform=args.request?.platform??args.platform,captured=instance;if(w.delay)await new Promise(r=>setTimeout(r,w.delay));
  if(command==='account_snapshot'&&w.accountScenarios.snapshotFailure===platform)throw {code:'RESPONSE_TIMEOUT',message:'account snapshot response lost; platform read unconfirmed',details:{check:'account_snapshot',observed_at:new Date().toISOString(),evidence:{actual:platform+' snapshot unavailable',required:'confirmed platform account snapshot'}}};
  if(command==='account_snapshot')finishLogins();const a=structuredClone(accounts[platform]);
  if(command==='account_detect'&&a.operation&&['pending','running','reconciling'].includes(a.operation.state))return commandFailure('account','operation_pending','platform_operation',a.operation.state,'no active platform worker before detection');
  if(command==='account_action'){
   const request=args.request;
   const continuation=request.action==='confirm_change'&&a.operation?.kind==='confirm_change'&&a.operation.state==='reconciling'&&a.operation.error?.code==='confirmation_not_submitted';
   if(!request.confirmed)return commandFailure('account','confirmation_required','confirmed',request.confirmed,'true');
   if(request.revision!==a.revision)return commandFailure('account','stale_revision','revision',request.revision,a.revision);
   if(a.operation&&['pending','running','reconciling'].includes(a.operation.state)&&!continuation)return commandFailure('account','operation_pending','platform_operation',a.operation.state,'no active platform worker or proven unsubmitted original confirmation');
   if(!a.features[request.action]?.available)return commandFailure('account','feature_unavailable','account_action',request.action,'available platform feature');
   if(request.action==='clear_selection'){
    if(a.selection.state!=='selected')return commandFailure('account','selection_missing','clear_selection',a.selection.state,'existing local selection');
   }else{
    if(!a.candidate.reference||request.candidate_ref!==a.candidate.reference)return commandFailure('account','stale_candidate','candidate_ref',request.candidate_ref,a.candidate.reference??'current candidate');
    if(a.candidate.state!=='available'||!a.candidate.source)return commandFailure('account','source_unavailable','candidate_source',a.candidate.state,'available current candidate with source');
    if(!a.candidate.expires_at||Date.parse(a.candidate.expires_at)<=Date.now()+30000)return commandFailure('account','expired','selection_source_expiry',a.candidate.expires_at,'expires_at > now+30s');
    const source=sourceRecord(platform,a.candidate.source),detected=detectedSources[platform];
    if(source.value!=='available')return commandFailure('account','source_unavailable','selection_source',source.value,'readable current source');
    if(!detected||detected.key!==sourceKey(platform,a.candidate.source)||detected.revision!==source.revision)return commandFailure('account','source_changed','selection_source_revision',source.revision,detected?.revision??'detected source revision');
    if(request.action==='confirm_change'&&a.selection.state!=='selected')return commandFailure('account','selection_missing','account_change',a.selection.state,'existing selection');
    if(request.action==='confirm_change'&&a.candidate.fingerprint===a.selection.fingerprint)return commandFailure('account','identity_unchanged','account_change_identity',a.candidate.fingerprint,'candidate differs from selected identity');
   }
   const currentLocal=w.__beeMockRuntimeLocal?.()??local;
   if(['starting','stopping'].includes(currentLocal))return commandFailure('account','runtime_dependency','runtime_state',currentLocal,'runtime outside transition');
   const operationId=continuation?a.operation.id:freshID();
   a.revision++;a.operation={...op(request.action,platform,a.revision,w.actionPending?'reconciling':'succeeded'),id:operationId};
   if(!w.actionPending){a.selection={state:args.request.action==='clear_selection'?'not_selected':'selected',fingerprint:args.request.action==='clear_selection'?null:a.candidate.fingerprint,observed_at:new Date().toISOString(),error:null};w.paused[platform]=true;}
   accounts[platform]=a;
   if(w.actionUnknown)throw new Error('RESPONSE_TIMEOUT: account action result unconfirmed');
  }
  if(command==='account_detect')return {instance:captured,result:{account:structuredClone(detectAccount(args.request))}};
  if(w.historicalLimit)a.capabilities[1]={...a.capabilities[1],status:'rate_limited',observed_at:new Date(Date.now()-600000).toISOString(),valid_until:new Date(Date.now()-240000).toISOString(),retry_at:new Date(Date.now()+60000).toISOString()};
  return {instance:captured,result:{account:structuredClone(a)}};
 }};
}
