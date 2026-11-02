# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: device-recovery.spec.ts >> saved revoked identity and missing selected source keep all pages reachable without account or runtime writes
- Location: tests/device-recovery.spec.ts:43:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'OpenAI 账号', exact: true })
Expected substring: "所选来源未找到登录"
Received string:    "OpenAI账号状态尚未确认状态待确认等待自动重试… 2026年11月3日 02:43:09额度尚未核对登录 OpenAI账号状态尚未确认，暂不能提交。"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: 'OpenAI 账号', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'OpenAI 账号', exact: true })
    14 × locator resolved to <section tabindex="-1" aria-label="OpenAI 账号" class="native-account-row" data-nav-section="account" data-nav-platform="openai" data-account-platform="openai">…</section>
       - unexpected value "OpenAI账号状态尚未确认状态待确认等待自动重试… 2026年11月3日 02:43:09额度尚未核对登录 OpenAI账号状态尚未确认，暂不能提交。"

```

```yaml
- region "OpenAI 账号":
  - heading "OpenAI" [level=3]
  - paragraph: 账号状态尚未确认
  - paragraph: 状态待确认
  - paragraph:
    - text: 等待自动重试…
    - time: 2026年11月3日 02:43:09
  - text: 额度 尚未核对
  - progressbar "已用额度"
  - button "登录 OpenAI" [disabled]
  - paragraph: 账号状态尚未确认，暂不能提交。
  - button "OpenAI 详情"
```

# Test source

```ts
  1  | import {test,expect,type Page} from '@playwright/test';
  2  | async function open(page:Page,scene:string){
  3  |  await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene);
  4  |  await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
  5  |  expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
  6  | }
  7  | const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  8  | const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
  9  | const writes=new Set(['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','supply_set_paused']);
  10 | const phases:{[key:string]:string}={
  11 |  'device-creation-unknown':'创建结果未知','device-redemption-unknown':'兑换结果未知','device-saving':'本机保存未完成',
  12 |  'recovery-pending':'等待网页确认','recovery-draining':'等待旧设备完成任务和结算','recovery-creation-unknown':'创建结果未知','recovery-redemption-unknown':'兑换结果未知','recovery-saving':'本机保存未完成','recovery-owner':'新设备归属与原设备不同',
  13 | };
  14 | for(const [scene,copy] of Object.entries(phases))test('unresolved device transaction survives four pages without write replay: '+scene,async({page})=>{
  15 |  await open(page,scene);await expect(page.locator('.pairing-phase')).toContainText(copy);
  16 |  for(const destination of ['AI 账号','设置','诊断','概览']){await nav(page,destination).click();await expect(page.getByRole('heading',{level:1,name:destination,exact:true})).toBeFocused();}
  17 |  await expect(page.locator('.pairing-phase')).toContainText(copy);
  18 |  expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
  19 |  await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toHaveCount(0);
  20 | });
  21 | test('revoked credential recovery requires local consent, external approval and explicit new owner adoption',async({page})=>{
  22 |  await open(page,'device-recovery-confirm');
  23 |  const rebind=page.getByRole('button',{name:'重新绑定设备',exact:true});await rebind.click();
  24 |  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(rebind).toBeFocused();
  25 |  expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
  26 |  await rebind.click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
  27 |  await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
  28 |  await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
  29 |  await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
  30 |  await page.evaluate(()=>(window as any).__beePreviewApprove());
  31 |  await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  32 |  await expect(page.locator('.pairing-phase')).toHaveText('新设备归属与原设备不同');
  33 |  await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();
  34 |  await expect(page.getByRole('dialog')).toContainText('owner@example.test');await expect(page.getByRole('dialog')).toContainText('new-owner@example.test');
  35 |  await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
  36 |  await expect(page.locator('.pairing-phase')).toContainText('未自动开始贡献');
  37 |  const commands=(await calls(page)).filter(c=>writes.has(c.command));
  38 |  expect(commands.map(c=>c.command)).toEqual(['device_recovery_prepare','device_recovery_confirm','device_recovery_confirm']);
  39 |  expect(commands.filter(c=>c.command==='device_recovery_confirm').map(c=>c.args.decision)).toEqual(['begin_pairing','adopt_owner']);
  40 |  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  41 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeVisible();
  42 | });
  43 | test('saved revoked identity and missing selected source keep all pages reachable without account or runtime writes',async({page})=>{
  44 |  await open(page,'device-revoked-source-missing');await expect(page.locator('body')).toContainText('上次保存的设备信息');
  45 |  await nav(page,'AI 账号').click();const account=page.getByRole('region',{name:'OpenAI 账号',exact:true});
> 46 |  await expect(account).toContainText('所选来源未找到登录');await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
     |                        ^ Error: expect(locator).toContainText(expected) failed
  47 |  await expect(page.getByRole('dialog')).toContainText('凭证读取方式');await page.keyboard.press('Escape');
  48 |  for(const destination of ['设置','诊断','概览']){await nav(page,destination).click();await expect(page.getByRole('heading',{level:1,name:destination,exact:true})).toBeFocused();}
  49 |  expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
  50 | });
  51 | 
```