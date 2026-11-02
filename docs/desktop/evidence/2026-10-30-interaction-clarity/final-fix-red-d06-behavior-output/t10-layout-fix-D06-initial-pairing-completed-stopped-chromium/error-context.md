# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-fix.spec.ts >> D06-initial-pairing-completed-stopped
- Location: tests/t10-layout-fix.spec.ts:136:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '打开 Hive 确认网页', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '打开 Hive 确认网页', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: '打开 Hive 确认网页', exact: true })

```

```yaml
- complementary:
  - text: Bee
  - navigation "主导航":
    - button "概览"
    - button "AI 账号"
    - button "诊断"
    - button "设置"
  - text: 尚未接通真实供给
  - paragraph: Hive 未连接
  - text: Bee 桌面端 本地演示空间
- banner: 本机设备 演示数据
- main:
  - heading "概览" [level=1]
  - paragraph: 查看设备状态与贡献摘要。
  - alert:
    - heading "无法载入演示场景" [level=3]
    - text: "Error: 演示场景校验失败：实际场景=device-pending；允许场景=lifecycle-failed, lifecycle-unknown, lifecycle-pending, ready, diagnostics-partial, diagnostics-export-error, earnings-loading, earnings-error, earnings-empty, quote-conflict, quote-unknown, transfer-pending, transfer-unknown, authorization-expired, account-change, quota-unknown, removal-pending, removal-unknown, loading, empty, error, unknown-tasks, active-tasks, tasks-loading, tasks-error, onboarding, configured, external, offline, unknown, partial, pending, unknown-result, operation-error。"
