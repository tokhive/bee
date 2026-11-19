import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,scene:string){
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene);
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
const replacements=new Set(['device_begin','device_recovery_start','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','supply_set_paused']);

test('English inline pairing reveals the confirmation URL when copying fails without approving the device',async({page})=>{
 await open(page,'recovery-pending&locale=en');
 await expect(page.getByText('Confirmation URL',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('clipboard denied for test');}}));
 await page.getByRole('button',{name:'Copy confirmation URL',exact:true}).click();
 await page.getByText('Confirmation URL',{exact:true}).click();
 await expect(page.locator('.binding-url')).toContainText('https://hive.example/');
 await expect(page.getByRole('button',{name:'Open Hive confirmation page',exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
});

test('overview counts distinguish ready platforms, deliberate pause, and unknown binding state',async({page})=>{
 await open(page,'device-bound');
 const counts=page.getByLabel('平台接单统计',{exact:true});
 await expect(counts).toContainText('可接单 1');
 await expect(counts).toContainText('需处理 0');
 await page.getByRole('button',{name:'暂停接单',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
 await expect(counts).toContainText('可接单 0');
 await expect(counts).toContainText('需处理 0');
 await open(page,'device-recovery-confirm');
 await expect(counts).toHaveCount(0);
});

test('a healthy device menu offers switching without a repair action or writes',async({page})=>{
 await open(page,'device-bound');
 const before=await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}));
 await page.getByRole('button',{name:'设备操作',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'修复设备绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('menuitem',{name:'切换 Hive',exact:true})).toBeEnabled();
 await page.keyboard.press('Escape');
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 expect(await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}))).toEqual(before);
});

for(const [kind,title,action,message] of [
 ['http_rejected','Hive 暂不可用','重试连接','GET /api/bee/identity HTTP 503 upstream unavailable'],
 ['timeout','连接 Hive 超时','重试连接','GET identity: context deadline exceeded'],
 ['connection_refused','无法连接 Hive','重试连接','dial tcp: connect: connection refused'],
 ['unknown_failure','暂时无法确认 Hive 状态','重新核对','GET identity HTTP 500: NODE_STATE_UNRECOGNIZED'],
] as const)test(`device failure ${kind} provides its matching action without replacing the binding`,async({page})=>{
 await page.clock.install();await open(page,'device-bound');
 const before=await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}));
 await page.evaluate(({kind,message})=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>command==='device_status'?{result:{error:{code:kind,message}}}:invoke(command,args);
 },{kind,message});
 await page.clock.runFor(10001);
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await expect(page.getByLabel('平台接单统计',{exact:true})).toHaveCount(0);
 await expect(page.locator('.device-card .native-runtime-health')).toHaveCount(0);
 await expect(page.getByRole('button',{name:action,exact:true})).toBeEnabled();
 await expect(page.locator('main>.startup-recovery-notice')).toHaveCount(0);
 await expect(page.locator('.overview-accounts-card .account-conditions')).toHaveCount(0);
 await expect(page.locator('.device-card>.device-note')).toHaveCount(0);
 await expect(page.getByText('需要更新 Bee',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'修复设备绑定',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText(message);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出诊断',exact:true}).click();expect((await download).suggestedFilename()).toBe('bee-device-diagnostics.txt');
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 expect(await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}))).toEqual(before);
});

