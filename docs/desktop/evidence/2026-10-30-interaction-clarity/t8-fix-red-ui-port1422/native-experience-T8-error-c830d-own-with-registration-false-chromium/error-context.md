# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-experience.spec.ts >> T8 error-bearing autostart set receipt stays unknown with registration=false
- Location: tests/native-experience.spec.ts:474:38

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator:  getByLabel('登录系统后启动 Bee', { exact: true })
Expected: disabled
Received: enabled
Timeout:  5000ms

Call log:
  - Expect "toBeDisabled" getByLabel('登录系统后启动 Bee', { exact: true }) with timeout 5000ms
  - waiting for getByLabel('登录系统后启动 Bee', { exact: true })
    14 × locator resolved to <input type="checkbox"/>
       - unexpected value "enabled"

```

```yaml
- checkbox "登录系统后启动 Bee" [checked]
```

# Test source

```ts
  379 |  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_apply_saved')value.error={code:'RUNTIME_OPERATION_FAILED',message:'restore failed: local=stopped; intended=running',details:{check:'network_restore',observed_at:new Date().toISOString(),evidence:{}}};return value;};});
  380 |  await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();
  381 |  await expect(page.getByText('网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();await expect(page.locator('.ns-network-summary>div').last()).toContainText('18393');await expect(page.getByText('当前贡献进程：已停止',{exact:true})).toBeVisible();
  382 |  await nav(page,'概览').click();await nav(page,'设置').click();await expect(page.getByText('网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();expect((await calls(page,'network_apply_saved')).length).toBe(1);
  383 | });
  384 | 
  385 | test('T8 pending network apply receives one result after navigating away without replay',async({page})=>{
  386 |  await setup(page);await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18394');await page.getByRole('button',{name:'保存代理',exact:true}).click();
  387 |  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_apply_saved')return new Promise(resolve=>w.releaseApply=()=>resolve(value));return value;};});
  388 |  await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseApply)).toBe('function');
  389 |  await nav(page,'诊断').click();await nav(page,'设置').click();await expect(page.getByText('正在等待网络应用回执…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存代理',exact:true})).toBeDisabled();
  390 |  await page.evaluate(()=>(window as any).releaseApply());await expect(page.getByText('已收到网络应用回执；贡献状态以当前读取为准。',{exact:true})).toBeVisible();expect((await calls(page,'network_apply_saved')).length).toBe(1);
  391 | });
  392 | 
  393 | test('T8 lost notification permission receipt survives navigation and is reconciled only by OS reads',async({page})=>{
  394 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='notification_enable'){w.notificationPermission='granted';throw {code:'IPC_TIMEOUT',message:'notification permission receipt unavailable'};}return value;};});
  395 |  await page.getByLabel('接收系统通知',{exact:true}).check();await expect(page.getByText('通知授权请求结果尚未确认；请重新检查系统状态，不会重复请求授权。',{exact:true})).toBeVisible();
  396 |  await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通知与启动').click();expect((await calls(page,'notification_enable')).length).toBe(1);
  397 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(page.locator('.ns-os-status').first()).toContainText('已允许');expect((await calls(page,'notification_enable')).length).toBe(1);expect(await calls(page,'autostart_set')).toEqual([]);
  398 | });
  399 | 
  400 | test('T8 repeated original-report read failures preserve cancel evidence and share a pending reread',async({page})=>{
  401 |  await setup(page);await nav(page,'诊断').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.diagnosticsStayRunning=true;let reads=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='diagnostics_cancel'){w.calls.push({command,args});throw {code:'IPC_TIMEOUT',message:'cancel receipt missing: sent=true'};}if(command==='diagnostics_snapshot'){w.calls.push({command,args});if(++reads===1)throw {code:'IPC_TIMEOUT',message:'read failed: attempt=1'};return new Promise(resolve=>w.releaseRead=async()=>resolve(await invoke(command,args)));}return invoke(command,args);};});
  402 |  await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.getByRole('button',{name:'取消诊断',exact:true}).click();const read=page.getByRole('button',{name:'重新读取原报告',exact:true});await read.click();
  403 |  await expect(page.getByRole('alert').filter({hasText:'diagnostics_cancel'})).toContainText('IPC_TIMEOUT');await expect(page.getByRole('alert').filter({hasText:'diagnostics_snapshot'})).toContainText('IPC_TIMEOUT');
  404 |  await read.click();await expect(read).toBeDisabled();await nav(page,'设置').click();await nav(page,'诊断').click();await expect(read).toBeDisabled();await page.evaluate(()=>(window as any).releaseRead());
  405 |  expect((await calls(page,'diagnostics_start')).length).toBe(1);expect((await calls(page,'diagnostics_cancel')).length).toBe(1);expect(new Set((await calls(page,'diagnostics_snapshot')).map((c:any)=>c.args.id)).size).toBe(1);
  406 | });
  407 | 
  408 | test('T8 export waiting and unknown receipts survive navigation and translate with the app language',async({page})=>{
  409 |  await setup(page);await completeReport(page);await page.evaluate(()=>{const w=window as any;w.downloads=[];HTMLAnchorElement.prototype.click=function(){w.downloads.push(this.href);};});
  410 |  await page.getByRole('button',{name:'导出脱敏报告',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认导出',exact:true}).click();await expect(page.getByText('正在等待报告下载结果…',{exact:true})).toBeVisible();
  411 |  await nav(page,'设置').click();await tab(page,'通用').click();await page.getByLabel('语言',{exact:true}).selectOption('en');await nav(page,'Diagnostics').click();await expect(page.getByText('Waiting for the report download result…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Export sanitized report',exact:true})).toBeDisabled();
  412 |  await page.clock.runFor(30001);await expect(page.getByRole('status')).toContainText('30000');expect((await calls(page,'diagnostics_export')).length).toBe(1);
  413 |  await nav(page,'Settings').click();await nav(page,'Diagnostics').click();await expect(page.getByRole('status')).toContainText('30000');
  414 | });
  415 | 
  416 | test('T8 successful upstream network tests retain the separate Hive failure and actual targets',async({page})=>{
  417 |  await setup(page);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='diagnostics_start'){const r=value.result.report;r.state='completed';r.finished_at=r.started_at;r.checks=[{id:'hive',platform:null,status:'fail',code:'http_rejected',observed_at:r.started_at,evidence:{http_status:'503',path:'/api/bee/identity'},next_action:'overview'}];}if(command==='network_test')value.result.network_test.checks.forEach((check:any,index:number)=>check.http_status=index===0?null:index===1?401:429);return value;};});
  418 |  await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await nav(page,'设置').click();await page.getByRole('button',{name:'测试连接',exact:true}).click();
  419 |  const result=page.locator('.ns-test');await expect(result).toContainText('HTTP 401');await expect(result).toContainText('HTTP 429');await expect(result).toContainText('不检查 Hive');await expect(result).toContainText('GET https://chatgpt.com/backend-api/wham/usage');await expect(result).toContainText('GET https://api.anthropic.com/api/oauth/profile');
  420 |  await expect(page.getByRole('alert')).toContainText('Hive 拒绝了本次请求（HTTP 503）');await expect(page.locator('.desktop-side-status')).not.toHaveText('可接单');
  421 |  expect(await calls(page,'network_apply_saved')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
  422 | });
  423 | 
  424 | test('T8 lost autostart receipt keeps the last registration separate from the new desired choice',async({page})=>{
  425 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')throw {code:'IPC_TIMEOUT',message:'autostart accepted; receipt lost'};return value;};});
  426 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true});await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();await expect(page.locator('.ns-os-status').last()).toContainText('上次确认的系统登记');await expect(page.locator('.ns-os-status').last()).toContainText('未登记');
  427 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(page.locator('.ns-os-status').last()).toContainText('已登记');await expect(desired).toBeEnabled();expect((await calls(page,'autostart_set')).length).toBe(1);
  428 | });
  429 | 
  430 | test('T8 failed autostart reads cannot confirm an unknown write or replace its evidence',async({page})=>{
  431 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  432 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
  433 |  await expect(registration).toContainText('未登记');
  434 |  await page.evaluate(()=>{
  435 |   const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.autostartReadOutcome='null-error';w.loseAutostartReceipt=true;
  436 |   w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  437 |    const value=await invoke(command,args);
  438 |    if(command==='autostart_set'&&w.loseAutostartReceipt)throw {code:'IPC_TIMEOUT',message:'autostart accepted; receipt lost: enabled=true'};
  439 |    if(command==='autostart_status'){
  440 |     if(w.autostartReadOutcome==='trusted')return {desired:true,registered:false,error:null};
  441 |     return {desired:false,registered:w.autostartReadOutcome==='bool-error'?false:null,error:w.autostartReadOutcome==='null-only'?null:{code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13'}};
  442 |    }
  443 |    return value;
  444 |   };
  445 |  });
  446 |  await desired.check();await expect(desired).toBeDisabled();
  447 |  for(const outcome of ['null-error','bool-error','null-only']){
  448 |   await page.evaluate(outcome=>{(window as any).autostartReadOutcome=outcome;},outcome);
  449 |   await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  450 |   await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  451 |   await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  452 |   await expect(settings).toContainText('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。');
  453 |   await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  454 |   await expect(settings.getByRole('alert')).toHaveCount(2);await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  455 |   if(outcome!=='null-only')await expect(settings).toContainText('autostart query failed: kind=PermissionDenied os_code=13');
  456 |  }
  457 |  await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通用').click();
  458 |  await page.getByLabel('语言',{exact:true}).selectOption('en');await tab(page,'Notifications and startup').click();
  459 |  const englishDesired=page.getByLabel('Start Bee after signing in to the system',{exact:true});
  460 |  await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeDisabled();
  461 |  await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  462 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  463 |  await page.evaluate(()=>{(window as any).autostartReadOutcome='trusted';});
  464 |  await page.getByRole('button',{name:'Recheck system status',exact:true}).click();
  465 |  await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeEnabled();
  466 |  await expect(registration).not.toContainText('Last confirmed');await expect(registration).toContainText('Not registered');
  467 |  await expect(settings).toContainText('The desired startup option differs from system registration.');await expect(settings.getByRole('alert')).toHaveCount(0);
  468 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  469 |  await page.evaluate(()=>{(window as any).loseAutostartReceipt=false;});await englishDesired.uncheck();
  470 |  await expect(englishDesired).not.toBeChecked();await expect(englishDesired).toBeEnabled();
  471 |  expect((await calls(page,'autostart_set')).map((call:any)=>call.args)).toEqual([{enabled:true},{enabled:false}]);
  472 | });
  473 | 
  474 | for(const registered of [null,false])test(`T8 error-bearing autostart set receipt stays unknown with registration=${registered}`,async({page})=>{
  475 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  476 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
  477 |  await expect(registration).toContainText('未登记');
  478 |  await page.evaluate(registered=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered,error:{code:registered===null?'AUTOSTART_QUERY_FAILED':'AUTOSTART_UNCONFIRMED',message:`autostart readback failed: desired=true registered=${registered}; os_code=13`}};return value;};},registered);
> 479 |  await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
      |                                                                                  ^ Error: expect(locator).toBeDisabled() failed
  480 |  await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  481 |  await expect(settings).toContainText(`autostart readback failed: desired=true registered=${registered}; os_code=13`);
  482 |  await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  483 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  484 |  await expect(registration).toContainText('已登记');await expect(desired).toBeEnabled();await expect(settings.getByRole('alert')).toHaveCount(0);
  485 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  486 | });
  487 | 
```