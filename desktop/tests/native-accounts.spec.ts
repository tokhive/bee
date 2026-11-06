import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
const card=(page:Page,p='OpenAI')=>page.getByRole('region',{name:`${p} 账号`,exact:true});
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);

test('Claude inline login keeps confirmation and cancellation recovery in the account row',async({page})=>{
 await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page,'Claude');await dialog.getByRole('button',{name:'登录 Claude',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const login=card(page,'Claude').getByRole('region',{name:'Claude 登录状态',exact:true});
 await expect(login).toBeFocused();await expect(login.getByRole('button',{name:'继续登录',exact:true})).toBeEnabled();
 await login.getByRole('button',{name:'继续登录',exact:true}).click();
 await expect(login).toContainText('请完成 Claude 官方登录');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(login).toContainText('请完成 Claude 官方登录');await login.getByRole('button',{name:'取消登录',exact:true}).click();
 await expect(login).toContainText('本次登录已取消');await login.getByRole('button',{name:'检查当前登录',exact:true}).click();
 await expect(login).toContainText('已登录 Claude，尚未接入');
 expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);
});

test('Claude inline verification retry does not repeat official login or duplicate the failure',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{loginOutcome:{state:'failed',error:{platform:'claude',code:'source_unavailable',check:'official_profile',message:'official profile request timed out',evidence:{transport_failed:'true'}}}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page,'Claude');await dialog.getByRole('button',{name:'登录 Claude',exact:true}).click();
 const login=card(page,'Claude').getByRole('region',{name:'Claude 登录状态',exact:true});await login.getByRole('button',{name:'继续登录',exact:true}).click();
 await page.evaluate(()=>(window as any).loginComplete=true);await expect(login.getByRole('button',{name:'重新核验',exact:true})).toBeEnabled();
 await expect(card(page,'Claude').getByRole('alert')).toHaveCount(1);await login.getByRole('button',{name:'重新核验',exact:true}).click();
 await expect(login).toContainText('已登录 Claude，尚未接入');expect(await calls(page,'authorize_start')).toHaveLength(1);
 expect((await calls(page,'account_detect')).filter((c:any)=>c.args.request.platform==='claude'&&c.args.request.mode==='official')).toHaveLength(1);
});
for(const code of ['permission_denied','invalid_credentials'])test(`Claude inline ${code} offers the matching recovery without automatic login`,async({page})=>{
 const error={platform:'claude',code,check:code==='permission_denied'?'read_file':'parse_credential',message:code==='permission_denied'?'source permission denied':'expiresAt missing; required=positive milliseconds',evidence:code==='permission_denied'?{permission_denied:'true'}:{parsed:'false'}};
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{loginOutcome:{state:'failed',error}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page,'Claude');await dialog.getByRole('button',{name:'登录 Claude',exact:true}).click();
 const login=card(page,'Claude').getByRole('region',{name:'Claude 登录状态',exact:true});await login.getByRole('button',{name:'继续登录',exact:true}).click();
 await page.evaluate(()=>(window as any).loginComplete=true);
 const recovery=login.getByRole('button',{name:code==='permission_denied'?'重新读取':'重新登录',exact:true});await expect(recovery).toBeEnabled();
 await expect(login.getByRole('button')).toHaveCount(1);await recovery.click();
 if(code==='permission_denied'){
  await expect(login).toContainText('尚未确认可用的 Claude 登录');
  const reads=(await calls(page,'account_detect')).filter((c:any)=>c.args.request.platform==='claude');expect(reads.at(-1).args.request.mode).toBe('local');
 }else await expect(login.getByRole('button',{name:'继续登录',exact:true})).toBeEnabled();
 expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);
});
test('Claude inline uncertain cancellation only checks the owned login and accepts its terminal result',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{cancelUnknown:true},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page,'Claude');await dialog.getByRole('button',{name:'登录 Claude',exact:true}).click();
 const login=card(page,'Claude').getByRole('region',{name:'Claude 登录状态',exact:true});await login.getByRole('button',{name:'继续登录',exact:true}).click();
 await login.getByRole('button',{name:'取消登录',exact:true}).click();await expect(login).toContainText('登录结果待确认');
 await expect(login.getByRole('button')).toHaveCount(1);await login.getByRole('button',{name:'检查登录结果',exact:true}).click();
 await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10100);
 await expect(login).toContainText('已登录 Claude，尚未接入');expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);
});
function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
async function fixture(page:Page,options:{selected?:boolean;runtime?:boolean}={}){await page.addInitScript(installAccountFixture,{runtimeEnabled:options.runtime??false,accounts:{openai:options.selected?selected('openai'):accountFixture('openai'),claude:options.selected?selected('claude'):accountFixture('claude')}});}
async function details(page:Page,p='OpenAI'){await card(page,p).getByRole('button',{name:`${p} 详情`,exact:true}).click();return page.getByRole('dialog').last();}
async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('.native-diagnostic-evidence pre')).toContainText(message);}
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
 await details(page);await page.evaluate(()=>{(window as any).delay=0;(window as any).fail='openai';});await page.getByRole('dialog').getByLabel('自定义目录').fill('/tmp/denied');await page.getByRole('dialog').getByLabel('自定义目录').press('Enter');await expect(page.getByRole('dialog').locator('.account-source').getByRole('alert')).toContainText('没有读取所选凭证来源的权限');await page.keyboard.press('Escape');await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();
 await diagnostics(page,'permission_denied=true');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByLabel('Appearance',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'AI accounts',exact:true}).click();await page.getByRole('button',{name:'Claude details',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Custom directory')).toBeVisible();await page.keyboard.press('Tab');await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);await page.screenshot({path:'../.cache/device-pairing/accounts-en-dark.png',fullPage:true});
});
test('overview and accounts share per-platform pause state; resume never starts contribution',async({page})=>{
 await fixture(page,{selected:true,runtime:true});await page.goto('/');await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'重试准备',exact:true}).click();await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(card(page).getByText('已暂停接单',{exact:true})).toBeVisible();await page.getByRole('button',{name:'概览',exact:true}).click();await expect(card(page).getByText('已暂停接单',{exact:true})).toBeVisible();await card(page).getByRole('button',{name:'恢复接单',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();expect(await calls(page,'runtime_start')).toHaveLength(1);expect((await calls(page,'supply_set_paused')).map((c:any)=>[c.args.platform,c.args.paused])).toEqual([['openai',true],['openai',false]]);await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
});
test('official scope diagnostics retain the local candidate and expired authorization never offers a valid quota',async({page})=>{
 await fixture(page,{selected:true});await page.addInitScript(()=>{(window as any).missingProfile=true;(window as any).expiry=new Date(Date.now()+31000).toISOString();});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.mode==='official').length).toBe(1);
 await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await page.clock.runFor(32000);const dialog=await details(page);await expect(dialog.getByText('历史数据，已过期')).toBeVisible();await page.keyboard.press('Escape');await diagnostics(page,'profile_scope');expect(await calls(page,'account_action')).toEqual([]);
});
test('uncertain per-platform pause preserves the other platform and does not replay a write',async({page})=>{
 await fixture(page,{selected:true,runtime:true});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'重试准备',exact:true}).click();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();await page.evaluate(()=>{(window as any).supplyFail='openai';});await card(page).getByRole('button',{name:'暂停接单',exact:true}).click();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(card(page,'Claude').getByText('已暂停接单',{exact:true})).toBeVisible();await diagnostics(page,'HTTP 503');await page.getByRole('button',{name:'概览',exact:true}).click();await page.clock.runFor(10001);expect(await calls(page,'supply_set_paused')).toHaveLength(1);await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
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

