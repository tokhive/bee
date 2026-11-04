# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-experience.spec.ts >> T8 failed autostart reads cannot confirm an unknown write or replace its evidence
- Location: tests/native-experience.spec.ts:430:1

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: getByTestId('native-settings')
Expected substring: not "系统启动登记与期望不一致。"
Received string: "通用网络与代理通知与启动关于通知与启动偏好与系统实际状态分别显示。   接收系统通知授权、换号、离线和额度问题仍会保留在应用内。系统权限尚未允许登录系统后启动 Bee登录系统后按既有运行意图恢复；不会自动授权、接入账号或解除手动暂停。上次确认的系统登记未登记启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。本次操作失败，原因尚未确认。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: IPC_TIMEOUT
失败环节: autostart_set
原始原因: autostart accepted; receipt lost: enabled=true系统启动登记与期望不一致。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: AUTOSTART_UNCONFIRMED
失败环节: autostart_status
原始原因: autostart status missing registration: desired=false registered=null; required=boolean重新检查系统状态关窗后继续后台运行，可从托盘、菜单或再次启动找回窗口。"
Timeout: 5000ms

Call log:
  - Expect "not toContainText" getByTestId('native-settings') with timeout 5000ms
  - waiting for getByTestId('native-settings')
    14 × locator resolved to <div dir="ltr" data-orientation="horizontal" data-testid="native-settings" class="native-settings section-tabs">…</div>
       - unexpected value "通用网络与代理通知与启动关于通知与启动偏好与系统实际状态分别显示。   接收系统通知授权、换号、离线和额度问题仍会保留在应用内。系统权限尚未允许登录系统后启动 Bee登录系统后按既有运行意图恢复；不会自动授权、接入账号或解除手动暂停。上次确认的系统登记未登记启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。本次操作失败，原因尚未确认。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: IPC_TIMEOUT
失败环节: autostart_set
原始原因: autostart accepted; receipt lost: enabled=true系统启动登记与期望不一致。本次操作未能完成；后续状态以重新核对的结果为准。查看失败详情错误码: AUTOSTART_UNCONFIRMED
失败环节: autostart_status
原始原因: autostart status missing registration: desired=false registered=null; required=boolean重新检查系统状态关窗后继续后台运行，可从托盘、菜单或再次启动找回窗口。"

```

```yaml
- tablist "设置分类":
  - tab "通用"
  - tab "网络与代理"
  - tab "通知与启动" [selected]
  - tab "关于"
- tabpanel "通知与启动":
  - region "通知与启动":
    - heading "通知与启动" [level=2]
    - paragraph: 偏好与系统实际状态分别显示。
    - checkbox "接收系统通知"
    - text: 接收系统通知
    - paragraph: 授权、换号、离线和额度问题仍会保留在应用内。
    - text: 系统权限
    - strong: 尚未允许
    - checkbox "登录系统后启动 Bee" [checked] [disabled]
    - text: 登录系统后启动 Bee
    - paragraph: 登录系统后按既有运行意图恢复；不会自动授权、接入账号或解除手动暂停。
    - text: 上次确认的系统登记
    - strong: 未登记
    - paragraph: 启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。
    - alert:
      - paragraph: 本次操作失败，原因尚未确认。
      - paragraph: 本次操作未能完成；后续状态以重新核对的结果为准。
      - group: 查看失败详情
    - alert:
      - paragraph: 系统启动登记与期望不一致。
      - paragraph: 本次操作未能完成；后续状态以重新核对的结果为准。
      - group: 查看失败详情
    - button "重新检查系统状态"
    - paragraph: 关窗后继续后台运行，可从托盘、菜单或再次启动找回窗口。
