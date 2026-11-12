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
    if(w.failHeldRead)throw {code:'http_rejected',message:'GET fixture HTTP 503',details:{check:command==='device_status'?'device_status':'account_read',observed_at:new Date().toISOString(),evidence:{http_status:'503'}}};
   }
   return original(cmd,args);
  };
 },{command,platform});
}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);

for(const id of ['running','stopped'])test('normal runtime polling keeps automatic service feedback stable: '+id,async({page})=>{
 await scene(page,id);const button=page.getByRole('button',{name:'重试准备',exact:true}),health=page.locator('.native-runtime-health');
 if(id==='stopped')await expect(button).toBeEnabled();else await expect(button).toHaveCount(0);
 const before=await health.innerText();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 if(id==='stopped')await expect(button).toBeEnabled();else await expect(button).toHaveCount(0);expect(await health.innerText()).toBe(before);
 await expect(page.getByText('贡献状态待确认，等待已安排的核对。',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).release());if(id==='stopped')await expect(button).toBeEnabled();else await expect(button).toHaveCount(0);expect(await calls(page,'runtime_stop')).toHaveLength(0);
});

test('an explicit start during a runtime read waits and submits once',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'重试准备',exact:true});await expect(button).toBeEnabled();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'runtime_start')).length).toBe(1);
 await expect(page.locator('.native-runtime-health')).toContainText('贡献已启动');await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
});

test('a failed runtime read cancels the waiting start without replay',async({page})=>{
 await scene(page,'stopped');await hold(page,'runtime_snapshot');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('button',{name:'重试准备',exact:true});await expect(button).toBeEnabled();await button.click();
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
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{const reply=await original(cmd,args);if(cmd==='authorize_start')w.accounts.openai.candidate={state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null};return reply;};
 });
 await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.keyboard.press('Escape');
 const button=page.getByRole('button',{name:'取消登录',exact:true}).last();await expect(button).toBeEnabled();
 await hold(page,'account_snapshot','openai');await page.clock.runFor(450);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);await expect(button).toBeEnabled();
 await expect(page.getByText('正在读取已有登录…',{exact:true})).toHaveCount(0);
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'authorize_cancel')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'authorize_cancel')).length).toBe(1);
 await expect(page.getByText('已取消登录',{exact:true})).toBeVisible();
});

test('repeated runtime read failures retain feedback and continue read-only recovery',async({page})=>{
 await scene(page,'stopped');await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;w.failedRuntimeReads=0;w.failRuntimeReads=true;Math.random=()=>1;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{if(cmd==='runtime_snapshot'&&w.failRuntimeReads){w.failedRuntimeReads++;throw {code:'http_rejected',message:'GET runtime fixture HTTP 503',details:{check:'runtime_read',observed_at:new Date().toISOString(),evidence:{http_status:'503'}}};}return original(cmd,args);};
 });
 for(let attempt=0;attempt<3;attempt++){
  await page.clock.runFor([10000,2000,4000][attempt]);await expect.poll(()=>page.evaluate(()=>(window as any).failedRuntimeReads)).toBe(attempt+1);
  await expect(page.getByText('贡献状态待确认，等待已安排的核对。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'重试准备',exact:true})).toBeDisabled();
 }
 await page.evaluate(()=>(window as any).failRuntimeReads=false);await page.clock.runFor(8000);
 await expect(page.getByRole('button',{name:'重试准备',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('a waiting platform resume cannot apply to a replacement account',async({page})=>{
 await scene(page,'supply-paused');await hold(page,'supply_status','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const button=page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'恢复接单',exact:true});
 await button.click();await expect(button).toBeDisabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.selection.fingerprint='f'.repeat(64);a.candidate.fingerprint='f'.repeat(64);a.candidate.reference='f'.repeat(48);a.authorization.fingerprint='f'.repeat(64);});
 await page.evaluate(()=>(window as any).release());await expect(page.getByText('f'.repeat(16),{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:/^(暂停|恢复)接单$/})).toBeEnabled();expect(await calls(page,'supply_set_paused')).toHaveLength(0);
});

for(const outcome of ['fresh-revision','candidate-changed','hive-changed','read-failed'])test('a coordinated account confirmation revalidates the pending read: '+outcome,async({page})=>{
 await page.clock.install();
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});
 await card.getByRole('button',{name:'接入账号',exact:true}).click();
 const confirm=page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true});
 await expect(confirm).toBeEnabled();await hold(page,'account_snapshot','openai');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 const revision=await page.evaluate(outcome=>{const w=window as any;w.accounts.openai.revision++;if(outcome==='candidate-changed')w.accounts.openai.candidate.reference='f'.repeat(48);if(outcome==='hive-changed')w.accounts.openai.hive.pending_fingerprint='f'.repeat(64);if(outcome==='read-failed')w.failHeldRead=true;return w.accounts.openai.revision;},outcome);
 await confirm.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 expect(await calls(page,'account_action')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());
 if(outcome==='fresh-revision'){
  await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);
  expect((await calls(page,'account_action'))[0].args.request.revision).toBe(revision);
 }else{
  if(outcome==='candidate-changed'||outcome==='hive-changed'){await expect(card.getByRole('button',{name:'接入账号',exact:true})).toBeEnabled();await card.getByRole('button',{name:'查看错误详情',exact:true}).click();const notice=page.locator('.account-error-popover pre');await expect(notice).toContainText('ACCOUNT_CONTEXT_CHANGED');await expect(page.locator('.account-error-popover pre')).toContainText('ACCOUNT_CONTEXT_CHANGED');await page.clock.runFor(10100);await expect(notice).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(0);await page.keyboard.press('Escape');await card.getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);return;}
  else await expect(card.locator('.oa-title')).toContainText('无法更新账号状态');
  expect(await calls(page,'account_action')).toHaveLength(0);
 }
});

