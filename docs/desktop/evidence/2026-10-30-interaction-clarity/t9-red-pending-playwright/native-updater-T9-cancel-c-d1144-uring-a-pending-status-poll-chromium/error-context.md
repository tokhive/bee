# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> T9 cancel closes an unsubmitted installation confirmation during a pending status poll
- Location: tests/native-updater.spec.ts:208:53

# Error details

```
TimeoutError: locator.click: Timeout 1000ms exceeded.
Call log:
  - waiting for getByRole('dialog').getByRole('button', { name: '取消', exact: true })
    - locator resolved to <button disabled type="button">取消</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 500ms

```

# Page snapshot

```yaml
- generic [active]:
  - generic:
    - main:
      - status [aria-hidden]: 贡献中
      - region "应用更新":
        - generic [aria-hidden]:
          - generic:
            - heading [level=3]: Bee 0.1.0
            - generic: 当前安装版本
          - button [disabled]: 安装更新…
        - generic:
          - generic:
            - text: 更新已下载并通过签名验证
            - generic: · 0.2.0
        - generic [aria-hidden]:
          - text: 最后检查时间：
          - time: 2026年10月27日 09:02:03
        - generic [aria-hidden]: 检查和下载不会退出 Bee。安装需要你确认退出，可能中断正在处理的任务。
  - dialog [ref=e2]:
    - heading "退出 Bee 并安装更新？" [level=2] [ref=e3]
    - paragraph [ref=e4]: 退出并安装可能中断正在处理的任务。确认后 Bee 将停止并交给安装程序；安装结果将在重新启动后核验。
    - generic [ref=e5]:
      - button "取消" [disabled] [ref=e6]
      - button "退出并安装" [disabled] [ref=e7]
```

# Test source

```ts
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
  204 |  await page.goto('/');await expect(page.getByRole('button',{name:'重新同步原生语言',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).localeRequests)).toEqual([]);
  205 |  await page.evaluate(()=>{(window as any).preferenceUnread=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
  206 | });
  207 | 
  208 | for(const dismissal of ['cancel','escape'] as const)test(`T9 ${dismissal} closes an unsubmitted installation confirmation during a pending status poll`,async({page})=>{
  209 |  await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
  210 |  await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pollPending=true;await new Promise<void>(resolve=>{w.releasePoll=resolve;});}return invoke(command,args);};});
  211 |  await expect.poll(()=>page.evaluate(()=>(window as any).pollPending)).toBe(true);
> 212 |  if(dismissal==='cancel')await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click({timeout:1000});else await page.keyboard.press('Escape');
      |                                                                                                    ^ TimeoutError: locator.click: Timeout 1000ms exceeded.
  213 |  await expect(page.getByRole('dialog')).toHaveCount(0);expect(await calls(page,'update_install')).toHaveLength(0);
  214 |  await page.evaluate(()=>{(window as any).releasePoll();});
  215 | });
  216 | 
```