# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: device.spec.ts >> opening after website confirmation consumes the latest bound result
- Location: tests/device.spec.ts:97:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('alert')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('alert') with timeout 5000ms
  - waiting for getByRole('alert')
    14 × locator resolved to 1 element
       - unexpected value "1"

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
        - paragraph [ref=e28]: 尚未接入 AI 账号
      - generic [ref=e33]:
        - text: My Mac
        - generic [ref=e34]: 设备与平台控制
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: 本机设备
    - main [ref=e41]:
      - generic [ref=e42]:
        - heading "概览" [level=1] [ref=e44]
        - button "打开 Hive 控制台" [disabled] [ref=e45]
      - generic [ref=e46]:
        - alert [ref=e47]:
          - paragraph [ref=e48]: 本次操作失败，原因尚未确认。
          - paragraph [ref=e49]: 菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。
          - group [ref=e50]:
            - generic "查看失败详情" [ref=e51] [cursor=pointer]
        - button "重新同步原生语言" [ref=e52] [cursor=pointer]
      - region "贡献运行" [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e61]:
            - heading "尚未接入 AI 账号" [level=2] [ref=e62]
            - paragraph [ref=e63]: 开始后建立连接；接单需单独恢复。
          - button "开始贡献" [disabled] [ref=e64]
        - paragraph [ref=e65]: 请先接入至少一个 AI 账号。
        - generic [ref=e66]:
          - generic [ref=e67]: Bee 未运行
          - generic [ref=e71]: 尚未建立 Hive 连接
      - region "准备贡献" [ref=e75]:
        - heading "准备贡献" [level=2] [ref=e76]
        - list [ref=e77]:
          - listitem [ref=e78]: 绑定本机设备
          - listitem [ref=e79]: 在 Hive 网页确认
          - listitem [ref=e80]: 接入 AI 账号
          - listitem [ref=e81]: 开始贡献并按平台恢复接单
        - button "前往准备账号" [ref=e82] [cursor=pointer]
      - region "设备配对" [ref=e84]:
        - generic [ref=e85]:
          - heading "本机设备" [level=2] [ref=e86]
          - button "重新核对设备" [ref=e87] [cursor=pointer]
        - generic [ref=e88]:
          - generic [ref=e89]:
            - paragraph [ref=e90]: 本机设备
            - strong [ref=e91]: My Mac
            - status [ref=e92]: 设备已绑定。
          - generic [ref=e93]:
            - paragraph [ref=e94]: 归属账号
            - strong [ref=e95]: real@example.test
            - generic [ref=e96]: 设备所属账号
          - generic [ref=e97]:
            - paragraph [ref=e98]: Hive
            - strong [ref=e99]: https://hive.example
            - generic [ref=e100]: 配对不会自动开始贡献
      - region "平台账号列表" [ref=e101]:
        - generic [ref=e102]:
          - heading "AI 账号" [level=2] [ref=e103]
          - generic [ref=e104]: 0 个已接入
        - generic [ref=e106]:
          - region "OpenAI 账号" [ref=e107]:
            - generic [ref=e113]:
              - heading "OpenAI" [level=3] [ref=e115]
              - paragraph [ref=e116]: 尚未接入 OpenAI 账号
              - paragraph [ref=e117]: 不能接单
              - paragraph [ref=e121]: 所选来源的登录状态待确认。
              - list [ref=e122]:
                - listitem [ref=e123]:
                  - text: Hive 未看到此平台的 Bee 连接
                  - paragraph [ref=e124]: 请在概览核对贡献运行和实际连接原因。
                  - button "查看连接" [ref=e125] [cursor=pointer]
            - generic [ref=e127]:
              - generic [ref=e128]:
                - generic [ref=e129]: 额度
                - generic [ref=e130]: 尚未核对
              - progressbar "已用额度" [ref=e131]
          - region "Claude 账号" [ref=e133]:
            - generic [ref=e134]:
              - generic [aria-hidden] [ref=e136]: ✳
              - generic [ref=e137]:
                - heading "Claude" [level=3] [ref=e139]
                - paragraph [ref=e140]: 尚未接入 Claude 账号
                - paragraph [ref=e141]: 不能接单
                - paragraph [ref=e145]: 所选来源的登录状态待确认。
                - list [ref=e146]:
                  - listitem [ref=e147]:
                    - text: Hive 未看到此平台的 Bee 连接
                    - paragraph [ref=e148]: 请在概览核对贡献运行和实际连接原因。
                    - button "查看连接" [ref=e149] [cursor=pointer]
            - generic [ref=e151]:
              - generic [ref=e152]:
                - generic [ref=e153]: 额度
                - generic [ref=e154]: 尚未核对
              - progressbar "已用额度" [ref=e155]
        - paragraph [ref=e157]: 授权信息保留在本机
    - contentinfo [ref=e161]:
      - text: Bee
      - generic [ref=e162]: 设备绑定不自动开始贡献
