import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import type {AccountSnapshot} from '../src/system/accounts';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
// Only the main design preview is tested; archived and candidate previews are excluded.
test.beforeEach(async({page})=>{
 await page.route('**/approved-preview/**',async route=>{
  const relative=decodeURIComponent(new URL(route.request().url()).pathname).split('/approved-preview/')[1];
  const root=resolve(import.meta.dirname,'../../docs/preview'),file=resolve(root,relative);
  if(!file.startsWith(root+'/'))return route.fulfill({status:403});
  await route.fulfill({contentType:'text/html; charset=utf-8',body:readFileSync(file)});
 });
});
// Controlled frontend receipts only; no official account, native process or Hive request.
function installOpenaiReplies(){
 const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
 const supply=(p:string)=>({hive:'https://hive.example',device_id:'dev-1',platform:p,paused:w.paused[p],ready:w.accounts[p].selection.state==='selected'&&!w.paused[p],reasons:w.paused[p]?['manually_paused']:w.accounts[p].selection.state==='selected'?[]:['not_configured'],checked_at:new Date().toISOString()});
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{
  if(['authorize_progress','authorize_open'].includes(command)){
   w.calls.push({command,args});
   if(w.queryFailure)throw {code:'RESPONSE_TIMEOUT',message:'controlled progress query response unavailable'};
   const operation=w.accounts.openai.operation;
   const phase=['pending','running'].includes(operation.state)?w.loginPhase??'waiting_authorization':'finished';
   const progress={operation,sequence:w.progressSequence=(w.progressSequence??0)+1,phase,stop_reason:operation.state==='cancelled'?'cancelled':null,recheck_in_flight:false,actions:{open:operation.state==='running'&&phase==='waiting_authorization',cancel:operation.state==='running',retry:false,recheck:false,restart:false},blocker:null};
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
 openai.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),plan:'plus',expires_at:'2099-01-01T00:00:00Z',identity_verified:false,observed_at:new Date().toISOString(),error:null};
 if(selected){openai.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};openai.hive={...openai.hive,state:'ready',fingerprint:'b'.repeat(64),generation:1};openai.authorization={...openai.authorization,state:'synchronized',fingerprint:'b'.repeat(64)};}
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{openai,claude},runtimeEnabled:true,scenarios:{autoService:true}})});(${installOpenaiReplies.toString()})();`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 if(selected)await expect(card(page).getByRole('button',{name:'OpenAI 详情'})).toBeVisible();
 else {if(await page.getByRole('button',{name:'OpenAI',exact:true}).count())await page.getByRole('button',{name:'OpenAI',exact:true}).click();await expect(page.getByRole('button',{name:'确认接入',exact:true})).toBeEnabled();}
}
async function writes(page:Page){return page.evaluate(()=>(window as any).calls.filter((c:any)=>['account_action','authorize_start','authorize_cancel','supply_set_paused','runtime_start'].includes(c.command)));}
test('real React intake completion survives navigation; finish sends no business write; new fault wins',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'确认接入',exact:true}).click();
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
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await dialog.getByLabel('读取目录').fill('/tmp/controlled-source');
 await page.evaluate(()=>(window as any).preferencesFail=true);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog).toContainText('PREFERENCES_WRITE_FAILED');await expect(dialog.getByLabel('读取目录')).toHaveValue('/tmp/controlled-source');
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await dialog.getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await expect(dialog.getByLabel('读取目录')).toHaveValue('/tmp/controlled-source');
 await page.evaluate(()=>(window as any).preferencesFail=false);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.directory==='/tmp/controlled-source'&&c.args.request.mode==='official').length)).toBeGreaterThan(0);
 await expect(dialog).toHaveCount(0);expect(await writes(page)).toEqual([]);
});
test('open and exhausted queries retain the original login without starting another process',async({page})=>{
 await page.clock.install();await setup(page,true);
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
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
 await page.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(page.getByRole('region',{name:'添加账号',exact:true}).getByRole('heading',{level:3})).toHaveText('暂时无法确认接入结果');
 const id=await page.evaluate(()=>(window as any).accounts.openai.operation.id);
 await page.clock.runFor(61000);
 await expect(page.getByRole('region',{name:'添加账号',exact:true}).getByText('自动核对已达 60 秒，尚未确认原操作结果。',{exact:true})).toBeVisible();
 const reads=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_snapshot'&&c.args.platform==='openai').length);
 const stopped=await reads();await page.clock.runFor(5000);expect(await reads()).toBe(stopped);
 await page.getByRole('region',{name:'添加账号',exact:true}).getByRole('button',{name:'核对结果',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect.poll(reads).toBe(stopped+1);
 const calls=await page.evaluate(()=>(window as any).calls);
 expect(calls.filter((c:any)=>c.command==='account_action')).toHaveLength(1);
 expect(calls.filter((c:any)=>c.command==='account_snapshot'&&c.args.platform==='openai').every((c:any)=>c.args.refresh===false)).toBe(true);
 expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(id);
 await expect(page.getByRole('region',{name:'添加账号',exact:true}).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.operation.id='f'.repeat(48);a.operation.revision=++a.revision;});
 await page.clock.runFor(11000);
 await expect(page.getByRole('region',{name:'添加账号',exact:true}).getByText('本轮查询已停止，尚未确认原操作结果。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'查看错误详情',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('required='+id);
 await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('actual='+'f'.repeat(48));
});

test('credential failures retain quota, deduplicate one cause and preserve independent faults and pause',async({page})=>{
 await page.clock.install();await page.setViewportSize({width:820,height:680});await setup(page,true);
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
 await page.evaluate(()=>{
  const w=window as any,a=w.accounts.openai;w.paused.openai=true;
  const source={code:'permission_denied',check:'source_read',platform:'openai',message:'Controlled credential access denied: EACCES',evidence:{permission_denied:'true'}};
  a.candidate.error=source;a.authorization.error=structuredClone(source);a.issues=[{code:source.code,platform:'openai',fingerprint:a.selection.fingerprint,message:source.message,notify:false}];
  a.hive.error={code:'registration_rejected',check:'hive_registration',platform:'openai',message:'Controlled Hive registration rejected: HTTP 403',evidence:{}};a.revision++;
 });
 await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('没有读取所选凭证来源的权限。');
 await expect(card(page).locator('.oa-note')).toHaveText('接单保持暂停。');
 await expect(card(page).locator('.oa-quota')).toHaveCount(1);
 await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
 await expect(card(page).getByText('接单保持暂停。',{exact:true})).toBeVisible();
 await card(page).getByRole('button',{name:'查看错误详情',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'错误详情'}).locator('pre')).toHaveCount(1);
 await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('EACCES');await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('HTTP 403');
 await page.screenshot({path:resolve(evidence,'formal-independent-errors-light-narrow.png')});
 await page.keyboard.press('Escape');await card(page).getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('读取目录')).toBeVisible();expect(await writes(page)).toEqual([]);
 await page.screenshot({path:resolve(evidence,'formal-source-details-light-narrow.png')});
});

const evidence=resolve(import.meta.dirname,'../test-results/compact-list');
test.beforeEach(()=>{mkdirSync(evidence,{recursive:true});});
for(const theme of ['light','dark'])for(const [size,width,height] of [['narrow',820,680],['wide',1080,700]] as const){
 test(`formal React and approved preview — ${theme} ${size}`,async({page})=>{
  mkdirSync(evidence,{recursive:true});await page.clock.install();await page.setViewportSize({width,height});
  await setup(page);await page.getByRole('region',{name:'添加账号',exact:true}).getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'更换连接方式',exact:true}).click();
  await page.getByRole('button',{name:'登录 OpenAI',exact:true}).click();
  await expect(page.getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
  await page.evaluate(()=>{const w=window as any;w.__beeMockControls['login-result']({platform:'openai',operationId:w.accounts.openai.operation.id,value:'succeeded-same'});});await page.clock.runFor(11000);
  await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
  if(await page.getByRole('button',{name:'OpenAI',exact:true}).count())await page.getByRole('button',{name:'OpenAI',exact:true}).click();
  await page.getByRole('button',{name:'确认接入',exact:true}).click();
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
  await page.goto(`/approved-preview/index.html?scene=first-success-paused&theme=${theme}&size=${size}`);
  await expect(page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号'}).getByText('账号接入成功！',{exact:true})).toBeVisible();
  await page.locator('iframe').screenshot({path:resolve(evidence,`approved-first-success-${theme}-${size}.png`)});
 });
}
test('keyring missing keeps true quota and one repair action; unknown quota is never zero',async({page})=>{
 await page.clock.install();await setup(page,true);
 const normal=await card(page).boundingBox();
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai;
  const error={code:'source_missing',check:'read_keyring',platform:'openai',message:'Codex Keychain item absent',evidence:{not_found:'true',permission_denied:'false',cause:'security exit=44: file does not exist'}};
  a.candidate.error=error;a.authorization.error=structuredClone(error);
  a.issues=[{code:'quota_exhausted',platform:'openai',fingerprint:a.selection.fingerprint,message:'Quota exhausted',notify:false}];
  a.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:100,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:20,reset_at:null}];a.revision++;
 });await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('凭证缺失');
 await expect(card(page).getByText('100%',{exact:true})).toBeVisible();await expect(card(page).getByText('20%',{exact:true})).toBeVisible();
 await expect(card(page).getByRole('button',{name:'修改凭证读取设置',exact:true})).toHaveCount(1);
 await expect(card(page).getByText('查看接单条件',{exact:true})).toHaveCount(0);
 const fault=await card(page).boundingBox();expect(fault!.height-normal!.height).toBeLessThan(90);
 await page.screenshot({path:resolve(evidence,'formal-keyring-compact.png')});
 await card(page).getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情'}).locator('pre')).toHaveCount(1);
 await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('security exit=44');await expect(card(page).locator('details details')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(card(page).getByRole('progressbar')).toHaveCount(2);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.capabilities.forEach((c:any)=>c.windows=[]);a.revision++;});await page.clock.runFor(11000);
 await expect(card(page).locator('.quota-value')).toHaveText(['—','—']);
 expect(await writes(page)).toEqual([]);
});

test('different identity opens review before confirmation and Escape restores focus',async({page})=>{
 await page.clock.install();await setup(page,true);
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await expect(page.getByRole('dialog').getByLabel('读取目录')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'OpenAI 详情'})).toBeFocused();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.candidate.fingerprint='c'.repeat(64);a.revision++;});await page.clock.runFor(11000);
 await card(page).getByRole('button',{name:'核对账号变更',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('bbbbbbbbbbbbbbbb');await expect(page.getByRole('dialog')).toContainText('cccccccccccccccc');
 expect(await writes(page)).toEqual([]);
 await page.getByRole('dialog').getByRole('button',{name:'确认换号',exact:true}).click();
 await expect(page.getByRole('dialog').last().getByRole('heading')).toHaveText('确认更换 OpenAI 账号');expect(await writes(page)).toEqual([]);
 await expect(page.getByRole('dialog').last().getByRole('button',{name:'取消',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog').getByRole('button',{name:'确认换号',exact:true})).toBeFocused();
});

test('login maintenance requiring a different account keeps the explicit change review reachable',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{
  const w=window as any,a=w.accounts.openai;a.revision++;
  a.candidate.fingerprint='c'.repeat(64);
  a.operation={id:'e'.repeat(48),kind:'authorize',platform:'openai',state:'succeeded',revision:a.revision,error:null};
  a.login_maintenance={operation:a.operation,phase:'confirmation_required',source:{directory:null,store:'file'},started_at:new Date().toISOString(),can_recheck:true,error:null};
  a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};
  w.paused.openai=true;
 });await page.clock.runFor(11000);
 await expect(card(page).getByRole('button',{name:'核对账号变更',exact:true})).toBeVisible();
 await expect(card(page).locator('.oa-actions').getByRole('button',{name:'核对维护结果',exact:true})).toHaveCount(0);
 await card(page).getByRole('button',{name:'核对账号变更',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('bbbbbbbbbbbbbbbb');await expect(page.getByRole('dialog')).toContainText('cccccccccccccccc');
 await page.getByRole('dialog').getByRole('button',{name:'确认换号',exact:true}).click();
 await expect(page.getByRole('dialog').last().getByRole('heading')).toHaveText('确认更换 OpenAI 账号');
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

test('main preview keeps quota in a read failure',async({page})=>{
 {
  await page.goto(`/approved-preview/index.html?scene=read-failed-allowed&theme=light&size=narrow`);
  const app=page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号'});
  await expect(app).toHaveClass(/oa-compact/);await expect(app.getByRole('progressbar')).toHaveCount(2);
  await expect(app.locator('.workflow')).toHaveCount(0);
  expect(await app.evaluate(el=>getComputedStyle(el).display)).toBe('grid');
  await app.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.frameLocator('iframe').locator('#list-error-popover')).toContainText('EACCES');await page.keyboard.press('Escape');
  await app.getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await expect(page.frameLocator('iframe').getByLabel('读取目录')).toBeVisible();
 }
 await page.locator('iframe').screenshot({path:resolve(evidence,'approved-source-settings-light-narrow.png')});
});

// Mixed account/read failures must resolve to one current action, as in the main preview.
async function setupBlockedIntake(page:Page,unknown:boolean){
 await page.clock.install();
 const openai=accountFixture('openai') as AccountSnapshot;
 openai.revision=5;
 openai.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};
 openai.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),plan:'plus',expires_at:'2099-01-01T00:00:00Z',identity_verified:false,observed_at:new Date().toISOString(),error:null};
 const error={code:'http_rejected',check:'authorization_sync',platform:'openai' as const,message:'authorization synchronization rejected: HTTP 503; upstream unavailable',evidence:{http_status:'503'}};
 openai.operation={id:'d'.repeat(48),kind:'select',platform:'openai',state:unknown?'reconciling':'failed',revision:5,error};
 openai.authorization={state:'unconfirmed',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{openai,claude:accountFixture('claude')},runtimeEnabled:true,scenarios:{autoService:true}})});(${installBlockedIntake.toString()})(${unknown});`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page)).toBeVisible();
 await page.evaluate(()=>(window as any).intakeBlockReads=true);await page.clock.runFor(11000);
}
function installBlockedIntake(unknown:boolean){
 const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
 w.intakeResolved=false;w.intakeBlockReads=false;w.paused.openai=true;
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{
  if(command==='account_snapshot'&&args.platform==='openai'&&w.intakeBlockReads&&!w.intakeResolved&&(!unknown||args.refresh)){
   w.calls.push({command,args});throw {code:'HTTP_403',message:'account observation blocked: HTTP 403; original operation remains available locally'};
  }
  if(command==='supply_status'&&args.platform==='openai'&&w.intakeBlockReads&&!w.intakeResolved){
   w.calls.push({command,args});throw {code:'HTTP_403',message:'supply observation blocked: HTTP 403'};
  }
  const reply=await invoke(command,args);
  if(w.intakeResolved){
   const a=w.accounts.openai;a.revision=Math.max(6,a.revision);a.operation={...a.operation,state:'succeeded',revision:a.revision,error:null};a.authorization={...a.authorization,state:'synchronized',error:null};a.hive={...a.hive,state:'ready',fingerprint:a.selection.fingerprint,generation:1,error:null};
   if(command==='account_snapshot'&&args.platform==='openai')reply.result.account=structuredClone(a);
  }
  return reply;
 };
}
test('unknown intake shows one original-result query and preserves evidence without repeating selection',async({page})=>{
 await setupBlockedIntake(page,true);await page.clock.runFor(61000);
 await expect(card(page).locator('.oa-title')).toHaveText('暂时无法确认接入结果');
 await expect(card(page).getByRole('button',{name:'核对结果',exact:true})).toHaveCount(1);
 await expect(card(page).getByRole('button',{name:/重新查询状态|重新核验|重试$/})).toHaveCount(0);
 await card(page).getByRole('button',{name:'查看错误详情'}).click();
 await expect(page.getByText(/authorization synchronization rejected: HTTP 503/)).toBeVisible();
 await page.keyboard.press('Escape');
 const before=await writes(page);await card(page).getByRole('button',{name:'核对结果',exact:true}).click();
 expect(await writes(page)).toEqual(before);
 await page.clock.runFor(61000);await page.evaluate(()=>(window as any).intakeResolved=true);
 await card(page).getByRole('button',{name:'核对结果',exact:true}).click();
 await expect(card(page).locator('.oa-title')).not.toHaveText('暂时无法确认接入结果');
 await expect(card(page).getByRole('button',{name:'核对结果',exact:true})).toHaveCount(0);
 expect(await writes(page)).toEqual(before);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});
