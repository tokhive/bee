import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
test.beforeEach(async({page})=>{await page.clock.install({time:new Date('2026-10-27T03:00:00Z')});});
const card=(page:Page,p='OpenAI')=>page.getByRole('region',{name:`${p} 账号`,exact:true});
async function setup(page:Page){await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await page.goto('/');}
async function reconcile(page:Page){const before=await page.evaluate(()=>(window as any).runtimeReadCount);await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);}
async function openDetails(page:Page,p='OpenAI'){if(await page.getByRole('dialog').count()===0)await card(page,p).getByRole('button',{name:`${p} 详情`,exact:true}).click();}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
test('coordinated hooks share initial reads, the ten-second poll and explicit runtime refresh',async({page})=>{
 const now=new Date('2026-10-27T03:00:00Z');await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));await setup(page);
 await expect(page.getByRole('region',{name:'贡献运行'}).getByText('贡献尚未启动',{exact:true})).toBeVisible();
 const counts=()=>page.evaluate(()=>Object.fromEntries(['runtime_snapshot','account_defaults','account_snapshot','supply_status'].map(command=>[command,(window as any).calls.filter((call:any)=>call.command===command).length])));
 expect(await counts()).toEqual({runtime_snapshot:1,account_defaults:1,account_snapshot:2,supply_status:2});
 await page.clock.runFor(9999);expect(await counts()).toEqual({runtime_snapshot:1,account_defaults:1,account_snapshot:2,supply_status:2});
 await page.clock.runFor(1);await expect.poll(counts).toEqual({runtime_snapshot:2,account_defaults:1,account_snapshot:4,supply_status:4});
 await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect.poll(counts).toEqual({runtime_snapshot:3,account_defaults:1,account_snapshot:6,supply_status:6});
 expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'account_action')).toEqual([]);
});
test('unpaired proxy drafts save a Hive origin and survive an empty effective network snapshot',async({page})=>{
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.addInitScript(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{
   if(command==='device_status')return {result:{device:{state:'unbound'}}};
   if(command==='device_context')return {result:{binding_revision:1,error:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'no saved device configuration'}}};
   if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
   const result=await invoke(command,args);
   if(command==='network_save_proxy')result.preferences.proxies=result.preferences.proxies.map((entry:any)=>({...entry,device_scope:null}));
   return result;
  };
 });
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await page.getByLabel('代理草稿的 Hive 地址',{exact:true}).fill('https://draft.hive.example');await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
 await page.getByRole('button',{name:'保存代理',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
 expect((await calls(page,'network_save_proxy'))[0].args).toEqual({proxy:'http://127.0.0.1:7890',origin:'https://draft.hive.example',expectedRevision:0});
 await page.getByRole('button',{name:'刷新生效路径',exact:true}).click();await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
 await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByLabel('代理草稿的 Hive 地址',{exact:true})).toHaveValue('https://draft.hive.example');await expect(page.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
 await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toHaveCount(0);expect(await calls(page,'network_apply_saved')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});
test('a successful account write still requires a verified read when central readback fails',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any,native=w.__TAURI_INTERNALS__,invoke=native.invoke;native.invoke=async(command:string,args:unknown)=>{const result=await invoke(command,args);if(command==='account_action')w.deviceFail=true;return result;};});
 await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('核对已暂停，需先处理当前问题。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).deviceFail=false;});await reconcile(page);
 await expect(card(page).getByText('等待自动重试…',{exact:true})).toHaveCount(0);expect(await calls(page,'account_action')).toHaveLength(1);
});
test('paired proxy testing leaves effective paths unchanged until the confirmed restart',async({page})=>{
 await setup(page);await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByLabel('代理草稿的 Hive 地址',{exact:true})).toHaveCount(0);
 const proxy=page.getByLabel('本机 HTTP 代理',{exact:true});await proxy.fill('http://192.0.2.1:7890');await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByRole('alert')).toContainText('loopback');expect(await calls(page,'network_test')).toEqual([]);
 await proxy.fill('http://127.0.0.1:7890');await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByText('只检查网络可达性，不证明授权或额度，不会开始贡献。',{exact:true})).toBeVisible();
 const effective=page.locator('.ns-network-summary div').filter({has:page.getByText('当前生效配置',{exact:true})});await expect(effective).toContainText('代理未启用');
 await page.getByRole('button',{name:'保存代理',exact:true}).click();await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toBeVisible();await expect(effective).toContainText('代理未启用');
 await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'network_apply_saved')).toEqual([]);
 await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();await expect(effective).toContainText('http://127.0.0.1:7890');
 expect(await calls(page,'network_apply_saved')).toEqual([{command:'network_apply_saved',args:{confirmed:true}}]);expect(await calls(page,'runtime_start')).toEqual([]);
});
for(const command of ['account_action','runtime_start'])for(const outcome of ['success','failure'])test(`late ${command} ${outcome} from the previous owner cannot refresh or pause the current instance`,async({page})=>{
 const now=new Date('2026-10-27T03:00:00Z');await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));await setup(page);
 if(command==='account_action'){await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();}
 else{await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();}
 await page.evaluate(({command,outcome})=>{const w=window as any,native=w.__TAURI_INTERNALS__,invoke=native.invoke;native.invoke=async(name:string,args:unknown)=>{if(name===command){const result=outcome==='success'?await invoke(name,args):undefined;w.oldWriteStarted=true;return new Promise((resolve,reject)=>{w.finishOldWrite=()=>outcome==='success'?resolve(result):reject(new Error('old owner response failed after replacement'));});}return invoke(name,args);};},{command,outcome});
 if(command==='account_action'){await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
 else await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).oldWriteStarted)).toBe(true);
 const before=await page.evaluate(()=>{const w=window as any;w.emit('d'.repeat(32));return w.runtimeReadCount;});await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before);
 if(command==='account_action')await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
 await expect(page.getByRole('button',{name:'重新核对设备',exact:true})).toBeEnabled();
 const reads=await page.evaluate(()=>{const w=window as any;w.finishOldWrite();return w.runtimeReadCount;});await page.clock.runFor(9999);
 expect(await page.evaluate(()=>(window as any).runtimeReadCount)).toBe(reads);await page.clock.runFor(1);
 await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(page.getByText('等待自动重试…',{exact:true})).toHaveCount(0);
});
test('ready management stays stopped; select, explicit start, stop and per-platform states are usable',async({page})=>{
 await setup(page);await expect(page.getByRole('region',{name:'贡献运行'}).getByText('贡献尚未启动',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();
 await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toEqual([]);
 await page.getByRole('button',{name:'概览',exact:true}).click();await expect(page.getByRole('checkbox',{name:'允许 OpenAI 恢复接单'})).toHaveCount(0);await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 await expect(page.getByRole('region',{name:'贡献运行'}).getByText('贡献已启动',{exact:true})).toBeVisible();expect((await calls(page,'runtime_start'))[0].args.request.resume_platforms).toEqual([]);
 await page.getByRole('button',{name:'停止贡献',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();await expect(page.getByText('停止已确认，下次打开保持停止。')).toBeVisible();
});
test('uncertain account writes reconcile with reads only and passive runtime cannot clear them',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{(window as any).actionUnknown=true;(window as any).actionPending=true;});
 await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('pre')).toContainText('RESPONSE_TIMEOUT: account action result unconfirmed');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 const reads=await page.evaluate(()=>(window as any).runtimeReadCount);await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();
 await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();const snapshots=(await calls(page,'account_snapshot')).length;await page.clock.runFor(10001);await expect.poll(async()=>(await calls(page,'account_snapshot')).length).toBeGreaterThan(snapshots);await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();await expect(card(page).getByText('等待自动重试…',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
});
test('official login warns about official account, supports cancellation, and completed login remains a candidate',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page,'Claude').getByText('已有登录，尚未接入')).toBeVisible();await openDetails(page,'Claude');
 const sheet=page.getByRole('dialog').first();await sheet.getByRole('button',{name:'登录 Claude',exact:true}).click();const confirm=page.getByRole('dialog').last();await expect(confirm).toContainText('可能改变官方客户端当前登录');await confirm.getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();await sheet.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(sheet.getByText('操作已取消',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).loginComplete=true;});await sheet.getByRole('button',{name:'登录 Claude',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByText('登录已核验，尚未接入')).toBeVisible();await page.keyboard.press('Escape');await expect(card(page,'Claude').getByText('尚未接入',{exact:true})).toBeVisible();expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);
});
test('uncertain runtime start is never replayed and requires a fresh query',async({page})=>{
 await setup(page);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;(window as any).runtimeUnknown=true;});
 await reconcile(page);await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByRole('region',{name:'贡献运行'})).toContainText('等待已安排的核对');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 await reconcile(page);await expect(page.getByText('贡献已启动',{exact:true})).toBeVisible();expect(await calls(page,'runtime_start')).toHaveLength(1);
});

