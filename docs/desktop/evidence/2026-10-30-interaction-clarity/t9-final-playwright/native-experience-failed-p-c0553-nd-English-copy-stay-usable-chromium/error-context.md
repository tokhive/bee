# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-experience.spec.ts >> failed preference save keeps the saved appearance; recovery and English copy stay usable
- Location: tests/native-experience.spec.ts:59:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected substring: "PREFERENCES_WRITE_FAILED"
Error: strict mode violation: getByRole('alert') resolved to 2 elements:
    1) <div role="alert" class="problem-notice device-error">…</div> aka getByText('原生语言同步无法核验已保存偏好。菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。查看失败详情错误码:')
    2) <div role="alert" class="problem-notice device-error">…</div> aka getByText('本次操作失败，原因尚未确认。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: PREFERENCES_WRITE_FAILED')

Call log:
  - Expect "toContainText" getByRole('alert') with timeout 5000ms
  - waiting for getByRole('alert')

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
        - text: Fixture
        - generic [ref=e34]: 设备与平台控制
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: 本机设备
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "设置" [level=1] [ref=e44]
          - paragraph [ref=e45]: 管理设备偏好与应用设置。
        - button "打开 Hive 控制台" [ref=e46] [cursor=pointer]
      - generic [ref=e47]:
        - alert [ref=e48]:
          - paragraph [ref=e49]: 原生语言同步无法核验已保存偏好。
          - paragraph [ref=e50]: 菜单和新系统通知的语言尚未同步；请重新读取偏好并同步。已有通知不会重发。
          - group [ref=e51]:
            - generic "查看失败详情" [ref=e52] [cursor=pointer]
        - button "重新同步原生语言" [ref=e53] [cursor=pointer]
      - generic [ref=e54]:
        - tablist "设置分类" [ref=e55]:
          - tab "通用" [active] [selected] [ref=e56] [cursor=pointer]
          - tab "网络与代理" [ref=e57] [cursor=pointer]
          - tab "通知与启动" [ref=e58] [cursor=pointer]
          - tab "关于" [ref=e59] [cursor=pointer]
        - generic [ref=e60]:
          - alert [ref=e61]:
            - paragraph [ref=e62]: 本次操作失败，原因尚未确认。
            - paragraph [ref=e63]: 本次操作未能完成；后续状态以重新核对的结果为准。
            - group [ref=e64]:
              - generic "查看失败详情" [ref=e65] [cursor=pointer]
          - button "重新读取偏好" [ref=e66] [cursor=pointer]
        - tabpanel "通用" [ref=e67]:
          - region [ref=e68]:
            - generic [ref=e69]:
              - heading "语言与外观" [level=2] [ref=e70]
              - paragraph [ref=e71]: 保存到当前系统用户，重启后保留。
            - generic [ref=e72]:
              - generic [ref=e73]: 语言
              - combobox "语言" [disabled] [ref=e74]:
                - option "跟随系统" [selected]
                - option "中文"
                - option "English"
            - generic [ref=e75]:
              - generic [ref=e76]: 外观
              - combobox "外观" [disabled] [ref=e77]:
                - option "跟随系统" [selected]
                - option "浅色"
                - option "深色"
    - contentinfo [ref=e78]:
      - text: Bee
      - generic [ref=e79]: 设备绑定不自动开始贡献
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  3   | 
  4   | const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((call:any)=>call.command===command),command);
  5   | const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
  6   | const tab=(page:Page,name:string)=>page.getByRole('tab',{name,exact:true});
  7   | async function expectPrimaryContrast(page:Page,selector:string){
  8   |  const button=page.locator(selector);await button.hover();
  9   |  const contrast=await button.evaluate(element=>{
  10  |   const style=getComputedStyle(element),luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  11  |   const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  12  |  });expect(contrast).toBeGreaterThanOrEqual(4.5);
  13  | }
  14  | async function setup(page:Page){
  15  |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  16  |  await page.clock.install();await page.goto('/');
  17  |  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
  18  | }
  19  | async function completeReport(page:Page){
  20  |  await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();
  21  |  await page.getByTestId('passed-checks').locator(':scope > summary').click();await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();await page.clock.runFor(900);
  22  |  await expect(page.getByText('检查已完成',{exact:false})).toBeVisible();
  23  | }
  24  | 
  25  | test('four native pages share one poller; diagnostics starts only on click and survives navigation',async({page})=>{
  26  |  await setup(page);expect(await page.getByRole('navigation').getByRole('button').allTextContents()).toEqual(['概览','AI 账号','诊断','设置']);
  27  |  await nav(page,'AI 账号').click();await expect.poll(async()=>(await calls(page,'account_detect')).length).toBe(2);await expect(page.getByRole('button',{name:'OpenAI 详情',exact:true})).toBeEnabled();
  28  |  await nav(page,'概览').click();const before=await calls(page,'runtime_snapshot');
  29  |  for(const name of ['AI 账号','诊断','设置','概览','诊断'])await nav(page,name).click();
  30  |  await expect(page.getByText('尚未运行诊断',{exact:true})).toBeVisible();expect(await calls(page,'diagnostics_start')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);
  31  |  expect((await calls(page,'runtime_snapshot')).length).toBe(before.length);
  32  |  await completeReport(page);const diagnosticReads=(await calls(page,'diagnostics_snapshot')).length;
  33  |  await nav(page,'AI 账号').click();await nav(page,'概览').click();await nav(page,'诊断').click();
  34  |  await page.getByTestId('passed-checks').locator(':scope > summary').click();await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();expect((await calls(page,'diagnostics_start')).length).toBe(1);expect((await calls(page,'diagnostics_snapshot')).length).toBe(diagnosticReads);
  35  |  const writes=await page.evaluate(()=>(window as any).calls.filter((call:any)=>/^(runtime_start|runtime_stop|account_action|authorize_start|supply_set_paused)$/.test(call.command)));expect(writes).toEqual([]);
  36  |  await expect(page.getByRole('button',{name:'收益',exact:true})).toHaveCount(0);await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
  37  | });
  38  | 
  39  | test('safe logs load manually with module/platform/level filters and native cursors',async({page})=>{
  40  |  await setup(page);await nav(page,'诊断').click();await tab(page,'安全日志').click();
  41  |  await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
  42  |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  43  |  await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  44  |  await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');
  45  |  expect((await calls(page,'diagnostic_logs'))[0].args).toEqual({query:{cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'}});
  46  |  await page.getByRole('button',{name:'加载更多日志',exact:true}).click();
  47  |  expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);
  48  | });
  49  | 
  50  | test('management startup failure keeps safe native logs accessible without enabling diagnostics',async({page})=>{
  51  |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  52  |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>command==='bridge_status'?Promise.resolve({state:'failed',error:{code:'SIDECAR_EXIT',message:'owned management child exited: status=1'}}):invoke(command,args);});
  53  |  await page.goto('/');await expect(page.getByRole('alert')).toHaveCount(1);const failure=page.locator('.status-view .problem-notice');await expect(failure).toContainText('SIDECAR_EXIT');await failure.getByText('查看失败详情',{exact:true}).click();await expect(failure).toContainText('owned management child exited: status=1');
  54  |  await nav(page,'诊断').click();await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeDisabled();
  55  |  await tab(page,'安全日志').click();await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');
  56  |  expect((await calls(page,'diagnostic_logs')).length).toBe(1);expect(await calls(page,'diagnostics_start')).toEqual([]);
  57  | });
  58  | 
  59  | test('failed preference save keeps the saved appearance; recovery and English copy stay usable',async({page})=>{
  60  |  await setup(page);await nav(page,'设置').click();await tab(page,'通用').click();await page.evaluate(()=>{(window as any).preferencesFail=true;});
  61  |  await page.getByLabel('外观',{exact:true}).selectOption('dark');
> 62  |  await expect(page.getByRole('alert')).toContainText('PREFERENCES_WRITE_FAILED');await expect(page.getByLabel('外观',{exact:true})).toHaveValue('system');
      |                                        ^ Error: expect(locator).toContainText(expected) failed
  63  |  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  64  |  await page.evaluate(()=>{(window as any).preferencesFail=false;});await page.getByRole('button',{name:'重新读取偏好',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  65  |  await page.getByLabel('语言',{exact:true}).selectOption('en');await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  66  |  await expect(page.getByText('Saved for this system user and retained after restarting.',{exact:true})).toBeVisible();
  67  |  await nav(page,'Diagnostics').click();await expect(page.getByRole('button',{name:'Run diagnostics',exact:true})).toBeVisible();
  68  |  expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  69  | });
  70  | 
  71  | test('Hive entry asks native code to open only the saved origin root without frontend URL input',async({page})=>{
  72  |  await setup(page);await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).click();
  73  |  expect(await calls(page,'hive_open')).toEqual([{command:'hive_open',args:{}}]);expect(await page.evaluate(()=>(window as any).openedHive)).toBe('https://hive.example/');
  74  | });
  75  | 
  76  | for(const outcome of ['success','failure'])test(`late Hive open ${outcome} from the previous instance cannot refresh the new owner`,async({page})=>{
  77  |  await setup(page);await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  78  |  await page.evaluate((outcome:string)=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{if(command!=='hive_open')return invoke(command,args);const result=await invoke(command,args);w.oldHiveStarted=true;return new Promise((resolve,reject)=>{w.finishOldHive=()=>outcome==='success'?resolve(result):reject(new Error('HIVE_OPEN_FAILED: old instance result arrived after replacement'));});};},outcome);
  79  |  await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).oldHiveStarted)).toBe(true);
  80  |  const before=await page.evaluate(()=>{const w=window as any;w.emit('d'.repeat(32));return w.runtimeReadCount;});await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);
  81  |  await expect(page.getByRole('button',{name:'重新核对设备',exact:true})).toBeEnabled();
  82  |  const reads=await page.evaluate(()=>{const w=window as any;w.finishOldHive();return w.runtimeReadCount;});await page.clock.runFor(1);
  83  |  expect(await page.evaluate(()=>(window as any).runtimeReadCount)).toBe(reads);await expect(page.getByText(/HIVE_OPEN_FAILED/)).toHaveCount(0);
  84  | });
  85  | 
  86  | test('notification delivery failures stay visible and retry requires an explicit action',async({page})=>{
  87  |  await setup(page);await page.evaluate(()=>{const w=window as any;w.notificationPermission='granted';w.notificationDeliveryError={code:'NOTIFICATION_NATIVE',message:'native notification rejected: os_code=13'};});
  88  |  await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
  89  |  expect(await calls(page,'notification_retry')).toEqual([]);expect(await calls(page,'notification_enable')).toEqual([]);
  90  |  await page.getByLabel('接收系统通知',{exact:true}).check();
  91  |  await page.getByRole('button',{name:'重试失败的通知',exact:true}).click();
  92  |  expect(await calls(page,'notification_retry')).toEqual([{command:'notification_retry',args:{}}]);
  93  |  await expect(page.getByRole('status')).toContainText('将在下次后台检查时重试明确失败的通知');
  94  |  await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通知与启动').click();
  95  |  expect((await calls(page,'notification_retry')).length).toBe(1);await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
  96  | });
  97  | 
  98  | for(const outcome of ['success','failure'])test(`a delayed initial preference ${outcome} cannot roll back a newer saved appearance`,async({page})=>{
  99  |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  100 |  await page.addInitScript((outcome:string)=>{
  101 |   const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke,releases:Array<()=>void>=[];
  102 |   w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='preferences_read')return new Promise((resolve,reject)=>releases.push(()=>outcome==='failure'?reject(new Error('PREFERENCES_IO: earlier read failed: os_code=13')):resolve(value)));return value;};
  103 |   w.releasePreferences=()=>{for(const release of releases.splice(0))release();};
  104 |  },outcome);
  105 |  await page.goto('/');await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
  106 |  await nav(page,'设置').click();await tab(page,'通用').click();await page.getByLabel('外观',{exact:true}).selectOption('dark');await expect(page.getByRole('status')).toHaveText('偏好已保存。');
  107 |  await page.evaluate(()=>{(window as any).releasePreferences();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  108 |  await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通用').click();
  109 |  await expect(page.getByLabel('外观',{exact:true})).toHaveValue('dark');expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
  110 |  await expect(page.getByRole('alert')).toHaveCount(0);
  111 | });
  112 | 
  113 | test('export confirms scope and waits for matched native success/failure/unknown receipts',async({page})=>{
  114 |  await setup(page);await completeReport(page);
  115 |  await page.evaluate(()=>{
  116 |   const w=window as any;w.downloads=[];w.exportBlobs=new Map();const create=URL.createObjectURL.bind(URL);
  117 |   URL.createObjectURL=blob=>{const url=create(blob);w.exportBlobs.set(url,blob);return url;};
  118 |   HTMLAnchorElement.prototype.click=function(){w.downloads.push({url:this.href,filename:this.download,subscribed:w.downloadListenerCount()>0});};
  119 |  });
  120 |  const exportButton=page.getByRole('button',{name:'导出脱敏报告',exact:true});await exportButton.click();
  121 |  const dialog=page.getByRole('dialog',{name:'选择导出范围'});await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'diagnostics_export')).toEqual([]);
  122 |  await exportButton.click();await dialog.getByLabel('本次检查结果与安全日志',{exact:true}).check();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();
  123 |  await expect(page.getByRole('status')).toContainText('正在等待报告下载结果');
  124 |  const first=await page.evaluate(()=>(window as any).downloads[0]);expect(first.filename).toBe('bee-diagnostics.json');expect(first.subscribed).toBe(true);
  125 |  await page.evaluate(()=>{const w=window as any;w.emitDownload('blob:unrelated',true);});await expect(exportButton).toBeDisabled();
  126 |  await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[0].url,false);});await expect(page.getByRole('alert')).toContainText('success=false');await expect(page.getByRole('alert')).not.toContainText('blob:');
  127 |  await exportButton.click();await dialog.getByLabel('仅本次检查结果',{exact:true}).check();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).downloads.length)).toBe(2);
  128 |  await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[1].url,true);});await expect(page.getByRole('status')).toHaveText('脱敏报告已下载。');
  129 |  const saved=await page.evaluate(async()=>{const w=window as any;return JSON.parse(await w.exportBlobs.get(w.downloads[1].url).text());});expect(saved.product).toBe('Bee');expect(saved.logs).toEqual([]);
  130 |  await exportButton.click();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).downloads.length)).toBe(3);await page.clock.runFor(30001);
  131 |  await expect(page.getByRole('status')).toContainText('下载结果未确认');expect(await page.evaluate(()=>(window as any).downloadListenerCount())).toBe(0);
  132 |  await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[2].url,true);});await expect(page.getByRole('status')).toContainText('下载结果未确认');
  133 | });
  134 | 
  135 | test('new management instance discards a pending diagnostic from the previous instance',async({page})=>{
  136 |  await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{(window as any).diagnosticDelay=1500;});
  137 |  await page.getByRole('button',{name:'运行诊断',exact:true}).click();await expect.poll(async()=>(await calls(page,'diagnostics_start')).length).toBe(1);
  138 |  await page.evaluate(()=>{(window as any).emit('d'.repeat(32));});await page.clock.runFor(1600);
  139 |  await expect(page.getByText('Hive 身份已核对',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeEnabled();expect((await calls(page,'diagnostics_start')).length).toBe(1);
  140 | });
  141 | 
  142 | test('diagnostic tabs keep reads explicit and preserve the running report',async({page})=>{
  143 |  await setup(page);await nav(page,'诊断').click();
  144 |  await expect(tab(page,'检查结果')).toHaveAttribute('aria-selected','true');
  145 |  await tab(page,'安全日志').click();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeVisible();
  146 |  await tab(page,'检查结果').click();expect(await calls(page,'diagnostics_start')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);
  147 |  await page.evaluate(()=>{(window as any).diagnosticsStayRunning=true;});
  148 |  await page.getByRole('button',{name:'运行诊断',exact:true}).click();
  149 |  await tab(page,'安全日志').click();await tab(page,'检查结果').click();
  150 |  expect((await calls(page,'diagnostics_start')).length).toBe(1);
  151 |  await page.clock.runFor(1700);expect((await calls(page,'diagnostics_snapshot')).length).toBe(2);
  152 |  await page.getByRole('button',{name:'取消诊断',exact:true}).click();
  153 |  await expect(page.getByText('诊断已取消',{exact:true})).toBeVisible();
  154 |  await expect(page.getByText('全部检查通过',{exact:true})).toHaveCount(0);
  155 |  expect(await calls(page,'diagnostic_logs')).toEqual([]);
  156 | });
  157 | 
  158 | test('settings categories preserve the proxy draft and test result without querying the OS again',async({page})=>{
  159 |  await setup(page);await nav(page,'设置').click();
  160 |  await expect(tab(page,'网络与代理')).toHaveAttribute('aria-selected','true');
  161 |  expect(await page.getByRole('tab').allTextContents()).toEqual(['通用','网络与代理','通知与启动','关于']);
  162 |  await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7900');
```