test('selected preparation failure has a specific cause, one retry, and header details like the main preview',async({page})=>{
 await setupBlockedIntake(page,false);
 await expect(card(page).getByRole('status')).toContainText('503');
 await expect(card(page)).toContainText('账号已接入');
 await expect(card(page).getByRole('button',{name:'重试',exact:true})).toHaveCount(1);
 await expect(card(page).getByRole('button',{name:/重新查询状态|核对结果|重新核验/})).toHaveCount(0);
 await expect(card(page).locator('.oa-head').getByRole('button',{name:'OpenAI 详情'})).toBeVisible();
 await expect(page.getByText('核对已暂停，需先处理当前问题。',{exact:true})).toHaveCount(0);
 const before=await writes(page);await page.evaluate(()=>(window as any).intakeResolved=true);
 await card(page).getByRole('button',{name:'重试',exact:true}).click();
 await expect(card(page).locator('.oa-title')).not.toContainText('503');
 const after=await writes(page);expect(after.filter((c:any)=>c.command!=='runtime_start')).toEqual(before);
 expect(after.filter((c:any)=>c.command==='runtime_start').every((c:any)=>c.args.request.resume_platforms.length===0)).toBe(true);
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});


for(const [size,width,height] of [['wide',1080,700],['narrow',860,680]] as const)test(`preparation failure matches main preview hierarchy — ${size}`,async({page})=>{
 await page.setViewportSize({width,height});await setupBlockedIntake(page,false);
 const actual=card(page);
 await expect(actual.locator('.oa-steps .done')).toHaveCount(1);await expect(actual.locator('.oa-steps .failed')).toHaveCount(1);
 await expect(actual.getByRole('progressbar')).toHaveCount(2);
 await expect(actual.locator('.oa-head').getByRole('button',{name:'OpenAI 详情'})).toBeVisible();
 await expect(actual.locator('.oa-actions button:visible')).toHaveText(['重试']);
 await expect(page.locator('.page-heading').getByRole('button',{name:'添加账号',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:resolve(evidence,`formal-prepare-failed-${size}.png`),fullPage:true});
 await actual.getByRole('button',{name:'查看错误详情'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('HTTP 503');await page.keyboard.press('Escape');
 await expect(actual.getByRole('button',{name:'查看错误详情'})).toBeFocused();
 await page.goto(`/approved-preview/index.html?scene=add-prepare-failed&theme=light&size=${size==='narrow'?'narrow':'wide'}`);
 const approved=page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号'});
 await expect(approved.getByRole('button',{name:'重试',exact:true})).toBeVisible();
 await expect(approved).toContainText('账号已接入');await expect(approved.getByRole('progressbar')).toHaveCount(2);
 await page.locator('iframe').screenshot({path:resolve(evidence,`approved-prepare-failed-${size}.png`)});
});


test('cancelling relogin keeps account details open and confirmation reveals the login flow',async({page})=>{
 await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();
 const details=page.getByRole('dialog',{name:'OpenAI 账号详情',exact:true});await details.getByRole('button',{name:'重新登录',exact:true}).click();
 await expect(details).toBeHidden();
 await expect(page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true}).getByRole('button',{name:'关闭',exact:true})).toBeVisible();
 await page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true}).getByRole('button',{name:'取消',exact:true}).click();await expect(details).toBeVisible();expect(await writes(page)).toEqual([]);
 for(const dismiss of ['close','escape']){
  await details.getByRole('button',{name:'重新登录',exact:true}).click();await expect(details).toBeHidden();
  if(dismiss==='close')await page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();else await page.keyboard.press('Escape');
  await expect(details).toBeVisible();await expect(details.getByRole('button',{name:'重新登录',exact:true})).toBeFocused();expect(await writes(page)).toEqual([]);
 }
 await details.getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true}).getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

 test('confirmed relogin progress retains the approved steps without enabling another submission',async({page})=>{
 await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
 const steps=card(page).getByRole('list',{name:'OpenAI 当前流程'});
 await expect(steps).toBeVisible();await expect(steps.locator('li')).toHaveText(['1重新登录当前阶段','2核验账号未开始']);
 await page.evaluate(()=>(window as any).loginPhase='verifying');
 await expect(card(page).getByRole('status')).toHaveText('正在核验账号…');
 await expect(steps.locator('.done')).toHaveCount(1);
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
 });

 test('unconfirmed relogin cancellation only queries the original operation',async({page})=>{
 await page.clock.install();await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();
 await expect(card(page).getByRole('button',{name:'取消登录',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).accountScenarios.cancelUnknown=true);await card(page).getByRole('button',{name:'取消登录',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('暂时无法确认取消结果');await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'核对登录结果',exact:true})).toHaveCount(0);await page.evaluate(()=>(window as any).queryFailure=true);await page.clock.runFor(8100);await card(page).getByRole('button',{name:'核对登录结果',exact:true}).click();
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect((await writes(page)).filter((c:any)=>c.command==='authorize_cancel')).toHaveLength(1);
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
 });
 test('confirmed cancellation offers explicit relogin without resuming supply',async({page})=>{
 await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();await card(page).getByRole('button',{name:'取消登录',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('已取消登录');await expect(card(page).getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
 await card(page).getByRole('button',{name:'重新登录',exact:true}).click();await expect(page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true})).toBeVisible();
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
 });

test('expired selected authorization offers relogin without automatically changing supply',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{const w=window as any;w.expiry=new Date(Date.now()-60000).toISOString();w.accounts.openai.candidate.expires_at=w.expiry;w.accounts.openai.revision++;});await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('授权已过期');await expect(card(page).getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);
 await card(page).getByRole('button',{name:'重新登录',exact:true}).click();await expect(page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true})).toBeVisible();expect(await writes(page)).toEqual([]);
});
for(const [code,check,title,completed] of [
 ['client_missing','official_executable','未找到 Codex',0],
 ['authorization_timeout','official_version','登录已超时',0],
 ['authorization_timeout','official_process','登录已超时',0],
 ['authorization_timeout','official_source_recheck','登录已超时',1],
] as const)test(`login failure only completes proven prior steps: ${code}/${check}`,async({page})=>{
 await page.clock.install();await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录'}).click();await expect(card(page).getByRole('button',{name:'取消登录',exact:true})).toBeVisible();
 await page.evaluate(({code,check})=>{const w=window as any;w.__beeMockControls['login-result']({platform:'openai',operationId:w.accounts.openai.operation.id,value:'failed'});w.accounts.openai.operation.error={platform:'openai',code,check,message:`controlled failure at ${check}`,evidence:{}};},{code,check});await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText(title);await expect(card(page).locator('.oa-steps .done')).toHaveCount(completed);await expect(card(page).locator('.oa-steps .failed')).toHaveCount(1);
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

for(const [size,width,height] of [['narrow',820,680],['wide',1080,700]] as const)test(`light login confirmation matches approved geometry — ${size}`,async({page})=>{
 await page.setViewportSize({width,height});await setup(page,true);
 await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 await page.getByRole('dialog',{name:'OpenAI 账号详情',exact:true}).getByRole('button',{name:'重新登录',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'重新登录 OpenAI',exact:true});
 const actual=await confirmation.boundingBox();
 await page.screenshot({path:resolve(evidence,`formal-login-confirm-light-${size}.png`)});
 expect(await writes(page)).toEqual([]);
 await page.goto(`/approved-preview/index.html?scene=add-list&theme=light&size=${size}`);
 const app=page.frameLocator('iframe');
 await app.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await app.getByRole('button',{name:'重新登录',exact:true}).click();
 const approved=await app.getByRole('dialog',{name:'重新登录 OpenAI',exact:true}).boundingBox();
 await page.locator('iframe').screenshot({path:resolve(evidence,`approved-login-confirm-light-${size}.png`)});
 expect(Math.abs(actual!.width-approved!.width)).toBeLessThanOrEqual(0.1);
 expect(Math.abs(actual!.height-approved!.height)).toBeLessThanOrEqual(0.1);
});

test('rejected relogin preserves admission evidence after background refresh and never completes a step',async({page})=>{
 await setup(page,true);
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>{if(command==='authorize_start'){w.calls.push({command,args});return Promise.reject({code:'AUTHORIZE_OPERATION_FAILED',message:'authorize revision changed: actual=71 expected=61'});}return invoke(command,args);};});
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始官方登录'}).click();
 await expect(card(page).getByRole('status')).toHaveText('官方登录未完成');
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('官方登录未完成');
 await expect(card(page).locator('.oa-steps .done')).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
 await card(page).getByRole('button',{name:'查看错误详情'}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('actual=71 expected=61');
 expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(false);
});

for(const changedIdentity of [false,true])test(`relogin rereads account revision and ${changedIdentity?'rejects changed identity':'submits the fresh revision'}`,async({page})=>{
 await setup(page,true);
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
 await page.evaluate(changed=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let changedOnce=false;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>{if(command==='account_snapshot'&&args.platform==='openai'&&!changedOnce){changedOnce=true;w.accounts.openai.revision+=10;if(changed)w.accounts.openai.selection.fingerprint='c'.repeat(64);}return invoke(command,args);};},changedIdentity);
 await page.getByRole('dialog').getByRole('button',{name:'开始官方登录'}).click();
 if(changedIdentity){await expect(card(page).getByRole('status')).toHaveText('官方登录未完成');expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(0);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(false);}
 else {await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();expect((await writes(page)).filter((c:any)=>c.command==='authorize_start')).toHaveLength(1);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);}
});

