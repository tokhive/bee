# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: device.spec.ts >> diagnostics preserve runtime operation and platform authorization failure evidence
- Location: tests/device.spec.ts:112:1

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
        - text: 尚未连接 Hive
        - paragraph [ref=f1e28]: 尚未绑定本机设备
      - generic [ref=f1e33]:
        - text: Bee 桌面端
        - generic [ref=f1e34]: 设备与平台控制
  - generic [ref=f1e35]:
    - banner [ref=f1e36]:
      - generic [ref=f1e37]: 本机设备
    - main [ref=f1e41]:
      - generic [ref=f1e42]:
        - heading "概览" [active] [level=1] [ref=f1e44]
        - button "打开 Hive 控制台" [disabled] [ref=f1e45]
      - generic [ref=f1e46]:
        - alert [ref=f1e47]:
          - paragraph [ref=f1e48]: 本次操作失败，原因尚未确认。
          - paragraph [ref=f1e49]: 菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。
          - group [ref=f1e50]:
            - generic "查看失败详情" [ref=f1e51] [cursor=pointer]
        - button "重新同步原生语言" [ref=f1e52] [cursor=pointer]
      - region "贡献运行" [ref=f1e55]:
        - generic [ref=f1e56]:
          - generic [ref=f1e61]:
            - heading "尚未绑定本机设备" [level=2] [ref=f1e62]
            - paragraph [ref=f1e63]: 开始后建立连接；接单需单独恢复。
          - button "开始贡献" [disabled] [ref=f1e64]
        - paragraph [ref=f1e65]: 请先完成设备核对与绑定。
        - generic [ref=f1e66]:
          - generic [ref=f1e67]: Bee 未运行
          - generic [ref=f1e71]: 尚未建立 Hive 连接
        - alert [ref=f1e75]:
          - paragraph [ref=f1e76]: 没有读取所选凭证来源的权限。
          - paragraph [ref=f1e77]: 本次只确认了所选来源的读取结果，其他登录状态仍未知。
          - group [ref=f1e78]:
            - generic "查看失败详情" [ref=f1e79] [cursor=pointer]
      - region "准备贡献" [ref=f1e80]:
        - heading "准备贡献" [level=2] [ref=f1e81]
        - list [ref=f1e82]:
          - listitem [ref=f1e83]: 绑定本机设备
          - listitem [ref=f1e84]: 在 Hive 网页确认
          - listitem [ref=f1e85]: 接入 AI 账号
          - listitem [ref=f1e86]: 开始贡献并按平台恢复接单
      - region "设备配对" [ref=f1e88]:
        - generic [ref=f1e89]:
          - heading "连接本机设备" [level=2] [ref=f1e90]
          - button "重新核对设备" [ref=f1e91] [cursor=pointer]
        - paragraph [ref=f1e92]: 在 Hive 网页确认这台设备的归属；绑定不会开始贡献。
        - generic [ref=f1e93]:
          - generic [ref=f1e94]:
            - text: Hive 地址
            - textbox "Hive 地址" [ref=f1e95]:
              - /placeholder: https://hive.example
          - generic [ref=f1e96]:
            - text: 设备名称
            - textbox "设备名称" [ref=f1e97]: Bee Desktop
          - button "生成配对码" [disabled] [ref=f1e98]
        - paragraph [ref=f1e99]: 设备配置独立保存，不覆盖 CLI；已有设备的替换请在 Hive 网页核对后确认。
      - region "平台账号列表" [ref=f1e100]:
        - generic [ref=f1e101]:
          - heading "AI 账号" [level=2] [ref=f1e102]
          - generic [ref=f1e103]: 0 个已接入
        - generic [ref=f1e105]:
          - region "OpenAI 账号" [ref=f1e106]:
            - generic [ref=f1e112]:
              - heading "OpenAI" [level=3] [ref=f1e114]
              - paragraph [ref=f1e115]: 尚未接入 OpenAI 账号
              - paragraph [ref=f1e116]: 状态待确认
              - paragraph [ref=f1e120]: 所选来源的登录状态待确认。
              - alert [ref=f1e121]:
                - paragraph [ref=f1e122]: 所选凭证来源暂不可读取。
                - paragraph [ref=f1e123]: 本次只确认了所选来源的读取结果，其他登录状态仍未知。
                - button "检查凭证来源" [ref=f1e124] [cursor=pointer]
                - group [ref=f1e125]:
                  - generic "查看失败详情" [ref=f1e126] [cursor=pointer]
            - generic [ref=f1e128]:
              - generic [ref=f1e129]:
                - generic [ref=f1e130]: 额度
                - generic [ref=f1e131]: 尚未核对
              - progressbar "已用额度" [ref=f1e132]
          - region "Claude 账号" [ref=f1e134]:
            - generic [ref=f1e135]:
              - generic [aria-hidden] [ref=f1e137]: ✳
              - generic [ref=f1e138]:
                - heading "Claude" [level=3] [ref=f1e140]
                - paragraph [ref=f1e141]: 尚未接入 Claude 账号
                - paragraph [ref=f1e142]: 状态待确认
                - paragraph [ref=f1e146]: 所选来源的登录状态待确认。
            - generic [ref=f1e148]:
              - generic [ref=f1e149]:
                - generic [ref=f1e150]: 额度
                - generic [ref=f1e151]: 尚未核对
              - progressbar "已用额度" [ref=f1e152]
        - paragraph [ref=f1e154]: 授权信息保留在本机
    - contentinfo [ref=f1e158]:
      - text: Bee
      - generic [ref=f1e159]: 设备绑定不自动开始贡献
