# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview-scenarios.spec.ts >> additional formal page accepts current DTO without invalid reply: update-verified
- Location: tests/preview-scenarios.spec.ts:124:12

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('body')
Timeout: 5000ms
- Expected substring  - 1
+ Received string     + 2

- 安装
+ Bee概览AI 账号诊断设置hive.example可接单Bee Desktop设备与平台控制本机设备设置管理设备偏好与应用设置。打开 Hive 控制台通用网络与代理通知与启动关于  网络与代理可直接连接；只有需要本机代理时才填写下面的地址。适用范围https://hive.example   本机 HTTP 代理留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。保存代理测试连接配置与实际路径刷新生效路径   已保存配置代理未启用当前生效配置代理未启用当前实际生效路径流量路径Bee 转发的上游连接直连官方查询与续期OpenAI: 直连Claude: 直连Hive HTTP / WebSocket沿用进程环境官方客户端登录由官方客户端管理官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。Bee设备绑定不自动开始贡献
+

Call log:
  - Expect "toContainText" locator('body') with timeout 5000ms
  - waiting for locator('body')
    14 × locator resolved to <body>…</body>
       - unexpected value "Bee概览AI 账号诊断设置hive.example可接单Bee Desktop设备与平台控制本机设备设置管理设备偏好与应用设置。打开 Hive 控制台通用网络与代理通知与启动关于  网络与代理可直接连接；只有需要本机代理时才填写下面的地址。适用范围https://hive.example   本机 HTTP 代理留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。保存代理测试连接配置与实际路径刷新生效路径   已保存配置代理未启用当前生效配置代理未启用当前实际生效路径流量路径Bee 转发的上游连接直连官方查询与续期OpenAI: 直连Claude: 直连Hive HTTP / WebSocket沿用进程环境官方客户端登录由官方客户端管理官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。Bee设备绑定不自动开始贡献
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
  - paragraph: 可接单
  - text: Bee Desktop 设备与平台控制
- banner: 本机设备
- main:
  - heading "设置" [level=1]
  - paragraph: 管理设备偏好与应用设置。
  - button "打开 Hive 控制台"
  - tablist "设置分类":
    - tab "通用"
    - tab "网络与代理" [selected]
    - tab "通知与启动"
    - tab "关于"
  - tabpanel "网络与代理":
    - region "网络与代理":
      - heading "网络与代理" [level=2]
      - paragraph: 可直接连接；只有需要本机代理时才填写下面的地址。
      - paragraph: 适用范围 https://hive.example
      - text: 本机 HTTP 代理
      - textbox "本机 HTTP 代理":
        - /placeholder: http://127.0.0.1:7890
      - paragraph: 留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。
      - button "保存代理"
      - button "测试连接"
      - complementary "配置与实际路径":
        - heading "配置与实际路径" [level=3]
        - button "刷新生效路径"
        - term: 已保存配置
        - definition: 代理未启用
        - term: 当前生效配置
        - definition: 代理未启用
        - table "当前实际生效路径":
          - caption: 当前实际生效路径
          - rowgroup:
            - row "流量 路径":
              - columnheader "流量"
              - columnheader "路径"
          - rowgroup:
            - row "Bee 转发的上游连接 直连":
              - rowheader "Bee 转发的上游连接"
              - cell "直连"
            - 'row "官方查询与续期 OpenAI: 直连 Claude: 直连"':
              - rowheader "官方查询与续期"
              - 'cell "OpenAI: 直连 Claude: 直连"'
            - row "Hive HTTP / WebSocket 沿用进程环境":
              - rowheader "Hive HTTP / WebSocket"
              - cell "沿用进程环境"
            - row "官方客户端登录 由官方客户端管理":
              - rowheader "官方客户端登录"
              - cell "由官方客户端管理"
        - paragraph: 官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。
