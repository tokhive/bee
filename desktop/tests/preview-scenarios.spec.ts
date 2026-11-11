import {test,expect,type Page} from '@playwright/test';

async function openScene(page:Page,scene:string){
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene+'&theme=light');
 await page.waitForFunction(()=>Boolean((window as unknown as {__beePreviewReady?:boolean;__beePreviewError?:string}).__beePreviewReady||(window as unknown as {__beePreviewError?:string}).__beePreviewError));
 expect(await page.evaluate(()=>(window as unknown as {__beePreviewError?:string}).__beePreviewError)).toBeUndefined();
}
const card=(page:Page,platform='OpenAI')=>page.getByRole('region',{name:platform+' 账号',exact:true});
const commands=(page:Page)=>page.evaluate(()=>(window as unknown as {calls:{command:string;args:Record<string,unknown>}[]}).calls);
const writes=new Set(['account_action','authorize_start','supply_set_paused','runtime_start','runtime_stop']);

test('preview keeps a completed operation through navigation, appearance and size changes until reset',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=running&theme=light');
 const app=page.frameLocator('iframe');
 const account=app.getByRole('region',{name:'OpenAI 账号',exact:true});
 await account.getByRole('button',{name:'暂停接单',exact:true}).click();
 await expect(account.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 await app.getByRole('button',{name:'设置',exact:true}).click();
 await app.getByRole('tab',{name:'通用',exact:true}).click();
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(app.locator('#ns-theme')).toHaveValue('dark');
 await page.getByLabel('窗口',{exact:true}).selectOption('narrow');
 await expect(app.getByRole('heading',{name:'设置',exact:true})).toBeVisible();
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await expect(account.getByRole('button',{name:'恢复接单',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重置场景',exact:true}).click();
 await expect(account.getByRole('button',{name:'暂停接单',exact:true})).toBeVisible();
});

test('preview appearance failure retains structured evidence and allows recovery without resetting',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=running&theme=light');
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{
  (el.contentWindow as any).settingsReadFailures={preferences_read:{code:'PREFERENCES_READ_FAILED',message:'private file read failed: kind=PermissionDenied os_code=13',details:{check:'preferences_read',observed_at:'2026-01-01T00:00:00Z',evidence:{actual:'permission_denied',required:'readable private preferences file'}}}};
 });
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 const feedback=page.locator('#control-status');
 for(const evidence of ['PREFERENCES_READ_FAILED','os_code=13','preferences_read','2026-01-01T00:00:00Z','actual=permission_denied','required=readable private preferences file'])await expect(feedback).toContainText(evidence);
 await expect(page.getByLabel('外观',{exact:true})).toHaveValue('light');
 await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{
  const w=el.contentWindow as any;delete w.settingsReadFailures;w.preferencesFail=true;
 });
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(feedback).toContainText('PREFERENCES_WRITE_FAILED');
 await expect(feedback).toContainText('os_code=13');
 await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{(el.contentWindow as any).preferencesFail=false;});
 await page.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(feedback).toHaveText('外观已切换，当前进度已保留。');
});

test('preview controls reject stale sessions and messages from other sources',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=running&theme=light');
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 const previous=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).__beePreviewSession as string);
 await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{(window as any).previousApproval=(el.contentWindow as any).__beePreviewApprove;});
 await page.getByRole('button',{name:'重置场景',exact:true}).click();
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 const oldApproval=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{
  const w=el.contentWindow as any;let error='';try{(window as any).previousApproval();}catch(cause){error=String(cause);}
  return {error,paused:w.paused,bindingRevision:w.bindingRevision??1};
 });
 expect(oldApproval.error).toContain('PREVIEW_SESSION_STALE');
 expect(oldApproval.paused).toEqual({openai:false,claude:false});
 expect(oldApproval.bindingRevision).toBe(1);
 const result=await page.locator('iframe').evaluate(async(el:HTMLIFrameElement,previous:string)=>{
  const w=el.contentWindow as any;
  let stale='';try{await w.__beePreviewControl({session:previous,action:'theme',value:'dark'});}catch(cause){stale=String(cause);}
  const data={type:'bee-preview-control',session:w.__beePreviewSession,id:200,action:'theme',value:'dark'};
  w.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:window,data}));
  w.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:w,data}));
  await new Promise(resolve=>setTimeout(resolve,0));
  return {stale,preferences:await w.__TAURI_INTERNALS__.invoke('preferences_read'),writes:w.calls.filter((call:any)=>call.command==='preferences_save').length};
 },previous);
 expect(result.stale).toContain('PREVIEW_SESSION_STALE');
 expect(result.preferences.preferences.theme).toBe('light');
 expect(result.preferences.preferences.revision).toBe(0);
 expect(result.writes).toBe(0);
 await page.locator('#theme').selectOption('dark');
 await expect(page.locator('#control-status')).toHaveText('外观已切换，当前进度已保留。');
});