test('pairing stays inline across navigation and cancelling needs consent and a confirmed receipt',async({page})=>{
 await open(page,'recovery-pending');
 const operation=await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId);
 await expect(page.locator('.device-card')).toContainText('ABCD-EFGH');
 await expect(page.getByText('重新绑定完成后，需要重新接入 AI 账号。',{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(page.locator('.device-card')).toContainText('ABCD-EFGH');
 await page.getByRole('button',{name:'重新绑定操作',exact:true}).click();
 await page.getByRole('menuitem',{name:'取消重新绑定',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('旧设备不会自动恢复接单');
 expect((await calls(page)).filter(c=>c.command==='device_recovery_confirm')).toEqual([]);
 await page.getByRole('dialog').getByRole('button',{name:'取消重新绑定',exact:true}).click();
 await expect(page.getByRole('heading',{name:'设备尚未恢复贡献',exact:true})).toBeVisible();
 const writes=(await calls(page)).filter(c=>replacements.has(c.command));
 expect(writes.map(c=>c.command)).toEqual(['device_recovery_confirm']);
 expect(writes[0].args).toMatchObject({operationId:operation,decision:'cancel_pairing'});
 expect(await page.evaluate(()=>(window as any).__beeMockRuntimeLocal())).toBe('stopped');
});

test('local save failure offers only saving the original binding, with no new pairing or cancel',async({page})=>{
 await open(page,'recovery-saving');
 const operation=await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId);
 await expect(page.getByRole('button',{name:'继续保存',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新绑定操作',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'继续保存',exact:true}).click();
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 expect(await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId)).toBe(operation);
});

test('repair and Hive switching share the device menu and are mutually exclusive',async({page})=>{
 await open(page,'recovery-pending');
 await page.getByRole('button',{name:'设备操作',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'切换 Hive',exact:true})).toBeDisabled();
 await expect(page.getByRole('menu')).toContainText('当前修复结束后可切换 Hive');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'设备操作',exact:true})).toBeFocused();
});

for(const result of ['unknown','completed'] as const)test(`cancel receipt ${result} never claims an unconfirmed cancellation`,async({page})=>{
 await open(page,'recovery-pending');
 await page.evaluate(result=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let completion:any;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='device_recovery_confirm'&&args.decision==='cancel_pairing'){
    if(result==='unknown')return {result:{error:{code:'unavailable',message:'POST pairing cancel HTTP 503; cancellation result unconfirmed'}}};
    const reply=await invoke('device_recovery_status');const recovery=reply.result.recovery;
    completion={...recovery,revision:recovery.revision+1,phase:'completed',new_identity:recovery.old_identity,failure:null};
    return {result:{recovery:completion}};
   }
   if(completion&&(command==='device_recovery_status'||command==='device_recovery_snapshot'))return {result:{recovery:completion}};
   if(completion&&(command==='startup_status'||command==='startup_recheck')){const reply=await invoke(command,args);return {...reply,state:'ready',failure:null};}
   if(completion&&command==='device_status')return {result:{device:{state:'bound',hive:'https://hive.example',name:'Bee Desktop',identity:completion.new_identity}}};
   return invoke(command,args);
  };
 },result);
 await page.getByRole('button',{name:'重新绑定操作',exact:true}).click();await page.getByRole('menuitem',{name:'取消重新绑定',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'取消重新绑定',exact:true}).click();
 if(result==='unknown'){await expect(page.getByRole('heading',{name:'取消结果尚未确认',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'重新核对',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'重新绑定操作',exact:true})).toHaveCount(0);}
 else await expect(page.getByText('设备绑定已保存。',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'设备尚未恢复贡献',exact:true})).toHaveCount(0);
 expect((await calls(page)).filter(c=>['device_recovery_start','device_begin','runtime_start','supply_set_paused'].includes(c.command))).toEqual([]);
});

test('startup binding rejection has one inline fault while preserving the known account',async({page})=>{
 await open(page,'device-recovery-confirm');
 const card=page.getByRole('region',{name:'设备与 Hive',exact:true});
 await expect(card.getByRole('alert')).toHaveCount(1);
 await expect(card.getByRole('button',{name:'修复设备绑定',exact:true})).toBeEnabled();
 await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true})).toContainText('bbbbbbbbbbbbbbbb');
 await expect(page.locator('main>.startup-recovery-notice')).toHaveCount(0);
 await expect(page.locator('.overview-accounts-card .account-conditions')).toHaveCount(0);
 await expect(page.locator('.device-card>.device-note')).toHaveCount(0);
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
});

for(const cancelling of [false,true])test(`${cancelling?'restored cancellation':'unknown binding'} rechecks the original request once with visible progress`,async({page})=>{
 await page.clock.install();await open(page,'recovery-creation-unknown');
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));
 await page.evaluate(cancelling=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.heldRechecks=[];
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='device_recovery_confirm'&&args.decision==='continue_checking'){
    w.heldRechecks.push(args);await new Promise(resolve=>{w.releaseRecheck=resolve;});
   }
   const reply=await invoke(command,args);
   if(cancelling&&['device_recovery_snapshot','device_recovery_status','device_recovery_confirm'].includes(command)&&reply.result?.recovery)reply.result.recovery.cancel_requested=true;
   return reply;
  };
 },cancelling);
 await page.clock.runFor(10001);
 await expect(page.getByRole('heading',{name:cancelling?'取消结果尚未确认':'绑定结果尚未确认',exact:true})).toBeVisible();
 if(cancelling){
  await expect(page.getByRole('button',{name:'重新绑定操作',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toHaveCount(0);
 }
 const operation=await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId);
 await page.getByRole('button',{name:'重新核对',exact:true}).click();
 await expect(page.getByRole('heading',{name:cancelling?'正在核对取消结果…':'正在核对绑定结果…',exact:true})).toBeVisible();
 await expect(page.locator('.device-transaction').getByRole('button')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).heldRechecks)).toHaveLength(1);
 await page.evaluate(()=>(window as any).releaseRecheck());
 await expect(page.getByRole('button',{name:'重新核对',exact:true})).toBeEnabled();
 const writes=(await calls(page)).filter(c=>replacements.has(c.command));
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({command:'device_recovery_confirm',args:{operationId:operation,decision:'continue_checking'}});
});

