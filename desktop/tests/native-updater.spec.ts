import {test,expect,type Page} from '@playwright/test';
const snapshot = (change:Record<string,unknown>={}) => ({operation_id:null,revision:0,state:'idle',current_version:'0.1.0',target_version:null,checked_at:null,downloaded_bytes:0,total_bytes:null,release_notes:null,error:null,...change});
const available = (change:Record<string,unknown>={}) => snapshot({operation_id:'update-a',revision:2,state:'available',target_version:'0.2.0',checked_at:'2026-10-27T01:02:03Z',...change});
async function mount(page:Page,initial=snapshot(),language='zh',query='') {
 await page.addInitScript(({initial}) => {
  const w=window as any;w.updaterSnapshot=initial;w.updateCalls=[];w.failCheck=false;w.installFails=false;
  w.updaterInvoke=async(command:string,args:any) => {
   w.updateCalls.push({command,args});
   if(command==='update_snapshot'&&w.frozenPollSnapshot)return structuredClone(w.frozenPollSnapshot);
   if(command==='update_check') {
    if(w.failCheck){w.updaterSnapshot={...w.updaterSnapshot,operation_id:'failed-check',revision:w.updaterSnapshot.revision+1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; body=temporarily unavailable'}};return structuredClone(w.updaterSnapshot);}
    w.updaterSnapshot={...w.updaterSnapshot,operation_id:'retry-check',revision:w.updaterSnapshot.revision+1,state:'checking',error:null};
   }
   if(command==='update_download')w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'downloading'};
   if(command==='update_install') {
    const request=args?.request;
    if(request?.operation_id!==w.updaterSnapshot.operation_id||request?.expected_revision!==w.updaterSnapshot.revision)throw {code:'UPDATE_INSTALL_REJECTED',message:`expected_revision=${request?.expected_revision}; actual_revision=${w.updaterSnapshot.revision}`};
    w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'stopping'};
   }
   return structuredClone(w.updaterSnapshot);
  };
 },{initial});
 await page.goto(`/tests/fixtures/native-updater.html?lang=${language}${query}`);
 await expect(page.getByRole('region',{name:language==='zh'?'应用更新':'Application updates',exact:true})).toBeVisible();
}
async function replace(page:Page,value:unknown) {await page.evaluate(value=>{(window as any).updaterSnapshot=value;},value);}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).updateCalls.filter((c:any)=>c.command===command),command);

test('native background check is observed through read-only polls without triggering an automatic check',async({page})=>{
 await mount(page);
 await replace(page,snapshot({operation_id:'background-check',revision:1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'background manifest HTTP 503; required=200'}}));
 await expect(page.getByRole('alert')).toContainText('background manifest HTTP 503');
 expect(await calls(page,'update_check')).toHaveLength(0);
 await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
});

