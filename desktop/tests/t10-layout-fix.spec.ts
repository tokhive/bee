import {test,expect,type Page,type TestInfo,type Locator} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';

const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
const writes=['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save'];
const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
function selected(platform:string){const a=accountFixture(platform) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return a;}
async function install(page:Page,scenarios:any={},accounts={openai:accountFixture('openai'),claude:accountFixture('claude')}){
 await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
 page.on('pageerror',e=>{throw e;});
 await page.clock.install();await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios,accounts});
}
async function ready(page:Page){await page.goto('/');await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();}
async function preview(page:Page,scene:string){
 await page.setViewportSize({width:860,height:600});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene,locale:'zh',theme:'light'}));
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
}
async function zeroWrites(page:Page){expect(await page.evaluate(writes=>(window as any).calls.filter((c:any)=>writes.includes(c.command)),writes)).toEqual([]);}
async function evidence(page:Page,info:TestInfo,id:string,preconditions:unknown,focus?:Locator){
 await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);
 await page.screenshot({path:info.outputPath(id+'-entry.png'),fullPage:true});
 if(focus){await focus.scrollIntoViewIfNeeded();await expect(focus).toBeInViewport();}
 const screenshot=info.outputPath(id+'.png');await page.screenshot({path:screenshot,fullPage:true});
 const actual=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},width:document.documentElement.scrollWidth,body:document.body.innerText,main:document.querySelector('main')?.textContent,status:document.querySelector('.app-shell')?.getAttribute('data-desktop-status'),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),actions:[...document.querySelectorAll('main button,[role=dialog] button')].map(e=>({text:e.textContent,disabled:(e as HTMLButtonElement).disabled,rect:e.getBoundingClientRect().toJSON()})),accounts:(window as any).accounts,calls:(window as any).calls,scene:(window as any).__beePreviewScene,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}));
 expect(actual.reducedMotion).toBe(true);
 for(const dialog of actual.dialogs){expect(dialog.rect.x).toBeGreaterThanOrEqual(0);expect(dialog.rect.right).toBeLessThanOrEqual(861);expect(dialog.rect.y).toBeGreaterThanOrEqual(0);expect(dialog.rect.bottom).toBeLessThanOrEqual(601);}
 writeFileSync(info.outputPath(id+'.json'),JSON.stringify({id,observed_at:new Date().toISOString(),layer:'正式 NativeApp＋模拟 IPC；仅断言的组件子路径，不证明真实官方/OS副作用',preconditions,actual,screenshot},null,2));
}

for(const [scene,id]of [['runtime-no-accounts','R01-no-selection'],['runtime-accounts-unconfirmed','R01-accounts-unconfirmed']])test(id,async({page},info)=>{
 await preview(page,scene);await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 if(scene==='runtime-no-accounts'){
  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先接入至少一个 AI 账号。');
  await expect(page.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
 }else{
  await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('请先核对本机贡献状态。');
  await expect(page.locator('main')).not.toContainText('0 个已接入');
  expect(await calls(page,'account_snapshot')).toEqual([]);
 }
 await evidence(page,info,id,{scene,accountFactsConfirmed:scene==='runtime-no-accounts'});
 await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeVisible();
 if(scene==='runtime-accounts-unconfirmed')await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();
 await zeroWrites(page);
});

test('R01-account-reads-pending-shared-state-confirmed',async({page},info)=>{
 await install(page);await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  if(command==='account_snapshot'||command==='account_detect'){w.calls.push({command,args});return new Promise(()=>{});}
  const reply=await invoke(command,args);if(command==='runtime_snapshot')w.r01Runtime=structuredClone(reply.result.runtime);if(command==='device_status')w.r01Device=structuredClone(reply.result.device);return reply;
 };});await ready(page);
 await expect.poll(async()=>(await calls(page,'account_snapshot')).map((c:any)=>c.args.platform).sort()).toEqual(['claude','openai']);
 const preconditions=await page.evaluate(()=>({sharedRuntime:(window as any).r01Runtime,device:(window as any).r01Device,accountReads:'both unresolved',accountFactsConfirmed:false}));
 expect(preconditions.device.state).toBe('bound');expect(preconditions.sharedRuntime.local).toBe('stopped');
 await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('0 个已接入');
 for(const platform of ['OpenAI','Claude'])await expect(card(page,platform)).toContainText('所选来源的登录状态待确认。');
 await evidence(page,info,'R01-account-reads-pending',preconditions);
 await nav(page,'AI 账号').click();await expect(page.getByRole('heading',{name:'AI 账号',level:1,exact:true})).toBeFocused();
 for(const platform of ['OpenAI','Claude']){await expect(card(page,platform)).toContainText('正在读取已有登录');await expect(card(page,platform).getByRole('button',{name:platform+' 详情',exact:true})).toBeVisible();}
 await expect(page.getByText('接入数量待确认',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('0 个已接入');
 await zeroWrites(page);await evidence(page,info,'R01-account-reads-pending-accounts',preconditions,card(page));
});

