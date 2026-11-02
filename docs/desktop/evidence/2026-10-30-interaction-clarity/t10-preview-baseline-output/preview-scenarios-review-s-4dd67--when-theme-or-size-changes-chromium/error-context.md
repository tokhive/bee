# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview-scenarios.spec.ts >> review selector covers approved groups and preserves scene when theme or size changes
- Location: tests/preview-scenarios.spec.ts:39:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('#scene optgroup')
Expected: 7
Received: 8
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('#scene optgroup') with timeout 5000ms
  - waiting for locator('#scene optgroup')
    13 × locator resolved to 8 elements
       - unexpected value "8"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - strong [ref=e5]: Bee · 修改预览
      - generic [ref=e6]: 正式页面组件 · 示例数据
    - generic [ref=e7]:
      - generic [ref=e8]:
        - text: 场景
        - combobox "场景" [ref=e9]:
          - option "初次读取"
          - option "等待旧设备收尾"
          - option "首次未提交确认"
          - option "正在创建请求"
          - option "创建结果未知"
          - option "兑换后身份核对"
          - option "兑换结果未知"
          - option "本机保存失败"
          - option "尚未绑定"
          - option "等待网页确认"
          - option "配对已过期"
          - option "设备已绑定"
          - option "设备核对失败"
          - option "凭据撤销确认"
          - option "恢复等待网页"
          - option "恢复等待旧设备"
          - option "恢复创建未知"
          - option "恢复兑换未知"
          - option "新归属确认"
          - option "恢复保存失败"
          - option "恢复完成仍停止"
          - option "首次连接"
          - option "身份拒绝"
          - option "连接占用"
          - option "尚未开始"
          - option "正在启动"
          - option "贡献运行中" [selected]
          - option "正在停止"
          - option "连接断开"
          - option "启动结果未确认"
          - option "正在读取登录"
          - option "没有已有登录"
          - option "候选尚未接入"
          - option "账号已接入"
          - option "登录读取失败"
          - option "登录已过期"
          - option "候选账号已变化"
          - option "满足接单条件"
          - option "手动暂停"
          - option "多个阻塞原因"
          - option "单平台未就绪"
          - option "后台正常核对"
          - option "报告已过期"
          - option "等待自动重试"
          - option "重试中"
          - option "核对已恢复"
          - option "完整自动恢复过程"
          - option "正常额度"
          - option "额度未知"
          - option "额度报告过期"
          - option "多个额度窗口"
          - option "使用量超过 100%"
          - option "官方登录确认"
          - option "接入确认"
          - option "停止贡献确认"
          - option "换号确认"
          - option "取消接入确认"
          - option "账号详情与来源设置"
      - generic [ref=e10]:
        - text: 外观
        - combobox "外观" [ref=e11]:
          - option "浅色" [selected]
          - option "深色"
      - generic [ref=e12]:
        - text: 窗口
        - combobox "窗口" [ref=e13]:
          - option "参考尺寸" [selected]
          - option "860×600"
      - button "重置场景" [ref=e14] [cursor=pointer]
  - iframe [active] [ref=e16]:
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
            - paragraph [ref=f1e28]: 可接单
          - generic [ref=f1e33]:
            - text: Bee Desktop
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
              - generic [ref=f1e58]:
                - heading "可接单" [level=2] [ref=f1e59]
                - paragraph [ref=f1e60]: 按平台管理接单；暂停后不再接收新任务。
              - button "停止贡献" [ref=f1e61] [cursor=pointer]
            - paragraph [ref=f1e62]: 可接单平台：OpenAI
            - generic [ref=f1e63]:
              - generic [ref=f1e64]: Bee 运行中
              - generic [ref=f1e67]: Hive 已连接
          - region "设备配对" [ref=f1e71]:
            - generic [ref=f1e72]:
              - heading "本机设备" [level=2] [ref=f1e73]
              - button "重新核对设备" [ref=f1e74] [cursor=pointer]
            - generic [ref=f1e75]:
              - generic [ref=f1e76]:
                - paragraph [ref=f1e77]: 本机设备
                - strong [ref=f1e78]: Bee Desktop
                - status [ref=f1e79]: 设备已绑定。
              - generic [ref=f1e80]:
                - paragraph [ref=f1e81]: 归属账号
                - strong [ref=f1e82]: owner@example.test
                - generic [ref=f1e83]: 设备所属账号
              - generic [ref=f1e84]:
                - paragraph [ref=f1e85]: Hive
                - strong [ref=f1e86]: https://hive.example
                - generic [ref=f1e87]: 配对不会自动开始贡献
          - region "平台账号列表" [ref=f1e88]:
            - generic [ref=f1e89]:
              - heading "AI 账号" [level=2] [ref=f1e90]
              - generic [ref=f1e91]: 1 个已接入
            - generic [ref=f1e93]:
              - region "OpenAI 账号" [ref=f1e94]:
                - generic [ref=f1e100]:
                  - generic [ref=f1e101]:
                    - heading "OpenAI" [level=3] [ref=f1e102]
                    - generic [ref=f1e103]: Plus
                  - paragraph [ref=f1e104]:
                    - generic [ref=f1e105]: "账号标识:"
                    - text: bbbbbbbbbbbbbbbb
                  - paragraph [ref=f1e106]: 可接单
                - generic [ref=f1e109]:
                  - generic [ref=f1e110]:
                    - generic [ref=f1e111]:
                      - generic [ref=f1e112]: 5 小时
                      - generic [ref=f1e113]: 已用 3%
                    - progressbar "5 小时 已用额度" [ref=f1e114]
                  - generic [ref=f1e116]:
                    - generic [ref=f1e117]:
                      - generic [ref=f1e118]: 7 日
                      - generic [ref=f1e119]: 已用 2%
                    - progressbar "7 日 已用额度" [ref=f1e120]
                - button "暂停接单" [ref=f1e123] [cursor=pointer]
              - region "Claude 账号" [ref=f1e124]:
                - generic [ref=f1e125]:
                  - generic [aria-hidden] [ref=f1e127]: ✳
                  - generic [ref=f1e128]:
                    - heading "Claude" [level=3] [ref=f1e130]
                    - paragraph [ref=f1e131]: 尚未接入 Claude 账号
                    - paragraph [ref=f1e132]: 不能接单
                    - paragraph [ref=f1e136]: 所选来源暂不能提供可接入账号，请查看具体原因。
                    - list [ref=f1e137]:
                      - listitem [ref=f1e138]:
                        - text: 此 Hive 未提供更具体的接单原因
                        - paragraph [ref=f1e139]: 请联系 Hive 管理员核对平台配置；当前原因不能证明市场或账号状态。
                - generic [ref=f1e141]:
                  - generic [ref=f1e142]:
                    - generic [ref=f1e143]: 额度
                    - generic [ref=f1e144]: 尚未核对
                  - progressbar "已用额度" [ref=f1e145]
            - paragraph [ref=f1e147]: 授权信息保留在本机
        - contentinfo [ref=f1e151]:
          - text: Bee
          - generic [ref=f1e152]: 设备绑定不自动开始贡献
  - paragraph [ref=e17]: 贡献运行中：使用正式页面与模拟数据。操作仅影响当前预览；重置可恢复场景。
  - paragraph [ref=e18]: 使用当前正式页面代码与模拟数据；账号和贡献操作仅在预览中生效。侧栏导航、详情和设置均可操作。
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
> 41  |  await expect(page.locator('#scene optgroup')).toHaveCount(7);
      |                                                ^ Error: expect(locator).toHaveCount(expected) failed
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