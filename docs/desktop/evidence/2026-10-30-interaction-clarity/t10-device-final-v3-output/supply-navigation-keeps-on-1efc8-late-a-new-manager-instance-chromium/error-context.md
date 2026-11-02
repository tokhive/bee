# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supply.spec.ts >> navigation keeps one application poller and old results cannot repopulate a new manager instance
- Location: tests/supply.spec.ts:107:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 4
Received: 6
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]: Bee
    - navigation "主导航" [ref=e7]:
      - button "概览" [ref=e8] [cursor=pointer]
      - button "AI 账号" [ref=e12] [cursor=pointer]
      - button "诊断" [ref=e18] [cursor=pointer]
      - button "设置" [ref=e21] [cursor=pointer]
    - generic [ref=e25]:
      - generic [ref=e26]:
        - text: hive.example
        - paragraph [ref=e28]: 接单条件尚未满足
      - generic [ref=e33]:
        - text: Fixture Mac
        - generic [ref=e34]: 设备与平台控制
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: 本机设备
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "设置" [active] [level=1] [ref=e44]
          - paragraph [ref=e45]: 管理设备偏好与应用设置。
        - button "打开 Hive 控制台" [ref=e46] [cursor=pointer]
      - generic [ref=e47]:
        - tablist "设置分类" [ref=e48]:
          - tab "通用" [ref=e49] [cursor=pointer]
          - tab "网络与代理" [selected] [ref=e50] [cursor=pointer]
          - tab "通知与启动" [ref=e51] [cursor=pointer]
          - tab "关于" [ref=e52] [cursor=pointer]
        - tabpanel "网络与代理" [ref=e53]:
          - region [ref=e54]:
            - generic [ref=e55]:
              - heading "网络与代理" [level=2] [ref=e56]
              - paragraph [ref=e57]: 可直接连接；只有需要本机代理时才填写下面的地址。
            - generic [ref=e58]:
              - generic [ref=e59]:
                - paragraph [ref=e60]:
                  - generic [ref=e61]: 适用范围
                  - text: https://hive.example
                - generic [ref=e62]:
                  - generic [ref=e63]:
                    - text: 本机 HTTP 代理
                    - textbox "本机 HTTP 代理" [ref=e64]:
                      - /placeholder: http://127.0.0.1:7890
                  - paragraph [ref=e65]: 留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。
                  - generic [ref=e66]:
                    - button "保存代理" [ref=e67] [cursor=pointer]
                    - button "测试连接" [ref=e68] [cursor=pointer]
              - complementary "配置与实际路径" [ref=e69]:
                - generic [ref=e70]:
                  - heading "配置与实际路径" [level=3] [ref=e71]
                  - button "刷新生效路径" [ref=e72] [cursor=pointer]
                - generic [ref=e73]:
                  - generic [ref=e74]:
                    - term [ref=e75]: 已保存配置
                    - definition [ref=e76]: 代理未启用
                  - generic [ref=e77]:
                    - term [ref=e78]: 当前生效配置
                    - definition [ref=e79]: 代理未启用
                - table [ref=e80]:
                  - caption [ref=e81]: 当前实际生效路径
                  - rowgroup [ref=e82]:
                    - row [ref=e83]:
                      - columnheader "流量" [ref=e84]
                      - columnheader "路径" [ref=e85]
                  - rowgroup [ref=e86]:
                    - row [ref=e87]:
                      - rowheader "Bee 转发的上游连接" [ref=e88]
                      - cell "直连" [ref=e89]
                    - row [ref=e90]:
                      - rowheader "官方查询与续期" [ref=e91]
                      - 'cell "OpenAI: 直连 Claude: 直连" [ref=e92]': "OpenAI: 直连Claude: 直连"
                    - row [ref=e93]:
                      - rowheader "Hive HTTP / WebSocket" [ref=e94]
                      - cell "沿用进程环境" [ref=e95]
                    - row [ref=e96]:
                      - rowheader "官方客户端登录" [ref=e97]
                      - cell "由官方客户端管理" [ref=e98]
                - paragraph [ref=e99]: 官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。
    - contentinfo [ref=e100]:
      - text: Bee
      - generic [ref=e101]: 设备绑定不自动开始贡献