for(const [size,width,height]of [['narrow',820,680],['wide',1080,700]] as const)test(`relogin completion matches approved copy and preserves pause — light ${size}`,async({page},testInfo)=>{
 await page.clock.install();await page.setViewportSize({width,height});await setup(page,true);
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始官方登录'}).click();await expect(card(page).getByRole('button',{name:'打开登录页面',exact:true})).toBeVisible();
 await page.evaluate(()=>{const w=window as any;w.__beeMockControls['login-result']({platform:'openai',operationId:w.accounts.openai.operation.id,value:'succeeded-same'});const a=w.accounts.openai;a.authorization={...a.authorization,state:'synchronized',fingerprint:a.selection.fingerprint};a.hive={...a.hive,state:'ready',fingerprint:a.selection.fingerprint,generation:1};a.revision++;});await page.clock.runFor(11000);
 // The fixture's login command only detects credentials; supply the separate
 // completed Hive preparation receipt after that detection settles.
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.authorization={...a.authorization,state:'synchronized',fingerprint:a.selection.fingerprint};a.hive={...a.hive,state:'ready',fingerprint:a.selection.fingerprint,generation:1};a.revision++;});await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('重新登录成功');await expect(card(page).locator('.oa-note')).toHaveText('已完成重新登录，接单保持暂停。');await expect(card(page).locator('.oa-steps .done')).toHaveCount(2);await expect(card(page).getByRole('progressbar')).toHaveCount(0);
 const actualBox=await card(page).boundingBox();
 await card(page).screenshot({path:testInfo.outputPath(`formal-relogin-complete-${size}.png`)});
 const before=await writes(page);await card(page).getByRole('button',{name:'完成',exact:true}).click();await expect(card(page).getByRole('status')).toHaveText('已暂停');expect(await writes(page)).toEqual(before);
 await page.goto(`/approved-preview/index.html?scene=complete-relogin-paused&theme=light&size=${size}`);
 // The preview toolbar size includes its iframe border. Calibrate the test
 // surface only, so the unchanged design renders at the same content size.
 await page.locator('iframe').evaluate(frame=>{frame.style.boxSizing='content-box';});
 expect(await page.frameLocator('iframe').locator('html').evaluate(el=>[el.clientWidth,el.clientHeight])).toEqual([width,height]);
 const approved=page.frameLocator('iframe').getByRole('region',{name:'OpenAI 账号',exact:true});await expect(approved.getByRole('status')).toHaveText('重新登录成功');await expect(approved).toContainText('已完成重新登录，接单保持暂停。');await expect(approved.getByRole('progressbar')).toHaveCount(0);
 const approvedBox=await approved.boundingBox();
 expect(Math.abs(actualBox!.width-approvedBox!.width)).toBeLessThanOrEqual(0.1);expect(Math.abs(actualBox!.height-approvedBox!.height)).toBeLessThanOrEqual(0.1);
 await approved.screenshot({path:testInfo.outputPath(`approved-relogin-complete-${size}.png`)});
});