test('completed login cannot clear a later source edit, and write admission locks the source',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await openDetails(page);const sheet=page.getByRole('dialog').first();await page.evaluate(()=>{(window as any).loginAdmissionDelay=600;});
 await sheet.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByLabel('自定义目录')).toBeDisabled();await expect(sheet.getByRole('button',{name:'取消官方登录',exact:true})).toBeEnabled();await sheet.getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(sheet.getByText('操作已取消',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).loginAdmissionDelay=0;(window as any).loginComplete=true;});await sheet.getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await expect(sheet.getByText('登录已核验，尚未接入',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).delay=30000;});await sheet.getByLabel('自定义目录').fill('/tmp/another-account');await sheet.getByLabel('自定义目录').press('Enter');await reconcile(page);await expect(sheet.getByLabel('自定义目录')).toHaveValue('/tmp/another-account');await expect.poll(async()=>(await calls(page,'account_detect')).at(-1)?.args.request.directory).toBe('/tmp/another-account');expect(await calls(page,'account_action')).toEqual([]);
});

test('account change remains paused and a platform failure leaves the other platform visible',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;});
 await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);expect(await calls(page,'runtime_start')).toEqual([]);
 await page.evaluate(()=>{const a=(window as any).accounts.claude;a.revision++;a.authorization.error={code:'source_unavailable',check:'source_read',platform:'claude',message:'source unavailable',evidence:{}};});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'概览',exact:true}).click();await reconcile(page);await expect(card(page,'Claude').getByRole('alert')).toContainText('source unavailable');await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();
});