const cases:[string,string|RegExp][]=[
 ['device-unbound','连接本机设备'],['device-pending','等待网页确认'],['device-expired','Hive 已确认配对码过期'],['device-bound','设备已绑定。'],['device-error','HTTP 503'],
 ['stopped','贡献尚未启动'],['runtime-starting','正在启动贡献'],['running','可接单'],['runtime-stopping','正在停止贡献'],['runtime-offline','Hive 未连接'],['runtime-disconnected',/Hive 未连接|正在重新连接 Hive/],['runtime-unknown','等待已安排的核对'],
 ['account-reading','正在读取已有登录'],['account-empty','未找到所选凭证来源'],['account-candidate','已有登录，尚未接入'],['account-selected','已用 3%'],['account-error','permission_denied'],['account-expired','历史数据，已过期'],['account-change','尚未核对'],
 ['supply-ready','可接单'],['supply-paused','恢复接单'],['supply-blocked','管理员尚未配置套餐并发上限'],['supply-partial','等待自动重试'],
 ['check-background','可接单'],['check-expired','核对中…'],['check-waiting','等待自动重试…'],['check-retrying','重试中…'],['check-recovered','可接单'],['check-sequence','可接单'],
 ['quota-normal','已用 3%'],['quota-unknown','尚未核对'],['quota-expired','历史数据，已过期'],['quota-multiple','7 日 · opus'],['quota-over','已用 120%'],
 ['confirm-login','开始官方登录'],['confirm-select','确认接入'],['confirm-change','确认更换'],['confirm-clear','确认取消接入'],['account-detail','凭证读取方式'],
];
for(const [scene,copy] of cases)test('scene renders formal state without invalid data or unintended writes: '+scene,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openScene(page,scene);
 await expect(page.locator('body')).toContainText(copy,{timeout:18000});
 expect(errors).toEqual([]);
 await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 const submitted=(await commands(page)).filter(call=>writes.has(call.command));
 expect(submitted.map(call=>call.command)).toEqual(scene==='runtime-unknown'?['runtime_start']:[]);
 if(scene==='check-expired'||scene==='check-waiting'||scene==='check-retrying'){
  await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
  await expect(card(page).getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
 }
 if(scene==='supply-partial'){
  await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
  await expect(card(page,'Claude').getByText('可接单',{exact:true})).toHaveCount(0);
 }
});

test('review selector covers approved groups and preserves scene when theme or size changes',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/index.html?scene=running&theme=light&size=normal');
 await expect(page.locator('#scene optgroup')).toHaveCount(11);
 expect(await page.locator('#scene optgroup').evaluateAll(groups=>groups.map(group=>(group as HTMLOptGroupElement).label))).toEqual(['账户目标交互（mock）','设备绑定','设备恢复','设置与诊断','跨页组合','贡献运行','AI 账号','接单条件','自动核对','额度报告','确认与详情']);
 await expect(page.locator('#scene option')).toHaveCount(83);
 await expect(page.locator('#scene option[value="confirm-stop"]')).toHaveCount(0);
 for(const scene of ['runtime-no-accounts','runtime-accounts-unconfirmed','confirm-change'])await expect(page.locator('#scene option[value="'+scene+'"]')).toHaveCount(1);
 await page.locator('#scene').selectOption('confirm-change');
 const app=page.frameLocator('iframe');
 await expect(app.getByRole('dialog').last()).toContainText('目标账号');
 await page.locator('#theme').selectOption('dark');
 await page.locator('#size').selectOption('narrow');
 await expect(page.locator('#scene')).toHaveValue('confirm-change');
 await expect(app.getByRole('dialog').last()).toContainText('目标账号');
 await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>({width:el.contentWindow!.innerWidth,height:el.contentWindow!.innerHeight,theme:el.contentDocument!.documentElement.dataset.theme}))).toEqual({width:860,height:600,theme:'dark'});
 for(const scene of ['runtime-no-accounts','runtime-accounts-unconfirmed']){
  await page.locator('#scene').selectOption(scene);
  await expect.poll(()=>page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).__beePreviewReady&&(el.contentWindow as any).__beePreviewScene)).toBe(scene);
  await expect(app.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
  await expect(app.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
  await expect(app.getByRole('button',{name:'重试准备',exact:true})).toHaveCount(0);
  const facts=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>{const w=el.contentWindow as any;return {selections:Object.values(w.accounts).map((a:any)=>a.selection.state),calls:w.calls};});
  expect(facts.selections).toEqual(['not_selected','not_selected']);
  if(scene==='runtime-no-accounts'){
   await expect(app.getByRole('region',{name:'服务状态',exact:true})).toContainText('接入账号后，Bee 将自动准备服务。');
   await expect(app.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
  }else{
   await expect(app.getByText('接入数量待确认',{exact:true})).toBeVisible();
   await expect(app.getByRole('region',{name:'服务状态',exact:true})).toContainText('贡献状态待确认');
   await expect(app.locator('main')).not.toContainText('0 个已接入');
   expect(facts.calls.filter((c:any)=>c.command==='account_snapshot')).toEqual([]);
  }
  expect(facts.calls.filter((c:any)=>['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save'].includes(c.command))).toEqual([]);
 }
});

