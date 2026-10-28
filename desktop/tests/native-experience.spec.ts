import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';

const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((call:any)=>call.command===command),command);
const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
async function setup(page:Page){
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.clock.install();await page.goto('/');
 await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
}
async function completeReport(page:Page){
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();await page.clock.runFor(900);
 await expect(page.getByText('检查已完成',{exact:false})).toBeVisible();
}

test('four native pages share one poller; diagnostics starts only on click and survives navigation',async({page})=>{
 await setup(page);expect(await page.getByRole('navigation').getByRole('button').allTextContents()).toEqual(['概览','AI 账号','诊断','设置']);
 const before=await calls(page,'runtime_snapshot');
 for(const name of ['AI 账号','诊断','设置','概览','诊断'])await nav(page,name).click();
 await expect(page.getByText('尚未运行诊断',{exact:true})).toBeVisible();expect(await calls(page,'diagnostics_start')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);
 expect((await calls(page,'runtime_snapshot')).length).toBe(before.length);
 await completeReport(page);const diagnosticReads=(await calls(page,'diagnostics_snapshot')).length;
 await nav(page,'AI 账号').click();await nav(page,'概览').click();await nav(page,'诊断').click();
 await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();expect((await calls(page,'diagnostics_start')).length).toBe(1);expect((await calls(page,'diagnostics_snapshot')).length).toBe(diagnosticReads);
 const writes=await page.evaluate(()=>(window as any).calls.filter((call:any)=>/^(runtime_start|runtime_stop|account_action|authorize_start|supply_set_paused)$/.test(call.command)));expect(writes).toEqual([]);
 await expect(page.getByRole('button',{name:'收益',exact:true})).toHaveCount(0);await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
});

test('safe logs load manually with module/platform/level filters and native cursors',async({page})=>{
 await setup(page);await nav(page,'诊断').click();
 await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
 expect(await calls(page,'diagnostic_logs')).toEqual([]);
 await page.getByRole('button',{name:'刷新日志',exact:true}).click();
 await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');
 expect((await calls(page,'diagnostic_logs'))[0].args).toEqual({query:{cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'}});
 await page.getByRole('button',{name:'加载更多日志',exact:true}).click();
 expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);
});

test('management startup failure keeps safe native logs accessible without enabling diagnostics',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>command==='bridge_status'?Promise.resolve({state:'failed',error:{code:'SIDECAR_EXIT',message:'owned management child exited: status=1'}}):invoke(command,args);});
 await page.goto('/');await expect(page.getByText('SIDECAR_EXIT: owned management child exited: status=1',{exact:true})).toBeVisible();
 await nav(page,'诊断').click();await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');
 expect((await calls(page,'diagnostic_logs')).length).toBe(1);expect(await calls(page,'diagnostics_start')).toEqual([]);
});

test('failed preference save keeps the saved appearance; recovery and English copy stay usable',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.evaluate(()=>{(window as any).preferencesFail=true;});
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(page.getByRole('alert')).toContainText('PREFERENCES_WRITE_FAILED');await expect(page.getByLabel('外观',{exact:true})).toHaveValue('system');
 expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
 await page.evaluate(()=>{(window as any).preferencesFail=false;});await page.getByRole('button',{name:'重新读取偏好',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByLabel('语言',{exact:true}).selectOption('en');await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 await expect(page.getByText('Saved for this system user and retained after restarting.',{exact:true})).toBeVisible();
 await nav(page,'Diagnostics').click();await expect(page.getByRole('button',{name:'Run diagnostics',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});

test('Hive entry asks native code to open only the saved origin root without frontend URL input',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).click();
 expect(await calls(page,'hive_open')).toEqual([{command:'hive_open',args:{}}]);expect(await page.evaluate(()=>(window as any).openedHive)).toBe('https://hive.example/');
});

for(const outcome of ['success','failure'])test(`late Hive open ${outcome} from the previous instance cannot refresh the new owner`,async({page})=>{
 await setup(page);await page.clock.pauseAt(new Date());
 await page.evaluate((outcome:string)=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{if(command!=='hive_open')return invoke(command,args);const result=await invoke(command,args);w.oldHiveStarted=true;return new Promise((resolve,reject)=>{w.finishOldHive=()=>outcome==='success'?resolve(result):reject(new Error('HIVE_OPEN_FAILED: old instance result arrived after replacement'));});};},outcome);
 await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).oldHiveStarted)).toBe(true);
 const before=await page.evaluate(()=>{const w=window as any;w.emit('d'.repeat(32));return w.runtimeReadCount;});await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);
 await expect(page.getByRole('button',{name:'重新核对运行状态',exact:true})).toBeEnabled();
 const reads=await page.evaluate(()=>{const w=window as any;w.finishOldHive();return w.runtimeReadCount;});await page.clock.runFor(1);
 expect(await page.evaluate(()=>(window as any).runtimeReadCount)).toBe(reads);await expect(page.getByText(/HIVE_OPEN_FAILED/)).toHaveCount(0);
});

