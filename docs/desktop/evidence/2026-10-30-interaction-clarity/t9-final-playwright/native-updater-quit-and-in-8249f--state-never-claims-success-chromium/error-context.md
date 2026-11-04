# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> quit-and-install confirmation is sole install action and failed stopping state never claims success
- Location: tests/native-updater.spec.ts:62:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '安装更新…', exact: true })

```

# Page snapshot

```yaml
- generic:
  - generic:
    - main:
      - status [aria-hidden]: 贡献中
      - region "应用更新":
        - generic [aria-hidden]:
          - generic:
            - heading [level=3]: Bee 0.1.0
            - generic: 当前安装版本
          - button: 安装更新…
        - generic:
          - generic:
            - text: 更新已下载并通过签名验证
            - generic: · 0.2.0
        - generic [aria-hidden]:
          - text: 最后检查时间：
          - time: 2026年10月27日 09:02:03
        - generic [aria-hidden]: 检查和下载不会退出 Bee。安装需要你确认退出，可能中断正在处理的任务。
  - dialog [active] [ref=e2]:
    - heading "退出 Bee 并安装更新？" [level=2] [ref=e3]
    - paragraph [ref=e4]: 退出并安装可能中断正在处理的任务。确认后 Bee 将停止并交给安装程序；安装结果将在重新启动后核验。
    - generic [ref=e5]:
      - button "取消" [ref=e6] [cursor=pointer]
      - button "退出并安装" [ref=e7] [cursor=pointer]
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | const snapshot = (change:Record<string,unknown>={}) => ({operation_id:null,revision:0,state:'idle',current_version:'0.1.0',target_version:null,checked_at:null,downloaded_bytes:0,total_bytes:null,release_notes:null,error:null,...change});
  3   | const available = (change:Record<string,unknown>={}) => snapshot({operation_id:'update-a',revision:2,state:'available',target_version:'0.2.0',checked_at:'2026-10-27T01:02:03Z',...change});
  4   | async function mount(page:Page,initial=snapshot(),language='zh') {
  5   |  await page.addInitScript(({initial}) => {
  6   |   const w=window as any;w.updaterSnapshot=initial;w.updateCalls=[];w.failCheck=false;w.installFails=false;
  7   |   w.updaterInvoke=async(command:string,args:any) => {
  8   |    w.updateCalls.push({command,args});
  9   |    if(command==='update_snapshot'&&w.frozenPollSnapshot)return structuredClone(w.frozenPollSnapshot);
  10  |    if(command==='update_check') {
  11  |     if(w.failCheck){w.updaterSnapshot={...w.updaterSnapshot,operation_id:'failed-check',revision:w.updaterSnapshot.revision+1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; body=temporarily unavailable'}};return structuredClone(w.updaterSnapshot);}
  12  |     w.updaterSnapshot={...w.updaterSnapshot,operation_id:'retry-check',revision:w.updaterSnapshot.revision+1,state:'checking',error:null};
  13  |    }
  14  |    if(command==='update_download')w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'downloading'};
  15  |    if(command==='update_install') {
  16  |     const request=args?.request;
  17  |     if(request?.operation_id!==w.updaterSnapshot.operation_id||request?.expected_revision!==w.updaterSnapshot.revision)throw {code:'UPDATE_INSTALL_REJECTED',message:`expected_revision=${request?.expected_revision}; actual_revision=${w.updaterSnapshot.revision}`};
  18  |     w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'stopping'};
  19  |    }
  20  |    return structuredClone(w.updaterSnapshot);
  21  |   };
  22  |  },{initial});
  23  |  await page.goto(`/tests/fixtures/native-updater.html?lang=${language}`);
  24  |  await expect(page.getByRole('region',{name:language==='zh'?'应用更新':'Application updates',exact:true})).toBeVisible();
  25  | }
  26  | async function replace(page:Page,value:unknown) {await page.evaluate(value=>{(window as any).updaterSnapshot=value;},value);}
  27  | const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).updateCalls.filter((c:any)=>c.command===command),command);
  28  | 
  29  | test('native background check is observed through read-only polls without triggering an automatic check',async({page})=>{
  30  |  await mount(page);
  31  |  await replace(page,snapshot({operation_id:'background-check',revision:1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'background manifest HTTP 503; required=200'}}));
  32  |  await expect(page.getByRole('alert')).toContainText('background manifest HTTP 503');
  33  |  expect(await calls(page,'update_check')).toHaveLength(0);
  34  |  await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
  35  | });
  36  | 
  37  | test('background check failure leaves contribution intact and manual retry needs no app restart',async({page})=>{
  38  |  await mount(page);expect(await calls(page,'update_check')).toHaveLength(0);
  39  |  await page.evaluate(()=>{(window as any).failCheck=true;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
  40  |  await expect(page.getByRole('alert')).toContainText('manifest HTTP 503; body=temporarily unavailable');
  41  |  await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
  42  |  await page.evaluate(()=>{(window as any).failCheck=false;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
  43  |  await expect(page.getByText('正在检查更新…',{exact:true})).toBeVisible();
  44  |  await replace(page,available({operation_id:'retry-check',revision:3}));await expect(page.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
  45  |  expect((await page.evaluate(()=>(window as any).updateCalls)).every((c:any)=>c.command.startsWith('update_'))).toBe(true);
  46  | });
  47  | 
  48  | test('unknown bytes never imply 100 percent and download completion awaits signed verified state',async({page})=>{
  49  |  await mount(page,available({release_notes:'<img src=x onerror="window.injected=true">\nPlain release notes'}));
  50  |  const notes=page.getByRole('group',{name:'发布说明',exact:true});await notes.getByText('发布说明',{exact:true}).click();await expect(notes).toContainText('<img src=x onerror="window.injected=true">');await expect(notes.locator('img')).toHaveCount(0);
  51  |  await page.getByRole('button',{name:'下载更新',exact:true}).click();
  52  |  await replace(page,available({state:'downloading',revision:4,downloaded_bytes:123,total_bytes:null}));
  53  |  await expect(page.getByText('已接收 123 字节；总大小未知',{exact:true})).toBeVisible();
  54  |  const progress=page.getByRole('progressbar');await expect(progress).not.toHaveAttribute('value');await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('100%');
  55  |  await replace(page,available({state:'downloading',revision:5,downloaded_bytes:200,total_bytes:200}));
  56  |  await expect(page.getByText('正在下载并验证更新…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
  57  |  expect(await calls(page,'update_install')).toHaveLength(0);
  58  |  await replace(page,available({state:'verified',revision:6,downloaded_bytes:200,total_bytes:200}));
  59  |  await expect(page.getByText('更新已下载并通过签名验证',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toBeEnabled();
  60  | });
  61  | 
  62  | test('quit-and-install confirmation is sole install action and failed stopping state never claims success',async({page})=>{
  63  |  await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
  64  |  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('可能中断正在处理的任务');await expect(dialog).not.toContainText('无任务');expect(await calls(page,'update_install')).toHaveLength(0);
  65  |  await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'update_install')).toHaveLength(0);
> 66  |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).dblclick();
      |                                                           ^ Error: locator.click: Test timeout of 30000ms exceeded.
  67  |  await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
  68  |  expect(await calls(page,'update_install')).toEqual([{command:'update_install',args:{request:{operation_id:'update-a',expected_revision:6,confirmed:true}}}]);
  69  |  await replace(page,available({state:'failed',revision:8,error:{code:'UPDATE_EXIT_FAILED',message:'child_reaped=false; Bee remains stopped; required=true'}}));
  70  |  await expect(page.getByRole('alert')).toContainText('child_reaped=false; Bee remains stopped');
  71  |  await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('更新成功');
  72  | });
  73  | 
  74  | test('stale confirmation surfaces native revision evidence and cannot silently install a changed receipt',async({page})=>{
  75  |  await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
  76  |  // Keep the client at the confirmed receipt so this case specifically exercises
  77  |  // native rejection. A poll that already observed 7 correctly rejects locally.
  78  |  await page.evaluate(()=>{const w=window as any;w.frozenPollSnapshot=structuredClone(w.updaterSnapshot);});
  79  |  await replace(page,available({state:'verified',revision:7}));await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  80  |  await expect(page.getByRole('alert')).toContainText('expected_revision=6; actual_revision=7');expect(await calls(page,'update_install')).toHaveLength(1);
  81  | });
  82  | 
  83  | test('keyboard confirmation starts on cancel and returns focus after dismissal',async({page})=>{
  84  |  await mount(page,available({state:'verified',revision:6}));
  85  |  const prepare=page.getByRole('button',{name:'安装更新…',exact:true});await prepare.focus();await page.keyboard.press('Enter');
  86  |  await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();
  87  |  await page.keyboard.press('Escape');await expect(prepare).toBeFocused();expect(await calls(page,'update_install')).toHaveLength(0);
  88  | });
  89  | 
  90  | test('late older poll stays blocked and exposes revision evidence',async({page})=>{
  91  |  await mount(page,available({state:'downloading',revision:10}));await replace(page,available({state:'verified',revision:9}));
  92  |  await expect(page.getByRole('alert')).toContainText('revision');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
  93  | });
  94  | 
  95  | test('current version says current and never invents recovery success in English',async({page})=>{
  96  |  await mount(page,snapshot({state:'current',revision:1,checked_at:'2026-10-27T01:02:03Z'}),'en');
  97  |  await expect(page.getByText('The current version is up to date',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
  98  |  await expect(page.getByRole('region',{name:'Application updates'})).not.toContainText('success');
  99  | });
  100 | 
  101 | test('settings About has one version and one update action wired to the fixed native commands',async({page})=>{
  102 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  103 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  104 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='bridge_status'&&value.metadata)value.metadata.bee_version='0.1.0';return value;};});
  105 |  await page.goto('/');
  106 |  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  107 |  await page.getByRole('tab',{name:'关于',exact:true}).click();
  108 |  const about=page.getByRole('region',{name:'关于 Bee',exact:true});
  109 |  const update=about.getByRole('region',{name:'应用更新',exact:true});
  110 |  await expect(update.getByText('Bee 0.1.0',{exact:true})).toBeVisible();
  111 |  await expect(about.getByText('桌面应用版本',{exact:true})).toHaveCount(0);
  112 |  await expect(about.getByText('Bee 版本',{exact:true})).toHaveCount(0);
  113 |  await expect(update.getByRole('button')).toHaveCount(1);
  114 |  await expect(update.getByRole('button',{name:'检查更新',exact:true})).toBeVisible();
  115 |  await expect(about).toContainText('macOS · arm64');
  116 |  const updateCalls=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command.startsWith('update_')));
  117 |  await update.getByRole('button',{name:'检查更新',exact:true}).click();
  118 |  await expect(update.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
  119 |  const notes=update.getByRole('group',{name:'发布说明',exact:true});
  120 |  await expect(notes).not.toHaveAttribute('open');await notes.getByText('发布说明',{exact:true}).click();
  121 |  await expect(notes).toContainText('Fixture release notes');
  122 |  await update.getByRole('button',{name:'下载更新',exact:true}).click();
  123 |  const install=update.getByRole('button',{name:'安装更新…',exact:true});await expect(install).toBeVisible();
  124 |  await page.getByRole('tab',{name:'通用',exact:true}).click();
  125 |  await page.getByLabel('外观',{exact:true}).selectOption('dark'); // switching tabs and parent rerender must preserve the verified client receipt
  126 |  await page.getByRole('tab',{name:'关于',exact:true}).click();
  127 |  await install.click();const dialog=page.getByRole('dialog');
  128 |  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();
  129 |  await page.keyboard.press('Escape');await expect(install).toBeFocused();
  130 |  expect((await updateCalls()).filter((c:any)=>c.command==='update_install')).toHaveLength(0);
  131 |  await install.click();await dialog.getByRole('button',{name:'退出并安装',exact:true}).click();
  132 |  await expect(update.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
  133 |  expect((await updateCalls()).filter((c:any)=>c.command!=='update_snapshot')).toEqual([
  134 |   {command:'update_check',args:{}},{command:'update_download',args:{}},
  135 |   {command:'update_install',args:{request:{operation_id:'fixture-update',expected_revision:2,confirmed:true}}},
  136 |  ]);
  137 | });
  138 | 
  139 | test('a failed install receipt can be reconciled and replaced without repeating the same install',async({page})=>{
  140 |  await mount(page,available({state:'verified',revision:6}));
  141 |  await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=(command:string,args:unknown)=>{
  142 |   if(command==='update_install'&&!w.firstInstallFailed){w.firstInstallFailed=true;w.updateCalls.push({command,args});return Promise.reject({code:'UPDATE_DISK_SPACE',message:'available=1; required=600 bytes; no exit performed'});}
  143 |   return invoke(command,args);
  144 |  };});
  145 |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  146 |  await expect(page.getByRole('alert')).toContainText('available=1; required=600');
  147 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  148 |  await page.getByRole('button',{name:'重新检查更新',exact:true}).click();
  149 |  await replace(page,available({operation_id:'retry-check',revision:8}));
  150 |  await page.getByRole('button',{name:'下载更新',exact:true}).click();
  151 |  await replace(page,available({operation_id:'retry-check',state:'verified',revision:10}));
  152 |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  153 |  await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
  154 |  const installs=await calls(page,'update_install');expect(installs).toHaveLength(2);
  155 |  expect(installs.map((c:any)=>c.args.request)).toEqual([
  156 |   {operation_id:'update-a',expected_revision:6,confirmed:true},
  157 |   {operation_id:'retry-check',expected_revision:10,confirmed:true},
  158 |  ]);
  159 | });
  160 | 
  161 | test('T9 known update failure is localized with the original evidence in the same notice',async({page})=>{
  162 |  await mount(page,snapshot({state:'failed',revision:1,error:{code:'UPDATE_SIGNATURE_FAILED',message:'signed=0.2.0; announced=0.3.0; installer not called',details:{check:'update_signature',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:'0.2.0',required:'0.3.0'}}}}));
  163 |  const alert=page.getByRole('alert');await expect(alert).toContainText('更新签名验证失败');await expect(alert).toContainText('signed=0.2.0; announced=0.3.0');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
  164 | });
  165 | 
  166 | test('T9 an unknown install receipt survives leaving settings and permits only reading that operation',async({page})=>{
```