```

# Test source

```ts
  2   | const passiveRuntime={...JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot,local:'stopped',connection:'disconnected',operation:null,stop_receipt:null};
  3   | import { test, expect } from '@playwright/test';
  4   | 
  5   | test.beforeEach(async({page})=>{
  6   |  await page.addInitScript((passiveRuntime)=>{
  7   |   const runtime=window as unknown as {isTauri:boolean;__TAURI_INTERNALS__:unknown;deviceStage:string;deviceCalls:string[]};
  8   |   (window as unknown as {__TAURI_EVENT_PLUGIN_INTERNALS__:unknown}).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  9   |   runtime.isTauri=true;runtime.deviceStage='unbound';runtime.deviceCalls=[];
  10  |   let callback=1;const callbacks=new Map<number,(value:unknown)=>void>();
  11  |   const instance='b'.repeat(32);let preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[]};
  12  |   runtime.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:()=>{},invoke:async(command:string,args?:any)=>{
  13  |    if(command==='runtime_snapshot')return {instance,result:{runtime:{...((window as any).runtimeOverride??passiveRuntime),observed_at:new Date().toISOString()}}};
  14  |    runtime.deviceCalls.push(command);
  15  |    ((window as any).deviceRequests??=[]).push({command,args});
  16  |    if(command==='plugin:event|listen') {if(args.event==='bee://bridge-status'&&location.search.includes('stale-status'))setTimeout(()=>callbacks.get(args!.handler)?.({payload:{state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}}}),20);return args.handler;}
  17  |    if(command==='plugin:event|unlisten')return;
  18  |    if(command==='bridge_status'&&location.search.includes('stale-status'))return new Promise((_,reject)=>setTimeout(()=>{(window as unknown as {initialRejected:boolean}).initialRejected=true;reject(new Error('old status read failed'));},100));
  19  |    if(command==='bridge_status')return {state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}};
  20  |    if(command==='startup_status'||command==='startup_recheck')return {state:'ready',failure:null,instance,binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:1};
  21  |    if(command==='preferences_read')return {preferences,error:null};
  22  |    if(command==='preferences_save'){preferences={...args.request.preferences,revision:preferences.revision+1};return {preferences,error:null};}
  23  |    if(command==='notification_permission')return 'prompt';
  24  |    if(command==='autostart_status')return {desired:false,registered:false,error:null};
  25  |    if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
  26  |    if(command==='account_defaults')return {instance,result:{defaults:{platforms:['openai','claude'].map(platform=>({platform,directory:'/tmp/fixture',default_store:'file',stores:[{store:'file',supported:true,reason:null}]}))}}};
  27  |    if(command==='account_snapshot')return {instance,result:{account:(passiveRuntime.platforms as any)[args.platform].account}};
  28  |    if(command==='supply_status'||command==='supply_set_paused')return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform:(args as unknown as {platform:string}).platform,paused:false,ready:false,reasons:['offline'],checked_at:new Date().toISOString()}}};
  29  |    const w=window as any;
  30  |    if(command==='device_context')return {result:w.deviceContext?{context:w.deviceContext}:{binding_revision:1,error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'no saved device configuration'}}};
  31  |    if(command==='device_recovery_status')return {result:w.recovery?{recovery:structuredClone(w.recovery)}:{error:{code:'DEVICE_RECOVERY_NONE',message:'no credential recovery transaction exists'}}};
  32  |    if(command==='device_recovery_prepare'){w.recovery={operation_id:w.nextRecoveryOperation??'d'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:{id:'old-1',name:'My Mac',owner_id:'old-owner',owner_email:'old@example.test'},new_identity:null,pairing:null,failure:null};return {result:{recovery:structuredClone(w.recovery)}};}
  33  |    if(command==='device_recovery_confirm'){if(args.expected_revision!==w.recovery.revision)return {result:{error:{code:'DEVICE_RECOVERY_FAILED',message:'revision conflict actual='+w.recovery.revision+' expected='+args.expected_revision}}};w.recovery={...w.recovery,revision:w.recovery.revision+1,phase:args.decision==='adopt_owner'?'completed':'pending',pairing:args.decision==='adopt_owner'?null:{code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString()}};return {result:{recovery:structuredClone(w.recovery)}};}
  34  |    if(command==='device_begin')runtime.deviceStage='pending';
  35  |    if(command==='device_status'||command==='device_begin'||command==='device_open'){
  36  |     const delay=(window as unknown as {deviceDelay?:number}).deviceDelay;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  37  |     if(w.deviceHold)await new Promise(resolve=>{w.releaseDevice=resolve;});
  38  |     if(w.deviceFailure)return {result:{error:w.deviceFailure}};
  39  |     if(command==='device_open'&&w.openFailure)throw {code:'BROWSER_OPEN_FAILED',message:'open failed; OS denied browser launch'};
  40  |     if(w.deviceOverride)return {result:{device:structuredClone(w.deviceOverride)}};
  41  |     if(runtime.deviceStage==='error')return {result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET /api/bee/identity HTTP 503'}}};
  42  |     const device=runtime.deviceStage==='unbound'?{state:'unbound'}:runtime.deviceStage==='bound'?{state:'bound',hive:'https://hive.example',name:'My Mac',identity:{id:'device-1',name:'My Mac',owner_id:'owner-1',owner_email:'real@example.test'}}:{state:'pending',hive:'https://hive.example',name:'My Mac',user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString(),poll_interval_seconds:1};
  43  |     return {result:{device}};
  44  |    }
  45  |    throw new Error('unexpected IPC '+command);
  46  |   }};
  47  |  },passiveRuntime);
  48  | });
  49  | test('normal native build pairs and verifies without demo balances or starting supply',async({page})=>{
  50  |  await page.setViewportSize({width:860,height:600});await page.goto('/');
  51  |  await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
  52  |  await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
  53  |  await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
  54  |  await page.getByLabel('设备名称',{exact:true}).fill('My Mac');
  55  |  await page.getByRole('button',{name:'生成配对码'}).click();
  56  |  await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
  57  |  await expect(page.getByText('完成网页确认后，请回到 Bee。')).toBeVisible();
  58  |  await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
  59  |  await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
  60  |  await expect(page.getByText('real@example.test',{exact:true})).toBeVisible({timeout:10000});
  61  |  await expect(page.getByText('设备已绑定。')).toBeVisible();
  62  |  await expect(page.getByRole('button',{name:'收益',exact:true})).toHaveCount(0);
  63  |  await expect(page.getByText('设备 ID',{exact:true})).toHaveCount(0);
  64  |  await expect(page.locator('.device-facts>div')).toHaveCount(3);
  65  |  expect(await page.evaluate(()=> (window as unknown as {deviceCalls:string[]}).deviceCalls.some(c=>['runtime_start','runtime_stop','account_action','supply_set_paused','device_recovery_prepare','device_recovery_confirm'].includes(c)))).toBe(false);
  66  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  67  | });
  68  | test('failed verification blocks success and remains retryable',async({page})=>{
  69  |  await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
  70  |  await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
  71  |  await page.getByRole('button',{name:'重新核对设备'}).click();
  72  |  await expect(page.getByRole('alert').filter({hasText:'HTTP 503'}).first()).toBeVisible();
  73  |  await expect(page.getByText('设备已绑定。')).toHaveCount(0);
  74  |  await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
  75  | });
  76  | 
  77  | test('retrying a failed bound-device check does not revive cached success',async({page})=>{
  78  |  await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
  79  |  await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
  80  |  await page.getByRole('button',{name:'重新核对设备'}).click();
  81  |  await expect(page.getByText('设备已绑定。')).toBeVisible();
  82  |  await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
  83  |  await page.getByRole('button',{name:'重新核对设备'}).click();await expect(page.getByRole('alert').filter({hasText:'HTTP 503'}).first()).toBeVisible();
  84  |  await page.evaluate(()=>{(window as unknown as {deviceStage:string;deviceDelay:number}).deviceStage='bound';(window as unknown as {deviceDelay:number}).deviceDelay=500;});
  85  |  await page.getByRole('button',{name:'重新核对设备'}).click();
  86  |  await expect(page.getByText('正在核对设备…')).toBeVisible();
  87  |  await expect(page.getByText('设备已绑定。')).toHaveCount(0);
  88  |  await expect(page.getByText('设备已绑定。')).toBeVisible();
  89  | });
  90  | 
  91  | test('an old native status rejection cannot overwrite a newer ready event',async({page})=>{
  92  |  await page.goto('/?fixture=stale-status');
  93  |  await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {initialRejected:boolean}).initialRejected))).toBe(true);
  94  |  await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
  95  | });
  96  | 
  97  | test('opening after website confirmation consumes the latest bound result',async({page})=>{
  98  |  await page.goto('/');await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
  99  |  await page.getByRole('button',{name:'生成配对码'}).click();await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
  100 |  await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
  101 |  await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
> 102 |  await expect(page.getByText('设备已绑定。')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
      |                                                                                             ^ Error: expect(locator).toHaveCount(expected) failed
  103 | });
  104 | 
  105 | test('English device entry and settings have complete translations',async({page})=>{
  106 |  await page.goto('/');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
  107 |  await expect(page.getByText('Saved for this system user and retained after restarting.')).toBeVisible();
  108 |  await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'Connect this device'})).toBeVisible();
  109 |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  110 | });
  111 | 
  112 | test('diagnostics preserve runtime operation and platform authorization failure evidence',async({page})=>{
  113 |  await page.addInitScript(()=>{
  114 |   const internals=(window as any).__TAURI_INTERNALS__,invoke=internals.invoke;
  115 |   internals.invoke=async(command:string,args:unknown)=>{
  116 |    const reply=await invoke(command,args);
  117 |    if(command==='runtime_snapshot'){
  118 |     const view=reply.result.runtime;view.revision=1;
  119 |     view.operation={id:'c'.repeat(48),kind:'start',platform:null,state:'failed',revision:1,error:{code:'source_unavailable',check:'runtime_start_check',platform:'openai',message:'Fixture runtime failure',evidence:{permission_denied:'true'}}};
  120 |     view.platforms.openai.account.authorization.error={code:'source_unavailable',check:'source_read',platform:'openai',message:'Fixture authorization failure',evidence:{path:'/fixture/source'}};
  121 |    }
  122 |    return reply;
  123 |   };
  124 |  });
  125 |  await page.goto('/');await page.getByRole('button',{name:'诊断',exact:true}).click();
  126 |  await page.getByText('核对诊断',{exact:true}).click();
  127 |  const evidence=page.locator('.native-diagnostic-evidence pre');
  128 |  await expect(evidence).toContainText('runtime_start_check');await expect(evidence).toContainText('permission_denied');
  129 |  await expect(evidence).toContainText('source_read');await expect(evidence).toContainText('/fixture/source');
  130 | });
  131 | 
  132 | const deviceCalls=(page:any,command:string)=>page.evaluate((command:string)=>(window as any).deviceCalls.filter((c:string)=>c===command),command);
  133 | const recoveryView=(phase:string)=>({operation_id:'d'.repeat(48),revision:4,phase,old_identity:{id:'old-1',name:'My Mac',owner_id:'old-owner',owner_email:'old@example.test'},new_identity:['saving','completed','awaiting_owner_confirmation'].includes(phase)?{id:'new-1',name:'New Mac',owner_id:'new-owner',owner_email:'new@example.test'}:null,pairing:['pending','draining','redeeming','redemption_unknown','expired'].includes(phase)?{code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2099-01-01T00:00:00Z'}:null,failure:null});
  134 | test('a completed recovery permits another revoked identity only after confirmation with a new operation',async({page})=>{
  135 |  await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.nextRecoveryOperation='e'.repeat(48);w.deviceFailure={code:'device_replaced',message:'current device GET identity HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'New Mac',device_id:'new-1',owner_id:'new-owner',binding_revision:1};},recoveryView('completed'));
  136 |  await page.goto('/');const begin=page.getByRole('button',{name:'重新绑定设备',exact:true});await begin.click();
  137 |  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(begin).toBeFocused();
  138 |  expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
  139 |  await begin.click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  140 |  await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await expect(begin).toHaveCount(0);
  141 |  expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(1);
  142 |  const confirmations=await page.evaluate(()=>(window as any).deviceRequests.filter((request:any)=>request.command==='device_recovery_confirm'));
  143 |  expect(confirmations).toEqual([{command:'device_recovery_confirm',args:{operation_id:'e'.repeat(48),expected_revision:1,decision:'begin_pairing'}}]);
  144 |  expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
  145 | });
  146 | for(const changed of ['identity_valid','pending_transaction','query_failed'] as const)test(`a repeated recovery rechecks ${changed} after an in-flight read`,async({page})=>{
  147 |  await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});
  148 |  await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.deviceStage='bound';w.deviceContext={hive:'https://hive.example',name:'New Mac',device_id:'new-1',owner_id:'new-owner',binding_revision:1};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='device_recovery_status'&&w.holdRecovery){await new Promise(resolve=>{w.releaseRecovery=resolve;});if(w.failRecovery)throw {code:'DEVICE_RECOVERY_BLOCKED',message:'journal read permission denied'};}return invoke(command,args);};},recoveryView('completed'));
  149 |  await page.goto('/');await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
  150 |  await page.evaluate(()=>{(window as any).deviceFailure={code:'invalid_device_credential',message:'GET identity HTTP 401 invalid_device_credential'};});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();
  151 |  await page.evaluate(()=>{(window as any).holdRecovery=true;});await page.clock.runFor(10001);
  152 |  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseRecovery)).toBe('function');
  153 |  await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);
  154 |  await page.evaluate(({changed,pending})=>{const w=window as any;w.holdRecovery=false;if(changed==='identity_valid'){w.deviceFailure=null;w.deviceStage='bound';}else if(changed==='pending_transaction')w.recovery=pending;else w.failRecovery=true;w.releaseRecovery();},{changed,pending:recoveryView('pending')});
  155 |  await expect(page.getByRole('alert').filter({hasText:'DEVICE_RECOVERY_PRECONDITION'}).first()).toBeVisible();
  156 |  expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
  157 | });
  158 | test('a historical completed recovery yields preparation guidance to current account and runtime facts',async({page})=>{
  159 |  await page.addInitScript(({recovery,runtime})=>{const w=window as any;w.recovery=recovery;w.deviceStage='bound';w.runtimeOverride=runtime;}, {recovery:recoveryView('completed'),runtime:passiveRuntime});
  160 |  await page.goto('/');const device=page.getByRole('region',{name:'设备配对'});
  161 |  await expect(page.getByRole('region',{name:'准备贡献'})).toBeVisible();await expect(page.getByRole('button',{name:'前往准备账号',exact:true}).first()).toBeVisible();
  162 |  await page.evaluate(()=>{const w=window as any,r=w.runtimeOverride;r.local='running';r.run_id='a'.repeat(32);r.connection='connected';r.revision++;r.platforms.openai.account.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='account_snapshot'?{instance:'b'.repeat(32),result:{account:r.platforms[args.platform].account}}:invoke(command,args);});
  163 |  await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  164 |  await expect(page.getByRole('region',{name:'准备贡献'})).toHaveCount(0);await expect(device.getByRole('button',{name:'前往准备账号',exact:true})).toHaveCount(0);
  165 |  await expect(device.getByText('重新绑定已完成，贡献保持停止。',{exact:true})).toHaveCount(0);await expect(device.getByText('请重新准备账号；旧账号选择与运行意图不会迁移。',{exact:true})).toHaveCount(0);
  166 |  expect(await deviceCalls(page,'runtime_start')).toHaveLength(0);
  167 | });
  168 | test('initial device facts stay unknown until the first read finishes',async({page})=>{
  169 |  await page.addInitScript(()=>{(window as any).deviceHold=true;});await page.goto('/');
  170 |  await expect(page.getByText('正在读取设备与账号状态',{exact:true}).first()).toBeVisible();
  171 |  await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toHaveCount(0);
  172 |  await expect(page.getByRole('heading',{name:'连接本机设备',exact:true})).toHaveCount(0);
  173 |  await page.evaluate(()=>{const w=window as any;w.deviceHold=false;w.releaseDevice();});
  174 |  await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toBeVisible();
  175 |  await expect(page.getByRole('region',{name:'准备贡献'})).toBeVisible();
  176 | });
  177 | test('pairing copy feedback and failed browser opening retain the same request',async({page,context})=>{
  178 |  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.goto('/');
  179 |  await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');await page.getByRole('button',{name:'生成配对码',exact:true}).click();
  180 |  await page.getByRole('button',{name:'复制配对码',exact:true}).click();await expect(page.getByText('配对码已复制',{exact:true})).toBeVisible();
  181 |  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard permission denied');}}});(window as any).openFailure=true;});
  182 |  await page.getByRole('button',{name:'复制确认网址',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'clipboard permission denied'})).toBeVisible();
  183 |  await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();await expect(page.getByText('https://hive.example/devices/pair?code=ABCD-EFGH',{exact:true})).toBeVisible();
  184 |  await expect(page.getByRole('alert').filter({hasText:'OS denied browser launch'})).toBeVisible();expect(await deviceCalls(page,'device_begin')).toHaveLength(1);
  185 | });
  186 | for(const [phase,copy] of [['creation_unknown','创建结果未知'],['draining','等待旧设备完成任务和结算'],['redeeming','兑换已提交，正在核对新设备身份'],['redemption_unknown','兑换结果未知，正在核对新设备身份'],['saving','新设备身份已核对，正在保存本机配置']] as const)test(`initial pairing presents ${phase} from its durable transaction`,async({page})=>{
  187 |  const recovery={...recoveryView(phase),old_identity:null};if(phase==='saving')recovery.failure={code:'DEVICE_RECOVERY_BLOCKED',message:'atomic save permission denied'} as any;
  188 |  await page.addInitScript(recovery=>{(window as any).deviceOverride={state:['draining'].includes(recovery.phase)?'draining':'pairing',hive:'https://hive.example',name:'My Mac',...(recovery.phase==='draining'?{user_code:recovery.pairing!.code,verification_url:recovery.pairing!.verification_url,expires_at:recovery.pairing!.expires_at,poll_interval_seconds:2}:{}),recovery};},recovery);
  189 |  await page.goto('/');await expect(page.getByText(phase==='saving'?'本机保存未完成，需重新核对':copy,{exact:true})).toBeVisible();await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  190 |  expect(await deviceCalls(page,'device_begin')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
  191 | });
  192 | test('revoked credential recovery asks before preparing and preserves one transaction across navigation',async({page})=>{
  193 |  await page.addInitScript(()=>{const w=window as any;w.deviceFailure={code:'device_replaced',message:'HTTP 401 device_replaced'};w.deviceContext={hive:'https://hive.example',name:'Old Mac',device_id:'old-1',owner_id:'old-owner',binding_revision:1};});await page.goto('/');
  194 |  await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  195 |  await expect(page.getByRole('button',{name:'重新绑定设备',exact:true})).toBeFocused();
  196 |  expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
  197 |  await page.getByRole('button',{name:'重新绑定设备',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
  198 |  await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
  199 |  await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
  200 |  await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(1);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(1);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
  201 | });
  202 | test('restarted unknown recovery queries the existing transaction without writes',async({page})=>{
```