test('restored cancelled login drops stale progress blocker without resuming supply',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai,problem={code:'source_missing',check:'read_file',platform:'openai',message:'source file missing during cancelled login',evidence:{not_found:'true'}},op={id:'d'.repeat(48),kind:'authorize',platform:'openai',state:'cancelled',revision:++a.revision,error:{...problem,code:'authorization_cancelled',check:'official_process',message:'context canceled'}};
  a.operation=op;a.login_maintenance={operation:op,phase:'blocked',source:a.candidate.source,started_at:new Date().toISOString(),can_recheck:true,error:problem};w.paused.openai=true;
  const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);if(command==='authorize_progress')reply.result.progress.blocker=problem;return reply;};
 });await page.clock.runFor(11000);
 await expect(card(page).getByRole('button',{name:'核对维护结果',exact:true})).toBeVisible();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.login_maintenance={...a.login_maintenance,phase:'restored',can_recheck:false,error:null};a.revision++;});await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('已取消登录');await expect(card(page).getByRole('button',{name:'查看错误详情'})).toHaveCount(0);await expect(card(page)).toContainText('接单保持暂停');expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

test('saved source closes the drawer and cannot report repaired before its read completes',async({page})=>{
 await setup(page,true);await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let held=false;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='account_detect'&&args.request.platform==='openai'&&!held){held=true;await new Promise<void>(resolve=>{w.releaseSourceRead=resolve;});}return invoke(command,args);};});
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(card(page).getByRole('status')).toHaveText('正在读取登录凭证…');await expect(card(page).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).releaseSourceRead());await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.mode==='official').length)).toBeGreaterThan(0);expect(await writes(page)).toEqual([]);
});

