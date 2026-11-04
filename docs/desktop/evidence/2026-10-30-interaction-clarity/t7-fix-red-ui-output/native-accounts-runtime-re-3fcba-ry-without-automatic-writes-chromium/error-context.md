# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-accounts.spec.ts >> runtime read failure marks retained account facts until recovery without automatic writes
- Location: tests/native-accounts.spec.ts:116:52

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'OpenAI 账号', exact: true }).getByText('上次确认的账号事实；当前状态待核对。', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'OpenAI 账号', exact: true }).getByText('上次确认的账号事实；当前状态待核对。', { exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'OpenAI 账号', exact: true }).getByText('上次确认的账号事实；当前状态待核对。', { exact: true })

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
  - text: Fixture 设备与平台控制
- banner: 本机设备
- main:
  - heading "AI 账号" [level=1]
  - paragraph: 管理这台设备用于贡献的 AI 账号。
  - button "打开 Hive 控制台"
  - alert:
    - paragraph: 本次操作失败，原因尚未确认。
    - paragraph: 本次操作未能完成；后续状态以重新核对的结果为准。
    - group: 查看失败详情
  - button "重新检查设备"
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
      - text: Plus
      - paragraph: "账号标识: bbbbbbbbbbbbbbbb"
      - paragraph: 状态待更新
      - paragraph:
        - text: 等待自动重试…
        - time: 2026年11月2日 22:37:02
      - text: 5 小时 已用 120%
      - progressbar "5 小时 已用额度"
      - text: 7 日 尚未核对
      - progressbar "7 日 已用额度"
      - paragraph: 有额度窗口已耗尽；请查看各窗口重置时间。
      - button "OpenAI 详情"
    - region "Claude 账号":
      - heading "Claude" [level=3]
      - text: 套餐待确认
      - paragraph: "账号标识: bbbbbbbbbbbbbbbb"
      - paragraph: 状态待更新
      - paragraph:
        - text: 等待自动重试…
        - time: 2026年11月2日 22:37:02
      - text: 额度 尚未核对
      - progressbar "已用额度"
      - button "Claude 详情"
    - paragraph: 授权信息保留在本机
