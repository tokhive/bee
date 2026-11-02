# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-runtime.spec.ts >> only proven unsubmitted confirmation can continue after reconciliation
- Location: tests/native-runtime.spec.ts:122:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog').getByText('账号操作已完成，平台保持暂停')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog').getByText('账号操作已完成，平台保持暂停') with timeout 5000ms
  - waiting for getByRole('dialog').getByText('账号操作已完成，平台保持暂停')

```

```yaml
- dialog "OpenAI 账号详情":
  - banner:
    - heading "OpenAI 账号详情" [level=2]
    - button "关闭"
  - paragraph: 查看账号与额度，管理凭证读取方式。
  - term: 当前账号标识
  - definition: bbbbbbbbbbbbbbbb
  - term: 订阅套餐
  - definition: plus
  - term: 授权到期
  - definition: 2099年1月1日 08:00:00
  - term: 候选账号标识
  - definition: bbbbbbbbbbbbbbbb
  - paragraph
  - heading "额度与重置" [level=3]
  - text: 5 小时 已用 120%
  - progressbar "5 小时 已用额度"
  - paragraph: "重置时间: 2099年1月1日 08:00:00"
  - text: 7 日 尚未核对
  - progressbar "7 日 已用额度"
  - paragraph: "重置时间: 未知"
  - paragraph: 有额度窗口已耗尽；请查看各窗口重置时间。
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
      - option "钥匙串"
    - paragraph: 修改读取位置不会自动更换已接入账号。
  - status: 换号已完成，该平台保持暂停。
  - button "重新登录"
  - button "取消接入"
