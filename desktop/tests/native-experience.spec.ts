import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';

const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((call:any)=>call.command===command),command);
const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const tab=(page:Page,name:string)=>page.getByRole('tab',{name,exact:true});
async function expectPrimaryContrast(page:Page,selector:string){
 const button=page.locator(selector);await button.hover();
 const contrast=await button.evaluate(element=>{
  const style=getComputedStyle(element),luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });expect(contrast).toBeGreaterThanOrEqual(4.5);
}
async function setup(page:Page){
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.clock.install();await page.goto('/');
 await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
}
async function completeReport(page:Page){
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 await page.getByTestId('passed-checks').locator(':scope > summary').click();await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();await page.clock.runFor(900);
 await expect(page.getByText('检查已完成',{exact:false})).toBeVisible();
}

test('four native pages share one poller; diagnostics starts only on click and survives navigation',async({page})=>{
 await setup(page);expect(await page.getByRole('navigation').getByRole('button').allTextContents()).toEqual(['概览','AI 账号','诊断','设置']);
 await nav(page,'AI 账号').click();await expect.poll(async()=>(await calls(page,'account_detect')).length).toBe(2);await expect(page.getByRole('button',{name:'OpenAI 详情',exact:true})).toBeEnabled();
 await nav(page,'概览').click();const before=await calls(page,'runtime_snapshot');
 for(const name of ['AI 账号','诊断','设置','概览','诊断'])await nav(page,name).click();
 await expect(page.getByText('尚未运行诊断',{exact:true})).toBeVisible();expect(await calls(page,'diagnostics_start')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);
 expect((await calls(page,'runtime_snapshot')).length).toBe(before.length);
 await completeReport(page);const diagnosticReads=(await calls(page,'diagnostics_snapshot')).length;
 await nav(page,'AI 账号').click();await nav(page,'概览').click();await nav(page,'诊断').click();
 await page.getByTestId('passed-checks').locator(':scope > summary').click();await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();expect((await calls(page,'diagnostics_start')).length).toBe(1);expect((await calls(page,'diagnostics_snapshot')).length).toBe(diagnosticReads);
 const writes=await page.evaluate(()=>(window as any).calls.filter((call:any)=>/^(runtime_start|runtime_stop|account_action|authorize_start|supply_set_paused)$/.test(call.command)));expect(writes).toEqual([]);
 await expect(page.getByRole('button',{name:'收益',exact:true})).toHaveCount(0);await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
});

test('safe logs load manually with module/platform/level filters and native cursors',async({page})=>{
 await setup(page);await nav(page,'诊断').click();await tab(page,'安全日志').click();
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
 await page.goto('/');await expect(page.getByRole('alert')).toHaveCount(1);const failure=page.getByTestId('startup-recovery');await expect(failure).toContainText('SIDECAR_EXIT');await failure.getByText('错误详情',{exact:true}).click();await expect(failure).toContainText('owned management child exited: status=1');
 await nav(page,'诊断').click();await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeDisabled();
 await tab(page,'安全日志').click();await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');
 expect((await calls(page,'diagnostic_logs')).length).toBe(1);expect(await calls(page,'diagnostics_start')).toEqual([]);
});

test('failed preference save keeps the saved appearance; recovery and English copy stay usable',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通用').click();await page.evaluate(()=>{(window as any).preferencesFail=true;});
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
 await setup(page);await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
 await page.evaluate((outcome:string)=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{if(command!=='hive_open')return invoke(command,args);const result=await invoke(command,args);w.oldHiveStarted=true;return new Promise((resolve,reject)=>{w.finishOldHive=()=>outcome==='success'?resolve(result):reject(new Error('HIVE_OPEN_FAILED: old instance result arrived after replacement'));});};},outcome);
 await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).oldHiveStarted)).toBe(true);
 const before=await page.evaluate(()=>{const w=window as any;w.emit('d'.repeat(32));return w.runtimeReadCount;});await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);
 await expect(page.getByRole('button',{name:'重新核对设备',exact:true})).toBeEnabled();
 const reads=await page.evaluate(()=>{const w=window as any;w.finishOldHive();return w.runtimeReadCount;});await page.clock.runFor(1);
 expect(await page.evaluate(()=>(window as any).runtimeReadCount)).toBe(reads);await expect(page.getByText(/HIVE_OPEN_FAILED/)).toHaveCount(0);
});

test('notification delivery failures stay visible and retry requires an explicit action',async({page})=>{
 await setup(page);await page.evaluate(()=>{const w=window as any;w.notificationPermission='granted';w.notificationRetryableCount=1;w.notificationDeliveryError={code:'NOTIFICATION_NATIVE',message:'native notification rejected: os_code=13'};});
 await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
 expect(await calls(page,'notification_retry')).toEqual([]);expect(await calls(page,'notification_enable')).toEqual([]);
 await page.getByLabel('接收系统通知',{exact:true}).check();
 await page.getByRole('button',{name:'重试失败的通知',exact:true}).click();
 expect(await calls(page,'notification_retry')).toEqual([{command:'notification_retry',args:{}}]);
 await expect(page.getByTestId('notification-retry-result')).toContainText('重试请求已接受');
 await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通知与启动').click();
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
 await nav(page,'设置').click();await tab(page,'通用').click();await page.getByLabel('外观',{exact:true}).selectOption('dark');await expect(page.getByRole('status')).toHaveText('偏好已保存。');
 await page.evaluate(()=>{(window as any).releasePreferences();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通用').click();
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

test('diagnostic tabs keep reads explicit and preserve the running report',async({page})=>{
 await setup(page);await nav(page,'诊断').click();
 await expect(tab(page,'检查结果')).toHaveAttribute('aria-selected','true');
 await tab(page,'安全日志').click();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeVisible();
 await tab(page,'检查结果').click();expect(await calls(page,'diagnostics_start')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);
 await page.evaluate(()=>{(window as any).diagnosticsStayRunning=true;});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 await tab(page,'安全日志').click();await tab(page,'检查结果').click();
 expect((await calls(page,'diagnostics_start')).length).toBe(1);
 await page.clock.runFor(1700);expect((await calls(page,'diagnostics_snapshot')).length).toBe(2);
 await page.getByRole('button',{name:'取消诊断',exact:true}).click();
 await expect(page.getByText('诊断已取消',{exact:true})).toBeVisible();
 await expect(page.getByText('全部检查通过',{exact:true})).toHaveCount(0);
 expect(await calls(page,'diagnostic_logs')).toEqual([]);
});

test('settings categories preserve the proxy draft and test result without querying the OS again',async({page})=>{
 await setup(page);await nav(page,'设置').click();
 await expect(tab(page,'网络与代理')).toHaveAttribute('aria-selected','true');
 expect(await page.getByRole('tab').allTextContents()).toEqual(['通用','网络与代理','通知与启动','关于']);
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7900');
 await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.locator('.ns-test')).toContainText('read-only endpoint reachable');
 const reads=()=>page.evaluate(()=>(window as any).calls.filter((call:any)=>/^(network_snapshot|notification_permission|autostart_status|notification_delivery_status)$/.test(call.command)));
 const before=await reads();
 await tab(page,'通用').click();await tab(page,'通知与启动').click();await tab(page,'关于').click();
 await expect(page.getByRole('heading',{name:'Bee 0.1.0',exact:true})).toBeVisible();await expect(page.locator('.ns-core-version')).toContainText('dev');
 await tab(page,'网络与代理').click();
 await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7900');await expect(page.locator('.ns-test')).toContainText('read-only endpoint reachable');
 expect(await reads()).toEqual(before);expect(await calls(page,'notification_enable')).toEqual([]);expect(await calls(page,'autostart_set')).toEqual([]);expect(await calls(page,'network_save_proxy')).toEqual([]);
});

test('settings device replacement offers overview navigation without replaying the proxy write',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   if(command!=='network_save_proxy')return invoke(command,args);
   w.calls.push({command,args});
   throw {code:'device_replaced',message:'device credential revoked after replacement',details:{check:'device_identity',observed_at:new Date().toISOString(),evidence:{http_status:'401',remote_code:'device_replaced',path:'/api/bee/identity',target_origin:'https://hive.example'}}};
  };
 });
 await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7900');
 await page.getByRole('button',{name:'保存代理',exact:true}).click();
 const failure=page.getByRole('alert');await expect(failure).toContainText('此设备已被替换，原设备凭据已撤销。');
 expect((await calls(page,'network_save_proxy')).length).toBe(1);
 const viewDevice=failure.getByRole('button',{name:'查看设备',exact:true});await expect(viewDevice).toBeVisible();await viewDevice.click();
 await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeVisible();await expect(page.getByTestId('native-settings')).toHaveCount(0);
 await page.clock.runFor(10000);expect((await calls(page,'network_save_proxy')).length).toBe(1);
 expect(await calls(page,'network_apply_saved')).toEqual([]);
});