for(const [id,code,check,message]of [
 ['S05-config-invalid','DEVICE_CONTEXT_INVALID','device_context','configuration decode failed: invalid JSON at byte=19; file retained=true'],
 ['S05-protocol-mismatch','VERSION_MISMATCH','bridge_hello','reply protocol=2; required=1'],
 ['S05-integrity-blocked','BUNDLED_BEE_INVALID','sidecar_verify','bundled Bee SHA256 mismatch at /isolated/qa/bee: actual='+ 'a'.repeat(64)+'; required='+ 'b'.repeat(64)]
])for(const locale of id==='S05-config-invalid'?['zh']:['zh','en'])test(id+(locale==='en'?'-en':''),async({page},info)=>{
 await install(page);await page.addInitScript(({id,code,check,message,locale})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  if((id==='S05-config-invalid'&&command==='device_context')||(id!=='S05-config-invalid'&&command==='bridge_status')){
   w.calls.push({command,args});const error={code,message,details:{check,observed_at:new Date().toISOString(),evidence:{actual:id==='S05-config-invalid'?'invalid JSON':id==='S05-protocol-mismatch'?'2':'qa-tampered',required:id==='S05-config-invalid'?'valid saved configuration':id==='S05-protocol-mismatch'?'1':'sealed-sha256'}}};
   return id==='S05-config-invalid'?{result:{binding_revision:1,error}}:{state:'failed',error:{code,message}};
  }const reply=await invoke(command,args);if(command==='preferences_read')reply.preferences.language=locale;return reply;
 };},{id,code,check,message,locale});
 await page.goto('/');await expect(page.locator('main')).toContainText(code);
 const failure=page.locator('main .problem-notice').first();
 if(id!=='S05-config-invalid'){
  const protocol=id==='S05-protocol-mismatch';
  const summary=locale==='zh'?(protocol?'Bee 管理协议版本与当前应用不兼容。':'随附的 Bee 程序未通过完整性校验。'):(protocol?'The Bee management protocol version is incompatible with this app.':'The bundled Bee program failed integrity verification.');
  const impact=locale==='zh'?(protocol?'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee 后重新打开；若仍不兼容，请使用可信来源的匹配安装包处理。':'原生操作保持受阻，无法开始贡献或执行账号操作。请从应用菜单退出 Bee，使用可信来源的安装包重新安装后再打开。'):(protocol?'Native operations remain blocked; contribution and account operations are unavailable. Quit Bee from the app menu and reopen it. If it remains incompatible, use a matching installer from a trusted source.':'Native operations remain blocked; contribution and account operations are unavailable. Quit Bee from the app menu, reinstall it with an installer from a trusted source, then reopen it.');
  await expect(failure.getByText(summary,{exact:true})).toBeVisible();await expect(failure.getByText(impact,{exact:true})).toBeVisible();
  await expect(failure.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button',{name:locale==='zh'?'开始贡献':'Start contributing',exact:true})).toHaveCount(0);
  for(const command of ['runtime_snapshot','device_status','account_snapshot','account_detect','supply_status','startup_recheck'])expect(await calls(page,command)).toEqual([]);
 }
 await failure.getByText(locale==='zh'?'查看失败详情':'View failure details',{exact:true}).click();await expect(failure).toContainText(message);
 await expect(failure).toContainText(code);await expect(failure).not.toContainText('FAILURE_DETAILS_INVALID');
 if(id==='S05-config-invalid')await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 else expect(await calls(page,'runtime_snapshot')).toEqual([]);
 await zeroWrites(page);await evidence(page,info,id+(locale==='en'?'-en':''),{code,check,message,locale,syntheticFailure:true,nativeOperationsBlocked:id!=='S05-config-invalid'},failure);
});

