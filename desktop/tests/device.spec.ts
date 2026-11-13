import {readFileSync} from 'node:fs';
const passiveRuntime={...JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot,local:'stopped',connection:'disconnected',operation:null,stop_receipt:null};
import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript((passiveRuntime)=>{
  const runtime=window as unknown as {isTauri:boolean;__TAURI_INTERNALS__:unknown;deviceStage:string;deviceCalls:string[]};
  (window as unknown as {__TAURI_EVENT_PLUGIN_INTERNALS__:unknown}).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  runtime.isTauri=true;runtime.deviceStage='unbound';runtime.deviceCalls=[];
  let callback=1;const callbacks=new Map<number,(value:unknown)=>void>();
  const instance='b'.repeat(32);let preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[]};
  runtime.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:()=>{},invoke:async(command:string,args?:any)=>{
   if(command==='runtime_snapshot')return {instance,result:{runtime:{...((window as any).runtimeOverride??passiveRuntime),observed_at:new Date().toISOString()}}};
   runtime.deviceCalls.push(command);
   ((window as any).deviceRequests??=[]).push({command,args});
   if(command==='plugin:event|listen') {if(args.event==='bee://bridge-status'&&location.search.includes('stale-status'))setTimeout(()=>callbacks.get(args!.handler)?.({payload:{state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}}}),20);return args.handler;}
   if(command==='plugin:event|unlisten')return;
   if(command==='bridge_status'&&location.search.includes('stale-status'))return new Promise((_,reject)=>setTimeout(()=>{(window as unknown as {initialRejected:boolean}).initialRejected=true;reject(new Error('old status read failed'));},100));
   if(command==='bridge_pending_requests')return {instance,requests:[]};
   if(command==='bridge_status')return {state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}};
   if(command==='startup_status'||command==='startup_recheck')return {state:'ready',failure:null,instance,binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:1};
   if(command==='preferences_read')return {preferences,error:null};
   if(command==='preferences_save'){preferences={...args.request.preferences,revision:preferences.revision+1};return {preferences,error:null};}
   if(command==='native_locale_sync')return null;
   if(command==='notification_permission')return 'prompt';
   if(command==='autostart_status')return {desired:false,registered:false,error:null};
   if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
   if(command==='account_defaults')return {instance,result:{defaults:{platforms:['openai','claude'].map(platform=>({platform,directory:'/tmp/fixture',default_store:'file',stores:[{store:'file',supported:true,reason:null}]}))}}};
   if(command==='account_snapshot')return {instance,result:{account:(passiveRuntime.platforms as any)[args.platform].account}};
   if(command==='supply_status'||command==='supply_set_paused')return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform:(args as unknown as {platform:string}).platform,paused:false,ready:false,reasons:['offline'],checked_at:new Date().toISOString()}}};
   const w=window as any;
   if(command==='device_context')return {result:w.deviceContext?{context:w.deviceContext}:{binding_revision:1,error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'no saved device configuration'}}};
   if(command==='device_recovery_status')return {result:w.recovery?{recovery:structuredClone(w.recovery)}:{error:{code:'DEVICE_RECOVERY_NONE',message:'no credential recovery transaction exists'}}};
   if(command==='device_recovery_prepare'){w.recovery={operation_id:w.nextRecoveryOperation??'d'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:{id:'old-1',name:'My Mac',owner_id:'old-owner',owner_email:'old@example.test'},new_identity:null,pairing:null,failure:null};return {result:{recovery:structuredClone(w.recovery)}};}
   if(command==='device_recovery_confirm'){
    // Top-level Tauri command arguments are camelCase; the sidecar protocol stays snake_case.
    for(const key of ['operationId','expectedRevision','decision'])if(!Object.hasOwn(args??{},key))throw `invalid args \`${key}\` for command \`device_recovery_confirm\`: command device_recovery_confirm missing required key ${key}`;
    if(args.operationId!==w.recovery.operation_id||args.expectedRevision!==w.recovery.revision)return {result:{error:{code:'DEVICE_RECOVERY_FAILED',message:'recovery confirmation mismatch actual='+w.recovery.operation_id+':'+w.recovery.revision+' expected='+args.operationId+':'+args.expectedRevision}}};
    w.recovery={...w.recovery,revision:w.recovery.revision+1,phase:args.decision==='adopt_owner'?'completed':'pending',pairing:args.decision==='adopt_owner'?null:{code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString()}};return {result:{recovery:structuredClone(w.recovery)}};
   }
   if(command==='device_begin')runtime.deviceStage='pending';
   if(command==='device_status'||command==='device_begin'||command==='device_open'){
    const delay=(window as unknown as {deviceDelay?:number}).deviceDelay;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(w.deviceHold)await new Promise(resolve=>{w.releaseDevice=resolve;});
    if(w.deviceFailure)return {result:{error:w.deviceFailure}};
    if(command==='device_open'&&w.openFailure)throw {code:'BROWSER_OPEN_FAILED',message:'open failed; OS denied browser launch'};
    if(w.deviceOverride)return {result:{device:structuredClone(w.deviceOverride)}};
    if(runtime.deviceStage==='error')return {result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET /api/bee/identity HTTP 503'}}};
    const device=runtime.deviceStage==='unbound'?{state:'unbound'}:runtime.deviceStage==='bound'?{state:'bound',hive:'https://hive.example',name:'My Mac',identity:{id:'device-1',name:'My Mac',owner_id:'owner-1',owner_email:'real@example.test'}}:{state:'pending',hive:'https://hive.example',name:'My Mac',user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString(),poll_interval_seconds:1};
    return {result:{device}};
   }
   throw new Error('unexpected IPC '+command);
  }};
 },passiveRuntime);
});
test('normal native build pairs and verifies without demo balances or starting supply',async({page})=>{
 await page.setViewportSize({width:860,height:600});await page.goto('/');
 await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
 await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
 await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByLabel('设备名称',{exact:true}).fill('My Mac');
 await page.getByRole('button',{name:'生成配对码'}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await expect(page.getByText('完成网页确认后，请回到 Bee。')).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await expect(page.getByText('real@example.test',{exact:true})).toBeVisible({timeout:10000});
 await expect(page.getByText('设备已绑定。')).toBeVisible();
 await expect(page.getByRole('button',{name:'收益',exact:true})).toHaveCount(0);
 await expect(page.getByText('设备 ID',{exact:true})).toHaveCount(0);
 await expect(page.locator('.device-facts>div')).toHaveCount(3);
 expect(await page.evaluate(()=> (window as unknown as {deviceCalls:string[]}).deviceCalls.some(c=>['runtime_start','runtime_stop','account_action','supply_set_paused','device_recovery_prepare','device_recovery_confirm'].includes(c)))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('failed verification blocks success and remains retryable',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByRole('alert').filter({hasText:'HTTP 503'}).first()).toBeVisible();
 await expect(page.getByText('设备已绑定。')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
});

test('retrying a failed bound-device check does not revive cached success',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByText('设备已绑定。')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
 await page.getByRole('button',{name:'重新核对设备'}).click();await expect(page.getByRole('alert').filter({hasText:'HTTP 503'}).first()).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string;deviceDelay:number}).deviceStage='bound';(window as unknown as {deviceDelay:number}).deviceDelay=500;});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByRole('button',{name:'重新核对设备'})).toHaveAttribute('aria-busy','true');
 await expect(page.getByText('设备已绑定。')).toHaveCount(0);
 await expect(page.getByText('设备已绑定。')).toBeVisible();
});