test('source verification pending after save keeps the verification state and hides resume',async({page})=>{
 await setup(page,true);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.paused.openai=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);if(command==='account_detect'&&args.request.platform==='openai'&&args.request.mode==='official'){const a=w.accounts.openai;a.capabilities[0]={...a.capabilities[0],status:'unknown',observed_at:null,valid_until:null,windows:[]};reply.result.account=structuredClone(a);}return reply;};});
 await card(page).getByRole('button',{name:'OpenAI 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.mode==='official').length)).toBeGreaterThan(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(card(page).getByRole('status')).toHaveText('正在核验账号…');await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);await expect(card(page).getByRole('button',{name:'完成',exact:true})).toHaveCount(0);expect(await writes(page)).toEqual([]);
});

test('official transport failure keeps last quota and explains no HTTP response without replaying writes',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai;w.paused.openai=true;Object.assign(a.capabilities[1],{status:'unknown',observed_at:null,valid_until:null,windows:[]});Object.assign(a.capabilities[0],{status:'ready',observed_at:new Date().toISOString(),valid_until:'2099-01-01T00:00:00Z',windows:[{scope:'',seconds:18000,used_percent:7,reset_at:null},{scope:'',seconds:604800,used_percent:23,reset_at:null}]});a.revision++;});
 await page.clock.runFor(11000);await expect(card(page).locator('.quota-value')).toHaveText(['7%','23%']);
 const before=await writes(page);
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>command==='account_detect'&&args.request?.platform==='openai'?Promise.resolve({instance:'b'.repeat(32),result:{account:structuredClone(a)}}):invoke(command,args);Object.assign(a.capabilities[0],{status:'unknown',observed_at:new Date().toISOString(),valid_until:null,windows:[],error:{code:'official_check_failed',check:'capabilities',platform:'openai',message:'proxyconnect tcp: dial tcp 127.0.0.1:1087: connect: connection refused',evidence:{http_status:'0',transport_failed:'true'}}});a.revision++;});
 await page.clock.runFor(11000);await expect(card(page).locator('.quota-value')).toHaveText(['7%','23%']);await expect(card(page).locator('.account-list-quota')).toContainText('上次记录');
 await card(page).getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('未收到 HTTP 响应');await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('127.0.0.1:1087');
 await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'查看错误详情',exact:true})).toBeFocused();expect(await writes(page)).toEqual(before);
});

