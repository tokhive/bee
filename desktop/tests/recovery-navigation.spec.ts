import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
async function open(page:Page){await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');}
const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command).length,command);

for(const destination of ['概览','诊断','AI 账号'])test('settings draft survives a real page round trip through '+destination,async({page})=>{
 await open(page);await nav(page,'设置').click();const proxy=page.getByLabel('本机 HTTP 代理',{exact:true});await proxy.fill('http://127.0.0.1:18181');
 await nav(page,destination).click();await nav(page,'设置').click();await expect(proxy).toHaveValue('http://127.0.0.1:18181');
 expect(await calls(page,'network_save_proxy')).toBe(0);expect(await calls(page,'network_apply_saved')).toBe(0);expect(await calls(page,'diagnostics_start')).toBe(0);
});
test('binding replacement isolates unsaved settings drafts',async({page})=>{
 await open(page);await nav(page,'设置').click();const proxy=page.getByLabel('本机 HTTP 代理',{exact:true});await proxy.fill('http://127.0.0.1:18181');
 await page.evaluate(()=>(window as any).bindingRevision=2);await page.clock.runFor(10100);await expect(proxy).toHaveValue('');expect(await calls(page,'network_save_proxy')).toBe(0);
});
test('source repair navigates to a settings target and returns to the same platform draft',async({page})=>{
 await open(page);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(cmd:string,args:any)=>{if(cmd==='account_detect'&&args.request.platform==='openai')throw {code:'NETWORK_APPLY_REQUIRED',message:'saved network revision=3 effective=2',details:{check:'source_read',observed_at:new Date().toISOString(),evidence:{actual:'2',required:'3'}}};return invoke(cmd,args);};});
 await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 const directory=page.getByRole('dialog').getByLabel('自定义目录',{exact:true});await directory.fill('/tmp/unsaved-source');await directory.press('Tab');
 await page.getByRole('dialog').getByRole('button',{name:'查看设置',exact:true}).first().click();
 await expect(page.getByRole('tab',{name:'网络与代理',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toBeFocused();
 await page.getByRole('button',{name:'返回原处',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await expect(directory).toHaveValue('/tmp/unsaved-source');await expect(directory).toBeFocused();
 expect(await calls(page,'network_save_proxy')).toBe(0);expect(await calls(page,'authorize_start')).toBe(0);expect(await calls(page,'account_action')).toBe(0);
});
test('unknown account result remains read only across navigation and a new instance clears the old operation',async({page})=>{
 await open(page);await nav(page,'AI 账号').click();const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{(window as any).actionUnknown=true;});await card.getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect.poll(()=>calls(page,'account_action')).toBe(1);await page.keyboard.press('Escape');await nav(page,'设置').click();await nav(page,'AI 账号').click();await page.clock.runFor(10100);expect(await calls(page,'account_action')).toBe(1);
 await page.evaluate(()=>{(window as any).actionUnknown=false;(window as any).emit('c'.repeat(32));});await page.clock.runFor(100);expect(await calls(page,'account_action')).toBe(1);
});
test('page navigation reveals the heading while background refresh preserves scroll and focus',async({page})=>{
 await page.setViewportSize({width:860,height:600});await open(page);await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);await nav(page,'诊断').click();
 const heading=page.getByRole('heading',{name:'诊断',exact:true,level:1});await expect(heading).toBeFocused();
 const bounds=await heading.boundingBox(),toolbar=await page.locator('.toolbar').boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(toolbar!.y+toolbar!.height);expect(await calls(page,'diagnostics_start')).toBe(0);
 await nav(page,'AI 账号').click();await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);const button=page.getByRole('button',{name:'Claude 详情',exact:true});await button.focus();
 const before=await page.locator('main').evaluate(el=>el.scrollTop);await page.clock.runFor(10100);await expect(button).toBeFocused();expect(await page.locator('main').evaluate(el=>el.scrollTop)).toBe(before);
});

test('a diagnostic report survives pages and a network change off-page invalidates it',async({page})=>{
 await open(page);await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.clock.runFor(900);
 await expect(page.getByRole('button',{name:'导出脱敏报告',exact:true})).toBeEnabled();
 for(const destination of ['概览','AI 账号','设置']){await nav(page,destination).click();await nav(page,'诊断').click();await expect(page.getByRole('button',{name:'导出脱敏报告',exact:true})).toBeEnabled();}
 expect(await calls(page,'diagnostics_start')).toBe(1);
 await nav(page,'AI 账号').click();await page.evaluate(()=>{(window as any).networkRevision=1;});await page.clock.runFor(10100);await nav(page,'诊断').click();
 await expect(page.getByRole('button',{name:'导出脱敏报告',exact:true})).toBeDisabled();expect(await calls(page,'diagnostics_start')).toBe(1);
});

