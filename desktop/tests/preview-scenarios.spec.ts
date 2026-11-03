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
 ['device-unbound','连接本机设备'],['device-pending','等待网页确认'],['device-expired','Hive 已确认配对码过期'],['device-bound','设备已绑定。'],['device-error','HTTP 503'],
 ['stopped','贡献尚未启动'],['runtime-starting','正在启动贡献'],['running','可接单'],['runtime-stopping','正在停止贡献'],['runtime-disconnected',/Hive 未连接|正在重新连接 Hive/],['runtime-unknown','等待已安排的核对'],
 ['account-reading','正在读取已有登录'],['account-empty','所选来源未找到登录'],['account-candidate','已有登录，尚未接入'],['account-selected','已用 3%'],['account-error','permission_denied'],['account-expired','历史数据，已过期'],['account-change','尚未核对'],
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
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=running&theme=light&size=normal');
 await expect(page.locator('#scene optgroup')).toHaveCount(10);
 expect(await page.locator('#scene optgroup').evaluateAll(groups=>groups.map(group=>(group as HTMLOptGroupElement).label))).toEqual(['设备绑定','设备恢复','设置与诊断','跨页组合','贡献运行','AI 账号','接单条件','自动核对','额度报告','确认与详情']);
 await expect(page.locator('#scene option')).toHaveCount(76);
 for(const scene of ['runtime-no-accounts','runtime-accounts-unconfirmed','confirm-change'])await expect(page.locator('#scene option[value="'+scene+'"]')).toHaveCount(1);
 await page.locator('#scene').selectOption('confirm-change');
 const app=page.frameLocator('iframe');
 await expect(app.getByRole('dialog').last()).toContainText('目标账号');
 await page.locator('#theme').selectOption('dark');
 await page.locator('#size').selectOption('narrow');
 await expect(page.locator('#scene')).toHaveValue('confirm-change');
 await expect(app.getByRole('dialog').last()).toContainText('目标账号');
 await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>({width:el.contentWindow!.innerWidth,height:el.contentWindow!.innerHeight,theme:el.contentDocument!.documentElement.dataset.theme}))).toEqual({width:860,height:600,theme:'dark'});
 for(const scene of ['runtime-no-accounts','runtime-accounts-unconfirmed']){
  await page.locator('#scene').selectOption(scene);
  await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).__beePreviewReady&&(el.contentWindow as any).__beePreviewScene)).toBe(scene);
  await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
  const facts=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{const w=el.contentWindow as any;return {selections:Object.values(w.accounts).map((a:any)=>a.selection.state),calls:w.calls};});
  expect(facts.selections).toEqual(['not_selected','not_selected']);
  if(scene==='runtime-no-accounts'){
   await expect(app.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先接入至少一个 AI 账号。');
   await expect(app.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
  }else{
   await expect(app.getByText('接入数量待确认',{exact:true})).toBeVisible();
   await expect(app.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先核对本机贡献状态。');
   await expect(app.locator('main')).not.toContainText('0 个已接入');
   expect(facts.calls.filter((c:any)=>c.command==='account_snapshot')).toEqual([]);
  }
  expect(facts.calls.filter((c:any)=>['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save'].includes(c.command))).toEqual([]);
 }
});

test('automatic recovery traverses stale, failed, retrying and recovered states using read requests only',async({page})=>{
 await openScene(page,'check-sequence');
 await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
 test.setTimeout(45000);
 await expect(page.locator('.account-check-status')).toHaveText('等待自动重试…',{timeout:6000});
 await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).__beePreviewPhase)).toBe('current');
 expect((await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai')).toHaveLength(1);
 await expect(page.locator('.account-check-status')).toHaveText('核对中…',{timeout:15000});
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
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as {__beePreviewApprove:()=>void}).__beePreviewApprove());
 await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
});

test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
 await openScene(page,'confirm-select');
 await page.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('接入已完成，该平台保持暂停。')).toBeVisible();
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
 await expect(card(page).getByText('换号已完成，该平台保持暂停。')).toBeVisible();
 const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
 expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
 expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
 expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
 expect(state.paused).toBe(true);
 await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
});

for(const [scene,copy] of [
 ['settings-general','通用'],['settings-network','本机 HTTP 代理'],['settings-system','通知与启动'],['settings-about','关于'],
 ['diagnostics-running','诊断进行中'],['diagnostics-results','诊断'],['diagnostics-read-failed','报告读取已暂停'],['diagnostics-export-unknown','报告下载结果未确认'],
 ['update-downloading','下载'],['update-verified','安装'],['update-unknown','安装'],['update-failed','signature'],
 ['bridge-starting','正在读取 Bee'],['bridge-failed','exit=17'],['startup-blocked','本机设备'],
] as const)test('additional formal page accepts current DTO without invalid reply: '+scene,async({page})=>{
 test.setTimeout(50000);await openScene(page,scene);await expect(page.locator('body')).toContainText(copy,{timeout:35000});
 await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 expect((await commands(page)).filter(c=>writes.has(c.command))).toEqual([]);
});

test('English preview navigates the formal account and settings pages',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/app.html?scene=account-detail&locale=en');
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
 await expect(page.getByRole('dialog')).toHaveAccessibleName('OpenAI account details');await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{level:1,name:'Settings',exact:true})).toBeFocused();
});
