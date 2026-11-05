import {test,expect,type Page,type FrameLocator} from '@playwright/test';

const card=(app:FrameLocator,name='OpenAI')=>app.getByRole('region',{name:`${name} 账号`,exact:true,includeHidden:true});
const status=(app:FrameLocator,name='OpenAI')=>card(app,name).locator('.account-status-block>.native-account-condition');
async function open(page:Page,scene='candidate'){
 await page.clock.install();
 await page.goto(`/tests/fixtures/bee-preview/index.html?scene=accounts-auto-${scene}&theme=light&size=narrow`);
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 return page.frameLocator('iframe');
}
async function event(page:Page,action:string,value:string,platform='openai'){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 if(['login-result','account-source','account-refresh'].includes(action))await page.locator('#event-platform').selectOption(platform);
 if(action==='account-source')await page.locator('#event-store').selectOption(platform==='openai'?'file':'keychain');
 await page.getByRole('button',{name:'应用模拟条件',exact:true}).click();
 await expect(page.locator('#control-status')).not.toHaveText('正在更新模拟条件…');
}
async function settle(page:Page){await page.clock.runFor(11000);}
async function calls(page:Page,command:string){return page.locator('iframe').evaluate((el:HTMLIFrameElement,command)=>(el.contentWindow as any).calls.filter((c:any)=>c.command===command),command);}
async function relogin(app:FrameLocator){
 await card(app).getByRole('button',{name:'OpenAI 详情'}).click();
 await app.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 const confirm=app.getByRole('dialog').last();
 await expect(confirm).toContainText('并暂停此平台接单');
 await confirm.getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect(app.getByRole('dialog').getByRole('button',{name:'取消官方登录'})).toBeEnabled();
 await expect(app.getByRole('dialog').locator('.account-status-block>.native-account-condition')).toHaveText('等待官方登录');
}

