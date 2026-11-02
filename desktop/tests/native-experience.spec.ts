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
 await page.goto('/');await expect(page.getByText('SIDECAR_EXIT: owned management child exited: status=1',{exact:true})).toBeVisible();
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
 await setup(page);await page.evaluate(()=>{const w=window as any;w.notificationPermission='granted';w.notificationDeliveryError={code:'NOTIFICATION_NATIVE',message:'native notification rejected: os_code=13'};});
 await nav(page,'设置').click();await tab(page,'通知与启动').click();await expect(page.getByRole('alert')).toContainText('NOTIFICATION_NATIVE');
 expect(await calls(page,'notification_retry')).toEqual([]);expect(await calls(page,'notification_enable')).toEqual([]);
 await page.getByLabel('希望接收系统通知',{exact:true}).check();
 await page.getByRole('button',{name:'重试失败的通知',exact:true}).click();
 expect(await calls(page,'notification_retry')).toEqual([{command:'notification_retry',args:{}}]);
 await expect(page.getByRole('status')).toContainText('将在下次后台检查时重试明确失败的通知');
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
