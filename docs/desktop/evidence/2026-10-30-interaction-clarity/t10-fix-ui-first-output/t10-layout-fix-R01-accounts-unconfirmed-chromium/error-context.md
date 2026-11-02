# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-fix.spec.ts >> R01-accounts-unconfirmed
- Location: tests/t10-layout-fix.spec.ts:35:129

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: locator('body')
Expected substring: not "REPLY_INVALID"
Received string: "Bee概览AI 账号诊断设置hive.example状态待确认Bee Desktop设备与平台控制本机设备概览打开 Hive 控制台状态待确认开始后建立连接；接单需单独恢复。开始贡献请先核对本机贡献状态。Bee 状态待确认Hive 状态待确认贡献状态待确认，等待已安排的核对。本机设备重新核对设备本机设备Bee Desktop上次确认的设备，当前待核对。归属账号owner@example.test设备所属账号Hivehttps://hive.example配对不会自动开始贡献本次操作失败，原因尚未确认。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: unknown_failure
失败环节: desktop_refresh
原始原因: RUNTIME_REPLY_INVALID: runtime error code rejectedAI 账号等待自动重试…接入数量待确认OpenAI账号状态尚未确认状态待更新等待自动重试… 2026年11月3日 03:43:16额度尚未核对✳Claude账号状态尚未确认状态待更新等待自动重试… 2026年11月3日 03:43:16额度尚未核对授权信息保留在本机Bee设备绑定不自动开始贡献
"
Timeout: 5000ms

Call log:
  - Expect "not toContainText" locator('body') with timeout 5000ms
  - waiting for locator('body')
    14 × locator resolved to <body>…</body>
       - unexpected value "Bee概览AI 账号诊断设置hive.example状态待确认Bee Desktop设备与平台控制本机设备概览打开 Hive 控制台状态待确认开始后建立连接；接单需单独恢复。开始贡献请先核对本机贡献状态。Bee 状态待确认Hive 状态待确认贡献状态待确认，等待已安排的核对。本机设备重新核对设备本机设备Bee Desktop上次确认的设备，当前待核对。归属账号owner@example.test设备所属账号Hivehttps://hive.example配对不会自动开始贡献本次操作失败，原因尚未确认。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: unknown_failure
失败环节: desktop_refresh
原始原因: RUNTIME_REPLY_INVALID: runtime error code rejectedAI 账号等待自动重试…接入数量待确认OpenAI账号状态尚未确认状态待更新等待自动重试… 2026年11月3日 03:43:16额度尚未核对✳Claude账号状态尚未确认状态待更新等待自动重试… 2026年11月3日 03:43:16额度尚未核对授权信息保留在本机Bee设备绑定不自动开始贡献
"

```

```yaml
- complementary:
  - text: Bee
  - navigation "主导航":
    - button "概览"
    - button "AI 账号"
    - button "诊断"
    - button "设置"
  - text: hive.example
  - paragraph: 状态待确认
  - text: Bee Desktop 设备与平台控制
- banner: 本机设备
- main:
  - heading "概览" [level=1]
  - button "打开 Hive 控制台"
  - region "贡献运行":
    - heading "状态待确认" [level=2]
    - paragraph: 开始后建立连接；接单需单独恢复。
    - button "开始贡献" [disabled]
    - paragraph: 请先核对本机贡献状态。
    - text: Bee 状态待确认 Hive 状态待确认
    - status: 贡献状态待确认，等待已安排的核对。
  - region "设备配对":
    - heading "本机设备" [level=2]
    - button "重新核对设备"
    - paragraph: 本机设备
    - strong: Bee Desktop
    - status: 上次确认的设备，当前待核对。
    - paragraph: 归属账号
    - strong: owner@example.test
    - text: 设备所属账号
    - paragraph: Hive
    - strong: https://hive.example
    - text: 配对不会自动开始贡献
    - alert:
      - paragraph: 本次操作失败，原因尚未确认。
      - paragraph: 本次操作未能完成；后续状态以重新核对的结果为准。
      - group: 查看失败详情
  - region "平台账号列表":
    - heading "AI 账号" [level=2]
    - status: 等待自动重试…
    - text: 接入数量待确认
    - region "OpenAI 账号":
      - heading "OpenAI" [level=3]
      - paragraph: 账号状态尚未确认
      - paragraph: 状态待更新
      - paragraph:
        - text: 等待自动重试…
        - time: 2026年11月3日 03:43:16
      - text: 额度 尚未核对
      - progressbar "已用额度"
    - region "Claude 账号":
      - heading "Claude" [level=3]
      - paragraph: 账号状态尚未确认
      - paragraph: 状态待更新
      - paragraph:
        - text: 等待自动重试…
        - time: 2026年11月3日 03:43:16
      - text: 额度 尚未核对
      - progressbar "已用额度"
    - paragraph: 授权信息保留在本机