test('only proven unsubmitted confirmation can continue after reconciliation',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;a.operation={id:'c'.repeat(48),kind:'confirm_change',platform:'openai',state:'reconciling',revision:a.revision,error:{code:'confirmation_unknown',check:'account_change_submission',platform:'openai',message:'confirmation outcome unknown',evidence:{}}};});
 await reconcile(page);await openDetails(page);await expect(page.getByRole('dialog').getByRole('button',{name:'换号',exact:true})).toBeDisabled();await page.keyboard.press('Escape');expect(await calls(page,'account_action')).toEqual([]);
 await page.evaluate(()=>{const a=(window as any).accounts.openai;a.revision++;a.operation.revision=a.revision;a.operation.error.code='confirmation_not_submitted';a.operation.error.message='confirmation was not submitted';});
 await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
});

test('English runtime and login confirmation support keyboard at minimum window size',async({page})=>{
 await page.setViewportSize({width:860,height:600});await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(page.getByRole('region',{name:'Contribution runtime'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'AI accounts',exact:true}).click();await expect(page.getByRole('region',{name:'OpenAI account',exact:true}).getByText('Signed in, not connected')).toBeVisible();await page.getByRole('button',{name:'OpenAI details',exact:true}).click();const login=page.getByRole('dialog').getByRole('button',{name:'Sign in to OpenAI',exact:true});await login.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog').last()).toBeVisible();await expect(page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('dialog').last().getByRole('button',{name:'Start official sign-in',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(login).toBeFocused();await page.keyboard.press('Escape');
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);expect(await calls(page,'authorize_start')).toEqual([]);
});