```

# Test source

```ts
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
  102 |  await expect(page.getByText('设备已绑定。')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
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
> 126 |  await page.getByText('核对诊断',{exact:true}).click();
      |                                            ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  203 |  await page.addInitScript(recovery=>{const w=window as any;w.recovery=recovery;w.deviceFailure={code:'invalid_device_credential',message:'HTTP 401 invalid_device_credential'};},recoveryView('redemption_unknown'));
  204 |  await page.goto('/');await expect(page.getByText('兑换结果未知，正在核对新设备身份',{exact:true})).toBeVisible();await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  205 |  await expect.poll(async()=>(await deviceCalls(page,'device_recovery_status')).length).toBeGreaterThan(1);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
  206 | });
  207 | test('adopting a different owner requires its own current revision confirmation',async({page})=>{
  208 |  await page.addInitScript(recovery=>{(window as any).recovery=recovery;},recoveryView('awaiting_owner_confirmation'));await page.goto('/');
  209 |  await expect(page.getByText('new@example.test',{exact:true})).toBeVisible();await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);
  210 |  await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
  211 |  await expect(page.getByText('上次重新绑定已完成，未自动开始贡献。',{exact:true})).toBeVisible();expect(await deviceCalls(page,'runtime_start')).toHaveLength(0);expect(await deviceCalls(page,'account_action')).toHaveLength(0);
  212 | });
  213 | test('local expiry waits for Hive confirmation before offering another pairing request',async({page})=>{
  214 |  await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});
  215 |  await page.addInitScript(()=>{(window as any).deviceOverride={state:'pending',hive:'https://hive.example',name:'My Mac',user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+500).toISOString(),poll_interval_seconds:2};});
  216 |  await page.goto('/');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await page.clock.runFor(1001);
  217 |  await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toHaveCount(0);expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
  218 |  await page.evaluate(()=>{(window as any).deviceOverride.state='expired';});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toBeEnabled();expect(await deviceCalls(page,'device_begin')).toHaveLength(0);
  219 | });
  220 | test('a stale owner dialog cannot submit after the coordinator sees a newer transaction revision',async({page})=>{
  221 |  await page.clock.install({time:new Date('2026-11-02T00:00:00Z')});await page.addInitScript(recovery=>{(window as any).recovery=recovery;},recoveryView('awaiting_owner_confirmation'));await page.goto('/');
  222 |  await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();await page.evaluate(()=>{(window as any).recovery.revision=5;});await page.clock.runFor(10001);await expect.poll(async()=>(await deviceCalls(page,'device_recovery_status')).length).toBeGreaterThan(1);
  223 |  await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'actual=5 expected=4'})).toBeVisible();expect(await deviceCalls(page,'device_recovery_confirm')).toHaveLength(0);expect(await deviceCalls(page,'device_recovery_prepare')).toHaveLength(0);
  224 | });
  225 | 
```