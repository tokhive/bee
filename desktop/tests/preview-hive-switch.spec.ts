import {test,expect,type Page} from '@playwright/test';
async function open(page:Page,scene:string,theme='light'){
 await page.clock.install();await page.goto('/tests/fixtures/bee-preview/index.html?scene='+scene+'&theme='+theme+'&size=narrow');await expect(page.locator('#control-status')).toHaveText('场景已就绪。');await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));return page.frameLocator('iframe');
}
const calls=(page:Page)=>page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).calls);
test('delivered A notification cannot navigate B or a stale A UI snapshot and global routes remain available',async({page})=>{
 const app=await open(page,'switch-saved');
 const source={profile_id:'1'.repeat(32),origin:'https://hive.example'};
 const activate=(payload:unknown)=>page.locator('iframe').evaluate((frame:HTMLIFrameElement,payload)=>(frame.contentWindow as any).emitNotification(payload),payload);
 await activate({target:{page:'accounts',source},current_profile:'2'.repeat(32),can_navigate:false});
 await expect(app.getByRole('status').filter({hasText:'此通知来自 Hive'})).toContainText('https://hive.example');
 await expect(app.getByRole('navigation').getByRole('button',{name:'概览',exact:true})).toHaveAttribute('aria-current','page');
 await app.getByRole('button',{name:'关闭通知提示',exact:true}).click();
 await activate({target:{page:'accounts',source},current_profile:'1'.repeat(32),can_navigate:true});
 await expect(app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true})).toHaveAttribute('aria-current','page');
 await activate('settings');
 await expect(app.getByRole('navigation').getByRole('button',{name:'设置',exact:true})).toHaveAttribute('aria-current','page');
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=switch-success&theme=dark&size=narrow');
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 await activate({target:{page:'accounts',source},current_profile:'2'.repeat(32),can_navigate:false});
 await expect(app.getByRole('status').filter({hasText:'此通知来自 Hive'})).toContainText('https://hive.example');
 await app.getByRole('button',{name:'查看 Hive 列表',exact:true}).click();
 await expect(app.getByRole('dialog',{name:'切换 Hive',exact:true})).toBeVisible();
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_start')).toEqual([]);
});
test('historical conflict is explained and disables only the affected saved target',async({page})=>{
 const app=await open(page,'switch-saved');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any,original=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const result=await original(command,args);if(command==='hive_switch_snapshot')result.profiles.profiles[1].blockers=['historical_origin_conflict:https://target-hive.example'];return result;};});
 await page.clock.runFor(2100);await openSwitch(app,page);
 const dialog=app.getByRole('dialog',{name:'切换 Hive',exact:true}),target=dialog.locator('li').filter({hasText:'https://target-hive.example'});
 await expect(target).toContainText('历史 Hive 地址归一化后冲突');
 await expect(target.getByRole('button',{name:'切换到此 Hive'})).toBeDisabled();
 await expect(dialog.locator('li').filter({hasText:'https://hive.example'})).toContainText('当前');
 await expect(dialog).not.toContainText('historical_origin_conflict');
});
test('first target pairing retains the fixed Hive origin before a device config exists',async({page})=>{
 const app=await open(page,'switch-target-pairing'),target=app.getByRole('region',{name:'目标 Hive 设备',exact:true});
 await expect(app.getByLabel('Hive 切换进度')).toContainText('https://target-hive.example');
 await expect(target.getByRole('textbox')).toHaveCount(0);
 await target.getByRole('button',{name:'生成目标配对码',exact:true}).click();
 await expect(target).toContainText('等待目标 Hive 网页确认');
 await expect(app.locator('.device-card')).toHaveCount(1);
 await expect(app.locator('.device-card-facts')).toHaveCount(1);
 await expect(target.getByRole('heading',{name:'目标 Hive 设备',exact:true})).toHaveCount(0);
 await expect(target.getByRole('button',{name:'取消切换',exact:true})).toBeVisible();
 await expect(app.locator('.toolbar')).toHaveCount(0);
 await expect(app.locator('footer')).toHaveCount(0);
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_target_begin')).toHaveLength(1);
});
test('saved list supports keyboard close and keeps entered URL and background operation',async({page})=>{
 const app=await open(page,'switch-saved','dark'),trigger=app.getByRole('button',{name:'设备操作',exact:true});await openSwitch(app,page);const list=app.getByRole('dialog',{name:'切换 Hive',exact:true});
 await list.getByLabel('Hive 地址',{exact:true}).fill('https://new-hive.example');await list.getByLabel('设备名称',{exact:true}).fill('Travel Mac');await list.press('Escape');await page.clock.runFor(10);await expect(trigger).toBeFocused();await openSwitch(app,page);await expect(list.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://new-hive.example');
 await list.getByRole('button',{name:'保存并准备切换'}).click();await expect(app.getByLabel('Hive 切换进度')).toContainText('正在准备目标 Hive');await app.getByRole('button',{name:'关闭 Hive 列表'}).click();await page.clock.runFor(2100);
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_cancel')).toEqual([]);await expect(app.getByLabel('Hive 切换进度')).toContainText('正在准备目标 Hive');
});
test('unknown and expired observation show no percent and continue the original operation',async({page})=>{
 const app=await open(page,'switch-paused'),progress=app.getByLabel('Hive 切换进度');await expect(progress).toContainText('自动核对暂停后');await progress.getByRole('button',{name:'继续等待',exact:true}).click();await expect(progress).not.toContainText('自动核对暂停后');expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_continue')).toHaveLength(1);
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=switch-unknown&theme=dark&size=narrow');await expect(page.locator('#control-status')).toHaveText('场景已就绪。');await expect(progress).toContainText('切换结果尚未确认');await expect(progress.getByRole('button',{name:'重新核对',exact:true})).toBeVisible();expect(await progress.textContent()).not.toMatch(/\d+%/);
});
test('first profile gate permits pairing and preserves the entered Hive',async({page})=>{
 const app=await open(page,'switch-first-launch'),device=app.locator('.first-launch-wizard');await expect(app.getByTestId('startup-recovery')).toHaveCount(0);await device.getByLabel('Hive 地址',{exact:true}).fill('https://first-hive.example');await device.getByLabel('设备名称',{exact:true}).fill('First Mac');await device.getByRole('button',{name:'继续绑定设备',exact:true}).click();await page.clock.runFor(2100);await expect(device).toContainText('在 Hive 网页确认设备归属');await expect(device).toContainText('https://first-hive.example');
 expect((await calls(page)).filter((c:any)=>c.command==='device_begin')).toHaveLength(1);
});
test('handoff progress stays visible when the ordinary source bridge is unavailable',async({page})=>{
 const app=await open(page,'switch-handoff','dark');await expect(app.getByLabel('Hive 切换进度')).toContainText('正在连接目标 Hive');await expect(app.getByTestId('startup-recovery')).toHaveCount(0);await app.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await expect(app.getByLabel('Hive 切换进度')).toContainText('正在连接目标 Hive');
});
test('target credential rejection uses dedicated recovery and keeps A identity until commit',async({page})=>{
 const app=await open(page,'switch-target-recovery'),progress=app.getByLabel('Hive 切换进度');await expect(progress).toContainText('设备绑定需要修复');await progress.getByRole('button',{name:'修复设备绑定',exact:true}).click();await app.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();await expect(progress).toContainText('等待目标 Hive 网页确认');await progress.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();await page.clock.runFor(2100);await expect(progress).toContainText('新设备归属与原设备不同');await expect(app.locator('.device-card-facts').first()).toContainText('owner@example.test');
 const writes=(await calls(page)).filter((c:any)=>c.command.includes('recovery_confirm'));expect(writes.map((c:any)=>c.command)).toEqual(['hive_switch_target_recovery_confirm']);
});

test('main preview includes compact switching in both overview templates and preserves focus and failure input',async({page})=>{
 await page.route('**/approved-preview/**',async route=>{const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');const root=resolve(import.meta.dirname,'../../docs/preview'),relative=new URL(route.request().url()).pathname.split('/approved-preview/')[1];await route.fulfill({contentType:'text/html; charset=utf-8',body:await readFile(resolve(root,relative))});});
 for(const scene of ['switch-idle','claude-switch-waiting']){
  await page.goto('/approved-preview/index.html?scene='+scene+'&theme=dark&size=narrow');const app=page.frameLocator('iframe#screen').frameLocator('iframe#approved-overview');const trigger=app.getByRole('button',{name:'设备操作',exact:true});await trigger.click();await app.getByRole('button',{name:'切换 Hive',exact:true}).click();const dialog=app.getByRole('dialog',{name:'切换 Hive',exact:true});await dialog.press('Escape');await expect(trigger).toBeFocused();
  if(scene==='switch-idle'){await trigger.click();await app.getByRole('button',{name:'切换 Hive',exact:true}).click();await dialog.getByLabel('Hive 地址',{exact:true}).fill('https://target.example/path');await dialog.getByRole('button',{name:'保存并准备切换'}).click();await expect(dialog.getByRole('alert')).toContainText('https://target.example/path');await expect(dialog.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://target.example/path');await dialog.press('Escape');}
  else await expect(app.getByLabel('Hive 切换进度')).toContainText('正在执行 2');
 }
});

test('native exit request keeps the original operation and requires an explicit decision',async({page})=>{
 const app=await open(page,'switch-paused');await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;w.requestSwitchExit('unrelated');});await expect(app.getByRole('dialog',{name:'切换 Hive 尚未结束'})).toHaveCount(0);
 await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;const s=await w.__TAURI_INTERNALS__.invoke('hive_switch_snapshot');w.requestSwitchExit(s.operation.id);});
 const dialog=app.getByRole('dialog',{name:'切换 Hive 尚未结束'});await expect(dialog).toContainText('可能中断任务');await dialog.press('Escape');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'继续等待',exact:true}).click();await expect(dialog).toHaveCount(0);
 const decisions=(await calls(page)).filter((c:any)=>c.command==='hive_switch_quit');expect(decisions.map((c:any)=>c.args.decision)).toEqual(['continue_waiting']);expect((await calls(page)).some((c:any)=>c.command==='hive_switch_start')).toBe(false);
 await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;const state=await w.__TAURI_INTERNALS__.invoke('hive_switch_snapshot');w.requestSwitchExit(state.operation.id);});await dialog.getByRole('button',{name:'取消切换并退出',exact:true}).click();
 const pending=await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>(frame.contentWindow as any).__TAURI_INTERNALS__.invoke('hive_switch_snapshot'));expect(pending.operation.quit_requested).toBe(true);expect(pending.operation.cancel_requested).toBe(true);expect(pending.operation.phase).toBe('draining_source');await expect(app.getByLabel('Hive 切换进度')).not.toContainText('切换已取消');
});

