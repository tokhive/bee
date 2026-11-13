import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
async function setup(page:Page,missing=false,progress=false){
 const openai=accountFixture('openai') as any;if(missing)openai.candidate.state='source_missing';
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{openai,claude:accountFixture('claude')},runtimeEnabled:true,scenarios:{autoService:true,cancelUnknown:true}})});`});
 if(progress)await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='authorize_progress'){const operation=w.accounts.openai.operation;return {instance:'b'.repeat(32),result:{progress:{operation,sequence:1,phase:w.cleaning?'cleaning_up':operation.state==='running'?'waiting_authorization':'finished',stop_reason:w.cleaning?'failed':null,recheck_in_flight:false,actions:{open:false,cancel:!w.cleaning&&operation.state==='running',retry:false,recheck:false,restart:false},blocker:null}}};}const result=await invoke(command,args);if(command==='bridge_status')result.metadata.capabilities=['authorize_progress'];return result;};});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
}
const wizard=(page:Page)=>page.getByRole('region',{name:'添加账号',exact:true});
const writes=(page:Page)=>page.evaluate(()=>(window as any).calls.filter((c:any)=>['account_action','authorize_start'].includes(c.command)));
test('empty account page chooses a platform and verifies before explicit intake',async({page})=>{
 await setup(page);await expect(page.locator('[data-account-platform]')).toHaveCount(0);
 await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();expect(await writes(page)).toEqual([]);
 await wizard(page).getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true})).toBeVisible();
 expect((await writes(page)).filter((c:any)=>c.command==='account_action')).toHaveLength(1);
 await expect(page.getByRole('region',{name:'Claude 账号',exact:true})).toHaveCount(0);
});
test('missing login offers two paths; source back preserves draft without saving',async({page})=>{
 await setup(page,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
 await wizard(page).getByRole('button',{name:'设置读取位置',exact:true}).click();await wizard(page).getByLabel('读取目录').fill('/tmp/draft-only');
 await wizard(page).getByRole('button',{name:'返回',exact:true}).click();await wizard(page).getByRole('button',{name:'设置读取位置',exact:true}).click();
 await expect(wizard(page).getByLabel('读取目录')).toHaveValue('/tmp/draft-only');expect(await writes(page)).toEqual([]);
});
test('unknown cancellation never offers a second login',async({page})=>{
 await setup(page,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await wizard(page).getByRole('button',{name:'取消登录',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toHaveCount(0);
 await expect(wizard(page).getByRole('button',{name:'刷新登录进度',exact:true})).toBeVisible();
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
});
test('identity changes invalidate visible confirmation until another verification',async({page})=>{
 await page.clock.install();await setup(page);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 const confirm=wizard(page).getByRole('button',{name:'确认接入',exact:true});await expect(confirm).toBeEnabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.candidate.fingerprint='e'.repeat(64);});
 await page.clock.runFor(11000);await expect(confirm).toBeDisabled();expect(await writes(page)).toEqual([]);
 await expect(wizard(page)).toContainText('账号、来源或接单选择已变化');
});
test('unknown intake checks its original operation and never repeats the write',async({page})=>{
 await setup(page);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).actionPending=true);await wizard(page).getByRole('button',{name:'确认接入',exact:true}).click();
 // The existing card owns preparation as soon as selection is recorded.
 await expect(page.getByRole('button',{name:'核对结果',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'核对结果',exact:true}).click();
 expect((await writes(page)).filter((c:any)=>c.command==='account_action')).toHaveLength(1);
});
test('save failure retains the source form and error details use an exclamation',async({page})=>{
 await setup(page,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();await wizard(page).getByRole('button',{name:'设置读取位置',exact:true}).click();
 await wizard(page).getByLabel('读取目录').fill('/tmp/retained');await page.evaluate(()=>(window as any).preferencesFail=true);
 await wizard(page).getByRole('button',{name:'保存',exact:true}).click();
 await expect(wizard(page).getByLabel('读取目录')).toHaveValue('/tmp/retained');
 const details=wizard(page).getByRole('button',{name:'查看错误详情'});await expect(details.locator('svg.lucide-circle-alert')).toHaveCount(1);
 await details.click();await expect(page.locator('.account-error-popover')).toContainText('PREFERENCES_WRITE_FAILED');await page.keyboard.press('Escape');await expect(details).toBeFocused();
});
test('paused choice remains paused after intake; no supply write is sent',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).paused.openai=true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await expect(wizard(page)).toContainText('接入后保留暂停');await wizard(page).getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(page.getByRole('region',{name:'OpenAI 账号',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
 expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='supply_set_paused'))).toEqual([]);
});
test('directory selection saves the real returned path, verifies it, and still requires intake confirmation',async({page})=>{
 await setup(page,true);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__beeMockControls['account-source']({platform:'openai',directory:'/tmp/chosen-source',store:'file',value:'available'});w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>command==='plugin:dialog|open'?Promise.resolve('/tmp/chosen-source'):invoke(command,args);});
 await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();await wizard(page).getByRole('button',{name:'设置读取位置',exact:true}).click();
 await wizard(page).getByRole('button',{name:'选择目录',exact:true}).click();await expect(wizard(page).getByLabel('读取目录')).toHaveValue('/tmp/chosen-source');
 await wizard(page).getByRole('button',{name:'保存',exact:true}).click();await expect(wizard(page).getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();expect(await writes(page)).toEqual([]);
 expect(await page.evaluate(()=>(window as any).calls.some((c:any)=>c.command==='account_detect'&&c.args.request.directory==='/tmp/chosen-source'&&c.args.request.mode==='official'))).toBe(true);
});
test('unconfirmed supply preference blocks intake and is never treated as no pause history',async({page})=>{
 await setup(page);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>command==='supply_status'&&args.platform==='openai'?Promise.reject({code:'RESPONSE_TIMEOUT',message:'controlled supply read unavailable'}):invoke(command,args);});
 await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();await expect(wizard(page)).toContainText('接单选择尚未确认');await expect(wizard(page).getByRole('button',{name:'确认接入',exact:true})).toBeDisabled();expect(await writes(page)).toEqual([]);
});
test('English onboarding stays translated and fits the minimum desktop width',async({page})=>{
 await page.setViewportSize({width:820,height:680});await setup(page,true);
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await page.getByRole('navigation').getByRole('button',{name:'AI accounts',exact:true}).click();await page.getByRole('button',{name:'OpenAI',exact:true}).click();await page.getByRole('button',{name:'Set credential location',exact:true}).click();
 await expect(page.getByLabel('Credential directory')).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});
test('a clock jump cannot submit an expired supply observation before the next render',async({page})=>{
 await page.clock.install();await setup(page);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();const confirm=wizard(page).getByRole('button',{name:'确认接入',exact:true});await expect(confirm).toBeEnabled();
 const current=await page.evaluate(()=>Date.now());await page.clock.setSystemTime(current+31001);await confirm.evaluate((button:HTMLButtonElement)=>button.click());expect(await writes(page)).toEqual([]);await expect(confirm).toBeDisabled();
});

test('a terminal login receipt cannot bypass cleanup that is still in progress',async({page})=>{
 await page.clock.install();await setup(page,true,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await page.evaluate(()=>{const w=window as any;w.cleaning=true;const a=w.accounts.openai;a.operation.state='failed';a.operation.revision=++a.revision;});await page.clock.runFor(11000);
 await expect(wizard(page).getByRole('heading')).toHaveText('正在确认登录已结束…');await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toHaveCount(0);
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
 await page.evaluate(()=>(window as any).cleaning=false);await wizard(page).getByRole('button',{name:'刷新登录进度',exact:true}).click();await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
});