test('runtime account revisions reach an open confirmation without changing its candidate',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const w=window as any;const a=structuredClone(w.accounts.openai);a.selection={state:'selected',fingerprint:'f'.repeat(64),observed_at:new Date().toISOString(),error:null};a.hive={...a.hive,state:'confirmation_required',pending_fingerprint:a.candidate.fingerprint};a.revision++;w.accounts.openai=a;});
 await reconcile(page);await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'换号',exact:true}).click();
 const before=await page.evaluate(()=>{const w=window as any;const a=structuredClone(w.accounts.openai);a.revision+=2;w.accounts.openai=a;return {reads:w.runtimeReadCount,revision:a.revision,candidate:a.candidate.reference};});
 await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(before.reads);await page.getByRole('dialog').last().getByRole('button',{name:'确认更换',exact:true}).click();
 const written=await calls(page,'account_action');expect(written).toHaveLength(1);expect(written[0].args.request.revision).toBe(before.revision);expect(written[0].args.request.candidate_ref).toBe(before.candidate);
 await expect(page.getByRole('dialog').getByText('账号操作已完成，平台保持暂停')).toBeVisible();await expect(page.getByRole('dialog').getByText('等待自动重试…',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).paused.openai)).toBe(true);
});

test('runtime observations preserve newer candidates and edited sources',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();
 const reads=await page.evaluate(()=>{const w=window as any;w.runtimeAccounts=structuredClone(w.accounts);w.runtimeAccounts.openai.revision=0;w.runtimeAccounts.openai.candidate.fingerprint='f'.repeat(64);w.runtimeAccounts.openai.candidate.reference='e'.repeat(48);return w.runtimeReadCount;});
 await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(reads);await expect(card(page).getByText('尚未接入',{exact:true})).toBeVisible();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();expect((await calls(page,'account_action'))[0].args.request.candidate_ref).toBe('a'.repeat(48));
 await openDetails(page);await page.evaluate(()=>{(window as any).delay=30000;});await page.getByRole('dialog').first().getByLabel('自定义目录').fill('/tmp/edited-source');await page.getByRole('dialog').first().getByLabel('自定义目录').press('Enter');
 const later=await page.evaluate(()=>{const w=window as any;delete w.runtimeAccounts;w.accounts.openai=structuredClone(w.accounts.openai);w.accounts.openai.revision++;return w.runtimeReadCount;});
 await page.clock.runFor(10001);await expect.poll(()=>page.evaluate(()=>(window as any).runtimeReadCount)).toBeGreaterThan(later);await expect(page.getByRole('dialog').first().getByLabel('自定义目录')).toHaveValue('/tmp/edited-source');await expect(page.getByRole('dialog').first().getByText('正在读取已有登录…')).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(1);
});

test('start preserves paused platforms and uncertain start recovers by reading only',async({page})=>{
 const accounts={openai:accountFixture('openai') as any,claude:accountFixture('claude')};
 accounts.openai.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};
 await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts});
 await page.goto('/');
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();
 await expect(page.getByRole('checkbox',{name:'允许 OpenAI 恢复接单'})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).runtimeUnknown=true;});
 await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 await expect(page.getByRole('region',{name:'贡献运行'})).toContainText('等待已安排的核对');
 await page.clock.runFor(10001);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
 const starts=await calls(page,'runtime_start');expect(starts).toHaveLength(1);
 expect(starts[0].args.request.resume_platforms).toEqual([]);
 expect(await calls(page,'supply_set_paused')).toEqual([]);
 await page.getByRole('button',{name:'停止贡献',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('中断正在处理的任务');
 expect(await calls(page,'runtime_stop')).toEqual([]);
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeFocused();
});

