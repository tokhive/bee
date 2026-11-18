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
   const a=w.accounts[args.request.platform];a.hive={...a.hive,state:'ready',fingerprint:a.selection.fingerprint,generation:1};a.authorization={...a.authorization,state:args.request.platform==='claude'&&w.keepClaudePreparing?'unconfirmed':'synchronized',fingerprint:a.selection.fingerprint};
   reply.result.account=structuredClone(a);
  }
  if(command==='runtime_snapshot'){
   reply.result.runtime.local='running';reply.result.runtime.run_id='a'.repeat(32);reply.result.runtime.connection='connected';
   for(const p of ['openai','claude'])reply.result.runtime.platforms[p].supply=supply(p);
  }
  if(command==='supply_status')reply.result.supply=supply(args.platform);
  if(w.quotaReasons){for(const value of [reply.result?.supply,reply.result?.runtime?.platforms?.openai?.supply])if(value?.platform==='openai'){value.reasons=[...(value.paused?['manually_paused']:[]),...w.quotaReasons];value.ready=false;}}
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
for(const width of [1080,820,600])test(`compact list evidence remains read-only and accessible at ${width}px`,async({page})=>{
 await page.clock.install();await page.setViewportSize({width,height:900});await setup(page,true);
 await page.evaluate(()=>{const w=window as any,a=w.accounts.openai;w.paused.openai=true;
 const error={code:'source_missing',check:'read_keyring',platform:'openai',message:'Codex Keychain item absent: security exit=44: file does not exist',evidence:{not_found:'true',permission_denied:'false',cause:'security exit=44: file does not exist'}};
 a.candidate.error=error;a.authorization.error=structuredClone(error);a.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:100,reset_at:'2099-01-01T00:00:00Z'},{scope:'',seconds:604800,used_percent:20,reset_at:null}];a.revision++;});await page.clock.runFor(11000);
 const trigger=card(page).getByRole('button',{name:'查看错误详情',exact:true});await expect(trigger).toBeVisible();await expect(card(page).locator('.is-exhausted [data-slot=progress-indicator]')).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(card(page).locator('.account-list-quota')).toContainText('上次记录');await expect(card(page).locator('.quota-value')).toHaveText(['100%','20%']);
 const before=await writes(page),height=(await card(page).boundingBox())!.height;await trigger.focus();await page.keyboard.press('Enter');
 const popover=page.getByRole('dialog',{name:'错误详情',exact:true});await expect(popover).toContainText('security exit=44');await expect(popover).toContainText('permission_denied: false');await expect(popover.locator('details')).toHaveCount(0);await expect(popover.getByRole('button',{name:'修改凭证读取设置'})).toHaveCount(0);expect((await card(page).boundingBox())!.height).toBe(height);
 await page.keyboard.press('Escape');await expect(popover).toHaveCount(0);await expect(trigger).toBeFocused();await trigger.click();await page.getByRole('heading',{name:'AI 账号',exact:true}).click();await expect(popover).toHaveCount(0);
 await trigger.click();await page.getByRole('button',{name:'关闭错误详情',exact:true}).click();await expect(trigger).toBeFocused();expect(await writes(page)).toEqual(before);
 await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);await expect(card(page).getByText('接单保持暂停。',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const dir=resolve(import.meta.dirname,'../test-results/compact-list');mkdirSync(dir,{recursive:true});await page.screenshot({path:resolve(dir,`native-${width}.png`)});
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});await trigger.click();await page.screenshot({path:resolve(dir,`native-error-${width}-dark.png`)});
});
test('unknown windows and exhausted quota do not invent values or operation failures',async({page})=>{
 await page.clock.install();await setup(page,true);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.capabilities.forEach((c:any)=>c.windows=[]);a.revision++});await page.clock.runFor(11000);
 await expect(card(page).locator('.account-list-quota')).toBeVisible();await expect(card(page).locator('.quota-value')).toHaveText(['—','—']);for(const bar of await card(page).getByRole('progressbar').all())await expect(bar).not.toHaveAttribute('aria-valuenow');
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.capabilities[0].windows=[{scope:'',seconds:18000,used_percent:100,reset_at:null}];a.issues=[{code:'quota_exhausted',platform:'openai',fingerprint:a.selection.fingerprint,message:'Quota exhausted',notify:false}];a.revision++});await page.clock.runFor(11000);
 await expect(card(page).locator('.quota-value')).toHaveText(['100%','—']);await expect(card(page).getByRole('button',{name:'查看错误详情'})).toHaveCount(0);expect(await writes(page)).toEqual([]);
});

