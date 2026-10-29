import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
const card=(page:Page,p='OpenAI')=>page.getByRole('region',{name:`${p} 账号`,exact:true});
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
async function fixture(page:Page,options:{selected?:boolean;runtime?:boolean}={}){await page.addInitScript(installAccountFixture,{runtimeEnabled:options.runtime??false,accounts:{openai:options.selected?selected('openai'):accountFixture('openai'),claude:options.selected?selected('claude'):accountFixture('claude')}});}
async function details(page:Page,p='OpenAI'){await card(page,p).getByRole('button',{name:`${p} 详情`,exact:true}).click();return page.getByRole('dialog').last();}
async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('pre')).toContainText(message);}
test('account page automatically reads sources; selected quotas preserve 120%, unknown windows and detail focus',async({page})=>{
 await fixture(page,{selected:true});await page.setViewportSize({width:860,height:600});await page.goto('/');expect(await calls(page,'account_detect')).toEqual([]);
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
 const reads=await calls(page,'account_detect');expect(reads.filter((c:any)=>c.args.request.mode==='local').map((c:any)=>c.args.request.platform)).toEqual(expect.arrayContaining(['openai','claude']));expect(reads.some((c:any)=>c.args.request.mode==='official')).toBe(true);
 expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
 const trigger=card(page).getByRole('button',{name:'OpenAI 详情',exact:true});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog.getByText('已用 120%',{exact:true})).toBeVisible();await expect(dialog.getByText('尚未核对',{exact:true})).toBeVisible();await expect(dialog.getByText('市场开放：未知',{exact:true})).toHaveCount(0);await expect(dialog.getByText('gpt-5.4',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('自定义目录')).toBeVisible();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../.cache/device-pairing/accounts-zh-860.png',fullPage:true});
});
test('source edits reject late automatic results; platform failures remain independent with English and dark theme',async({page})=>{
 await fixture(page,{runtime:true});await page.addInitScript(()=>{(window as any).delay=700;});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page);await dialog.getByLabel('自定义目录').fill('/tmp/edited');await dialog.getByLabel('自定义目录').press('Enter');
 await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.platform==='openai').at(-1)?.args.request.directory).toBe('/tmp/edited');
 await expect(dialog.getByText('正在读取已有登录…')).toHaveCount(0);await expect(dialog.getByLabel('自定义目录')).toHaveValue('/tmp/edited');await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();expect(await calls(page,'account_action')).toEqual([]);
 await details(page);await page.evaluate(()=>{(window as any).delay=0;(window as any).fail='openai';});await page.getByRole('dialog').getByLabel('自定义目录').fill('/tmp/denied');await page.getByRole('dialog').getByLabel('自定义目录').press('Enter');await expect(page.getByRole('dialog').getByRole('alert')).toContainText('无法读取凭证来源');await page.keyboard.press('Escape');await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();
 await diagnostics(page,'permission_denied=true');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByLabel('Appearance',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'AI accounts',exact:true}).click();await page.getByRole('button',{name:'Claude details',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Custom directory')).toBeVisible();await page.keyboard.press('Tab');await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);await page.screenshot({path:'../.cache/device-pairing/accounts-en-dark.png',fullPage:true});
});
test('overview and accounts share per-platform pause state; resume never starts contribution',async({page})=>{
 await fixture(page,{selected:true,runtime:true});await page.goto('/');await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(card(page).getByText('已手动暂停',{exact:true})).toBeVisible();await page.getByRole('button',{name:'概览',exact:true}).click();await expect(card(page).getByText('已手动暂停',{exact:true})).toBeVisible();await card(page).getByRole('button',{name:'恢复接单',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(1);expect((await calls(page,'supply_set_paused')).map((c:any)=>[c.args.platform,c.args.paused])).toEqual([['openai',true],['openai',false]]);await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
});
test('official scope diagnostics retain the local candidate and expired authorization never offers a valid quota',async({page})=>{
 await fixture(page,{selected:true});await page.addInitScript(()=>{(window as any).missingProfile=true;(window as any).expiry=new Date(Date.now()+31000).toISOString();});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.mode==='official').length).toBe(1);
 await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await page.clock.runFor(32000);const dialog=await details(page);await expect(dialog.getByText('历史数据，已过期')).toBeVisible();await page.keyboard.press('Escape');await diagnostics(page,'profile_scope');expect(await calls(page,'account_action')).toEqual([]);
});
test('uncertain per-platform pause preserves the other platform and does not replay a write',async({page})=>{
 await fixture(page,{selected:true,runtime:true});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();await page.evaluate(()=>{(window as any).supplyFail='openai';});await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(card(page,'Claude').getByText('已手动暂停',{exact:true})).toBeVisible();await diagnostics(page,'HTTP 503');await page.getByRole('button',{name:'概览',exact:true}).click();await page.clock.runFor(10001);expect(await calls(page,'supply_set_paused')).toHaveLength(1);await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
});
test('device verification failure permits local reads and preserves selected historical Hive quota',async({page})=>{
 const openai=selected('openai');openai.hive={...openai.hive,fingerprint:'b'.repeat(64)};openai.capabilities[1]={...openai.capabilities[1],status:'rate_limited',observed_at:new Date(Date.now()-600000).toISOString(),valid_until:new Date(Date.now()-240000).toISOString(),windows:[{scope:'',seconds:18000,used_percent:80,reset_at:null}]};
 await page.addInitScript(installAccountFixture,{accounts:{openai,claude:accountFixture('claude')}});await page.addInitScript(()=>{(window as any).deviceFail=true;(window as any).historicalLimit=true;(window as any).accounts.openai.selection.fingerprint='f'.repeat(64);(window as any).accounts.openai.hive.fingerprint='f'.repeat(64);});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('历史数据，已过期')).toBeVisible();await expect.poll(async()=>(await calls(page,'account_detect')).length).toBeGreaterThan(0);const dialog=await details(page);await expect(dialog.getByText('已用 80%',{exact:true})).toBeVisible();await expect(dialog.getByText('历史数据，已过期')).toBeVisible();await page.keyboard.press('Escape');await diagnostics(page,'HTTP 503');
});

test('approved shared rows show saved identity and a keyboard-accessible compact detail',async({page})=>{
 const openai=accountFixture('openai') as any;
 openai.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};
 openai.candidate={...openai.candidate,state:'available',fingerprint:'b'.repeat(64),plan:'plus',expires_at:'2099-01-01T00:00:00Z'};
 await page.addInitScript(installAccountFixture,{accounts:{openai,claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByText('f'.repeat(16),{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'检测已有登录',exact:true})).toHaveCount(0);
 const trigger=page.getByRole('button',{name:'OpenAI 详情',exact:true});await trigger.click();
 const detail=page.getByRole('dialog');await expect(detail.getByText('授权到期',{exact:true})).toBeVisible();
 await expect(detail.getByLabel('自定义目录')).toBeVisible();
 await expect(detail.getByText('模型能力与市场开放')).toHaveCount(0);
 await expect(detail.getByText('Hive 账号代次')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});
