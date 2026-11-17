import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
async function setup(page:Page,missing=false,progress=false){
 const openai=accountFixture('openai') as any;if(missing)openai.candidate.state='source_missing';
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{openai,claude:accountFixture('claude')},runtimeEnabled:true,scenarios:{autoService:true,cancelUnknown:true}})});`});
 if(progress)await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='authorize_progress'||command==='authorize_open'){
  w.calls.push({command,args});if(w.progressFailure)throw {code:'RESPONSE_TIMEOUT',message:'controlled login progress read timed out'};
  const operation=w.accounts.openai.operation,live=operation.state==='running';
  const phase=w.cleaning?'cleaning_up':live?w.loginPhase??'waiting_authorization':'finished';
  const value={operation,sequence:w.progressSequence=(w.progressSequence??0)+1,phase,stop_reason:w.cleaning?'failed':null,recheck_in_flight:false,actions:{open:phase==='waiting_authorization'&&live,cancel:!w.cleaning&&live,retry:false,recheck:false,restart:false},blocker:null};
  return {instance:'b'.repeat(32),result:command==='authorize_open'?{open:{opened:true,error:null,progress:value}}:{progress:value}};
 }const result=await invoke(command,args);if(command==='bridge_status')result.metadata.capabilities=['authorize_progress','authorize_open'];return result;};});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
}
const wizard=(page:Page)=>page.getByRole('region',{name:'添加账号',exact:true});
const writes=(page:Page)=>page.evaluate(()=>(window as any).calls.filter((c:any)=>['account_action','authorize_start'].includes(c.command)));
test('starting a slow official login gives immediate feedback and prevents another submission',async({page})=>{
 await page.clock.install();await setup(page,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await page.evaluate(()=>(window as any).loginAdmissionDelay=6000);
 await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('heading')).toHaveText('正在启动 OpenAI 登录…',{timeout:1000});
 await expect(wizard(page).getByRole('status')).toContainText('Bee 正在准备官方登录，请稍候。');
 await expect(wizard(page).getByRole('button',{name:'正在启动登录…',exact:true})).toBeDisabled();
 await wizard(page).getByRole('button',{name:'正在启动登录…',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect(wizard(page).getByRole('button',{name:'设置读取位置',exact:true})).toBeDisabled();
 await page.clock.runFor(6500);
 await expect(wizard(page).getByRole('heading')).toHaveText('请在官方页面完成登录');
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
});
test('official login reports its real phase and still requires explicit intake',async({page})=>{
 await page.clock.install();await setup(page,true,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await page.evaluate(()=>(window as any).loginPhase='starting');await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('heading')).toHaveText('正在启动 OpenAI 登录…');
 await expect(wizard(page).getByRole('button',{name:'打开登录页面',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).loginPhase='waiting_authorization');await page.clock.runFor(1100);
 await expect(wizard(page).getByRole('status')).toContainText('Bee 会自动核对登录结果，无需反复刷新。');
 await expect(wizard(page).getByRole('alert')).toHaveCount(0);
 await wizard(page).getByRole('button',{name:'打开登录页面',exact:true}).click();
 await page.evaluate(()=>(window as any).loginPhase='verifying');await page.clock.runFor(1100);
 await expect(wizard(page).getByRole('heading')).toHaveText('正在读取并核验账号…');
 await expect(wizard(page).getByRole('status')).toContainText('官方登录已完成，Bee 正在核验账号身份。');
 await expect(wizard(page).getByRole('button',{name:'打开登录页面',exact:true})).toHaveCount(0);
 expect((await writes(page)).filter((c:any)=>c.command==='account_action')).toEqual([]);
 await page.evaluate(()=>{const w=window as any;w.__beeMockControls['login-result']({platform:'openai',operationId:w.accounts.openai.operation.id,value:'succeeded'});});
 await page.clock.runFor(11000);await expect(wizard(page).getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();
 expect((await writes(page)).filter((c:any)=>c.command==='account_action')).toEqual([]);
});
test('failed progress reads show retry and stopped states; refreshing only queries the same login',async({page})=>{
 await page.clock.install();await setup(page,true,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).progressFailure=true);await page.clock.runFor(1100);
 await expect(wizard(page).getByRole('status')).toContainText('暂时未读到登录进度，Bee 正在重试查询。');
 await wizard(page).getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.locator('.account-error-popover')).toContainText('controlled login progress read timed out');await page.keyboard.press('Escape');
 await page.clock.runFor(8100);
 await expect(wizard(page).getByRole('heading')).toHaveText('登录进度查询已停止');
 await expect(wizard(page).locator('.add-account-spinner')).toHaveCount(0);
 await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).progressFailure=false);await wizard(page).getByRole('button',{name:'刷新登录进度',exact:true}).click();
 await expect(wizard(page).getByRole('heading')).toHaveText('请在官方页面完成登录');
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
 const ids=await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='authorize_progress').map((c:any)=>c.args.operationId));expect(new Set(ids).size).toBe(1);
});
test('a rejected login start clears the starting indicator and keeps the actual error',async({page})=>{
 await setup(page,true);await wizard(page).getByRole('button',{name:'OpenAI',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>command==='authorize_start'?Promise.reject({code:'REQUEST_NOT_SENT',message:'controlled login start was not sent'}):invoke(command,args);});
 await wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true}).click();
 await expect(wizard(page).getByRole('button',{name:'登录 OpenAI',exact:true})).toBeEnabled();
 await expect(wizard(page).getByRole('status')).toHaveCount(0);
 await wizard(page).getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.locator('.account-error-popover')).toContainText('controlled login start was not sent');
});
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
 await page.clock.install();await page.setViewportSize({width:820,height:680});await setup(page,true,true);
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await page.getByRole('navigation').getByRole('button',{name:'AI accounts',exact:true}).click();await page.getByRole('button',{name:'OpenAI',exact:true}).click();await page.getByRole('button',{name:'Set credential location',exact:true}).click();
 await expect(page.getByLabel('Credential directory')).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const flow=page.getByRole('region',{name:'Add account',exact:true});
 await flow.getByRole('button',{name:'Back',exact:true}).click();await page.evaluate(()=>(window as any).loginAdmissionDelay=6000);
 await flow.getByRole('button',{name:'Sign in to OpenAI',exact:true}).click();await expect(flow.getByRole('heading')).toHaveText('Starting OpenAI sign-in…');
 await page.clock.runFor(6500);await expect(flow.getByRole('heading')).toHaveText('Complete login on the official page');
 await page.evaluate(()=>(window as any).loginPhase='verifying');await page.clock.runFor(1100);await expect(flow.getByRole('status')).toHaveText('Official sign-in has finished. Bee is verifying the account identity.');
 await page.evaluate(()=>(window as any).progressFailure=true);await page.clock.runFor(8500);await expect(flow.getByRole('heading')).toHaveText('Sign-in progress checks have stopped');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
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