test('L02-running-login-stop-entry',async({page},info)=>{
 await install(page,{}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
 await page.getByRole('button',{name:'开始贡献',exact:true}).click();await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();await expect(dialog).toContainText('官方登录前请先停止贡献');
 await evidence(page,info,'L02-running-login-disabled',{local:'running',selectedPlatforms:['openai','claude']},dialog.getByText('官方登录前请先停止贡献；前往概览停止后再返回。',{exact:true}));
 await dialog.getByRole('button',{name:'查看贡献运行',exact:true}).click();await expect(page.locator('[data-nav-section=runtime]').first()).toBeFocused();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
 expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'runtime_stop')).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
 await evidence(page,info,'L02-stop-entry',{navigated:true,stoppedAutomatically:false});
});

for(const mode of ['unread','empty','loading','filtered-rotation'])test('G05-logs-'+mode,async({page},info)=>{
 await install(page);await page.addInitScript(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  if(command==='diagnostic_logs'){
   if(mode==='empty'||mode==='loading'){w.calls.push({command,args});return mode==='loading'?new Promise(()=>{}):{entries:[],next_cursor:null,truncated:false};}
   const result=await invoke(command,args);if(mode==='filtered-rotation')result.truncated=true;return result;
  }return invoke(command,args);
 };},mode);await ready(page);await nav(page,'诊断').click();await page.getByRole('tab',{name:'安全日志',exact:true}).click();
 expect(await calls(page,'diagnostic_logs')).toEqual([]);
 if(mode==='filtered-rotation'){
  await page.getByLabel(/^模块/).selectOption('accounts');await page.getByLabel(/^平台/).selectOption('openai');await page.getByLabel(/^日志级别/).selectOption('warning');
 }
 if(mode==='unread')await expect(page.getByText('点击刷新日志，查看所选范围的安全事件。',{exact:true})).toBeVisible();
 else{
  await page.getByRole('button',{name:'刷新日志',exact:true}).click();
  if(mode==='empty')await expect(page.getByText('所选范围没有保留的安全事件。',{exact:true})).toBeVisible();
  if(mode==='loading'){await expect(page.getByText('正在读取日志…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新日志',exact:true})).toBeDisabled();}
  if(mode==='filtered-rotation'){
   await expect(page.getByTestId('native-diagnostic-logs')).toContainText('hive_identity_verified');await expect(page.getByText('较早日志已轮转移除；此处仅显示保留范围。',{exact:true})).toBeVisible();
   expect((await calls(page,'diagnostic_logs'))[0].args.query).toEqual({cursor:null,limit:50,module:'accounts',platform:'openai',level:'warning'});
   await evidence(page,info,'G05-logs-filtered-more',{filters:{module:'accounts',platform:'openai',level:'warning'},truncated:true});
   await page.getByRole('button',{name:'加载更多日志',exact:true}).click();await expect(page.getByRole('button',{name:'加载更多日志',exact:true})).toHaveCount(0);expect((await calls(page,'diagnostic_logs'))[1].args.query.cursor).toMatch(/^v1:/);
  }
 }
 await zeroWrites(page);expect(await calls(page,'diagnostics_start')).toEqual([]);await evidence(page,info,'G05-logs-'+mode,{mode,manualRead:mode!=='unread'});
});

