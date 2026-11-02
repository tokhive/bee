# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-fix.spec.ts >> L02-running-login-stop-entry
- Location: tests/t10-layout-fix.spec.ts:71:1

# Error details

```
Test timeout of 50000ms exceeded.
```

```
Error: locator.scrollIntoViewIfNeeded: Test timeout of 50000ms exceeded.
Call log:
  - waiting for getByRole('dialog').getByText('官方登录前请先停止贡献', { exact: true })

```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - complementary:
        - generic: Bee
        - navigation:
          - button: 概览
          - button: AI 账号
          - button: 诊断
          - button: 设置
        - generic:
          - generic:
            - text: hive.example
            - paragraph: 接单条件尚未满足
          - generic:
            - generic:
              - text: Fixture
              - generic: 设备与平台控制
      - generic:
        - banner:
          - generic: 本机设备
        - main:
          - generic:
            - generic:
              - heading [level=1]: AI 账号
              - paragraph: 管理这台设备用于贡献的 AI 账号。
            - button: 打开 Hive 控制台
          - region:
            - generic:
              - heading [level=2]: AI 账号
              - generic: 2 个已接入
            - generic:
              - region:
                - generic:
                  - generic:
                    - generic:
                      - heading [level=3]: OpenAI
                      - generic: Plus
                    - paragraph:
                      - generic: "账号标识:"
                      - text: bbbbbbbbbbbbbbbb
                    - paragraph: 不能接单
                    - list:
                      - listitem:
                        - text: Hive 未看到此平台的 Bee 连接
                        - paragraph: 请在概览核对贡献运行和实际连接原因。
                        - button: 查看连接
                - generic:
                  - generic:
                    - generic:
                      - generic: 5 小时
                      - generic: 已用 120%
                    - progressbar
                  - generic:
                    - generic:
                      - generic: 7 日
                      - generic: 尚未核对
                    - progressbar
                  - paragraph: 有额度窗口已耗尽；请查看各窗口重置时间。
                - generic:
                  - button: 暂停接单
                  - button [expanded]
              - region:
                - generic:
                  - generic:
                    - generic [aria-hidden]: ✳
                  - generic:
                    - generic:
                      - heading [level=3]: Claude
                      - generic: 套餐待确认
                    - paragraph:
                      - generic: "账号标识:"
                      - text: bbbbbbbbbbbbbbbb
                    - paragraph: 不能接单
                    - list:
                      - listitem:
                        - text: 已手动暂停
                        - paragraph: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
                      - listitem:
                        - text: Hive 未看到此平台的 Bee 连接
                        - paragraph: 请在概览核对贡献运行和实际连接原因。
                        - button: 查看连接
                - generic:
                  - generic:
                    - generic:
                      - generic: 额度
                      - generic: 尚未核对
                    - progressbar
                - generic:
                  - button: 恢复接单
                  - button
            - paragraph: 授权信息保留在本机
        - contentinfo:
          - text: Bee
          - generic: 设备绑定不自动开始贡献
  - dialog [ref=e2]:
    - banner [ref=e3]:
      - heading "OpenAI 账号详情" [level=2] [ref=e4]
      - button "关闭" [active] [ref=e5] [cursor=pointer]
    - paragraph [ref=e6]: 查看账号与额度，管理凭证读取方式。
    - generic [ref=e7]:
      - generic [ref=e8]:
        - term [ref=e9]: 当前账号标识
        - definition [ref=e10]: bbbbbbbbbbbbbbbb
      - generic [ref=e11]:
        - term [ref=e12]: 订阅套餐
        - definition [ref=e13]: plus
      - generic [ref=e14]:
        - term [ref=e15]: 授权到期
        - definition [ref=e16]: 2099年1月1日 08:00:00
      - generic [ref=e17]:
        - term [ref=e18]: 候选账号标识
        - definition [ref=e19]: bbbbbbbbbbbbbbbb
    - paragraph
    - generic [ref=e20]:
      - heading "额度与重置" [level=3] [ref=e21]
      - generic [ref=e22]:
        - generic [ref=e23]:
          - generic [ref=e24]:
            - generic [ref=e25]: 5 小时
            - generic [ref=e26]: 已用 120%
          - progressbar "5 小时 已用额度" [ref=e27]
          - paragraph [ref=e29]: "重置时间: 2099年1月1日 08:00:00"
        - generic [ref=e30]:
          - generic [ref=e31]:
            - generic [ref=e32]: 7 日
            - generic [ref=e33]: 尚未核对
          - progressbar "7 日 已用额度" [ref=e34]
          - paragraph [ref=e36]: "重置时间: 未知"
        - paragraph [ref=e37]: 有额度窗口已耗尽；请查看各窗口重置时间。
    - group [ref=e38]:
      - generic "凭证读取方式" [ref=e39] [cursor=pointer]
      - paragraph [ref=e40]: 读取官方客户端已保存的登录；目录留空使用默认位置。
      - generic [ref=e41]:
        - text: 自定义目录
        - textbox "自定义目录" [ref=e42]:
          - /placeholder: /tmp/codex
      - generic [ref=e43]:
        - text: 存储方式
        - combobox "存储方式" [ref=e44]:
          - option "自动"
          - option "文件" [selected]
          - option "钥匙串"
      - paragraph [ref=e45]: 修改读取位置不会自动更换已接入账号。
    - generic [ref=e46]:
      - generic [ref=e47]:
        - button "重新登录" [disabled] [ref=e48]
        - button "取消接入" [ref=e49] [cursor=pointer]
      - generic [ref=e51]:
        - paragraph [ref=e52]: 官方登录前请先停止贡献；前往概览停止后再返回。
        - button "查看贡献运行" [ref=e53] [cursor=pointer]
