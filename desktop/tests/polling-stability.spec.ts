import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';

async function scene(page:Page,id:string){
 await page.clock.install();
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+id+'&theme=light');
 await page.waitForFunction(()=>Boolean((window as any).__beePreviewReady));
}
async function hold(page:Page,command:string,platform?:string){
 await page.evaluate(({command,platform})=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
  w.held=false;w.release=undefined;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{
   if(cmd===command&&(!platform||args?.platform===platform)){
    w.held=true;await new Promise<void>(resolve=>w.release=resolve);
    w.__TAURI_INTERNALS__.invoke=original;
    if(w.failHeldRead)throw new Error('GET fixture HTTP 503');
   }
   return original(cmd,args);
  };
 },{command,platform});
}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);

for(const id of ['running','stopped'])test('normal runtime polling keeps the main action stable: '+id,async({page})=>{
 await scene(page,id);const button=page.getByRole('button',{name:id==='running'?'停止贡献':'开始贡献',exact:true});
 await expect(button).toBeEnabled();await hold(page,'runtime_snapshot');await page.clock.runFor(2100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await expect(button).toBeEnabled();
 await expect(page.getByText('贡献状态待确认，正在自动核对…',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).release());await expect(button).toBeEnabled();
});

test('an explicit start during a runtime read waits and submits once',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(2100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'开始贡献',exact:true});await expect(button).toBeEnabled();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'runtime_start')).length).toBe(1);
 await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
});

test('a failed runtime read cancels the waiting start without replay',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(2100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'开始贡献',exact:true});await expect(button).toBeEnabled();await button.click();
 await page.evaluate(()=>{const w=window as any;w.failHeldRead=true;w.release();});
 await expect(page.getByText('贡献状态待确认，正在自动核对…',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toHaveLength(0);
 await page.clock.runFor(2200);expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('fresh supply reads keep pause available and serialize a single explicit change',async({page})=>{
 await scene(page,'running');const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});
 await hold(page,'supply_status','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=card.getByRole('button',{name:'暂停接单',exact:true});await expect(button).toBeEnabled();
 await expect(page.locator('.account-check-status')).toHaveCount(0);
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'supply_set_paused')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'supply_set_paused')).length).toBe(1);
 await expect(card.getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
});

test('pairing polling keeps the website action stable',async({page})=>{
 await scene(page,'device-pending');await hold(page,'device_status');await page.clock.runFor(2100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'打开 Hive 确认网页',exact:true});await expect(button).toBeEnabled();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();
 await page.evaluate(()=>(window as any).release());await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
});

test('account status polling never disables cancel login and the explicit cancel is not lost',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{const reply=await original(cmd,args);if(cmd==='authorize_start')w.accounts.claude.candidate={state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null};return reply;};
 });
 await page.getByRole('button',{name:'Claude 详情',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
 const button=page.getByRole('button',{name:'取消官方登录',exact:true}).last();await expect(button).toBeEnabled();
 await hold(page,'account_snapshot','claude');await page.clock.runFor(450);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);await expect(button).toBeEnabled();
 await expect(page.getByText('正在读取已有登录…',{exact:true})).toHaveCount(0);
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'authorize_cancel')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'authorize_cancel')).length).toBe(1);
 await expect(page.getByRole('dialog').getByText('操作已取消',{exact:true})).toBeVisible();
});

test('repeated runtime read failures retain feedback and continue read-only recovery',async({page})=>{
 await scene(page,'stopped');await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;w.failedRuntimeReads=0;w.failRuntimeReads=true;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{if(cmd==='runtime_snapshot'&&w.failRuntimeReads){w.failedRuntimeReads++;throw new Error('GET runtime fixture HTTP 503');}return original(cmd,args);};
 });
 for(let attempt=0;attempt<3;attempt++){
  await page.clock.runFor(2100);await expect.poll(()=>page.evaluate(()=>(window as any).failedRuntimeReads)).toBe(attempt+1);
  await expect(page.getByText('贡献状态待确认，正在自动核对…',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 }
 await page.evaluate(()=>(window as any).failRuntimeReads=false);await page.clock.runFor(2100);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('a waiting platform resume cannot apply to a replacement account',async({page})=>{
 await scene(page,'supply-paused');await hold(page,'supply_status','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'恢复接单',exact:true});
 await button.click();await expect(button).toBeDisabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.selection.fingerprint='f'.repeat(64);a.candidate.fingerprint='f'.repeat(64);a.candidate.reference='f'.repeat(48);a.authorization.fingerprint='f'.repeat(64);});
 await page.clock.runFor(2200);await expect(page.getByText('f'.repeat(16),{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).release());await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:/^(暂停|恢复)接单$/})).toBeEnabled();expect(await calls(page,'supply_set_paused')).toHaveLength(0);
});