test('an old native status rejection cannot overwrite a newer ready event',async({page})=>{
 await page.goto('/?fixture=stale-status');
 await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {initialRejected:boolean}).initialRejected))).toBe(true);
 await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
});

test('opening after website confirmation consumes the latest bound result',async({page})=>{
 await page.goto('/');await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByRole('button',{name:'生成配对码'}).click();await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
 await expect(page.getByText('设备已绑定。')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('English device entry and settings have complete translations',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await expect(page.getByText('Saved for this system user and retained after restarting.')).toBeVisible();
 await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'Connect this device'})).toBeVisible();
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});

test('diagnostics preserve runtime operation and platform authorization failure evidence',async({page})=>{
 await page.addInitScript(()=>{
  const internals=(window as any).__TAURI_INTERNALS__,invoke=internals.invoke;
  internals.invoke=async(command:string,args:unknown)=>{
   const reply=await invoke(command,args);
   if(command==='runtime_snapshot'){
    const view=reply.result.runtime;view.revision=1;
    view.operation={id:'c'.repeat(48),kind:'start',platform:null,state:'failed',revision:1,error:{code:'source_unavailable',check:'runtime_start_check',platform:'openai',message:'Fixture runtime failure',evidence:{permission_denied:'true'}}};
    view.platforms.openai.account.authorization.error={code:'source_unavailable',check:'source_read',platform:'openai',message:'Fixture authorization failure',evidence:{path:'/fixture/source'}};
   }
   return reply;
  };
 });
 await page.goto('/');await page.getByRole('button',{name:'诊断',exact:true}).click();
 await page.getByText('运行详情',{exact:true}).click();
 const evidence=page.locator('.native-diagnostic-evidence pre');
 await expect(evidence).toContainText('runtime_start_check');await expect(evidence).toContainText('permission_denied');
 await expect(evidence).toContainText('source_read');await expect(evidence).toContainText('/fixture/source');
});

