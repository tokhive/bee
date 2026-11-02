# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-accounts.spec.ts >> source edits reject late automatic results; platform failures remain independent with English and dark theme
- Location: tests/native-accounts.spec.ts:17:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByText('核对诊断', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - complementary [ref=f1e4]:
    - generic [ref=f1e5]: Bee
    - navigation "主导航" [ref=f1e7]:
      - button "概览" [ref=f1e8] [cursor=pointer]
      - button "AI 账号" [ref=f1e12] [cursor=pointer]
      - button "诊断" [ref=f1e18] [cursor=pointer]
      - button "设置" [ref=f1e21] [cursor=pointer]
    - generic [ref=f1e25]:
      - generic [ref=f1e26]:
        - text: hive.example
        - paragraph [ref=f1e28]: 尚未接入 AI 账号
      - generic [ref=f1e33]:
        - text: Fixture
        - generic [ref=f1e34]: 设备与平台控制
  - generic [ref=f1e35]:
    - banner [ref=f1e36]:
      - generic [ref=f1e37]: 本机设备
    - main [ref=f1e41]:
      - generic [ref=f1e42]:
        - heading "概览" [active] [level=1] [ref=f1e44]
        - button "打开 Hive 控制台" [ref=f1e45] [cursor=pointer]
      - region "贡献运行" [ref=f1e48]:
        - generic [ref=f1e49]:
          - generic [ref=f1e54]:
            - heading "尚未接入 AI 账号" [level=2] [ref=f1e55]
            - paragraph [ref=f1e56]: 开始后建立连接；接单需单独恢复。
          - button "开始贡献" [disabled] [ref=f1e57]
        - paragraph [ref=f1e58]: 请先接入至少一个 AI 账号。
        - generic [ref=f1e59]:
          - generic [ref=f1e60]: Bee 未运行
          - generic [ref=f1e64]: 尚未建立 Hive 连接
      - region "准备贡献" [ref=f1e68]:
        - heading "准备贡献" [level=2] [ref=f1e69]
        - list [ref=f1e70]:
          - listitem [ref=f1e71]: 绑定本机设备
          - listitem [ref=f1e72]: 在 Hive 网页确认
          - listitem [ref=f1e73]: 接入 AI 账号
          - listitem [ref=f1e74]: 开始贡献并按平台恢复接单
        - button "前往准备账号" [ref=f1e75] [cursor=pointer]
      - region "设备配对" [ref=f1e77]:
        - generic [ref=f1e78]:
          - heading "本机设备" [level=2] [ref=f1e79]
          - button "重新核对设备" [ref=f1e80] [cursor=pointer]
        - generic [ref=f1e81]:
          - generic [ref=f1e82]:
            - paragraph [ref=f1e83]: 本机设备
            - strong [ref=f1e84]: Fixture
            - status [ref=f1e85]: 设备已绑定。
          - generic [ref=f1e86]:
            - paragraph [ref=f1e87]: 归属账号
            - strong [ref=f1e88]: owner@example.test
            - generic [ref=f1e89]: 设备所属账号
          - generic [ref=f1e90]:
            - paragraph [ref=f1e91]: Hive
            - strong [ref=f1e92]: https://hive.example
            - generic [ref=f1e93]: 配对不会自动开始贡献
      - region "平台账号列表" [ref=f1e94]:
        - generic [ref=f1e95]:
          - heading "AI 账号" [level=2] [ref=f1e96]
          - generic [ref=f1e97]: 0 个已接入
        - generic [ref=f1e99]:
          - region "OpenAI 账号" [ref=f1e100]:
            - generic [ref=f1e106]:
              - heading "OpenAI" [level=3] [ref=f1e108]
              - paragraph [ref=f1e109]: 尚未接入 OpenAI 账号
              - paragraph [ref=f1e110]: 不能接单
              - paragraph [ref=f1e114]: 所选来源的登录状态待确认。
              - list [ref=f1e115]:
                - listitem [ref=f1e116]:
                  - text: Hive 未看到此平台的 Bee 连接
                  - paragraph [ref=f1e117]: 请在概览核对贡献运行和实际连接原因。
                  - button "查看连接" [ref=f1e118] [cursor=pointer]
            - generic [ref=f1e120]:
              - generic [ref=f1e121]:
                - generic [ref=f1e122]: 额度
                - generic [ref=f1e123]: 尚未核对
              - progressbar "已用额度" [ref=f1e124]
          - region "Claude 账号" [ref=f1e126]:
            - generic [ref=f1e127]:
              - generic [aria-hidden] [ref=f1e129]: ✳
              - generic [ref=f1e130]:
                - heading "Claude" [level=3] [ref=f1e132]
                - paragraph [ref=f1e133]: 尚未接入 Claude 账号
                - paragraph [ref=f1e134]: 不能接单
                - paragraph [ref=f1e138]: 所选来源的登录状态待确认。
                - list [ref=f1e139]:
                  - listitem [ref=f1e140]:
                    - text: 已手动暂停
                    - paragraph [ref=f1e141]: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
                  - listitem [ref=f1e142]:
                    - text: Hive 未看到此平台的 Bee 连接
                    - paragraph [ref=f1e143]: 请在概览核对贡献运行和实际连接原因。
                    - button "查看连接" [ref=f1e144] [cursor=pointer]
            - generic [ref=f1e146]:
              - generic [ref=f1e147]:
                - generic [ref=f1e148]: 额度
                - generic [ref=f1e149]: 尚未核对
              - progressbar "已用额度" [ref=f1e150]
        - paragraph [ref=f1e152]: 授权信息保留在本机
    - contentinfo [ref=f1e156]:
      - text: Bee
      - generic [ref=f1e157]: 设备绑定不自动开始贡献
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  3   | const card=(page:Page,p='OpenAI')=>page.getByRole('region',{name:`${p} 账号`,exact:true});
  4   | const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
  5   | function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
  6   | async function fixture(page:Page,options:{selected?:boolean;runtime?:boolean}={}){await page.addInitScript(installAccountFixture,{runtimeEnabled:options.runtime??false,accounts:{openai:options.selected?selected('openai'):accountFixture('openai'),claude:options.selected?selected('claude'):accountFixture('claude')}});}
  7   | async function details(page:Page,p='OpenAI'){await card(page,p).getByRole('button',{name:`${p} 详情`,exact:true}).click();return page.getByRole('dialog').last();}
> 8   | async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('.native-diagnostic-evidence pre')).toContainText(message);}
      |                                                                                                                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  9   | test('account page automatically reads sources; selected quotas preserve 120%, unknown windows and detail focus',async({page})=>{
  10  |  await fixture(page,{selected:true});await page.setViewportSize({width:860,height:600});await page.goto('/');expect(await calls(page,'account_detect')).toEqual([]);
  11  |  await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
  12  |  const reads=await calls(page,'account_detect');expect(reads.filter((c:any)=>c.args.request.mode==='local').map((c:any)=>c.args.request.platform)).toEqual(expect.arrayContaining(['openai','claude']));expect(reads.some((c:any)=>c.args.request.mode==='official')).toBe(true);
  13  |  expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  14  |  const trigger=card(page).getByRole('button',{name:'OpenAI 详情',exact:true});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog.getByText('已用 120%',{exact:true})).toBeVisible();await expect(dialog.getByText('尚未核对',{exact:true})).toBeVisible();await expect(dialog.getByText('市场开放：未知',{exact:true})).toHaveCount(0);await expect(dialog.getByText('gpt-5.4',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('自定义目录')).toBeVisible();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  15  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../.cache/device-pairing/accounts-zh-860.png',fullPage:true});
  16  | });
  17  | test('source edits reject late automatic results; platform failures remain independent with English and dark theme',async({page})=>{
  18  |  await fixture(page,{runtime:true});await page.addInitScript(()=>{(window as any).delay=700;});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
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
  106 | test('background snapshot failure during official login never invents a cancel request',async({page},testInfo)=>{
  107 |  await page.clock.install();await fixture(page,{runtime:true});
  108 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.accountTimeline=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{try{const reply=await invoke(command,args);if(['authorize_start','runtime_snapshot','account_snapshot'].includes(command))w.accountTimeline.push({at:new Date().toISOString(),command,platform:args?.platform??args?.request?.platform,receipt:reply?.result?.operation,account:reply?.result?.account??reply?.result?.runtime?.platforms.openai.account});return reply;}catch(error){w.accountTimeline.push({at:new Date().toISOString(),command,error});throw error;}};});
```