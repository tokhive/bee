import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,scene:string){
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene);
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
const replacements=new Set(['device_begin','device_recovery_start','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','supply_set_paused']);

test('English inline pairing keeps the confirmation URL accessible without approving the device',async({page})=>{
 await open(page,'recovery-pending&locale=en');
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
 await expect(counts).toContainText('可接单 —');
 await expect(counts).toContainText('需处理 —');
});

test('healthy repair is read only and leaves the current accounts and pause choices intact',async({page})=>{
 await open(page,'device-bound');
 const before=await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}));
 await page.getByRole('button',{name:'设备操作',exact:true}).click();
 await page.getByRole('menuitem',{name:'修复设备绑定',exact:true}).click();
 await expect(page.getByText('设备绑定正常，无需修复。',{exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
 expect(await page.evaluate(()=>({accounts:(window as any).accounts,paused:(window as any).paused}))).toEqual(before);
 await expect(page.locator('.device-card')).toContainText('设备绑定正常，无需修复。');
});

test('HTTP 503 cannot authorize a new pairing or imply an upgrade',async({page})=>{
 await open(page,'device-bound');
 await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>command==='device_status'?{result:{error:{code:'http_rejected',message:'GET /api/bee/identity HTTP 503 upstream unavailable',details:{check:'device_identity',observed_at:new Date().toISOString(),evidence:{http_status:'503',response_body:'upstream unavailable'}}}}}:invoke(command,args);
 });
 await page.getByRole('button',{name:'设备操作',exact:true}).click();
 await page.getByRole('menuitem',{name:'修复设备绑定',exact:true}).click();
 await expect(page.locator('.device-card')).toContainText('503');
 await expect(page.getByRole('button',{name:'重试连接',exact:true})).toBeVisible();
 await expect(page.getByText('需要更新 Bee',{exact:true})).toHaveCount(0);
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
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
 await page.getByRole('dialog').getByRole('button',{name:'确认取消',exact:true}).click();
 await expect(page.getByRole('heading',{name:'已取消重新绑定',exact:true})).toBeVisible();
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
   if(completion&&command==='device_recovery_status')return {result:{recovery:completion}};
   if(completion&&command==='device_status')return {result:{device:{state:'bound',hive:'https://hive.example',name:'Bee Desktop',identity:completion.new_identity}}};
   return invoke(command,args);
  };
 },result);
 await page.getByRole('button',{name:'重新绑定操作',exact:true}).click();await page.getByRole('menuitem',{name:'取消重新绑定',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认取消',exact:true}).click();
 if(result==='unknown')await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
 else await expect(page.getByRole('heading',{name:'设备已重新绑定',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'已取消重新绑定',exact:true})).toHaveCount(0);
 expect((await calls(page)).filter(c=>['device_recovery_start','device_begin','runtime_start','supply_set_paused'].includes(c.command))).toEqual([]);
});

test('startup binding rejection has one inline fault while preserving the known account',async({page})=>{
 await open(page,'device-recovery-confirm');
 const card=page.getByRole('region',{name:'设备与 Hive',exact:true});
 await expect(card.getByRole('alert')).toHaveCount(1);
 await expect(card.getByRole('button',{name:'修复设备绑定',exact:true})).toBeEnabled();
 await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true})).toContainText('bbbbbbbbbbbbbbbb');
 await expect(page.locator('main>.startup-recovery-notice')).toHaveCount(0);
 expect((await calls(page)).filter(c=>replacements.has(c.command))).toEqual([]);
});
