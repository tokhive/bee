import {test,expect,type Page,type FrameLocator} from '@playwright/test';

const card=(app:FrameLocator,name='OpenAI')=>app.getByRole('region',{name:`${name} 账号`,exact:true,includeHidden:true});
const status=(app:FrameLocator,name='OpenAI')=>card(app,name).locator('.oa-title,.account-status-block>.native-account-condition');
async function open(page:Page,scene='candidate',debug=true){
 // Keep the 860×600 application viewport visible below the acceptance controls.
 await page.setViewportSize({width:1280,height:1000});
 await page.clock.install();
 await page.goto(`/tests/fixtures/bee-preview/index.html?scene=accounts-auto-${scene}&theme=light&size=narrow${debug?'&debug=1':''}`);
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 return page.frameLocator('iframe');
}
async function event(page:Page,action:string,value:string,platform='openai'){
 if(await page.locator('#simulation-details').count())await page.locator('#simulation-details').evaluate((el:HTMLDetailsElement)=>{el.open=true;});
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 if(['login-result','account-source','account-refresh'].includes(action))await page.locator('#event-platform').selectOption(platform);
 if(action==='account-source')await page.locator('#event-store').selectOption(platform==='openai'?'file':'keychain');
 await page.getByRole('button',{name:'应用模拟条件',exact:true}).click();
 await expect(page.locator('#control-status')).not.toHaveText('正在更新模拟条件…');
}