test('problem-first sections retain every platform reason and its original safe evidence',async({page})=>{
 await setup(page);await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const reply=await invoke(command,args);if(command!=='diagnostics_start')return reply;
   const report=reply.result.report,check=(id:string,platform:string|null,status:string,code:string,next_action='accounts')=>({id,platform,status,code,next_action,observed_at:report.started_at,evidence:{http_status:'409'}});
   report.state='completed';report.finished_at=report.started_at;report.checks=[
    check('proxy',null,'fail','connection_failed','settings'),check('authorization','openai','fail','authorization_expired'),
    check('quota','openai','warning','quota_exhausted'),check('account','claude','fail','account_changed'),
    check('source','claude','skipped','source_not_selected'),check('hive',null,'pass','hive_identity_verified','diagnostics')
   ];return reply;
  };
 });
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 const issues=page.locator('.nd-issues');await expect(issues.locator('li')).toHaveCount(4);
 await expect(issues.getByText('官方授权已失效',{exact:true})).toBeVisible();await expect(issues.getByText('订阅额度已耗尽',{exact:true})).toBeVisible();await expect(issues.getByText('账号在检查期间发生变化',{exact:true})).toBeVisible();
 await issues.locator('li').first().locator('summary').click();await expect(issues.locator('li').first()).toContainText('connection_failed');await expect(issues.locator('dd').first()).toHaveText('409');
 await page.getByTestId('unfinished-checks').locator(':scope > summary').click();await page.getByTestId('passed-checks').locator(':scope > summary').click();
 await expect(page.locator('.nd-checks>li')).toHaveCount(6);await expect(page.getByText('尚未选择此平台的账号',{exact:true})).toBeVisible();await expect(page.getByText('Hive 身份已核对',{exact:true})).toBeVisible();await expect(page.getByText('全部检查通过',{exact:true})).toHaveCount(0);
 await issues.getByRole('button',{name:'查看设置',exact:true}).click();await expect(tab(page,'网络与代理')).toHaveAttribute('aria-selected','true');
});

for(const scenario of ['empty','skipped','cancelled','passed','unknown'] as const)test(`diagnostic summary distinguishes ${scenario} reports`,async({page})=>{
 await setup(page);await page.evaluate(scenario=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const reply=await invoke(command,args);if(command!=='diagnostics_start')return reply;
   const report=reply.result.report;report.state=scenario==='cancelled'?'cancelled':'completed';report.finished_at=report.started_at;
   report.checks=scenario==='empty'?[]:scenario==='skipped'?[report.checks[1]]:[report.checks[0]];
   if(scenario==='unknown')report.checks=[{...report.checks[0],status:'skipped',code:'not_checked'}];return reply;
  };
 },scenario);
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 await expect(page.getByText(scenario==='cancelled'?'诊断已取消':'检查已完成',{exact:true})).toBeVisible();
 await expect(page.getByText('全部检查通过',{exact:true})).toHaveCount(scenario==='passed'?1:0);
 await expect(page.locator('.nd-checks>li')).toHaveCount(scenario==='empty'?0:1);
});

test('log filters distinguish unread and empty and reject a late result from an older filter',async({page})=>{
 await setup(page);await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let reads=0;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const reply=await invoke(command,args);if(command!=='diagnostic_logs')return reply;
   if(++reads===1)return new Promise(resolve=>{w.releaseLogs=()=>resolve(reply);});
   return {entries:[],next_cursor:null,truncated:false};
  };
 });
 await nav(page,'诊断').click();await tab(page,'安全日志').click();
 await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect.poll(async()=>(await calls(page,'diagnostic_logs')).length).toBe(1);
 await page.getByLabel(/^模块/).selectOption('network');await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).releaseLogs();});await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
 await expect(page.locator('.nd-log-list li')).toHaveCount(0);
 await page.getByLabel(/^平台/).selectOption('claude');await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();expect((await calls(page,'diagnostic_logs')).length).toBe(2);
});

test('older initial network observation cannot replace an explicit refresh or an edited proxy',async({page})=>{
 await setup(page);await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let reads=0;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const reply=await invoke(command,args);if(command!=='network_snapshot'||++reads!==1)return reply;
   return new Promise(resolve=>{w.releaseNetwork=()=>resolve({...reply,saved_proxy:'http://127.0.0.1:7801',effective_proxy:'http://127.0.0.1:7801'});});
  };
 });
 await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7900');
 await page.getByRole('button',{name:'刷新生效路径',exact:true}).click();await expect(page.locator('.ns-network-summary')).toContainText('代理未启用');
 await page.evaluate(()=>{(window as any).releaseNetwork();});await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7900');await expect(page.locator('.ns-network-summary')).not.toContainText('7801');
});

test('denied notifications and unknown autostart remain distinct without requesting OS changes',async({page})=>{
 await setup(page);await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const value=await invoke(command,args);if(command==='notification_permission')return 'denied';
   if(command==='autostart_status')return {desired:false,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'OS registry query failed: os_code=13'}};return value;
  };
 });
 await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.locator('.ns-os-status').first()).toContainText('已拒绝');await expect(page.locator('.ns-os-status').last()).toContainText('尚未确认');await expect(page.getByRole('alert')).toContainText('os_code=13');
 await tab(page,'关于').click();await tab(page,'通知与启动').click();expect(await calls(page,'notification_enable')).toEqual([]);expect(await calls(page,'autostart_set')).toEqual([]);
});

test('about shows a missing Bee version as unread while retaining the real build version',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>command==='bridge_status'?Promise.resolve({state:'failed',error:{code:'SIDECAR_EXIT',message:'owned management child exited: status=1'}}):invoke(command,args);});
 await page.goto('/');await nav(page,'设置').click();await tab(page,'关于').click();
 await expect(page.locator('.ns-core-version')).toContainText('尚未读取');await expect(page.getByRole('heading',{name:'Bee 0.1.0',exact:true})).toBeVisible();
});