test('candidate connects, prepares automatically, resumes and pauses without a global start',async({page})=>{
 const app=await open(page);
 await expect(status(app)).toHaveText('已有登录，尚未接入');
 await card(app).getByRole('button',{name:'接入',exact:true}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog).toContainText('订阅额度');
 await dialog.getByRole('button',{name:'确认接入',exact:true}).click();
 await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 await expect(card(app).locator('.account-conditions')).toHaveCount(0);
 await card(app).getByRole('button',{name:'恢复接单'}).click();
 await expect(status(app)).toHaveText('可接单');
 await card(app).getByRole('button',{name:'暂停接单'}).click();
 await expect(status(app)).toHaveText('已暂停接单');
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 await expect(status(app)).toHaveText('已暂停接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
 expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('permission and pause are two collapsed reasons; repair preserves pause and focus',async({page})=>{
 const app=await open(page,'error');
 await expect(status(app)).toHaveText('不能接单');
 const reasons=card(app).locator('.account-conditions');
 await expect(reasons).not.toHaveAttribute('open','');
 await reasons.locator(':scope>summary').click();
 await expect(reasons.locator(':scope>ul>li')).toHaveCount(2);
 await reasons.getByRole('button',{name:'打开读取设置'}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog.getByLabel('自定义目录')).toBeFocused();
 await dialog.getByLabel('自定义目录').fill('/tmp/codex');
 await dialog.getByLabel('自定义目录').press('Enter');
 await event(page,'account-source','available');
 await dialog.getByRole('button',{name:'重新读取',exact:true}).click();
 await expect(dialog.locator('.account-status-block>.native-account-condition')).toHaveText('已暂停接单');
 await expect(dialog.getByLabel('自定义目录')).toHaveValue('/tmp/codex');
 await page.keyboard.press('Escape');
 await expect(status(app)).toHaveText('已暂停接单');
 await card(app).getByRole('button',{name:'恢复接单'}).click();
 await expect(status(app)).toHaveText('可接单');
 expect(await calls(page,'authorize_start')).toHaveLength(0);
});

test('same-account login pauses only the target; another identity waits for switch confirmation',async({page})=>{
 const app=await open(page,'running');
 await relogin(app);
 await event(page,'login-result','succeeded-same');
 await settle(page);
 await page.keyboard.press('Escape');
 await expect(status(app)).toHaveText('已暂停接单');
 await expect(status(app,'Claude')).toHaveText('可接单');
 await relogin(app);
 await event(page,'login-result','succeeded');
 await settle(page);
 const dialog=app.getByRole('dialog');
 await expect(dialog.locator('.account-status-block>.native-account-condition')).toHaveText('发现不同账号');
 expect(await calls(page,'account_action')).toHaveLength(0);
 await dialog.getByRole('button',{name:'换号',exact:true}).click();
 await expect(app.getByRole('dialog').last()).toContainText('当前账号');
 await app.getByRole('dialog').last().getByRole('button',{name:'确认更换'}).click();
 await expect(status(app,'Claude')).toHaveText('可接单');
 await settle(page);
 await page.keyboard.press('Escape');
 await expect(status(app)).toHaveText('已暂停接单');
 await expect(status(app,'Claude')).toHaveText('可接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
});

test('failed login can retry; cancellation rejects late success and stays paused',async({page})=>{
 const app=await open(page,'running');
 await relogin(app);
 await event(page,'login-result','failed');
 await settle(page);
 const detail=app.getByRole('dialog');
 await detail.getByRole('button',{name:'重新登录',exact:true}).click();
 await app.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
 await detail.getByRole('button',{name:'取消官方登录'}).click();
 await event(page,'login-result','succeeded-same');
 await expect(page.locator('#control-status')).toContainText('PREVIEW_LOGIN_STALE');
 await detail.getByRole('button',{name:'重新读取',exact:true}).click();
 await page.keyboard.press('Escape');
 await expect(status(app)).toHaveText('已暂停接单');
 await expect(status(app,'Claude')).toHaveText('可接单');
 expect(await calls(page,'authorize_start')).toHaveLength(2);
});

test('disconnect, simulated restart and stale report preserve the pause choice',async({page})=>{
 const app=await open(page,'running');
 await card(app).getByRole('button',{name:'暂停接单'}).click();
 await event(page,'runtime-connection','offline');await settle(page);
 await expect(status(app)).toHaveText('状态待更新');
 await event(page,'runtime-connection','online');await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 await event(page,'account-refresh','same-account');await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 await event(page,'account-service','restart');await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 await expect(status(app,'Claude')).toHaveText('可接单');
 await event(page,'account-service','stale');await settle(page);
 await expect(status(app)).toHaveText('状态待更新');
 await expect(card(app).getByRole('button',{name:'恢复接单'})).toBeDisabled();
 await event(page,'account-service','fresh');await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 expect(await calls(page,'supply_set_paused')).toHaveLength(1);
});

test('lost resume receipt is reconciled without replaying the write',async({page})=>{
 const app=await open(page,'paused');
 await event(page,'supply-write-result','unknown-next');
 await card(app).getByRole('button',{name:'恢复接单'}).click();
 await expect(status(app)).toHaveText('状态待更新');
 await card(app).getByRole('button',{name:'核对结果'}).click();
 await settle(page);
 await expect(status(app)).toHaveText('可接单');
 expect(await calls(page,'supply_set_paused')).toHaveLength(1);
});

test('lost connect receipt preserves one operation and confirms the paused result',async({page})=>{
 const app=await open(page);
 await event(page,'account-operation-result','unknown-next');
 await card(app).getByRole('button',{name:'接入',exact:true}).click();
 await app.getByRole('dialog').getByRole('button',{name:'确认接入'}).click();
 await settle(page);
 await expect(status(app)).toHaveText('已暂停接单');
 expect(await calls(page,'account_action')).toHaveLength(1);
});

test('dark English narrow layout exposes one status and has no horizontal overflow',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/app.html?scene=accounts-auto-error&theme=dark&locale=en');
 await page.setViewportSize({width:860,height:600});
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 const row=page.getByRole('region',{name:'OpenAI account',exact:true});
 await expect(row.locator('.account-status-block>.native-account-condition')).toHaveCount(1);
 await expect(row.locator('.account-conditions>summary')).toHaveText('View reasons (2)');
 await row.locator('.account-conditions>summary').focus();
 await page.keyboard.press('Enter');
 await expect(row.locator('.account-conditions')).toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:'../docs/desktop/evidence/2026-11-04-account-ui-review/auto-accounts-dark-en.png'});
});


test('service preparation failure exposes evidence and a retry preserving pause',async({page})=>{
 const app=await open(page,'paused');
 await event(page,'account-service','failed');await settle(page);
 await expect(status(app)).toHaveText('服务准备失败');
 await card(app).locator('.account-conditions>summary').click();
 await card(app).getByText('查看失败详情',{exact:true}).click();
 await expect(card(app)).toContainText('simulated_failure=true');
 await card(app).getByRole('button',{name:'重试准备',exact:true}).click();
 await expect(status(app)).toHaveText('已暂停接单');
 expect((await calls(page,'runtime_start'))[0].args.request.resume_platforms).toEqual([]);
});
