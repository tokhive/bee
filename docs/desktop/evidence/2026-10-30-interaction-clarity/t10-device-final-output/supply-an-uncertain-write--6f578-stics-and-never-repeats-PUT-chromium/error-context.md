# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supply.spec.ts >> an uncertain write retries GET automatically, preserves diagnostics and never repeats PUT
- Location: tests/supply.spec.ts:64:1

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
        - paragraph [ref=e28]: 可接单
      - generic [ref=e33]:
        - text: Fixture Mac
        - generic [ref=e34]: 设备与平台控制
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: 本机设备
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "诊断" [active] [level=1] [ref=e44]
          - paragraph [ref=e45]: 检查 Bee 运行与连接状态。
        - button "打开 Hive 控制台" [ref=e46] [cursor=pointer]
      - generic [ref=e47]:
        - alert [ref=e48]:
          - paragraph [ref=e49]: 本次操作失败，原因尚未确认。
          - paragraph [ref=e50]: 菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。
          - group [ref=e51]:
            - generic "查看失败详情" [ref=e52] [cursor=pointer]
        - button "重新同步原生语言" [ref=e53] [cursor=pointer]
      - generic [ref=e54]:
        - generic [ref=e55]:
          - tablist "诊断内容" [ref=e56]:
            - tab "检查结果" [selected] [ref=e57] [cursor=pointer]
            - tab "安全日志" [ref=e58] [cursor=pointer]
          - generic [ref=e59]:
            - button "运行诊断" [ref=e60] [cursor=pointer]
            - button "导出脱敏报告" [disabled] [ref=e61]
        - tabpanel "检查结果" [ref=e62]:
          - generic [ref=e63]:
            - heading "尚未运行诊断" [level=2] [ref=e67]
            - paragraph [ref=e68]: 点击运行诊断，查看当前设备的真实检查结果。
            - generic [ref=e69]: 检查设备、账号与网络；诊断不会开始贡献。
      - group [ref=e70]:
        - generic "运行详情" [ref=e71]
    - contentinfo [ref=e72]:
      - text: Bee
      - generic [ref=e73]: 设备绑定不自动开始贡献
```

# Test source

```ts
  1   | import {readFileSync} from 'node:fs';
  2   | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  3   | const passiveRuntime={...JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot,local:'running',connection:'connected',operation:null,stop_receipt:null};
  4   | import { test, expect, type Page } from '@playwright/test';
  5   | async function fixture(page:Page, options:{delay?:number;age?:number;ready?:boolean;unbound?:boolean}={}) {
  6   |  const accounts=Object.fromEntries(['openai','claude'].map(p=>{const a=accountFixture(p) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return [p,a];}));
  7   |  await page.addInitScript((options)=>{
  8   |   type Runtime={isTauri:boolean;__TAURI_INTERNALS__:unknown;__TAURI_EVENT_PLUGIN_INTERNALS__:unknown;calls:{command:string;platform?:string;paused?:boolean;instance:string;startedAt:number;completedAt?:number}[];active:number;maxActive:number;platformActive:Record<string,number>;platformMaxActive:Record<string,number>;delay:number;fail:string;failPlatform?:string;age:number;emit:(instance:string)=>void;paused:Record<string,boolean>};
  9   |   const w=window as unknown as Runtime;w.isTauri=true;w.calls=[];w.active=0;w.maxActive=0;w.platformActive={openai:0,claude:0};w.platformMaxActive={openai:0,claude:0};w.delay=options.delay??0;w.fail='';w.age=options.age??0;w.paused={openai:false,claude:true};
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
  25  |    if(command==='notification_permission')return 'prompt';
  26  |    if(command==='autostart_status')return {desired:false,registered:false,error:null};
  27  |    if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
  28  |    if(command==='account_defaults')return {instance:currentInstance,result:{defaults:{platforms:['openai','claude'].map(platform=>({platform,directory:platform==='openai'?'/tmp/codex':'/tmp/claude',default_store:'file',stores:[{store:'file',supported:true,reason:null}]}))}}};
  29  |    if(command==='account_snapshot')return {instance:currentInstance,result:{account:options.accounts[args!.platform!]}};
  30  |    if(command==='device_status')return {result:{device:options.unbound?{state:'unbound'}:{state:'bound',hive:'https://hive.example',name:'Fixture Mac',identity:{id:'device-1',name:'Fixture Mac',owner_id:'owner-1',owner_email:'fixture@example.test'}}}};
  31  |    if(command.startsWith('supply_')){
  32  |     const platform=args!.platform!,entry={command,platform,instance:currentInstance,startedAt:Date.now(),completedAt:undefined as number|undefined,...(args?.paused===undefined?{}:{paused:args.paused})};
  33  |     w.calls.push(entry);w.maxActive=Math.max(w.maxActive,++w.active);w.platformMaxActive[platform]=Math.max(w.platformMaxActive[platform],++w.platformActive[platform]);
  34  |     const fail=w.fail,age=w.age;
  35  |     try{
  36  |      if(w.delay)await new Promise(resolve=>setTimeout(resolve,w.delay));
  37  |      if(command==='supply_set_paused')w.paused[platform]=args!.paused!;
  38  |      if(fail&&(!w.failPlatform||w.failPlatform===platform))return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:fail}}};
  39  |      const paused=w.paused[platform];const reasons=paused?['manually_paused','offline']:options.ready?[]:['offline',...(platform==='openai'?['codex_source_unavailable','authorization_unavailable']:['not_configured'])];
  40  |      return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform,paused,ready:reasons.length===0,reasons,checked_at:new Date(Date.now()-age).toISOString()}}};
  41  |     }finally{entry.completedAt=Date.now();w.active--;w.platformActive[platform]--;}
  42  |    }
  43  |    throw new Error('unexpected fixture IPC '+command);
  44  |   }};
  45  |  },{...options,passiveRuntime,accounts});
  46  | }
