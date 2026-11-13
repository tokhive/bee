import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
const nav=(p:Page,name:string)=>p.getByRole('navigation').getByRole('button',{name,exact:true});
const calls=(p:Page,c:string)=>p.evaluate(c=>(window as any).calls.filter((x:any)=>x.command===c),c);
async function setup(p:Page,scenarios={}){await p.setViewportSize({width:860,height:600});await p.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await p.clock.install();await p.goto('/');await expect(p.getByText('owner@example.test',{exact:true})).toBeVisible();}
async function evidence(p:Page,i:TestInfo,id:string){
 expect(await p.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);await expect(p.locator('body')).not.toContainText('REPLY_INVALID');
 await p.screenshot({path:i.outputPath(id+'-entry.png'),fullPage:true});
 const dialogs=p.getByRole('dialog');if(await dialogs.count()){const dialog=dialogs.last();await dialog.evaluate(e=>e.scrollTop=0);await p.screenshot({path:i.outputPath(id+'-top.png')});const alert=dialog.getByRole('alert').last();if(await alert.count()){await alert.scrollIntoViewIfNeeded();await expect(alert).toBeInViewport();}}else if(await p.locator('.ns-observed').count()){await p.locator('.ns-observed').scrollIntoViewIfNeeded();}
 await p.screenshot({path:i.outputPath(id+'.png'),fullPage:true});
 writeFileSync(i.outputPath(id+'.json'),JSON.stringify(await p.evaluate(id=>({id,at:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight},body:document.body.innerText,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),calls:(window as any).calls}),id),null,2));
}
for(const [id,code,copy]of [['L01-client-missing','client_missing','未找到已安装的官方客户端。'],['L01-version','client_version_unsupported','官方客户端版本不在支持范围内。'],['L04-timeout','authorization_timeout','官方登录已超时。'],['L04-process-failed','authorization_process_failed','官方登录进程执行失败。']] as const)test(id,async({page},info)=>{
 await setup(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'safe official evidence; verified=false',evidence:{confirmed:'false'}}}});await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);await expect(page.getByRole('dialog').getByText(copy,{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,id);
});
test('L04-cancel-unknown',async({page},info)=>{
 await setup(page,{cancelUnknown:true});await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('取消请求结果未确认');expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);await evidence(page,info,'L04-cancel-unknown');
});
for(const mode of ['saved-not-effective','restore-failed','apply-unknown','saved-read-failed'])test('N03-N04-'+mode,async({page},info)=>{
 await setup(page);await nav(page,'设置').click();
 if(mode==='saved-read-failed')await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let saved=false;w.__TAURI_INTERNALS__.invoke=async(c:string,a:any)=>{if(c==='network_snapshot'&&saved){w.calls.push({command:c,args:a});throw {code:'NETWORK_RUNTIME_UNCONFIRMED',message:'network read unavailable after preference saved'};}const r=await invoke(c,a);if(c==='network_save_proxy')saved=true;return r;};});
 await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18393');await page.getByRole('button',{name:'保存代理',exact:true}).click();
 if(mode==='saved-not-effective'){await expect(page.locator('.ns-network-summary')).toContainText('18393');await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toBeEnabled();expect(await calls(page,'network_apply_saved')).toEqual([]);}
 else if(mode==='saved-read-failed')await expect(page.getByText('代理配置已保存；生效状态尚未确认。',{exact:true})).toBeVisible();
 else{
  await page.evaluate(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(c:string,a:any)=>{const r=await invoke(c,a);if(c==='network_apply_saved'){if(mode==='apply-unknown')throw {code:'IPC_TIMEOUT',message:'apply accepted; reply lost'};r.error={code:'RUNTIME_OPERATION_FAILED',message:'restore failed: local=stopped; intended=running',details:{check:'network_restore',observed_at:new Date().toISOString(),evidence:{}}};}return r;};},mode);
  await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();
  await expect(page.getByText(mode==='apply-unknown'?'应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。':'网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();
  expect(await calls(page,'network_apply_saved')).toHaveLength(1);
 }
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'runtime_stop')).toEqual([]);await evidence(page,info,'N03-N04-'+mode);
});
