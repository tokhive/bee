# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> T9 unread preferences cannot publish a default native language and recovery reads before synchronizing
- Location: tests/native-updater.spec.ts:200:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '重新同步原生语言', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '重新同步原生语言', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: '重新同步原生语言', exact: true })

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
  - heading "概览" [level=1]
  - button "打开 Hive 控制台"
  - region "贡献运行":
    - heading "尚未接入 AI 账号" [level=2]
    - paragraph: 开始后建立连接；接单需单独恢复。
    - button "开始贡献" [disabled]
    - paragraph: 请先接入至少一个 AI 账号。
    - text: Bee 未运行 尚未建立 Hive 连接
  - region "准备贡献":
    - heading "准备贡献" [level=2]
    - list:
      - listitem: 绑定本机设备
      - listitem: 在 Hive 网页确认
      - listitem: 接入 AI 账号
      - listitem: 开始贡献并按平台恢复接单
    - button "前往准备账号"
  - region "设备配对":
    - heading "本机设备" [level=2]
    - button "重新核对设备"
    - paragraph: 本机设备
    - strong: Fixture
    - status: 设备已绑定。
    - paragraph: 归属账号
    - strong: owner@example.test
    - text: 设备所属账号
    - paragraph: Hive
    - strong: https://hive.example
    - text: 配对不会自动开始贡献
  - region "平台账号列表":
    - heading "AI 账号" [level=2]
    - text: 0 个已接入
    - region "OpenAI 账号":
      - heading "OpenAI" [level=3]
      - paragraph: 尚未接入 OpenAI 账号
      - paragraph: 不能接单
      - paragraph: 所选来源的登录状态待确认。
      - list:
        - listitem:
          - text: Hive 未看到此平台的 Bee 连接
          - paragraph: 请在概览核对贡献运行和实际连接原因。
          - button "查看连接"
      - text: 额度 尚未核对
      - progressbar "已用额度"
    - region "Claude 账号":
      - heading "Claude" [level=3]
      - paragraph: 尚未接入 Claude 账号
      - paragraph: 不能接单
      - paragraph: 所选来源的登录状态待确认。
      - list:
        - listitem:
          - text: 已手动暂停
          - paragraph: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
        - listitem:
          - text: Hive 未看到此平台的 Bee 连接
          - paragraph: 请在概览核对贡献运行和实际连接原因。
          - button "查看连接"
      - text: 额度 尚未核对
      - progressbar "已用额度"
    - paragraph: 授权信息保留在本机
- contentinfo: Bee 设备绑定不自动开始贡献
```

# Test source

```ts
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
  177 |  await expect(page.getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。',{exact:true})).toBeVisible();
  178 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  179 |  await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新检查更新',exact:true})).toHaveCount(0);
  180 |  expect(await page.evaluate(()=>(window as any).installSubmissions)).toBe(1);
  181 | });
  182 | 
  183 | test('T9 saved language and same-revision system changes synchronize native metadata without notification or runtime writes',async({page})=>{
  184 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  185 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  186 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='native_locale_sync'){w.localeRequests.push(args.request);if(w.localeFails)throw {code:'NATIVE_LOCALE_MENU_FAILED',message:'native menu set_text failed: item=bee-open; actual=permission denied'};return null;}return invoke(command,args);};});
  187 |  await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
  188 |  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
  189 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  190 |  await page.getByLabel('Language',{exact:true}).selectOption('system');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('zh');
  191 |  const revision=await page.evaluate(()=>(window as any).localeRequests.at(-1).revision);
  192 |  await page.evaluate(()=>{Object.defineProperty(navigator,'language',{configurable:true,value:'en-US'});dispatchEvent(new Event('languagechange'));});
  193 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  194 |  const metadata=await page.evaluate(()=>(window as any).localeRequests);expect(metadata.at(-1).revision).toBe(revision);expect(metadata.every((r:any,i:number)=>i===0||r.sequence>metadata[i-1].sequence)).toBe(true);
  195 |  const writes=await page.evaluate(()=>(window as any).calls.filter((c:any)=>['notification_enable','notification_retry','runtime_start','runtime_stop'].includes(c.command)));expect(writes).toEqual([]);
  196 |  await page.evaluate(()=>{(window as any).localeFails=true;});await page.getByLabel('Language',{exact:true}).selectOption('zh');await expect(page.getByRole('alert')).toContainText('native menu set_text failed');
  197 |  await page.evaluate(()=>{(window as any).localeFails=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  198 | });
  199 | 
  200 | test('T9 unread preferences cannot publish a default native language and recovery reads before synchronizing',async({page})=>{
  201 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  202 |  await page.addInitScript(installAccountFixture,{accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  203 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.preferenceUnread=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='preferences_read'&&w.preferenceUnread)throw {code:'PREFERENCES_IO',message:'preference read failed: actual=permission denied'};if(command==='native_locale_sync'){w.localeRequests.push(args.request);return null;}return invoke(command,args);};});
> 204 |  await page.goto('/');await expect(page.getByRole('button',{name:'重新同步原生语言',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).localeRequests)).toEqual([]);
      |                                                                                           ^ Error: expect(locator).toBeVisible() failed
  205 |  await page.evaluate(()=>{(window as any).preferenceUnread=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
  206 | });
  207 | 
```