- contentinfo: Bee 设备绑定不自动开始贡献
```

# Test source

```ts
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
  45  |  await expect(app.getByRole('dialog').last()).toContainText('目标账号');
  46  |  await page.locator('#theme').selectOption('dark');
  47  |  await page.locator('#size').selectOption('narrow');
  48  |  await expect(page.locator('#scene')).toHaveValue('confirm-change');
  49  |  await expect(app.getByRole('dialog').last()).toContainText('目标账号');
  50  |  await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>({width:el.contentWindow!.innerWidth,height:el.contentWindow!.innerHeight,theme:el.contentDocument!.documentElement.dataset.theme}))).toEqual({width:860,height:600,theme:'dark'});
  51  | });
  52  | 
  53  | test('automatic recovery traverses stale, failed, retrying and recovered states using read requests only',async({page})=>{
  54  |  await openScene(page,'check-sequence');
  55  |  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
  56  |  test.setTimeout(45000);
  57  |  await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…',{timeout:6000});
  58  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  59  |  await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
  60  |  expect(await page.evaluate(()=>(window as any).__beePreviewPhase)).toBe('current');
  61  |  expect((await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai')).toHaveLength(1);
  62  |  await expect(page.locator('.account-check-status')).toHaveText('核对中…',{timeout:15000});
  63  |  await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…');
  64  |  await expect(page.locator('.account-check-status')).toHaveText('重试中…',{timeout:15000});
  65  |  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  66  |  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible({timeout:8000});
  67  |  await expect(page.locator('.account-check-status')).toHaveCount(0);
  68  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  69  | });
  70  | 
  71  | test('preview pairing remains pending after a poll and simulated website confirmation binds the device',async({page})=>{
  72  |  await openScene(page,'device-unbound');
  73  |  await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
  74  |  await page.getByRole('button',{name:'生成配对码',exact:true}).click();
  75  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  76  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='device_status').length).toBeGreaterThan(1);
  77  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  78  |  await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
  79  |  await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
  80  |  await page.evaluate(()=>(window as unknown as {__beePreviewApprove:()=>void}).__beePreviewApprove());
  81  |  await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
  82  |  expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
  83  | });
  84  | 
  85  | test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
  86  |  await openScene(page,'confirm-select');
  87  |  await page.getByRole('button',{name:'确认接入',exact:true}).click();
  88  |  await expect(card(page).getByText('接入已完成，该平台保持暂停。')).toBeVisible();
  89  |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  90  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  91  |  await page.getByRole('button',{name:'概览',exact:true}).click();
  92  |  const readsBeforeStart=(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length;
  93  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  94  |  // The shared formal supply model refreshes on its existing 10-second read cycle.
  95  |  await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length,{timeout:15000}).toBeGreaterThan(readsBeforeStart);
  96  |  await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
  97  |  expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
  98  |  expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toEqual([]);
  99  | });
  100 | 
  101 | for(const scene of ['confirm-change','account-change'])test('confirmed changed identity cannot inherit the prior account quota: '+scene,async({page})=>{
  102 |  await openScene(page,scene);
  103 |  if(scene==='account-change'){
  104 |   await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  105 |   await page.getByRole('button',{name:'换号',exact:true}).click();
  106 |  }
  107 |  await page.getByRole('button',{name:'确认更换',exact:true}).click();
  108 |  await page.getByRole('button',{name:'关闭',exact:true}).click();
  109 |  await expect(card(page).getByText('换号已完成，该平台保持暂停。')).toBeVisible();
  110 |  const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
  111 |  expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
  112 |  expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
  113 |  expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
  114 |  expect(state.paused).toBe(true);
  115 |  await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
  116 |  expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
  117 | });
  118 | 
  119 | for(const [scene,copy] of [
  120 |  ['settings-general','通用'],['settings-network','本机 HTTP 代理'],['settings-system','通知与启动'],['settings-about','关于'],
  121 |  ['diagnostics-running','诊断中'],['diagnostics-results','诊断'],['diagnostics-read-failed','诊断'],['diagnostics-export-unknown','诊断'],
  122 |  ['update-downloading','下载'],['update-verified','安装'],['update-unknown','安装'],['update-failed','signature'],
  123 |  ['bridge-starting','正在读取 Bee'],['bridge-failed','exit=17'],['startup-blocked','本机设备'],
  124 | ] as const)test('additional formal page accepts current DTO without invalid reply: '+scene,async({page})=>{
> 125 |  await openScene(page,scene);await expect(page.locator('body')).toContainText(copy);
      |                                                                 ^ Error: expect(locator).toContainText(expected) failed
  126 |  await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
  127 |  expect((await commands(page)).filter(c=>writes.has(c.command))).toEqual([]);
  128 | });
  129 | 
  130 | test('English preview navigates the formal account and settings pages',async({page})=>{
  131 |  await page.goto('/tests/fixtures/bee-preview/app.html?scene=account-detail&locale=en');
  132 |  await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
  133 |  expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
  134 |  await expect(page.getByRole('dialog')).toHaveAccessibleName('OpenAI account details');await page.keyboard.press('Escape');
  135 |  await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{level:1,name:'Settings',exact:true})).toBeFocused();
  136 | });
  137 | 
```