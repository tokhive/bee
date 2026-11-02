# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-fix.spec.ts >> A04-unsupported-store-real-reason
- Location: tests/t10-layout-fix.spec.ts:141:1

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator:  getByRole('dialog').getByLabel('存储方式').locator('option[value=keyring]')
Expected: disabled
Received: enabled
Timeout:  5000ms

Call log:
  - Expect "toBeDisabled" getByRole('dialog').getByLabel('存储方式').locator('option[value=keyring]') with timeout 5000ms
  - waiting for getByRole('dialog').getByLabel('存储方式').locator('option[value=keyring]')
    14 × locator resolved to <option disabled value="keyring">钥匙串 (暂不支持)</option>
       - unexpected value "enabled"

```

```yaml
- dialog "OpenAI 账号详情":
  - banner:
    - heading "OpenAI 账号详情" [level=2]
    - button "关闭"
  - paragraph: 查看账号与额度，管理凭证读取方式。
  - term: 当前账号标识
  - definition: 尚未接入 OpenAI 账号
  - term: 候选账号标识
  - definition: bbbbbbbbbbbbbbbb
  - paragraph: 已有登录，尚未接入
  - heading "额度与重置" [level=3]
  - text: 额度 尚未核对
  - progressbar "已用额度"
  - group:
    - text: 凭证读取方式
    - paragraph: 读取官方客户端已保存的登录；目录留空使用默认位置。
    - text: 自定义目录
    - textbox "自定义目录":
      - /placeholder: /tmp/codex
    - text: 存储方式
    - combobox "存储方式":
      - option "自动"
      - option "文件" [selected]
      - option "钥匙串 (暂不支持)" [disabled]
    - paragraph:
      - text: 钥匙串 在当前系统不可用；不会自动改用其他存储方式。 当前系统不支持 Codex 钥匙串读取。
      - code: keyring_not_supported_on_this_os
    - paragraph: 修改读取位置不会自动更换已接入账号。
  - button "接入"
  - button "登录 OpenAI"