test('committed B remains current with no account selection and after an account source error',async({page})=>{
 for(const scene of ['switch-success','switch-account-error']){
  const app=await open(page,scene);await expect(app.getByText('Hive 已切换。',{exact:true})).toBeVisible();await expect(app.getByLabel('Hive 切换进度')).toHaveCount(0);await expect(app.locator('.device-card-facts').first()).toContainText('https://target-hive.example');
  const state=await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;return {snapshot:await w.__TAURI_INTERNALS__.invoke('hive_switch_snapshot'),selection:w.accounts.openai.selection.state};});expect(state.snapshot.profiles.current_profile).toBe('2'.repeat(32));expect(state.selection).toBe('not_selected');
  await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.clock.runFor(2200);await expect(app.getByLabel('Hive 切换进度')).toHaveCount(0);
  const after=await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>(frame.contentWindow as any).__TAURI_INTERNALS__.invoke('hive_switch_snapshot'));expect(after.profiles.current_profile).toBe(state.snapshot.profiles.current_profile);expect(after.operation.phase).toBe('succeeded');
 }
});

test('native add rejection preserves the URL, device name and saved profiles',async({page})=>{
 const app=await open(page,'switch-saved');await openSwitch(app,page);const list=app.getByRole('dialog',{name:'切换 Hive',exact:true});await list.getByLabel('Hive 地址',{exact:true}).fill('https://target.example/path');await list.getByLabel('设备名称',{exact:true}).fill('Road Mac');await list.getByRole('button',{name:'保存并准备切换'}).click();await expect(list).toContainText('Hive address rejected');await page.clock.runFor(2200);await expect(list).toContainText('Hive address rejected');await expect(list.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://target.example/path');await expect(list.getByLabel('设备名称',{exact:true})).toHaveValue('Road Mac');expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_start')).toHaveLength(1);
});

test('first Hive setup uses the wizard before a native child exists and retains the pairing flow',async({page})=>{
 const app=await open(page,'switch-first-launch');
 await expect(app.getByLabel('Hive 地址',{exact:true})).toBeVisible();
 await expect(app.getByRole('navigation')).toHaveCount(0);
 expect((await calls(page)).filter((c:any)=>['device_begin','account_action','runtime_start'].includes(c.command))).toEqual([]);
 await app.getByLabel('Hive 地址',{exact:true}).fill('https://first-hive.example');
 await app.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await page.clock.runFor(2500);
 await expect(app.getByRole('navigation')).toHaveCount(0);
 await expect(app.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).__beePreviewApprove());
 await page.clock.runFor(5000);
 await expect(app.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible();
 await app.getByRole('button',{name:'进入概览',exact:true}).click();
 await openSwitch(app,page);await expect(app.getByRole('dialog',{name:'切换 Hive',exact:true})).toBeVisible();
 expect((await calls(page)).filter((c:any)=>c.command==='device_begin')).toHaveLength(1);
});

async function openSwitch(app:import('@playwright/test').FrameLocator,page:Page){
 await app.getByRole('button',{name:'设备操作',exact:true}).click();
 await app.getByRole('menuitem',{name:'切换 Hive',exact:true}).click();await page.clock.runFor(50);
}

for(const cancelling of [false,true])test(`${cancelling?'cancel':'switch'} unknown result rechecks once and keeps the original Hive`,async({page})=>{
 const app=await open(page,'switch-unknown');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement,cancelling)=>{
  const w=frame.contentWindow as any,invoke=w.__TAURI_INTERNALS__.invoke;w.heldSwitchReads=[];
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='hive_switch_observe'&&w.holdSwitchRead){w.heldSwitchReads.push(command);await new Promise(resolve=>{w.releaseSwitchRead=resolve;});}
   const reply=await invoke(command,args);
   if(cancelling&&['hive_switch_observe','hive_switch_snapshot'].includes(command)&&reply.operation)reply.operation.cancel_requested=true;
   return reply;
  };
 },cancelling);
 await page.clock.runFor(2100);
 const progress=app.getByLabel('Hive 切换进度');
 await expect(progress).toContainText(cancelling?'取消结果尚未确认':'切换结果尚未确认');
 if(cancelling)await expect(progress.getByRole('button',{name:'取消切换',exact:true})).toHaveCount(0);
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{(frame.contentWindow as any).holdSwitchRead=true;});
 await progress.getByRole('button',{name:'重新核对',exact:true}).click();
 await expect(progress).toContainText(cancelling?'正在核对取消结果…':'正在核对切换结果…');
 await expect(progress.getByRole('button')).toHaveCount(0);
 expect(await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).heldSwitchReads)).toHaveLength(1);
 await expect(app.locator('.device-card-facts').first()).toContainText('https://hive.example');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;w.holdSwitchRead=false;w.releaseSwitchRead();});
 await expect(progress.getByRole('button',{name:'重新核对',exact:true})).toBeEnabled();
 expect((await calls(page)).filter((c:any)=>['hive_switch_start','hive_switch_cancel','device_begin','device_recovery_confirm'].includes(c.command))).toEqual([]);
});