for(const [width,height,language,theme] of [[1440,1000,'zh','light'],[1440,1000,'en','dark'],[860,600,'en','light'],[860,600,'zh','dark']] as const)test(`S2 tabs, dialogs and narrow layout remain usable at ${width} ${language} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);await nav(page,'设置').click();await tab(page,'通用').click();await page.getByLabel('外观',{exact:true}).selectOption(theme);await page.getByLabel('语言',{exact:true}).selectOption(language);
 const en=language==='en',networkTab=tab(page,en?'Network and proxy':'网络与代理');await expect(page.getByRole('status')).toHaveText(en?'Preferences saved.':'偏好已保存。');await networkTab.focus();await page.keyboard.press('End');await expect(tab(page,en?'About':'关于')).toHaveAttribute('aria-selected','true');await page.keyboard.press('Home');await expect(tab(page,en?'General':'通用')).toHaveAttribute('aria-selected','true');await page.keyboard.press('ArrowRight');await expect(networkTab).toHaveAttribute('aria-selected','true');
 const proxy=page.getByLabel(en?'Local HTTP proxy':'本机 HTTP 代理',{exact:true});await proxy.fill('http://127.0.0.1:7900');await expectPrimaryContrast(page,'.ns-network-actions .primary');await page.getByRole('button',{name:en?'Save proxy':'保存代理',exact:true}).click();
 await expect(page.locator('.ns-network-summary')).toContainText(en?'Proxy disabled':'代理未启用');
 const restart=page.getByRole('button',{name:en?'Stop and restart to apply':'停止并重新启动以应用',exact:true});await restart.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(restart).toBeFocused();expect(await calls(page,'network_apply_saved')).toEqual([]);
 const networkShot=`settings-network-${theme}${en?'-en':''}-${width}`;await page.screenshot({path:`../.cache/s2-ui-verification/${networkShot}.png`});
 if(en&&width===1440){await page.setViewportSize({width:860,height:600});await page.screenshot({path:'../.cache/s2-ui-verification/settings-network-dark-en-860.png'});await page.locator('.ns-observed').scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/s2-ui-verification/settings-paths-dark-en-860.png'});await page.setViewportSize({width,height});}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await nav(page,en?'Diagnostics':'诊断').click();const checks=tab(page,en?'Check results':'检查结果');await checks.focus();await page.keyboard.press('ArrowRight');await expect(tab(page,en?'Safe logs':'安全日志')).toHaveAttribute('aria-selected','true');await page.keyboard.press('ArrowLeft');await expect(checks).toHaveAttribute('aria-selected','true');
 await expectPrimaryContrast(page,'.nd-actions .primary');await page.getByRole('button',{name:en?'Run diagnostics':'运行诊断',exact:true}).click();const exportButton=page.getByRole('button',{name:en?'Export sanitized report':'导出脱敏报告',exact:true});await exportButton.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(exportButton).toBeFocused();
 expect(await calls(page,'diagnostics_export')).toEqual([]);expect(await calls(page,'diagnostic_logs')).toEqual([]);expect(await calls(page,'notification_enable')).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await tab(page,en?'Safe logs':'安全日志').click();await page.getByRole('button',{name:en?'Refresh logs':'刷新日志',exact:true}).click();await expect(page.locator('.nd-log-list li')).toHaveCount(1);
 if(en)await page.setViewportSize({width:860,height:600});
 const logBounds=await page.locator('.nd-log-list li').first().evaluate(row=>{const range=document.createRange();range.selectNodeContents(row.querySelector('.nd-log-level')!);return {levelRight:range.getBoundingClientRect().right,codeLeft:row.querySelector('strong')!.getBoundingClientRect().left};});expect(logBounds.levelRight).toBeLessThanOrEqual(logBounds.codeLeft);
 if(en)await page.screenshot({path:`../.cache/s2-ui-verification/logs-${theme}-en-860.png`});
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});

test('T8 original report read pauses after one failure and explicit reread completes without another start',async({page})=>{
 await setup(page);await nav(page,'诊断').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let failed=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='diagnostics_snapshot'&&!failed){failed=true;w.calls.push({command,args});throw {code:'IPC_TIMEOUT',message:'snapshot read timed out: report retained'};}return invoke(command,args);};});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.clock.runFor(900);
 await expect(page.getByText('报告读取已暂停，已返回的检查仍保留。',{exact:true})).toBeVisible();
 await expect(page.locator('.nd-report-meta')).toBeVisible();await page.clock.runFor(5000);expect((await calls(page,'diagnostics_snapshot')).length).toBe(1);
 await page.getByRole('button',{name:'重新读取原报告',exact:true}).click();await expect(page.getByText('检查已完成',{exact:true})).toBeVisible();
 expect((await calls(page,'diagnostics_start')).length).toBe(1);const reads=await calls(page,'diagnostics_snapshot');expect(new Set(reads.map((c:any)=>c.args.id)).size).toBe(1);
 await page.clock.runFor(5000);expect((await calls(page,'diagnostics_snapshot')).length).toBe(2);
});
test('T8 lost start receipt remains unknown across all pages and only logs are available without an ID',async({page})=>{
 await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='diagnostics_start')throw {code:'IPC_TIMEOUT',message:'start accepted; reply unavailable'};return result;};});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();
 for(const destination of ['概览','设置','AI 账号']){await nav(page,destination).click();await nav(page,'诊断').click();}
 await expect(page.getByText('诊断开始结果尚未确认；没有报告 ID，不能重新开始或查询原报告。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeDisabled();
 expect(await calls(page,'diagnostics_snapshot')).toEqual([]);expect((await calls(page,'diagnostics_start')).length).toBe(1);
 await tab(page,'安全日志').click();await page.getByRole('button',{name:'刷新日志',exact:true}).click();await expect(page.getByTestId('native-diagnostic-logs')).toBeVisible();
});
test('T8 lost cancel receipt is checked by original report reads across navigation',async({page})=>{
 await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.diagnosticsStayRunning=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='diagnostics_cancel')throw {code:'IPC_TIMEOUT',message:'cancel accepted; reply unavailable'};return result;};});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.getByRole('button',{name:'取消诊断',exact:true}).click();
 await nav(page,'设置').click();await nav(page,'诊断').click();await expect(page.getByText('取消结果尚未确认；仅核对原报告，不会重复取消。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'取消诊断',exact:true})).toBeDisabled();await page.getByRole('button',{name:'重新读取原报告',exact:true}).click();
 await expect(page.getByText('诊断已取消',{exact:true})).toBeVisible();expect((await calls(page,'diagnostics_cancel')).length).toBe(1);expect((await calls(page,'diagnostics_start')).length).toBe(1);
});
test('T8 saved proxy survives a failed network read and is never reported as a failed save',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let saved=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='network_snapshot'&&saved){w.calls.push({command,args});throw {code:'NETWORK_RUNTIME_UNCONFIRMED',message:'network read unavailable after preference saved'};}const value=await invoke(command,args);if(command==='network_save_proxy')saved=true;return value;};});
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18381');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 await expect(page.getByText('代理配置已保存；生效状态尚未确认。',{exact:true})).toBeVisible();await expect(page.locator('.ns-network-summary')).toContainText('http://127.0.0.1:18381');
 await nav(page,'概览').click();await nav(page,'设置').click();await expect(page.getByText('代理配置已保存；生效状态尚未确认。',{exact:true})).toBeVisible();expect((await calls(page,'network_save_proxy')).length).toBe(1);
});
test('T8 unknown network apply preserves the draft and only rereads network and runtime after navigation',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18382');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='network_apply_saved')throw {code:'IPC_TIMEOUT',message:'apply accepted; reply lost'};return result;};});
 await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();
 await expect(page.getByText('应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。',{exact:true})).toBeVisible();
 for(const destination of ['诊断','AI 账号','概览']){await nav(page,destination).click();await nav(page,'设置').click();}
 await expect(page.getByText('应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。',{exact:true})).toBeVisible();await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:18382');
 await page.getByRole('button',{name:'刷新生效路径',exact:true}).click();expect((await calls(page,'network_apply_saved')).length).toBe(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});
test('T8 denied notification keeps the saved preference and gives the actual OS settings location',async({page})=>{
 await setup(page);await page.evaluate(()=>{(window as any).notificationPermission='denied';});await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.getByLabel(/^(希望接收系统通知|接收系统通知)$/).check();await expect(page.getByLabel(/^(希望接收系统通知|接收系统通知)$/)).toBeChecked();await expect(page.getByText('已拒绝',{exact:true})).toBeVisible();
 await expect(page.getByText('在 macOS“系统设置 → 通知 → Bee”中允许通知。应用内提醒会继续显示。',{exact:true})).toBeVisible();expect((await calls(page,'notification_enable')).length).toBe(1);
});
test('T8 autostart read failure retains the desired choice and actual registration receipt',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let changed=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='preferences_read'&&changed)throw {code:'PREFERENCES_READ_FAILED',message:'preferences read failed after autostart receipt'};const value=await invoke(command,args);if(command==='autostart_set')changed=true;return value;};});
 await page.getByLabel(/^(登录桌面后启动 Bee|登录系统后启动 Bee)$/).check();await expect(page.getByLabel(/^(登录桌面后启动 Bee|登录系统后启动 Bee)$/)).toBeChecked();await expect(page.getByText('已登记',{exact:true})).toBeVisible();
 await expect(page.getByText('系统登记回执已保留，偏好读取尚未确认。',{exact:true})).toBeVisible();await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.getByLabel(/^(登录桌面后启动 Bee|登录系统后启动 Bee)$/)).toBeChecked();expect((await calls(page,'autostart_set')).length).toBe(1);
});


for(const reason of ['device_replaced','invalid_device_credential'])test('T8 diagnostic local binding and revoked Hive identity remain separate concrete facts: '+reason,async({page})=>{
 await setup(page);await page.clock.runFor(100);await page.evaluate(reason=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='diagnostics_start'){const r=value.result.report;r.state='completed';r.finished_at=r.started_at;r.checks=[{id:'device',platform:null,status:'pass',code:'device_binding_valid',observed_at:r.started_at,evidence:{},next_action:'diagnostics'},{id:'hive',platform:null,status:'fail',code:reason==='device_replaced'?reason:'http_rejected',observed_at:r.started_at,evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:reason},next_action:'diagnostics'}];}return value;};},reason);
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.getByTestId('passed-checks').locator(':scope > summary').click();
 await expect(page.getByText('本机绑定信息完整；远端身份需单独核对。',{exact:true})).toBeVisible();const check=page.locator('.nd-issues [data-nav-section="connection"]');await expect(check).toContainText(reason==='device_replaced'?'此设备已被替换，原设备凭据已撤销。':'Hive 已拒绝此设备凭据。');
 await check.getByRole('button',{name:'查看概览',exact:true}).click();await expect(page.locator('[data-nav-section="device"]')).toBeFocused();await expect(page.getByRole('button',{name:'重新绑定设备',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'返回原处',exact:true}).click();await expect(check).toBeFocused();expect((await calls(page,'diagnostics_start')).length).toBe(1);
 for(const command of ['device_recovery_prepare','device_recovery_confirm','runtime_start','account_action','device_begin'])expect((await calls(page,command)).length).toBe(0);
});

test('T8 confirmed proxy save never selects an older device scope when its network read fails',async({page})=>{
 await setup(page);await nav(page,'设置').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let saved=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='network_snapshot'&&saved){w.calls.push({command,args});throw {code:'NETWORK_RUNTIME_UNCONFIRMED',message:'network observation unavailable after current-device save'};}const value=await invoke(command,args);if(command==='network_save_proxy'){saved=true;value.preferences.proxies.unshift({origin:'https://hive.example',device_scope:'previous-device',connect_proxy:'http://127.0.0.1:17001'});}return value;};});
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18389');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 const saved=page.locator('.ns-network-summary>div').first();await expect(saved).toContainText('http://127.0.0.1:18389');await expect(saved).not.toContainText('17001');
 await nav(page,'概览').click();await nav(page,'设置').click();await expect(saved).toContainText('http://127.0.0.1:18389');expect((await calls(page,'network_save_proxy')).length).toBe(1);
});

test('T8 unknown proxy save permits a new explicit save only after current scoped reads succeed',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let lost=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_save_proxy'&&!lost){lost=true;throw {code:'IPC_TIMEOUT',message:'save accepted; receipt lost'};}return value;};});
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18391');const save=page.getByRole('button',{name:'保存代理',exact:true});await save.click();await expect(save).toBeDisabled();
 await page.getByRole('button',{name:'核对当前保存配置',exact:true}).click();await expect(save).toBeEnabled();expect((await calls(page,'network_save_proxy')).length).toBe(1);
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18392');await save.click();await expect(page.locator('.ns-network-summary')).toContainText('18392');expect((await calls(page,'network_save_proxy')).length).toBe(2);
});

test('T8 restore failure preserves the applied network and the separate stopped runtime',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18393');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_apply_saved')value.error={code:'RUNTIME_OPERATION_FAILED',message:'restore failed: local=stopped; intended=running',details:{check:'network_restore',observed_at:new Date().toISOString(),evidence:{}}};return value;};});
 await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();
 await expect(page.getByText('网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();await expect(page.locator('.ns-network-summary>div').last()).toContainText('18393');await expect(page.getByText('当前贡献进程：已停止',{exact:true})).toBeVisible();
 await nav(page,'概览').click();await nav(page,'设置').click();await expect(page.getByText('网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();expect((await calls(page,'network_apply_saved')).length).toBe(1);
});

test('T8 pending network apply receives one result after navigating away without replay',async({page})=>{
 await setup(page);await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18394');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_apply_saved')return new Promise(resolve=>w.releaseApply=()=>resolve(value));return value;};});
 await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseApply)).toBe('function');
 await nav(page,'诊断').click();await nav(page,'设置').click();await expect(page.getByText('正在等待网络应用回执…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存代理',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).releaseApply());await expect(page.getByText('已收到网络应用回执；贡献状态以当前读取为准。',{exact:true})).toBeVisible();expect((await calls(page,'network_apply_saved')).length).toBe(1);
});

test('T8 lost notification permission receipt survives navigation and is reconciled only by OS reads',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='notification_enable'){w.notificationPermission='granted';throw {code:'IPC_TIMEOUT',message:'notification permission receipt unavailable'};}return value;};});
 await page.getByLabel('接收系统通知',{exact:true}).check();await expect(page.getByText('通知授权请求结果尚未确认；请重新检查系统状态，不会重复请求授权。',{exact:true})).toBeVisible();
 await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通知与启动').click();expect((await calls(page,'notification_enable')).length).toBe(1);
 await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(page.locator('.ns-os-status').first()).toContainText('已允许');expect((await calls(page,'notification_enable')).length).toBe(1);expect(await calls(page,'autostart_set')).toEqual([]);
});

test('T8 repeated original-report read failures preserve cancel evidence and share a pending reread',async({page})=>{
 await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.diagnosticsStayRunning=true;let reads=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='diagnostics_cancel'){w.calls.push({command,args});throw {code:'IPC_TIMEOUT',message:'cancel receipt missing: sent=true'};}if(command==='diagnostics_snapshot'){w.calls.push({command,args});if(++reads===1)throw {code:'IPC_TIMEOUT',message:'read failed: attempt=1'};return new Promise(resolve=>w.releaseRead=async()=>resolve(await invoke(command,args)));}return invoke(command,args);};});
 await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.getByRole('button',{name:'取消诊断',exact:true}).click();const read=page.getByRole('button',{name:'重新读取原报告',exact:true});await read.click();
 await expect(page.getByRole('alert').filter({hasText:'diagnostics_cancel'})).toContainText('IPC_TIMEOUT');await expect(page.getByRole('alert').filter({hasText:'diagnostics_snapshot'})).toContainText('IPC_TIMEOUT');
 await read.click();await expect(read).toBeDisabled();await nav(page,'设置').click();await nav(page,'诊断').click();await expect(read).toBeDisabled();await page.evaluate(()=>(window as any).releaseRead());
 expect((await calls(page,'diagnostics_start')).length).toBe(1);expect((await calls(page,'diagnostics_cancel')).length).toBe(1);expect(new Set((await calls(page,'diagnostics_snapshot')).map((c:any)=>c.args.id)).size).toBe(1);
});

test('T8 export waiting and unknown receipts survive navigation and translate with the app language',async({page})=>{
 await setup(page);await completeReport(page);await page.evaluate(()=>{const w=window as any;w.downloads=[];HTMLAnchorElement.prototype.click=function(){w.downloads.push(this.href);};});
 await page.getByRole('button',{name:'导出脱敏报告',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认导出',exact:true}).click();await expect(page.getByText('正在等待报告下载结果…',{exact:true})).toBeVisible();
 await nav(page,'设置').click();await tab(page,'通用').click();await page.getByLabel('语言',{exact:true}).selectOption('en');await nav(page,'Diagnostics').click();await expect(page.getByText('Waiting for the report download result…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Export sanitized report',exact:true})).toBeDisabled();
 await page.clock.runFor(30001);await expect(page.getByRole('status')).toContainText('30000');expect((await calls(page,'diagnostics_export')).length).toBe(1);
 await nav(page,'Settings').click();await nav(page,'Diagnostics').click();await expect(page.getByRole('status')).toContainText('30000');
});

test('T8 successful upstream network tests retain the separate Hive failure and actual targets',async({page})=>{
 await setup(page);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='diagnostics_start'){const r=value.result.report;r.state='completed';r.finished_at=r.started_at;r.checks=[{id:'hive',platform:null,status:'fail',code:'http_rejected',observed_at:r.started_at,evidence:{http_status:'503',path:'/api/bee/identity'},next_action:'overview'}];}if(command==='network_test')value.result.network_test.checks.forEach((check:any,index:number)=>check.http_status=index===0?null:index===1?401:429);return value;};});
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await nav(page,'设置').click();await page.getByRole('button',{name:'测试连接',exact:true}).click();
 const result=page.locator('.ns-test');await expect(result).toContainText('HTTP 401');await expect(result).toContainText('HTTP 429');await expect(result).toContainText('不检查 Hive');await expect(result).toContainText('GET https://chatgpt.com/backend-api/wham/usage');await expect(result).toContainText('GET https://api.anthropic.com/api/oauth/profile');
 await expect(page.getByRole('alert')).toContainText('Hive 拒绝了本次请求（HTTP 503）');await expect(page.locator('.desktop-side-status')).not.toHaveText('可接单');
 expect(await calls(page,'network_apply_saved')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});

test('T8 lost autostart receipt keeps the last registration separate from the new desired choice',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')throw {code:'IPC_TIMEOUT',message:'autostart accepted; receipt lost'};return value;};});
 const desired=page.getByLabel('登录系统后启动 Bee',{exact:true});await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();await expect(page.locator('.ns-os-status').last()).toContainText('上次确认的系统登记');await expect(page.locator('.ns-os-status').last()).toContainText('未登记');
 await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(page.locator('.ns-os-status').last()).toContainText('已登记');await expect(desired).toBeEnabled();expect((await calls(page,'autostart_set')).length).toBe(1);
});

test('T8 failed autostart reads cannot confirm an unknown write or replace its evidence',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
 await expect(registration).toContainText('未登记');
 await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.autostartReadOutcome='null-error';w.loseAutostartReceipt=true;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   const value=await invoke(command,args);
   if(command==='autostart_set'&&w.loseAutostartReceipt)throw {code:'IPC_TIMEOUT',message:'autostart accepted; receipt lost: enabled=true'};
   if(command==='autostart_status'){
    if(w.autostartReadOutcome==='trusted')return {desired:true,registered:false,error:null};
    if(w.autostartReadOutcome==='rejected')throw {code:'IPC_TIMEOUT',message:'autostart query receipt lost: read_only=true'};
    return {desired:false,registered:w.autostartReadOutcome==='bool-error'?false:null,error:w.autostartReadOutcome==='null-only'?null:w.autostartReadOutcome==='bool-error'?{code:'PREFERENCES_IO',message:'preferences read failed: kind=PermissionDenied os_code=13'}:{code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13'}};
   }
   return value;
  };
 });
 await desired.check();await expect(desired).toBeDisabled();
 for(const outcome of ['null-error','bool-error','null-only','rejected']){
  await page.evaluate(outcome=>{(window as any).autostartReadOutcome=outcome;},outcome);
  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  await expect(settings).toContainText('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。');
  await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  await expect(settings).not.toContainText('系统启动登记与期望不一致。');
  await expect(settings.getByRole('alert')).toHaveCount(2);await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  if(outcome==='null-only'){await expect(settings).toContainText('registered=null');await expect(page.getByTestId('system-check-result')).toContainText('部分检查未完成');}
  if(outcome==='null-error')await expect(settings).toContainText('autostart query failed: kind=PermissionDenied os_code=13');
  if(outcome==='bool-error')await expect(settings).toContainText('preferences read failed: kind=PermissionDenied os_code=13');
  if(outcome==='rejected')await expect(settings).toContainText('autostart query receipt lost: read_only=true');
 }
 await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通用').click();
 await page.getByLabel('语言',{exact:true}).selectOption('en');await tab(page,'Notifications and startup').click();
 const englishDesired=page.getByLabel('Start Bee after signing in to the system',{exact:true});
 await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeDisabled();
 await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
 expect((await calls(page,'autostart_set')).length).toBe(1);
 await page.evaluate(()=>{(window as any).autostartReadOutcome='trusted';});
 await page.getByRole('button',{name:'Recheck system status',exact:true}).click();
 await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeEnabled();
 await expect(registration).not.toContainText('Last confirmed');await expect(registration).toContainText('Not registered');
 await expect(settings).toContainText('The desired startup option differs from system registration.');await expect(settings.getByRole('alert')).toHaveCount(0);
 expect((await calls(page,'autostart_set')).length).toBe(1);
 await page.evaluate(()=>{(window as any).loseAutostartReceipt=false;});await englishDesired.uncheck();
 await expect(englishDesired).not.toBeChecked();await expect(englishDesired).toBeEnabled();
 expect((await calls(page,'autostart_set')).map((call:any)=>call.args)).toEqual([{enabled:true},{enabled:false}]);
});

test('T8 null autostart set registration remains unknown without inventing a mismatch',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);return command==='autostart_set'?{desired:args.enabled,registered:null,error:null}:value;};});
 const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),settings=page.getByTestId('native-settings');
 await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
 await expect(settings).toContainText('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。');await expect(settings).not.toContainText('不一致');await expect(settings.getByRole('alert')).toHaveCount(0);
 await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(desired).toBeEnabled();
 expect((await calls(page,'autostart_set')).length).toBe(1);
});

test('T8 error-bearing autostart set receipt stays unknown with registration=null',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
 await expect(registration).toContainText('未登记');
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'autostart readback failed: desired=true registered=null; os_code=13'}};return value;};});
 await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
 await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
 await expect(settings).toContainText('autostart readback failed: desired=true registered=null; os_code=13');
 await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
 await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
 await expect(registration).toContainText('已登记');await expect(desired).toBeEnabled();await expect(settings.getByRole('alert')).toHaveCount(0);
 expect((await calls(page,'autostart_set')).length).toBe(1);
});

for(const registered of [false,true])test(`T8 autostart set failure retains its proven boolean registration=${registered}`,async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.evaluate(registered=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered,error:{code:registered?'AUTOSTART_REGISTER_FAILED':'AUTOSTART_UNCONFIRMED',message:registered?'autostart register failed: desired=Some(true); kind=PermissionDenied os_code=Some(13)':'autostart readback differs: desired=true registered=Some(false)'}};return value;};},registered);
 const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),settings=page.getByTestId('native-settings');
 await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeEnabled();
 const registration=page.locator('.ns-os-status').last();await expect(registration).not.toContainText('上次确认');await expect(registration).toContainText(registered?'已登记':'未登记');
 await expect(settings.getByRole('alert')).toContainText(registered?'AUTOSTART_REGISTER_FAILED':'AUTOSTART_UNCONFIRMED');
 if(registered)await expect(settings).not.toContainText('期望启动选项与系统登记不一致');else await expect(settings).toContainText('期望启动选项与系统登记不一致');
 await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('启动登记请求结果尚未确认');
 expect((await calls(page,'autostart_set')).length).toBe(1);
});


test('system check exposes immediate busy feedback, blocks repeated clicks and confirms unchanged results locally',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.evaluate(()=>{const w=window as any;w.settingsReadDelay=800;});
 const button=page.getByTestId('system-check-button'),box=await button.boundingBox();await button.focus();await page.keyboard.press('Enter');
 await expect(button).toHaveAttribute('aria-busy','true');await expect(button).toHaveAccessibleName('正在检查…');
 expect((await button.boundingBox())!.width).toBe(box!.width);await page.keyboard.press('Enter');
 await page.clock.runFor(801);await expect(button).toHaveAttribute('aria-busy','false');await expect(button).toBeFocused();
 await expect(page.getByTestId('system-check-result')).toHaveText('检查完成，状态未变化。');
 expect(await calls(page,'notification_enable')).toEqual([]);expect(await calls(page,'autostart_set')).toEqual([]);
 await nav(page,'概览').click();await nav(page,'设置').click();await expect(page.getByTestId('system-check-result')).toHaveText('检查完成，状态未变化。');
});

test('system check reports changed facts and every partial failure with concrete evidence, then recovers',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.evaluate(()=>{(window as any).notificationPermission='denied';});await page.getByTestId('system-check-button').click();
 await expect(page.getByTestId('system-check-result')).toHaveText('检查完成，系统状态已更新。');
 await page.evaluate(()=>{const w=window as any;w.settingsReadFailures={notification_permission:{code:'PERMISSION_QUERY_FAILED',message:'permission query rejected: os_code=13'},autostart_status:{code:'AUTOSTART_QUERY_FAILED',message:'registration query failed: os_code=7'}};});
 await page.getByTestId('system-check-button').click();const result=page.getByTestId('system-check-result');
 await expect(result).toContainText('部分检查未完成');await expect(result).toContainText('通知权限');await expect(result).toContainText('系统启动登记');
 await page.getByTestId('native-settings').getByText('查看失败详情',{exact:true}).first().click();await expect(page.getByTestId('native-settings')).toContainText('os_code=13');
 await page.evaluate(()=>{(window as any).settingsReadFailures={};});await page.getByTestId('system-check-button').click();await expect(result).not.toContainText('部分检查未完成');await expect(page.getByRole('alert')).toHaveCount(0);
});

test('long system waits remain explicit without claiming cancellation',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{(window as any).settingsReadDelay=12000;});
 await page.getByTestId('system-check-button').click();await page.clock.runFor(8001);await expect(page.getByTestId('system-check-result')).toHaveText('仍在等待系统响应…');
 await expect(page.getByTestId('system-check-button')).toHaveAttribute('aria-busy','true');await page.clock.runFor(4000);await expect(page.getByTestId('system-check-result')).toHaveText('检查完成，状态未变化。');
});

async function retryReady(page:Page){
 await setup(page);await page.evaluate(()=>{const w=window as any;w.notificationPermission='granted';w.notificationRetryableCount=1;w.notificationDeliveryError={code:'NOTIFICATION_SUBMIT_REJECTED',message:'native submit rejected: os_code=13'};});
 await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.getByLabel('接收系统通知',{exact:true}).check();
}
for(const outcome of ['accepted','failed','uncertain','read-failed','pending'])test(`notification retry follows ${outcome} without resending accepted or unknown items`,async({page})=>{
 await retryReady(page);await page.evaluate(()=>{(window as any).notificationRetryDelay=500;});
 const button=page.getByTestId('notification-retry-button');await button.click();await expect(button).toHaveAccessibleName('正在安排重试…');await expect(button).toHaveAttribute('aria-busy','true');
 await page.clock.runFor(501);const result=page.getByTestId('notification-retry-result');await expect(result).toContainText('重试请求已接受');
 await page.evaluate(outcome=>{const w=window as any;if(outcome==='read-failed'){w.settingsReadFailures={notification_delivery_status:{code:'RESPONSE_TIMEOUT',message:'delivery status unavailable: read_id=42'}};return;}if(outcome==='pending')return;w.notificationCheckSequence=1;w.notificationPendingCount=0;w.notificationRetryableCount=outcome==='failed'?1:0;w.notificationUncertainCount=outcome==='uncertain'?1:0;w.notificationDeliveryError=outcome==='failed'?{code:'NOTIFICATION_SUBMIT_REJECTED',message:'retry rejected: os_code=7'}:null;},outcome);
 await page.clock.runFor(outcome==='pending'?16001:1100);
 await expect(result).toContainText(outcome==='read-failed'?'通知状态读取失败':outcome==='pending'?'后台仍有待处理通知':outcome==='failed'?'明确失败':outcome==='uncertain'?'结果未知':'后台检查已完成');
 await expect(page.getByTestId('notification-retry-button')).toHaveCount(outcome==='failed'?1:0);expect((await calls(page,'notification_retry')).length).toBe(1);
 if(outcome==='read-failed'){await page.getByText('查看失败详情',{exact:true}).last().click();await expect(page.getByTestId('native-settings')).toContainText('read_id=42');await expect(page.getByRole('button',{name:'重新读取通知状态',exact:true})).toBeVisible();}
});

test('notification retry zero receipt is a no-op and status read failure never offers a delivery retry',async({page})=>{
 await retryReady(page);await page.evaluate(()=>{(window as any).notificationRetryableCount=0;});await page.getByTestId('notification-retry-button').click();
 await expect(page.getByTestId('notification-retry-result')).toContainText('没有可重试的通知');expect((await calls(page,'notification_retry')).length).toBe(1);
 await page.evaluate(()=>{const w=window as any;w.settingsReadFailures={notification_delivery_status:{code:'RESPONSE_TIMEOUT',message:'read unavailable: status_id=9'}};});await page.getByTestId('system-check-button').click();
 await expect(page.getByTestId('notification-retry-button')).toHaveCount(0);await expect(page.getByRole('button',{name:'重新读取通知状态',exact:true})).toBeVisible();
});

test('unknown retry request cannot be submitted again and a newer scope ignores late system reads',async({page})=>{
 await retryReady(page);await page.evaluate(()=>{const w=window as any;w.notificationRetryUnknown=true;});await page.getByTestId('notification-retry-button').click();
 await expect(page.getByTestId('notification-retry-result')).toContainText('重试请求结果尚未确认');await expect(page.getByTestId('notification-retry-button')).toHaveCount(0);expect((await calls(page,'notification_retry')).length).toBe(1);
 await page.evaluate(()=>{const w=window as any;w.settingsReadDelay=1000;});await page.getByTestId('system-check-button').click();await page.evaluate(()=>{const w=window as any;w.notificationPermission='denied';w.settingsReadDelay=0;w.emit('d'.repeat(32));});await page.clock.runFor(1001);
 await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.getByText('已拒绝',{exact:true})).toBeVisible();await expect(page.getByTestId('system-check-result')).toBeEmpty();
});

test('retry action keeps keyboard focus when it becomes a read-only status action',async({page})=>{
 await retryReady(page);const button=page.getByTestId('notification-retry-button');await button.focus();await page.keyboard.press('Enter');
 const read=page.getByRole('button',{name:'重新读取通知状态',exact:true});await expect(read).toBeFocused();await expect(read).toHaveAttribute('aria-disabled','true');
 await page.evaluate(()=>{const w=window as any;w.notificationCheckSequence=1;w.notificationPendingCount=0;w.notificationDeliveryError=null;});await page.clock.runFor(1100);
 await expect(read).toBeFocused();await expect(read).toHaveAttribute('aria-disabled','false');
});

test('hung follow-up status read stops waiting and a newer read wins over its late result',async({page})=>{
 await retryReady(page);await page.getByTestId('notification-retry-button').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let first=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{if(command==='notification_delivery_status'&&first){first=false;const value=await invoke(command,args);return new Promise(resolve=>{w.releaseDelivery=()=>resolve(value);});}return invoke(command,args);};});
 await page.clock.runFor(16001);await expect(page.getByTestId('notification-retry-result')).toContainText('通知状态尚未确认');
 await page.evaluate(()=>{const w=window as any;w.notificationCheckSequence=1;w.notificationPendingCount=0;w.notificationDeliveryError=null;});
 await page.getByRole('button',{name:'重新读取通知状态',exact:true}).click();await expect(page.getByTestId('notification-retry-result')).toContainText('后台检查已完成');
 await page.evaluate(()=>{(window as any).releaseDelivery();});await page.clock.runFor(1);await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByTestId('notification-retry-button')).toHaveCount(0);
});

test('fulfilled OS read failures are partial failures rather than successful settled promises',async({page})=>{
 await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const result=await invoke(command,args);return command==='autostart_status'?{...result,error:{code:'AUTOSTART_QUERY_FAILED',message:'registration read rejected: os_code=22'}}:command==='preferences_read'?{...result,error:{code:'PREFERENCES_READ_FAILED',message:'preferences read rejected: os_code=13'}}:result;};});
 await page.getByTestId('system-check-button').click();await expect(page.getByTestId('system-check-result')).toContainText('系统启动登记、偏好读取');
 await expect(page.getByTestId('system-check-result')).not.toContainText('检查完成，');
});


test('completed reads report an existing delivery issue without claiming partial query failure',async({page})=>{
 await retryReady(page);await page.getByTestId('system-check-button').click();
 await expect(page.getByTestId('system-check-result')).toHaveText('检查完成，通知仍有问题。');
 await expect(page.getByRole('alert')).toContainText('NOTIFICATION_SUBMIT_REJECTED');
});

test('mixed delivery outcomes show all counts and block retry until the follow-up completes',async({page})=>{
 await retryReady(page);await page.getByTestId('notification-retry-button').click();
 await page.evaluate(()=>{const w=window as any;w.notificationUncertainCount=2;w.notificationRetryableCount=1;w.notificationPendingCount=3;});
 await page.clock.runFor(1100);
 await expect(page.getByTestId('notification-retry-button')).toHaveCount(0);
 await page.evaluate(()=>{(window as any).notificationCheckSequence=1;});await page.clock.runFor(1100);
 const result=page.getByTestId('notification-retry-result');await expect(result).toContainText('待处理 3 · 明确失败 1 · 结果未知 2');
 await expect(page.getByTestId('notification-retry-button')).toBeVisible();
});


test('system reread superseding an in-flight retry follow-up is not reported as read failure',async({page})=>{
 await retryReady(page);await page.getByTestId('notification-retry-button').click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let first=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='notification_delivery_status'&&first){first=false;return new Promise(resolve=>{w.releaseDelivery=()=>resolve(value);});}return value;};});
 await page.clock.runFor(1100);
 await page.evaluate(()=>{const w=window as any;w.notificationCheckSequence=1;w.notificationPendingCount=0;w.notificationDeliveryError=null;});
 await page.getByTestId('system-check-button').click();await page.evaluate(()=>{(window as any).releaseDelivery();});await page.clock.runFor(1100);
 await expect(page.getByTestId('notification-retry-result')).toHaveText('后台检查已完成，通知状态已更新。待处理 0 · 明确失败 0 · 结果未知 0');
 await expect(page.getByRole('alert')).toHaveCount(0);expect((await calls(page,'notification_retry')).length).toBe(1);
});

test('startup recovery shows real compact phases and stops pretending to load after a block',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.startupView={state:'checking',failure:null,instance:'b'.repeat(32),binding_revision:null,network_revision:null,observed_at:null,revision:1,can_retry:false,recovering:true,progress:{stage:'checking_previous',operation_id:null,completed:null,total:null}};
  w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>['startup_status','startup_query'].includes(command)?(w.calls.push({command,args}),Promise.resolve(structuredClone(w.startupView))):invoke(command,args);
 });
 await page.clock.install();await page.goto('/');
 const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('正在恢复 Bee…');await expect(notice).toContainText('正在确认上次任务是否结束…');
 await page.clock.runFor(11000);await expect(notice).toContainText('等待时间较长');
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'startup_retry')).toEqual([]);
 await page.evaluate(()=>{const w=window as any;w.startupView={...w.startupView,revision:2,progress:{stage:'preparing_accounts',operation_id:'a'.repeat(48),completed:1,total:2}};});
 await page.clock.runFor(2200);await expect(notice).toContainText('正在准备账号（1/2）…');
 await page.evaluate(()=>{const w=window as any;w.startupView={...w.startupView,state:'blocked',progress:undefined,revision:3,failure:{code:'RECOVERY_SESSION_UNCONFIRMED',message:'previous_session_active=true clean=false; remote ownership unconfirmed'}};delete w.startupView.progress;});
 await page.clock.runFor(2200);await expect(notice).toContainText('暂时无法恢复 Bee');await expect(notice).not.toContainText('正在恢复 Bee');
 await notice.getByRole('button',{name:'核对结果',exact:true}).click();expect((await calls(page,'startup_query')).length).toBe(1);await expect(notice.getByRole('button',{name:'核对结果',exact:true})).toBeFocused();await expect(page.getByRole('alert')).toHaveCount(1);
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'startup_retry')).toEqual([]);
 await notice.getByRole('button',{name:'查看诊断',exact:true}).click();await expect(page.getByRole('button',{name:'导出启动诊断',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'运行诊断',exact:true})).toBeDisabled();
});

test('startup automatic observation ends at sixty seconds without replaying recovery',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>['startup_status','startup_query'].includes(command)?(w.calls.push({command,args}),Promise.resolve({state:'checking',failure:null,instance:'b'.repeat(32),binding_revision:null,network_revision:null,observed_at:null,revision:1})):invoke(command,args);});
 await page.clock.install();await page.goto('/');await expect(page.getByTestId('startup-recovery')).toContainText('正在启动 Bee…');
 await page.clock.runFor(61000);await expect(page.getByTestId('startup-recovery')).toContainText('状态待核对');
 const count=(await calls(page,'startup_status')).length;await page.clock.runFor(12000);expect((await calls(page,'startup_status')).length).toBe(count);expect(await calls(page,'startup_retry')).toEqual([]);
 await page.getByTestId('startup-recovery').getByRole('button',{name:'核对结果',exact:true}).click();expect((await calls(page,'startup_query')).length).toBe(1);expect(await calls(page,'startup_retry')).toEqual([]);
});

test('failed first startup query is visible and keeps account actions unavailable until readback',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>command==='startup_status'?Promise.reject({code:'STARTUP_READ_FAILED',message:'startup receipt channel rejected the read'}):invoke(command==='startup_query'?'startup_status':command,args);});
 await page.goto('/');await nav(page,'AI 账号').click();
 const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('状态待核对');
 await notice.getByText('错误详情',{exact:true}).click();await expect(notice).toContainText('startup receipt channel rejected the read');
 await expect(page.getByRole('button',{name:'接入账号',exact:true})).toHaveCount(0);expect(await calls(page,'account_defaults')).toEqual([]);
 await notice.getByRole('button',{name:'核对结果',exact:true}).click();await expect(notice).toBeHidden();
 await expect.poll(async()=>(await calls(page,'account_defaults')).length).toBe(1);
});

test('unsupported Hive recovery gives an honest next step and no ineffective query loop',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>['startup_status','startup_query'].includes(command)?Promise.resolve({state:'blocked',failure:{code:'RECOVERY_SERVER_UNSUPPORTED',message:'Hive runtime recovery protocol unavailable: HTTP 404; original guard retained'},instance:'b'.repeat(32),binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:2,can_retry:false,recovering:false}):invoke(command,args);});
 await page.goto('/');const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('需要先升级 Hive');
 await expect(notice.getByRole('button',{name:'核对结果',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新核对设备',exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(1);
 await notice.getByText('错误详情',{exact:true}).click();await expect(notice).toContainText('HTTP 404');
 await notice.getByRole('button',{name:'查看诊断',exact:true}).click();await expect(page.getByRole('button',{name:'导出启动诊断',exact:true})).toBeVisible();
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'supply_set_paused')).toEqual([]);
});

test('pending retirement continues the original recovery and returns to normal account reads',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let finished=false;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>{
  if(command==='startup_retry'){w.calls.push({command,args});finished=true;}
  if(['startup_status','startup_query','startup_retry'].includes(command))return Promise.resolve({state:finished?'ready':'blocked',failure:finished?null:{code:'RECOVERY_REMOTE_DRAINING',message:'original retirement operation retained; unfinished=true'},instance:'b'.repeat(32),binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:finished?3:2,can_retry:!finished,recovering:false});
  return invoke(command,args);
 };});
 await page.goto('/');const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('等待上次任务结束');await notice.getByRole('button',{name:'继续恢复',exact:true}).click();
 await expect(notice).toHaveCount(0);await expect.poll(async()=>(await calls(page,'account_snapshot')).length).toBeGreaterThan(0);expect((await calls(page,'startup_retry')).length).toBe(1);expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'supply_set_paused')).toEqual([]);
});


test('retirement conflict keeps the original cause and only offers diagnostics',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>['startup_status','startup_query'].includes(command)?Promise.resolve({state:'blocked',failure:{code:'RECOVERY_RETIREMENT_CONFLICT',message:'HTTP 409 runtime_preparation_conflict; original preparation retained'},instance:'b'.repeat(32),binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:2,can_retry:false,recovering:false}):invoke(command,args);});
 await page.goto('/');const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('Hive 拒绝结束旧会话');
 await expect(notice.getByRole('button',{name:'核对结果',exact:true})).toHaveCount(0);await expect(notice.getByRole('button',{name:'继续恢复',exact:true})).toHaveCount(0);
 await notice.getByText('错误详情',{exact:true}).click();await expect(notice).toContainText('runtime_preparation_conflict');await expect(page.getByRole('alert')).toHaveCount(1);
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'supply_set_paused')).toEqual([]);
});


test('startup exhausted observation immediately offers manual query and retains last confirmation',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=(command:string,args:unknown)=>{
   if(command==='startup_status'){w.calls.push({command,args});if(w.startupReadFails)return Promise.reject({code:'STARTUP_READ_FAILED',message:'startup IPC unavailable'});return Promise.resolve({state:'checking',failure:null,instance:'b'.repeat(32),binding_revision:null,network_revision:null,observed_at:new Date().toISOString(),revision:1});}
   return invoke(command==='startup_query'?'startup_status':command,args);
  };
 });
 await page.clock.install();await page.goto('/');const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('正在启动 Bee…');
 await page.evaluate(()=>{(window as any).startupReadFails=true;});await page.clock.runFor(9500);await expect(notice.getByRole('heading')).toHaveText('状态待核对');await expect(notice).toHaveAttribute('aria-busy','false');await expect(notice).toContainText('上次确认：');
 const count=(await calls(page,'startup_status')).length;await page.clock.runFor(20000);expect((await calls(page,'startup_status')).length).toBe(count);
 await notice.getByRole('button',{name:'核对结果',exact:true}).click();await expect(notice).toBeHidden();expect(await calls(page,'runtime_start')).toEqual([]);
});

for(const capabilities of [undefined,[]])test(`legacy recovery capability ${capabilities?'empty':'absent'} exposes diagnostics only`,async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(({capabilities})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
  if(command==='startup_status')return {state:'blocked',failure:{code:'RECOVERY_UNAVAILABLE',message:'bundled management process does not advertise read-only recovery inspection; no automatic restore submitted'},instance:'b'.repeat(32),binding_revision:1,network_revision:0,observed_at:new Date().toISOString(),revision:2,can_retry:false};
  const reply=await invoke(command,args);if(command==='bridge_status'){if(capabilities)reply.metadata.capabilities=capabilities;else delete reply.metadata.capabilities;}return reply;
 };},{capabilities});
 await page.goto('/');const notice=page.getByTestId('startup-recovery');await expect(notice).toContainText('暂时无法恢复 Bee');await expect(notice.getByRole('button',{name:'核对结果',exact:true})).toHaveCount(0);
 await notice.getByRole('button',{name:'查看诊断',exact:true}).click();await expect(page.getByRole('button',{name:'导出启动诊断',exact:true})).toBeVisible();expect(await calls(page,'startup_query')).toEqual([]);
});

test('explicit OpenAI supply recheck clears a terminal GET gate without replaying a write',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{autoService:true},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.supplyAccessDenied=true;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   const result=await invoke(command,args);
   if(command==='supply_status'&&args.platform==='openai'&&w.supplyAccessDenied)throw {code:'SUPPLY_OPERATION_FAILED',message:'GET supply HTTP 403 access denied',details:{check:'supply_status',observed_at:new Date().toISOString(),evidence:{failure_kind:'http_rejected',http_status:'403',method:'GET'}}};
   return result;
  };
 });
 await page.clock.install();await page.goto('/');await nav(page,'AI 账号').click();
 const account=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(account.getByRole('button',{name:'核对结果',exact:true})).toBeVisible();
 const count=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='supply_status'&&c.args.platform==='openai').length);
 const before=await count();await page.evaluate(()=>{(window as any).supplyAccessDenied=false;});
 await page.clock.runFor(11000);expect(await count()).toBe(before);
 await account.getByRole('button',{name:'核对结果',exact:true}).click();await expect.poll(count).toBeGreaterThan(before);
 await expect(account.getByRole('button',{name:'核对结果',exact:true})).toHaveCount(0);
 expect(await calls(page,'supply_set_paused')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});
