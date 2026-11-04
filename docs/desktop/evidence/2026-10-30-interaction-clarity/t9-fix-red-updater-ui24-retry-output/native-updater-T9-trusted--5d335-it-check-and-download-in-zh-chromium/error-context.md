# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> T9 trusted previous recovery explains and permits a new explicit check and download in zh
- Location: tests/native-updater.spec.ts:166:42

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert').locator('p').nth(1)
Expected pattern: /可信.*检查已通过.*重新检查.*下载/
Received string:  "更新保护仍保留；请重新启动 Bee 核验原更新。若仍受阻，请保留记录并使用可信安装包处理，普通更新检查不能解除保护。"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('alert').locator('p').nth(1) with timeout 5000ms
  - waiting for getByRole('alert').locator('p').nth(1)
    14 × locator resolved to <p>更新保护仍保留；请重新启动 Bee 核验原更新。若仍受阻，请保留记录并使用可信安装包处理，普通更新…</p>
       - unexpected value "更新保护仍保留；请重新启动 Bee 核验原更新。若仍受阻，请保留记录并使用可信安装包处理，普通更新检查不能解除保护。"

```

```yaml
- paragraph: 更新保护仍保留；请重新启动 Bee 核验原更新。若仍受阻，请保留记录并使用可信安装包处理，普通更新检查不能解除保护。
```

# Test source

```ts
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
  166 | for(const locale of ['zh','en'] as const)test(`T9 trusted previous recovery explains and permits a new explicit check and download in ${locale}`,async({page})=>{
  167 |  const original='running trusted previous version=0.1.0; pending target=0.2.0 was not installed; data and runtime verified; update may be retried';
  168 |  const observed='2026-11-02T12:00:00Z';
  169 |  await mount(page,available({state:'failed',revision:9,error:{code:'UPDATE_PREVIOUS_NOT_INSTALLED',message:original,details:{check:'update_recovery',observed_at:observed,evidence:{source_type:'native_updater',actual:original}}}}),locale);
  170 |  const alert=page.getByRole('alert'),impact=alert.locator('p').nth(1);
  171 |  await expect(alert.locator('p').first()).toContainText(locale==='zh'?/目标更新.*未安装/:/target update.*not installed/i);
> 172 |  await expect(impact).toContainText(locale==='zh'?/可信.*检查已通过.*重新检查.*下载/:/trusted.*checks passed.*check.*again.*download/i);
      |                       ^ Error: expect(locator).toContainText(expected) failed
  173 |  await expect(impact).not.toContainText(/保护仍保留|protection remains active|Restart Bee/);
  174 |  await alert.getByText(locale==='zh'?'查看失败详情':'View failure details',{exact:true}).click();
  175 |  const details=alert.locator('pre');
  176 |  const displayTime=await page.evaluate(({locale,observed})=>new Intl.DateTimeFormat(locale==='zh'?'zh-CN':'en-US',{dateStyle:'medium',timeStyle:'medium'}).format(new Date(observed)),{locale,observed});
  177 |  for(const fact of ['UPDATE_PREVIOUS_NOT_INSTALLED','update_recovery','native_updater',original,displayTime])await expect(details).toContainText(fact);
  178 |  expect(await calls(page,'update_check')).toHaveLength(0);expect(await calls(page,'update_download')).toHaveLength(0);expect(await calls(page,'update_install')).toHaveLength(0);
  179 |  await page.getByRole('button',{name:locale==='zh'?'检查更新':'Check for updates',exact:true}).click();
  180 |  await expect(page.getByText(locale==='zh'?'正在检查更新…':'Checking for updates…',{exact:true})).toBeVisible();
  181 |  await replace(page,available({operation_id:'retry-check',revision:11}));
  182 |  await page.getByRole('button',{name:locale==='zh'?'下载更新':'Download update',exact:true}).click();
  183 |  await expect(page.getByText(locale==='zh'?'正在下载并验证更新…':'Downloading and verifying the update…',{exact:true})).toBeVisible();
  184 |  expect(await calls(page,'update_check')).toHaveLength(1);expect(await calls(page,'update_download')).toHaveLength(1);expect(await calls(page,'update_install')).toHaveLength(0);
  185 | });
  186 | 
  187 | for(const locale of ['zh','en'] as const)test(`T9 unproven recovery preserves protection and allows only readback in ${locale}`,async({page})=>{
  188 |  const original='recovery evidence runtime_intent_restored=false; required=true; pending update preserved';
  189 |  await mount(page,available({state:'failed',revision:9,error:{code:'UPDATE_RECOVERY_UNPROVEN',message:original,details:{check:'update_recovery',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:'runtime_intent_restored=false',required:'true'}}}}),locale);
  190 |  const alert=page.getByRole('alert');
  191 |  await expect(alert.locator('p').nth(1)).toContainText(locale==='zh'?/保护仍保留.*普通更新检查不能解除保护/:/protection remains active.*normal update check cannot release/i);
  192 |  await expect(alert).toContainText(original);
  193 |  await page.getByRole('button',{name:locale==='zh'?'重新读取更新状态':'Read update status again',exact:true}).click();
  194 |  await expect(alert).toContainText('UPDATE_RECOVERY_UNPROVEN');
  195 |  for(const command of ['update_check','update_download','update_install'])expect(await calls(page,command)).toHaveLength(0);
  196 | });
  197 | 
  198 | test('T9 an unknown install receipt survives leaving settings and permits only reading that operation',async({page})=>{
  199 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  200 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  201 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.installSubmissions=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  202 |   if(command==='update_install'){w.installSubmissions++;throw {code:'IPC_TIMEOUT',message:'installation receipt unavailable; operation=fixture-update; submission outcome unknown'};}
  203 |   return invoke(command,args);
  204 |  };});
  205 |  await page.goto('/');const nav=page.getByRole('navigation');await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  206 |  await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  207 |  await expect(page.getByRole('alert')).toContainText('installation receipt unavailable');
  208 |  await nav.getByRole('button',{name:'概览',exact:true}).click();await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  209 |  await expect(page.getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。',{exact:true})).toBeVisible();
  210 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  211 |  await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新检查更新',exact:true})).toHaveCount(0);
  212 |  expect(await page.evaluate(()=>(window as any).installSubmissions)).toBe(1);
  213 | });
  214 | 
  215 | test('T9 saved language and same-revision system changes synchronize native metadata without notification or runtime writes',async({page})=>{
  216 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  217 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  218 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='native_locale_sync'){w.localeRequests.push(args.request);if(w.localeFails)throw {code:'NATIVE_LOCALE_MENU_FAILED',message:'native menu set_text failed: item=bee-open; actual=permission denied'};return null;}return invoke(command,args);};});
  219 |  await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
  220 |  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
  221 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  222 |  await page.getByLabel('Language',{exact:true}).selectOption('system');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('zh');
  223 |  const revision=await page.evaluate(()=>(window as any).localeRequests.at(-1).revision);
  224 |  await page.evaluate(()=>{Object.defineProperty(navigator,'language',{configurable:true,value:'en-US'});dispatchEvent(new Event('languagechange'));});
  225 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  226 |  const metadata=await page.evaluate(()=>(window as any).localeRequests);expect(metadata.at(-1).revision).toBe(revision);expect(metadata.every((r:any,i:number)=>i===0||r.sequence>metadata[i-1].sequence)).toBe(true);
  227 |  const writes=await page.evaluate(()=>(window as any).calls.filter((c:any)=>['notification_enable','notification_retry','runtime_start','runtime_stop'].includes(c.command)));expect(writes).toEqual([]);
  228 |  await page.evaluate(()=>{(window as any).localeFails=true;});await page.getByLabel('Language',{exact:true}).selectOption('zh');await expect(page.getByRole('alert')).toContainText('native menu set_text failed');
  229 |  await page.evaluate(()=>{(window as any).localeFails=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  230 | });
  231 | 
  232 | test('T9 unread preferences cannot publish a default native language and recovery reads before synchronizing',async({page})=>{
  233 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  234 |  await page.addInitScript(installAccountFixture,{accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  235 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.preferenceUnread=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='preferences_read'&&w.preferenceUnread)throw {code:'PREFERENCES_IO',message:'preference read failed: actual=permission denied'};if(command==='native_locale_sync'){w.localeRequests.push(args.request);return null;}return invoke(command,args);};});
  236 |  await page.goto('/');await expect(page.getByRole('button',{name:'重新同步原生语言',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).localeRequests)).toEqual([]);
  237 |  await page.evaluate(()=>{(window as any).preferenceUnread=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
  238 | });
  239 | 
  240 | for(const dismissal of ['cancel','escape'] as const)test(`T9 ${dismissal} closes an unsubmitted installation confirmation during a pending status poll`,async({page})=>{
  241 |  await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
  242 |  await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pollPending=true;await new Promise<void>(resolve=>{w.releasePoll=resolve;});}return invoke(command,args);};});
  243 |  await expect.poll(()=>page.evaluate(()=>(window as any).pollPending)).toBe(true);
  244 |  if(dismissal==='cancel')await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click({timeout:1000});else await page.keyboard.press('Escape');
  245 |  await expect(page.getByRole('dialog')).toHaveCount(0);expect(await calls(page,'update_install')).toHaveLength(0);
  246 |  await page.evaluate(()=>{(window as any).releasePoll();});
  247 | });
  248 | 
  249 | test('T9 a proven unsent install keeps the same verified update available for a new explicit confirmation',async({page})=>{
  250 |  await mount(page,available({state:'verified',revision:6}));await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=(command:string,args:any)=>{if(command==='update_install'&&!w.unsent){w.unsent=true;w.updateCalls.push({command,args});throw {code:'REQUEST_NOT_SENT',message:'native request not dispatched; installer not called'};}return invoke(command,args);};});
  251 |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();await expect(page.getByRole('alert')).toContainText('本次请求未发送');
  252 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click({timeout:1000});await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();expect(await calls(page,'update_install')).toHaveLength(2);
  253 | });
  254 | 
  255 | test('T9 background status reads do not disable an update action between pointer down and up',async({page})=>{
  256 |  await mount(page,available({state:'verified',revision:6}));await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pollPending=true;await new Promise<void>(resolve=>{w.releasePoll=resolve;});}return invoke(command,args);};});
  257 |  const prepare=page.getByRole('button',{name:'安装更新…',exact:true}),box=(await prepare.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await expect.poll(()=>page.evaluate(()=>(window as any).pollPending)).toBe(true);await page.mouse.up();await expect(page.getByRole('dialog')).toBeVisible();expect(await calls(page,'update_install')).toHaveLength(0);await page.keyboard.press('Escape');await page.evaluate(()=>{(window as any).releasePoll();});
  258 | });
  259 | 
  260 | test('T9 StrictMode keeps one background read pending and an unmounted read cannot overwrite a new check',async({page})=>{
  261 |  await mount(page,snapshot(),'zh','&strict=1&lifecycle=1');
  262 |  expect(await calls(page,'update_snapshot')).toHaveLength(1);
  263 |  await page.evaluate(()=>{const w=window as any;w.normalInvoke=w.updaterInvoke;w.pendingReads=0;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pendingReads++;return new Promise((_resolve,reject)=>{w.rejectOldPoll=reject;});}return w.normalInvoke(command,args);};});
  264 |  await expect.poll(()=>page.evaluate(()=>(window as any).pendingReads)).toBe(1);
  265 |  await page.waitForTimeout(260);expect(await page.evaluate(()=>(window as any).pendingReads)).toBe(1);
  266 |  await page.getByRole('button',{name:'切换更新控件',exact:true}).click();
  267 |  await page.evaluate(()=>{const w=window as any;w.updaterInvoke=w.normalInvoke;});
  268 |  await page.getByRole('button',{name:'切换更新控件',exact:true}).click();
  269 |  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByText('正在检查更新…',{exact:true})).toBeVisible();
  270 |  await page.evaluate(()=>{(window as any).rejectOldPoll({code:'UPDATE_CHECK_FAILED',message:'old unmounted read failed'});});
  271 |  await expect.poll(async()=>(await calls(page,'update_snapshot')).length).toBeGreaterThan(3);
  272 |  await expect(page.getByRole('alert')).toHaveCount(0);expect(await calls(page,'update_check')).toHaveLength(1);
```