test('changed error evidence dismisses the old popover without changing pause',async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate(()=>{const w=window as any;w.paused.openai=true;w.accounts.openai.candidate.error={code:'permission_denied',check:'source_read',platform:'openai',message:'First controlled EACCES',evidence:{permission_denied:'true'}};w.accounts.openai.revision++});await page.clock.runFor(11000);
 await card(page).getByRole('button',{name:'查看错误详情'}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('First controlled');
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.candidate.error.message='Updated controlled EACCES';a.revision++});await page.clock.runFor(11000);
 await expect(page.getByRole('dialog',{name:'错误详情'})).toHaveCount(0);await card(page).getByRole('button',{name:'查看错误详情'}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('Updated controlled');await expect(page.getByRole('dialog',{name:'错误详情'})).not.toContainText('First controlled');
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.candidate.error=null;a.revision++});await page.clock.runFor(11000);await expect(page.getByRole('dialog',{name:'错误详情'})).toHaveCount(0);await expect(card(page).getByRole('button',{name:'查看错误详情'})).toHaveCount(0);expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

for(const state of ['exhausted','checking','paused','blocked'] as const)test(`quota status stays concise without hiding ${state} facts`,async({page})=>{
 await page.clock.install();await setup(page,true);
 await page.evaluate((state)=>{
  const w=window as any,a=w.accounts.openai;
  w.paused.openai=state==='paused';w.quotaReasons=state==='blocked'?['quota_exhausted','market_not_open']:['quota_exhausted'];
  a.capabilities.forEach((c:any)=>{c.windows=[{scope:'',seconds:18000,used_percent:100,reset_at:state==='checking'?new Date(Date.now()-1000).toISOString():'2099-01-01T00:00:00Z'}];});a.revision++;
  if(state==='checking'){const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>command==='account_detect'&&args.request?.mode==='official'?new Promise(()=>{}):invoke(command,args);}
 },state);await page.clock.runFor(11000);
 await expect(card(page).locator('.oa-title')).toHaveText(state==='paused'?'已暂停':state==='checking'?'正在核验额度…':state==='blocked'?'账号订阅额度已耗尽':'额度已耗尽');
 if(state!=='blocked')await expect(card(page).locator('.oa-note')).toHaveCount(0);
 else {await expect(card(page).locator('.oa-note')).not.toBeEmpty();await expect(card(page)).toContainText('Hive 尚未开放 OpenAI 模型交易');}
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(state==='paused');
});