test('a newer diagnostic identity rejection blocks account submission and runtime start',async({page})=>{
 await open(page);await nav(page,'AI 账号').click();const card=page.getByRole('region',{name:'OpenAI 账号',exact:true});await expect(card.getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.clock.runFor(100);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='diagnostics_start'||command==='diagnostics_snapshot'){result.result.report.checks[0]={...result.result.report.checks[0],status:'fail',code:'device_replaced',observed_at:new Date().toISOString(),evidence:{method:'GET',path:'/api/bee/identity',http_status:'401',server_code:'device_replaced'},next_action:'overview'};}return result;};});
 await nav(page,'诊断').click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.clock.runFor(900);
 await expect(page.getByText('此设备已被替换，原设备凭据已撤销。',{exact:true})).toBeVisible();await nav(page,'AI 账号').click();await expect(card.getByRole('button',{name:'接入',exact:true})).toBeDisabled();
 expect(await calls(page,'account_action')).toBe(0);expect(await calls(page,'runtime_start')).toBe(0);
});

test('a diagnostic target absent from a partial report focuses its summary once without starting a run',async({page})=>{
 await page.route('**/diagnostic-target-harness',route=>route.fulfill({contentType:'text/html',body:`<div id="harness"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import {AppShell} from '/src/components/AppShell.tsx';import {NativeDiagnosticsPage} from '/src/features/diagnostics/NativeDiagnosticsPage.tsx';import '/src/styles/app.css';
 const report={id:'b'.repeat(48),instance:'a'.repeat(32),binding_revision:1,network_revision:0,run_id:null,state:'completed',started_at:new Date().toISOString(),finished_at:new Date().toISOString(),checks:[]};
 window.starts=0;const client={getSnapshot:()=>structuredClone(report),setContext:()=>{},start:async()=>{window.starts++;return report;}};
 function Harness(){const [request,setRequest]=React.useState({target:{page:'diagnostics'},sequence:0}),[version,setVersion]=React.useState(0);window.addCheck=()=>{report.checks.push({id:'source',platform:'claude',status:'skipped',code:'not_checked',observed_at:new Date().toISOString(),evidence:{},next_action:'accounts'});setVersion(v=>v+1);};return React.createElement(AppShell,{page:'diagnostics',deviceMode:true,onNavigate:()=>{},navigationRequest:request},React.createElement('button',{onClick:()=>setRequest({target:{page:'diagnostics',section:'source',platform:'claude'},sequence:1})},'Locate Claude source'),React.createElement(NativeDiagnosticsPage,{key:version,client,instance:report.instance,bindingRevision:1,networkRevision:0,runId:null,navigationRequest:request,onNavigate:()=>{}}));}
 ReactDOM.createRoot(document.getElementById('harness')).render(React.createElement(Harness));</script>`}));
 await page.goto('/diagnostic-target-harness');await page.getByRole('button',{name:'Locate Claude source',exact:true}).click();
 const summary=page.locator('.nd-report-meta');await expect(summary).toBeFocused();expect(await page.evaluate(()=>(window as any).starts)).toBe(0);
 const heading=page.getByRole('heading',{level:1});await heading.focus();await page.evaluate(()=>(window as any).addCheck());await expect(page.locator('[data-nav-section="source"][data-nav-platform="claude"]')).toBeAttached();await expect(heading).toBeFocused();expect(await page.evaluate(()=>(window as any).starts)).toBe(0);
});

test('Claude inline source recovery keeps its platform, drafts and return focus without writes',async({page})=>{
 await open(page);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='account_detect'&&args.request.platform==='claude'){result.result.account.candidate.error={code:'permission_denied',check:'source_read',platform:'claude',message:'Claude fixture directory read denied',evidence:{permission_denied:'true'}};w.accounts.claude=result.result.account;}return result;};});
 await nav(page,'AI 账号').click();
 for(const [platform,draft] of [['OpenAI','/tmp/openai-draft'],['Claude','/tmp/claude-draft']]){
  await page.getByRole('button',{name:platform+' 详情',exact:true}).click();await page.getByRole('dialog').getByLabel('自定义目录',{exact:true}).fill(draft);await page.keyboard.press('Escape');
 }
 const row=page.getByRole('region',{name:'Claude 账号',exact:true});await row.getByRole('button',{name:'检查凭证来源',exact:true}).first().click();
 const dialog=page.getByRole('dialog');await expect(dialog).toHaveAccessibleName('Claude 账号详情');await expect(dialog.getByLabel('自定义目录',{exact:true})).toHaveValue('/tmp/claude-draft');await expect(dialog.getByLabel('自定义目录',{exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回原处',exact:true}).click();await expect(row).toBeFocused();
 await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('自定义目录',{exact:true})).toHaveValue('/tmp/openai-draft');
 for(const command of ['account_action','authorize_start','authorize_cancel','runtime_start','supply_set_paused'])expect(await calls(page,command)).toBe(0);
});
