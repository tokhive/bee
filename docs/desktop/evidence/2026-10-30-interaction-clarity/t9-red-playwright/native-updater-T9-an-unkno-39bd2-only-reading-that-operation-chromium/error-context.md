# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> T9 an unknown install receipt survives leaving settings and permits only reading that operation
- Location: tests/native-updater.spec.ts:166:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。', { exact: true }) with timeout 5000ms
  - waiting for getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。', { exact: true })

```

```yaml
- complementary:
  - text: Bee
  - navigation "主导航":
    - button "概览"
    - button "AI 账号"
    - button "诊断"
    - button "设置"
  - text: hive.example
  - paragraph: 尚未接入 AI 账号
  - text: Fixture 设备与平台控制
- banner: 本机设备
- main:
  - heading "设置" [level=1]
  - paragraph: 管理设备偏好与应用设置。
  - button "打开 Hive 控制台"
  - tablist "设置分类":
    - tab "通用"
    - tab "网络与代理"
    - tab "通知与启动"
    - tab "关于" [selected]
  - tabpanel "关于":
    - region "关于 Bee":
      - heading "关于 Bee" [level=2]
      - paragraph: 当前应用、运行核心与 Hive 信息。
      - region "应用更新":
        - heading "Bee 0.1.0" [level=3]
        - text: macOS · arm64
        - button "安装更新…"
        - text: 更新已下载并通过签名验证 · 0.2.0 最后检查时间：
        - time: 2026年11月3日 01:19:46
        - group "发布说明"
        - text: 检查和下载不会退出 Bee。安装需要你确认退出，可能中断正在处理的任务。
      - paragraph: Bee 版本：dev
      - term: Hive
      - definition: https://hive.example
      - paragraph: Hive 设备身份已核对。
- contentinfo: Bee 设备绑定不自动开始贡献
```

# Test source

```ts
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
  167 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  168 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  169 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.installSubmissions=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  170 |   if(command==='update_install'){w.installSubmissions++;throw {code:'IPC_TIMEOUT',message:'installation receipt unavailable; operation=fixture-update; submission outcome unknown'};}
  171 |   return invoke(command,args);
  172 |  };});
  173 |  await page.goto('/');const nav=page.getByRole('navigation');await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  174 |  await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  175 |  await expect(page.getByRole('alert')).toContainText('installation receipt unavailable');
  176 |  await nav.getByRole('button',{name:'概览',exact:true}).click();await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
> 177 |  await expect(page.getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。',{exact:true})).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  178 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  179 |  await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新检查更新',exact:true})).toHaveCount(0);
  180 |  expect(await page.evaluate(()=>(window as any).installSubmissions)).toBe(1);
  181 | });
  182 | 
```