for(const fault of ['source','expired','normal','login','completion','cancel-unknown'] as const)test(`Claude compact ${fault} offers the matching action without changing pause`,async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:(fault==='expired'||fault==='login'||fault==='completion'||fault==='cancel-unknown')?new Date(Date.now()-60000).toISOString():'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:fault==='source'?{platform:'claude',code:'permission_denied',check:'read_keychain',message:'keychain read denied',evidence:{permission_denied:'true'}}:null};
 claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};claude.hive={...claude.hive,state:'ready',fingerprint:fp,generation:1};claude.authorization={...claude.authorization,state:'synchronized',fingerprint:fp};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 const row=page.getByRole('region',{name:'Claude 账号',exact:true});await expect(row).toContainText('已接入账号');if(fault!=='expired'&&fault!=='login'&&fault!=='completion'&&fault!=='cancel-unknown')await expect(row).toContainText('系统钥匙串');else await expect(row.getByRole('list',{name:'Claude 当前流程'})).toBeVisible();
 if(fault==='source'){
  await expect(row.getByRole('status')).toContainText('无法读取系统钥匙串凭证');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
  await row.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情',exact:true})).toContainText('permission_denied: true');await page.keyboard.press('Escape');
  await row.getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 }else if(fault==='expired'||fault==='login'||fault==='completion'||fault==='cancel-unknown'){
  await expect(row.getByRole('status')).toContainText('授权已过期');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
  await row.getByRole('button',{name:'重新登录',exact:true}).click();await expect(page.getByRole('dialog',{name:'重新登录 Claude',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toContainText('系统钥匙串');await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(row.getByRole('list',{name:'Claude 当前流程'})).toBeVisible();
 }else await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
 if(fault==='login'||fault==='completion'||fault==='cancel-unknown'){
  await row.getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始官方登录',exact:true}).click();
  const login=row.getByRole('region',{name:'Claude 登录状态',exact:true});await expect(login).toContainText('等待完成 Claude 登录');await expect(login.getByRole('list',{name:'Claude 当前流程'})).toBeVisible();await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
  if(fault==='completion'){await page.evaluate(()=>{const w=window as any;w.__beeMockControls['login-result']({platform:'claude',operationId:w.accounts.claude.operation.id,value:'succeeded-same'});});await page.clock.runFor(11000);await expect(login).toContainText('重新登录成功');await login.getByRole('button',{name:'完成',exact:true}).click();await expect(login).toHaveCount(0);await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();}else if(fault==='cancel-unknown'){await page.evaluate(()=>{(window as any).accountScenarios.cancelUnknown=true;});await login.getByRole('button',{name:'取消登录',exact:true}).click();await expect(login).toContainText('暂时无法确认取消结果');await expect(login.getByRole('button',{name:'重新登录',exact:true})).toHaveCount(0);await page.clock.runFor(11000);await expect(login).toContainText('暂时无法确认取消结果');}else {await login.getByRole('button',{name:'取消登录',exact:true}).click();await expect(login).toContainText('已取消登录');}expect((await writes(page)).filter((x:any)=>x.command==='authorize_start')).toHaveLength(1);expect((await writes(page)).filter((x:any)=>x.command==='authorize_cancel')).toHaveLength(fault==='completion'?0:1);expect((await writes(page)).filter((x:any)=>x.command==='supply_set_paused')).toHaveLength(0);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
 }

});

test('Claude source editing is explicit, preserves failed drafts and uses only confirmed saved settings',async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});await row.getByRole('button',{name:'Claude 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'凭证读取设置',exact:true}),field=settings.getByRole('textbox',{name:'配置目录',exact:true});await field.fill('/tmp/claude-draft');await field.blur();
 expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='preferences_save'))).toEqual([]);
 await settings.getByRole('button',{name:'取消',exact:true}).click();await row.getByRole('button',{name:'Claude 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await expect(field).toHaveValue('');
 await field.fill('/tmp/claude-saved');await page.evaluate(()=>(window as any).preferencesFail=true);await settings.getByRole('button',{name:'保存',exact:true}).click();await expect(field).toHaveValue('/tmp/claude-saved');await expect(settings.getByRole('alert')).toContainText('系统拒绝访问');await settings.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情',exact:true})).toContainText('os_code=13');await page.keyboard.press('Escape');await expect(field).toHaveValue('/tmp/claude-saved');
 expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.directory==='/tmp/claude-saved'))).toEqual([]);
 await page.evaluate(()=>{const w=window as any;w.preferencesFail=false;w.corruptSourceReadback=true;const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const reply=await invoke(command,args);if(command==='preferences_read'&&w.corruptSourceReadback&&reply.preferences.claude_source)reply.preferences.claude_source={directory:'/tmp/unconfirmed-other-source',store:'keychain'};return reply;};});
 await settings.getByRole('button',{name:'保存',exact:true}).click();await expect(settings.getByRole('alert')).toBeVisible();await expect(field).toHaveValue('/tmp/claude-saved');expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.directory==='/tmp/claude-saved'))).toEqual([]);
 await page.evaluate(()=>(window as any).corruptSourceReadback=false);await settings.getByRole('button',{name:'保存',exact:true}).click();await expect(settings).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.platform==='claude'&&c.args.request.directory==='/tmp/claude-saved').length)).toBeGreaterThan(0);
 const prefs=await page.evaluate(()=>(window as any).__TAURI_INTERNALS__.invoke('preferences_read',{}));expect(prefs.preferences.claude_source).toEqual({directory:'/tmp/claude-saved',store:'keychain'});expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);expect(await page.evaluate(()=>(window as any).accounts.claude.selection.fingerprint)).toBe(fp);
});

test('saved Claude source is restored before automatic reads and leaves OpenAI source unchanged',async({page})=>{
 const claude=accountFixture('claude'),openai=accountFixture('openai');
 await page.addInitScript(installAccountFixture,{accounts:{claude,openai},runtimeEnabled:true,scenarios:{autoService:true},initialPreferences:{claude_source:{directory:'/tmp/claude-restored',store:'file'},openai_source:{directory:'/tmp/codex-kept',store:'file'}}});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'&&c.args.request.platform==='claude').length)).toBeGreaterThan(0);
 const reads=await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='account_detect'));
 expect(reads.filter((c:any)=>c.args.request.platform==='claude').every((c:any)=>c.args.request.directory==='/tmp/claude-restored'&&c.args.request.store==='file')).toBe(true);
 expect(reads.filter((c:any)=>c.args.request.platform==='openai').every((c:any)=>c.args.request.directory==='/tmp/codex-kept')).toBe(true);
 expect(await writes(page)).toEqual([]);
});