- contentinfo: Bee · 开发版本 演示操作不会影响真实账号或资金
```

# Test source

```ts
  37  |  if(scene==='runtime-no-accounts'){
  38  |   expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  39  |   await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先接入至少一个 AI 账号。');
  40  |   await expect(page.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
  41  |  }else{
  42  |   await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  43  |   await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先核对本机贡献状态。');
  44  |   await expect(page.locator('main')).not.toContainText('0 个已接入');
  45  |   expect(await calls(page,'account_snapshot')).toEqual([]);
  46  |  }
  47  |  await evidence(page,info,id,{scene,accountFactsConfirmed:scene==='runtime-no-accounts'});
  48  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeVisible();
  49  |  if(scene==='runtime-accounts-unconfirmed')await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  50  |  await zeroWrites(page);
  51  | });
  52  | 
  53  | test('R01-account-reads-pending-shared-state-confirmed',async({page},info)=>{
  54  |  await install(page);await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  55  |   if(command==='account_snapshot'||command==='account_detect'){w.calls.push({command,args});return new Promise(()=>{});}
  56  |   const reply=await invoke(command,args);if(command==='runtime_snapshot')w.r01Runtime=structuredClone(reply.result.runtime);if(command==='device_status')w.r01Device=structuredClone(reply.result.device);return reply;
  57  |  };});await ready(page);
  58  |  await expect.poll(async()=>(await calls(page,'account_snapshot')).map((c:any)=>c.args.platform).sort()).toEqual(['claude','openai']);
  59  |  const preconditions=await page.evaluate(()=>({sharedRuntime:(window as any).r01Runtime,device:(window as any).r01Device,accountReads:'both unresolved',accountFactsConfirmed:false}));
  60  |  expect(preconditions.device.state).toBe('bound');expect(preconditions.sharedRuntime.local).toBe('stopped');
  61  |  await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  62  |  await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('0 个已接入');
  63  |  for(const platform of ['OpenAI','Claude'])await expect(card(page,platform)).toContainText('所选来源的登录状态待确认。');
  64  |  await evidence(page,info,'R01-account-reads-pending',preconditions);
  65  |  await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeFocused();
  66  |  for(const platform of ['OpenAI','Claude']){await expect(card(page,platform)).toContainText('正在读取已有登录');await expect(card(page,platform).getByRole('button',{name:platform+' 详情',exact:true})).toBeVisible();}
  67  |  await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('0 个已接入');
  68  |  await zeroWrites(page);await evidence(page,info,'R01-account-reads-pending-accounts',preconditions,card(page));
  69  | });
  70  | 
  71  | for(const [id,code,check,message]of [
  72  |  ['S05-config-invalid','DEVICE_CONTEXT_INVALID','device_context','configuration decode failed: invalid JSON at byte=19; file retained=true'],
  73  |  ['S05-protocol-mismatch','VERSION_MISMATCH','bridge_hello','reply protocol=2; required=1'],
  74  |  ['S05-integrity-blocked','BUNDLED_BEE_INVALID','sidecar_verify','bundled Bee SHA256 mismatch at /isolated/qa/bee: actual='+ 'a'.repeat(64)+'; required='+ 'b'.repeat(64)]
  75  | ])for(const locale of id==='S05-config-invalid'?['zh']:['zh','en'])test(id+(locale==='en'?'-en':''),async({page},info)=>{
  76  |  await install(page);await page.addInitScript(({id,code,check,message,locale})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  77  |   if((id==='S05-config-invalid'&&command==='device_context')||(id!=='S05-config-invalid'&&command==='bridge_status')){
  78  |    w.calls.push({command,args});const error={code,message,details:{check,observed_at:new Date().toISOString(),evidence:{actual:id==='S05-config-invalid'?'invalid JSON':id==='S05-protocol-mismatch'?'2':'qa-tampered',required:id==='S05-config-invalid'?'valid saved configuration':id==='S05-protocol-mismatch'?'1':'sealed-sha256'}}};
  79  |    return id==='S05-config-invalid'?{result:{binding_revision:1,error}}:{state:'failed',error:{code,message}};
  80  |   }const reply=await invoke(command,args);if(command==='preferences_read')reply.preferences.language=locale;return reply;
  81  |  };},{id,code,check,message,locale});
  82  |  await page.goto('/');await expect(page.locator('main')).toContainText(code);
  83  |  const failure=page.locator('main .problem-notice').first();
  84  |  if(id!=='S05-config-invalid'){
  85  |   const protocol=id==='S05-protocol-mismatch';
  86  |   const summary=locale==='zh'?(protocol?'Bee 管理协议版本与当前应用不兼容。':'随附的 Bee 程序未通过完整性校验。'):(protocol?'The Bee management protocol version is incompatible with this app.':'The bundled Bee program failed integrity verification.');
  87  |   const impact=locale==='zh'?(protocol?'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee 后重新打开；若仍不兼容，请使用可信来源的匹配安装包处理。':'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee，使用可信来源的安装包重新安装后再打开。'):(protocol?'Native operations remain blocked; contribution and account operations are unavailable. Quit Bee from the app menu and reopen it. If it remains incompatible, use a matching installer from a trusted source.':'Native operations remain blocked; contribution and account operations are unavailable. Quit Bee from the app menu, reinstall it with an installer from a trusted source, then reopen it.');
  88  |   await expect(failure.getByText(summary,{exact:true})).toBeVisible();await expect(failure.getByText(impact,{exact:true})).toBeVisible();
  89  |   await expect(failure.getByRole('button')).toHaveCount(0);
  90  |   await expect(page.getByRole('button',{name:locale==='zh'?'开始贡献':'Start contributing',exact:true})).toHaveCount(0);
  91  |   for(const command of ['runtime_snapshot','device_status','account_snapshot','account_detect','supply_status','startup_recheck'])expect(await calls(page,command)).toEqual([]);
  92  |  }
  93  |  await failure.getByText(locale==='zh'?'查看失败详情':'View failure details',{exact:true}).click();await expect(failure).toContainText(message);
  94  |  await expect(failure).toContainText(code);await expect(failure).not.toContainText('FAILURE_DETAILS_INVALID');
  95  |  if(id==='S05-config-invalid')await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  96  |  else expect(await calls(page,'runtime_snapshot')).toEqual([]);
  97  |  await zeroWrites(page);await evidence(page,info,id+(locale==='en'?'-en':''),{code,check,message,locale,syntheticFailure:true,nativeOperationsBlocked:id!=='S05-config-invalid'},failure);
  98  | });
  99  | 
  100 | test('L02-running-login-stop-entry',async({page},info)=>{
  101 |  await install(page,{}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  102 |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  103 |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).toContainText('官方登录前请先停止贡献');
  104 |  await evidence(page,info,'L02-running-login-disabled',{local:'running',selectedPlatforms:['openai','claude']},dialog.getByText('官方登录前请先停止贡献；前往概览停止后再返回。',{exact:true}));
  105 |  await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();await expect(page.locator('[data-nav-section=runtime]').first()).toBeFocused();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  106 |  expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
  107 |  await evidence(page,info,'L02-stop-entry',{navigated:true,stoppedAutomatically:false});
  108 | });
  109 | 
  110 | for(const mode of ['unread','empty','loading','filtered-rotation'])test('G05-logs-'+mode,async({page},info)=>{
  111 |  await install(page);await page.addInitScript(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  112 |   if(command==='diagnostic_logs'){
  113 |    if(mode==='empty'||mode==='loading'){w.calls.push({command,args});return mode==='loading'?new Promise(()=>{}):{entries:[],next_cursor:null,truncated:false};}
  114 |    const result=await invoke(command,args);if(mode==='filtered-rotation')result.truncated=true;return result;
  115 |   }return invoke(command,args);
  116 |  };},mode);await ready(page);await nav(page,'诊断').click();await page.getByRole('tab',{name:'安全日志',exact:true}).click();
  117 |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  118 |  if(mode==='filtered-rotation'){
  119 |   await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
  120 |  }
  121 |  if(mode==='unread')await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
  122 |  else{
  123 |   await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  124 |   if(mode==='empty')await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
  125 |   if(mode==='loading'){await expect(page.getByText('正在读取日志…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeDisabled();}
  126 |   if(mode==='filtered-rotation'){
  127 |    await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');await expect(page.getByText('较早日志已轮转移除；此处仅显示保留范围。',{exact:true})).toBeVisible();
  128 |    expect((await calls(page,'diagnostic_logs'))[0].args.query).toEqual({cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'});
  129 |    await evidence(page,info,'G05-logs-filtered-more',{filters:{module:'accounts',platform:'openai',level:'warning'},truncated:true});
  130 |    await page.getByRole('button',{name:'加载更多日志',exact:true}).click();await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);
  131 |   }
  132 |  }
  133 |  await zeroWrites(page);expect(await calls(page,'diagnostics_start')).toEqual([]);await evidence(page,info,'G05-logs-'+mode,{mode,manualRead:mode!=='unread'});
  134 | });
  135 | 
  136 | test('D06-initial-pairing-completed-stopped',async({page},info)=>{
> 137 |  await preview(page,'device-pending');await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeVisible();
      |                                                                                                               ^ Error: expect(locator).toBeVisible() failed
  138 |  await page.evaluate(()=>(window as any).__beePreviewApprove());await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  139 |  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');
  140 |  await expect(page.getByText('0 个已接入',{exact:true})).toBeVisible();
  141 |  for(const platform of ['OpenAI','Claude'])await expect(card(page,platform)).toContainText('尚未接入');
  142 |  for(const oldFact of ['bbbbbbbbbbbbbbbb','Plus','3%','2%'])await expect(page.locator('main')).not.toContainText(oldFact);
  143 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();await zeroWrites(page);await evidence(page,info,'D06-bound-stopped-no-selection',{initialStage:'pending',externalApproval:'simulated',finalStage:'bound',local:'stopped'});
  144 | });
  145 | 
  146 | for(const [code,copy]of [['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test('L05-'+code,async({page},info)=>{
  147 |  await install(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'official process exited; source verification failed; verified=false',evidence:{confirmed:'false'}}}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  148 |  await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
  149 |  const message=page.getByRole('dialog').getByText(copy,{exact:true});await expect(message).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  150 |  expect(await page.evaluate(()=>(window as any).accounts.openai.operation.error.code)).toBe(code);await evidence(page,info,'L05-'+code,{operation:'authorize',state:'failed',code},message);
  151 | });
  152 | 
  153 | test('W04-stale-confirmation-disabled-zero-write',async({page},info)=>{
  154 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  155 |  await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
  156 |  await page.clock.runFor(10001);await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
  157 |  const before=await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai),oldRevision=a.revision;a.revision+=2;w.accounts.openai=a;return {oldRevision,newRevision:a.revision,candidate:a.candidate.reference};});await page.clock.runFor(10001);
  158 |  const stale=page.getByRole('dialog').last();await expect(stale.getByRole('button',{name:'确认更换',exact:true})).toBeDisabled();await expect(stale).toContainText('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。');
  159 |  expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,'W04-stale-confirmation',{...before,submitted:false});
  160 | });
  161 | 
  162 | test('W05-account-submission-unknown-keeps-original-operation',async({page},info)=>{
  163 |  await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  164 |  await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
  165 |  await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();const operation=await page.evaluate(()=>(window as any).accounts.openai.operation);expect(operation.state).toBe('reconciling');expect(await calls(page,'account_action')).toHaveLength(1);
  166 |  await nav(page,'诊断').click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');
  167 |  await evidence(page,info,'W05-original-operation-diagnostics',{operation,submittedWrites:1},page.locator('pre'));
  168 |  await nav(page,'AI 账号').click();await page.clock.runFor(10001);expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(operation.id);expect(await calls(page,'account_action')).toHaveLength(1);expect(await calls(page,'runtime_start')).toEqual([]);
  169 |  await evidence(page,info,'W05-original-operation-unconfirmed',{operation,submittedWrites:1,readOnlyReconciliation:true},card(page));
  170 | });
  171 | 
  172 | test('A04-unsupported-store-real-reason',async({page},info)=>{
  173 |  await install(page,{unsupportedStores:{keyring:'keyring_not_supported_on_this_os'}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  174 |  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('存储方式').locator('option[value=keyring]')).toHaveAttribute('disabled','');expect(await dialog.getByLabel('存储方式').locator('option[value=keyring]').evaluate(e=>(e as HTMLOptionElement).disabled)).toBe(true);await expect(dialog).toContainText('当前系统不支持 Codex 钥匙串读取。');await expect(dialog.getByLabel('存储方式')).toHaveValue('file');
  175 |  await zeroWrites(page);await evidence(page,info,'A04-keyring-unsupported',{store:'keyring',supported:false,reason:'keyring_not_supported_on_this_os',selectedStore:'file'},dialog.getByText(/当前系统不支持 Codex 钥匙串读取/));
  176 | });
  177 | 
  178 | for(const [id,reasons]of [
  179 |  ['P04-detailed-reasons',['account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted']],
  180 |  ['P05-existing-reasons',['banned','device_draining','offline','model_unavailable','authorization_unavailable','capabilities_unknown','plan_not_configured']],
  181 |  ['P06-limit-reasons',['rate_limited','quota_unknown','quota_exhausted','concurrency_full']],
  182 |  ['P07-source-authorization-reasons',['codex_source_unavailable','codex_confirmation_required','codex_authorization_rejected']]
  183 | ] as const)test(id,async({page},info)=>{
  184 |  const claude=id==='P07-source-authorization-reasons'?['claude_source_unavailable','claude_confirmation_required','claude_authorization_rejected']:[];
  185 |  await install(page,{reasons:{openai:[...reasons],claude}}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
  186 |  const initial=await calls(page,'runtime_start');expect(initial).toEqual([]);
  187 |  const expected:Record<string,string>={account_not_registered:'Hive 账号注册尚未完成',market_not_open:'Hive 尚未开放 OpenAI 模型交易',supply_not_enabled:'Hive 尚未启用此平台供给',supply_device_restricted:'Hive 供给绑定限制了当前设备',account_not_admitted:'当前账号不在 Hive 供给准入集合中',banned:'管理员已禁用此平台供给',device_draining:'设备替换中，仅收尾已接请求',offline:'Hive 未看到此平台的 Bee 连接',model_unavailable:'账号没有可用的市场模型',authorization_unavailable:'Hive 没有可用的加密授权',capabilities_unknown:'账号模型和额度报告尚未确认',plan_not_configured:'管理员尚未配置套餐并发上限',rate_limited:'上游平台限流中',quota_unknown:'账号额度窗口尚未确认',quota_exhausted:'账号订阅额度已耗尽',concurrency_full:'账号并发请求已满',codex_source_unavailable:'无法读取 Codex 官方登录',codex_confirmation_required:'Codex 账号变更待确认',codex_authorization_rejected:'OpenAI 已拒绝此账号授权',claude_source_unavailable:'无法读取 Claude Code 官方登录',claude_confirmation_required:'Claude Code 账号变更待确认',claude_authorization_rejected:'Anthropic 已拒绝此账号授权'};
  188 |  const reasonCaptures=[];
  189 |  for(const [p,items]of [['OpenAI',reasons],['Claude',claude]] as const)for(const reason of items){
  190 |   const item=card(page,p).locator('li').filter({has:page.getByText(expected[reason],{exact:true})});await expect(item).toBeVisible();
  191 |   await item.evaluate(e=>e.scrollIntoView({block:'center'}));await expect(item).toBeInViewport({ratio:1});
  192 |   const geometry=await item.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),text:e.textContent,impact:e.querySelector('p')?.textContent}));
  193 |   expect(geometry.rect.top).toBeGreaterThanOrEqual(52);expect(geometry.rect.bottom).toBeLessThanOrEqual(571);expect(geometry.impact?.trim().length).toBeGreaterThan(0);
  194 |   reasonCaptures.push({platform:p,reason,...geometry});await page.screenshot({path:info.outputPath(id+'-'+reason+'.png')});
  195 |  }
  196 |  expect(await calls(page,'authorize_start')).toEqual([]);await zeroWrites(page);
  197 |  await evidence(page,info,id,{reasons:{openai:reasons,claude},reasonCaptures,source:'real SupplyView DTO reason codes; synthetic confirmed facts'},card(page));
  198 | });
  199 | 
  200 | test('A08-official-query-failure-with-retry-at',async({page},info)=>{
  201 |  const a=selected('openai');a.candidate={...a.candidate,state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),identity_verified:true,expires_at:'2099-01-01T00:00:00Z',observed_at:new Date().toISOString()};
  202 |  a.capabilities[0]={...a.capabilities[0],status:'rate_limited',observed_at:new Date().toISOString(),retry_at:new Date(Date.now()+25000).toISOString(),error:{code:'rate_limited',check:'official_capability_query',platform:'openai',message:'official quota endpoint HTTP 429; retry_after_seconds=25',evidence:{http_status:'429',path:'/official/quota'}}};
  203 |  await install(page,{}, {openai:a,claude:accountFixture('claude')});await ready(page);
  204 |  await expect(card(page)).toContainText('服务限制了本次请求的频率。');expect(await page.evaluate(()=>(window as any).accounts.openai.capabilities[0].status)).toBe('rate_limited');await expect(card(page)).toContainText('bbbbbbbbbbbbbbbb');await card(page).getByText('查看失败详情',{exact:true}).click();await expect(card(page)).toContainText('official quota endpoint HTTP 429; retry_after_seconds=25');await evidence(page,info,'A08-official-query-failed',{code:'rate_limited',check:'official_capability_query',retry_at:a.capabilities[0].retry_at,localCandidatePreserved:true},card(page).getByText('official quota endpoint HTTP 429; retry_after_seconds=25',{exact:false}).last());
  205 |  expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  206 | });
  207 | 
  208 | for(const trusted of [true,false])test('U05-recovery-'+(trusted?'trusted-previous':'unproven-protected'),async({page},info)=>{
  209 |  const code=trusted?'UPDATE_PREVIOUS_NOT_INSTALLED':'UPDATE_RECOVERY_UNPROVEN';
  210 |  const message=trusted?'running trusted previous version=0.1.0; pending target=0.2.0 was not installed; data and runtime verified; update may be retried':'recovery evidence runtime_intent_restored=false; required=true; pending update preserved';
  211 |  await install(page);await page.addInitScript(({code,message})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  212 |   if(command==='update_snapshot'){w.calls.push({command,args});return {operation_id:'update-a',revision:9,state:'failed',current_version:'0.1.0',target_version:'0.2.0',checked_at:'2026-11-02T12:00:00Z',downloaded_bytes:0,total_bytes:null,release_notes:null,error:{code,message,details:{check:'update_recovery',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:message,required:'verified recovery'}}}};}
  213 |   return invoke(command,args);
  214 |  };},{code,message});await ready(page);await nav(page,'设置').click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  215 |  const region=page.getByRole('region',{name:'应用更新',exact:true}),alert=region.getByRole('alert');await expect(alert).toContainText(code);await expect(alert).toContainText(message);
  216 |  if(trusted){await expect(alert).toContainText('当前可信版本及数据、运行恢复检查已通过');await expect(region.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled();}
  217 |  else{await expect(alert).toContainText('更新保护仍保留');await expect(region.getByRole('button',{name:'重新读取更新状态',exact:true})).toBeEnabled();}
  218 |  for(const command of ['update_check','update_download','update_install'])expect(await calls(page,command)).toEqual([]);
  219 |  await alert.getByText('查看失败详情',{exact:true}).click();await zeroWrites(page);await evidence(page,info,'U05-'+(trusted?'trusted-previous':'unproven-protected'),{code,check:'update_recovery',trustedPrevious:trusted,realInstallation:false},alert);
  220 | });
  221 | 
```