test('unregistered selection can be cancelled only after confirmation and never starts runtime',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();await expect(card(page).getByText('b'.repeat(16),{exact:true})).toBeVisible();await openDetails(page);await page.getByRole('dialog').getByRole('button',{name:'取消接入',exact:true}).click();await expect(page.getByRole('dialog').last()).toContainText('仅取消尚未注册的本地选择');expect(await calls(page,'account_action')).toHaveLength(1);await page.getByRole('dialog').last().getByRole('button',{name:'确认取消接入',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消接入',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await expect(card(page).getByText('尚未接入',{exact:true})).toBeVisible();expect((await calls(page,'account_action')).map((c:any)=>c.args.request.action)).toEqual(['select','clear_selection']);expect(await calls(page,'runtime_start')).toEqual([]);
});

for(const denial of ['device','diagnostic'])test('identity '+denial+' still permits one trusted local stop',async({page})=>{
 await setup(page);await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toBeEnabled();
 if(denial==='device'){await page.evaluate(()=>(window as any).deviceFail=true);await reconcile(page);}
 else{await page.clock.runFor(100);await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{const result=await invoke(command,args);if(command==='diagnostics_start'||command==='diagnostics_snapshot')result.result.report.checks[0]={...result.result.report.checks[0],status:'fail',code:'device_replaced',observed_at:new Date().toISOString(),evidence:{http_status:'401',path:'/api/bee/identity',server_code:'device_replaced'},next_action:'overview'};return result;};});await page.getByRole('navigation').getByRole('button',{name:'诊断',exact:true}).click();await page.getByRole('button',{name:'运行诊断',exact:true}).click();await page.clock.runFor(900);await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();}
 const stop=page.getByRole('button',{name:'停止贡献',exact:true});await expect(stop).toBeEnabled();if(denial==='diagnostic')await page.evaluate(()=>(window as any).deviceFail=true);await stop.click();await page.getByRole('dialog').getByRole('button',{name:'确认停止',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'runtime_stop')).length).toBe(1);await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeDisabled();
 expect(await calls(page,'runtime_start')).toHaveLength(1);expect(await calls(page,'supply_set_paused')).toHaveLength(0);
});

test('identity failure allows local login and cancellation but keeps account selection blocked',async({page})=>{
 const consoleErrors:string[]=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await setup(page);await page.evaluate(()=>(window as any).deviceFail=true);await reconcile(page);await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeDisabled();await openDetails(page,'Claude');
 const login=page.getByRole('dialog').getByRole('button',{name:'登录 Claude',exact:true});await expect(login).toBeEnabled();await login.click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'authorize_start')).length).toBe(1);
 const cancel=page.getByRole('button',{name:'取消官方登录',exact:true}).last();await expect(cancel).toBeEnabled();await cancel.click();await expect.poll(async()=>(await calls(page,'authorize_cancel')).length).toBe(1);
 await expect(page.getByRole('dialog').getByText('操作已取消',{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toHaveLength(0);expect(consoleErrors).toEqual([]);
});

for(const command of ['account_action','runtime_start'])test('known unsent '+command+' recovers at the same revision without replay',async({page})=>{
 await setup(page);
 if(command==='account_action'){await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();}
 else {await page.evaluate(()=>{const a=(window as any).accounts.openai;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};a.revision++;});await page.getByRole('button',{name:'重新核对设备',exact:true}).click();}
 await page.evaluate(command=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.unsentAttempts=0;w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{if(name===command&&++w.unsentAttempts===1)throw {code:'REQUEST_QUEUE_TIMEOUT',message:'fixture queue expired before first byte; no bytes sent'};return invoke(name,args);};},command);
 if(command==='account_action'){await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
 else await page.getByRole('button',{name:'开始贡献',exact:true}).click();
 await expect(page.getByText('本次请求未发送，操作未提交。',{exact:true})).toBeVisible();await page.clock.runFor(10100);expect(await page.evaluate(()=>(window as any).unsentAttempts)).toBe(1);
 if(command==='account_action'){await expect(card(page).getByRole('button',{name:'接入',exact:true})).toBeEnabled();await card(page).getByRole('button',{name:'接入',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认接入',exact:true}).click();}
 else{await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toBeEnabled();await page.getByRole('button',{name:'开始贡献',exact:true}).click();}
 await expect.poll(async()=>(await calls(page,command)).length).toBe(1);expect(await page.evaluate(()=>(window as any).unsentAttempts)).toBe(2);
});
