import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,scene:string){
 await page.addInitScript(()=>{Math.random=()=>1;});
 await page.clock.install();
 await page.goto('/tests/fixtures/bee-preview/index.html?scene='+scene+'&theme=light');
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));
 return page.frameLocator('iframe');
}
async function event(page:Page,action:string,value:string){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 await page.locator('#event-apply').click();
 await expect(page.locator('#control-status')).not.toHaveText('正在更新模拟条件…');
 await expect(page.locator('#control-status')).not.toContainText('失败');
}
const commands=(page:Page)=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).calls as {command:string;args:any}[]);

test('service preparation retry preserves platform pause and keeps the device online across pages',async({page})=>{
 const app=await open(page,'stopped');
 const region=app.getByRole('region',{name:'服务状态',exact:true}),account=app.getByRole('region',{name:'OpenAI 账号',exact:true});
 await expect(region.locator('.native-runtime-health')).toContainText('Hive 已连接');
 await region.getByRole('button',{name:'重试准备',exact:true}).click();
 await page.clock.runFor(10100);
 await expect(account.getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
 expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toHaveLength(0);
 await account.getByRole('button',{name:'恢复接单',exact:true}).click();
 await expect(account.getByText('可接单',{exact:true})).toBeVisible();
 await account.getByRole('button',{name:'暂停接单',exact:true}).click();
 await expect(account.getByText('已暂停接单',{exact:true})).toBeVisible();
 await app.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(account.getByText('已暂停接单',{exact:true})).toBeVisible();
 await app.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 await expect(region.locator('.native-runtime-health')).toContainText('贡献已启动');
 await expect(region.locator('.native-runtime-health')).toContainText('Hive 已连接');
 expect((await commands(page)).filter(c=>c.command==='runtime_start')).toHaveLength(1);
 expect((await commands(page)).filter(c=>c.command==='runtime_stop')).toHaveLength(0);
 expect((await commands(page)).filter(c=>c.command==='supply_set_paused').map(c=>c.args.paused)).toEqual([false,true]);
});

test('preview network controls use formal read backoff and recover without replaying contribution writes',async({page})=>{
 const app=await open(page,'running');
 const account=app.getByRole('region',{name:'OpenAI 账号',exact:true});
 await expect(account.getByText('可接单',{exact:true})).toBeVisible();
 await event(page,'runtime-connection','offline');
 await page.clock.runFor(10300);
 await expect(app.getByRole('region',{name:'服务状态',exact:true})).toContainText('正在重新连接 Hive');
 await expect(account.getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(account.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
 await expect(app.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
 await expect(account).toContainText('HTTP 503');
 const failedReads=(await commands(page)).filter(c=>c.command==='supply_status').length;
 await event(page,'runtime-connection','online');
 await page.clock.runFor(1000);
 expect((await commands(page)).filter(c=>c.command==='supply_status')).toHaveLength(failedReads);
 await page.clock.runFor(10000);
 await expect(account.getByText('可接单',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(c=>['runtime_start','runtime_stop','supply_set_paused'].includes(c.command))).toEqual([]);
 for(const value of ['rejected','occupied']){
  await event(page,'runtime-connection',value);
  await page.clock.runFor(10100);
  const region=app.getByRole('region',{name:'服务状态',exact:true});
  await expect(region).toContainText('自动重连已停止，请先处理当前问题。');
  await expect(account.getByText('可接单',{exact:true})).toHaveCount(0);
  await expect(region.getByRole('button',{name:'检查 Hive 连接',exact:true})).toBeVisible();
 }
});

test('an unknown preparation receipt is reconciled through one write and a stable operation',async({page})=>{
 const app=await open(page,'stopped');
 await event(page,'runtime-write-result','unknown-next');
 const region=app.getByRole('region',{name:'服务状态',exact:true});
 await region.getByRole('button',{name:'重试准备',exact:true}).click();
 await expect(region).toContainText('等待已安排的核对');
 const original=await page.locator('iframe').evaluate(async(el:HTMLIFrameElement)=>(await (el.contentWindow as any).__TAURI_INTERNALS__.invoke('runtime_snapshot')).result.runtime.operation.id);
 await page.clock.runFor(10300);
 await expect(region.locator('.native-runtime-health')).toContainText('贡献已启动');
 await expect(region.getByRole('button',{name:'重试准备',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 const reconciled=await page.locator('iframe').evaluate(async(el:HTMLIFrameElement)=>(await (el.contentWindow as any).__TAURI_INTERNALS__.invoke('runtime_snapshot')).result.runtime.operation.id);
 expect(reconciled).toBe(original);
 expect((await commands(page)).filter(c=>c.command==='runtime_start')).toHaveLength(1);
 expect((await commands(page)).filter(c=>c.command==='runtime_stop')).toHaveLength(0);
});