```

# Test source

```ts
  10  |   let callback=1;const callbacks=new Map<number,(value:unknown)=>void>(),subscriptions=new Map<number,string>();
  11  |   const status=(instance=currentInstance)=>({state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}});
  12  |   let currentInstance='b'.repeat(32),preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[]};
  13  |   w.emit=instance=>{currentInstance=instance;for(const [handler,event]of subscriptions)if(event==='bee://bridge-status')callbacks.get(handler)?.({payload:status(instance)});};
  14  |   w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event:string,id:number)=>{subscriptions.delete(id);callbacks.delete(id);}};
  15  |   w.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:(id:number)=>{callbacks.delete(id);},invoke:async(command:string,args?:{platform?:string;paused?:boolean;handler?:number;event?:string;eventId?:number;request?:{preferences:typeof preferences}})=>{
  16  |    if(command==='plugin:event|listen'){subscriptions.set(args!.handler!,args!.event!);return args!.handler;}
  17  |    if(command==='plugin:event|unlisten'){subscriptions.delete(args!.eventId!);return;}
  18  |    if(command==='runtime_snapshot')return {instance:currentInstance,result:{runtime:{...options.passiveRuntime,observed_at:new Date().toISOString(),platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:options.accounts[p],supply:null,selection_revision:1}]))}}};
  19  |    if(command==='bridge_status')return status();
  20  |    if(command==='startup_status'||command==='startup_recheck')return {state:'ready',failure:null,instance:currentInstance,binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:1};
  21  |    if(command==='device_recovery_status')return {result:{error:{code:'DEVICE_RECOVERY_NONE',message:'no credential recovery transaction exists'}}};
  22  |    if(command==='device_context')return {instance:currentInstance,result:{context:{hive:'https://hive.example',name:'Fixture Mac',device_id:'device-1',owner_id:'owner-1',binding_revision:1}}};
  23  |    if(command==='preferences_read')return structuredClone({preferences,error:null});
  24  |    if(command==='preferences_save'){preferences={...args!.request!.preferences,revision:preferences.revision+1};return structuredClone({preferences,error:null});}
  25  |    if(command==='native_locale_sync')return null;
  26  |     if(command==='notification_permission')return 'prompt';
  27  |    if(command==='autostart_status')return {desired:false,registered:false,error:null};
  28  |    if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
  29  |    if(command==='account_defaults')return {instance:currentInstance,result:{defaults:{platforms:['openai','claude'].map(platform=>({platform,directory:platform==='openai'?'/tmp/codex':'/tmp/claude',default_store:'file',stores:[{store:'file',supported:true,reason:null}]}))}}};
  30  |    if(command==='account_snapshot')return {instance:currentInstance,result:{account:options.accounts[args!.platform!]}};
  31  |    if(command==='device_status')return {result:{device:options.unbound?{state:'unbound'}:{state:'bound',hive:'https://hive.example',name:'Fixture Mac',identity:{id:'device-1',name:'Fixture Mac',owner_id:'owner-1',owner_email:'fixture@example.test'}}}};
  32  |    if(command.startsWith('supply_')){
  33  |     const platform=args!.platform!,entry={command,platform,instance:currentInstance,startedAt:Date.now(),completedAt:undefined as number|undefined,...(args?.paused===undefined?{}:{paused:args.paused})};
  34  |     w.calls.push(entry);w.maxActive=Math.max(w.maxActive,++w.active);w.platformMaxActive[platform]=Math.max(w.platformMaxActive[platform],++w.platformActive[platform]);
  35  |     const fail=w.fail,age=w.age;
  36  |     try{
  37  |      if(w.delay)await new Promise(resolve=>setTimeout(resolve,w.delay));
  38  |      if(command==='supply_set_paused')w.paused[platform]=args!.paused!;
  39  |      if(fail&&(!w.failPlatform||w.failPlatform===platform))return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:fail}}};
  40  |      const paused=w.paused[platform];const reasons=paused?['manually_paused','offline']:options.ready?[]:['offline',...(platform==='openai'?['codex_source_unavailable','authorization_unavailable']:['not_configured'])];
  41  |      return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform,paused,ready:reasons.length===0,reasons,checked_at:new Date(Date.now()-age).toISOString()}}};
  42  |     }finally{entry.completedAt=Date.now();w.active--;w.platformActive[platform]--;}
  43  |    }
  44  |    throw new Error('unexpected fixture IPC '+command);
  45  |   }};
  46  |  },{...options,passiveRuntime,accounts});
  47  | }
  48  | async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('.native-diagnostic-evidence pre')).toContainText(message);await page.getByRole('button',{name:'概览',exact:true}).click();}
  49  | interface SupplyCall {command:string;platform?:string;instance:string;startedAt:number;completedAt?:number}
  50  | const calls=(page:Page,command:string):Promise<SupplyCall[]>=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
  51  | const card=(page:Page,platform:string)=>page.getByRole('region',{name:`${platform} 账号`,exact:true});
  52  | test('two verified shared account rows show real reasons and explicit pause/resume semantics at 860x600',async({page})=>{
  53  |  await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');
  54  |  const openai=card(page,'OpenAI'),claude=card(page,'Claude');
  55  |  await expect(openai.getByText('不能接单')).toBeVisible();await expect(openai.getByText('Hive 未看到此平台的 Bee 连接')).toBeVisible();
  56  |  await expect(openai.getByText('无法读取 Codex 官方登录')).toBeVisible();await expect(claude.getByText('已手动暂停')).toBeVisible();
  57  |  await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
  58  |  await claude.getByRole('button',{name:'恢复接单'}).click();await expect(claude.getByText('不能接单')).toBeVisible();await expect(claude.getByText('此 Hive 未提供更具体的接单原因')).toBeVisible();
  59  |  await openai.getByRole('button',{name:'暂停接单',exact:true}).click();await expect(openai.getByText('已手动暂停')).toBeVisible();
  60  |  expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
  61  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  62  |  await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
  63  |  await page.getByRole('region',{name:'平台账号列表',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-zh-860.png'});
  64  | });
  65  | test('an uncertain write retries GET automatically, preserves diagnostics and never repeats PUT',async({page})=>{
  66  |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');
  67  |  await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
  68  |  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  69  |  await page.evaluate(()=>{(window as unknown as {fail:string}).fail='PUT /api/bee/platforms/openai HTTP 503; result unconfirmed';});
  70  |  await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
  71  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);
  72  |  await page.clock.runFor(9999);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
  73  |  await page.evaluate(()=>{const w=window as unknown as {fail:string;delay:number};w.fail='';w.delay=500;});await page.clock.runFor(1);
  74  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('重试中…',{exact:true})).toBeVisible();await diagnostics(page,'PUT /api/bee/platforms/openai HTTP 503');
  75  |  await page.clock.runFor(2200);await expect(openai.getByText('已手动暂停')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  76  |  expect(await page.evaluate(()=> (window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(1);
  77  |  await expect(page.getByRole('button',{name:'重新核对平台'})).toHaveCount(0);
  78  | });
  79  | test('independent platform polling waits ten seconds after completion and never overlaps the same platform',async({page})=>{
  80  |  await fixture(page,{delay:700});await page.clock.install();await page.clock.pauseAt(new Date());await page.goto('/');
  81  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(2);await page.clock.runFor(700);
  82  |  await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  83  |  const initial=await calls(page,'supply_status');expect(initial.map(c=>c.platform).sort()).toEqual(['claude','openai']);expect(initial.every(c=>c.completedAt!==undefined)).toBe(true);
  84  |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(2);
  85  |  await page.evaluate(()=>{(window as any).fail='GET /api/bee/platforms/openai HTTP 502';});await page.clock.runFor(1);
  86  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(4);await page.clock.runFor(700);
  87  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
  88  |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(4);await page.clock.runFor(1);
  89  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(6);await page.clock.runFor(700);
  90  |  const reads=await calls(page,'supply_status');
  91  |  for(const platform of ['openai','claude']){const own=reads.filter(c=>c.platform===platform);expect(own).toHaveLength(3);for(let i=1;i<own.length;i++)expect(own[i].startedAt-own[i-1].completedAt!).toBe(10000);}
  92  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
  93  |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  94  | });
  95  | test('expired snapshots never show a current successful state or enable writes',async({page})=>{
  96  |  await fixture(page,{age:31000,ready:true});await page.goto('/');const openai=card(page,'OpenAI');
  97  |  await expect(openai.getByText('状态待更新')).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
  98  | });
  99  | test('fresh background reads stay quiet and hide previous success only when thirty seconds expire',async({page})=>{
  100 |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
  101 |  await page.evaluate(()=>{(window as unknown as {delay:number}).delay=60000;});await page.clock.runFor(11000);
  102 |  await expect(openai.getByText('可接单',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toHaveCount(0);
  103 |  await page.clock.runFor(20000);await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
  104 |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  105 |  expect(await page.evaluate(()=>(window as any).platformActive)).toEqual({openai:1,claude:1});
  106 | });
  107 | test('navigation keeps one application poller and old results cannot repopulate a new manager instance',async({page})=>{
  108 |  await fixture(page);await page.clock.install();await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  109 |  await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.clock.runFor(10001);
> 110 |  await page.getByRole('button',{name:'设置',exact:true}).click();await page.clock.runFor(1500);const count=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(9000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count);await page.clock.runFor(3500);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count+2);
      |                                                                                                                                                                                                                                                                                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  111 |  await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='new instance GET HTTP 503';w.emit('c'.repeat(32));});
  112 |  await page.getByRole('button',{name:'概览',exact:true}).click();await diagnostics(page,'new instance GET HTTP 503');await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
  113 | });
  114 | test('English platform controls and reason copy are complete at minimum width',async({page})=>{
  115 |  await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  116 |  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
  117 |  await expect(page.getByRole('region',{name:'OpenAI account',exact:true}).getByText('Hive does not see this platform’s Bee connection')).toBeVisible();await expect(page.getByRole('region',{name:'Claude account',exact:true}).getByRole('button',{name:'Resume tasks',exact:true})).toBeEnabled();
  118 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  119 |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  120 |  await page.getByRole('region',{name:'Platform accounts',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-en-860.png'});
  121 | });
  122 | test('unverified devices never issue supply IPC',async({page})=>{
  123 |  await fixture(page,{unbound:true});await page.goto('/');await expect(page.getByRole('heading',{name:'尚未绑定本机设备',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls)).toEqual([]);
  124 | });
  125 | 
  126 | test('old in-flight platform reads cannot overwrite replacement failure or schedule another old-instance round',async({page})=>{
  127 |  await fixture(page,{ready:true});await page.clock.install();await page.clock.pauseAt(new Date());await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  128 |  await page.evaluate(()=>{(window as any).delay=1000;});await page.clock.runFor(10000);
  129 |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(4);
  130 |  expect(await page.evaluate(()=>(window as any).platformActive)).toEqual({openai:1,claude:1});
  131 |  await page.evaluate(()=>{const w=window as any;w.delay=0;w.fail='replacement GET HTTP 503';w.emit('c'.repeat(32));});await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);
  132 |  expect(await calls(page,'supply_status')).toHaveLength(4);await page.clock.runFor(1000);
  133 |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(6);
  134 |  await diagnostics(page,'replacement GET HTTP 503');await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
  135 |  const reads=await calls(page,'supply_status');expect(reads.map(c=>[c.instance,c.platform])).toEqual([['b'.repeat(32),'openai'],['b'.repeat(32),'claude'],['b'.repeat(32),'openai'],['b'.repeat(32),'claude'],['c'.repeat(32),'openai'],['c'.repeat(32),'claude']]);
  136 |  expect(reads[4].startedAt).toBeGreaterThanOrEqual(Math.max(reads[2].completedAt!,reads[3].completedAt!));
  137 |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(6);await page.clock.runFor(1);await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(8);
  138 |  expect((await calls(page,'supply_status')).slice(6).map(c=>c.instance)).toEqual(['c'.repeat(32),'c'.repeat(32)]);
  139 |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  140 | });
  141 | 
  142 | test('a delayed expiry timer cannot authorize a write from a stale rendered button',async({page})=>{
  143 |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();
  144 |  await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+31000)));await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
  145 |  expect(await page.evaluate(()=>(window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(0);
  146 |  await expect(openai.getByText('状态待更新')).toBeVisible();
  147 | });
  148 | 
  149 | test('manager replacement invalidates device data while preserving this run’s language and navigation',async({page})=>{
  150 |  await fixture(page);await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  151 |  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
  152 |  await page.evaluate(()=>(window as unknown as {emit:(id:string)=>void}).emit('c'.repeat(32)));
  153 |  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await page.getByRole('tab',{name:'General',exact:true}).click();await expect(page.getByLabel('Language',{exact:true})).toHaveValue('en');
  154 | });
  155 | 
  156 | test('one platform read failure preserves the other platform fresh report',async({page})=>{
  157 |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');
  158 |  await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  159 |  await page.evaluate(()=>{const w=window as unknown as {fail:string;failPlatform:string};w.fail='GET openai HTTP 503';w.failPlatform='openai';});
  160 |  await page.clock.runFor(11000);
  161 |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await diagnostics(page,'GET openai HTTP 503');
  162 |  await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
  163 | });
  164 | 
  165 | for(const [reason,summary]of [['account_not_registered','Hive 账号注册尚未完成'],['market_not_open','Hive 尚未开放 OpenAI 模型交易'],['supply_not_enabled','Hive 尚未启用此平台供给'],['supply_device_restricted','Hive 供给绑定限制了当前设备'],['account_not_admitted','当前账号不在 Hive 供给准入集合中']])test(`detailed supply ${reason} preserves pause and offers its real handling object`,async({page})=>{
  166 |  const a=accountFixture('openai') as any;a.selection={...a.selection,state:'selected',fingerprint:'b'.repeat(64)};
  167 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{reasons:{openai:[reason,'quota_exhausted']}},accounts:{openai:a,claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(card(page,'OpenAI').getByText(summary,{exact:true})).toBeVisible();await expect(card(page,'OpenAI').getByText('账号订阅额度已耗尽',{exact:true})).toBeVisible();await card(page,'OpenAI').getByRole('button',{name:'暂停接单',exact:true}).click();await expect(card(page,'OpenAI').getByText('已手动暂停',{exact:true})).toBeVisible();await expect(card(page,'OpenAI').getByText(summary,{exact:true})).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(0);
  168 | });
  169 | 
```