test('pending switch cancellation shows progress before its confirmed result',async({page})=>{
 const app=await open(page,'switch-waiting'),progress=app.getByLabel('Hive 切换进度');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{
  const w=frame.contentWindow as any,invoke=w.__TAURI_INTERNALS__.invoke;w.cancelSubmissions=0;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   if(command==='hive_switch_cancel'){w.cancelSubmissions++;await new Promise(resolve=>{w.releaseCancelSwitch=resolve;});}
   return invoke(command,args);
  };
 });
 await progress.getByRole('button',{name:'取消切换',exact:true}).click();
 await expect(progress).toContainText('正在取消切换…');
 await expect(progress.getByRole('button',{name:'取消切换',exact:true})).toHaveCount(0);
 await expect(progress.getByRole('button')).toHaveCount(0);
 expect(await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).cancelSubmissions)).toBe(1);
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).releaseCancelSwitch());
 await expect(app.getByText('切换已取消，仍使用原 Hive。',{exact:true})).toBeVisible();
 await expect(progress).toHaveCount(0);await expect(app.locator('.device-card-facts').first()).toContainText('https://hive.example');
 await app.getByRole('button',{name:'关闭切换结果提示',exact:true}).click();
 await expect(app.getByRole('button',{name:'设备操作',exact:true})).toBeFocused();
 expect((await calls(page)).filter((c:any)=>['hive_switch_cancel','hive_switch_start','runtime_start','supply_set_paused'].includes(c.command)).map((c:any)=>c.command)).toEqual(['hive_switch_cancel']);
});

