export function accountFixture(platform) {
 const fact=state=>({state,fingerprint:null,observed_at:null,error:null});
 return {platform,operation:null,revision:1,candidate:{state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null},selection:fact('not_selected'),hive:{...fact('unbound'),pending_fingerprint:null,generation:null},authorization:fact('not_checked'),capabilities:['official','hive'].map(origin=>({origin,status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null})),features:Object.fromEntries(['detect','check','select','confirm_change','remove','clear_selection','authorize','system_notifications'].map(k=>[k,{available:['detect','check'].includes(k),reason:['detect','check'].includes(k)?null:k==='remove'?'runtime_drain_and_detach_required':'runtime_ownership_and_source_barrier_required'}])),issues:[],checked_at:null};
}
export function installAccountFixture({accounts, runtimeEnabled=false,scenarios={},initialPreferences={}}){
 const w=window;w.isTauri=true;w.calls=[];w.delay=0;w.fail='';w.paused={openai:false,claude:true};
 w.accountScenarios=scenarios;
 let callback=0,bridgeSequence=0,instance='b'.repeat(32);
 let runtimeRevision=0,local='stopped',operation=null;
 let preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[],...initialPreferences};
 let diagnostic=null,diagnosticSequence=0;
 if(runtimeEnabled)for(const a of Object.values(accounts))for(const key of ['select','clear_selection','confirm_change','authorize'])a.features[key]={available:true,reason:null};
 for(const [platform,features]of Object.entries(scenarios.features??{}))Object.assign(accounts[platform].features,features);
 const op=(kind,platform,revision,state='succeeded')=>({id:(kind==='authorize'?'d':kind==='stop'?'e':'c').repeat(48),kind,platform,state,revision,error:null});
 const finishLogins=()=>{if(w.loginComplete)for(const [platform,account]of Object.entries(accounts))if(account.operation?.kind==='authorize'&&['pending','running'].includes(account.operation.state)){
  account.operation={...account.operation,state:'succeeded',revision:++account.revision,...w.accountScenarios.loginOutcome};if(account.operation.state!=='succeeded')continue;account.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),plan:platform==='openai'?'plus':'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:new Date().toISOString(),error:null};
 }};
 w.accounts=accounts;
 const callbacks=new Map(),subscriptions=new Map();
 const status=()=>({state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}});
 const emit=(event,payload)=>{for(const [handler,name]of subscriptions)if(name===event)callbacks.get(handler)?.({payload});};
 w.emitRequestSettled=request=>emit('bee://request-settled',{instance,...request});
 w.emit=id=>{instance=id;emit('bee://bridge-status',status());};w.emitDownload=(url,success)=>emit('bee://download-finished',{url,success});
 w.downloadListenerCount=()=>[...subscriptions.values()].filter(name=>name==='bee://download-finished').length;
 w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event,id)=>{subscriptions.delete(id);callbacks.delete(id);}};
 const supply=p=>{const reasons=[...new Set([...(w.paused[p]?['manually_paused']:[]),...(w.accountScenarios.reasons?.[p]??['offline'])])];return {hive:'https://hive.example',device_id:'dev-1',platform:p,paused:w.paused[p],ready:reasons.length===0,reasons,checked_at:new Date().toISOString()};};
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
   if(w.preferencesFail)return structuredClone({preferences,error:preferenceError()});
   preferences={...args.request.preferences,revision:preferences.revision+1};return structuredClone({preferences,error:null});
  }
  if(command==='notification_permission')return w.notificationPermission??'prompt';
  if(command==='notification_enable')return w.notificationPermission??'granted';
  if(command==='notification_delivery_status')return {error:w.notificationDeliveryError??null,retryable_count:w.notificationRetryableCount??0,pending_count:w.notificationPendingCount??0,uncertain_count:w.notificationUncertainCount??0,check_sequence:w.notificationCheckSequence??0};
  if(command==='notification_retry'){
   if(w.notificationRetryDelay)await new Promise(resolve=>setTimeout(resolve,w.notificationRetryDelay));
   const count=w.notificationRetryableCount??0;w.notificationRetryableCount=0;w.notificationPendingCount=(w.notificationPendingCount??0)+count;
   if(w.notificationRetryUnknown)throw {code:'RESPONSE_TIMEOUT',message:'retry receipt unavailable; authorization result unconfirmed: request_id=17'};
   return {retryable_count:count};
  }
  if(command==='autostart_status')return {desired:preferences.autostart_desired,registered:preferences.autostart_desired,error:null};
  if(command==='autostart_set'){preferences={...preferences,revision:preferences.revision+1,autostart_desired:args.enabled};return {desired:args.enabled,registered:args.enabled,error:null};}
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
   if(command==='runtime_start'){local='running';operation=op('start',null,++runtimeRevision);if(w.runtimeUnknown)throw new Error('RESPONSE_TIMEOUT: start result unconfirmed');return {instance,result:{operation}};}
   if(command==='runtime_stop'){local='stopped';operation=op('stop',null,++runtimeRevision);return {instance,result:{operation}};}
   if(w.accountScenarios.runtimeReadFailure)throw {code:'RESPONSE_TIMEOUT',message:'runtime snapshot response lost; shared runtime read unconfirmed',details:{check:'runtime_snapshot',observed_at:new Date().toISOString(),evidence:{actual:'no runtime response',required:'confirmed shared runtime snapshot'}}};
   finishLogins();w.runtimeReadCount=(w.runtimeReadCount??0)+1;return structuredClone({instance,result:{runtime:{run_id:local==='running'?'a'.repeat(32):null,revision:runtimeRevision,network_revision:w.networkRevision??0,observed_at:new Date().toISOString(),local,connection:local==='running'?'connected':'disconnected',connection_detail:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:(w.runtimeAccounts??accounts)[p],supply:supply(p),selection_revision:accounts[p].selection.state==='selected'?1:0}])),operation,stop_receipt:operation?.kind==='stop'?{workers_stopped:true,intent_saved:true,session_clean:true}:null}}});
  }
  if(['authorize_start','authorize_status','authorize_cancel'].includes(command)){
   const p=args.request?.platform??Object.keys(accounts).find(p=>accounts[p].operation?.id===args.operationId),a=accounts[p];
   if(command==='authorize_start'){if(w.loginAdmissionDelay)await new Promise(r=>setTimeout(r,w.loginAdmissionDelay));a.operation=op('authorize',p,++a.revision,'running');}
   if(command==='authorize_cancel'&&w.accountScenarios.cancelUnknown)throw Object.assign(new Error('cancel response lost; owned operation still unconfirmed'),{code:'RESPONSE_TIMEOUT'});
   if(command==='authorize_cancel')a.operation={...a.operation,state:'cancelled',revision:++a.revision};
   if(command==='authorize_status')finishLogins();
   return {instance,result:{operation:structuredClone(a.operation)}};
  }
  if(['supply_status','supply_set_paused'].includes(command)){const p=args.platform;if(command==='supply_set_paused'&&w.supplyFail===p)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:'PUT HTTP 503 result unconfirmed'}}};if(command==='supply_set_paused')w.paused[p]=args.paused;return {result:{supply:supply(p)}};}
  if(command==='account_defaults')return {instance,result:{defaults:{platforms:['openai','claude'].map(p=>({platform:p,directory:p==='openai'?'/tmp/codex':'/tmp/claude',default_store:'file',stores:(p==='openai'?['auto','file','keyring']:['file','keychain']).map(store=>({store,supported:!w.accountScenarios.unsupportedStores?.[store],reason:w.accountScenarios.unsupportedStores?.[store]??null}))}))}}};
  if(!['account_snapshot','account_detect','account_action'].includes(command))throw new Error(`MOCK_COMMAND_UNKNOWN: command=${command}; required=registered native command or supported event subscription`);
  const platform=args.request?.platform??args.platform,captured=instance;if(w.delay)await new Promise(r=>setTimeout(r,w.delay));
  if(command==='account_snapshot'&&w.accountScenarios.snapshotFailure===platform)throw {code:'RESPONSE_TIMEOUT',message:'account snapshot response lost; platform read unconfirmed',details:{check:'account_snapshot',observed_at:new Date().toISOString(),evidence:{actual:platform+' snapshot unavailable',required:'confirmed platform account snapshot'}}};
  if(w.fail===platform&&command==='account_detect'){const failed=structuredClone(accounts[platform]);failed.revision++;failed.candidate={...failed.candidate,state:'permission_denied',reference:null,source:null,fingerprint:null,error:{code:'permission_denied',check:'file_read',platform,message:'source_read permission_denied=true; check=file_read',evidence:{permission_denied:'true'}}};accounts[platform]=failed;return {instance:captured,result:{account:failed}};}
  if(command==='account_snapshot')finishLogins();const a=structuredClone(accounts[platform]);
  if(command==='account_action'){
   if(args.request.revision!==a.revision)return {instance,result:{error:{code:'ACCOUNT_OPERATION_FAILED',message:'stale_revision: revision must match the current platform snapshot'}}};
   a.revision++;a.operation=op(args.request.action,platform,a.revision,w.actionPending?'reconciling':'succeeded');
   if(!w.actionPending){a.selection={state:args.request.action==='clear_selection'?'not_selected':'selected',fingerprint:args.request.action==='clear_selection'?null:a.candidate.fingerprint,observed_at:new Date().toISOString(),error:null};w.paused[platform]=true;}
   accounts[platform]=a;
   if(w.actionUnknown)throw new Error('RESPONSE_TIMEOUT: account action result unconfirmed');
  }
  if(command==='account_detect'){
   const official=args.request.mode==='official';a.candidate={state:'available',reference:'a'.repeat(48),source:{directory:args.request.directory,store:args.request.store},fingerprint:platform==='openai'||official?'b'.repeat(64):null,plan:platform==='openai'?'plus':'pro',expires_at:w.expiry??'2099-01-01T00:00:00Z',identity_verified:official,observed_at:new Date().toISOString(),error:null};a.authorization.state=official?'official_identity_verified':'local_structure_only';if(official&&w.missingProfile){a.candidate.identity_verified=false;a.authorization.error={code:'missing_scope',check:'official_scopes',platform,message:'official check requires user:profile',evidence:{profile_scope:'false',inference_scope:'true'}};}a.revision++;a.hive.state='unconfirmed';if(w.accountScenarios.candidates?.[platform])a.candidate={...a.candidate,...structuredClone(w.accountScenarios.candidates[platform])};
   if(official)a.capabilities[0]={...a.capabilities[0],status:'ready',observed_at:new Date().toISOString(),metadata_observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+360000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:120,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:null,reset_at:null},...(platform==='claude'?[{scope:'opus',seconds:604800,used_percent:100,reset_at:'2099-01-01T00:00:00Z'}]:[])],models:[{id:platform==='openai'?'gpt-5.4':'claude-opus-4-6',account_supported:true,market_open:null,accepting:null}]};
   accounts[platform]=a;
  }
  if(w.historicalLimit)a.capabilities[1]={...a.capabilities[1],status:'rate_limited',observed_at:new Date(Date.now()-600000).toISOString(),valid_until:new Date(Date.now()-240000).toISOString(),retry_at:new Date(Date.now()+60000).toISOString()};
  return {instance:captured,result:{account:structuredClone(a)}};
 }};
}