test('unconnected candidate shows its target and exact pause impact before connecting',async({page})=>{
 await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByText('已有登录，尚未接入')).toBeVisible();await expect(card(page).getByText('未知套餐',{exact:true})).toHaveCount(0);
 await card(page).getByRole('button',{name:'接入',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('目标账号',{exact:true})).toBeVisible();await expect(dialog.getByText('b'.repeat(16),{exact:true})).toBeVisible();
 await expect(dialog).toContainText('Hive');await expect(dialog).toContainText('Bee 自动准备服务，该平台保持暂停');
 await dialog.getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();
 expect(await calls(page,'runtime_start')).toHaveLength(0);expect((await calls(page,'account_action'))[0].args.request.action).toBe('select');
});

test('running official login targets its platform without a global stop',async({page})=>{
 await fixture(page,{selected:true,runtime:true});await page.goto('/');await page.getByRole('button',{name:'重试准备',exact:true}).click();await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const dialog=await details(page);await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
 await dialog.getByRole('button',{name:'重新登录',exact:true}).click();
 const confirmation=page.getByRole('dialog').last();await expect(confirmation).toContainText('暂停此平台接单');
 await confirmation.getByRole('button',{name:'取消',exact:true}).click();
 expect(await calls(page,'runtime_stop')).toHaveLength(0);expect(await calls(page,'authorize_start')).toHaveLength(0);
});