```

# Test source

```ts
  27  |    if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
  28  |    const result=await invoke(command,args);
  29  |    if(command==='network_save_proxy')result.preferences.proxies=result.preferences.proxies.map((entry:any)=>({...entry,device_scope:null}));
  30  |    return result;
  31  |   };
  32  |  });
  33  |  await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  34  |  await page.getByLabel('代理草稿的 Hive 地址',{exact:true}).fill('https://draft.hive.example');await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
  35  |  await page.getByRole('button',{name:'保存代理',exact:true}).click();
  36  |  await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
  37  |  expect((await calls(page,'network_save_proxy'))[0].args).toEqual({proxy:'http://127.0.0.1:7890',origin:'https://draft.hive.example',expectedRevision:0});
  38  |  await page.getByRole('button',{name:'刷新生效路径',exact:true}).click();await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
  39  |  await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  40  |  await expect(page.getByLabel('代理草稿的 Hive 地址',{exact:true})).toHaveValue('https://draft.hive.example');await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
  41  |  await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toHaveCount(0);expect(await calls(page,'network_apply_saved')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  42  | });
  43  | test('a successful account write still requires a verified read when central readback fails',async({page})=>{
  44  |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  45  |  await page.evaluate(()=>{const w=window as any,native=w.__TAURI_INTERNALS__,invoke=native.invoke;native.invoke=async(command:string,args:unknown)=>{const result=await invoke(command,args);if(command==='account_action')w.deviceFail=true;return result;};});
  46  |  await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
  47  |  await expect(card(page).getByText('核对已暂停，需先处理当前问题。',{exact:true})).toBeVisible();
  48  |  await page.evaluate(()=>{(window as any).deviceFail=false;});await reconcile(page);
  49  |  await expect(card(page).getByText('等待自动重试…',{exact:true})).toHaveCount(0);expect(await calls(page,'account_action')).toHaveLength(1);
  50  | });
  51  | test('paired proxy testing leaves effective paths unchanged until the confirmed restart',async({page})=>{
  52  |  await setup(page);await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  53  |  await expect(page.getByLabel('代理草稿的 Hive 地址',{exact:true})).toHaveCount(0);
  54  |  const proxy=page.getByLabel('本机 HTTP 代理',{exact:true});await proxy.fill('http://192.0.2.1:7890');await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByRole('alert')).toContainText('loopback');expect(await calls(page,'network_test')).toEqual([]);
  55  |  await proxy.fill('http://127.0.0.1:7890');await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByText('只检查网络可达性，不证明授权或额度，不会开始贡献。',{exact:true})).toBeVisible();
  56  |  const effective=page.locator('.ns-network-summary div').filter({has:page.getByText('当前生效配置',{exact:true})});await expect(effective).toContainText('代理未启用');
  57  |  await page.getByRole('button',{name:'保存代理',exact:true}).click();await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toBeVisible();await expect(effective).toContainText('代理未启用');
  58  |  await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'network_apply_saved')).toEqual([]);
  59  |  await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();await expect(effective).toContainText('http://127.0.0.1:7890');
  60  |  expect(await calls(page,'network_apply_saved')).toEqual([{command:'network_apply_saved',args:{confirmed:true}}]);expect(await calls(page,'runtime_start')).toEqual([]);
  61  | });
  62  | for(const command of ['account_action','runtime_start'])for(const outcome of ['success','failure'])test(`late ${command} ${outcome} from the previous owner cannot refresh or pause the current instance`,async({page})=>{
  63  |  const now=new Date('2026-10-27T03:00:00Z');await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));await setup(page);
  64  |  if(command==='account_action'){await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();}
  65  |  else{await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();}
  66  |  await page.evaluate(({command,outcome})=>{const w=window as any,native=w.__TAURI_INTERNALS__,invoke=native.invoke;native.invoke=async(name:string,args:unknown)=>{if(name===command){const result=outcome==='success'?await invoke(name,args):undefined;w.oldWriteStarted=true;return new Promise((resolve,reject)=>{w.finishOldWrite=()=>outcome==='success'?resolve(result):reject(new Error('old owner response failed after replacement'));});}return invoke(name,args);};},{command,outcome});
  67  |  if(command==='account_action'){await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
  68  |  else await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  69  |  await expect.poll(()=>page.evaluate(()=>(window as any).oldWriteStarted)).toBe(true);
  70  |  const before=await page.evaluate(()=>{const w=window as any;w.emit('d'.repeat(32));return w.runtimeReadCount;});await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);
  71  |  if(command==='account_action')await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
  72  |  await expect(page.getByRole('button',{name:'重新核对设备',exact:true})).toBeEnabled();
  73  |  const reads=await page.evaluate(()=>{const w=window as any;w.finishOldWrite();return w.runtimeReadCount;});await page.clock.runFor(9999);
  74  |  expect(await page.evaluate(()=>(window as any).runtimeReadCount)).toBe(reads);await page.clock.runFor(1);
  75  |  await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(page.getByText('等待自动重试…',{exact:true})).toHaveCount(0);
  76  | });
  77  | test('ready management stays stopped; select, explicit start, stop and per-platform states are usable',async({page})=>{
  78  |  await setup(page);await expect(page.getByRole('region',{name:'贡献运行'}).getByText('尚未接入 AI 账号',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
  79  |  await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  80  |  await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
  81  |  await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
  82  |  await page.getByRole('button',{name:'概览',exact:true}).click();await expect(page.getByRole('checkbox',{name:'允许 OpenAI 恢复接单'})).toHaveCount(0);await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  83  |  await expect(page.getByRole('region',{name:'贡献运行'}).getByText('接单已暂停',{exact:true})).toBeVisible();expect((await calls(page,'runtime_start'))[0].args.request.resume_platforms).toEqual([]);
  84  |  await page.getByRole('button',{name:'停止贡献',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();await expect(page.getByText('停止已确认，下次打开保持停止。')).toBeVisible();
  85  | });
  86  | test('uncertain account writes reconcile with reads only and passive runtime cannot clear them',async({page})=>{
  87  |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  88  |  await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});
  89  |  await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();
  90  |  await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  91  |  const reads=await page.evaluate(()=>(window as any).runtimeReadCount);await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();
  92  |  await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();const snapshots=(await calls(page,'account_snapshot')).length;await page.clock.runFor(10001);await expect.poll(async()=>(await calls(page,'account_snapshot')).length).toBeGreaterThan(snapshots);await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
  93  | });
  94  | test('official login warns about official account, supports cancellation, and completed login remains a candidate',async({page})=>{
  95  |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();await openDetails(page,'Claude');
  96  |  const sheet=page.getByRole('dialog').first();await sheet.getByRole('button',{name:'登录 Claude',exact:true}).click();const confirm=page.getByRole('dialog').last();await expect(confirm).toContainText('可能改变官方客户端当前登录');await confirm.getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();await sheet.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(sheet.getByText('操作已取消',{exact:true})).toBeVisible();
  97  |  await page.evaluate(()=>{(window as any).loginComplete=true;});await sheet.getByRole('button',{name:'登录 Claude',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByText('登录已核验，尚未接入')).toBeVisible();await page.keyboard.press('Escape');await expect(card(page,'Claude').getByText('尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  98  | });
  99  | test('uncertain runtime start is never replayed and requires a fresh query',async({page})=>{
  100 |  await setup(page);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;(window as any).runtimeUnknown=true;});
  101 |  await reconcile(page);await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByRole('region',{name:'贡献运行'})).toContainText('等待已安排的核对');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  102 |  await reconcile(page);await expect(page.getByRole('heading',{name:'接单条件尚未满足',exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toHaveLength(1);
  103 | });
  104 | 
  105 | test('completed login cannot clear a later source edit, and write admission locks the source',async({page})=>{
  106 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await openDetails(page);const sheet=page.getByRole('dialog').first();await page.evaluate(()=>{(window as any).loginAdmissionDelay=600;});
  107 |  await sheet.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByLabel('自定义目录')).toBeDisabled();await expect(sheet.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();await sheet.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(sheet.getByText('操作已取消',{exact:true})).toBeVisible();
  108 |  await page.evaluate(()=>{(window as any).loginAdmissionDelay=0;(window as any).loginComplete=true;});await sheet.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByText('登录已核验，尚未接入',{exact:true})).toBeVisible();
  109 |  await page.evaluate(()=>{(window as any).delay=30000;});await sheet.getByLabel('自定义目录').fill('/tmp/another-account');await sheet.getByLabel('自定义目录').press('Enter');await reconcile(page);await expect(sheet.getByLabel('自定义目录')).toHaveValue('/tmp/another-account');await expect.poll(async()=>(await calls(page,'account_detect')).at(-1)?.args.request.directory).toBe('/tmp/another-account');expect(await calls(page,'account_action')).toEqual([]);
  110 | });
  111 | 
  112 | test('account change remains paused and a platform failure leaves the other platform visible',async({page})=>{
  113 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();
  114 |  await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  115 |  await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;});
  116 |  await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();
  117 |  expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);expect(await calls(page,'runtime_start')).toEqual([]);
  118 |  await page.evaluate(()=>{const a=(window as any).accounts.claude;a.revision++;a.authorization.error={code:'source_unavailable',check:'source_read',platform:'claude',message:'source unavailable',evidence:{}};});
  119 |  await page.keyboard.press('Escape');await page.getByRole('button',{name:'概览',exact:true}).click();await reconcile(page);await expect(card(page,'Claude').getByRole('alert')).toContainText('source unavailable');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();
  120 | });
  121 | 
  122 | test('only proven unsubmitted confirmation can continue after reconciliation',async({page})=>{
  123 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  124 |  await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;a.operation={id:'c'.repeat(48),kind:'confirm_change',platform:'openai',state:'reconciling',revision:a.revision,error:{code:'confirmation_unknown',check:'account_change_submission',platform:'openai',message:'confirmation outcome unknown',evidence:{}}};});
  125 |  await reconcile(page);await openDetails(page);await expect(page.getByRole('dialog').getByRole('button',{name:'换号',exact:true})).toBeDisabled();await page.keyboard.press('Escape');expect(await calls(page,'account_action')).toEqual([]);
  126 |  await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.operation.revision=a.revision;a.operation.error.code='confirmation_not_submitted';a.operation.error.message='confirmation was not submitted';});
> 127 |  await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
      |                                                                                                                                                                                                                                                                                                ^ Error: expect(locator).toBeVisible() failed
  128 | });
  129 | 
  130 | test('English runtime and login confirmation support keyboard at minimum window size',async({page})=>{
  131 |  await page.setViewportSize({width:860,height:600});await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
  132 |  await expect(page.getByRole('region',{name:'Contribution runtime'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  133 |  await page.getByRole('button',{name:'AI accounts',exact:true}).click();await expect(page.getByRole('region',{name:'OpenAI account',exact:true}).getByText('Signed in, not connected')).toBeVisible();await page.getByRole('button',{name:'OpenAI details',exact:true}).click();const login=page.getByRole('dialog').getByRole('button',{name:'Sign in to OpenAI',exact:true});await login.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog').last()).toBeVisible();await expect(page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('dialog').last().getByRole('button',{name:'Start official sign-in',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(login).toBeFocused();await page.keyboard.press('Escape');
  134 |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);
  135 | });
  136 | 
  137 | 
  138 | test('runtime account revisions reach an open confirmation without changing its candidate',async({page})=>{
  139 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  140 |  await page.evaluate(()=>{const w=window as any;const a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
  141 |  await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
  142 |  const before=await page.evaluate(()=>{const w=window as any;const a=structuredClone(w.accounts.openai);a.revision+=2;w.accounts.openai=a;return {reads:w.runtimeReadCount,revision:a.revision,candidate:a.candidate.reference};});
  143 |  await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before.reads);await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();
  144 |  const written=await calls(page,'account_action');expect(written).toHaveLength(1);expect(written[0].args.request.revision).toBe(before.revision);expect(written[0].args.request.candidate_ref).toBe(before.candidate);
  145 |  await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();await expect(page.getByRole('dialog').getByText('等待自动重试…',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
  146 | });
  147 | 
  148 | test('runtime observations preserve newer candidates and edited sources',async({page})=>{
  149 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
  150 |  const reads=await page.evaluate(()=>{const w=window as any;w.runtimeAccounts=structuredClone(w.accounts);w.runtimeAccounts.openai.revision=0;w.runtimeAccounts.openai.candidate.fingerprint='f'.repeat(64);w.runtimeAccounts.openai.candidate.reference='e'.repeat(48);return w.runtimeReadCount;});
  151 |  await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(card(page).getByText('尚未接入',{exact:true})).toBeVisible();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();expect((await calls(page,'account_action'))[0].args.request.candidate_ref).toBe('a'.repeat(48));
  152 |  await openDetails(page);await page.evaluate(()=>{(window as any).delay=30000;});await page.getByRole('dialog').first().getByLabel('自定义目录').fill('/tmp/edited-source');await page.getByRole('dialog').first().getByLabel('自定义目录').press('Enter');
  153 |  const later=await page.evaluate(()=>{const w=window as any;delete w.runtimeAccounts;w.accounts.openai=structuredClone(w.accounts.openai);w.accounts.openai.revision++;return w.runtimeReadCount;});
  154 |  await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(later);await expect(page.getByRole('dialog').first().getByLabel('自定义目录')).toHaveValue('/tmp/edited-source');await expect(page.getByRole('dialog').first().getByText('正在读取已有登录…')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
  155 | });
  156 | 
  157 | test('start preserves paused platforms and uncertain start recovers by reading only',async({page})=>{
  158 |  const accounts={openai:accountFixture('openai') as any,claude:accountFixture('claude')};
  159 |  accounts.openai.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};
  160 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts});
  161 |  await page.goto('/');
  162 |  await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();
  163 |  await expect(page.getByRole('checkbox',{name:'允许 OpenAI 恢复接单'})).toHaveCount(0);
  164 |  await page.evaluate(()=>{(window as any).runtimeUnknown=true;});
  165 |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  166 |  await expect(page.getByRole('region',{name:'贡献运行'})).toContainText('等待已安排的核对');
  167 |  await page.clock.runFor(10001);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  168 |  const starts=await calls(page,'runtime_start');expect(starts).toHaveLength(1);
  169 |  expect(starts[0].args.request.resume_platforms).toEqual([]);
  170 |  expect(await calls(page,'supply_set_paused')).toEqual([]);
  171 |  await page.getByRole('button',{name:'停止贡献',exact:true}).click();
  172 |  await expect(page.getByRole('dialog')).toContainText('中断正在处理的任务');
  173 |  expect(await calls(page,'runtime_stop')).toEqual([]);
  174 |  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  175 |  await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeFocused();
  176 | });
  177 | 
  178 | test('unregistered selection can be cancelled only after confirmation and never starts runtime',async({page})=>{
  179 |  await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'取消接入',exact:true}).click();await expect(page.getByRole('dialog').last()).toContainText('仅取消尚未注册的本地选择');expect(await calls(page,'account_action')).toHaveLength(1);await page.getByRole('dialog').last().getByRole('button',{name:'确认取消接入',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消接入',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await expect(card(page).getByText('尚未接入',{exact:true})).toBeVisible();expect((await calls(page,'account_action')).map((c:any)=>c.args.request.action)).toEqual(['select','clear_selection']);expect(await calls(page,'runtime_start')).toEqual([]);
  180 | });
  181 | 
  182 | for(const denial of ['device','diagnostic','recovery'])test('identity '+denial+' still permits one trusted local stop',async({page})=>{
  183 |  await setup(page);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
  184 |  await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  185 |  if(denial==='device'){await page.evaluate(()=>(window as any).deviceFail=true);await reconcile(page);}
  186 |  else if(denial==='recovery'){await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='device_recovery_status'?{result:{error:{code:'DEVICE_RECOVERY_FAILED',message:'recovery admission rejected: account_workers=1'}}}:invoke(command,args);});await reconcile(page);}
  187 |  else{await page.clock.runFor(100);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='diagnostics_start'||command==='diagnostics_snapshot')result.result.report.checks[0]={...result.result.report.checks[0],status:'fail',code:'device_replaced',observed_at:new Date().toISOString(),evidence:{http_status:'401',path:'/api/bee/identity',server_code:'device_replaced'},next_action:'overview'};return result;};});await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.clock.runFor(900);await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();}
  188 |  const stop=page.getByRole('button',{name:'停止贡献',exact:true});await expect(stop).toBeEnabled();if(denial==='diagnostic')await page.evaluate(()=>(window as any).deviceFail=true);await stop.click();await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();
  189 |  await expect.poll(async()=>(await calls(page,'runtime_stop')).length).toBe(1);await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  190 |  expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'supply_set_paused')).toHaveLength(0);
  191 | });
  192 | 
  193 | for(const denial of ['device','recovery'])test(denial+' failure allows local login and cancellation but keeps account selection blocked',async({page})=>{
  194 |  const consoleErrors:string[]=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  195 |  await setup(page);await page.evaluate(denial=>{const w=window as any;if(denial==='device')w.deviceFail=true;else{const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>command==='device_recovery_status'?{result:{error:{code:'DEVICE_RECOVERY_FAILED',message:'recovery admission rejected: account_workers=1'}}}:invoke(command,args);}},denial);await reconcile(page);await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
  196 |  await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();await openDetails(page,'Claude');
  197 |  const login=page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true});await expect(login).toBeEnabled();await login.click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
  198 |  await expect.poll(async()=>(await calls(page,'authorize_start')).length).toBe(1);
  199 |  const cancel=page.getByRole('button',{name:'取消官方登录',exact:true}).last();await expect(cancel).toBeEnabled();await cancel.click();await expect.poll(async()=>(await calls(page,'authorize_cancel')).length).toBe(1);
  200 |  await expect(page.getByRole('dialog').getByText('操作已取消',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(0);expect(consoleErrors).toEqual([]);
  201 | });
  202 | 
  203 | test('recovery-only failure hides ready supply, blocks resume, and is visible beyond overview',async({page})=>{
  204 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  205 |  await page.addInitScript(()=>{const w=window as any;for(const a of Object.values(w.accounts) as any[])a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  206 |   if(command==='device_recovery_status'&&w.recoveryFail)return {result:{error:{code:'DEVICE_RECOVERY_FAILED',message:'recovery admission rejected: account_workers=1'}}};
  207 |   const reply=await invoke(command,args);if(command==='runtime_snapshot')Object.assign(reply.result.runtime,{local:'running',run_id:'a'.repeat(32),connection:'connected'});
  208 |   if(command==='supply_status')Object.assign(reply.result.supply,{ready:args.platform==='openai',reasons:args.platform==='openai'?[]:['manually_paused']});return reply;
  209 |  };});
  210 |  await page.goto('/');await expect(page.locator('.app-shell')).toHaveAttribute('data-desktop-status','ready');await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
  211 |  const before=(await calls(page,'account_snapshot')).length;await page.evaluate(()=>(window as any).recoveryFail=true);await reconcile(page);
  212 |  await expect(page.locator('.app-shell')).toHaveAttribute('data-desktop-status','unconfirmed');await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeDisabled();
  213 |  expect(await calls(page,'account_snapshot')).toHaveLength(before);expect(await calls(page,'supply_set_paused')).toEqual([]);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
  214 |  await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('recovery admission rejected: account_workers=1');
  215 | });
  216 | 
  217 | for(const command of ['account_action','runtime_start'])test('known unsent '+command+' recovers at the same revision without replay',async({page})=>{
  218 |  await setup(page);
  219 |  if(command==='account_action'){await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();}
  220 |  else {await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();}
  221 |  await page.evaluate(command=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.unsentAttempts=0;w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{if(name===command&&++w.unsentAttempts===1)throw {code:'REQUEST_QUEUE_TIMEOUT',message:'fixture queue expired before first byte; no bytes sent'};return invoke(name,args);};},command);
  222 |  if(command==='account_action'){await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
  223 |  else await page.getByRole('button',{name:'开始贡献',exact:true}).click();
  224 |  await expect(page.getByText('本次请求未发送，操作未提交。',{exact:true})).toBeVisible();await page.clock.runFor(10100);expect(await page.evaluate(()=>(window as any).unsentAttempts)).toBe(1);
  225 |  if(command==='account_action'){await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
  226 |  else{await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();await page.getByRole('button',{name:'开始贡献',exact:true}).click();}
  227 |  await expect.poll(async()=>(await calls(page,command)).length).toBe(1);expect(await page.evaluate(()=>(window as any).unsentAttempts)).toBe(2);
```