test('a coordinated account read recovers at the same revision and accepts the next explicit action',async({page})=>{
 await page.clock.install();
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入账号',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.snapshotFail=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='account_snapshot'&&args.platform==='openai'&&w.snapshotFail)throw {code:'http_rejected',message:'GET account_snapshot fixture HTTP 503',details:{check:'account_read',observed_at:new Date().toISOString(),evidence:{http_status:'503'}}};return invoke(command,args);};});await page.clock.runFor(10100);
 await expect(card.locator('.oa-title')).toContainText('无法更新账号状态');
 await page.evaluate(()=>(window as any).snapshotFail=false);await page.clock.runFor(10100);
 await expect(card.getByRole('button',{name:'接入账号',exact:true})).toBeEnabled();
 await page.keyboard.press('Escape');await card.getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'account_action')).length).toBe(1);
});

test('an account confirmation waiting for a failed device read is cancelled without a page error',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'接入账号',exact:true}).click();
 const confirm=page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true});await expect(confirm).toBeEnabled();
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await confirm.click();await page.evaluate(()=>{const w=window as any;w.failHeldRead=true;w.release();});
 const sharedProblem=page.getByRole('alert').filter({hasText:'本次设备状态不可确认，依赖设备身份的操作保持不可用。'});await expect(sharedProblem).toHaveCount(1);await expect(sharedProblem).toBeVisible();await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true}).getByRole('button',{name:'接入账号',exact:true})).toBeDisabled();await expect(sharedProblem.locator('pre')).toContainText('GET fixture HTTP 503');expect(await calls(page,'account_action')).toHaveLength(0);expect(pageErrors).toEqual([]);
});

// Legacy stop receipt floors are covered at the TS client and Go/Rust layers.
// The automatic-service UI exposes no daily stop action to submit that command.
for(const kind of ['start','stop'])test(kind==='start'?'central readback rejects runtime revision below the retry-preparation receipt':'running automatic service never exposes a daily stop command during polling',async({page})=>{
 await scene(page,kind==='start'?'stopped':'running');
 if(kind==='stop'){
  await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);await hold(page,'runtime_snapshot');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);await page.evaluate(()=>(window as any).release());expect(await calls(page,'runtime_stop')).toHaveLength(0);expect(await calls(page,'runtime_start')).toHaveLength(0);return;
 }
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='runtime_start'||command==='runtime_stop'){w.receiptRevision=result.result.operation.revision;w.regressRuntime=true;}if(command==='runtime_snapshot'&&w.regressRuntime)result.result.runtime.revision=w.receiptRevision-1;return result;};});
 await page.getByRole('button',{name:'重试准备',exact:true}).click();
 await expect(page.getByText('贡献状态待确认，核对已暂停。',{exact:true})).toBeVisible();
 expect(await calls(page,'runtime_'+kind)).toHaveLength(1);
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');expect(evidence.runtime.code).toBe('DESKTOP_STALE_RESULT');expect(evidence.runtime.message).toMatch(/runtime revision actual=.*required>=/);
});