test('candidate expiring at the safety boundary explains zero-write refusal',async({page})=>{
 await fixture(page,{runtime:true});await page.addInitScript(()=>{(window as any).expiry=new Date(Date.now()+60000).toISOString();});await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await page.clock.runFor(31001);
 await expect(card(page)).toContainText('候选授权即将过期');expect(await calls(page,'account_action')).toHaveLength(0);
});

for(const code of ['source_missing','permission_denied','expired','source_changed'])test(`selected source ${code} stays scoped and leaves the other platform usable`,async({page})=>{
 const error={code,check:'source_read',platform:'openai',message:`selected file ${code}; safe source evidence`,evidence:{confirmed:'false'}};
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{candidates:{openai:{state:code,source:null,reference:null,fingerprint:null,error}}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).locator('.account-conditions > summary').click();await card(page).getByText('查看失败详情',{exact:true}).click();await expect(card(page).locator('.account-condition-evidence pre')).toContainText(code);
 await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();await expect(card(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
 const sourceAction=card(page).getByRole('button',{name:'打开读取设置',exact:true});if(await sourceAction.count()){await sourceAction.click();await expect(page.getByRole('dialog').getByLabel('自定义目录')).toBeFocused();}else await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('自定义目录')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(0);
});

test('confirmation invalidates a changed candidate while retaining the original target and zero writes',async({page})=>{
 await page.clock.install();await fixture(page,{runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'接入',exact:true}).click();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.candidate.reference='f'.repeat(48);a.candidate.fingerprint='f'.repeat(64);});await page.clock.runFor(10100);
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('alert')).toContainText('本次未提交');await expect(dialog.getByText('b'.repeat(16),{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'确认接入',exact:true})).toBeDisabled();expect(await calls(page,'account_action')).toHaveLength(0);await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeFocused();
});