test('manual switch cancellation waits for a background read without disabling or losing the click',async({page})=>{
 const app=await open(page,'switch-unknown'),progress=app.getByLabel('Hive 切换进度');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{
  const w=frame.contentWindow as any,invoke=w.__TAURI_INTERNALS__.invoke;let held=false;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const result=await invoke(command,args);
   if(!held&&command==='hive_switch_observe'){held=true;w.backgroundReadHeld=true;return new Promise(resolve=>{w.releaseBackgroundRead=()=>resolve(result);});}
   return result;
  };
 });
 await page.clock.runFor(2100);
 await expect.poll(()=>page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).backgroundReadHeld)).toBe(true);
 const cancel=progress.getByRole('button',{name:'取消切换',exact:true});
 await expect(cancel).toBeEnabled();await cancel.click();
 await expect(progress).toContainText('正在取消切换');
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_cancel')).toHaveLength(0);
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).releaseBackgroundRead());
 await expect.poll(async()=>(await calls(page)).filter((c:any)=>c.command==='hive_switch_cancel').length).toBe(1);
});

test('completed target binding keeps paused switch status and continuation available',async({page})=>{
 const app=await open(page,'switch-target-pairing');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{
  const w=frame.contentWindow as any,invoke=w.__TAURI_INTERNALS__.invoke;
  const identity={id:'target-device',name:'Target Mac',owner_id:'target-owner',owner_email:'target-owner@example.test'};
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const result=await invoke(command,args);
   if(command==='hive_switch_snapshot'||command==='hive_switch_observe'){
    result.observation={state:'paused',reason:'round_elapsed',next_query_at:null};
    result.actions.can_continue=true;result.actions.can_observe=false;
   }
   if(command==='hive_switch_target_status')return {result:{device:{state:'bound',hive:'https://target-hive.example',name:identity.name,identity}}};
   if(command==='hive_switch_target_recovery_status')return {result:{recovery:{purpose:'initial_pairing',operation_id:'c'.repeat(48),revision:5,phase:'completed',old_identity:null,new_identity:identity,pairing:null,failure:null}}};
   return result;
  };
 });
 await page.clock.runFor(2100);
 const progress=app.getByLabel('Hive 切换进度');
 await expect(progress).toContainText('正在准备目标 Hive');
 await expect(progress.getByRole('button',{name:'继续等待',exact:true})).toBeVisible();
 await expect(progress.getByRole('button',{name:'取消切换',exact:true})).toBeVisible();
 await expect(app.locator('.device-card-facts').first()).toContainText('https://hive.example');
 await progress.getByRole('button',{name:'继续等待',exact:true}).click();
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_continue')).toHaveLength(1);
 expect((await calls(page)).filter((c:any)=>['hive_switch_start','hive_switch_target_begin','hive_switch_target_recovery_confirm'].includes(c.command))).toEqual([]);
});