test('final-fix-runtime-consumer-keeps-only-unrecovered-platform-failures',async({page},info)=>{
 const facts=JSON.parse(readFileSync(new URL('./fixtures/synchronization-recovery.json',import.meta.url),'utf8'));
 await install(page,{reasons:{openai:['manually_paused'],claude:['not_configured']}},{openai:selected('openai'),claude:accountFixture('claude')});
 await page.addInitScript(detail=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.finalFixDetail=detail;w.finalFixRevision=0;w.paused.openai=true;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  const result=await invoke(command,args);if(command==='runtime_snapshot')Object.assign(result.result.runtime,{run_id:'a'.repeat(32),revision:++w.finalFixRevision,local:'running',connection:'connected',connection_detail:structuredClone(w.finalFixDetail)});return result;
 };},facts.transitions.both_failed);
 await ready(page);const runtime=page.getByRole('region',{name:'贡献运行',exact:true}),detail=runtime.locator('.native-connection-detail');
 await expect(detail).toBeVisible();await detail.getByText('查看失败详情',{exact:true}).click();await expect(detail).toContainText('claude supply readback HTTP 503');
 await page.evaluate(value=>(window as any).finalFixDetail=value,facts.transitions.claude_recovered);await page.clock.runFor(10001);
 await expect(detail).toContainText('openai authorization readback differs');await expect(detail).not.toContainText('claude supply readback HTTP 503');
 await expect(detail).toContainText('当前没有安排自动重连。');await expect(detail).not.toContainText('已安排重新连接');
 await evidence(page,info,'final-fix-runtime-one-platform-unrecovered',{source:facts.source,source_sha256:facts.source_sha256,remaining:'openai'},detail);
 await page.evaluate(value=>(window as any).finalFixDetail=value,facts.transitions.all_recovered);await page.clock.runFor(10001);
 await expect(detail).toHaveCount(0);await expect(runtime).toContainText('Bee 运行中');
 await expect(card(page)).toContainText('已手动暂停');await expect(card(page,'Claude')).toContainText('尚未接入 Claude 账号');
 await expect(page.locator('main')).not.toContainText('openai authorization readback differs');await expect(page.locator('main')).not.toContainText('claude supply readback HTTP 503');
 await zeroWrites(page);await evidence(page,info,'final-fix-runtime-recovered-paused',{source:facts.source,source_sha256:facts.source_sha256,coreReconnectsScheduled:0,businessWrites:0},runtime);
});

test('D06-initial-pairing-completed-stopped',async({page},info)=>{
 await preview(page,'device-pending');await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeVisible();
 await expect(page.getByText('1 个已接入',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__beePreviewApprove());await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'贡献运行',exact:true})).toContainText('Bee 未运行');
 await expect(page.getByText('0 个已接入',{exact:true})).toBeVisible();
 for(const platform of ['OpenAI','Claude'])await expect(card(page,platform)).toContainText('尚未接入');
 for(const oldFact of ['bbbbbbbbbbbbbbbb','Plus','3%','2%'])await expect(page.locator('main')).not.toContainText(oldFact);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();await zeroWrites(page);await evidence(page,info,'D06-bound-stopped-no-selection',{initialStage:'pending',externalApproval:'simulated',finalStage:'bound',local:'stopped'});
 await evidence(page,info,'D06-bound-stopped-accounts-visible',{actualRenderedAccountCount:0,platforms:['openai','claude'],oldFactsRemoved:true,local:'stopped'},card(page));
 await evidence(page,info,'D06-bound-stopped-claude-visible',{actualRenderedAccountCount:0,local:'stopped'},card(page,'Claude'));
});

for(const [code,copy]of [['authorization_source_unchanged','官方登录已退出，但所选来源没有改变。'],['authorization_namespace_mismatch','所选登录位置与官方客户端登录位置不一致。']])test('L05-'+code,async({page},info)=>{
 await install(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'official process exited; source verification failed; verified=false',evidence:{confirmed:'false'}}}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);
 const message=page.getByRole('dialog').getByText(copy,{exact:true});await expect(message).toBeVisible();expect(await calls(page,'authorize_start')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
 expect(await page.evaluate(()=>(window as any).accounts.openai.operation.error.code)).toBe(code);await evidence(page,info,'L05-'+code,{operation:'authorize',state:'failed',code},message);
});

test('W04-stale-confirmation-disabled-zero-write',async({page},info)=>{
 await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
 await page.clock.runFor(10001);await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
 const before=await page.evaluate(()=>{const w=window as any,a=structuredClone(w.accounts.openai),oldRevision=a.revision;a.revision+=2;w.accounts.openai=a;return {oldRevision,newRevision:a.revision,candidate:a.candidate.reference};});await page.clock.runFor(10001);
 const stale=page.getByRole('dialog').last();await expect(stale.getByRole('button',{name:'确认更换',exact:true})).toBeDisabled();await expect(stale).toContainText('账号、来源或运行条件已变化，本次未提交；请关闭后重新确认。');
 expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,'W04-stale-confirmation',{...before,submitted:false});
});