```

# Test source

```ts
  355 |  await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.getByTestId('passed-checks').locator(':scope > summary').click();
  356 |  await expect(page.getByText('本机绑定信息完整；远端身份需单独核对。',{exact:true})).toBeVisible();const check=page.locator('.nd-issues [data-nav-section="connection"]');await expect(check).toContainText(reason==='device_replaced'?'此设备已被替换，原设备凭据已撤销。':'Hive 已拒绝此设备凭据。');
  357 |  await check.getByRole('button',{name:'查看概览',exact:true}).click();await expect(page.locator('[data-nav-section="device"]')).toBeFocused();await expect(page.getByRole('button',{name:'重新绑定设备',exact:true})).toBeVisible();
  358 |  await page.getByRole('button',{name:'返回原处',exact:true}).click();await expect(check).toBeFocused();expect((await calls(page,'diagnostics_start')).length).toBe(1);
  359 |  for(const command of ['device_recovery_prepare','device_recovery_confirm','runtime_start','account_action','device_begin'])expect((await calls(page,command)).length).toBe(0);
  360 | });
  361 | 
  362 | test('T8 confirmed proxy save never selects an older device scope when its network read fails',async({page})=>{
  363 |  await setup(page);await nav(page,'设置').click();
  364 |  await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let saved=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='network_snapshot'&&saved){w.calls.push({command,args});throw {code:'NETWORK_RUNTIME_UNCONFIRMED',message:'network observation unavailable after current-device save'};}const value=await invoke(command,args);if(command==='network_save_proxy'){saved=true;value.preferences.proxies.unshift({origin:'https://hive.example',device_scope:'previous-device',connect_proxy:'http://127.0.0.1:17001'});}return value;};});
  365 |  await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18389');await page.getByRole('button',{name:'保存代理',exact:true}).click();
  366 |  const saved=page.locator('.ns-network-summary>div').first();await expect(saved).toContainText('http://127.0.0.1:18389');await expect(saved).not.toContainText('17001');
  367 |  await nav(page,'概览').click();await nav(page,'设置').click();await expect(saved).toContainText('http://127.0.0.1:18389');expect((await calls(page,'network_save_proxy')).length).toBe(1);
  368 | });
  369 | 
  370 | test('T8 unknown proxy save permits a new explicit save only after current scoped reads succeed',async({page})=>{
  371 |  await setup(page);await nav(page,'设置').click();await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let lost=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='network_save_proxy'&&!lost){lost=true;throw {code:'IPC_TIMEOUT',message:'save accepted; receipt lost'};}return value;};});
  372 |  await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18391');const save=page.getByRole('button',{name:'保存代理',exact:true});await save.click();await expect(save).toBeDisabled();
  373 |  await page.getByRole('button',{name:'核对当前保存配置',exact:true}).click();await expect(save).toBeEnabled();expect((await calls(page,'network_save_proxy')).length).toBe(1);
  374 |  await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18392');await save.click();await expect(page.locator('.ns-network-summary')).toContainText('18392');expect((await calls(page,'network_save_proxy')).length).toBe(2);
  375 | });
  376 | 
  377 | test('T8 restore failure preserves the applied network and the separate stopped runtime',async({page})=>{
  378 |  await setup(page);await nav(page,'设置').click();await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18393');await page.getByRole('button',{name:'保存代理',exact:true}).click();
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
  441 |     if(w.autostartReadOutcome==='rejected')throw {code:'IPC_TIMEOUT',message:'autostart query receipt lost: read_only=true'};
  442 |     return {desired:false,registered:w.autostartReadOutcome==='bool-error'?false:null,error:w.autostartReadOutcome==='null-only'?null:{code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13'}};
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
> 455 |   await expect(settings).not.toContainText('系统启动登记与期望不一致。');
      |                              ^ Error: expect(locator).not.toContainText(expected) failed
  456 |   await expect(settings.getByRole('alert')).toHaveCount(2);await expect(settings).toContainText('autostart accepted; receipt lost: enabled=true');
  457 |   if(outcome==='null-error'||outcome==='bool-error')await expect(settings).toContainText('autostart query failed: kind=PermissionDenied os_code=13');
  458 |   if(outcome==='null-only')await expect(settings).toContainText('registered=null; required=boolean');
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
  483 |  await expect(settings).toContainText('registered=null; required=boolean');await expect(settings).not.toContainText('不一致');
  484 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();await expect(desired).toBeEnabled();
  485 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  486 | });
  487 | 
  488 | for(const registered of [null,false])test(`T8 error-bearing autostart set receipt stays unknown with registration=${registered}`,async({page})=>{
  489 |  await setup(page);await nav(page,'设置').click();await tab(page,'通知与启动').click();
  490 |  const desired=page.getByLabel('登录系统后启动 Bee',{exact:true}),registration=page.locator('.ns-os-status').last(),settings=page.getByTestId('native-settings');
  491 |  await expect(registration).toContainText('未登记');
  492 |  await page.evaluate(registered=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const value=await invoke(command,args);if(command==='autostart_set')return {desired:args.enabled,registered,error:{code:registered===null?'AUTOSTART_QUERY_FAILED':'AUTOSTART_UNCONFIRMED',message:`autostart readback failed: desired=true registered=${registered}; os_code=13`}};return value;};},registered);
  493 |  await desired.check();await expect(desired).toBeChecked();await expect(desired).toBeDisabled();
  494 |  await expect(registration).toContainText('上次确认的系统登记');await expect(registration).toContainText('未登记');
  495 |  await expect(settings).toContainText(`autostart readback failed: desired=true registered=${registered}; os_code=13`);
  496 |  await expect(settings).not.toContainText('已核对系统启动登记。');await expect(settings).not.toContainText('期望启动选项与系统登记不一致');
  497 |  await page.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
  498 |  await expect(registration).toContainText('已登记');await expect(desired).toBeEnabled();await expect(settings.getByRole('alert')).toHaveCount(0);
  499 |  expect((await calls(page,'autostart_set')).length).toBe(1);
  500 | });
  501 | 
```