- contentinfo: Bee 设备绑定不自动开始贡献
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
> 24  |  await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
      |                                         ^ Error: expect(locator).not.toContainText(expected) failed
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
  48  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',exact:true})).toBeVisible();
  49  |  if(scene==='runtime-accounts-unconfirmed')await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  50  |  await zeroWrites(page);
  51  | });
  52  | 
  53  | for(const [id,code,check,message]of [
  54  |  ['S05-config-invalid','DEVICE_CONTEXT_INVALID','device_context','configuration decode failed: invalid JSON at byte=19; file retained=true'],
  55  |  ['S05-protocol-mismatch','PROTOCOL_VERSION_MISMATCH','bridge_hello','hello protocol actual=2 required=1; child rejected=true'],
  56  |  ['S05-integrity-blocked','SIDECAR_INTEGRITY_FAILED','sidecar_verify','sidecar digest actual=qa-tampered required=sealed-sha256; spawn_allowed=false']
  57  | ])test(id,async({page},info)=>{
  58  |  await install(page);await page.addInitScript(({id,code,check,message})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  59  |   if((id==='S05-config-invalid'&&command==='device_context')||(id!=='S05-config-invalid'&&command==='bridge_status')){
  60  |    w.calls.push({command,args});const error={code,message,details:{check,observed_at:new Date().toISOString(),evidence:{actual:id==='S05-config-invalid'?'invalid JSON':id==='S05-protocol-mismatch'?'2':'qa-tampered',required:id==='S05-config-invalid'?'valid saved configuration':id==='S05-protocol-mismatch'?'1':'sealed-sha256'}}};
  61  |    return id==='S05-config-invalid'?{result:{binding_revision:1,error}}:{state:'failed',error};
  62  |   }return invoke(command,args);
  63  |  };},{id,code,check,message});
  64  |  await page.goto('/');await expect(page.locator('main')).toContainText(code);
  65  |  const failure=page.locator('main .problem-notice').first();await failure.getByText('查看失败详情',{exact:true}).click();await expect(failure).toContainText(message);
  66  |  if(id==='S05-config-invalid')await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  67  |  else expect(await calls(page,'runtime_snapshot')).toEqual([]);
  68  |  await zeroWrites(page);await evidence(page,info,id,{code,check,message,syntheticFailure:true},failure);
  69  | });
  70  | 
  71  | test('L02-running-login-stop-entry',async({page},info)=>{
  72  |  await install(page,{}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  73  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  74  |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).toContainText('官方登录前请先停止贡献');
  75  |  await evidence(page,info,'L02-running-login-disabled',{local:'running',selectedPlatforms:['openai','claude']},dialog.getByText('官方登录前请先停止贡献',{exact:true}));
  76  |  await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  77  |  expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
  78  |  await evidence(page,info,'L02-stop-entry',{navigated:true,stoppedAutomatically:false});
  79  | });
  80  | 
  81  | for(const mode of ['unread','empty','loading','filtered-rotation'])test('G05-logs-'+mode,async({page},info)=>{
  82  |  await install(page);await page.addInitScript(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  83  |   if(command==='diagnostic_logs'){
  84  |    if(mode==='empty'||mode==='loading'){w.calls.push({command,args});return mode==='loading'?new Promise(()=>{}):{entries:[],next_cursor:null,truncated:false};}
  85  |    const result=await invoke(command,args);if(mode==='filtered-rotation')result.truncated=true;return result;
  86  |   }return invoke(command,args);
  87  |  };},mode);await ready(page);await nav(page,'诊断').click();await page.getByRole('tab',{name:'安全日志',exact:true}).click();
  88  |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  89  |  if(mode==='filtered-rotation'){
  90  |   await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
  91  |  }
  92  |  if(mode==='unread')await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
  93  |  else{
  94  |   await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  95  |   if(mode==='empty')await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
  96  |   if(mode==='loading'){await expect(page.getByText('正在读取日志…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeDisabled();}
  97  |   if(mode==='filtered-rotation'){
  98  |    await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');await expect(page.getByText('较早日志已轮转移除；此处仅显示保留范围。',{exact:true})).toBeVisible();
  99  |    expect((await calls(page,'diagnostic_logs'))[0].args.query).toEqual({cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'});
  100 |    await evidence(page,info,'G05-logs-filtered-more',{filters:{module:'accounts',platform:'openai',level:'warning'},truncated:true});
  101 |    await page.getByRole('button',{name:'加载更多日志',exact:true}).click();await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);
  102 |   }
  103 |  }
  104 |  await zeroWrites(page);expect(await calls(page,'diagnostics_start')).toEqual([]);await evidence(page,info,'G05-logs-'+mode,{mode,manualRead:mode!=='unread'});
  105 | });
  106 | 
  107 | test('D06-initial-pairing-completed-stopped',async({page},info)=>{
  108 |  await preview(page,'device-pending');await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeVisible();
  109 |  await page.evaluate(()=>(window as any).__beePreviewApprove());await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  110 |  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');
  111 |  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  112 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();await zeroWrites(page);await evidence(page,info,'D06-bound-stopped-no-selection',{initialStage:'pending',externalApproval:'simulated',finalStage:'bound',local:'stopped'});
  113 | });
  114 | 
  115 | for(const [code,copy]of [['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test('L05-'+code,async({page},info)=>{
  116 |  await install(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'official process exited; source verification failed; verified=false',evidence:{confirmed:'false'}}}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  117 |  await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
  118 |  const message=page.getByRole('dialog').getByText(copy,{exact:true});await expect(message).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  119 |  expect(await page.evaluate(()=>(window as any).accounts.openai.operation.error.code)).toBe(code);await evidence(page,info,'L05-'+code,{operation:'authorize',state:'failed',code},message);
  120 | });
  121 | 
  122 | test('W04-stale-confirmation-disabled-zero-write',async({page},info)=>{
  123 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  124 |  await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
```