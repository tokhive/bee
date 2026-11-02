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
 await expect(button).toBeEnabled();await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await expect(button).toBeEnabled();
 await expect(page.getByText('贡献状态待确认，等待已安排的核对。',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).release());await expect(button).toBeEnabled();
});

test('an explicit start during a runtime read waits and submits once',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'开始贡献',exact:true});await expect(button).toBeEnabled();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'runtime_start')).length).toBe(1);
 await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
});

test('a failed runtime read cancels the waiting start without replay',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'开始贡献',exact:true});await expect(button).toBeEnabled();await button.click();
 await page.evaluate(()=>{const w=window as any;w.failHeldRead=true;w.release();});
 await expect(page.getByText('贡献状态待确认，等待已安排的核对。',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toHaveLength(0);
 await page.clock.runFor(10100);expect(await calls(page,'runtime_start')).toHaveLength(0);
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
 await scene(page,'device-pending');await hold(page,'device_status');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'打开 Hive 确认网页',exact:true});await expect(button).toBeEnabled();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();
 await page.evaluate(()=>(window as any).release());await expect(button).toBeEnabled();await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();expect(await calls(page,'device_open')).toHaveLength(1);expect(await calls(page,'device_begin')).toHaveLength(0);
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
 await expect(page.getByRole('dialog').getByText('官方登录进程已取消；已发生的客户端登录变化可能保留，需重新核对来源。',{exact:true})).toBeVisible();
});

test('repeated runtime read failures retain feedback and continue read-only recovery',async({page})=>{
 await scene(page,'stopped');await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;w.failedRuntimeReads=0;w.failRuntimeReads=true;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{if(cmd==='runtime_snapshot'&&w.failRuntimeReads){w.failedRuntimeReads++;throw new Error('GET runtime fixture HTTP 503');}return original(cmd,args);};
 });
 for(let attempt=0;attempt<3;attempt++){
  await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).failedRuntimeReads)).toBe(attempt+1);
  await expect(page.getByText('贡献状态待确认，等待已安排的核对。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 }
 await page.evaluate(()=>(window as any).failRuntimeReads=false);await page.clock.runFor(10100);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('a waiting platform resume cannot apply to a replacement account',async({page})=>{
 await scene(page,'supply-paused');await hold(page,'supply_status','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'恢复接单',exact:true});
 await button.click();await expect(button).toBeDisabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.selection.fingerprint='f'.repeat(64);a.candidate.fingerprint='f'.repeat(64);a.candidate.reference='f'.repeat(48);a.authorization.fingerprint='f'.repeat(64);});
 await page.evaluate(()=>(window as any).release());await expect(page.getByText('f'.repeat(16),{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:/^(暂停|恢复)接单$/})).toBeEnabled();expect(await calls(page,'supply_set_paused')).toHaveLength(0);
});

for(const outcome of ['fresh-revision','candidate-changed','read-failed'])test('a coordinated account confirmation revalidates the pending read: '+outcome,async({page})=>{
 await page.clock.install();
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});
 await card.getByRole('button',{name:'接入',exact:true}).click();
 const confirm=page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true});
 await expect(confirm).toBeEnabled();await hold(page,'account_snapshot','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const revision=await page.evaluate(outcome=>{const w=window as any;w.accounts.openai.revision++;if(outcome==='candidate-changed')w.accounts.openai.candidate.reference='f'.repeat(48);if(outcome==='read-failed')w.failHeldRead=true;return w.accounts.openai.revision;},outcome);
 await confirm.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 expect(await calls(page,'account_action')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());
 if(outcome==='fresh-revision'){
  await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);
  expect((await calls(page,'account_action'))[0].args.request.revision).toBe(revision);
 }else{
  if(outcome==='candidate-changed'){await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();const notice=card.getByText('账号提交条件已经变化，本次未提交。',{exact:true});await expect(notice).toBeVisible();await page.clock.runFor(10100);await expect(notice).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(0);await card.getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);return;}
  else await expect(card.getByText('等待自动重试…',{exact:true})).toBeVisible();
  expect(await calls(page,'account_action')).toHaveLength(0);
 }
});

test('a coordinated account read recovers at the same revision and accepts the next explicit action',async({page})=>{
 await page.clock.install();
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.snapshotFail=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='account_snapshot'&&args.platform==='openai'&&w.snapshotFail)throw new Error('GET account_snapshot fixture HTTP 503');return invoke(command,args);};});await page.clock.runFor(10100);
 await expect(card.getByText('等待自动重试…',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).snapshotFail=false);await page.clock.runFor(10100);
 await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await card.getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);
});