for(const paused of [false,true])test(`preparing account focuses progress and prevents adding another account until settled ${paused}`,async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(paused=>{const w=window as any,a=w.accounts.openai;w.paused.openai=paused;a.authorization.state='preparing';a.revision++;const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);if(a.authorization.state==='preparing')for(const value of [reply?.result?.supply,reply?.result?.runtime?.platforms?.openai?.supply])if(value?.platform==='openai'){value.ready=false;value.reasons=[...(paused?['manually_paused']:[]),'authorization_unavailable'];}return reply;};},paused);await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('正在准备接单…');
 await expect(page.locator('.page-heading').getByRole('button',{name:'添加账号',exact:true})).toBeDisabled();
 await expect(card(page).locator('.oa-quota')).toHaveCount(0);
 await expect(card(page)).not.toContainText('Hive 没有可用的加密授权');
 const before=await writes(page);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.authorization.state='synchronized';a.revision++;});await page.clock.runFor(11000);
 await expect(page.locator('.page-heading').getByRole('button',{name:'添加账号',exact:true})).toBeEnabled();
 await expect(card(page).getByRole('progressbar')).toHaveCount(2);
 expect(await writes(page)).toEqual(before);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(paused);
});
test('preparation does not hide an independently exhausted quota',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai,invoke=w.__TAURI_INTERNALS__.invoke;a.authorization.state='preparing';a.revision++;a.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:100,reset_at:null}];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);for(const value of [reply?.result?.supply,reply?.result?.runtime?.platforms?.openai?.supply])if(value?.platform==='openai'){value.ready=false;value.reasons=['quota_exhausted'];}return reply;};});await page.clock.runFor(11000);
 await expect(card(page).getByRole('status')).toHaveText('正在准备接单…');
 await expect(card(page).getByRole('progressbar')).toHaveCount(2);
 await expect(card(page).locator('.quota-value')).toHaveText(['100%','—']);
 expect(await writes(page)).toEqual([]);
});

for(const condition of ['quota','quota-and-market','paused'] as const)test(`intake completion explains ${condition} without claiming request readiness`,async({page})=>{
 await setup(page);
 await page.evaluate(condition=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);if(command==='account_action')w.paused.openai=condition==='paused';for(const value of [reply?.result?.supply,reply?.result?.runtime?.platforms?.openai?.supply])if(value?.platform==='openai'){value.ready=false;value.paused=condition==='paused';value.reasons=condition==='paused'?['manually_paused','quota_exhausted']:condition==='quota'?['quota_exhausted']:['quota_exhausted','market_not_open'];}return reply;};},condition);
 await page.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByRole('status')).toHaveText('账号接入成功！');
 await expect(card(page)).toContainText(condition==='paused'?'账号已接入，接单保持暂停。':condition==='quota'?'账号已接入，等待额度恢复后接单。':'账号已接入，等待接单条件恢复。');
 await expect(card(page)).not.toContainText('可以接单了');
 const before=await writes(page);await card(page).getByRole('button',{name:'完成',exact:true}).click();expect(await writes(page)).toEqual(before);
 expect(before.filter((c:any)=>c.command==='supply_set_paused')).toEqual([]);
});