const deviceCalls=(page:any,command:string)=>page.evaluate((command:string)=>(window as any).deviceCalls.filter((c:string)=>c===command),command);
const recoveryView=(phase:string)=>({operation_id:'d'.repeat(48),revision:4,phase,old_identity:{id:'old-1',name:'My Mac',owner_id:'old-owner',owner_email:'old@example.test'},new_identity:['saving','completed','awaiting_owner_confirmation'].includes(phase)?{id:'new-1',name:'New Mac',owner_id:'new-owner',owner_email:'new@example.test'}:null,pairing:['pending','draining','redeeming','redemption_unknown','expired'].includes(phase)?{code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2099-01-01T00:00:00Z'}:null,failure:null});
test('a completed recovery permits another revoked identity only after confirmation with a new operation',async({page})=>{
 await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.nextRecoveryOperation='e'.repeat(48);w.deviceFailure={code:'device_replaced',message:'current device GET identity HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'New Mac',device_id:'new-1',owner_id:'new-owner',binding_revision:1};},recoveryView('completed'));
 await page.goto('/');const begin=page.getByRole('button',{name:'重新绑定设备',exact:true});await begin.click();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(begin).toBeFocused();
 expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
 await begin.click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await expect(begin).toHaveCount(0);
 expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(1);
 const confirmations=await page.evaluate(()=>(window as any).deviceRequests.filter((request:any)=>request.command==='device_recovery_confirm'));
 expect(confirmations).toEqual([{command:'device_recovery_confirm',args:{operationId:'e'.repeat(48),expectedRevision:1,decision:'begin_pairing'}}]);
 expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
});
for(const [phase,button,confirm,decision] of [
 ['awaiting_confirmation','重新绑定设备','确认重新绑定','begin_pairing'],
 ['expired','重新生成配对码','确认重新生成','renew_expired'],
] as const)test(`saved recovery ${phase} confirms the existing transaction through native arguments`,async({page})=>{
 await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.deviceFailure={code:'device_replaced',message:'HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'My Mac',device_id:'old-1',owner_id:'old-owner',binding_revision:1};},recoveryView(phase));
 await page.goto('/');const trigger=page.getByRole('button',{name:button,exact:true});await trigger.click();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(trigger).toBeFocused();
 expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
 await trigger.click();await page.getByRole('dialog').getByRole('button',{name:confirm,exact:true}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
 const confirmations=await page.evaluate(()=>(window as any).deviceRequests.filter((request:any)=>request.command==='device_recovery_confirm'));
 expect(confirmations).toEqual([{command:'device_recovery_confirm',args:{operationId:'d'.repeat(48),expectedRevision:4,decision}}]);
 for(const command of ['device_recovery_prepare','device_begin','runtime_start','account_action'])expect(await deviceCalls(page,command)).toHaveLength(0);
});
for(const locale of ['zh','en'] as const)for(const cause of ['native','hive'] as const)test(`recovery ${cause} failure remains visible in the confirmation while status reconciliation is pending in ${locale}`,async({page})=>{
 const copy=locale==='zh'?{rebind:'重新绑定设备',confirm:'确认重新绑定',pending:'正在处理…',status:'正在处理设备恢复，请稍候…',back:'返回设备核对',phase:'等待网页确认'}:{rebind:'Rebind this device',confirm:'Confirm rebinding',pending:'Processing…',status:'Processing device recovery. Please wait…',back:'Back to device verification',phase:'Waiting for website confirmation'};
 await page.setViewportSize({width:860,height:600});
 await page.addInitScript(({recovery,cause,locale})=>{
  const w=window as any;w.recovery=recovery;w.deviceFailure={code:'device_replaced',message:'HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'My Mac',device_id:'old-1',owner_id:'old-owner',binding_revision:1};
  const invoke=w.__TAURI_INTERNALS__.invoke;w.recoverySubmissions=0;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='preferences_read'){const reply=await invoke(command,args);reply.preferences.language=locale;return reply;}
   if(command==='device_recovery_confirm'){
    w.recoverySubmissions++;
    if(!w.allowRecovery)await new Promise((_,reject)=>{w.rejectRecovery=()=>{w.holdRecoveryRead=true;reject(cause==='native'?'invalid args `operationId` for command `device_recovery_confirm`: missing required key operationId':{code:'unavailable',message:'POST /api/bee/pairing HTTP 503: maintenance',details:{check:'device_pairing_create',observed_at:new Date().toISOString(),evidence:{http_status:'503'}}});};});
   }
   if(command==='device_recovery_status'&&w.holdRecoveryRead)await new Promise(resolve=>{w.releaseRecoveryRead=()=>{w.holdRecoveryRead=false;resolve(null);};});
   return invoke(command,args);
  };
 },{recovery:recoveryView('awaiting_confirmation'),cause,locale});
 await page.goto('/');await page.getByRole('button',{name:copy.rebind,exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:copy.confirm,exact:true}).click();
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toHaveText(copy.status);
 await expect(dialog.getByRole('button',{name:copy.pending,exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).rejectRecovery());
 await expect(dialog.getByRole('alert').locator('p').first()).toContainText(cause==='native'?'missing required key operationId':'HTTP 503');
 await expect(dialog.getByRole('alert').locator('p').first()).toBeInViewport();
 await expect(dialog.locator('[data-recovery-failure]')).toBeFocused();
 await expect(dialog.getByRole('button',{name:copy.confirm,exact:true})).toHaveCount(0);
 await page.screenshot({path:`../.cache/device-pairing/rebind-failure-${locale}-${cause}.png`});
 expect(await page.evaluate(()=>(window as any).recoverySubmissions)).toBe(1);
 await dialog.getByRole('button',{name:copy.back,exact:true}).click();
 await expect(page.locator('.device-pairing')).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseRecoveryRead)).toBe('function');
 await page.evaluate(()=>{const w=window as any;w.releaseRecoveryRead();w.allowRecovery=true;});
 await page.getByRole('button',{name:copy.rebind,exact:true}).click();
 await dialog.getByRole('button',{name:copy.confirm,exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(page.locator('.pairing-phase')).toHaveText(copy.phase);
 await expect(page.locator('.device-pairing')).toBeFocused();
 expect(await page.evaluate(()=>(window as any).recoverySubmissions)).toBe(2);
 expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});
test('closing a pending recovery returns keyboard focus to the device section',async({page})=>{
 await page.addInitScript(recovery=>{
  const w=window as any;w.recovery=recovery;w.deviceFailure={code:'device_replaced',message:'HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'My Mac',device_id:'old-1',owner_id:'old-owner',binding_revision:1};
  const invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='device_recovery_confirm')await new Promise(resolve=>{w.releaseRecoveryConfirm=resolve;});
   return invoke(command,args);
  };
 },recoveryView('awaiting_confirmation'));
 await page.goto('/');const trigger=page.getByRole('button',{name:'重新绑定设备',exact:true});await trigger.click();
 await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(page.getByRole('button',{name:'重新绑定设备',exact:true,includeHidden:true})).toBeDisabled();await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.device-pairing')).toBeFocused();
 await page.evaluate(()=>(window as any).releaseRecoveryConfirm(null));
 await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
 expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(1);
});
for(const changed of ['identity_valid','pending_transaction','query_failed'] as const)test(`a repeated recovery rechecks ${changed} after an in-flight read`,async({page})=>{
 await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});
 await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.deviceStage='bound';w.deviceContext={hive:'https://hive.example',name:'New Mac',device_id:'new-1',owner_id:'new-owner',binding_revision:1};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='device_recovery_status'&&w.holdRecovery){await new Promise(resolve=>{w.releaseRecovery=resolve;});if(w.failRecovery)throw {code:'DEVICE_RECOVERY_BLOCKED',message:'journal read permission denied'};}return invoke(command,args);};},recoveryView('completed'));
 await page.goto('/');await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).deviceFailure={code:'invalid_device_credential',message:'GET identity HTTP 401 invalid_device_credential'};});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();
 await page.evaluate(()=>{(window as any).holdRecovery=true;});await page.clock.runFor(10001);
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseRecovery)).toBe('function');
 await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);
 await page.evaluate(({changed,pending})=>{const w=window as any;w.holdRecovery=false;if(changed==='identity_valid'){w.deviceFailure=null;w.deviceStage='bound';}else if(changed==='pending_transaction')w.recovery=pending;else w.failRecovery=true;w.releaseRecovery();},{changed,pending:recoveryView('pending')});
 await expect(page.getByRole('alert').filter({hasText:'DEVICE_RECOVERY_PRECONDITION'}).first()).toBeVisible();
 expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
});
for(const kind of ['initial_pairing','credential_recovery'] as const)test(`completed ${kind} hides retained pairing instructions even after the old code expires`,async({page})=>{
 await page.clock.install({time:new Date('2026-11-03T03:00:00Z')});
 await page.addInitScript(({kind,recovery})=>{
  const w=window as any,identity={id:'device-1',name:'My Mac',owner_id:'owner-1',owner_email:'real@example.test'};
  recovery.new_identity=identity;
  recovery.pairing={code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2026-11-03T03:00:00.500Z'};
  w.deviceContext={hive:'https://hive.example',name:'My Mac',device_id:identity.id,owner_id:identity.owner_id,binding_revision:1};
  w.deviceOverride={state:'bound',hive:'https://hive.example',name:'My Mac',identity};
  if(kind==='initial_pairing')w.deviceOverride.recovery={...recovery,old_identity:null};else w.recovery=recovery;
 },{kind,recovery:recoveryView('completed')});
 await page.goto('/');const device=page.getByRole('region',{name:'设备配对'});
 const assertCompleted=async()=>{
  await expect(device.getByText('设备已绑定。',{exact:true})).toBeVisible();
  await expect(device.locator('.pairing-phase')).toContainText('已完成');
  await expect(device.locator('.device-pairing-grid,.device-url')).toHaveCount(0);
  await expect(device).not.toContainText('完成网页确认后，请回到 Bee。');
  await expect(device).not.toContainText('等待 Hive 核对是否过期');
  for(const name of ['复制配对码','复制确认网址','打开 Hive 确认网页','重新生成配对码'])await expect(device.getByRole('button',{name,exact:true})).toHaveCount(0);
 };
 await assertCompleted();await page.clock.runFor(1001);await assertCompleted();
 await page.reload();await assertCompleted();
 for(const command of ['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start'])expect(await deviceCalls(page,command)).toHaveLength(0);
});
test('a historical completed recovery yields preparation guidance to current account and runtime facts',async({page})=>{
 await page.addInitScript(({recovery,runtime})=>{const w=window as any;w.recovery=recovery;w.deviceStage='bound';w.runtimeOverride=runtime;}, {recovery:recoveryView('completed'),runtime:passiveRuntime});
 await page.goto('/');const device=page.getByRole('region',{name:'设备配对'});
 await expect(page.getByRole('region',{name:'准备贡献'})).toBeVisible();await expect(page.getByRole('button',{name:'前往准备账号',exact:true}).first()).toBeVisible();
 await page.evaluate(()=>{const w=window as any,r=w.runtimeOverride;r.local='running';r.run_id='a'.repeat(32);r.connection='connected';r.revision++;r.platforms.openai.account.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='account_snapshot'?{instance:'b'.repeat(32),result:{account:r.platforms[args.platform].account}}:invoke(command,args);});
 await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await expect(page.getByRole('region',{name:'服务状态',exact:true}).locator('.native-runtime-health')).toContainText('贡献已启动');await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'准备贡献'})).toHaveCount(0);await expect(device.getByRole('button',{name:'前往准备账号',exact:true})).toHaveCount(0);
 await expect(device.getByText('重新绑定已完成，贡献保持停止。',{exact:true})).toHaveCount(0);await expect(device.getByText('请重新准备账号；旧账号选择与运行意图不会迁移。',{exact:true})).toHaveCount(0);
 expect(await deviceCalls(page,'runtime_start')).toHaveLength(0);
});
test('initial device facts stay unknown until the first read finishes',async({page})=>{
 await page.addInitScript(()=>{(window as any).deviceHold=true;});await page.goto('/');
 await expect(page.getByText('正在读取设备与账号状态',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'连接本机设备',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.deviceHold=false;w.releaseDevice();});
 await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'准备贡献'})).toBeVisible();
});
test('pairing copy feedback and failed browser opening retain the same request',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.goto('/');
 await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');await page.getByRole('button',{name:'生成配对码',exact:true}).click();
 await page.getByRole('button',{name:'复制配对码',exact:true}).click();await expect(page.getByText('配对码已复制',{exact:true})).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard permission denied');}}});(window as any).openFailure=true;});
 await page.getByRole('button',{name:'复制确认网址',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'clipboard permission denied'})).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();await expect(page.getByText('https://hive.example/devices/pair?code=ABCD-EFGH',{exact:true})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:'OS denied browser launch'})).toBeVisible();expect(await deviceCalls(page,'device_begin')).toHaveLength(1);
});
for(const [phase,copy] of [['creation_unknown','创建结果未知'],['draining','等待旧设备完成任务和结算'],['redeeming','兑换已提交，正在核对新设备身份'],['redemption_unknown','兑换结果未知，正在核对新设备身份'],['saving','新设备身份已核对，正在保存本机配置']] as const)test(`initial pairing presents ${phase} from its durable transaction`,async({page})=>{
 const recovery={...recoveryView(phase),old_identity:null};if(phase==='saving')recovery.failure={code:'DEVICE_RECOVERY_BLOCKED',message:'atomic save permission denied'} as any;
 await page.addInitScript(recovery=>{(window as any).deviceOverride={state:['draining'].includes(recovery.phase)?'draining':'pairing',hive:'https://hive.example',name:'My Mac',...(recovery.phase==='draining'?{user_code:recovery.pairing!.code,verification_url:recovery.pairing!.verification_url,expires_at:recovery.pairing!.expires_at,poll_interval_seconds:2}:{}),recovery};},recovery);
 await page.goto('/');await expect(page.getByText(phase==='saving'?'本机保存未完成，需重新核对':copy,{exact:true})).toBeVisible();await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 expect(await deviceCalls(page,'device_begin')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
});
test('revoked credential recovery asks before preparing and preserves one transaction across navigation',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.deviceFailure={code:'device_replaced',message:'HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'Old Mac',device_id:'old-1',owner_id:'old-owner',binding_revision:1};});await page.goto('/');
 await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('button',{name:'重新绑定设备',exact:true})).toBeFocused();
 expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
 await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(1);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(1);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
});
test('restarted unknown recovery queries the existing transaction without writes',async({page})=>{
 await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.deviceFailure={code:'invalid_device_credential',message:'HTTP 401 invalid_device_credential'};},recoveryView('redemption_unknown'));
 await page.goto('/');await expect(page.getByText('兑换结果未知，正在核对新设备身份',{exact:true})).toBeVisible();await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect.poll(async()=>(await deviceCalls(page,'device_recovery_status')).length).toBeGreaterThan(1);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
});
test('adopting a different owner requires its own current revision confirmation',async({page})=>{
 await page.addInitScript(recovery=>{(window as any).recovery=recovery;},recoveryView('awaiting_owner_confirmation'));await page.goto('/');
 await expect(page.getByText('new@example.test',{exact:true})).toBeVisible();await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
 await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(page.getByText('上次重新绑定已完成，未自动开始贡献。',{exact:true})).toBeVisible();expect(await deviceCalls(page,'runtime_start')).toHaveLength(0);expect(await deviceCalls(page,'account_action')).toHaveLength(0);
});
test('local expiry waits for Hive confirmation before offering another pairing request',async({page})=>{
 await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});
 await page.addInitScript(()=>{(window as any).deviceOverride={state:'pending',hive:'https://hive.example',name:'My Mac',user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+500).toISOString(),poll_interval_seconds:2};});
 await page.goto('/');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await page.clock.runFor(1001);
 await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toHaveCount(0);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
 await page.evaluate(()=>{(window as any).deviceOverride.state='expired';});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toBeEnabled();expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
});
test('a stale owner dialog cannot submit after the coordinator sees a newer transaction revision',async({page})=>{
 await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});await page.addInitScript(recovery=>{(window as any).recovery=recovery;},recoveryView('awaiting_owner_confirmation'));await page.goto('/');
 await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.evaluate(()=>{(window as any).recovery.revision=5;});await page.clock.runFor(10001);await expect.poll(async()=>(await deviceCalls(page,'device_recovery_status')).length).toBeGreaterThan(1);
 await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'actual=5 expected=4'})).toBeVisible();expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);
});