test('central account readback below a successful receipt remains blocked with revision evidence',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入账号',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='account_action'){w.accounts.openai.revision=result.result.account.revision-1;w.regressAccount=true;}if(command==='account_snapshot'&&args.platform==='openai'&&w.regressAccount)result.result.account.revision=w.accounts.openai.revision;return result;};});
 await page.keyboard.press('Escape');await card.getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card.locator('.oa-title')).toContainText('接入账号未完成');expect(await calls(page,'account_action')).toHaveLength(1);
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');const problem=evidence.accounts.openai;expect(problem.code).toBe('DESKTOP_STALE_RESULT');expect(problem.message).toMatch(/account revision.*actual=.*required>=/);
});

for(const command of ['authorize_start','authorize_cancel'])test('central account readback enforces the '+command+' receipt revision',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
 await page.evaluate(command=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{const prior=structuredClone(w.accounts.openai),result=await invoke(name,args);if(name===command){w.accounts.openai=prior;w.regressAuthorize=true;}return result;};},command);
 await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.keyboard.press('Escape');
 if(command==='authorize_cancel')await page.getByRole('button',{name:'取消登录',exact:true}).last().click();
 await expect.poll(()=>page.evaluate(()=>(window as any).regressAuthorize)).toBe(true);
 for(let i=0;i<3&&await page.getByRole('dialog').count();i++)await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');const problem=evidence.accounts.openai;expect(problem.code).toBe('DESKTOP_STALE_RESULT');expect(problem.message).toMatch(/account revision.*actual=.*required>=/);
 expect(await calls(page,command)).toHaveLength(1);
});

for(const action of ['start','stop'])test(action==='start'?'waiting retry preparation rechecks identity and never submits after rejection':'identity change while running exposes no daily stop or preparation write',async({page})=>{
 await scene(page,action==='start'?'stopped':'running');await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='device_status'&&w.identityDenied?{result:{error:{code:'device_replaced',message:'fixture identity HTTP 401'}}}:invoke(command,args);});await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 if(action==='start')await page.getByRole('button',{name:'重试准备',exact:true}).click();else await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.identityDenied=true;w.release();});
 await expect(page.locator('.app-shell')).toHaveAttribute('data-desktop-status','rejected');await expect(page.getByRole('button',{name:'重试准备',exact:true}).and(page.locator(':enabled'))).toHaveCount(0);
 await page.clock.runFor(10100);expect(await calls(page,'runtime_'+action)).toHaveLength(0);
});

for(const outcome of ['identity','runtime','features'])test('official login waiting on a shared read rechecks '+outcome,async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='runtime_snapshot'&&w.forceRunning){result.result.runtime.local='running';result.result.runtime.run_id='a'.repeat(32);}return result;};});
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.keyboard.press('Escape');
 await page.evaluate(outcome=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;if(outcome==='identity')w.deviceFail=true;if(outcome==='features')w.accounts.openai.features.authorize={available:false,reason:'update_pending'};if(outcome==='runtime')w.forceRunning=true;w.release();},outcome);
 if(outcome==='identity')await expect.poll(async()=>(await calls(page,'authorize_start')).length).toBe(1);
 else{await page.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.locator('.account-error-popover pre')).toContainText('ACCOUNT_CONTEXT_CHANGED');expect(await calls(page,'authorize_start')).toHaveLength(0);}
});


test('retry A waits for the original request then recovers without changing Hive connection or replaying writes',async({page})=>{
 await scene(page,'running');await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));
 await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;Math.random=()=>1;w.retryAttempts=0;w.retryFailure=true;
  w.retryRequest={id:'shell-700',method:'supply_status',platform:'openai'};
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='supply_status'&&args.platform==='openai'){
    w.retryAttempts++;if(w.retryFailure){w.pendingRequests=[w.retryRequest];throw {code:'RESPONSE_TIMEOUT',message:'supply response deadline elapsed; original request remains in flight',details:{check:'bridge_request',observed_at:new Date().toISOString(),evidence:{request_id:'shell-700',method:'supply_status',platform:'openai',phase:'response',queue_ms:'0',execution_ms:'15000',fully_sent:'true',in_flight:'true'}}};}
   }
   return original(command,args);
  };
 });
 await page.clock.runFor(10000);
 const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});
 await expect(page.getByText('前次核对尚未结束，结束后重试。',{exact:true})).toBeVisible();
 await expect(page.getByText('Hive 已连接',{exact:true})).toBeVisible();
 const runtimeReads=(await calls(page,'runtime_snapshot')).length;
 await page.clock.runFor(20000);expect(await page.evaluate(()=>(window as any).retryAttempts)).toBe(1);expect((await calls(page,'runtime_snapshot')).length).toBe(runtimeReads);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'概览',exact:true}).click();await expect(card).toBeVisible();
 await page.evaluate(()=>{const w=window as any;w.retryFailure=false;w.pendingRequests=[];w.emitRequestSettled(w.retryRequest);});
 await expect(page.getByText('等待自动重试…',{exact:true})).toBeVisible();
 await page.clock.runFor(999);expect(await page.evaluate(()=>(window as any).retryAttempts)).toBe(1);
 await page.clock.runFor(1);await expect.poll(()=>page.evaluate(()=>(window as any).retryAttempts)).toBe(2);
 await expect(page.getByText('前次核对尚未结束，结束后重试。',{exact:true})).toHaveCount(0);
 for(const method of ['runtime_start','runtime_stop','account_action','supply_set_paused'])expect(await calls(page,method)).toHaveLength(0);
});