```

# Test source

```ts
  43  |   await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先核对本机贡献状态。');
  44  |   await expect(page.locator('main')).not.toContainText('0 个已接入');
  45  |   expect(await calls(page,'account_snapshot')).toEqual([]);
  46  |  }
  47  |  await evidence(page,info,id,{scene,accountFactsConfirmed:scene==='runtime-no-accounts'});
  48  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',exact:true})).toBeVisible();
  49  |  if(scene==='runtime-accounts-unconfirmed')await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  50  |  await zeroWrites(page);
  51  | });
  52  | 
  53  | for(const [id,code,check,message]of [
  54  |  ['S05-config-invalid','DEVICE_CONTEXT_INVALID','device_context','configuration decode failed: invalid JSON at byte=19; file retained=true'],
  55  |  ['S05-protocol-mismatch','PROTOCOL_VERSION_MISMATCH','bridge_hello','hello protocol actual=2 required=1; child rejected=true'],
  56  |  ['S05-integrity-blocked','SIDECAR_INTEGRITY_FAILED','sidecar_verify','sidecar digest actual=qa-tampered required=sealed-sha256; spawn_allowed=false']
  57  | ])test(id,async({page},info)=>{
  58  |  await install(page);await page.addInitScript(({id,code,check,message})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  59  |   if((id==='S05-config-invalid'&&command==='device_context')||(id!=='S05-config-invalid'&&command==='bridge_status')){
  60  |    w.calls.push({command,args});const error={code,message,details:{check,observed_at:new Date().toISOString(),evidence:{actual:id==='S05-config-invalid'?'invalid JSON':id==='S05-protocol-mismatch'?'2':'qa-tampered',required:id==='S05-config-invalid'?'valid saved configuration':id==='S05-protocol-mismatch'?'1':'sealed-sha256'}}};
  61  |    return id==='S05-config-invalid'?{result:{binding_revision:1,error}}:{state:'failed',error};
  62  |   }return invoke(command,args);
  63  |  };},{id,code,check,message});
  64  |  await page.goto('/');await expect(page.locator('main')).toContainText(code);
  65  |  const failure=page.locator('main .problem-notice').first();await failure.getByText('查看失败详情',{exact:true}).click();await expect(failure).toContainText(message);
  66  |  if(id==='S05-config-invalid')await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  67  |  else expect(await calls(page,'runtime_snapshot')).toEqual([]);
  68  |  await zeroWrites(page);await evidence(page,info,id,{code,check,message,syntheticFailure:true},failure);
  69  | });
  70  | 
  71  | test('L02-running-login-stop-entry',async({page},info)=>{
  72  |  await install(page,{}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  73  |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  74  |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).toContainText('官方登录前请先停止贡献');
  75  |  await evidence(page,info,'L02-running-login-disabled',{local:'running',selectedPlatforms:['openai','claude']},dialog.getByText('官方登录前请先停止贡献',{exact:true}));
  76  |  await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  77  |  expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
  78  |  await evidence(page,info,'L02-stop-entry',{navigated:true,stoppedAutomatically:false});
  79  | });
  80  | 
  81  | for(const mode of ['unread','empty','loading','filtered-rotation'])test('G05-logs-'+mode,async({page},info)=>{
  82  |  await install(page);await page.addInitScript(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  83  |   if(command==='diagnostic_logs'){
  84  |    if(mode==='empty'||mode==='loading'){w.calls.push({command,args});return mode==='loading'?new Promise(()=>{}):{entries:[],next_cursor:null,truncated:false};}
  85  |    const result=await invoke(command,args);if(mode==='filtered-rotation')result.truncated=true;return result;
  86  |   }return invoke(command,args);
  87  |  };},mode);await ready(page);await nav(page,'诊断').click();await page.getByRole('tab',{name:'安全日志',exact:true}).click();
  88  |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  89  |  if(mode==='filtered-rotation'){
  90  |   await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
  91  |  }
  92  |  if(mode==='unread')await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
  93  |  else{
  94  |   await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  95  |   if(mode==='empty')await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
  96  |   if(mode==='loading'){await expect(page.getByText('正在读取日志…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeDisabled();}
  97  |   if(mode==='filtered-rotation'){
  98  |    await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');await expect(page.getByText('较早日志已轮转移除；此处仅显示保留范围。',{exact:true})).toBeVisible();
  99  |    expect((await calls(page,'diagnostic_logs'))[0].args.query).toEqual({cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'});
  100 |    await evidence(page,info,'G05-logs-filtered-more',{filters:{module:'accounts',platform:'openai',level:'warning'},truncated:true});
  101 |    await page.getByRole('button',{name:'加载更多日志',exact:true}).click();await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);
  102 |   }
  103 |  }
  104 |  await zeroWrites(page);expect(await calls(page,'diagnostics_start')).toEqual([]);await evidence(page,info,'G05-logs-'+mode,{mode,manualRead:mode!=='unread'});
  105 | });
  106 | 
  107 | test('D06-initial-pairing-completed-stopped',async({page},info)=>{
  108 |  await preview(page,'device-pending');await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeVisible();
  109 |  await page.evaluate(()=>(window as any).__beePreviewApprove());await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  110 |  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');
  111 |  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  112 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();await zeroWrites(page);await evidence(page,info,'D06-bound-stopped-no-selection',{initialStage:'pending',externalApproval:'simulated',finalStage:'bound',local:'stopped'});
  113 | });
  114 | 
  115 | for(const [code,copy]of [['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test('L05-'+code,async({page},info)=>{
  116 |  await install(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'official process exited; source verification failed; verified=false',evidence:{confirmed:'false'}}}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  117 |  await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
  118 |  const message=page.getByRole('dialog').getByText(copy,{exact:true});await expect(message).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  119 |  expect(await page.evaluate(()=>(window as any).accounts.openai.operation.error.code)).toBe(code);await evidence(page,info,'L05-'+code,{operation:'authorize',state:'failed',code},message);
  120 | });
  121 | 
  122 | test('W04-stale-confirmation-disabled-zero-write',async({page},info)=>{
  123 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  124 |  await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
  125 |  await page.clock.runFor(10001);await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
  126 |  const before=await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai),oldRevision=a.revision;a.revision+=2;w.accounts.openai=a;return {oldRevision,newRevision:a.revision,candidate:a.candidate.reference};});await page.clock.runFor(10001);
  127 |  const stale=page.getByRole('dialog').last();await expect(stale.getByRole('button',{name:'确认更换',exact:true})).toBeDisabled();await expect(stale).toContainText('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。');
  128 |  expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,'W04-stale-confirmation',{...before,submitted:false});
  129 | });
  130 | 
  131 | test('W05-account-submission-unknown-keeps-original-operation',async({page},info)=>{
  132 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  133 |  await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
  134 |  await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();const operation=await page.evaluate(()=>(window as any).accounts.openai.operation);expect(operation.state).toBe('reconciling');expect(await calls(page,'account_action')).toHaveLength(1);
  135 |  await nav(page,'诊断').click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');
  136 |  await evidence(page,info,'W05-original-operation-diagnostics',{operation,submittedWrites:1},page.locator('pre'));
  137 |  await nav(page,'AI 账号').click();await page.clock.runFor(10001);expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(operation.id);expect(await calls(page,'account_action')).toHaveLength(1);expect(await calls(page,'runtime_start')).toEqual([]);
  138 |  await evidence(page,info,'W05-original-operation-unconfirmed',{operation,submittedWrites:1,readOnlyReconciliation:true},card(page));
  139 | });
  140 | 
  141 | test('A04-unsupported-store-real-reason',async({page},info)=>{
  142 |  await install(page,{unsupportedStores:{keyring:'keyring_not_supported_on_this_os'}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
> 143 |  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('存储方式').locator('option[value=keyring]')).toBeDisabled();await expect(dialog).toContainText('当前系统不支持 Codex 钥匙串读取。');await expect(dialog.getByLabel('存储方式')).toHaveValue('file');
      |                                                                                                                 ^ Error: expect(locator).toBeDisabled() failed
  144 |  await zeroWrites(page);await evidence(page,info,'A04-keyring-unsupported',{store:'keyring',supported:false,reason:'keyring_not_supported_on_this_os',selectedStore:'file'},dialog.getByText(/当前系统不支持 Codex 钥匙串读取/));
  145 | });
  146 | 
  147 | for(const [id,reasons]of [
  148 |  ['P04-detailed-reasons',['account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted']],
  149 |  ['P05-existing-reasons',['banned','device_draining','offline','model_unavailable','authorization_unavailable','capabilities_unknown','plan_not_configured']],
  150 |  ['P06-limit-reasons',['rate_limited','quota_unknown','quota_exhausted','concurrency_full']],
  151 |  ['P07-source-authorization-reasons',['codex_source_unavailable','codex_confirmation_required','codex_authorization_rejected']]
  152 | ] as const)test(id,async({page},info)=>{
  153 |  const claude=id==='P07-source-authorization-reasons'?['claude_source_unavailable','claude_confirmation_required','claude_authorization_rejected']:[];
  154 |  await install(page,{reasons:{openai:[...reasons],claude}}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  155 |  const initial=await calls(page,'runtime_start');expect(initial).toEqual([]);
  156 |  const {supplyProblem}=await import('../src/features/accounts/accountPresentation');
  157 |  for(const [p,items]of [['OpenAI',reasons],['Claude',claude]] as const)for(const reason of items){const copy=supplyProblem(reason,p==='OpenAI'?'openai':'claude').summary.replace('{platform}',p);await expect(card(page,p).getByText(copy,{exact:true})).toBeVisible();}
  158 |  expect(await calls(page,'authorize_start')).toEqual([]);await zeroWrites(page);
  159 |  await evidence(page,info,id,{reasons:{openai:reasons,claude},source:'real SupplyView DTO reason codes; synthetic confirmed facts'},card(page));
  160 | });
  161 | 
  162 | test('A08-official-query-failure-with-retry-at',async({page},info)=>{
  163 |  const a=selected('openai');a.candidate={...a.candidate,state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),identity_verified:true,observed_at:new Date().toISOString()};
  164 |  a.capabilities[0]={...a.capabilities[0],status:'unavailable',observed_at:new Date().toISOString(),retry_at:new Date(Date.now()+25000).toISOString(),error:{code:'rate_limited',check:'official_capability_query',platform:'openai',message:'official quota endpoint HTTP 429; retry_after_seconds=25',evidence:{http_status:'429',retry_after_seconds:'25'}}};
  165 |  await install(page,{}, {openai:a,claude:accountFixture('claude')});await ready(page);
  166 |  await expect(card(page)).toContainText('服务限制了本次请求的频率。');await evidence(page,info,'A08-official-query-failed',{code:'rate_limited',check:'official_capability_query',retry_at:a.capabilities[0].retry_at,localCandidatePreserved:true},card(page));
  167 |  expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  168 | });
  169 | 
```