test('source connection failure uses approved unknown layout and rechecks the paused operation',async({page})=>{
 const app=await open(page,'switch-unknown');
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{
  const w=frame.contentWindow as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const result=await invoke(command,args);
   if(['hive_switch_snapshot','hive_switch_observe'].includes(command)){
    result.observation={state:'paused',reason:'query_failed',next_query_at:null};
    result.actions.can_continue=true;result.actions.can_observe=false;
    result.operation.failure={code:'HIVE_SWITCH_SOURCE_UNVERIFIED',message:'source GET device-drain-capabilities connection refused',details:{check:'device_drain',observed_at:new Date().toISOString(),evidence:{failure_kind:'connection_refused'}}};
   }return result;
  };
 });
 await page.clock.runFor(2100);
 const progress=app.getByLabel('Hive 切换进度');
 await expect(progress).toContainText('原 Hive 拒绝网络连接，任务状态尚未确认。');
 await expect(progress).not.toContainText('自动核对暂停后');
 expect(await progress.locator('.switch-failure').evaluate(e=>!!(e.compareDocumentPosition(e.parentElement!.querySelector('.hive-switch-route')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 const details=progress.getByRole('button',{name:'查看切换错误详情',exact:true});await details.click();
 const dialog=app.getByRole('dialog',{name:'错误详情',exact:true});await expect(dialog).toContainText('HIVE_SWITCH_SOURCE_UNVERIFIED');
 await dialog.press('Escape');await page.clock.runFor(50);await expect(dialog).toHaveCount(0);await expect(details).toBeFocused();
 await progress.getByRole('button',{name:'重新核对',exact:true}).click();
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_continue')).toHaveLength(1);
});

test('generic startup recovery uses the approved standalone region and returns to the bound overview',async({page})=>{
 const app=await open(page,'switch-saved');
 const emit=async(state:string,revision:number)=>page.locator('iframe').evaluate(async(frame:HTMLIFrameElement,{state,revision})=>{
  const w=frame.contentWindow as any;
  w.emitStartup({...await w.__TAURI_INTERNALS__.invoke('startup_status'),state,revision,observed_at:new Date().toISOString(),recovering:true,can_retry:state==='blocked',failure:state==='blocked'?{code:'REQUEST_RESOURCE_BUSY',message:'runtime_configure_network conflicts with device_status; request not sent',details:{check:'startup_check',observed_at:new Date().toISOString(),evidence:{}}}:null});
 },{state,revision});
 await emit('blocked',100);
 const notice=app.getByTestId('startup-recovery');
 await expect(notice).toContainText('暂时无法恢复 Bee');
 await expect(app.getByRole('region',{name:'设备与 Hive'})).toHaveCount(0);
 expect(await notice.evaluate(el=>el.closest('.device-card'))).toBeNull();
 await notice.getByText('错误详情',{exact:true}).click();await expect(notice).toContainText('runtime_configure_network');
 await emit('ready',101);
 await expect(notice).toHaveCount(0);await expect(app.getByRole('heading',{name:'设备与 Hive',exact:true})).toBeVisible();
 await expect(app.getByText('后台已连接，服务未启动。',{exact:true})).toHaveCount(0);
});

test('handoff explains confirmed source shutdown without requesting a device recheck',async({page})=>{
 const app=await open(page,'switch-handoff');
 const progress=app.getByLabel('Hive 切换进度');
 await expect(progress).toContainText('原后台已安全退出，正在核验目标连接。');
 await expect(app.getByText('设备状态尚未确认，请重新检查设备。',{exact:true})).toHaveCount(0);
 await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{
  const w=frame.contentWindow as any,prior=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   const reply=await prior(command,args);
   if(reply?.operation)reply.operation.source.ipc_empty=false;
   return reply;
  };
 });
 await progress.getByRole('button',{name:'重新核对',exact:true}).click();
 await expect(progress.locator('.pairing-phase')).toHaveText('正在连接目标 Hive');
 await expect(progress).not.toContainText('原后台已安全退出，正在核验目标连接。');
 expect((await calls(page)).filter((c:any)=>['hive_switch_start','hive_switch_cancel','device_begin','runtime_start','supply_set_paused'].includes(c.command))).toEqual([]);
});
