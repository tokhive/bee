import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,scene:string){
 await page.clock.install();
 await page.goto('/tests/fixtures/bee-preview/index.html?scene='+scene+'&theme=light');
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));
 return page.frameLocator('iframe');
}
async function event(page:Page,action='device-approval',value='approve'){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 await page.locator('#event-apply').click();
 await expect(page.locator('#control-status')).not.toHaveText('正在更新模拟条件…');
 await expect(page.locator('#control-status')).not.toContainText('失败');
}
const commands=(page:Page)=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).calls as {command:string;args:any}[]);
const writes=new Set(['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','supply_set_paused']);

test('formal first pairing saves the entered Hive and name and becomes online without starting contribution',async({page})=>{
 const app=await open(page,'device-unbound');
 const device=app.getByRole('region',{name:'设备配对',exact:true});
 await device.getByLabel('Hive 地址',{exact:true}).fill('https://design-hive.example');
 await device.getByLabel('设备名称',{exact:true}).fill('Design Laptop');
 await device.getByRole('button',{name:'生成配对码',exact:true}).click();
 await expect(device.locator('.pairing-phase')).toHaveText('等待网页确认');
 await expect(device).toContainText('https://design-hive.example/devices/pair?code=ABCD-EFGH');
 await app.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await app.getByRole('tab',{name:'关于',exact:true}).click();
 await expect(app.getByRole('main')).toContainText('https://design-hive.example');
 await app.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await event(page);
 await page.clock.runFor(2100);
 await expect(device).toContainText('设备已绑定。');
 await expect(device).toContainText('Design Laptop');
 await expect(device).toContainText('new-owner@example.test');
 const runtime=app.getByRole('region',{name:'服务状态',exact:true});
 await expect(runtime).toContainText('贡献未启动');
 await expect(runtime).toContainText('Hive 已连接');
 for(const destination of ['AI 账号','诊断','概览'])await app.getByRole('navigation').getByRole('button',{name:destination,exact:true}).click();
 await expect(runtime).toContainText('Hive 已连接');
 const calls=await commands(page);
 expect(calls.filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['device_begin']);
 expect(calls.find(c=>c.command==='device_begin')!.args).toEqual({hive:'https://design-hive.example',name:'Design Laptop'});
});

test('revoked credential recovery requires consent and explicit owner adoption and keeps all pages usable',async({page})=>{
 const app=await open(page,'device-revoked-source-missing');
 const device=app.getByRole('region',{name:'设备配对',exact:true}),rebind=device.getByRole('button',{name:'重新绑定设备',exact:true});
 await expect(device).toContainText('上次保存的设备信息');
 await rebind.click();
 await app.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await page.clock.runFor(10);
 await expect(rebind).toBeFocused();
 expect((await commands(page)).filter(c=>writes.has(c.command))).toEqual([]);
 await rebind.click();
 await app.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(device.locator('.pairing-phase')).toHaveText('等待网页确认');
 await device.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(device.locator('.pairing-phase')).toHaveText('等待网页确认');
 await event(page);
 await device.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect(device.locator('.pairing-phase')).toHaveText('新设备归属与原设备不同');
 await device.getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(app.getByRole('dialog')).toContainText('owner@example.test');
 await expect(app.getByRole('dialog')).toContainText('new-owner@example.test');
 await app.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await expect(device.locator('.pairing-phase')).toHaveText('新设备归属与原设备不同');
 await device.getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await app.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(device).toContainText('设备已绑定。');
 await expect(device.locator('.pairing-phase')).toContainText('未自动开始贡献');await device.getByRole('button',{name:'重新核对设备',exact:true}).click();
 const runtime=app.getByRole('region',{name:'服务状态',exact:true});
 await expect(runtime).toContainText('贡献未启动');await expect(runtime).toContainText('Hive 已连接');
 await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(app.getByRole('region',{name:'OpenAI 账号',exact:true})).toContainText('登录 OpenAI');
 await app.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await app.getByRole('tab',{name:'关于',exact:true}).click();
 await expect(app.getByRole('main')).toContainText('https://hive.example');
 await expect(app.getByRole('main')).toContainText('Hive 设备身份已核对。');
 await app.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();
 await app.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(runtime).toContainText('Hive 已连接');
 const calls=(await commands(page)).filter(c=>writes.has(c.command));
 expect(calls.map(c=>c.command)).toEqual(['device_recovery_prepare','device_recovery_confirm','device_recovery_confirm']);
 expect(calls.filter(c=>c.command==='device_recovery_confirm').map(c=>c.args.decision)).toEqual(['begin_pairing','adopt_owner']);
});

test('a seeded unknown redemption is reconciled by the common approval control without device writes',async({page})=>{
 const app=await open(page,'device-redemption-unknown'),device=app.getByRole('region',{name:'设备配对',exact:true});
 await expect(device.locator('.pairing-phase')).toContainText('兑换结果未知');
 const before=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).__beeMockDeviceContext().operationId);
 await event(page);
 await device.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect(device).toContainText('设备已绑定。');
 const after=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).__beeMockDeviceContext().operationId);
 expect(after).toBe(before);
 expect((await commands(page)).filter(c=>writes.has(c.command))).toEqual([]);
 await expect(app.getByRole('region',{name:'服务状态',exact:true})).toContainText('Hive 已连接');
});
