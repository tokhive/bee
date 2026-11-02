# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-fix.spec.ts >> R01-account-reads-pending-shared-state-confirmed
- Location: tests/t10-layout-fix.spec.ts:53:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'OpenAI 账号', exact: true })
Expected substring: "账号状态尚未确认"
Received string:    "OpenAI尚未接入 OpenAI 账号不能接单所选来源的登录状态待确认。Hive 未看到此平台的 Bee 连接请在概览核对贡献运行和实际连接原因。查看连接额度尚未核对"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: 'OpenAI 账号', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'OpenAI 账号', exact: true })
    14 × locator resolved to <section tabindex="-1" aria-label="OpenAI 账号" class="native-account-row" data-nav-section="account" data-nav-platform="openai" data-account-platform="openai">…</section>
       - unexpected value "OpenAI尚未接入 OpenAI 账号不能接单所选来源的登录状态待确认。Hive 未看到此平台的 Bee 连接请在概览核对贡献运行和实际连接原因。查看连接额度尚未核对"

```

```yaml
- region "OpenAI 账号":
  - heading "OpenAI" [level=3]
  - paragraph: 尚未接入 OpenAI 账号
  - paragraph: 不能接单
  - paragraph: 所选来源的登录状态待确认。
  - list:
    - listitem:
      - text: Hive 未看到此平台的 Bee 连接
      - paragraph: 请在概览核对贡献运行和实际连接原因。
      - button "查看连接"
  - text: 额度 尚未核对
  - progressbar "已用额度"
```

# Test source

```ts
  1   | import {test,expect,type Page,type TestInfo,type Locator} from '@playwright/test';
  2   | import {writeFileSync} from 'node:fs';
  3   | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  4   | 
  5   | const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  6   | const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
  7   | const writes=['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save'];
  8   | const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
  9   | function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
  10  | async function install(page:Page,scenarios:any={},accounts={openai:accountFixture('openai'),claude:accountFixture('claude')}){
  11  |  await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  12  |  page.on('pageerror',e=>{throw e;});
  13  |  await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios,accounts});
  14  | }
  15  | async function ready(page:Page){await page.goto('/');await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();}
  16  | async function preview(page:Page,scene:string){
  17  |  await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  18  |  await page.goto('/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene,locale:'zh',theme:'light'}));
  19  |  await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
  20  |  expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
  21  | }
  22  | async function zeroWrites(page:Page){expect(await page.evaluate(writes=>(window as any).calls.filter((c:any)=>writes.includes(c.command)),writes)).toEqual([]);}
  23  | async function evidence(page:Page,info:TestInfo,id:string,preconditions:unknown,focus?:Locator){
  24  |  await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
  25  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);
  26  |  await page.screenshot({path:info.outputPath(id+'-entry.png'),fullPage:true});
  27  |  if(focus){await focus.scrollIntoViewIfNeeded();await expect(focus).toBeInViewport();}
  28  |  const screenshot=info.outputPath(id+'.png');await page.screenshot({path:screenshot,fullPage:true});
  29  |  const actual=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},width:document.documentElement.scrollWidth,body:document.body.innerText,main:document.querySelector('main')?.textContent,status:document.querySelector('.app-shell')?.getAttribute('data-desktop-status'),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),actions:[...document.querySelectorAll('main button,[role=dialog] button')].map(e=>({text:e.textContent,disabled:(e as HTMLButtonElement).disabled,rect:e.getBoundingClientRect().toJSON()})),accounts:(window as any).accounts,calls:(window as any).calls,scene:(window as any).__beePreviewScene,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}));
  30  |  expect(actual.reducedMotion).toBe(true);
  31  |  for(const dialog of actual.dialogs){expect(dialog.rect.x).toBeGreaterThanOrEqual(0);expect(dialog.rect.right).toBeLessThanOrEqual(861);expect(dialog.rect.y).toBeGreaterThanOrEqual(0);expect(dialog.rect.bottom).toBeLessThanOrEqual(601);}
  32  |  writeFileSync(info.outputPath(id+'.json'),JSON.stringify({id,observed_at:new Date().toISOString(),layer:'正式 NativeApp＋模拟 IPC；仅断言的组件子路径，不证明真实官方/OS副作用',preconditions,actual,screenshot},null,2));
  33  | }
  34  | 
  35  | for(const [scene,id]of [['runtime-no-accounts','R01-no-selection'],['runtime-accounts-unconfirmed','R01-accounts-unconfirmed']])test(id,async({page},info)=>{
  36  |  await preview(page,scene);await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  37  |  if(scene==='runtime-no-accounts'){
  38  |   expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  39  |   await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先接入至少一个 AI 账号。');
  40  |   await expect(page.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
  41  |  }else{
  42  |   await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  43  |   await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先核对本机贡献状态。');
  44  |   await expect(page.locator('main')).not.toContainText('0 个已接入');
  45  |   expect(await calls(page,'account_snapshot')).toEqual([]);
  46  |  }
  47  |  await evidence(page,info,id,{scene,accountFactsConfirmed:scene==='runtime-no-accounts'});
  48  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeVisible();
  49  |  if(scene==='runtime-accounts-unconfirmed')await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  50  |  await zeroWrites(page);
  51  | });
  52  | 
  53  | test('R01-account-reads-pending-shared-state-confirmed',async({page},info)=>{
  54  |  await install(page);await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  55  |   if(command==='account_snapshot'){w.calls.push({command,args});return new Promise(()=>{});}
  56  |   const reply=await invoke(command,args);if(command==='runtime_snapshot')w.r01Runtime=structuredClone(reply.result.runtime);if(command==='device_status')w.r01Device=structuredClone(reply.result.device);return reply;
  57  |  };});await ready(page);
  58  |  await expect.poll(async()=>(await calls(page,'account_snapshot')).map((c:any)=>c.args.platform).sort()).toEqual(['claude','openai']);
  59  |  const preconditions=await page.evaluate(()=>({sharedRuntime:(window as any).r01Runtime,device:(window as any).r01Device,accountReads:'both unresolved',accountFactsConfirmed:false}));
  60  |  expect(preconditions.device.state).toBe('bound');expect(preconditions.sharedRuntime.local).toBe('stopped');
  61  |  await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  62  |  await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('0 个已接入');