test('automatic recovery traverses stale, failed, retrying and recovered states using read requests only',async({page})=>{
 await openScene(page,'check-sequence');
 await expect(card(page).getByText('可接单',{exact:true})).toBeVisible();
 test.setTimeout(45000);
 await expect(page.locator('.account-check-status>span')).toHaveText('等待自动重试…',{timeout:6000});
 await expect(page.locator('.account-check-status time')).toHaveAttribute('datetime',/^\d{4}-\d{2}-\d{2}T.*Z$/);
 await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(card(page).getByRole('button',{name:'暂停接单'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).__beePreviewPhase)).toBe('current');
 expect((await commands(page)).filter(c=>c.command==='supply_status'&&c.args.platform==='openai')).toHaveLength(1);
 await expect(page.locator('.account-check-status>span')).toHaveText('核对中…',{timeout:15000});
 await expect(page.locator('.account-check-status>span')).toHaveText('等待自动重试…');
 await expect(page.locator('.account-check-status>span')).toHaveText('重试中…',{timeout:15000});
 await expect(card(page).getByText('可接单',{exact:true})).toHaveCount(0);
 await expect(card(page).getByText('可接单',{exact:true})).toBeVisible({timeout:8000});
 await expect(page.locator('.account-check-status')).toHaveCount(0);
 expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
});

test('preview pairing remains pending after a poll and simulated website confirmation binds the device',async({page})=>{
 await openScene(page,'device-unbound');
 await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByRole('button',{name:'生成配对码',exact:true}).click();
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await commands(page)).filter(c=>c.command==='device_status').length).toBeGreaterThan(1);
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(page.getByText('等待网页确认',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as {__beePreviewApprove:()=>void}).__beePreviewApprove());
 await expect(page.getByText('设备已绑定。',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(call=>writes.has(call.command))).toEqual([]);
});

test('confirmed account actions update only the fixture and preserve pause semantics',async({page})=>{
 await openScene(page,'confirm-select');
 await page.getByRole('button',{name:'确认接入',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).accounts.openai.operation?.state)).toBe('succeeded');
 await expect(card(page).getByText('正在准备账号…',{exact:true}).first()).toBeVisible();
 expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
 expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
 await page.getByRole('button',{name:'概览',exact:true}).click();
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
 // The explicit selection prepares service; the shared model reads it back.
 await expect(card(page).getByRole('button',{name:'恢复接单',exact:true})).toBeVisible({timeout:15000});
 expect(await page.evaluate(()=>(window as unknown as {paused:{openai:boolean}}).paused.openai)).toBe(true);
 expect((await commands(page)).filter(c=>c.command==='supply_set_paused')).toEqual([]);
 expect((await commands(page)).filter(c=>['runtime_start','runtime_stop'].includes(c.command))).toEqual([]);
});

for(const scene of ['confirm-change','account-change'])test('confirmed changed identity cannot inherit the prior account quota: '+scene,async({page})=>{
 await openScene(page,scene);
 if(scene==='account-change'){
  await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  await page.getByRole('button',{name:'换号',exact:true}).click();
 }
 await page.getByRole('button',{name:'确认更换',exact:true}).click();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).accounts.openai.operation?.state)).toBe('succeeded');
 const state=await page.evaluate(()=>{const w=window as unknown as {accounts:{openai:{candidate:{fingerprint:string};selection:{fingerprint:string};authorization:{fingerprint:string};capabilities:{windows:unknown[]}[]}};paused:{openai:boolean}};return {account:w.accounts.openai,paused:w.paused.openai};});
 expect(state.account.selection.fingerprint).toBe('f'.repeat(64));
 expect(state.account.authorization.fingerprint).toBe(state.account.candidate.fingerprint);
 expect(state.account.capabilities.every(c=>c.windows.length===0)).toBe(true);
 expect(state.paused).toBe(true);
 await expect(card(page).getByText('尚未核对',{exact:true})).toBeVisible();
 expect((await commands(page)).filter(c=>writes.has(c.command)).map(c=>c.command)).toEqual(['account_action']);
});

for(const [scene,copy] of [
 ['settings-general','通用'],['settings-network','本机 HTTP 代理'],['settings-system','通知与启动'],['settings-about','关于'],
 ['diagnostics-running','诊断进行中'],['diagnostics-results','诊断'],['diagnostics-read-failed','报告读取已暂停'],['diagnostics-export-unknown','报告下载结果未确认'],
 ['update-downloading','下载'],['update-verified','安装'],['update-unknown','安装'],['update-failed','signature'],
 ['bridge-starting','正在读取 Bee'],['bridge-failed','exit=17'],['startup-blocked','本机设备'],
] as const)test('additional formal page accepts current DTO without invalid reply: '+scene,async({page})=>{
 test.setTimeout(50000);await openScene(page,scene);await expect(page.locator('body')).toContainText(copy,{timeout:35000});
 await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 expect((await commands(page)).filter(c=>writes.has(c.command))).toEqual([]);
});

test('English preview navigates the formal account and settings pages',async({page})=>{
 await page.goto('/tests/fixtures/bee-preview/app.html?scene=account-detail&locale=en');
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
 await expect(page.getByRole('dialog')).toHaveAccessibleName('OpenAI account details');await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{level:1,name:'Settings',exact:true})).toBeFocused();
});