test('background check failure leaves contribution intact and manual retry needs no app restart',async({page})=>{
 await mount(page);expect(await calls(page,'update_check')).toHaveLength(0);
 await page.evaluate(()=>{(window as any).failCheck=true;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('manifest HTTP 503; body=temporarily unavailable');
 await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
 await page.evaluate(()=>{(window as any).failCheck=false;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await expect(page.getByText('正在检查更新…',{exact:true})).toBeVisible();
 await replace(page,available({operation_id:'retry-check',revision:3}));await expect(page.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>(window as any).updateCalls)).every((c:any)=>c.command.startsWith('update_'))).toBe(true);
});

test('unknown bytes never imply 100 percent and download completion awaits signed verified state',async({page})=>{
 await mount(page,available({release_notes:'<img src=x onerror="window.injected=true">\nPlain release notes'}));
 const notes=page.getByRole('group',{name:'发布说明',exact:true});await notes.getByText('发布说明',{exact:true}).click();await expect(notes).toContainText('<img src=x onerror="window.injected=true">');await expect(notes.locator('img')).toHaveCount(0);
 await page.getByRole('button',{name:'下载更新',exact:true}).click();
 await replace(page,available({state:'downloading',revision:4,downloaded_bytes:123,total_bytes:null}));
 await expect(page.getByText('已接收 123 字节；总大小未知',{exact:true})).toBeVisible();
 const progress=page.getByRole('progressbar');await expect(progress).not.toHaveAttribute('value');await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('100%');
 await replace(page,available({state:'downloading',revision:5,downloaded_bytes:200,total_bytes:200}));
 await expect(page.getByText('正在下载并验证更新…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
 expect(await calls(page,'update_install')).toHaveLength(0);
 await replace(page,available({state:'verified',revision:6,downloaded_bytes:200,total_bytes:200}));
 await expect(page.getByText('更新已下载并通过签名验证',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toBeEnabled();
});

test('quit-and-install confirmation is sole install action and failed stopping state never claims success',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('可能中断正在处理的任务');await expect(dialog).not.toContainText('无任务');expect(await calls(page,'update_install')).toHaveLength(0);
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'update_install')).toHaveLength(0);
 await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).dblclick();
 await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
 expect(await calls(page,'update_install')).toEqual([{command:'update_install',args:{request:{operation_id:'update-a',expected_revision:6,confirmed:true}}}]);
 await replace(page,available({state:'failed',revision:8,error:{code:'UPDATE_EXIT_FAILED',message:'child_reaped=false; Bee remains stopped; required=true'}}));
 await expect(page.getByRole('alert')).toContainText('child_reaped=false; Bee remains stopped');
 await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('更新成功');
});

test('stale confirmation surfaces native revision evidence and cannot silently install a changed receipt',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
 // Keep the client at the confirmed receipt so this case specifically exercises
 // native rejection. A poll that already observed 7 correctly rejects locally.
 await page.evaluate(()=>{const w=window as any;w.frozenPollSnapshot=structuredClone(w.updaterSnapshot);});
 await replace(page,available({state:'verified',revision:7}));await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('expected_revision=6; actual_revision=7');expect(await calls(page,'update_install')).toHaveLength(1);
});

test('keyboard confirmation starts on cancel and returns focus after dismissal',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));
 const prepare=page.getByRole('button',{name:'安装更新…',exact:true});await prepare.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(prepare).toBeFocused();expect(await calls(page,'update_install')).toHaveLength(0);
});

test('late older poll stays blocked and exposes revision evidence',async({page})=>{
 await mount(page,available({state:'downloading',revision:10}));await replace(page,available({state:'verified',revision:9}));
 await expect(page.getByRole('alert')).toContainText('revision');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
});

test('current version says current and never invents recovery success in English',async({page})=>{
 await mount(page,snapshot({state:'current',revision:1,checked_at:'2026-10-27T01:02:03Z'}),'en');
 await expect(page.getByText('The current version is up to date',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Application updates'})).not.toContainText('success');
});

test('settings About has one version and one update action wired to the fixed native commands',async({page})=>{
 const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='bridge_status'&&value.metadata)value.metadata.bee_version='0.1.0';return value;};});
 await page.goto('/');
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('tab',{name:'关于',exact:true}).click();
 const about=page.getByRole('region',{name:'关于 Bee',exact:true});
 const update=about.getByRole('region',{name:'应用更新',exact:true});
 await expect(update.getByText('Bee 0.1.0',{exact:true})).toBeVisible();
 await expect(about.getByText('桌面应用版本',{exact:true})).toHaveCount(0);
 await expect(about.getByText('Bee 版本',{exact:true})).toHaveCount(0);
 await expect(update.getByRole('button')).toHaveCount(1);
 await expect(update.getByRole('button',{name:'检查更新',exact:true})).toBeVisible();
 await expect(about).toContainText('macOS · arm64');
 const updateCalls=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command.startsWith('update_')));
 await update.getByRole('button',{name:'检查更新',exact:true}).click();
 await expect(update.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
 const notes=update.getByRole('group',{name:'发布说明',exact:true});
 await expect(notes).not.toHaveAttribute('open');await notes.getByText('发布说明',{exact:true}).click();
 await expect(notes).toContainText('Fixture release notes');
 await update.getByRole('button',{name:'下载更新',exact:true}).click();
 const install=update.getByRole('button',{name:'安装更新…',exact:true});await expect(install).toBeVisible();
 await page.getByRole('tab',{name:'通用',exact:true}).click();
 await page.getByLabel('外观',{exact:true}).selectOption('dark'); // switching tabs and parent rerender must preserve the verified client receipt
 await page.getByRole('tab',{name:'关于',exact:true}).click();
 await install.click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(install).toBeFocused();
 expect((await updateCalls()).filter((c:any)=>c.command==='update_install')).toHaveLength(0);
 await install.click();await dialog.getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(update.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
 expect((await updateCalls()).filter((c:any)=>c.command!=='update_snapshot')).toEqual([
  {command:'update_check',args:{}},{command:'update_download',args:{}},
  {command:'update_install',args:{request:{operation_id:'fixture-update',expected_revision:2,confirmed:true}}},
 ]);
});

