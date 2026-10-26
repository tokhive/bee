export function accountFixture(platform) {
 const fact=state=>({state,fingerprint:null,observed_at:null,error:null});
 return {platform,operation:null,revision:1,candidate:{state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null},selection:fact('not_selected'),hive:{...fact('unbound'),pending_fingerprint:null,generation:null},authorization:fact('not_checked'),capabilities:['official','hive'].map(origin=>({origin,status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null})),features:Object.fromEntries(['detect','check','select','confirm_change','remove','clear_selection','authorize','system_notifications'].map(k=>[k,{available:['detect','check'].includes(k),reason:['detect','check'].includes(k)?null:k==='remove'?'runtime_drain_and_detach_required':'runtime_ownership_and_source_barrier_required'}])),issues:[],checked_at:null};
}
export function installAccountFixture({accounts}){
 const w=window;w.isTauri=true;w.calls=[];w.delay=0;w.fail='';w.paused={openai:false,claude:true};
 let callback=0,event=0,instance='fixture';const callbacks=new Map();
 const status=()=>({state:'ready',metadata:{bee_version:'fixture',os:'darwin',arch:'arm64',instance}});w.emit=id=>{instance=id;callbacks.get(event)?.({payload:status()});};
 w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 w.__TAURI_INTERNALS__={transformCallback:fn=>{const id=++callback;callbacks.set(id,fn);return id;},unregisterCallback:()=>{},invoke:async(command,args)=>{
  if(command==='plugin:event|listen'){event=args.handler;return 1;}if(command==='plugin:event|unlisten')return;if(command==='bridge_status')return status();
  if(command==='device_status'&&w.deviceFail)return {result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET identity HTTP 503'}}};
  if(command==='device_status')return {result:{device:{state:'bound',hive:'https://hive.example',name:'Fixture',identity:{id:'dev-1',name:'Fixture',owner_id:'owner-1',owner_email:'owner@example.test'}}}};
  w.calls.push({command,args});
  if(command.startsWith('supply_')){const p=args.platform;if(command==='supply_set_paused'&&w.supplyFail===p)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:'PUT HTTP 503 result unconfirmed'}}};if(command==='supply_set_paused')w.paused[p]=args.paused;return {result:{supply:{hive:'https://hive.example',device_id:'dev-1',platform:p,paused:w.paused[p],ready:false,reasons:w.paused[p]?['manually_paused','offline']:['offline'],checked_at:new Date().toISOString()}}};}
  if(command==='account_defaults')return {instance,result:{defaults:{platforms:['openai','claude'].map(p=>({platform:p,directory:p==='openai'?'/tmp/codex':'/tmp/claude',default_store:'file',stores:(p==='openai'?['auto','file','keyring']:['file','keychain']).map(store=>({store,supported:true,reason:null}))}))}}};
  const platform=args.request?.platform??args.platform,captured=instance;if(w.delay)await new Promise(r=>setTimeout(r,w.delay));
  if(w.fail===platform)return {instance:captured,result:{error:{code:'ACCOUNT_OPERATION_FAILED',message:'source_read permission_denied=true; check=file_read'}}};
  const a=structuredClone(accounts[platform]);
  if(command==='account_detect'){
   const official=args.request.mode==='official';a.candidate={state:'available',reference:'a'.repeat(48),source:{directory:args.request.directory,store:args.request.store},fingerprint:platform==='openai'||official?'b'.repeat(64):null,plan:platform==='openai'?'plus':'pro',expires_at:w.expiry??'2099-01-01T00:00:00Z',identity_verified:official,observed_at:new Date().toISOString(),error:null};a.authorization.state=official?'official_identity_verified':'local_structure_only';if(official&&w.missingProfile){a.candidate.identity_verified=false;a.authorization.error={code:'missing_scope',check:'official_scopes',platform,message:'official check requires user:profile',evidence:{profile_scope:'false',inference_scope:'true'}};}a.revision++;a.hive.state='unconfirmed';
   if(official)a.capabilities[0]={...a.capabilities[0],status:'ready',observed_at:new Date().toISOString(),metadata_observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+360000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:120,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:null,reset_at:null},...(platform==='claude'?[{scope:'opus',seconds:604800,used_percent:100,reset_at:'2099-01-01T00:00:00Z'}]:[])],models:[{id:platform==='openai'?'gpt-5.4':'claude-opus-4-6',account_supported:true,market_open:null,accepting:null}]};
   accounts[platform]=a;
  }
  if(w.historicalLimit)a.capabilities[1]={...a.capabilities[1],status:'rate_limited',observed_at:new Date(Date.now()-600000).toISOString(),valid_until:new Date(Date.now()-240000).toISOString(),retry_at:new Date(Date.now()+60000).toISOString()};
  return {instance:captured,result:{account:a}};
 }};
}
