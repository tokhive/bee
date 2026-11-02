# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview-scenarios.spec.ts >> scene renders formal state without invalid data or unintended writes: device-error
- Location: tests/preview-scenarios.spec.ts:21:33

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('body')
Timeout: 18000ms
- Expected substring  - 1
+ Received string     + 9

- 设备核对失败
+ Bee概览AI 账号诊断设置hive.example状态待确认Bee Desktop设备与平台控制本机设备概览打开 Hive 控制台状态待确认开始后建立连接；接单需单独恢复。开始贡献请先完成设备核对与绑定。Bee 未运行尚未建立 Hive 连接本机设备重新核对设备上次保存的设备信息：Bee Desktop · https://hive.exampleHive 拒绝了本次请求（HTTP 503）。本次设备状态不可确认，依赖设备身份的操作保持不可用。查看失败详情错误码: http_rejected
+ 失败环节: device_identity
+ 观察时间: 2026年11月3日 02:31:42
+ 目标: https://hive.example
+ 路径: /api/bee/identity
+ HTTP 状态: 503
+ 安全响应: Hive upstream temporarily unavailable
+ 原始原因: GET /api/bee/identity HTTP 503; preview upstream unavailableAI 账号接入数量待确认OpenAIPlus账号标识: bbbbbbbbbbbbbbbb状态待确认5 小时已用 3%7 日已用 2%✳Claude尚未接入 Claude 账号状态待确认所选来源暂不能提供可接入账号，请查看具体原因。额度尚未核对授权信息保留在本机Bee设备绑定不自动开始贡献
+

Call log:
  - Expect "toContainText" locator('body') with timeout 18000ms
  - waiting for locator('body')
    23 × locator resolved to <body>…</body>
       - unexpected value "Bee概览AI 账号诊断设置hive.example状态待确认Bee Desktop设备与平台控制本机设备概览打开 Hive 控制台状态待确认开始后建立连接；接单需单独恢复。开始贡献请先完成设备核对与绑定。Bee 未运行尚未建立 Hive 连接本机设备重新核对设备上次保存的设备信息：Bee Desktop · https://hive.exampleHive 拒绝了本次请求（HTTP 503）。本次设备状态不可确认，依赖设备身份的操作保持不可用。查看失败详情错误码: http_rejected
失败环节: device_identity
观察时间: 2026年11月3日 02:31:32
目标: https://hive.example
路径: /api/bee/identity
HTTP 状态: 503
安全响应: Hive upstream temporarily unavailable
原始原因: GET /api/bee/identity HTTP 503; preview upstream unavailableAI 账号接入数量待确认OpenAIPlus账号标识: bbbbbbbbbbbbbbbb状态待确认5 小时已用 3%7 日已用 2%✳Claude尚未接入 Claude 账号状态待确认所选来源暂不能提供可接入账号，请查看具体原因。额度尚未核对授权信息保留在本机Bee设备绑定不自动开始贡献
"
    16 × locator resolved to <body>…</body>
       - unexpected value "Bee概览AI 账号诊断设置hive.example状态待确认Bee Desktop设备与平台控制本机设备概览打开 Hive 控制台状态待确认开始后建立连接；接单需单独恢复。开始贡献请先完成设备核对与绑定。Bee 未运行尚未建立 Hive 连接本机设备重新核对设备上次保存的设备信息：Bee Desktop · https://hive.exampleHive 拒绝了本次请求（HTTP 503）。本次设备状态不可确认，依赖设备身份的操作保持不可用。查看失败详情错误码: http_rejected
失败环节: device_identity
观察时间: 2026年11月3日 02:31:42
目标: https://hive.example
路径: /api/bee/identity
HTTP 状态: 503
安全响应: Hive upstream temporarily unavailable
原始原因: GET /api/bee/identity HTTP 503; preview upstream unavailableAI 账号接入数量待确认OpenAIPlus账号标识: bbbbbbbbbbbbbbbb状态待确认5 小时已用 3%7 日已用 2%✳Claude尚未接入 Claude 账号状态待确认所选来源暂不能提供可接入账号，请查看具体原因。额度尚未核对授权信息保留在本机Bee设备绑定不自动开始贡献
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
    - paragraph: 请先完成设备核对与绑定。
    - text: Bee 未运行 尚未建立 Hive 连接
  - region "设备配对":
    - heading "本机设备" [level=2]
    - button "重新核对设备"
    - paragraph: 上次保存的设备信息：Bee Desktop · https://hive.example
    - alert:
      - paragraph: Hive 拒绝了本次请求（HTTP 503）。
      - paragraph: 本次设备状态不可确认，依赖设备身份的操作保持不可用。
      - group: 查看失败详情
  - region "平台账号列表":
    - heading "AI 账号" [level=2]
    - text: 接入数量待确认
    - region "OpenAI 账号":
      - heading "OpenAI" [level=3]
      - text: Plus
      - paragraph: "账号标识: bbbbbbbbbbbbbbbb"
      - paragraph: 状态待确认
      - text: 5 小时 已用 3%
      - progressbar "5 小时 已用额度"
      - text: 7 日 已用 2%
      - progressbar "7 日 已用额度"
    - region "Claude 账号":
      - heading "Claude" [level=3]
      - paragraph: 尚未接入 Claude 账号
      - paragraph: 状态待确认
      - paragraph: 所选来源暂不能提供可接入账号，请查看具体原因。
      - text: 额度 尚未核对
      - progressbar "已用额度"
    - paragraph: 授权信息保留在本机