test('notification delivery failures stay visible and retry requires an explicit action',async({page})=>{
 await setup(page);await page.evaluate(()=>{const w=window as any;w.notificationPermission='granted';w.notificationDeliveryError={code:'NOTIFICATION_NATIVE',message:'native notification rejected: os_code=13'};});
 await nav(page,'设置').click();await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
 expect(await calls(page,'notification_retry')).toEqual([]);expect(await calls(page,'notification_enable')).toEqual([]);
 await page.getByLabel('希望接收系统通知',{exact:true}).check();
 await page.getByRole('button',{name:'重试失败的通知',exact:true}).click();
 expect(await calls(page,'notification_retry')).toEqual([{command:'notification_retry',args:{}}]);
 await expect(page.getByRole('status')).toContainText('将在下次后台检查时重试明确失败的通知');
 await nav(page,'概览').click();await nav(page,'设置').click();
 expect((await calls(page,'notification_retry')).length).toBe(1);await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
});

for(const outcome of ['success','failure'])test(`a delayed initial preference ${outcome} cannot roll back a newer saved appearance`,async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript((outcome:string)=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke,releases:Array<()=>void>=[];
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='preferences_read')return new Promise((resolve,reject)=>releases.push(()=>outcome==='failure'?reject(new Error('PREFERENCES_IO: earlier read failed: os_code=13')):resolve(value)));return value;};
  w.releasePreferences=()=>{for(const release of releases.splice(0))release();};
 },outcome);
 await page.goto('/');await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
 await nav(page,'设置').click();await page.getByLabel('外观',{exact:true}).selectOption('dark');await expect(page.getByRole('status')).toHaveText('偏好已保存。');
 await page.evaluate(()=>{(window as any).releasePreferences();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await nav(page,'概览').click();await nav(page,'设置').click();
 await expect(page.getByLabel('外观',{exact:true})).toHaveValue('dark');expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('export confirms scope and waits for matched native success/failure/unknown receipts',async({page})=>{
 await setup(page);await completeReport(page);
 await page.evaluate(()=>{
  const w=window as any;w.downloads=[];w.exportBlobs=new Map();const create=URL.createObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);w.exportBlobs.set(url,blob);return url;};
  HTMLAnchorElement.prototype.click=function(){w.downloads.push({url:this.href,filename:this.download,subscribed:w.downloadListenerCount()>0});};
 });
 const exportButton=page.getByRole('button',{name:'导出脱敏报告',exact:true});await exportButton.click();
 const dialog=page.getByRole('dialog',{name:'选择导出范围'});await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'diagnostics_export')).toEqual([]);
 await exportButton.click();await dialog.getByLabel('本次检查结果与安全日志',{exact:true}).check();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('正在等待报告下载结果');
 const first=await page.evaluate(()=>(window as any).downloads[0]);expect(first.filename).toBe('bee-diagnostics.json');expect(first.subscribed).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.emitDownload('blob:unrelated',true);});await expect(exportButton).toBeDisabled();
 await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[0].url,false);});await expect(page.getByRole('alert')).toContainText('success=false');await expect(page.getByRole('alert')).not.toContainText('blob:');
 await exportButton.click();await dialog.getByLabel('仅本次检查结果',{exact:true}).check();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).downloads.length)).toBe(2);
 await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[1].url,true);});await expect(page.getByRole('status')).toHaveText('脱敏报告已下载。');
 const saved=await page.evaluate(async()=>{const w=window as any;return JSON.parse(await w.exportBlobs.get(w.downloads[1].url).text());});expect(saved.product).toBe('Bee');expect(saved.logs).toEqual([]);
 await exportButton.click();await dialog.getByRole('button',{name:'确认导出',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).downloads.length)).toBe(3);await page.clock.runFor(30001);
 await expect(page.getByRole('status')).toContainText('下载结果未确认');expect(await page.evaluate(()=>(window as any).downloadListenerCount())).toBe(0);
 await page.evaluate(()=>{const w=window as any;w.emitDownload(w.downloads[2].url,true);});await expect(page.getByRole('status')).toContainText('下载结果未确认');
});

test('new management instance discards a pending diagnostic from the previous instance',async({page})=>{
 await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{(window as any).diagnosticDelay=1500;});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();await expect.poll(async()=>(await calls(page,'diagnostics_start')).length).toBe(1);
 await page.evaluate(()=>{(window as any).emit('d'.repeat(32));});await page.clock.runFor(1600);
 await expect(page.getByText('Hive 身份已核对',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeEnabled();expect((await calls(page,'diagnostics_start')).length).toBe(1);
});