test('Claude account status polling never disables cancel login and the explicit cancel is not lost',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.evaluate(()=>{
  const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{const reply=await original(cmd,args);if(cmd==='authorize_start')w.accounts.claude.candidate={state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null};return reply;};
 });
 await page.getByRole('button',{name:'Claude 详情',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();
 await page.getByRole('region',{name:'Claude 登录状态',exact:true}).getByRole('button',{name:'继续登录',exact:true}).click();
 const button=page.getByRole('region',{name:'Claude 登录状态',exact:true}).getByRole('button',{name:'取消登录',exact:true});await expect(button).toBeEnabled();
 await hold(page,'account_snapshot','claude');await page.clock.runFor(450);
 await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);await expect(button).toBeEnabled();
 await expect(page.getByText('正在读取已有登录…',{exact:true})).toHaveCount(0);
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toBeDisabled();expect(await calls(page,'authorize_cancel')).toHaveLength(0);
 await page.evaluate(()=>(window as any).release());await expect.poll(async()=>(await calls(page,'authorize_cancel')).length).toBe(1);
 const login=page.getByRole('region',{name:'Claude 登录状态',exact:true});
 await expect(login.getByText('本次登录已取消',{exact:true})).toBeVisible();
 await expect(login).toContainText('官方客户端可能已保存登录，可以检查当前登录后继续。');
});


for(const command of ['authorize_start','authorize_cancel'])test('Claude central account readback enforces the '+command+' receipt revision',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'Claude 详情',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true})).toBeEnabled();
 await page.evaluate(command=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{const prior=structuredClone(w.accounts.claude),result=await invoke(name,args);if(name===command){w.accounts.claude=prior;w.regressAuthorize=true;}return result;};},command);
 await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();await page.getByRole('region',{name:'Claude 登录状态',exact:true}).getByRole('button',{name:'继续登录',exact:true}).click();
 if(command==='authorize_cancel')await page.getByRole('region',{name:'Claude 登录状态',exact:true}).getByRole('button',{name:'取消登录',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).regressAuthorize)).toBe(true);
 for(let i=0;i<3&&await page.getByRole('dialog').count();i++)await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 const evidence=JSON.parse(await page.locator('.native-diagnostic-evidence pre').textContent()??'null');const problem=evidence.accounts.openai??evidence.accounts.claude;expect(problem.code).toBe('DESKTOP_STALE_RESULT');expect(problem.message).toMatch(/account revision.*actual=.*required>=/);
 expect(await calls(page,command)).toHaveLength(1);
});


for(const outcome of ['identity','runtime','features'])test('Claude official login waiting on a shared read rechecks '+outcome,async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('button',{name:'Claude 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='runtime_snapshot'&&w.forceRunning){result.result.runtime.local='running';result.result.runtime.run_id='a'.repeat(32);}return result;};});
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).held)).toBe(true);
 await page.getByRole('region',{name:'Claude 登录状态',exact:true}).getByRole('button',{name:'继续登录',exact:true}).click();
 await page.evaluate(outcome=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;if(outcome==='identity')w.deviceFail=true;if(outcome==='features')w.accounts.claude.features.authorize={available:false,reason:'update_pending'};if(outcome==='runtime')w.forceRunning=true;w.release();},outcome);
 if(outcome==='identity')await expect.poll(async()=>(await calls(page,'authorize_start')).length).toBe(1);
 else{await expect(page.getByText('账号提交条件已经变化，本次未提交。',{exact:true}).last()).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(0);}
});