test('W05-account-submission-unknown-keeps-original-operation',async({page},info)=>{
 await install(page);await ready(page);await nav(page,'AI 账号').click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();const operation=await page.evaluate(()=>(window as any).accounts.openai.operation);expect(operation.state).toBe('reconciling');expect(await calls(page,'account_action')).toHaveLength(1);
 await nav(page,'诊断').click();await page.getByText('运行详情',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');
 await evidence(page,info,'W05-original-operation-diagnostics',{operation,submittedWrites:1},page.locator('pre'));
 await nav(page,'AI 账号').click();await page.clock.runFor(10001);expect(await page.evaluate(()=>(window as any).accounts.openai.operation.id)).toBe(operation.id);expect(await calls(page,'account_action')).toHaveLength(1);expect(await calls(page,'runtime_start')).toEqual([]);
 await evidence(page,info,'W05-original-operation-unconfirmed',{operation,submittedWrites:1,readOnlyReconciliation:true},card(page));
});

test('A04-unsupported-store-real-reason',async({page},info)=>{
 await install(page,{unsupportedStores:{keyring:'keyring_not_supported_on_this_os'}});await ready(page);await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('存储方式').locator('option[value=keyring]')).toHaveAttribute('disabled','');expect(await dialog.getByLabel('存储方式').locator('option[value=keyring]').evaluate(e=>(e as HTMLOptionElement).disabled)).toBe(true);await expect(dialog).toContainText('当前系统不支持 Codex 钥匙串读取。');await expect(dialog.getByLabel('存储方式')).toHaveValue('file');
 await zeroWrites(page);await evidence(page,info,'A04-keyring-unsupported',{store:'keyring',supported:false,reason:'keyring_not_supported_on_this_os',selectedStore:'file'},dialog.getByText(/当前系统不支持 Codex 钥匙串读取/));
});

for(const [id,reasons]of [
 ['P04-detailed-reasons',['account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted']],
 ['P05-existing-reasons',['banned','device_draining','offline','model_unavailable','authorization_unavailable','capabilities_unknown','plan_not_configured']],
 ['P06-limit-reasons',['rate_limited','quota_unknown','quota_exhausted','concurrency_full']],
 ['P07-source-authorization-reasons',['codex_source_unavailable','codex_confirmation_required','codex_authorization_rejected']]
] as const)test(id,async({page},info)=>{
 const claude=id==='P07-source-authorization-reasons'?['claude_source_unavailable','claude_confirmation_required','claude_authorization_rejected']:[];
 await install(page,{reasons:{openai:[...reasons],claude}}, {openai:selected('openai'),claude:selected('claude')});await ready(page);
 const initial=await calls(page,'runtime_start');expect(initial).toEqual([]);
 const expected:Record<string,string>={account_not_registered:'Hive 账号注册尚未完成',market_not_open:'Hive 尚未开放 OpenAI 模型交易',supply_not_enabled:'Hive 尚未启用此平台供给',supply_device_restricted:'Hive 供给绑定限制了当前设备',account_not_admitted:'当前账号不在 Hive 供给准入集合中',banned:'管理员已禁用此平台供给',device_draining:'设备替换中，仅收尾已接请求',offline:'Hive 未看到此平台的 Bee 连接',model_unavailable:'账号没有可用的市场模型',authorization_unavailable:'Hive 没有可用的加密授权',capabilities_unknown:'账号模型和额度报告尚未确认',plan_not_configured:'管理员尚未配置套餐并发上限',rate_limited:'上游平台限流中',quota_unknown:'账号额度窗口尚未确认',quota_exhausted:'账号订阅额度已耗尽',concurrency_full:'账号并发请求已满',codex_source_unavailable:'无法读取 Codex 官方登录',codex_confirmation_required:'Codex 账号变更待确认',codex_authorization_rejected:'OpenAI 已拒绝此账号授权',claude_source_unavailable:'无法读取 Claude Code 官方登录',claude_confirmation_required:'Claude Code 账号变更待确认',claude_authorization_rejected:'Anthropic 已拒绝此账号授权'};
 const reasonCaptures=[];
 for(const [p,items]of [['OpenAI',reasons],['Claude',claude]] as const)for(const reason of items){
  const item=card(page,p).locator('li').filter({has:page.getByText(expected[reason],{exact:true})});await expect(item).toBeVisible();
  await item.evaluate(e=>e.scrollIntoView({block:'center'}));await expect(item).toBeInViewport({ratio:1});
  const geometry=await item.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),text:e.textContent,impact:e.querySelector('p')?.textContent}));
  expect(geometry.rect.top).toBeGreaterThanOrEqual(52);expect(geometry.rect.bottom).toBeLessThanOrEqual(571);expect(geometry.impact?.trim().length).toBeGreaterThan(0);
  reasonCaptures.push({platform:p,reason,...geometry});await page.screenshot({path:info.outputPath(id+'-'+reason+'.png')});
 }
 expect(await calls(page,'authorize_start')).toEqual([]);await zeroWrites(page);
 await evidence(page,info,id,{reasons:{openai:reasons,claude},reasonCaptures,source:'real SupplyView DTO reason codes; synthetic confirmed facts'},card(page));
});