for(const [code,summary]of [['client_missing','未找到已安装的官方客户端。'],['client_version_unsupported','官方客户端版本不在支持范围内。'],['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_timeout','官方登录已超时。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test(`official login ${code} is actionable without automatically connecting`,async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'safe official evidence; verified=false',evidence:{confirmed:'false'}}}},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
 await expect(dialog.getByText(summary,{exact:true})).toHaveCount(1);await dialog.locator('.account-conditions > summary').click();await expect(dialog.getByText(summary,{exact:true})).toBeVisible();await dialog.getByText('查看失败详情',{exact:true}).click();await expect(dialog.locator('.account-condition-evidence pre')).toContainText('verified=false');expect(await calls(page,'account_action')).toHaveLength(0);expect(await calls(page,'runtime_start')).toHaveLength(0);
});

test('unknown cancel only queries the same official operation and late success remains an unconnected candidate',async({page})=>{
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{cancelUnknown:true},accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await dialog.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(dialog).toContainText('取消请求结果未确认');await page.keyboard.press('Escape');
 await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10100);await expect(card(page).getByText('已有登录，尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);expect(await calls(page,'supply_set_paused')).toHaveLength(0);
});

test('background snapshot failure during official login never invents a cancel request',async({page},testInfo)=>{
 await page.clock.install();await fixture(page,{runtime:true});
 await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.accountTimeline=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{try{const reply=await invoke(command,args);if(['authorize_start','runtime_snapshot','account_snapshot'].includes(command))w.accountTimeline.push({at:new Date().toISOString(),command,platform:args?.platform??args?.request?.platform,receipt:reply?.result?.operation,account:reply?.result?.account??reply?.result?.runtime?.platforms.openai.account});return reply;}catch(error){w.accountTimeline.push({at:new Date().toISOString(),command,error});throw error;}};});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();const dialog=await details(page);
 await dialog.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(dialog.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).accountScenarios.snapshotFailure='openai');await page.clock.runFor(450);
 await dialog.locator('.account-conditions > summary').click();await dialog.getByText('查看失败详情',{exact:true}).click();await expect(dialog.locator('.account-condition-evidence pre')).toContainText('account_snapshot');await expect(dialog.locator('.account-condition-evidence pre')).toContainText('openai snapshot unavailable');
 expect(await calls(page,'authorize_cancel')).toHaveLength(0);await expect(dialog).not.toContainText('取消请求结果未确认');
 await page.evaluate(()=>{const w=window as any;w.accountScenarios.snapshotFailure='';w.loginComplete=true;});await page.clock.runFor(10100);
 await testInfo.attach('account-operation-timeline',{body:JSON.stringify(await page.evaluate(()=>(window as any).accountTimeline),null,2),contentType:'application/json'});
 await expect(dialog.getByText('登录已核验，尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toHaveLength(0);
});

for(const failure of ['runtime','openai'] as const)test(`${failure} read failure marks retained account facts until recovery without automatic writes`,async({page})=>{
 await page.clock.install();await fixture(page,{selected:true,runtime:true});await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
 await page.evaluate(failure=>{const w=window as any;if(failure==='runtime')w.accountScenarios.runtimeReadFailure=true;else w.accountScenarios.snapshotFailure='openai';},failure);await page.clock.runFor(10100);
 await expect(card(page).locator('.native-account-condition')).toContainText('状态待更新');
 await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await expect(card(page).getByText('上次确认的额度；当前待核对。',{exact:true})).toBeVisible();
 if(failure==='openai'){await expect(card(page,'Claude').locator('.native-account-condition')).not.toContainText('状态待更新');await expect(card(page,'Claude').getByText('b'.repeat(16),{exact:true})).toBeVisible();}
 else {await expect(card(page,'Claude').locator('.native-account-condition')).toContainText('状态待更新');}
 const dialog=await details(page);await expect(dialog.locator('.account-read-history time')).toHaveAttribute('datetime',/.+/);await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).not.toContainText('接入前需先恢复设备身份');await page.keyboard.press('Escape');
 for(const command of ['account_action','authorize_start','authorize_cancel','supply_set_paused','runtime_start'])expect(await calls(page,command)).toHaveLength(0);
 await page.evaluate(()=>{const w=window as any;w.accountScenarios.runtimeReadFailure=false;w.accountScenarios.snapshotFailure='';});await page.clock.runFor(10100);
 await expect(card(page).locator('.account-read-history')).toHaveCount(0);await expect(card(page).getByText('上次确认的额度；当前待核对。',{exact:true})).toHaveCount(0);await expect(card(page).getByText('已用 120%',{exact:true})).toBeVisible();
});