> 63  |  for(const platform of ['OpenAI','Claude'])await expect(card(page,platform)).toContainText('账号状态尚未确认');
      |                                                                              ^ Error: expect(locator).toContainText(expected) failed
  64  |  await evidence(page,info,'R01-account-reads-pending',preconditions);
  65  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeFocused();
  66  |  for(const platform of ['OpenAI','Claude']){await expect(card(page,platform)).toContainText('正在读取已有登录');await expect(card(page,platform)).toContainText('账号状态尚未确认，暂不能提交。');}
  67  |  await zeroWrites(page);await evidence(page,info,'R01-account-reads-pending-accounts',preconditions,card(page));
  68  | });
  69  | 
  70  | for(const [id,code,check,message]of [
  71  |  ['S05-config-invalid','DEVICE_CONTEXT_INVALID','device_context','configuration decode failed: invalid JSON at byte=19; file retained=true'],
  72  |  ['S05-protocol-mismatch','VERSION_MISMATCH','bridge_hello','reply protocol=2; required=1'],
  73  |  ['S05-integrity-blocked','BUNDLED_BEE_INVALID','sidecar_verify','bundled Bee SHA256 mismatch at /isolated/qa/bee: actual='+ 'a'.repeat(64)+'; required='+ 'b'.repeat(64)]
  74  | ])test(id,async({page},info)=>{
  75  |  await install(page);await page.addInitScript(({id,code,check,message})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  76  |   if((id==='S05-config-invalid'&&command==='device_context')||(id!=='S05-config-invalid'&&command==='bridge_status')){
  77  |    w.calls.push({command,args});const error={code,message,details:{check,observed_at:new Date().toISOString(),evidence:{actual:id==='S05-config-invalid'?'invalid JSON':id==='S05-protocol-mismatch'?'2':'qa-tampered',required:id==='S05-config-invalid'?'valid saved configuration':id==='S05-protocol-mismatch'?'1':'sealed-sha256'}}};
  78  |    return id==='S05-config-invalid'?{result:{binding_revision:1,error}}:{state:'failed',error:{code,message}};
  79  |   }return invoke(command,args);
  80  |  };},{id,code,check,message});
  81  |  await page.goto('/');await expect(page.locator('main')).toContainText(code);
  82  |  const failure=page.locator('main .problem-notice').first();await failure.getByText('查看失败详情',{exact:true}).click();await expect(failure).toContainText(message);
  83  |  if(id==='S05-config-invalid')await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  84  |  else expect(await calls(page,'runtime_snapshot')).toEqual([]);
  85  |  await zeroWrites(page);await evidence(page,info,id,{code,check,message,syntheticFailure:true},failure);
  86  | });
  87  | 
  88  | test('L02-running-login-stop-entry',async({page},info)=>{
  89  |  await install(page,{}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  90  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  91  |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).toContainText('官方登录前请先停止贡献');
  92  |  await evidence(page,info,'L02-running-login-disabled',{local:'running',selectedPlatforms:['openai','claude']},dialog.getByText('官方登录前请先停止贡献；前往概览停止后再返回。',{exact:true}));
  93  |  await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();await expect(page.locator('[data-nav-section=runtime]').first()).toBeFocused();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  94  |  expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
  95  |  await evidence(page,info,'L02-stop-entry',{navigated:true,stoppedAutomatically:false});
  96  | });
  97  | 
  98  | for(const mode of ['unread','empty','loading','filtered-rotation'])test('G05-logs-'+mode,async({page},info)=>{
  99  |  await install(page);await page.addInitScript(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  100 |   if(command==='diagnostic_logs'){
  101 |    if(mode==='empty'||mode==='loading'){w.calls.push({command,args});return mode==='loading'?new Promise(()=>{}):{entries:[],next_cursor:null,truncated:false};}
  102 |    const result=await invoke(command,args);if(mode==='filtered-rotation')result.truncated=true;return result;
  103 |   }return invoke(command,args);
  104 |  };},mode);await ready(page);await nav(page,'诊断').click();await page.getByRole('tab',{name:'安全日志',exact:true}).click();
  105 |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  106 |  if(mode==='filtered-rotation'){
  107 |   await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
  108 |  }
  109 |  if(mode==='unread')await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
  110 |  else{
  111 |   await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  112 |   if(mode==='empty')await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
  113 |   if(mode==='loading'){await expect(page.getByText('正在读取日志…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeDisabled();}
  114 |   if(mode==='filtered-rotation'){
  115 |    await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');await expect(page.getByText('较早日志已轮转移除；此处仅显示保留范围。',{exact:true})).toBeVisible();
  116 |    expect((await calls(page,'diagnostic_logs'))[0].args.query).toEqual({cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'});
  117 |    await evidence(page,info,'G05-logs-filtered-more',{filters:{module:'accounts',platform:'openai',level:'warning'},truncated:true});
  118 |    await page.getByRole('button',{name:'加载更多日志',exact:true}).click();await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);
  119 |   }
  120 |  }
  121 |  await zeroWrites(page);expect(await calls(page,'diagnostics_start')).toEqual([]);await evidence(page,info,'G05-logs-'+mode,{mode,manualRead:mode!=='unread'});
  122 | });
  123 | 
  124 | test('D06-initial-pairing-completed-stopped',async({page},info)=>{
  125 |  await preview(page,'device-pending');await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeVisible();
  126 |  await page.evaluate(()=>(window as any).__beePreviewApprove());await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  127 |  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');
  128 |  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  129 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();await zeroWrites(page);await evidence(page,info,'D06-bound-stopped-no-selection',{initialStage:'pending',externalApproval:'simulated',finalStage:'bound',local:'stopped'});
  130 | });
  131 | 
  132 | for(const [code,copy]of [['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test('L05-'+code,async({page},info)=>{
  133 |  await install(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'official process exited; source verification failed; verified=false',evidence:{confirmed:'false'}}}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  134 |  await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
  135 |  const message=page.getByRole('dialog').getByText(copy,{exact:true});await expect(message).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  136 |  expect(await page.evaluate(()=>(window as any).accounts.openai.operation.error.code)).toBe(code);await evidence(page,info,'L05-'+code,{operation:'authorize',state:'failed',code},message);
  137 | });
  138 | 
  139 | test('W04-stale-confirmation-disabled-zero-write',async({page},info)=>{
  140 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  141 |  await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
  142 |  await page.clock.runFor(10001);await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
  143 |  const before=await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai),oldRevision=a.revision;a.revision+=2;w.accounts.openai=a;return {oldRevision,newRevision:a.revision,candidate:a.candidate.reference};});await page.clock.runFor(10001);
  144 |  const stale=page.getByRole('dialog').last();await expect(stale.getByRole('button',{name:'确认更换',exact:true})).toBeDisabled();await expect(stale).toContainText('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。');
  145 |  expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,'W04-stale-confirmation',{...before,submitted:false});
  146 | });
  147 | 
  148 | test('W05-account-submission-unknown-keeps-original-operation',async({page},info)=>{
  149 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  150 |  await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
  151 |  await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();const operation=await page.evaluate(()=>(window as any).accounts.openai.operation);expect(operation.state).toBe('reconciling');expect(await calls(page,'account_action')).toHaveLength(1);
  152 |  await nav(page,'诊断').click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');
  153 |  await evidence(page,info,'W05-original-operation-diagnostics',{operation,submittedWrites:1},page.locator('pre'));
  154 |  await nav(page,'AI 账号').click();await page.clock.runFor(10001);expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(operation.id);expect(await calls(page,'account_action')).toHaveLength(1);expect(await calls(page,'runtime_start')).toEqual([]);
  155 |  await evidence(page,info,'W05-original-operation-unconfirmed',{operation,submittedWrites:1,readOnlyReconciliation:true},card(page));
  156 | });
  157 | 
  158 | test('A04-unsupported-store-real-reason',async({page},info)=>{
  159 |  await install(page,{unsupportedStores:{keyring:'keyring_not_supported_on_this_os'}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  160 |  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('存储方式').locator('option[value=keyring]')).toHaveAttribute('disabled','');expect(await dialog.getByLabel('存储方式').locator('option[value=keyring]').evaluate(e=>(e as HTMLOptionElement).disabled)).toBe(true);await expect(dialog).toContainText('当前系统不支持 Codex 钥匙串读取。');await expect(dialog.getByLabel('存储方式')).toHaveValue('file');
  161 |  await zeroWrites(page);await evidence(page,info,'A04-keyring-unsupported',{store:'keyring',supported:false,reason:'keyring_not_supported_on_this_os',selectedStore:'file'},dialog.getByText(/当前系统不支持 Codex 钥匙串读取/));
  162 | });
  163 | 
```