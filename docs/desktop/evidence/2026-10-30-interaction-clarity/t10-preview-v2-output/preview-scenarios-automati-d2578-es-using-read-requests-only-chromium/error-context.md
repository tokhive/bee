# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview-scenarios.spec.ts >> automatic recovery traverses stale, failed, retrying and recovered states using read requests only
- Location: tests/preview-scenarios.spec.ts:53:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.account-check-status')
Expected: "等待已安排的核对…"
Received: "等待自动重试…"
Timeout:  6000ms

Call log:
  - Expect "toHaveText" locator('.account-check-status') with timeout 6000ms
  - waiting for locator('.account-check-status')
    9 × locator resolved to <span role="status" class="account-check-status">等待自动重试…</span>
      - unexpected value "等待自动重试…"

```

```yaml
- status: 等待自动重试…
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | 
  3   | async function openScene(page:Page,scene:string){
  4   |  await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene+'&theme=light');
  5   |  await page.waitForFunction(()=>Boolean((window as unknown as {__beePreviewReady?:boolean;__beePreviewError?:string}).__beePreviewReady||(window as unknown as {__beePreviewError?:string}).__beePreviewError));
  6   |  expect(await page.evaluate(()=>(window as unknown as {__beePreviewError?:string}).__beePreviewError)).toBeUndefined();
  7   | }
  8   | const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
  9   | const commands=(page:Page)=>page.evaluate(()=>(window as unknown as {calls:{command:string;args:Record<string,unknown>}[]}).calls);
  10  | const writes=new Set(['account_action','authorize_start','supply_set_paused','runtime_start','runtime_stop']);
  11  | 
  12  | const cases:[string,string|RegExp][]=[
  13  |  ['device-unbound','连接本机设备'],['device-pending','等待网页确认'],['device-expired','Hive 已确认配对码过期'],['device-bound','设备已绑定。'],['device-error','HTTP 503'],
  14  |  ['stopped','贡献尚未启动'],['runtime-starting','正在启动贡献'],['running','可接单'],['runtime-stopping','正在停止贡献'],['runtime-disconnected',/Hive 未连接|正在重新连接 Hive/],['runtime-unknown','等待已安排的核对'],
  15  |  ['account-reading','正在读取已有登录'],['account-empty','所选来源未找到登录'],['account-candidate','已有登录，尚未接入'],['account-selected','已用 3%'],['account-error','permission_denied'],['account-expired','历史数据，已过期'],['account-change','尚未核对'],
  16  |  ['supply-ready','可接单'],['supply-paused','恢复接单'],['supply-blocked','管理员尚未配置套餐并发上限'],['supply-partial','等待自动重试'],
  17  |  ['check-background','可接单'],['check-expired','核对中…'],['check-waiting','等待自动重试…'],['check-retrying','重试中…'],['check-recovered','可接单'],['check-sequence','可接单'],
  18  |  ['quota-normal','已用 3%'],['quota-unknown','尚未核对'],['quota-expired','历史数据，已过期'],['quota-multiple','7 日 · opus'],['quota-over','已用 120%'],
  19  |  ['confirm-login','开始官方登录'],['confirm-select','确认接入'],['confirm-stop','确认停止'],['confirm-change','确认更换'],['confirm-clear','确认取消接入'],['account-detail','凭证读取方式'],
  20  | ];
  21  | for(const [scene,copy] of cases)test('scene renders formal state without invalid data or unintended writes: '+scene,async({page})=>{
  22  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  23  |  await openScene(page,scene);
  24  |  await expect(page.locator('body')).toContainText(copy,{timeout:18000});
  25  |  expect(errors).toEqual([]);
  26  |  await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
  27  |  const submitted=(await commands(page)).filter(call=>writes.has(call.command));
  28  |  expect(submitted.map(call=>call.command)).toEqual(scene==='runtime-unknown'?['runtime_start']:[]);
  29  |  if(scene==='check-expired'||scene==='check-waiting'||scene==='check-retrying'){
  30  |   await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  31  |   await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
  32  |  }
  33  |  if(scene==='supply-partial'){
  34  |   await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
  35  |   await expect(card(page,'Claude').getByText('可接单',{exact:true})).toHaveCount(0);
  36  |  }
  37  | });
  38  | 
  39  | test('review selector covers approved groups and preserves scene when theme or size changes',async({page})=>{
  40  |  await page.goto('/.cache/bee-shadcn-review.html?scene=running&theme=light&size=normal');
  41  |  await expect(page.locator('#scene optgroup')).toHaveCount(10);
  42  |  await expect(page.locator('#scene option')).toHaveCount(74);
  43  |  await page.locator('#scene').selectOption('confirm-change');
  44  |  const app=page.frameLocator('iframe');
  45  |  await expect(app.getByRole('dialog').last()).toContainText('要换成');
  46  |  await page.locator('#theme').selectOption('dark');
  47  |  await page.locator('#size').selectOption('narrow');
  48  |  await expect(page.locator('#scene')).toHaveValue('confirm-change');
  49  |  await expect(app.getByRole('dialog').last()).toContainText('要换成');
  50  |  await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>({width:el.contentWindow!.innerWidth,height:el.contentWindow!.innerHeight,theme:el.contentDocument!.documentElement.dataset.theme}))).toEqual({width:860,height:600,theme:'dark'});
  51  | });
  52  | 
  53  | test('automatic recovery traverses stale, failed, retrying and recovered states using read requests only',async({page})=>{
  54  |  await openScene(page,'check-sequence');
  55  |  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
  56  |  test.setTimeout(45000);
> 57  |  await expect(page.locator('.account-check-status')).toHaveText('等待已安排的核对…',{timeout:6000});
      |                                                      ^ Error: expect(locator).toHaveText(expected) failed
  58  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  59  |  await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
  60  |  await expect(page.locator('.account-check-status')).toHaveText('核对中…',{timeout:15000});
  61  |  await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…');
  62  |  await expect(page.locator('.account-check-status')).toHaveText('重试中…',{timeout:15000});
  63  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  64  |  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible({timeout:8000});
  65  |  await expect(page.locator('.account-check-status')).toHaveCount(0);
  66  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  67  | });
  68  | 
  69  | test('preview pairing remains pending after a poll and simulated website confirmation binds the device',async({page})=>{
  70  |  await openScene(page,'device-unbound');
  71  |  await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
  72  |  await page.getByRole('button',{name:'生成配对码',exact:true}).click();
  73  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  74  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='device_status').length).toBeGreaterThan(1);
  75  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  76  |  await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
  77  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  78  |  await page.evaluate(()=>(window as unknown as {__beePreviewApprove:()=>void}).__beePreviewApprove());
  79  |  await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
  80  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  81  | });
  82  | 
  83  | test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
  84  |  await openScene(page,'confirm-select');
  85  |  await page.getByRole('button',{name:'确认接入',exact:true}).click();
  86  |  await expect(card(page).getByText('接入已完成，该平台保持暂停。')).toBeVisible();
  87  |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  88  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  89  |  await page.getByRole('button',{name:'概览',exact:true}).click();
  90  |  const readsBeforeStart=(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length;
  91  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  92  |  // The shared formal supply model refreshes on its existing 10-second read cycle.
  93  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length,{timeout:15000}).toBeGreaterThan(readsBeforeStart);
  94  |  await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
  95  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  96  |  expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toEqual([]);
  97  | });
  98  | 
  99  | for(const scene of ['confirm-change','account-change'])test('confirmed changed identity cannot inherit the prior account quota: '+scene,async({page})=>{
  100 |  await openScene(page,scene);
  101 |  if(scene==='account-change'){
  102 |   await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  103 |   await page.getByRole('button',{name:'换号',exact:true}).click();
  104 |  }
  105 |  await page.getByRole('button',{name:'确认更换',exact:true}).click();
  106 |  await page.getByRole('button',{name:'关闭',exact:true}).click();
  107 |  await expect(card(page).getByText('换号已完成，该平台保持暂停。')).toBeVisible();
  108 |  const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
  109 |  expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
  110 |  expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
  111 |  expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
  112 |  expect(state.paused).toBe(true);
  113 |  await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
  114 |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  115 | });
  116 | 
```