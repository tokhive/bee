# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-experience.spec.ts >> T8 autostart set failure retains its proven boolean registration=true
- Location: tests/native-experience.spec.ts:502:38

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByLabel('登录系统后启动 Bee', { exact: true })
Expected: enabled
Received: disabled
Timeout:  5000ms

Call log:
  - Expect "toBeEnabled" getByLabel('登录系统后启动 Bee', { exact: true }) with timeout 5000ms
  - waiting for getByLabel('登录系统后启动 Bee', { exact: true })
    14 × locator resolved to <input disabled type="checkbox"/>
       - unexpected value "disabled"

```

```yaml
- checkbox "登录系统后启动 Bee" [checked] [disabled]
```

# Test source

```ts
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
  441 |     if(w.autostartReadOutcome==='rejected')throw {code:'IPC_TIMEOUT',message:'autostart query receipt lost: read_only=true'};
  442 |     return {desired:false,registered:w.autostartReadOutcome==='bool-error'?false:null,error:w.autostartReadOutcome==='null-only'?null:w.autostartReadOutcome==='bool-error'?{code:'PREFERENCES_IO',message:'preferences read failed: kind=PermissionDenied os_code=13'}:{code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13'}};
  443 |    }
  444 |    return value;
  445 |   };
  446 |  });
  447 |  await desired.check();await expect(desired).toBeDisabled();
  448 |  for(const outcome of ['null-error','bool-error','null-only','rejected']){
  449 |   await page.evaluate(outcome=>{(window as any).autostartReadOutcome=outcome;},outcome);
  450 |   await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  451 |   await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  452 |   await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  453 |   await expect(settings).toContainText('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。');
  454 |   await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  455 |   await expect(settings).not.toContainText('系统启动登记与期望不一致。');
  456 |   await expect(settings.getByRole('alert')).toHaveCount(outcome==='null-only'?1:2);await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  457 |   if(outcome==='null-error')await expect(settings).toContainText('autostart query failed: kind=PermissionDenied os_code=13');
  458 |   if(outcome==='bool-error')await expect(settings).toContainText('preferences read failed: kind=PermissionDenied os_code=13');
  459 |   if(outcome==='rejected')await expect(settings).toContainText('autostart query receipt lost: read_only=true');
  460 |  }
  461 |  await nav(page,'概览').click();await nav(page,'设置').click();await tab(page,'通用').click();
  462 |  await page.getByLabel('语言',{exact:true}).selectOption('en');await tab(page,'Notifications and startup').click();
  463 |  const englishDesired=page.getByLabel('Start Bee after signing in to the system',{exact:true});
  464 |  await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeDisabled();
  465 |  await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  466 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  467 |  await page.evaluate(()=>{(window as any).autostartReadOutcome='trusted';});
  468 |  await page.getByRole('button',{name:'Recheck system status',exact:true}).click();
  469 |  await expect(englishDesired).toBeChecked();await expect(englishDesired).toBeEnabled();
  470 |  await expect(registration).not.toContainText('Last confirmed');await expect(registration).toContainText('Not registered');
  471 |  await expect(settings).toContainText('The desired startup option differs from system registration.');await expect(settings.getByRole('alert')).toHaveCount(0);
  472 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  473 |  await page.evaluate(()=>{(window as any).loseAutostartReceipt=false;});await englishDesired.uncheck();
  474 |  await expect(englishDesired).not.toBeChecked();await expect(englishDesired).toBeEnabled();
  475 |  expect((await calls(page,'autostart_set')).map((call:any)=>call.args)).toEqual([{enabled:true},{enabled:false}]);
  476 | });
  477 | 
  478 | test('T8 null autostart set registration remains unknown without inventing a mismatch',async({page})=>{
  479 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  480 |  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);return command==='autostart_set'?{desired:args.enabled,registered:null,error:null}:value;};});
  481 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),settings=page.getByTestId('native-settings');
  482 |  await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  483 |  await expect(settings).toContainText('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。');await expect(settings).not.toContainText('不一致');await expect(settings.getByRole('alert')).toHaveCount(0);
  484 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(desired).toBeEnabled();
  485 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  486 | });
  487 | 
  488 | test('T8 error-bearing autostart set receipt stays unknown with registration=null',async({page})=>{
  489 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  490 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
  491 |  await expect(registration).toContainText('未登记');
  492 |  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'autostart readback failed: desired=true registered=null; os_code=13'}};return value;};});
  493 |  await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  494 |  await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  495 |  await expect(settings).toContainText('autostart readback failed: desired=true registered=null; os_code=13');
  496 |  await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  497 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  498 |  await expect(registration).toContainText('已登记');await expect(desired).toBeEnabled();await expect(settings.getByRole('alert')).toHaveCount(0);
  499 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  500 | });
  501 | 
  502 | for(const registered of [false,true])test(`T8 autostart set failure retains its proven boolean registration=${registered}`,async({page})=>{
  503 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  504 |  await page.evaluate(registered=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered,error:{code:registered?'AUTOSTART_REGISTER_FAILED':'AUTOSTART_UNCONFIRMED',message:registered?'autostart register failed: desired=Some(true); kind=PermissionDenied os_code=Some(13)':'autostart readback differs: desired=true registered=Some(false)'}};return value;};},registered);
  505 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),settings=page.getByTestId('native-settings');
> 506 |  await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeEnabled();
      |                                                                                  ^ Error: expect(locator).toBeEnabled() failed
  507 |  const registration=page.locator('.ns-os-status').last();await expect(registration).not.toContainText('上次确认');await expect(registration).toContainText(registered?'已登记':'未登记');
  508 |  await expect(settings.getByRole('alert')).toContainText(registered?'AUTOSTART_REGISTER_FAILED':'AUTOSTART_UNCONFIRMED');
  509 |  if(registered)await expect(settings).not.toContainText('期望启动选项与系统登记不一致');else await expect(settings).toContainText('期望启动选项与系统登记不一致');
  510 |  await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('启动登记请求结果尚未确认');
  511 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  512 | });
  513 | 
```