```

# Test source

```ts
  1   | import {test,expect,type Page,type TestInfo,type Locator} from '@playwright/test';
  2   | import {writeFileSync} from 'node:fs';
  3   | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  4   | 
  5   | const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  6   | const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
  7   | const writes=['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save'];
  8   | const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
  9   | function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
  10  | async function install(page:Page,scenarios:any={},accounts={openai:accountFixture('openai'),claude:accountFixture('claude')}){
  11  |  await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  12  |  page.on('pageerror',e=>{throw e;});
  13  |  await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios,accounts});
  14  | }
  15  | async function ready(page:Page){await page.goto('/');await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();}
  16  | async function preview(page:Page,scene:string){
  17  |  await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  18  |  await page.goto('/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene,locale:'zh',theme:'light'}));
  19  |  await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
  20  |  expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
  21  | }
  22  | async function zeroWrites(page:Page){expect(await page.evaluate(writes=>(window as any).calls.filter((c:any)=>writes.includes(c.command)),writes)).toEqual([]);}
  23  | async function evidence(page:Page,info:TestInfo,id:string,preconditions:unknown,focus?:Locator){
  24  |  await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
  25  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);
  26  |  await page.screenshot({path:info.outputPath(id+'-entry.png'),fullPage:true});
> 27  |  if(focus){await focus.scrollIntoViewIfNeeded();await expect(focus).toBeInViewport();}
      |                        ^ Error: locator.scrollIntoViewIfNeeded: Test timeout of 50000ms exceeded.
  28  |  const screenshot=info.outputPath(id+'.png');await page.screenshot({path:screenshot,fullPage:true});
  29  |  const actual=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},width:document.documentElement.scrollWidth,body:document.body.innerText,main:document.querySelector('main')?.textContent,status:document.querySelector('.app-shell')?.getAttribute('data-desktop-status'),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),actions:[...document.querySelectorAll('main button,[role=dialog] button')].map(e=>({text:e.textContent,disabled:(e as HTMLButtonElement).disabled,rect:e.getBoundingClientRect().toJSON()})),accounts:(window as any).accounts,calls:(window as any).calls,scene:(window as any).__beePreviewScene,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}));
  30  |  expect(actual.reducedMotion).toBe(true);
  31  |  for(const dialog of actual.dialogs){expect(dialog.rect.x).toBeGreaterThanOrEqual(0);expect(dialog.rect.right).toBeLessThanOrEqual(861);expect(dialog.rect.y).toBeGreaterThanOrEqual(0);expect(dialog.rect.bottom).toBeLessThanOrEqual(601);}
  32  |  writeFileSync(info.outputPath(id+'.json'),JSON.stringify({id,observed_at:new Date().toISOString(),layer:'正式 NativeApp＋模拟 IPC；仅断言的组件子路径，不证明真实官方/OS副作用',preconditions,actual,screenshot},null,2));
  33  | }
  34  | 
  35  | for(const [scene,id]of [['runtime-no-accounts','R01-no-selection'],['runtime-accounts-unconfirmed','R01-accounts-unconfirmed']])test(id,async({page},info)=>{
  36  |  await preview(page,scene);await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
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
```