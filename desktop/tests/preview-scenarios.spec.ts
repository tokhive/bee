import {test,expect,type Page} from '@playwright/test';

async function openScene(page:Page,scene:string){
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene+'&theme=light');
 await page.waitForFunction(()=>Boolean((window as unknown as {__beePreviewReady?:boolean;__beePreviewError?:string}).__beePreviewReady||(window as unknown as {__beePreviewError?:string}).__beePreviewError));
 expect(await page.evaluate(()=>(window as unknown as {__beePreviewError?:string}).__beePreviewError)).toBeUndefined();
}
const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
const commands=(page:Page)=>page.evaluate(()=>(window as unknown as {calls:{command:string;args:Record<string,unknown>}[]}).calls);
const writes=new Set(['account_action','authorize_start','supply_set_paused','runtime_start','runtime_stop']);

const cases:[string,string|RegExp][]=[
 ['device-unbound','连接本机设备'],['device-pending','等待网页确认'],['device-expired','配对码已过期'],['device-bound','设备已绑定。'],['device-error','设备核对失败'],
 ['stopped','贡献尚未启动'],['runtime-starting','正在启动贡献'],['running','贡献已启动'],['runtime-stopping','正在停止贡献'],['runtime-disconnected',/Hive 未连接|正在重新连接 Hive/],['runtime-unknown','贡献状态待确认，正在自动核对'],
 ['account-reading','正在读取已有登录'],['account-empty','还没有 OpenAI 登录'],['account-candidate','已有登录，尚未接入'],['account-selected','已用 3%'],['account-error','permission_denied'],['account-expired','历史数据，已过期'],['account-change','尚未核对'],
 ['supply-ready','可接单'],['supply-paused','恢复接单'],['supply-blocked','管理员尚未配置套餐并发上限'],['supply-partial','等待自动重试'],
 ['check-background','可接单'],['check-expired','核对中…'],['check-waiting','等待自动重试…'],['check-retrying','重试中…'],['check-recovered','可接单'],['check-sequence','可接单'],
 ['quota-normal','已用 3%'],['quota-unknown','尚未核对'],['quota-expired','历史数据，已过期'],['quota-multiple','7 日 · opus'],['quota-over','已用 120%'],
 ['confirm-login','开始官方登录'],['confirm-select','确认接入'],['confirm-stop','确认停止'],['confirm-change','确认更换'],['confirm-clear','确认取消接入'],['account-detail','凭证读取方式'],
];
for(const [scene,copy] of cases)test('scene renders formal state without invalid data or unintended writes: '+scene,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openScene(page,scene);
 await expect(page.locator('body')).toContainText(copy,{timeout:18000});
 expect(errors).toEqual([]);
 await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 const submitted=(await commands(page)).filter(call=>writes.has(call.command));
 expect(submitted.map(call=>call.command)).toEqual(scene==='runtime-unknown'?['runtime_start']:[]);
 if(scene==='check-expired'||scene==='check-waiting'||scene==='check-retrying'){
  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
 }
 if(scene==='supply-partial'){
  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
  await expect(card(page,'Claude').getByText('可接单',{exact:true})).toHaveCount(0);
 }
});

test('review selector covers approved groups and preserves scene when theme or size changes',async({page})=>{
 await page.goto('/.cache/bee-shadcn-review.html?scene=running&theme=light&size=normal');
 await expect(page.locator('#scene optgroup')).toHaveCount(7);
 await expect(page.locator('#scene option')).toHaveCount(39);
 await page.locator('#scene').selectOption('confirm-change');
 const app=page.frameLocator('iframe');
 await expect(app.getByRole('dialog').last()).toContainText('要换成');
 await page.locator('#theme').selectOption('dark');
 await page.locator('#size').selectOption('narrow');
 await expect(page.locator('#scene')).toHaveValue('confirm-change');
 await expect(app.getByRole('dialog').last()).toContainText('要换成');
 await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>({width:el.contentWindow!.innerWidth,height:el.contentWindow!.innerHeight,theme:el.contentDocument!.documentElement.dataset.theme}))).toEqual({width:860,height:600,theme:'dark'});
});

test('automatic recovery traverses stale, failed, retrying and recovered states using read requests only',async({page})=>{
 await openScene(page,'check-sequence');
 await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
 await expect(page.locator('.account-check-status')).toHaveText('核对中…',{timeout:6000});
 await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
 await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…');
 await expect(page.locator('.account-check-status')).toHaveText('重试中…',{timeout:15000});
 await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(card(page).getByText('可接单',{exact:true})).toBeVisible({timeout:8000});
 await expect(page.locator('.account-check-status')).toHaveCount(0);
 expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
});

test('preview pairing remains pending after a poll and simulated website confirmation binds the device',async({page})=>{
 await openScene(page,'device-unbound');
 await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByRole('button',{name:'生成配对码',exact:true}).click();
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='device_status').length).toBeGreaterThan(1);
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
});

test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
 await openScene(page,'confirm-select');
 await page.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();
 expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
 expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
 await page.getByRole('button',{name:'概览',exact:true}).click();
 const readsBeforeStart=(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length;
 await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 // The shared formal supply model refreshes on its existing 10-second read cycle.
 await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai').length,{timeout:15000}).toBeGreaterThan(readsBeforeStart);
 await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
 expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toEqual([]);
});

for(const scene of ['confirm-change','account-change'])test('confirmed changed identity cannot inherit the prior account quota: '+scene,async({page})=>{
 await openScene(page,scene);
 if(scene==='account-change'){
  await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  await page.getByRole('button',{name:'换号',exact:true}).click();
 }
 await page.getByRole('button',{name:'确认更换',exact:true}).click();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();
 const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
 expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
 expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
 expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
 expect(state.paused).toBe(true);
 await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
});
