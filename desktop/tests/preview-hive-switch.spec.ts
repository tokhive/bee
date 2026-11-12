import {test,expect,type Page} from '@playwright/test';
async function open(page:Page,scene:string,theme='light'){
 await page.clock.install();await page.goto('/tests/fixtures/bee-preview/index.html?scene='+scene+'&theme='+theme+'&size=narrow');await expect(page.locator('#control-status')).toHaveText('场景已就绪。');await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));return page.frameLocator('iframe');
}
const calls=(page:Page)=>page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>(frame.contentWindow as any).calls);
test('saved list supports keyboard close and keeps entered URL and background operation',async({page})=>{
 const app=await open(page,'switch-saved','dark'),trigger=app.getByRole('button',{name:'切换 Hive',exact:true});await trigger.click();const list=app.getByRole('dialog',{name:'切换 Hive',exact:true});
 await list.getByLabel('Hive 地址',{exact:true}).fill('https://new-hive.example');await list.getByLabel('设备名称',{exact:true}).fill('Travel Mac');await list.press('Escape');await page.clock.runFor(10);await expect(trigger).toBeFocused();await trigger.click();await expect(list.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://new-hive.example');
 await list.getByRole('button',{name:'保存并准备切换'}).click();await expect(app.getByLabel('Hive 切换进度')).toContainText('正在准备目标 Hive');await app.getByRole('button',{name:'关闭 Hive 列表'}).click();await page.clock.runFor(2100);
 expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_cancel')).toEqual([]);await expect(app.getByLabel('Hive 切换进度')).toContainText('正在准备目标 Hive');
});
test('unknown and expired observation show no percent and continue the original operation',async({page})=>{
 const app=await open(page,'switch-paused'),progress=app.getByLabel('Hive 切换进度');await expect(progress).toContainText('自动核对已暂停');await progress.getByRole('button',{name:'继续等待',exact:true}).click();await expect(progress).not.toContainText('自动核对已暂停');expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_continue')).toHaveLength(1);
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=switch-unknown&theme=dark&size=narrow');await expect(page.locator('#control-status')).toHaveText('场景已就绪。');await expect(progress).toContainText('结果待核对');await expect(progress).toContainText('任务和结算数量待核对');expect(await progress.textContent()).not.toMatch(/\d+%/);
});
test('first profile gate permits pairing and preserves the entered Hive',async({page})=>{
 const app=await open(page,'switch-first-launch'),device=app.getByRole('region',{name:'设备配对',exact:true});await expect(app.getByTestId('startup-recovery')).toHaveCount(0);await device.getByLabel('Hive 地址',{exact:true}).fill('https://first-hive.example');await device.getByLabel('设备名称',{exact:true}).fill('First Mac');await device.getByRole('button',{name:'生成配对码',exact:true}).click();await page.clock.runFor(2100);await expect(device).toContainText('等待网页确认');await expect(device).toContainText('https://first-hive.example');
 expect((await calls(page)).filter((c:any)=>c.command==='device_begin')).toHaveLength(1);
});
test('handoff progress stays visible when the ordinary source bridge is unavailable',async({page})=>{
 const app=await open(page,'switch-handoff','dark');await expect(app.getByLabel('Hive 切换进度')).toContainText('正在连接目标 Hive');await expect(app.getByTestId('startup-recovery')).toHaveCount(0);await app.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await expect(app.getByLabel('Hive 切换进度')).toContainText('正在连接目标 Hive');
});
test('target credential rejection uses dedicated recovery and keeps A identity until commit',async({page})=>{
 const app=await open(page,'switch-target-recovery'),progress=app.getByLabel('Hive 切换进度');await expect(progress).toContainText('当前 Hive 不接受原凭据');await progress.getByRole('button',{name:'重新绑定设备',exact:true}).click();await app.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();await expect(progress).toContainText('等待网页确认');await progress.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();await page.clock.runFor(2100);await expect(progress).toContainText('新设备归属与原设备不同');await expect(app.locator('.device-facts').first()).toContainText('owner@example.test');
 const writes=(await calls(page)).filter((c:any)=>c.command.includes('recovery_confirm'));expect(writes.map((c:any)=>c.command)).toEqual(['hive_switch_target_recovery_confirm']);
});

test('main preview includes compact switching in both overview templates and preserves focus and failure input',async({page})=>{
 await page.route('**/approved-preview/**',async route=>{const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');const root=resolve(import.meta.dirname,'../../docs/preview'),relative=new URL(route.request().url()).pathname.split('/approved-preview/')[1];await route.fulfill({contentType:'text/html; charset=utf-8',body:await readFile(resolve(root,relative))});});
 for(const scene of ['switch-idle','claude-switch-waiting']){
  await page.goto('/approved-preview/index.html?scene='+scene+'&theme=dark&size=narrow');const app=page.frameLocator('iframe#screen').frameLocator('iframe#approved-overview');const trigger=app.getByRole('button',{name:'切换 Hive',exact:true});await trigger.click();const dialog=app.getByRole('dialog',{name:'切换 Hive',exact:true});await dialog.press('Escape');await expect(trigger).toBeFocused();
  if(scene==='switch-idle'){await trigger.click();await dialog.getByLabel('Hive 地址',{exact:true}).fill('https://target.example/path');await dialog.getByRole('button',{name:'保存并准备切换'}).click();await expect(dialog.getByRole('alert')).toContainText('https://target.example/path');await expect(dialog.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://target.example/path');await dialog.press('Escape');}
  else await expect(app.getByLabel('Hive 切换进度')).toContainText('正在执行 2');
 }
});

test('native exit request keeps the original operation and requires an explicit decision',async({page})=>{
 const app=await open(page,'switch-paused');await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;w.requestSwitchExit('unrelated');});await expect(app.getByRole('dialog',{name:'切换 Hive 尚未结束'})).toHaveCount(0);
 await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;const s=await w.__TAURI_INTERNALS__.invoke('hive_switch_snapshot');w.requestSwitchExit(s.operation.id);});
 const dialog=app.getByRole('dialog',{name:'切换 Hive 尚未结束'});await expect(dialog).toContainText('可能中断任务');await dialog.press('Escape');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'继续等待',exact:true}).click();await expect(dialog).toHaveCount(0);
 const decisions=(await calls(page)).filter((c:any)=>c.command==='hive_switch_quit');expect(decisions.map((c:any)=>c.args.decision)).toEqual(['continue_waiting']);expect((await calls(page)).some((c:any)=>c.command==='hive_switch_start')).toBe(false);
});

