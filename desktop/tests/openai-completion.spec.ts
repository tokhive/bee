import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import type {AccountSnapshot} from '../src/system/accounts';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
// Controlled frontend receipts only; no official account, native process or Hive request.
function installOpenaiReplies(){
 const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
 const supply=(p:string)=>({hive:'https://hive.example',device_id:'dev-1',platform:p,paused:w.paused[p],ready:w.accounts[p].selection.state==='selected'&&!w.paused[p],reasons:w.paused[p]?['manually_paused']:w.accounts[p].selection.state==='selected'?[]:['not_configured'],checked_at:new Date().toISOString()});
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{
  if(['authorize_progress','authorize_open'].includes(command)){
   w.calls.push({command,args});
   if(w.queryFailure)throw {code:'RESPONSE_TIMEOUT',message:'controlled progress query response unavailable'};
   const operation=w.accounts.openai.operation;
   const progress={operation,sequence:1,phase:['pending','running'].includes(operation.state)?'waiting_authorization':'finished',stop_reason:operation.state==='cancelled'?'cancelled':null,recheck_in_flight:false,actions:{open:operation.state==='running',cancel:operation.state==='running',retry:false,recheck:false,restart:false},blocker:null};
   return {instance:'b'.repeat(32),result:command==='authorize_open'?{open:{opened:true,error:null,progress}}:{progress}};
  }
  const reply=await original(command,args);
  if(command==='bridge_status')reply.metadata.capabilities=['authorize_progress','authorize_open'];
  if(command==='account_action'&&reply.result?.account){
   const a=w.accounts.openai;a.hive={...a.hive,state:'ready',fingerprint:a.selection.fingerprint,generation:1};a.authorization={...a.authorization,state:'synchronized',fingerprint:a.selection.fingerprint};
   reply.result.account=structuredClone(a);
  }
  if(command==='runtime_snapshot'){
   reply.result.runtime.local='running';reply.result.runtime.run_id='a'.repeat(32);reply.result.runtime.connection='connected';
   for(const p of ['openai','claude'])reply.result.runtime.platforms[p].supply=supply(p);
  }
  if(command==='supply_status')reply.result.supply=supply(args.platform);
  return reply;
 };
}
const card=(page:Page)=>page.getByRole('region',{name:'OpenAI 账号',exact:true});
async function setup(page:Page,selected=false){
 const openai=accountFixture('openai') as AccountSnapshot,claude=accountFixture('claude');
 openai.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),plan:'plus',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:new Date().toISOString(),error:null};
 if(selected){openai.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};openai.hive={...openai.hive,state:'ready',fingerprint:'b'.repeat(64),generation:1};openai.authorization={...openai.authorization,state:'synchronized',fingerprint:'b'.repeat(64)};}
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{openai,claude},runtimeEnabled:true,scenarios:{autoService:true}})});(${installOpenaiReplies.toString()})();`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'OpenAI 详情'})).toBeVisible();
}
async function writes(page:Page){return page.evaluate(()=>(window as any).calls.filter((c:any)=>['account_action','authorize_start','authorize_cancel','supply_set_paused','runtime_start'].includes(c.command)));}
test('real React intake completion survives navigation; finish sends no business write; new fault wins',async({page})=>{
 await setup(page);await card(page).getByRole('button',{name:'接入账号',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('账号接入成功！');
 await expect(card(page).locator('.oa-steps .done')).toHaveCount(2);
 const before=await writes(page);
 await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('账号接入成功！');
 await card(page).getByRole('button',{name:'完成',exact:true}).click();
 expect(await writes(page)).toEqual(before);await expect(card(page).locator('.oa-steps')).toHaveCount(0);
});
test('source draft survives navigation and failed save; successful settings are reread before verification',async({page})=>{
 await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('读取目录').fill('/tmp/controlled-source');
 await page.evaluate(()=>(window as any).preferencesFail=true);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog).toContainText('PREFERENCES_WRITE_FAILED');await expect(dialog.getByLabel('读取目录')).toHaveValue('/tmp/controlled-source');
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await expect(dialog.getByLabel('读取目录')).toHaveValue('/tmp/controlled-source');
 await page.evaluate(()=>(window as any).preferencesFail=false);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.directory==='/tmp/controlled-source'&&c.args.request.mode==='official').length)).toBeGreaterThan(0);
 expect(await writes(page)).toEqual([]);
});
test('open and exhausted queries retain the original login without starting another process',async({page})=>{
 await page.clock.install();await setup(page);
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
 await card(page).getByRole('button',{name:'打开登录页面',exact:true}).click();
 await page.evaluate(()=>(window as any).queryFailure=true);
 await page.clock.runFor(8100);
 await expect(card(page).getByRole('button',{name:'刷新登录进度',exact:true})).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).calls);
 expect(calls.filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
 const ids=calls.filter((c:any)=>['authorize_open','authorize_progress'].includes(c.command)).map((c:any)=>c.args.operationId);
 expect(new Set(ids).size).toBe(1);
});

test('account reconciliation stops after 60 seconds and manual checks never replay the action',async({page})=>{
 await page.clock.install();await setup(page);await page.evaluate(()=>(window as any).actionPending=true);
 await card(page).getByRole('button',{name:'接入账号',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('账号操作结果待核对');
 const id=await page.evaluate(()=>(window as any).accounts.openai.operation.id);
 await page.clock.runFor(61000);
 await expect(card(page).getByText('自动核对已达 60 秒，尚未确认原操作结果。',{exact:true})).toBeVisible();
 const reads=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_snapshot'&&c.args.platform==='openai').length);
 const stopped=await reads();await page.clock.runFor(5000);expect(await reads()).toBe(stopped);
 await card(page).getByRole('button',{name:'核对结果',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect.poll(reads).toBe(stopped+1);
 const calls=await page.evaluate(()=>(window as any).calls);
 expect(calls.filter((c:any)=>c.command==='account_action')).toHaveLength(1);
 expect(calls.filter((c:any)=>c.command==='account_snapshot'&&c.args.platform==='openai').every((c:any)=>c.args.refresh===false)).toBe(true);
 expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(id);
 await expect(card(page).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.operation.id='f'.repeat(48);a.operation.revision=++a.revision;});
 await page.clock.runFor(11000);
 await expect(card(page).getByText('本轮查询已停止，尚未确认原操作结果。',{exact:true})).toBeVisible();
 await card(page).getByText('查看核对记录',{exact:true}).click();
 await expect(card(page)).toContainText('required='+id);
 await expect(card(page)).toContainText('actual='+'f'.repeat(48));
});

test('credential failures hide quota, deduplicate one cause and preserve independent faults and pause',async({page})=>{
 await page.clock.install();await page.setViewportSize({width:820,height:680});await setup(page,true);
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
 await page.evaluate(()=>{
  const w=window as any,a=w.accounts.openai;w.paused.openai=true;
  const source={code:'permission_denied',check:'source_read',platform:'openai',message:'Controlled credential access denied: EACCES',evidence:{permission_denied:'true'}};
  a.candidate.error=source;a.authorization.error=structuredClone(source);a.issues=[{code:source.code,platform:'openai',fingerprint:a.selection.fingerprint,message:source.message,notify:false}];
  a.hive.error={code:'registration_rejected',check:'hive_registration',platform:'openai',message:'Controlled Hive registration rejected: HTTP 403',evidence:{}};a.revision++;
 });
 await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('无法读取登录凭证');
 await expect(card(page).locator('.oa-note')).toHaveText('Controlled credential access denied: EACCES');
 await expect(card(page).locator('.oa-quota')).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
 await expect(card(page).getByText('接单保持暂停。',{exact:true})).toBeVisible();
 await card(page).getByText('查看错误详情',{exact:true}).click();
 await expect(card(page).locator('.oa-evidence .problem-notice')).toHaveCount(2);
 await expect(card(page)).toContainText('EACCES');await expect(card(page)).toContainText('HTTP 403');
 await page.screenshot({path:resolve(evidence,'formal-independent-errors-dark-narrow.png')});
 await card(page).getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('读取目录')).toBeVisible();expect(await writes(page)).toEqual([]);
 await page.screenshot({path:resolve(evidence,'formal-source-details-dark-narrow.png')});
});

const evidence=resolve('../docs/desktop/evidence/2026-11-10-openai-completion');
for(const theme of ['light','dark'])for(const [size,width,height] of [['narrow',820,680],['wide',1080,700]] as const){
 test(`formal React and approved preview — ${theme} ${size}`,async({page})=>{
  mkdirSync(evidence,{recursive:true});await page.clock.install();await page.setViewportSize({width,height});
  await setup(page);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
  await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
  await page.evaluate(()=>{const w=window as any;w.__beeMockControls['login-result']({platform:'openai',operationId:w.accounts.openai.operation.id,value:'succeeded-same'});});await page.clock.runFor(11000);
  await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
  await expect(card(page).getByRole('button',{name:'接入账号',exact:true})).toBeVisible();
  await card(page).getByRole('button',{name:'接入账号',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入'}).click();
  await expect(card(page).getByRole('status')).toHaveText('账号接入成功！');
  await expect(card(page).locator('.oa-steps .done')).toHaveCount(4);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve(evidence,`formal-first-success-${theme}-${size}.png`)});
  const before=await writes(page);
  await page.evaluate(()=>{const w=window as any;w.accounts.openai.candidate.error={code:'permission_denied',check:'source_read',platform:'openai',message:'Controlled source access denied: EACCES',evidence:{permission_denied:'true'}};w.accounts.openai.revision++;});
  await page.clock.runFor(11000);
  await expect(card(page).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);expect(await writes(page)).toEqual(before);
  // A fresh app has no previous completion; fixtures reset on reload.
  await page.reload();await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:width+100,height:height+200});
  await page.goto(`http://127.0.0.1:1497/index.html?scene=first-success-paused&theme=${theme}&size=${size}`);
  await expect(page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号'}).getByText('账号接入成功！',{exact:true})).toBeVisible();
  await page.locator('iframe').screenshot({path:resolve(evidence,`approved-first-success-${theme}-${size}.png`)});
 });
}
test('new recovery candidate and its frozen history retain unresolved operation semantics',async({page})=>{
 await page.goto('http://127.0.0.1:1497/openai-recovery-candidate.html?scene=candidate-intake-limit&theme=dark&size=narrow');
 const app=page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号'});await expect(app.getByText('暂时无法确认原操作结果',{exact:true})).toBeVisible();
 await app.getByRole('button',{name:'核对结果',exact:true}).click();await expect(app.getByText('正在核对原操作…',{exact:true})).toBeVisible();
 await expect(app.getByText('暂时无法确认原操作结果',{exact:true})).toBeVisible();
 await page.locator('#scene').selectOption('candidate-ownership');await expect(app.getByText('无法安全重新启动登录',{exact:true})).toBeVisible();
 await page.locator('iframe').screenshot({path:resolve(evidence,'candidate-ownership-dark-narrow.png')});
 await page.goto('http://127.0.0.1:1497/history/20261110-114533-openai-recovery-candidate/openai-recovery-candidate.html?scene=candidate-retries&theme=light&size=wide');
 await expect(app.getByText('登录进度查询已停止',{exact:true})).toBeVisible();
 await page.locator('iframe').screenshot({path:resolve(evidence,'candidate-retry-exhausted-light-wide.png')});
});