- contentinfo: Bee 设备绑定不自动开始贡献
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
  13  |  ['device-unbound','连接本机设备'],['device-pending','等待网页确认'],['device-expired','配对码已过期'],['device-bound','设备已绑定。'],['device-error','设备核对失败'],
  14  |  ['stopped','贡献尚未启动'],['runtime-starting','正在启动贡献'],['running','贡献已启动'],['runtime-stopping','正在停止贡献'],['runtime-disconnected',/Hive 未连接|正在重新连接 Hive/],['runtime-unknown','贡献状态待确认，正在自动核对'],
  15  |  ['account-reading','正在读取已有登录'],['account-empty','还没有 OpenAI 登录'],['account-candidate','已有登录，尚未接入'],['account-selected','已用 3%'],['account-error','permission_denied'],['account-expired','历史数据，已过期'],['account-change','尚未核对'],
  16  |  ['supply-ready','可接单'],['supply-paused','恢复接单'],['supply-blocked','管理员尚未配置套餐并发上限'],['supply-partial','等待自动重试'],
  17  |  ['check-background','可接单'],['check-expired','核对中…'],['check-waiting','等待自动重试…'],['check-retrying','重试中…'],['check-recovered','可接单'],['check-sequence','可接单'],
  18  |  ['quota-normal','已用 3%'],['quota-unknown','尚未核对'],['quota-expired','历史数据，已过期'],['quota-multiple','7 日 · opus'],['quota-over','已用 120%'],
  19  |  ['confirm-login','开始官方登录'],['confirm-select','确认接入'],['confirm-stop','确认停止'],['confirm-change','确认更换'],['confirm-clear','确认取消接入'],['account-detail','凭证读取方式'],
  20  | ];
  21  | for(const [scene,copy] of cases)test('scene renders formal state without invalid data or unintended writes: '+scene,async({page})=>{
  22  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  23  |  await openScene(page,scene);
> 24  |  await expect(page.locator('body')).toContainText(copy,{timeout:18000});
      |                                     ^ Error: expect(locator).toContainText(expected) failed
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
  41  |  await expect(page.locator('#scene optgroup')).toHaveCount(7);
  42  |  await expect(page.locator('#scene option')).toHaveCount(39);
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
  56  |  await expect(page.locator('.account-check-status')).toHaveText('核对中…',{timeout:6000});
  57  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  58  |  await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
  59  |  await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…');
  60  |  await expect(page.locator('.account-check-status')).toHaveText('重试中…',{timeout:15000});
  61  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  62  |  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible({timeout:8000});
  63  |  await expect(page.locator('.account-check-status')).toHaveCount(0);
  64  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  65  | });
  66  | 
  67  | test('preview pairing remains pending after a poll and simulated website confirmation binds the device',async({page})=>{
  68  |  await openScene(page,'device-unbound');
  69  |  await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
  70  |  await page.getByRole('button',{name:'生成配对码',exact:true}).click();
  71  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  72  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='device_status').length).toBeGreaterThan(1);
  73  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  74  |  await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
  75  |  await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
  76  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  77  | });
  78  | 
  79  | test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
  80  |  await openScene(page,'confirm-select');
  81  |  await page.getByRole('button',{name:'确认接入',exact:true}).click();
  82  |  await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();
  83  |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  84  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  85  |  await page.getByRole('button',{name:'概览',exact:true}).click();
  86  |  const readsBeforeStart=(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length;
  87  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  88  |  // The shared formal supply model refreshes on its existing 10-second read cycle.
  89  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length,{timeout:15000}).toBeGreaterThan(readsBeforeStart);
  90  |  await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
  91  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  92  |  expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toEqual([]);
  93  | });
  94  | 
  95  | for(const scene of ['confirm-change','account-change'])test('confirmed changed identity cannot inherit the prior account quota: '+scene,async({page})=>{
  96  |  await openScene(page,scene);
  97  |  if(scene==='account-change'){
  98  |   await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  99  |   await page.getByRole('button',{name:'换号',exact:true}).click();
  100 |  }
  101 |  await page.getByRole('button',{name:'确认更换',exact:true}).click();
  102 |  await page.getByRole('button',{name:'关闭',exact:true}).click();
  103 |  await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();
  104 |  const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
  105 |  expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
  106 |  expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
  107 |  expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
  108 |  expect(state.paused).toBe(true);
  109 |  await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
  110 |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  111 | });
  112 | 
```