test('an account confirmation waiting for a failed device read is cancelled without a page error',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'接入',exact:true}).click();
 const confirm=page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true});await expect(confirm).toBeEnabled();
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await confirm.click();await page.evaluate(()=>{const w=window as any;w.failHeldRead=true;w.release();});
 const sharedProblem=page.getByRole('alert').filter({hasText:'本次设备状态不可确认，依赖设备身份的操作保持不可用。'});await expect(sharedProblem).toHaveCount(1);await expect(sharedProblem).toBeVisible();await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'接入',exact:true})).toBeDisabled();await expect(sharedProblem.locator('pre')).toContainText('GET fixture HTTP 503');expect(await calls(page,'account_action')).toHaveLength(0);expect(pageErrors).toEqual([]);
});

for(const kind of ['start','stop'])test('central readback rejects runtime revision below the '+kind+' receipt',async({page})=>{
 await scene(page,kind==='start'?'stopped':'running');
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='runtime_start'||command==='runtime_stop'){w.receiptRevision=result.result.operation.revision;w.regressRuntime=true;}if(command==='runtime_snapshot'&&w.regressRuntime)result.result.runtime.revision=w.receiptRevision-1;return result;};});
 await page.getByRole('button',{name:kind==='start'?'开始贡献':'停止贡献',exact:true}).click();
 if(kind==='stop')await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();
 await expect(page.getByText('贡献状态待确认，核对已暂停。',{exact:true})).toBeVisible();
 expect(await calls(page,'runtime_'+kind)).toHaveLength(1);
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');expect(evidence.runtime.code).toBe('DESKTOP_STALE_RESULT');expect(evidence.runtime.message).toMatch(/runtime revision actual=.*required>=/);
});

test('central account readback below a successful receipt remains blocked with revision evidence',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='account_action'){w.accounts.openai.revision=result.result.account.revision-1;w.regressAccount=true;}if(command==='account_snapshot'&&args.platform==='openai'&&w.regressAccount)result.result.account.revision=w.accounts.openai.revision;return result;};});
 await card.getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card.getByText('等待自动重试…',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');const problem=evidence.accounts.openai??evidence.accounts.claude;expect(problem.code).toBe('DESKTOP_STALE_RESULT');expect(problem.message).toMatch(/account revision.*actual=.*required>=/);
});

for(const command of ['authorize_start','authorize_cancel'])test('central account readback enforces the '+command+' receipt revision',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'Claude 详情',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true})).toBeEnabled();
 await page.evaluate(command=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{const prior=structuredClone(w.accounts.claude),result=await invoke(name,args);if(name===command){w.accounts.claude=prior;w.regressAuthorize=true;}return result;};},command);
 await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
 if(command==='authorize_cancel')await page.getByRole('button',{name:'取消官方登录',exact:true}).last().click();
 await expect.poll(()=>page.evaluate(()=>(window as any).regressAuthorize)).toBe(true);
 for(let i=0;i<3&&await page.getByRole('dialog').count();i++)await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');const problem=evidence.accounts.openai??evidence.accounts.claude;expect(problem.code).toBe('DESKTOP_STALE_RESULT');expect(problem.message).toMatch(/account revision.*actual=.*required>=/);
 expect(await calls(page,command)).toHaveLength(1);
});

for(const action of ['start','stop'])test('waiting '+action+' rechecks identity without blocking trusted local stop',async({page})=>{
 await scene(page,action==='start'?'stopped':'running');await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='device_status'&&w.identityDenied?{result:{error:{code:'device_replaced',message:'fixture identity HTTP 401'}}}:invoke(command,args);});await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await page.getByRole('button',{name:action==='start'?'开始贡献':'停止贡献',exact:true}).click();if(action==='stop')await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();
 await page.evaluate(()=>{const w=window as any;w.identityDenied=true;w.release();});
 if(action==='stop')await expect.poll(async()=>(await calls(page,'runtime_stop')).length).toBe(1);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 await page.clock.runFor(10100);expect(await calls(page,'runtime_'+action)).toHaveLength(action==='stop'?1:0);
});

for(const outcome of ['identity','runtime','features'])test('official login waiting on a shared read rechecks '+outcome,async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'Claude 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='runtime_snapshot'&&w.forceRunning){result.result.runtime.local='running';result.result.runtime.run_id='a'.repeat(32);}return result;};});
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
 await page.evaluate(outcome=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;if(outcome==='identity')w.deviceFail=true;if(outcome==='features')w.accounts.claude.features.authorize={available:false,reason:'update_pending'};if(outcome==='runtime')w.forceRunning=true;w.release();},outcome);
 if(outcome==='identity')await expect.poll(async()=>(await calls(page,'authorize_start')).length).toBe(1);
 else{await expect(page.getByText('账号提交条件已经变化，本次未提交。',{exact:true}).last()).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(0);}
});
