import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
import type {AccountOperation,AccountPlatform,AccountSnapshot} from '../src/system/accounts';

// Frontend mock coverage only. These replies exercise the public native contract;
// they do not prove OS login, Hive ownership, forwarding, or process recovery.
type Scenario={selected?:boolean;maintenance?:'blocked'|'restored';original?:'failed'|'unknown';connection?:'connected'|'occupied'};
const observed='2026-11-05T03:00:00Z';
const card=(page:Page,name='OpenAI')=>page.getByRole('region',{name:`${name} 账号`,exact:true});
const service=(page:Page)=>page.getByRole('region',{name:'服务状态',exact:true});
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((call:any)=>call.command===command),command);

function preparedAccount(platform:AccountPlatform,scenario:Scenario){
 const account=accountFixture(platform) as AccountSnapshot,fingerprint=(platform==='openai'?'b':'c').repeat(64);
 account.revision=5;
 account.candidate={state:'available',reference:'a'.repeat(48),source:{directory:null,store:'file'},fingerprint,plan:platform==='openai'?'plus':'pro',expires_at:'2099-01-01T00:00:00Z',identity_verified:true,observed_at:observed,error:null};
 if(scenario.selected&&platform==='openai'){
  account.selection={state:'selected',fingerprint,observed_at:observed,error:null};
  account.hive={state:'ready',fingerprint,pending_fingerprint:null,generation:1,observed_at:observed,error:null};
  account.authorization={state:'synchronized',fingerprint,observed_at:observed,error:null};
 }
 if(scenario.maintenance&&platform==='openai'){
  const operation:AccountOperation={id:'f'.repeat(48),kind:'authorize',platform,state:scenario.original??'failed',revision:5,error:null};
  account.operation=operation;
  account.login_maintenance={operation:structuredClone(operation),phase:scenario.maintenance,source:{directory:null,store:'file'},started_at:'2026-11-05T02:59:00Z',can_recheck:scenario.maintenance==='blocked',error:scenario.maintenance==='blocked'?{code:'permission_denied',check:'read_login_source',platform,message:'Current login source read denied: permission_denied=true; required=readable original source',evidence:{permission_denied:'true'}}:null};
 }
 return account;
}

function installAutoServiceReplies(scenario:Scenario){
 const w=window as any,native=w.__TAURI_INTERNALS__,invoke=native.invoke;
 w.paused.openai=true;
 w.autoServiceMock={local:scenario.selected?'running':'waiting',connection:scenario.connection??'connected',revision:1,readFailure:false,finishMaintenance:false,rechecks:0};
 const state=w.autoServiceMock;
 const supply=(platform:string)=>{
  const selected=w.accounts[platform].selection.state==='selected';
  const reasons=[...(w.paused[platform]?['manually_paused']:[]),...(!selected?['not_configured']:[]),...(state.connection!=='connected'?['offline']:[])];
  return {hive:'https://hive.example',device_id:'dev-1',platform,paused:w.paused[platform],ready:reasons.length===0,reasons,checked_at:new Date().toISOString()};
 };
 native.invoke=async(command:string,args:any={})=>{
  if(command==='authorize_status'){
   w.calls.push({command,args});
   return {instance:'b'.repeat(32),result:{error:{code:'AUTHORIZE_OPERATION_FAILED',message:'Original login process is not owned by this new management instance; use the persisted maintenance snapshot'}}};
  }
  if(command==='runtime_snapshot'&&state.readFailure){
   w.calls.push({command,args});
   throw {code:'RESPONSE_TIMEOUT',message:'runtime_snapshot response unavailable; current service state is unconfirmed',details:{check:'runtime_snapshot',observed_at:new Date().toISOString(),evidence:{actual:'no runtime response',required:'confirmed runtime snapshot'}}};
  }
  if(command==='runtime_start'&&state.local==='waiting'){
   w.calls.push({command,args});
   state.connection='connected';state.revision++;
   return {instance:'b'.repeat(32),result:{operation:{id:'e'.repeat(48),kind:'start',platform:null,state:'succeeded',revision:state.revision,error:null}}};
  }
  const reply=await invoke(command,args);
  if(command==='account_snapshot'&&args.refresh===true&&w.accounts[args.platform].login_maintenance){
   const account=w.accounts[args.platform];
   state.rechecks++;account.revision++;state.revision++;
   if(state.finishMaintenance){
    account.login_maintenance.phase='restored';
    account.login_maintenance.can_recheck=false;
    account.login_maintenance.error=null;
   }
   reply.result.account=structuredClone(account);
  }
  if(command==='runtime_snapshot'){
   const runtime=reply.result.runtime;
   runtime.local=state.local;runtime.revision=state.revision;
   runtime.run_id=state.local==='running'?'a'.repeat(32):null;
   runtime.connection=state.connection;
   runtime.connection_detail=state.connection==='occupied'?{failure:{code:'ownership_unconfirmed',stage:'connect',occurred_at:new Date().toISOString(),message:'Hive connection ownership unconfirmed: HTTP 409; owned_session=false',evidence:{http_status:'409',path:'/api/bee/connect',owned_session:'false',consecutive_conflicts:'1'}},retry:'halted',next_retry_at:null}:null;
   for(const platform of ['openai','claude'])runtime.platforms[platform].supply=state.local==='running'?supply(platform):null;
  }
  if(command==='supply_status')reply.result.supply=supply(args.platform);
  return reply;
 };
}