test('account preview prevents events before their prerequisites and clears stale feedback',async({page})=>{
 await open(page,'empty');
 const disclosure=page.locator('#simulation-details');
 if(await disclosure.count())await disclosure.locator('summary').click();
 await page.locator('#event-kind').selectOption('account-refresh');
 await expect(page.locator('#event-apply')).toBeDisabled();
 await expect(page.locator('#event-help')).toContainText('尚未接入');
 await page.locator('#event-kind').selectOption('login-result');
 await expect(page.locator('#event-apply')).toBeDisabled();
 await expect(page.locator('#event-help')).toContainText('开始官方登录');
 await page.locator('#event-kind').selectOption('account-source');
 await page.locator('#event-value').selectOption('denied');
 await page.locator('#event-apply').click();
 await expect(page.locator('#control-status')).toContainText('拒绝读取');
 await disclosure.locator('summary').click();
 await page.locator('#event-kind').selectOption('account-refresh');
 await expect(page.locator('#control-status')).toBeEmpty();
});
const wizard=(app:FrameLocator)=>app.getByRole('region',{name:'添加账号',exact:true});
async function chooseOpenAI(app:FrameLocator){await wizard(app).getByRole('button',{name:'OpenAI',exact:true}).click();}
async function settle(page:Page){await page.clock.runFor(11000);}
test('unconnected accounts keep login first when the Hive connection needs attention',async({page})=>{
 const app=await open(page,'empty');
 await event(page,'runtime-connection','connecting');await settle(page);
 await chooseOpenAI(app);
 await expect(wizard(app)).not.toContainText('Hive 未看到');
 await expect(wizard(app).getByRole('button',{name:'查看连接',exact:true})).toHaveCount(0);
 await expect(wizard(app).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
});

test('selected accounts inspect connection evidence and preserve pause after recovery',async({page})=>{
 const app=await open(page,'paused');
 await event(page,'runtime-connection','rejected');await settle(page);
 await expect(status(app)).toHaveText('已暂停');
 await expect(card(app)).toContainText('Hive 未看到此平台的 Bee 连接');
 await card(app).getByRole('button',{name:'查看相关设置',exact:true}).click();
 await expect(app.getByText('Hive 拒绝连接',{exact:true})).toBeVisible();
 await app.getByRole('region',{name:'服务状态',exact:true}).getByText('查看失败详情',{exact:true}).click();
 await expect(app.getByRole('region',{name:'服务状态',exact:true}).locator('pre')).toContainText('401');
 await event(page,'runtime-connection','online');await settle(page);
 await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await expect(card(app)).not.toContainText('Hive 未看到');
});
async function calls(page:Page,command:string){return page.locator('iframe').evaluate((el:HTMLIFrameElement,command)=>(el.contentWindow as any).calls.filter((c:any)=>c.command===command),command);}
async function relogin(app:FrameLocator){
 await card(app).getByRole('button',{name:'OpenAI 详情'}).click();
 await app.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 const confirm=app.getByRole('dialog').last();
 await expect(confirm).toContainText('将暂停此平台接单');
 await confirm.getByRole('button',{name:'开始官方登录',exact:true}).click();
 await app.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await expect(card(app).getByRole('button',{name:'取消登录',exact:true})).toBeEnabled();
}

test('candidate connects, prepares automatically, resumes and pauses without a global start',async({page})=>{
 const app=await open(page);
 await chooseOpenAI(app);
 await expect(card(app)).toHaveCount(0);
 const dialog=wizard(app);
 await expect(dialog).toContainText('订阅额度');
 await dialog.getByRole('button',{name:'确认接入',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('账号接入成功！');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('可接单');
 await card(app).getByRole('button',{name:'暂停接单'}).click();
 await expect(status(app)).toHaveText('已暂停');
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 await expect(status(app)).toHaveText('已暂停接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
 expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('permission evidence and pause remain independent; saved source repair preserves pause',async({page})=>{
 const app=await open(page,'error');
 await expect(status(app)).toHaveText('没有读取所选凭证来源的权限。');
 await expect(card(app).getByRole('button',{name:'登录 OpenAI',exact:true})).toHaveCount(0);
 await expect(card(app).getByText('接单保持暂停。',{exact:true})).toBeVisible();
 await card(app).getByRole('button',{name:'查看错误详情',exact:true}).click();
 await expect(app.getByRole('dialog',{name:'错误详情'})).toContainText('permission_denied');
 await page.keyboard.press('Escape');
 await card(app).getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog.getByLabel('读取目录')).toBeFocused();
 await dialog.getByLabel('读取目录').fill('/tmp/codex');
 await page.locator('#simulation-details').evaluate((el:HTMLDetailsElement)=>{el.open=true;});
 await page.locator('#event-kind').selectOption('account-source');
 await page.locator('#event-directory').fill('/tmp/codex');
 await event(page,'account-source','available');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('账号读取已修复');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await card(app).getByRole('button',{name:'恢复接单'}).click();
 await expect(status(app)).toHaveText('可接单');
 expect(await calls(page,'authorize_start')).toHaveLength(0);
});

test('same-account login pauses only the target; another identity waits for switch confirmation',async({page})=>{
 const app=await open(page,'running');
 await relogin(app);
 await event(page,'login-result','succeeded-same');
 await settle(page);
 await expect(status(app)).toHaveText('重新登录成功');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await expect(status(app,'Claude')).toHaveText('可接单');
 await relogin(app);
 await event(page,'login-result','succeeded');
 await settle(page);
 await expect(status(app)).toHaveText('发现不同账号');
 await card(app).getByRole('button',{name:'核对账号变更',exact:true}).click();
 const dialog=app.getByRole('dialog');
 expect(await calls(page,'account_action')).toHaveLength(0);
 await dialog.getByRole('button',{name:'确认换号',exact:true}).click();
 await expect(app.getByRole('dialog').last()).toContainText('已接入账号');
 await app.getByRole('dialog').last().getByRole('button',{name:'确认更换'}).click();
 await expect(status(app,'Claude')).toHaveText('可接单');
 await settle(page);
 await page.keyboard.press('Escape');
 await expect(status(app)).toHaveText('账号更换成功');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await expect(status(app,'Claude')).toHaveText('可接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
});

test('failed login can retry; cancellation disables further simulated login results',async({page})=>{
 const app=await open(page,'running');
 await relogin(app);
 await event(page,'login-result','failed');
 await settle(page);
 await relogin(app);
 await card(app).getByRole('button',{name:'取消登录',exact:true}).click();
 await page.locator('#simulation-details>summary').click();
 await page.locator('#event-kind').selectOption('login-result');
 await expect(page.locator('#event-apply')).toBeDisabled();
 await expect(page.locator('#event-help')).toContainText('当前没有进行中的登录');
 await expect(status(app)).toHaveText('已取消登录');
 await expect(card(app).getByText('接单保持暂停。',{exact:true})).toBeVisible();
 await expect(status(app,'Claude')).toHaveText('可接单');
 expect(await calls(page,'authorize_start')).toHaveLength(2);
});

test('disconnect, simulated restart and stale report preserve the pause choice',async({page})=>{
 const app=await open(page,'running');
 await card(app).getByRole('button',{name:'暂停接单'}).click();
 await expect(status(app)).toHaveText('已暂停');
 await event(page,'runtime-connection','offline');await settle(page);
 await expect(status(app)).toHaveText('无法更新账号状态');
 await event(page,'runtime-connection','online');await settle(page);
 await expect(status(app)).toHaveText('已暂停');
 await event(page,'account-refresh','same-account');await settle(page);
 await expect(status(app)).toHaveText('已暂停');
 await event(page,'account-service','restart');await settle(page);
 await expect(status(app)).toHaveText('已暂停');
 await expect(status(app,'Claude')).toHaveText('可接单');
 await event(page,'account-service','stale');await settle(page);
 await expect(status(app)).toHaveText('账号状态待更新');
 await expect(card(app).getByRole('button',{name:'恢复接单'})).toBeDisabled();
 await event(page,'account-service','fresh');await settle(page);
 await expect(status(app)).toHaveText('已暂停');
 expect(await calls(page,'supply_set_paused')).toHaveLength(1);
});

test('lost resume receipt is reconciled without replaying the write',async({page})=>{
 const app=await open(page,'paused');
 await event(page,'supply-write-result','unknown-next');
 await card(app).getByRole('button',{name:'恢复接单'}).click();
 await expect(status(app)).toHaveText('无法更新账号状态');
 await card(app).getByRole('button',{name:'核对结果',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('可接单');
 expect(await calls(page,'supply_set_paused')).toHaveLength(1);
});

test('lost connect receipt preserves one operation and the latest intake choice',async({page})=>{
 const app=await open(page);
 await event(page,'account-operation-result','unknown-next');
 await chooseOpenAI(app);
 await wizard(app).getByRole('button',{name:'确认接入',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('可接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
});

test('dark English narrow layout exposes one status and has no horizontal overflow',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/app.html?scene=accounts-auto-error&theme=dark&locale=en');
 await page.setViewportSize({width:860,height:600});
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 const row=page.getByRole('region',{name:'OpenAI account',exact:true});
 await expect(row.locator('.oa-title')).toHaveCount(1);
 await row.getByRole('button',{name:'View error details',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Error details'})).toContainText('permission_denied');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:test.info().outputPath('auto-accounts-dark-en.png')});
});


test('service preparation failure exposes evidence and a retry preserving pause',async({page})=>{
 const app=await open(page,'paused');
 await event(page,'account-service','failed');await settle(page);
 await expect(status(app)).toHaveText('无法更新账号状态');
 await card(app).getByRole('button',{name:'查看错误详情',exact:true}).click();
 await expect(app.getByRole('dialog',{name:'错误详情'})).toContainText('simulated_failure=true');
 await page.keyboard.press('Escape');
 await app.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await app.getByRole('region',{name:'服务状态',exact:true}).getByRole('button',{name:'重试准备',exact:true}).click();
 await settle(page);
 await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 expect((await calls(page,'runtime_start'))[0].args.request.resume_platforms).toEqual([]);
});

test('account acceptance guides first login without configuring external events',async({page})=>{
 const app=await open(page,'empty',false);
 await expect(page.getByRole('navigation',{name:'账号验收项目'}).getByRole('button')).toHaveCount(3);
 await expect(page.locator('#scene')).toBeHidden();
 await expect(page.locator('#simulation-details')).toBeHidden();
 await expect(page.locator('#scene option')).toHaveCount(7);
 await expect(page.locator('#event-kind option[value="autostart-registration"]')).toHaveCount(0);
 await expect(page.locator('#simulation-details')).not.toHaveAttribute('open','');
 await expect(page.locator('#guide-text')).toContainText('登录 OpenAI');
 await expect(page.locator('#guide-action')).toBeHidden();
 await chooseOpenAI(app);
 await wizard(app).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await expect(page.locator('#guide-action')).toHaveText('模拟登录成功');
 await page.locator('#guide-action').click();
 await settle(page);
 await expect(wizard(app).getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();
 await expect(page.locator('#guide-action')).toBeHidden();
 await expect(page.locator('#guide-text')).toContainText('接入');
 await wizard(app).getByRole('button',{name:'确认接入',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('账号接入成功！');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await card(app).getByRole('button',{name:'恢复接单',exact:true}).click();
 await expect(status(app)).toHaveText('可接单');
 expect((await calls(page,'authorize_start')).length).toBe(1);
});

async function saveSource(app:FrameLocator,directory:string){
 const dialog=app.getByRole('dialog');
 await dialog.getByLabel('读取目录').fill(directory);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
}
test('simple acceptance switches tasks and guides error recovery without external events',async({page})=>{
 const app=await open(page,'empty',false);
 await page.getByRole('button',{name:'暂停与恢复',exact:true}).click();
 await expect(status(app)).toHaveText('可接单');
 await expect(page.locator('#guide-text')).toContainText('暂停接单');
 await card(app).getByRole('button',{name:'暂停接单',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await expect(page.locator('#guide-text')).toContainText('恢复接单');
 await page.getByRole('button',{name:'故障恢复',exact:true}).click();
 await expect(status(app)).toHaveText('没有读取所选凭证来源的权限。');
 await expect(page.locator('#simulation-details')).toBeHidden();
 await card(app).getByRole('button',{name:'修改凭证读取设置'}).click();
 await page.getByRole('button',{name:'模拟权限恢复',exact:true}).click();
 await saveSource(app,'');await settle(page);
 await expect(status(app)).toHaveText('账号读取已修复');
 await card(app).getByRole('button',{name:'完成',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停');
 await card(app).getByRole('button',{name:'恢复接单',exact:true}).click();
 await expect(status(app)).toHaveText('可接单');
 await page.getByRole('button',{name:'重新开始这一项'}).click();
 await expect(status(app)).toHaveText('没有读取所选凭证来源的权限。');
 await expect(page.getByRole('button',{name:'故障恢复',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('guided permission repair targets the current source and preserves manual pause',async({page})=>{
 const app=await open(page,'error');
 await card(app).getByRole('button',{name:'修改凭证读取设置'}).click();
 await saveSource(app,'/tmp/changed-source');await settle(page);
 await expect(status(app)).toHaveText('没有读取所选凭证来源的权限。');
 await page.getByRole('button',{name:'模拟权限恢复',exact:true}).click();
 await card(app).getByRole('button',{name:'修改凭证读取设置'}).click();
 await expect(app.getByRole('dialog').getByLabel('读取目录')).toHaveValue('/tmp/changed-source');
 await saveSource(app,'/tmp/changed-source');await settle(page);
 await expect(card(app).getByRole('button',{name:'查看错误详情',exact:true})).toHaveCount(0);
 await expect(status(app)).toHaveText('已暂停');
 await expect(page.locator('#control-status')).not.toContainText('失败');
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 await page.setViewportSize({width:960,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('opening and closing source settings does not read credentials or write; unchanged save rechecks',async({page})=>{
 const app=await open(page,'error');
 const beforeReads=await calls(page,'account_detect'),beforeSaves=await calls(page,'preferences_save');
 await card(app).getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await expect(app.getByRole('dialog').getByRole('button',{name:'保存',exact:true})).toBeEnabled();
 await page.keyboard.press('Escape');
 expect(await calls(page,'account_detect')).toEqual(beforeReads);
 expect(await calls(page,'preferences_save')).toEqual(beforeSaves);
 await page.getByRole('button',{name:'模拟权限恢复',exact:true}).click();
 await card(app).getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await saveSource(app,'');await settle(page);
 await expect(status(app)).toHaveText('账号读取已修复');
 expect((await calls(page,'account_detect')).length).toBeGreaterThan(beforeReads.length);
});