- contentinfo: Bee 设备绑定不自动开始贡献
```

# Test source

```ts
  19  |  const dialog=await details(page);await dialog.getByLabel('自定义目录').fill('/tmp/edited');await dialog.getByLabel('自定义目录').press('Enter');
  20  |  await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.platform==='openai').at(-1)?.args.request.directory).toBe('/tmp/edited');
  21  |  await expect(dialog.getByText('正在读取已有登录…')).toHaveCount(0);await expect(dialog.getByLabel('自定义目录')).toHaveValue('/tmp/edited');await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();expect(await calls(page,'account_action')).toEqual([]);
  22  |  await details(page);await page.evaluate(()=>{(window as any).delay=0;(window as any).fail='openai';});await page.getByRole('dialog').getByLabel('自定义目录').fill('/tmp/denied');await page.getByRole('dialog').getByLabel('自定义目录').press('Enter');await expect(page.getByRole('dialog').locator('.account-source').getByRole('alert')).toContainText('没有读取所选凭证来源的权限');await page.keyboard.press('Escape');await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();
  23  |  await diagnostics(page,'permission_denied=true');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByLabel('Appearance',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'AI accounts',exact:true}).click();await page.getByRole('button',{name:'Claude details',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Custom directory')).toBeVisible();await page.keyboard.press('Tab');await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
  24  |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);await page.screenshot({path:'../.cache/device-pairing/accounts-en-dark.png',fullPage:true});
  25  | });
  26  | test('overview and accounts share per-platform pause state; resume never starts contribution',async({page})=>{
  27  |  await fixture(page,{selected:true,runtime:true});await page.goto('/');await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
  28  |  await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(card(page).getByText('已手动暂停',{exact:true})).toBeVisible();await page.getByRole('button',{name:'概览',exact:true}).click();await expect(card(page).getByText('已手动暂停',{exact:true})).toBeVisible();await card(page).getByRole('button',{name:'恢复接单',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(1);expect((await calls(page,'supply_set_paused')).map((c:any)=>[c.args.platform,c.args.paused])).toEqual([['openai',true],['openai',false]]);await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
  29  | });
  30  | test('official scope diagnostics retain the local candidate and expired authorization never offers a valid quota',async({page})=>{
  31  |  await fixture(page,{selected:true});await page.addInitScript(()=>{(window as any).missingProfile=true;(window as any).expiry=new Date(Date.now()+31000).toISOString();});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.mode==='official').length).toBe(1);
  32  |  await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await page.clock.runFor(32000);const dialog=await details(page);await expect(dialog.getByText('历史数据，已过期')).toBeVisible();await page.keyboard.press('Escape');await diagnostics(page,'profile_scope');expect(await calls(page,'account_action')).toEqual([]);
  33  | });
  34  | test('uncertain per-platform pause preserves the other platform and does not replay a write',async({page})=>{
  35  |  await fixture(page,{selected:true,runtime:true});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();await page.evaluate(()=>{(window as any).supplyFail='openai';});await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(card(page,'Claude').getByText('已手动暂停',{exact:true})).toBeVisible();await diagnostics(page,'HTTP 503');await page.getByRole('button',{name:'概览',exact:true}).click();await page.clock.runFor(10001);expect(await calls(page,'supply_set_paused')).toHaveLength(1);await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
  36  | });
  37  | test('device verification failure permits local reads and preserves selected historical Hive quota',async({page})=>{
  38  |  const openai=selected('openai');openai.hive={...openai.hive,fingerprint:'b'.repeat(64)};openai.capabilities[1]={...openai.capabilities[1],status:'rate_limited',observed_at:new Date(Date.now()-600000).toISOString(),valid_until:new Date(Date.now()-240000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:80,reset_at:null}]};
  39  |  await page.addInitScript(installAccountFixture,{accounts:{openai,claude:accountFixture('claude')}});await page.addInitScript(()=>{(window as any).deviceFail=true;(window as any).historicalLimit=true;(window as any).accounts.openai.selection.fingerprint='f'.repeat(64);(window as any).accounts.openai.hive.fingerprint='f'.repeat(64);});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('历史数据，已过期')).toBeVisible();await expect.poll(async()=>(await calls(page,'account_detect')).length).toBeGreaterThan(0);const dialog=await details(page);await expect(dialog.getByText('已用 80%',{exact:true})).toBeVisible();await expect(dialog.getByText('历史数据，已过期')).toBeVisible();await page.keyboard.press('Escape');await diagnostics(page,'HTTP 503');
  40  | });
  41  | 
  42  | test('approved shared rows show saved identity and a keyboard-accessible compact detail',async({page})=>{
  43  |  const openai=accountFixture('openai') as any;
  44  |  openai.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};
  45  |  openai.candidate={...openai.candidate,state:'available',fingerprint:'b'.repeat(64),plan:'plus',expires_at:'2099-01-01T00:00:00Z'};
  46  |  await page.addInitScript(installAccountFixture,{accounts:{openai,claude:accountFixture('claude')}});
  47  |  await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  48  |  await expect(card(page).getByText('f'.repeat(16),{exact:true})).toBeVisible();
  49  |  await expect(page.getByRole('button',{name:'检测已有登录',exact:true})).toHaveCount(0);
  50  |  const trigger=page.getByRole('button',{name:'OpenAI 详情',exact:true});await trigger.click();
  51  |  const detail=page.getByRole('dialog');await expect(detail.getByText('授权到期',{exact:true})).toBeVisible();
  52  |  await expect(detail.getByLabel('自定义目录')).toBeVisible();
  53  |  await expect(detail.getByText('模型能力与市场开放')).toHaveCount(0);
  54  |  await expect(detail.getByText('Hive 账号代次')).toHaveCount(0);
  55  |  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  56  | });
  57  | 
  58  | test('unconnected candidate shows its target and exact pause impact before connecting',async({page})=>{
  59  |  await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  60  |  await expect(card(page).getByText('已有登录，尚未接入')).toBeVisible();await expect(card(page).getByText('未知套餐',{exact:true})).toHaveCount(0);
  61  |  await card(page).getByRole('button',{name:'接入',exact:true}).click();const dialog=page.getByRole('dialog');
  62  |  await expect(dialog.getByText('目标账号',{exact:true})).toBeVisible();await expect(dialog.getByText('b'.repeat(16),{exact:true})).toBeVisible();
  63  |  await expect(dialog).toContainText('Hive');await expect(dialog).toContainText('不会开始贡献');
  64  |  await dialog.getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('接入已完成，该平台保持暂停。',{exact:true})).toBeVisible();
  65  |  expect(await calls(page,'runtime_start')).toHaveLength(0);expect((await calls(page,'account_action'))[0].args.request.action).toBe('select');
  66  | });
  67  | 
  68  | test('running official login explains its stopped precondition and provides the runtime location',async({page})=>{
  69  |  await fixture(page,{selected:true,runtime:true});await page.goto('/');await page.getByRole('button',{name:'开始贡献',exact:true}).click();await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  70  |  const dialog=await details(page);await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();
  71  |  await expect(dialog).toContainText('官方登录前请先停止贡献');await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();
  72  |  await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeVisible();expect(await calls(page,'runtime_stop')).toHaveLength(0);expect(await calls(page,'authorize_start')).toHaveLength(0);
  73  | });
  74  | 
  75  | test('candidate expiring at the safety boundary explains zero-write refusal',async({page})=>{
  76  |  await fixture(page,{runtime:true});await page.addInitScript(()=>{(window as any).expiry=new Date(Date.now()+60000).toISOString();});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  77  |  await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await page.clock.runFor(31001);
  78  |  await expect(card(page)).toContainText('候选授权即将过期');expect(await calls(page,'account_action')).toHaveLength(0);
  79  | });
  80  | 
  81  | for(const code of ['source_missing','permission_denied','expired','source_changed'])test(`selected source ${code} stays scoped and leaves the other platform usable`,async({page})=>{
  82  |  const error={code,check:'source_read',platform:'openai',message:`selected file ${code}; safe source evidence`,evidence:{confirmed:'false'}};
  83  |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{candidates:{openai:{state:code,source:null,reference:null,fingerprint:null,error}}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  84  |  await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).locator('.problem-notice pre').first()).toContainText(code);
  85  |  await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();await expect(card(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
  86  |  await card(page).getByRole('button',{name:'检查凭证来源',exact:true}).last().click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('自定义目录')).toBeFocused();expect(await calls(page,'account_action')).toHaveLength(0);
  87  | });
  88  | 
  89  | test('confirmation invalidates a changed candidate while retaining the original target and zero writes',async({page})=>{
  90  |  await page.clock.install();await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'接入',exact:true}).click();
  91  |  await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.candidate.reference='f'.repeat(48);a.candidate.fingerprint='f'.repeat(64);});await page.clock.runFor(10100);
  92  |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('alert')).toContainText('本次未提交');await expect(dialog.getByText('b'.repeat(16),{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'确认接入',exact:true})).toBeDisabled();expect(await calls(page,'account_action')).toHaveLength(0);await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeFocused();
  93  | });
  94  | 
  95  | for(const [code,summary]of [['client_missing','未找到已安装的官方客户端。'],['client_version_unsupported','官方客户端版本不在支持范围内。'],['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_timeout','官方登录已超时。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test(`official login ${code} is actionable without automatically connecting`,async({page})=>{
  96  |  await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'safe official evidence; verified=false',evidence:{confirmed:'false'}}}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  97  |  await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
  98  |  await expect(dialog.getByText(summary,{exact:true})).toBeVisible();await expect(dialog.locator('.problem-notice pre').last()).toContainText('verified=false');expect(await calls(page,'account_action')).toHaveLength(0);expect(await calls(page,'runtime_start')).toHaveLength(0);
  99  | });
  100 | 
  101 | test('unknown cancel only queries the same official operation and late success remains an unconnected candidate',async({page})=>{
  102 |  await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{cancelUnknown:true},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await dialog.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(dialog).toContainText('取消请求结果未确认');await page.keyboard.press('Escape');
  103 |  await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10100);await expect(card(page).getByText('登录已核验，尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);expect(await calls(page,'supply_set_paused')).toHaveLength(0);
  104 | });
  105 | 
  106 | test('background snapshot failure during official login never invents a cancel request',async({page})=>{
  107 |  await page.clock.install();await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);
  108 |  await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(dialog.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();
  109 |  await page.evaluate(()=>(window as any).accountScenarios.snapshotFailure='openai');await page.clock.runFor(450);
  110 |  await expect(dialog.locator('.problem-notice pre').last()).toContainText('account_snapshot');await expect(dialog.locator('.problem-notice pre').last()).toContainText('openai snapshot unavailable');
  111 |  expect(await calls(page,'authorize_cancel')).toHaveLength(0);await expect(dialog).not.toContainText('取消请求结果未确认');
  112 |  await page.evaluate(()=>{const w=window as any;w.accountScenarios.snapshotFailure='';w.loginComplete=true;});await page.clock.runFor(10100);
  113 |  await expect(dialog.getByText('登录已核验，尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);
  114 | });
  115 | 
  116 | for(const failure of ['runtime','openai'] as const)test(`${failure} read failure marks retained account facts until recovery without automatic writes`,async({page})=>{
  117 |  await page.clock.install();await fixture(page,{selected:true,runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
  118 |  await page.evaluate(failure=>{const w=window as any;if(failure==='runtime')w.accountScenarios.runtimeReadFailure=true;else w.accountScenarios.snapshotFailure='openai';},failure);await page.clock.runFor(10100);
> 119 |  await expect(card(page).getByText('上次确认的账号事实；当前状态待核对。',{exact:true})).toBeVisible();await expect(card(page).locator('.account-read-history time')).toHaveAttribute('datetime',/.+/);
      |                                                                        ^ Error: expect(locator).toBeVisible() failed
  120 |  await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await expect(card(page).getByText('上次确认的额度；当前待核对。',{exact:true})).toBeVisible();
  121 |  if(failure==='openai'){await expect(card(page,'Claude').locator('.account-read-history')).toHaveCount(0);await expect(card(page,'Claude').getByText('b'.repeat(16),{exact:true})).toBeVisible();}
  122 |  else {await expect(card(page,'Claude').locator('.account-read-history')).toBeVisible();}
  123 |  const dialog=await details(page);await expect(dialog.locator('.account-read-history time')).toHaveAttribute('datetime',/.+/);await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).not.toContainText('接入前需先恢复设备身份');await page.keyboard.press('Escape');
  124 |  for(const command of ['account_action','authorize_start','authorize_cancel','supply_set_paused','runtime_start'])expect(await calls(page,command)).toHaveLength(0);
  125 |  await page.evaluate(()=>{const w=window as any;w.accountScenarios.runtimeReadFailure=false;w.accountScenarios.snapshotFailure='';});await page.clock.runFor(10100);
  126 |  await expect(card(page).locator('.account-read-history')).toHaveCount(0);await expect(card(page).getByText('上次确认的额度；当前待核对。',{exact:true})).toHaveCount(0);await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
  127 | });
  128 | 
```