> 47  | async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('.native-diagnostic-evidence pre')).toContainText(message);await page.getByRole('button',{name:'概览',exact:true}).click();}
      |                                                                                                                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  48  | interface SupplyCall {command:string;platform?:string;instance:string;startedAt:number;completedAt?:number}
  49  | const calls=(page:Page,command:string):Promise<SupplyCall[]>=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
  50  | const card=(page:Page,platform:string)=>page.getByRole('region',{name:`${platform} 账号`,exact:true});
  51  | test('two verified shared account rows show real reasons and explicit pause/resume semantics at 860x600',async({page})=>{
  52  |  await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');
  53  |  const openai=card(page,'OpenAI'),claude=card(page,'Claude');
  54  |  await expect(openai.getByText('不能接单')).toBeVisible();await expect(openai.getByText('Hive 未看到此平台的 Bee 连接')).toBeVisible();
  55  |  await expect(openai.getByText('无法读取 Codex 官方登录')).toBeVisible();await expect(claude.getByText('已手动暂停')).toBeVisible();
  56  |  await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
  57  |  await claude.getByRole('button',{name:'恢复接单'}).click();await expect(claude.getByText('不能接单')).toBeVisible();await expect(claude.getByText('此 Hive 未提供更具体的接单原因')).toBeVisible();
  58  |  await openai.getByRole('button',{name:'暂停接单',exact:true}).click();await expect(openai.getByText('已手动暂停')).toBeVisible();
  59  |  expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
  60  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  61  |  await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
  62  |  await page.getByRole('region',{name:'平台账号列表',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-zh-860.png'});
  63  | });
  64  | test('an uncertain write retries GET automatically, preserves diagnostics and never repeats PUT',async({page})=>{
  65  |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');
  66  |  await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
  67  |  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  68  |  await page.evaluate(()=>{(window as unknown as {fail:string}).fail='PUT /api/bee/platforms/openai HTTP 503; result unconfirmed';});
  69  |  await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
  70  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);
  71  |  await page.clock.runFor(9999);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
  72  |  await page.evaluate(()=>{const w=window as unknown as {fail:string;delay:number};w.fail='';w.delay=500;});await page.clock.runFor(1);
  73  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('重试中…',{exact:true})).toBeVisible();await diagnostics(page,'PUT /api/bee/platforms/openai HTTP 503');
  74  |  await page.clock.runFor(2200);await expect(openai.getByText('已手动暂停')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  75  |  expect(await page.evaluate(()=> (window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(1);
  76  |  await expect(page.getByRole('button',{name:'重新核对平台'})).toHaveCount(0);
  77  | });
  78  | test('independent platform polling waits ten seconds after completion and never overlaps the same platform',async({page})=>{
  79  |  await fixture(page,{delay:700});await page.clock.install();await page.clock.pauseAt(new Date());await page.goto('/');
  80  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(2);await page.clock.runFor(700);
  81  |  await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  82  |  const initial=await calls(page,'supply_status');expect(initial.map(c=>c.platform).sort()).toEqual(['claude','openai']);expect(initial.every(c=>c.completedAt!==undefined)).toBe(true);
  83  |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(2);
  84  |  await page.evaluate(()=>{(window as any).fail='GET /api/bee/platforms/openai HTTP 502';});await page.clock.runFor(1);
  85  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(4);await page.clock.runFor(700);
  86  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
  87  |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(4);await page.clock.runFor(1);
  88  |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(6);await page.clock.runFor(700);
  89  |  const reads=await calls(page,'supply_status');
  90  |  for(const platform of ['openai','claude']){const own=reads.filter(c=>c.platform===platform);expect(own).toHaveLength(3);for(let i=1;i<own.length;i++)expect(own[i].startedAt-own[i-1].completedAt!).toBe(10000);}
  91  |  await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
  92  |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  93  | });
  94  | test('expired snapshots never show a current successful state or enable writes',async({page})=>{
  95  |  await fixture(page,{age:31000,ready:true});await page.goto('/');const openai=card(page,'OpenAI');
  96  |  await expect(openai.getByText('状态待更新')).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
  97  | });
  98  | test('fresh background reads stay quiet and hide previous success only when thirty seconds expire',async({page})=>{
  99  |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
  100 |  await page.evaluate(()=>{(window as unknown as {delay:number}).delay=60000;});await page.clock.runFor(11000);
  101 |  await expect(openai.getByText('可接单',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toHaveCount(0);
  102 |  await page.clock.runFor(20000);await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
  103 |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  104 |  expect(await page.evaluate(()=>(window as any).platformActive)).toEqual({openai:1,claude:1});
  105 | });
  106 | test('navigation keeps one application poller and old results cannot repopulate a new manager instance',async({page})=>{
  107 |  await fixture(page);await page.clock.install();await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  108 |  await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.clock.runFor(10001);
  109 |  await page.getByRole('button',{name:'设置',exact:true}).click();await page.clock.runFor(1500);const count=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(9000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count);await page.clock.runFor(3500);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count+2);
  110 |  await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='new instance GET HTTP 503';w.emit('c'.repeat(32));});
  111 |  await page.getByRole('button',{name:'概览',exact:true}).click();await diagnostics(page,'new instance GET HTTP 503');await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
  112 | });
  113 | test('English platform controls and reason copy are complete at minimum width',async({page})=>{
  114 |  await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  115 |  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
  116 |  await expect(page.getByRole('region',{name:'OpenAI account',exact:true}).getByText('Hive does not see this platform’s Bee connection')).toBeVisible();await expect(page.getByRole('region',{name:'Claude account',exact:true}).getByRole('button',{name:'Resume tasks',exact:true})).toBeEnabled();
  117 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  118 |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  119 |  await page.getByRole('region',{name:'Platform accounts',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-en-860.png'});
  120 | });
  121 | test('unverified devices never issue supply IPC',async({page})=>{
  122 |  await fixture(page,{unbound:true});await page.goto('/');await expect(page.getByRole('heading',{name:'尚未绑定本机设备',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls)).toEqual([]);
  123 | });
  124 | 
  125 | test('old in-flight platform reads cannot overwrite replacement failure or schedule another old-instance round',async({page})=>{
  126 |  await fixture(page,{ready:true});await page.clock.install();await page.clock.pauseAt(new Date());await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
  127 |  await page.evaluate(()=>{(window as any).delay=1000;});await page.clock.runFor(10000);
  128 |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(4);
  129 |  expect(await page.evaluate(()=>(window as any).platformActive)).toEqual({openai:1,claude:1});
  130 |  await page.evaluate(()=>{const w=window as any;w.delay=0;w.fail='replacement GET HTTP 503';w.emit('c'.repeat(32));});await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);
  131 |  expect(await calls(page,'supply_status')).toHaveLength(4);await page.clock.runFor(1000);
  132 |  await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(6);
  133 |  await diagnostics(page,'replacement GET HTTP 503');await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
  134 |  const reads=await calls(page,'supply_status');expect(reads.map(c=>[c.instance,c.platform])).toEqual([['b'.repeat(32),'openai'],['b'.repeat(32),'claude'],['b'.repeat(32),'openai'],['b'.repeat(32),'claude'],['c'.repeat(32),'openai'],['c'.repeat(32),'claude']]);
  135 |  expect(reads[4].startedAt).toBeGreaterThanOrEqual(Math.max(reads[2].completedAt!,reads[3].completedAt!));
  136 |  await page.clock.runFor(9999);expect(await calls(page,'supply_status')).toHaveLength(6);await page.clock.runFor(1);await expect.poll(async()=>(await calls(page,'supply_status')).length).toBe(8);
  137 |  expect((await calls(page,'supply_status')).slice(6).map(c=>c.instance)).toEqual(['c'.repeat(32),'c'.repeat(32)]);
  138 |  expect(await page.evaluate(()=>(window as any).platformMaxActive)).toEqual({openai:1,claude:1});expect(await page.evaluate(()=>(window as any).maxActive)).toBe(2);
  139 | });
  140 | 
  141 | test('a delayed expiry timer cannot authorize a write from a stale rendered button',async({page})=>{
  142 |  await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();
  143 |  await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+31000)));await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
  144 |  expect(await page.evaluate(()=>(window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(0);
  145 |  await expect(openai.getByText('状态待更新')).toBeVisible();
  146 | });
  147 | 
```