test('Claude login confirmation cancellation returns to detail and restores keyboard focus',async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});

 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 const row=page.getByRole('region',{name:'Claude 账号',exact:true});await row.getByRole('button',{name:'Claude 详情'}).click();
 const details=page.getByRole('dialog',{name:'Claude 账号详情',exact:true});await details.getByRole('button',{name:'重新登录',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'重新登录 Claude',exact:true});await expect(confirmation).toBeVisible();await expect(details).toHaveCount(0);
 await confirmation.getByRole('button',{name:'取消',exact:true}).click();await expect(details).toBeVisible();await expect(details.getByRole('button',{name:'重新登录',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(details).toHaveCount(0);await expect(row.getByRole('button',{name:'Claude 详情'})).toBeFocused();expect(await writes(page)).toEqual([]);
});

for(const paused of [true,false])test(`Claude preparation shows confirmed intake steps without changing pause ${paused}`,async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};
 claude.authorization={state:'preparing',fingerprint:fp,observed_at:now,error:null};claude.operation={id:'e'.repeat(48),kind:'select',platform:'claude',state:'running',revision:claude.revision,error:null};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=${paused};`});

 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});
 await expect(row.getByRole('list',{name:'Claude 当前流程'})).toContainText('确认接入');await expect(row.locator('[aria-current=step]')).toHaveText('2准备接单');await expect(row.getByRole('status')).toHaveText('正在准备接单…');await expect(row.locator('.account-list-quota')).toHaveCount(0);await expect(row).toContainText('这不改变你的接单选择');
 await row.getByRole('button',{name:'Claude 详情'}).click();await expect(page.getByRole('dialog')).toContainText(fp.slice(0,16));await page.keyboard.press('Escape');expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(paused);if(!paused){await row.getByRole('button',{name:'暂停接单',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).paused.claude)).toBe(true);expect((await writes(page)).filter((x:any)=>x.command==='supply_set_paused')).toHaveLength(1);}await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
});

test('Claude saved source separates local reading from official verification without account writes',async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});

 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});await row.getByRole('button',{name:'Claude 详情'}).click();await page.getByRole('dialog').getByRole('button',{name:'修改凭证读取设置',exact:true}).click();
 await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='account_detect'&&args.request.platform==='claude'&&args.request.directory==='/tmp/claude-phases')await new Promise<void>(resolve=>{w[args.request.mode==='official'?'releaseOfficial':'releaseLocal']=resolve;});return invoke(command,args);};});
 await page.getByRole('dialog').getByLabel('配置目录',{exact:true}).fill('/tmp/claude-phases');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(row.getByRole('status')).toHaveText('正在读取登录凭证…');await expect(row.locator('[aria-current=step]')).toHaveText('1修复读取');
 await page.evaluate(()=>(window as any).releaseLocal());await expect(row.getByRole('status')).toHaveText('正在核验账号…');await expect(row.locator('[aria-current=step]')).toHaveText('2核验账号');await page.evaluate(()=>(window as any).releaseOfficial());await expect(row.getByText('正在核验账号…',{exact:true})).toHaveCount(0);expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
});

test('Claude changed identity requires review and explicit confirmation while retaining the original account',async({page})=>{
 await page.clock.install();
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};
 claude.candidate.fingerprint='b'.repeat(64);claude.hive={...claude.hive,state:'confirmation_required',fingerprint:fp,pending_fingerprint:'b'.repeat(64),generation:1};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});

 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});await expect(row.getByRole('list',{name:'Claude 当前流程'})).toContainText('核对账号');await row.getByRole('button',{name:'核对账号变更',exact:true}).click();
 const review=page.getByRole('dialog',{name:'核对账号变更',exact:true});await expect(review).toContainText(fp.slice(0,16));await expect(review).toContainText('b'.repeat(16));expect(await writes(page)).toEqual([]);
 await review.getByRole('button',{name:'确认换号',exact:true}).click();const confirm=page.getByRole('dialog',{name:'确认更换 Claude 账号',exact:true});await expect(confirm).toBeVisible();await expect(review).not.toBeVisible();await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(review).toBeVisible();await expect(review.getByRole('button',{name:'确认换号',exact:true})).toBeFocused();expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).accounts.claude.selection.fingerprint)).toBe(fp);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
 await review.getByRole('button',{name:'确认换号',exact:true}).click();await expect(confirm).toBeVisible();await page.clock.runFor(100);await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(review).toBeVisible();await expect(review.getByRole('button',{name:'确认换号',exact:true})).toBeFocused();
 await review.getByRole('button',{name:'确认换号',exact:true}).click();await page.evaluate(()=>{const a=(window as any).accounts.claude;a.candidate.fingerprint='d'.repeat(64);a.candidate.reference='d'.repeat(48);a.revision++;});await page.clock.runFor(11000);await expect(confirm.getByRole('alert')).toContainText('本次未提交');await expect(confirm.getByRole('button',{name:'确认更换',exact:true})).toBeDisabled();expect(await writes(page)).toEqual([]);await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(review).toContainText('d'.repeat(16));
 await expect(page.getByRole('button',{name:'返回原处',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).keepClaudePreparing=true);
 await review.getByRole('button',{name:'确认换号',exact:true}).click();await confirm.getByRole('button',{name:'确认更换',exact:true}).click();
 await expect.poll(async()=>(await writes(page)).filter((x:any)=>x.command==='account_action'&&x.args.request.action==='confirm_change').length).toBe(1);
 await expect.poll(()=>page.evaluate(()=>(window as any).accounts.claude.selection.fingerprint)).toBe('d'.repeat(64));
 await expect(row.getByRole('status')).toHaveText('正在准备接单…');await expect(row.locator('[aria-current=step]')).toHaveText('3准备接单');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.keepClaudePreparing=false;w.accounts.claude.authorization.state='synchronized';w.accounts.claude.revision++;});await page.clock.runFor(11000);
 await expect(row.getByRole('status')).toHaveText('账号更换成功');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);await row.getByRole('button',{name:'完成',exact:true}).click();await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 expect((await writes(page)).filter((x:any)=>x.command==='supply_set_paused')).toHaveLength(0);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
});

for(const state of ['pending','reconciling'] as const)test(`Claude change ${state} exposes only original-operation recovery`,async({page})=>{
 await page.clock.install();const claude=accountFixture('claude') as AccountSnapshot,now=new Date().toISOString(),fp='c'.repeat(64);
 claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:'b'.repeat(64),plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};
 claude.operation={id:'e'.repeat(48),kind:'confirm_change',platform:'claude',state,revision:claude.revision,error:null};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});
 await expect(row.getByRole('status')).toHaveText(state==='pending'?'正在更换账号…':'换号结果待核对');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);await expect(row.getByRole('button',{name:'核对账号变更',exact:true})).toHaveCount(0);
 if(state==='pending')await expect(row.locator('[aria-current=step]')).toHaveText('2确认换号');else{await row.getByRole('button',{name:'核对结果',exact:true}).click();await expect(row).toContainText('换号结果待核对');}
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).accounts.claude.operation.id)).toBe('e'.repeat(48));expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
});

test('Claude ended change keeps specific failure and offers a fresh review without changing accounts',async({page})=>{
 await page.clock.install();const claude=accountFixture('claude') as AccountSnapshot,now=new Date().toISOString(),fp='c'.repeat(64);
 claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:'b'.repeat(64),plan:'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:null};claude.operation={id:'e'.repeat(48),kind:'confirm_change',platform:'claude',state:'failed',revision:claude.revision,error:{platform:'claude',code:'account_operation_unconfirmed',check:'account_change_identity',message:'Hive confirmation rejected: generation=2; expected=1',evidence:{cause:'generation=2; expected=1'}}};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();const row=page.getByRole('region',{name:'Claude 账号',exact:true});await expect(row.getByRole('list',{name:'Claude 当前流程'})).toHaveCount(0);await row.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情',exact:true})).toContainText('generation=2');await page.keyboard.press('Escape');await row.getByRole('button',{name:'核对账号变更',exact:true}).click();await expect(page.getByRole('dialog',{name:'核对账号变更',exact:true})).toBeVisible();expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).accounts.claude.selection.fingerprint)).toBe(fp);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
});