async function setup(page:Page,scenario:Scenario={}){
 await page.clock.install({time:new Date(observed)});
 const accounts={openai:preparedAccount('openai',scenario),claude:preparedAccount('claude',{})};
 await page.addInitScript({content:`(${installAccountFixture.toString()})(${JSON.stringify({runtimeEnabled:true,accounts})});(${installAutoServiceReplies.toString()})(${JSON.stringify(scenario)});`});
 await page.goto('/');
 await expect(service(page)).toBeVisible();
}
async function accountsPage(page:Page){
 await page.getByRole('navigation').getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect(card(page).getByRole('button',{name:'OpenAI 详情',exact:true})).toBeVisible();
}
async function reconcile(page:Page){
 const before=(await calls(page,'runtime_snapshot')).length;
 await page.clock.runFor(10001);
 await expect.poll(async()=>(await calls(page,'runtime_snapshot')).length).toBeGreaterThan(before);
}
async function noDailyControls(page:Page){
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);
}

test.describe('native automatic service — frontend mock contract',()=>{
 test('waiting and completed official login keep the candidate unselected without daily controls',async({page})=>{
  await setup(page);
  await expect(service(page)).toContainText('接入账号后，Bee 将自动准备服务。');
  await noDailyControls(page);
  await accountsPage(page);
  await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'重新登录',exact:true}).click();
  await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();
  await page.keyboard.press('Escape');await expect(card(page).getByRole('button',{name:'取消登录',exact:true})).toBeEnabled();
  await page.evaluate(()=>{(window as any).loginComplete=true;});
  await reconcile(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).accounts.openai.operation?.state)).toBe('succeeded');
  expect(await page.evaluate(()=>(window as any).accounts.openai.selection.state)).toBe('not_selected');
  expect(await calls(page,'account_action')).toHaveLength(0);
  expect(await calls(page,'runtime_start')).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(card(page).getByRole('button',{name:'接入账号',exact:true})).toBeEnabled();
  await page.getByRole('navigation').getByRole('button',{name:'概览',exact:true}).click();
  await noDailyControls(page);
 });

 test('Claude failed official login shows one summary while an independent Hive failure stays visible',async({page})=>{
  await page.clock.install({time:new Date(observed)});
  const claude=accountFixture('claude');
  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios:{autoService:true,loginOutcome:{state:'failed'}},accounts:{openai:accountFixture('openai'),claude}});
  await page.goto('/');
  await accountsPage(page);
  const row=card(page,'Claude');
  await row.getByRole('button',{name:'Claude 详情',exact:true}).click();
  await page.getByRole('dialog').last().getByRole('button',{name:'登录 Claude',exact:true}).click();
  const login=row.getByRole('region',{name:'Claude 登录状态',exact:true});
  await login.getByRole('button',{name:'继续登录',exact:true}).click();
  await expect(login).toContainText('请完成 Claude 官方登录');
  await page.evaluate(()=>{
   const w=window as any;
   w.loginComplete=true;
   w.accounts.claude.issues.push({platform:'claude',code:'hive_unconfirmed',fingerprint:null,message:'Hive account state is unconfirmed; required=current confirmed account state',notify:false});
  });
  await page.clock.runFor(10001);
  await expect(login.getByText('官方登录进程执行失败。',{exact:true})).toBeVisible();
  await row.locator('.account-conditions>summary').click();
  const summary=row.getByText('官方登录进程执行失败。',{exact:true});
  await expect(summary).toHaveCount(1);
  await expect(summary).toBeVisible();
  await expect(row.getByText('Hive 账号状态尚未确认。',{exact:true})).toBeVisible();
  expect(await calls(page,'authorize_start')).toHaveLength(1);
  expect(await calls(page,'account_action')).toHaveLength(0);
  expect(await calls(page,'supply_set_paused')).toHaveLength(0);
  expect(await calls(page,'runtime_start')).toHaveLength(0);
  expect(await calls(page,'runtime_stop')).toHaveLength(0);
 });

 test('blocked OpenAI maintenance has read-only rechecks in its row and details while resume stays blocked',async({page})=>{
  await setup(page,{selected:true,maintenance:'blocked'});
  const row=card(page);
  await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeDisabled();
  await expect(row.getByRole('button',{name:'核对维护结果',exact:true})).toBeEnabled();
  const rowReads=(await calls(page,'account_snapshot')).filter((call:any)=>call.args.platform==='openai'&&call.args.refresh===true).length;
  await row.getByRole('button',{name:'核对维护结果',exact:true}).click();
  await expect.poll(async()=>(await calls(page,'account_snapshot')).filter((call:any)=>call.args.platform==='openai'&&call.args.refresh===true).length).toBeGreaterThan(rowReads);
  await expect(row.getByRole('button',{name:'恢复接单',exact:true})).toBeDisabled();
  await accountsPage(page);
  await row.getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  const detail=page.getByRole('dialog');
  await expect(detail.getByRole('button',{name:'重新登录',exact:true})).toBeDisabled();
  await expect(detail.getByRole('button',{name:'核对维护结果',exact:true})).toBeEnabled();
  const detailReads=(await calls(page,'account_snapshot')).filter((call:any)=>call.args.platform==='openai'&&call.args.refresh===true).length;
  await detail.getByRole('button',{name:'核对维护结果',exact:true}).click();
  await expect.poll(async()=>(await calls(page,'account_snapshot')).filter((call:any)=>call.args.platform==='openai'&&call.args.refresh===true).length).toBeGreaterThan(detailReads);
  expect(await calls(page,'authorize_status')).toHaveLength(0);
  expect(await calls(page,'authorize_start')).toHaveLength(0);
  expect(await calls(page,'account_action')).toHaveLength(0);
  expect(await calls(page,'supply_set_paused')).toHaveLength(0);
 });

 test('restored maintenance preserves an unknown original login result',async({page})=>{
  await setup(page,{selected:true,maintenance:'blocked',original:'unknown'});
  await accountsPage(page);
  await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();
  const detail=page.getByRole('dialog');
  await page.evaluate(()=>{(window as any).autoServiceMock.finishMaintenance=true;});
  await detail.getByRole('button',{name:'核对维护结果',exact:true}).click();
  await expect(detail).toContainText('此平台的账号维护已恢复。');
  await expect(detail).toContainText('原登录进程已中断，原登录结果未确认；账号维护状态单独核对。');
  await expect(detail).not.toContainText('登录已核验');
  expect(await page.evaluate(()=>{const account=(window as any).accounts.openai;return [account.operation.state,account.login_maintenance.operation.state,account.login_maintenance.phase];})).toEqual(['unknown','unknown','restored']);
  expect(await calls(page,'authorize_status')).toHaveLength(0);
  expect(await calls(page,'authorize_start')).toHaveLength(0);
  expect(await calls(page,'supply_set_paused')).toHaveLength(0);
 });

 test('an unconfirmed runtime read keeps visible service feedback and a read-only recovery action',async({page})=>{
  await setup(page,{selected:true});
  await page.evaluate(()=>{(window as any).autoServiceMock.readFailure=true;});
  await reconcile(page);
  await expect(service(page)).toContainText('贡献状态待确认');
  await expect(service(page).getByRole('button',{name:'核对服务状态',exact:true})).toBeEnabled();
  await page.evaluate(()=>{(window as any).autoServiceMock.readFailure=false;});
  const before=(await calls(page,'runtime_snapshot')).length;
  await service(page).getByRole('button',{name:'核对服务状态',exact:true}).click();
  await expect.poll(async()=>(await calls(page,'runtime_snapshot')).length).toBeGreaterThan(before);
  await expect(service(page).getByRole('button',{name:'核对服务状态',exact:true})).toHaveCount(0);
  await noDailyControls(page);
  expect(await calls(page,'runtime_start')).toHaveLength(0);
  expect(await calls(page,'runtime_stop')).toHaveLength(0);
 });

 test('halted waiting presence offers explicit reconnect and connection diagnostics without daily controls',async({page})=>{
  await setup(page,{connection:'occupied'});
  await expect(service(page)).toContainText('自动重连已停止');
  await expect(service(page)).toContainText('设备连接已被占用');
  await expect(service(page).getByRole('button',{name:'检查 Hive 连接',exact:true})).toBeEnabled();
  await expect(service(page).getByRole('button',{name:'重新连接 Hive',exact:true})).toBeEnabled();
  await noDailyControls(page);
  await service(page).getByRole('button',{name:'重新连接 Hive',exact:true}).click();
  await expect(service(page)).toContainText('Hive 已连接');
  expect((await calls(page,'runtime_start')).map((call:any)=>call.args.request.resume_platforms)).toEqual([[]]);
  expect(await calls(page,'runtime_stop')).toHaveLength(0);
  expect(await calls(page,'supply_set_paused')).toHaveLength(0);
  expect(await page.evaluate(()=>(window as any).autoServiceMock.local)).toBe('waiting');
 });
});
