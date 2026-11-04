import {test,expect,type Page,type FrameLocator} from '@playwright/test';

const card=(app:FrameLocator,platform='OpenAI')=>app.getByRole('region',{name:`${platform} 账号`,exact:true});
async function open(page:Page,scene='account-empty'){
 await page.clock.install();
 await page.goto(`/tests/fixtures/bee-preview/index.html?scene=${scene}&theme=light`);
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 return page.frameLocator('iframe');
}
async function external(page:Page,action:string,value:string,platform='openai'){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 await page.locator('#event-platform').selectOption(platform);
 await page.getByRole('button',{name:'应用模拟条件',exact:true}).click();
 await expect(page.locator('#control-status')).not.toHaveText('正在更新模拟条件…');
}
async function startOpenAI(app:FrameLocator){
 await card(app).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 const confirmation=app.getByRole('dialog').last();
 await expect(confirmation).toContainText('不会自动接入、开始贡献或恢复接单');
 await confirmation.getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect(card(app).getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();
 await expect(card(app)).toContainText('官方登录仍在进行');
}
async function calls(page:Page,command:string){return page.locator('iframe').evaluate((el:HTMLIFrameElement,command)=>(el.contentWindow as any).calls.filter((call:any)=>call.command===command),command);}

test('preview login creates a candidate and requires explicit connection before cross-page paused feedback',async({page})=>{
 const app=await open(page);
 await startOpenAI(app);
 await external(page,'login-result','succeeded');
 await expect(page.locator('#control-status')).toContainText('仅生成候选，尚未接入');
 await page.clock.runFor(10100);
 await expect(card(app)).toContainText('登录已核验，尚未接入');
 expect(await calls(page,'account_action')).toHaveLength(0);
 await card(app).getByRole('button',{name:'接入',exact:true}).click();
 const confirmation=app.getByRole('dialog');
 await expect(confirmation).toContainText('将保持暂停');
 await expect(confirmation.getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();
 await confirmation.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(app)).toContainText('接入已完成，该平台保持暂停');
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await expect(card(app)).toContainText('已手动暂停');
 expect(await calls(page,'runtime_start')).toHaveLength(0);
 expect(await calls(page,'account_action')).toHaveLength(1);
});

test('preview failed login recovers in the same account flow and cancellation prevents a late result',async({page})=>{
 const app=await open(page);
 await startOpenAI(app);
 await external(page,'login-result','failed');
 await page.clock.runFor(10100);
 await expect(card(app)).toContainText('账号操作失败');
 await expect(card(app)).toContainText('official login process failed: exit_code=1');
 await startOpenAI(app);
 await card(app).getByRole('button',{name:'取消官方登录',exact:true}).click();
 await expect(card(app)).toContainText('官方登录进程已取消');
 await external(page,'login-result','succeeded');
 await expect(page.locator('#control-status')).toContainText('PREVIEW_LOGIN_STALE');
 await expect(card(app).getByRole('button',{name:'接入',exact:true})).toHaveCount(0);
 expect(await calls(page,'authorize_start')).toHaveLength(2);
 expect(await calls(page,'authorize_cancel')).toHaveLength(1);
 expect(await calls(page,'account_action')).toHaveLength(0);
});

test('preview account change keeps the old selection until confirmation and then remains paused',async({page})=>{
 const app=await open(page,'account-change');
 await card(app).getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 const detail=app.getByRole('dialog').first();
 await expect(detail).toContainText('发现不同账号');
 await detail.getByRole('button',{name:'换号',exact:true}).click();
 const confirmation=app.getByRole('dialog').last();
 await expect(confirmation).toContainText('当前账号');
 await expect(confirmation).toContainText('目标账号');
 await expect(confirmation).toContainText('完成后仍保持暂停');
 expect(await calls(page,'account_action')).toHaveLength(0);
 await confirmation.getByRole('button',{name:'确认更换',exact:true}).click();
 await expect(detail).toContainText('换号已完成，该平台保持暂停');
 await page.keyboard.press('Escape');
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await expect(card(app)).toContainText('已手动暂停');
 expect((await calls(page,'account_action'))[0].args.request.action).toBe('confirm_change');
 expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('preview source conditions can recover through the formal source editor without launching login',async({page})=>{
 const app=await open(page);
 await page.locator('#event-kind').selectOption('account-source');
 await page.locator('#event-store').selectOption('file');
 await external(page,'account-source','denied');
 await card(app).getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 const detail=app.getByRole('dialog');
 await detail.getByLabel('自定义目录').fill('/tmp/codex');
 await detail.getByLabel('自定义目录').press('Enter');
 await expect(detail).toContainText('没有读取所选凭证来源的权限');
 await external(page,'account-source','available');
 await detail.getByLabel('自定义目录').fill('');
 await detail.getByLabel('自定义目录').press('Enter');
 await expect(detail.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await expect(detail).toContainText('已有登录，尚未接入');
 expect(await calls(page,'authorize_start')).toHaveLength(0);
 expect(await calls(page,'account_action')).toHaveLength(0);
});

test('preview Claude login controls follow its current operation and preserve the inline confirmation',async({page})=>{
 const app=await open(page);
 await card(app,'Claude').getByRole('button',{name:'登录 Claude',exact:true}).click();
 const login=card(app,'Claude').getByRole('region',{name:'Claude 登录状态',exact:true});
 await expect(login).toBeFocused();
 await expect(login).toContainText('登录后不会自动接入或开始贡献');
 await login.getByRole('button',{name:'继续登录',exact:true}).click();
 await expect(login).toContainText('请完成 Claude 官方登录');
 await external(page,'login-result','succeeded','claude');
 await page.clock.runFor(10100);
 await expect(login).toContainText('已登录 Claude，尚未接入');
 await expect(card(app,'Claude').getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 expect(await calls(page,'authorize_start')).toHaveLength(1);
 expect(await calls(page,'account_action')).toHaveLength(0);
});
