import {readFileSync} from 'node:fs';
import {accountFixture} from './fixtures/native-accounts.mjs';
const passiveRuntime={...JSON.parse(readFileSync(new URL('../../desktopbridge/testdata/runtime-contract.json',import.meta.url),'utf8')).snapshot,local:'running',connection:'connected',operation:null,stop_receipt:null};
import { test, expect, type Page } from '@playwright/test';
async function fixture(page:Page, options:{delay?:number;age?:number;ready?:boolean;unbound?:boolean}={}) {
 const accounts=Object.fromEntries(['openai','claude'].map(p=>{const a=accountFixture(p) as any;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};return [p,a];}));
 await page.addInitScript((options)=>{
  type Runtime={isTauri:boolean;__TAURI_INTERNALS__:unknown;__TAURI_EVENT_PLUGIN_INTERNALS__:unknown;calls:{command:string;platform?:string;paused?:boolean}[];active:number;maxActive:number;delay:number;fail:string;failPlatform?:string;age:number;emit:(instance:string)=>void;paused:Record<string,boolean>};
  const w=window as unknown as Runtime;w.isTauri=true;w.calls=[];w.active=0;w.maxActive=0;w.delay=options.delay??0;w.fail='';w.age=options.age??0;w.paused={openai:false,claude:true};
  let callback=1;const callbacks=new Map<number,(value:unknown)=>void>(),subscriptions=new Map<number,string>();
  const status=(instance=currentInstance)=>({state:'ready',metadata:{bee_version:'dev',os:'darwin',arch:'arm64',instance}});
  let currentInstance='b'.repeat(32),preferences={version:1,revision:0,language:'system',theme:'system',notifications_enabled:false,autostart_desired:false,proxies:[]};
  w.emit=instance=>{currentInstance=instance;for(const [handler,event]of subscriptions)if(event==='bee://bridge-status')callbacks.get(handler)?.({payload:status(instance)});};
  w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event:string,id:number)=>{subscriptions.delete(id);callbacks.delete(id);}};
  w.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:(id:number)=>{callbacks.delete(id);},invoke:async(command:string,args?:{platform?:string;paused?:boolean;handler?:number;event?:string;eventId?:number;request?:{preferences:typeof preferences}})=>{
   if(command==='plugin:event|listen'){subscriptions.set(args!.handler!,args!.event!);return args!.handler;}
   if(command==='plugin:event|unlisten'){subscriptions.delete(args!.eventId!);return;}
   if(command==='runtime_snapshot')return {instance:currentInstance,result:{runtime:{...options.passiveRuntime,observed_at:new Date().toISOString(),platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:options.accounts[p],supply:null,selection_revision:1}]))}}};
   if(command==='bridge_status')return status();
   if(command==='preferences_read')return structuredClone({preferences,error:null});
   if(command==='preferences_save'){preferences={...args!.request!.preferences,revision:preferences.revision+1};return structuredClone({preferences,error:null});}
   if(command==='notification_permission')return 'prompt';
   if(command==='autostart_status')return {desired:false,registered:false,error:null};
   if(command==='network_snapshot')return {saved_revision:0,effective_revision:0,saved_proxy:'',effective_proxy:'',paths:{relay:'direct',official:'openai=direct;claude=direct',hive:'process_environment',official_login:'official_client'},pending_restart:false,error:null};
   if(command==='account_defaults')return {instance:currentInstance,result:{defaults:{platforms:['openai','claude'].map(platform=>({platform,directory:platform==='openai'?'/tmp/codex':'/tmp/claude',default_store:'file',stores:[{store:'file',supported:true,reason:null}]}))}}};
   if(command==='account_snapshot')return {instance:currentInstance,result:{account:options.accounts[args!.platform!]}};
   if(command==='device_status')return {result:{device:options.unbound?{state:'unbound'}:{state:'bound',hive:'https://hive.example',name:'Fixture Mac',identity:{id:'device-1',name:'Fixture Mac',owner_id:'owner-1',owner_email:'fixture@example.test'}}}};
   if(command.startsWith('supply_')){
    w.calls.push({command,platform:args?.platform,...(args?.paused===undefined?{}:{paused:args.paused})});w.maxActive=Math.max(w.maxActive,++w.active);
    const fail=w.fail,age=w.age;const platform=args!.platform!;
    try{
     if(w.delay)await new Promise(resolve=>setTimeout(resolve,w.delay));
     if(command==='supply_set_paused')w.paused[platform]=args!.paused!;
     if(fail&&(!w.failPlatform||w.failPlatform===platform))return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:fail}}};
     const paused=w.paused[platform];const reasons=paused?['manually_paused','offline']:options.ready?[]:['offline',...(platform==='openai'?['codex_source_unavailable','authorization_unavailable']:['not_configured'])];
     return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform,paused,ready:reasons.length===0,reasons,checked_at:new Date(Date.now()-age).toISOString()}}};
    }finally{w.active--;}
   }
   throw new Error('unexpected fixture IPC '+command);
  }};
 },{...options,passiveRuntime,accounts});
}
async function diagnostics(page:Page,message:string){await page.getByRole('button',{name:'诊断',exact:true}).click();await page.getByText('核对诊断',{exact:true}).click();await expect(page.locator('pre')).toContainText(message);await page.getByRole('button',{name:'概览',exact:true}).click();}
const card=(page:Page,platform:string)=>page.getByRole('region',{name:`${platform} 账号`,exact:true});
test('two verified shared account rows show real reasons and explicit pause/resume semantics at 860x600',async({page})=>{
 await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');
 const openai=card(page,'OpenAI'),claude=card(page,'Claude');
 await expect(openai.getByText('不能接单')).toBeVisible();await expect(openai.getByText('Hive 未看到此平台的 Bee 连接')).toBeVisible();
 await expect(openai.getByText('无法读取 Codex 官方登录')).toBeVisible();await expect(claude.getByText('已手动暂停')).toBeVisible();
 await expect(page.getByRole('button',{name:'全部暂停',exact:true})).toHaveCount(0);
 await claude.getByRole('button',{name:'恢复接单'}).click();await expect(claude.getByText('不能接单')).toBeVisible();await expect(claude.getByText('尚未配置平台账号或市场未开放')).toBeVisible();
 await openai.getByRole('button',{name:'暂停接单',exact:true}).click();await expect(openai.getByText('已手动暂停')).toBeVisible();
 expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
 await page.getByRole('region',{name:'平台账号列表',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-zh-860.png'});
});
test('an uncertain write retries GET automatically, preserves diagnostics and never repeats PUT',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');
 await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
 await page.evaluate(()=>{(window as unknown as {fail:string}).fail='PUT /api/bee/platforms/openai HTTP 503; result unconfirmed';});
 await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
 await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);
 await page.clock.runFor(9999);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
 await page.evaluate(()=>{const w=window as unknown as {fail:string;delay:number};w.fail='';w.delay=500;});await page.clock.runFor(1);
 await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('重试中…',{exact:true})).toBeVisible();await diagnostics(page,'PUT /api/bee/platforms/openai HTTP 503');
 await page.clock.runFor(2200);await expect(openai.getByText('已手动暂停')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=> (window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(1);
 await expect(page.getByRole('button',{name:'重新核对平台'})).toHaveCount(0);
});
test('serial polling waits ten seconds after completion and repeats failures without overlapping slow reads',async({page})=>{
 await fixture(page,{delay:700});await page.clock.install();await page.goto('/');await page.clock.runFor(1600);
 await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 const before=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(9000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(before);
 await page.evaluate(()=>{(window as unknown as {fail:string}).fail='GET /api/bee/platforms/openai HTTP 502';});await page.clock.runFor(2500);await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
 const failed=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(12000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(failed+2);
 await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
});
test('expired snapshots never show a current successful state or enable writes',async({page})=>{
 await fixture(page,{age:31000,ready:true});await page.goto('/');const openai=card(page,'OpenAI');
 await expect(openai.getByText('状态待更新')).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
});
test('fresh background reads stay quiet and hide previous success only when thirty seconds expire',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByText('可接单',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=60000;});await page.clock.runFor(11000);
 await expect(openai.getByText('可接单',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toHaveCount(0);
 await page.clock.runFor(20000);await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('核对中…',{exact:true})).toBeVisible();await expect(openai.getByText('可接单',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
});
test('navigation keeps one application poller and old results cannot repopulate a new manager instance',async({page})=>{
 await fixture(page);await page.clock.install();await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.clock.runFor(10001);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.clock.runFor(1500);const count=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(9000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count);await page.clock.runFor(3500);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count+2);
 await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='new instance GET HTTP 503';w.emit('c'.repeat(32));});
 await page.getByRole('button',{name:'概览',exact:true}).click();await diagnostics(page,'new instance GET HTTP 503');await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
});
test('English platform controls and reason copy are complete at minimum width',async({page})=>{
 await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(page.getByRole('region',{name:'OpenAI account',exact:true}).getByText('Hive does not see this platform’s Bee connection')).toBeVisible();await expect(page.getByRole('region',{name:'Claude account',exact:true}).getByRole('button',{name:'Resume tasks',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
 await page.getByRole('region',{name:'Platform accounts',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-en-860.png'});
});
test('unverified devices never issue supply IPC',async({page})=>{
 await fixture(page,{unbound:true});await page.goto('/');await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();await expect(page.getByRole('button',{name:'暂停接单',exact:true})).toHaveCount(0);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls)).toEqual([]);
});

test('an old in-flight successful read cannot overwrite replacement-instance failure or continue its next platform',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.clock.runFor(10001);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
 await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='replacement GET HTTP 503';w.emit('c'.repeat(32));});await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);await page.clock.runFor(1500);
 await diagnostics(page,'replacement GET HTTP 503');await expect(card(page,'OpenAI').getByText('可接单',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {calls:{platform:string}[]}).calls.map(c=>c.platform))).toEqual(['openai','claude','openai','openai','claude']);
 expect(await page.evaluate(()=>(window as unknown as {maxActive:number}).maxActive)).toBe(1);
});

test('a delayed expiry timer cannot authorize a write from a stale rendered button',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByRole('button',{name:'暂停接单',exact:true})).toBeEnabled();
 await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+31000)));await openai.getByRole('button',{name:'暂停接单',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(0);
 await expect(openai.getByText('状态待更新')).toBeVisible();
});

test('manager replacement invalidates device data while preserving this run’s language and navigation',async({page})=>{
 await fixture(page);await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await page.evaluate(()=>(window as unknown as {emit:(id:string)=>void}).emit('c'.repeat(32)));
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await page.getByRole('tab',{name:'General',exact:true}).click();await expect(page.getByLabel('Language',{exact:true})).toHaveValue('en');
});

test('one platform read failure preserves the other platform fresh report',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');
 await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.evaluate(()=>{const w=window as unknown as {fail:string;failPlatform:string};w.fail='GET openai HTTP 503';w.failPlatform='openai';});
 await page.clock.runFor(11000);
 await expect(page.getByRole('region',{name:'平台账号列表',exact:true}).getByText('等待自动重试…',{exact:true})).toBeVisible();await diagnostics(page,'GET openai HTTP 503');
 await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();await expect(card(page,'Claude').getByRole('button',{name:'恢复接单',exact:true})).toBeEnabled();
});