test('completed binding feedback dismisses without losing account access or returning after navigation',async({page})=>{
 // A restart rereads the same persisted transaction, rather than creating a new fixture operation.
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> '11111111-1111-4111-8111-111111111111'}));
 await open(page,'recovery-completed');
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭绑定结果提示',exact:true}).click();
 await expect(page.getByRole('button',{name:'设备操作',exact:true})).toBeFocused();
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toHaveCount(0);
 const openai=page.getByRole('region',{name:'OpenAI 账号',exact:true});
 await openai.getByRole('button',{name:'前往接入',exact:true}).click();
 await expect(page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toHaveCount(0);
 await expect(openai.getByRole('button',{name:'前往接入',exact:true})).toBeVisible();
 await page.reload();await page.waitForFunction(()=>(window as any).__beePreviewReady);
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toHaveCount(0);
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> '22222222-2222-4222-8222-222222222222'}));
 await page.reload();await page.waitForFunction(()=>(window as any).__beePreviewReady);
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toBeVisible();
});

test('cancel submission returns to inline progress before its receipt without reporting unknown early',async({page})=>{
 await open(page,'recovery-pending');
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.cancelAttempts=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{if(command==='device_recovery_confirm'&&args.decision==='cancel_pairing'){w.cancelAttempts++;await new Promise<void>(resolve=>w.finishCancel=resolve);}return invoke(command,args);};});
 await page.getByRole('button',{name:'重新绑定操作',exact:true}).click();await page.getByRole('menuitem',{name:'取消重新绑定',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消重新绑定',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'正在取消重新绑定',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'取消结果尚未确认',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新核对',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).cancelAttempts)).toBe(1);
 await page.evaluate(()=>(window as any).finishCancel());await expect(page.getByRole('heading',{name:'设备尚未恢复贡献',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__beeMockRuntimeLocal())).toBe('stopped');expect((await calls(page)).filter(c=>['runtime_start','supply_set_paused','device_begin'].includes(c.command))).toEqual([]);
});

test('binding repair distinguishes checking the original identity from reconnecting',async({page})=>{
 await open(page,'device-recovery-confirm');await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='startup_recheck')await new Promise<void>(resolve=>w.finishRepairCheck=resolve);return invoke(command,args);};});
 await page.getByRole('button',{name:'修复设备绑定',exact:true}).click();const card=page.getByRole('region',{name:'设备与 Hive',exact:true});await expect(card.getByRole('heading',{name:'修复设备绑定',exact:true})).toBeVisible();await expect(card.getByRole('status')).toHaveText('正在检查原绑定…');await expect(card).not.toContainText('正在重试连接');await expect(card).not.toContainText('正在连接 Hive');expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).finishRepairCheck)).toBe('function');await page.evaluate(()=>(window as any).finishRepairCheck());await expect(card.getByRole('heading',{name:'请重新绑定',exact:true})).toBeVisible();expect((await calls(page)).filter(c=>c.command==='device_recovery_start')).toHaveLength(1);
});

 test('administrator-only binding failure exports the actual evidence without restarting pairing',async({page},testInfo)=>{
 await page.setViewportSize({width:1000,height:672});await page.clock.install();await open(page,'recovery-draining');
 await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   const reply=await invoke(command,args);
   if(reply.result?.recovery)reply.result.recovery.failure={code:'PAIRING_ADMIN_REQUIRED',message:'Hive old device dev-1 is blocked: task task-17: required processing record missing',details:{check:'pairing_work',observed_at:new Date().toISOString(),evidence:{}}};
   return reply;
  };
 });
 await page.clock.runFor(10001);
 await expect(page.getByRole('heading',{name:'无法继续重新绑定',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新绑定操作',exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('formal-admin-light.png')});
 await expect(page.getByRole('button',{name:'重新核对',exact:true})).toHaveCount(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出诊断',exact:true}).click();
 const result=await download;expect(result.suggestedFilename()).toBe('bee-device-diagnostics.txt');
 const stream=await result.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
 expect(text).toContain('task-17');expect(text).toContain('required processing record missing');
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 });