test('a failed install receipt can be reconciled and replaced without repeating the same install',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));
 await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=(command:string,args:unknown)=>{
  if(command==='update_install'&&!w.firstInstallFailed){w.firstInstallFailed=true;w.updateCalls.push({command,args});return Promise.reject({code:'UPDATE_DISK_SPACE',message:'available=1; required=600 bytes; no exit performed'});}
  return invoke(command,args);
 };});
 await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('available=1; required=600');
 await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
 await page.getByRole('button',{name:'重新检查更新',exact:true}).click();
 await replace(page,available({operation_id:'retry-check',revision:8}));
 await page.getByRole('button',{name:'下载更新',exact:true}).click();
 await replace(page,available({operation_id:'retry-check',state:'verified',revision:10}));
 await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
 const installs=await calls(page,'update_install');expect(installs).toHaveLength(2);
 expect(installs.map((c:any)=>c.args.request)).toEqual([
  {operation_id:'update-a',expected_revision:6,confirmed:true},
  {operation_id:'retry-check',expected_revision:10,confirmed:true},
 ]);
});

test('T9 known update failure is localized with the original evidence in the same notice',async({page})=>{
 await mount(page,snapshot({state:'failed',revision:1,error:{code:'UPDATE_SIGNATURE_FAILED',message:'signed=0.2.0; announced=0.3.0; installer not called',details:{check:'update_signature',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:'0.2.0',required:'0.3.0'}}}}));
 const alert=page.getByRole('alert');await expect(alert).toContainText('更新签名验证失败');await expect(alert).toContainText('signed=0.2.0; announced=0.3.0');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
});

test('T9 an unknown install receipt survives leaving settings and permits only reading that operation',async({page})=>{
 const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.installSubmissions=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  if(command==='update_install'){w.installSubmissions++;throw {code:'IPC_TIMEOUT',message:'installation receipt unavailable; operation=fixture-update; submission outcome unknown'};}
  return invoke(command,args);
 };});
 await page.goto('/');const nav=page.getByRole('navigation');await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
 await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('installation receipt unavailable');
 await nav.getByRole('button',{name:'概览',exact:true}).click();await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
 await expect(page.getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
 await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新检查更新',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).installSubmissions)).toBe(1);
});

