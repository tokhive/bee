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

for(const fault of ['source','expired','normal'] as const)test(`Claude compact ${fault} offers the matching action without changing pause`,async({page})=>{
 const claude=accountFixture('claude') as AccountSnapshot,fp='c'.repeat(64),now=new Date().toISOString();
 claude.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'keychain'},fingerprint:fp,plan:'pro',expires_at:fault==='expired'?new Date(Date.now()-60000).toISOString():'2099-01-01T00:00:00Z',identity_verified:true,observed_at:now,error:fault==='source'?{platform:'claude',code:'permission_denied',check:'read_keychain',message:'keychain read denied',evidence:{permission_denied:'true'}}:null};
 claude.selection={state:'selected',fingerprint:fp,observed_at:now,error:null};claude.hive={...claude.hive,state:'ready',fingerprint:fp,generation:1};claude.authorization={...claude.authorization,state:'synchronized',fingerprint:fp};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({accounts:{claude,openai:accountFixture('openai')},runtimeEnabled:true,scenarios:{autoService:true,previewSources:true}})});(${installOpenaiReplies.toString()})();window.paused.claude=true;`});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 const row=page.getByRole('region',{name:'Claude 账号',exact:true});await expect(row).toContainText('已接入账号');await expect(row).toContainText('系统钥匙串');
 if(fault==='source'){
  await expect(row.getByRole('status')).toContainText('无法读取系统钥匙串凭证');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
  await row.getByRole('button',{name:'查看错误详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情',exact:true})).toContainText('permission_denied: true');await page.keyboard.press('Escape');
  await row.getByRole('button',{name:'修改凭证读取设置',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 }else if(fault==='expired'){
  await expect(row.getByRole('status')).toContainText('授权已过期');await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toHaveCount(0);
  await row.getByRole('button',{name:'重新登录',exact:true}).click();await expect(row.getByRole('region',{name:'Claude 登录状态',exact:true})).toBeVisible();
 }else await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 expect(await writes(page)).toEqual([]);expect(await page.evaluate(()=>(window as any).paused.claude)).toBe(true);
});