test('committed B remains current with no account selection and after an account source error',async({page})=>{
 for(const scene of ['switch-success','switch-account-error']){
  const app=await open(page,scene);await expect(app.getByLabel('Hive 切换进度')).toContainText('Hive 已切换');await expect(app.locator('.device-facts').first()).toContainText('https://target-hive.example');
  const state=await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>{const w=frame.contentWindow as any;return {snapshot:await w.__TAURI_INTERNALS__.invoke('hive_switch_snapshot'),selection:w.accounts.openai.selection.state};});expect(state.snapshot.profiles.current_profile).toBe('2'.repeat(32));expect(state.selection).toBe('not_selected');
  await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await page.clock.runFor(2200);await expect(app.getByLabel('Hive 切换进度')).toHaveCount(0);
  const after=await page.locator('iframe').evaluate(async(frame:HTMLIFrameElement)=>(frame.contentWindow as any).__TAURI_INTERNALS__.invoke('hive_switch_snapshot'));expect(after.profiles.current_profile).toBe(state.snapshot.profiles.current_profile);expect(after.operation.phase).toBe('succeeded');
 }
});

test('native add rejection preserves the URL, device name and saved profiles',async({page})=>{
 const app=await open(page,'switch-saved');await app.getByRole('button',{name:'切换 Hive',exact:true}).click();const list=app.getByRole('dialog',{name:'切换 Hive',exact:true});await list.getByLabel('Hive 地址',{exact:true}).fill('https://target.example/path');await list.getByLabel('设备名称',{exact:true}).fill('Road Mac');await list.getByRole('button',{name:'保存并准备切换'}).click();await expect(list).toContainText('Hive address rejected');await page.clock.runFor(2200);await expect(list).toContainText('Hive address rejected');await expect(list.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://target.example/path');await expect(list.getByLabel('设备名称',{exact:true})).toHaveValue('Road Mac');expect((await calls(page)).filter((c:any)=>c.command==='hive_switch_start')).toHaveLength(1);
});