test('T9 saved language and same-revision system changes synchronize native metadata without notification or runtime writes',async({page})=>{
 const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='native_locale_sync'){w.localeRequests.push(args.request);if(w.localeFails)throw {code:'NATIVE_LOCALE_MENU_FAILED',message:'native menu set_text failed: item=bee-open; actual=permission denied'};return null;}return invoke(command,args);};});
 await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
 await page.getByLabel('Language',{exact:true}).selectOption('system');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('zh');
 const revision=await page.evaluate(()=>(window as any).localeRequests.at(-1).revision);
 await page.evaluate(()=>{Object.defineProperty(navigator,'language',{configurable:true,value:'en-US'});dispatchEvent(new Event('languagechange'));});
 await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
 const metadata=await page.evaluate(()=>(window as any).localeRequests);expect(metadata.at(-1).revision).toBe(revision);expect(metadata.every((r:any,i:number)=>i===0||r.sequence>metadata[i-1].sequence)).toBe(true);
 const writes=await page.evaluate(()=>(window as any).calls.filter((c:any)=>['notification_enable','notification_retry','runtime_start','runtime_stop'].includes(c.command)));expect(writes).toEqual([]);
 await page.evaluate(()=>{(window as any).localeFails=true;});await page.getByLabel('Language',{exact:true}).selectOption('zh');await expect(page.getByRole('alert')).toContainText('native menu set_text failed');
 await page.evaluate(()=>{(window as any).localeFails=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('T9 unread preferences cannot publish a default native language and recovery reads before synchronizing',async({page})=>{
 const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
 await page.addInitScript(installAccountFixture,{accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.preferenceUnread=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='preferences_read'&&w.preferenceUnread)throw {code:'PREFERENCES_IO',message:'preference read failed: actual=permission denied'};if(command==='native_locale_sync'){w.localeRequests.push(args.request);return null;}return invoke(command,args);};});
 await page.goto('/');await expect(page.getByRole('button',{name:'重新同步原生语言',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).localeRequests)).toEqual([]);
 await page.evaluate(()=>{(window as any).preferenceUnread=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
});

for(const dismissal of ['cancel','escape'] as const)test(`T9 ${dismissal} closes an unsubmitted installation confirmation during a pending status poll`,async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'安装更新…',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pollPending=true;await new Promise<void>(resolve=>{w.releasePoll=resolve;});}return invoke(command,args);};});
 await expect.poll(()=>page.evaluate(()=>(window as any).pollPending)).toBe(true);
 if(dismissal==='cancel')await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click({timeout:1000});else await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(await calls(page,'update_install')).toHaveLength(0);
 await page.evaluate(()=>{(window as any).releasePoll();});
});

test('T9 a proven unsent install keeps the same verified update available for a new explicit confirmation',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=(command:string,args:any)=>{if(command==='update_install'&&!w.unsent){w.unsent=true;w.updateCalls.push({command,args});throw {code:'REQUEST_NOT_SENT',message:'native request not dispatched; installer not called'};}return invoke(command,args);};});
 await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();await expect(page.getByRole('alert')).toContainText('本次请求未发送');
 await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click({timeout:1000});await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();expect(await calls(page,'update_install')).toHaveLength(2);
});

test('T9 background status reads do not disable an update action between pointer down and up',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pollPending=true;await new Promise<void>(resolve=>{w.releasePoll=resolve;});}return invoke(command,args);};});
 const prepare=page.getByRole('button',{name:'安装更新…',exact:true}),box=(await prepare.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await expect.poll(()=>page.evaluate(()=>(window as any).pollPending)).toBe(true);await page.mouse.up();await expect(page.getByRole('dialog')).toBeVisible();expect(await calls(page,'update_install')).toHaveLength(0);await page.keyboard.press('Escape');await page.evaluate(()=>{(window as any).releasePoll();});
});

test('T9 StrictMode keeps one background read pending and an unmounted read cannot overwrite a new check',async({page})=>{
 await mount(page,snapshot(),'zh','&strict=1&lifecycle=1');
 expect(await calls(page,'update_snapshot')).toHaveLength(1);
 await page.evaluate(()=>{const w=window as any;w.normalInvoke=w.updaterInvoke;w.pendingReads=0;w.updaterInvoke=async(command:string,args:any)=>{if(command==='update_snapshot'){w.pendingReads++;return new Promise((_resolve,reject)=>{w.rejectOldPoll=reject;});}return w.normalInvoke(command,args);};});
 await expect.poll(()=>page.evaluate(()=>(window as any).pendingReads)).toBe(1);
 await page.waitForTimeout(260);expect(await page.evaluate(()=>(window as any).pendingReads)).toBe(1);
 await page.getByRole('button',{name:'切换更新控件',exact:true}).click();
 await page.evaluate(()=>{const w=window as any;w.updaterInvoke=w.normalInvoke;});
 await page.getByRole('button',{name:'切换更新控件',exact:true}).click();
 await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByText('正在检查更新…',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).rejectOldPoll({code:'UPDATE_CHECK_FAILED',message:'old unmounted read failed'});});
 await expect.poll(async()=>(await calls(page,'update_snapshot')).length).toBeGreaterThan(3);
 await expect(page.getByRole('alert')).toHaveCount(0);expect(await calls(page,'update_check')).toHaveLength(1);
});
