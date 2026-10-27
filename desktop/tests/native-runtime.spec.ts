import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
const card=(page:Page,p='OpenAI')=>page.getByRole('region',{name:`${p} 账号`,exact:true});
async function setup(page:Page){await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
test('ready management stays stopped; select, explicit start, stop and per-platform states are usable',async({page})=>{
 await setup(page);await expect(page.getByRole('region',{name:'贡献运行'}).getByText('尚未开始贡献',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'检测已有登录',exact:true}).click();
 await card(page).getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('已选择，待开始',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
 await page.getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('checkbox',{name:'允许 OpenAI 恢复接单'}).check();await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 await expect(page.getByRole('region',{name:'贡献运行'}).getByText('贡献进程运行中',{exact:true})).toBeVisible();expect((await calls(page,'runtime_start'))[0].args.request.resume_platforms).toEqual(['openai']);
 await page.getByRole('button',{name:'停止贡献',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();await expect(page.getByText('停止已确认，下次打开保持停止。')).toBeVisible();
});
test('uncertain account writes only refresh; confirmation still leaves platform paused',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'检测已有登录',exact:true}).click();
 await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});
 await card(page).getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('操作结果未确认，请先重新核对。')).toBeVisible();
 await expect(card(page).getByRole('button',{name:'接入账号',exact:true})).toBeDisabled();await card(page).getByRole('button',{name:'刷新 Hive 状态',exact:true}).click();expect(await calls(page,'account_action')).toHaveLength(1);
});
test('official login warns about official account, can cancel, and successful login remains a candidate',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page,'Claude').getByRole('button',{name:'官方授权',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('可能改变官方客户端当前登录');await dialog.getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(card(page,'Claude').getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();
 await page.evaluate(()=>{(window as any).loginComplete=true;});await expect(card(page,'Claude').getByText('官方身份已核验')).toBeVisible();await expect(card(page,'Claude').getByText('尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});
test('uncertain runtime start is never replayed and requires a fresh query',async({page})=>{
 await setup(page);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;(window as any).runtimeUnknown=true;});
 await page.getByRole('button',{name:'重新核对运行状态',exact:true}).click();await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByText('操作结果未确认，请先重新核对。')).toBeVisible();await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'重新核对运行状态',exact:true}).click();await expect(page.getByText('贡献进程运行中',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toHaveLength(1);
});

test('completed login cannot clear a later source edit, and write admission locks the source',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await card(page).getByText('高级来源',{exact:true}).click();
 await page.evaluate(()=>{(window as any).loginAdmissionDelay=600;});
 await card(page).getByRole('button',{name:'官方授权',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect(card(page).getByLabel('自定义目录')).toBeDisabled();
 await expect(card(page).getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();
 await card(page).getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(card(page).getByText('操作已取消',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).loginAdmissionDelay=0;(window as any).loginComplete=true;});
 await card(page).getByRole('button',{name:'官方授权',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(card(page).getByText('官方身份已核验',{exact:true})).toBeVisible();
 await card(page).getByLabel('自定义目录').fill('/tmp/another-account');await card(page).getByRole('button',{name:'刷新 Hive 状态',exact:true}).click();await expect(card(page).getByText('来源已编辑，请重新检测',{exact:true})).toBeVisible();await expect(card(page).getByRole('button',{name:'接入账号',exact:true})).toBeDisabled();
});

test('account change remains paused and a platform failure leaves the other platform visible',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await card(page).getByRole('button',{name:'检测已有登录',exact:true}).click();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;});
 await card(page).getByRole('button',{name:'刷新 Hive 状态',exact:true}).click();await card(page).getByRole('button',{name:'确认换号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认更换',exact:true}).click();await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);expect(await calls(page,'runtime_start')).toEqual([]);
 await page.evaluate(()=>{const a=(window as any).accounts.claude;a.authorization.error={code:'source_unavailable',check:'source_read',platform:'claude',message:'source unavailable',evidence:{}};});
 await page.getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('button',{name:'重新核对运行状态',exact:true}).click();await expect(page.getByRole('region',{name:'贡献运行'}).getByRole('alert')).toContainText('source unavailable');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();
});

test('only proven unsubmitted confirmation can continue after reconciliation',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await card(page).getByRole('button',{name:'检测已有登录',exact:true}).click();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;a.operation={id:'c'.repeat(48),kind:'confirm_change',platform:'openai',state:'reconciling',revision:a.revision,error:{code:'confirmation_unknown',check:'account_change_submission',platform:'openai',message:'confirmation outcome unknown',evidence:{}}};});
 await card(page).getByRole('button',{name:'刷新 Hive 状态',exact:true}).click();await expect(card(page).getByRole('button',{name:'确认换号',exact:true})).toBeDisabled();expect(await calls(page,'account_action')).toEqual([]);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.operation.revision=a.revision;a.operation.error.code='confirmation_not_submitted';a.operation.error.message='confirmation was not submitted';});
 await card(page).getByRole('button',{name:'刷新 Hive 状态',exact:true}).click();await card(page).getByRole('button',{name:'确认换号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认更换',exact:true}).click();await expect(card(page).getByText('账号操作已完成，平台保持暂停')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
});

test('English runtime and login confirmation support keyboard at minimum window size',async({page})=>{
 await page.setViewportSize({width:860,height:600});await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(page.getByRole('region',{name:'Contribution runtime'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'AI accounts',exact:true}).click();const login=page.getByRole('region',{name:'OpenAI account',exact:true}).getByRole('button',{name:'Official authorization',exact:true});await login.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Tab');await expect(page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);
});