test('A08-official-query-failure-with-retry-at',async({page},info)=>{
 const a=selected('openai');a.candidate={...a.candidate,state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint:'b'.repeat(64),identity_verified:true,expires_at:'2099-01-01T00:00:00Z',observed_at:new Date().toISOString()};
 a.capabilities[0]={...a.capabilities[0],status:'rate_limited',observed_at:new Date().toISOString(),retry_at:new Date(Date.now()+25000).toISOString(),error:{code:'rate_limited',check:'official_capability_query',platform:'openai',message:'official quota endpoint HTTP 429; retry_after_seconds=25',evidence:{http_status:'429',path:'/official/quota'}}};
 await install(page,{}, {openai:a,claude:accountFixture('claude')});await ready(page);
 await expect(card(page)).toContainText('服务限制了本次请求的频率。');expect(await page.evaluate(()=>(window as any).accounts.openai.capabilities[0].status)).toBe('rate_limited');await expect(card(page)).toContainText('bbbbbbbbbbbbbbbb');await card(page).getByText('查看失败详情',{exact:true}).click();await expect(card(page)).toContainText('official quota endpoint HTTP 429; retry_after_seconds=25');await evidence(page,info,'A08-official-query-failed',{code:'rate_limited',check:'official_capability_query',retry_at:a.capabilities[0].retry_at,localCandidatePreserved:true},card(page).getByText('official quota endpoint HTTP 429; retry_after_seconds=25',{exact:false}).last());
 expect(await calls(page,'authorize_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});

for(const trusted of [true,false])test('U05-recovery-'+(trusted?'trusted-previous':'unproven-protected'),async({page},info)=>{
 const code=trusted?'UPDATE_PREVIOUS_NOT_INSTALLED':'UPDATE_RECOVERY_UNPROVEN';
 const message=trusted?'running trusted previous version=0.1.0; pending target=0.2.0 was not installed; data and runtime verified; update may be retried':'recovery evidence runtime_intent_restored=false; required=true; pending update preserved';
 await install(page);await page.addInitScript(({code,message})=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  if(command==='update_snapshot'){w.calls.push({command,args});return {operation_id:'update-a',revision:9,state:'failed',current_version:'0.1.0',target_version:'0.2.0',checked_at:'2026-11-02T12:00:00Z',downloaded_bytes:0,total_bytes:null,release_notes:null,error:{code,message,details:{check:'update_recovery',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:message,required:'verified recovery'}}}};}
  return invoke(command,args);
 };},{code,message});await ready(page);await nav(page,'设置').click();await page.getByRole('tab',{name:'关于',exact:true}).click();
 const region=page.getByRole('region',{name:'应用更新',exact:true}),alert=region.getByRole('alert');await expect(alert).toContainText(code);await expect(alert).toContainText(message);
 if(trusted){await expect(alert).toContainText('当前可信版本及数据、运行恢复检查已通过');await expect(region.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled();}
 else{await expect(alert).toContainText('更新保护仍保留');await expect(region.getByRole('button',{name:'重新读取更新状态',exact:true})).toBeEnabled();}
 for(const command of ['update_check','update_download','update_install'])expect(await calls(page,command)).toEqual([]);
 await alert.getByText('查看失败详情',{exact:true}).click();await zeroWrites(page);await evidence(page,info,'U05-'+(trusted?'trusted-previous':'unproven-protected'),{code,check:'update_recovery',trustedPrevious:trusted,realInstallation:false},alert);
});
