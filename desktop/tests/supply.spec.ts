import { test, expect, type Page } from '@playwright/test';
async function fixture(page:Page, options:{delay?:number;age?:number;ready?:boolean;unbound?:boolean}={}) {
 await page.addInitScript((options)=>{
  type Runtime={isTauri:boolean;__TAURI_INTERNALS__:unknown;__TAURI_EVENT_PLUGIN_INTERNALS__:unknown;calls:{command:string;platform?:string;paused?:boolean}[];active:number;maxActive:number;delay:number;fail:string;age:number;emit:(instance:string)=>void;paused:Record<string,boolean>};
  const w=window as unknown as Runtime;w.isTauri=true;w.calls=[];w.active=0;w.maxActive=0;w.delay=options.delay??0;w.fail='';w.age=options.age??0;w.paused={openai:false,claude:true};
  let callback=1;const callbacks=new Map<number,(value:unknown)=>void>();let eventHandler=0;
  const status=(instance='fixture')=>({state:'ready',metadata:{bee_version:'fixture',os:'darwin',arch:'arm64',instance}});
  w.emit=instance=>callbacks.get(eventHandler)?.({payload:status(instance)});
  w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  w.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:()=>{},invoke:async(command:string,args?:{platform?:string;paused?:boolean;handler?:number})=>{
   if(command==='plugin:event|listen'){eventHandler=args!.handler!;return 1;}
   if(command==='plugin:event|unlisten')return;
   if(command==='bridge_status')return status();
   if(command==='device_status')return {result:{device:options.unbound?{state:'unbound'}:{state:'bound',hive:'https://hive.example',name:'Fixture Mac',identity:{id:'device-1',name:'Fixture Mac',owner_id:'owner-1',owner_email:'fixture@example.test'}}}};
   if(command.startsWith('supply_')){
    w.calls.push({command,platform:args?.platform,...(args?.paused===undefined?{}:{paused:args.paused})});w.maxActive=Math.max(w.maxActive,++w.active);
    const fail=w.fail,age=w.age;const platform=args!.platform!;
    try{
     if(w.delay)await new Promise(resolve=>setTimeout(resolve,w.delay));
     if(command==='supply_set_paused')w.paused[platform]=args!.paused!;
     if(fail)return {result:{error:{code:'SUPPLY_OPERATION_FAILED',message:fail}}};
     const paused=w.paused[platform];const reasons=paused?['manually_paused','offline']:options.ready?[]:['offline',...(platform==='openai'?['codex_source_unavailable','authorization_unavailable']:['not_configured'])];
     return {result:{supply:{hive:'https://hive.example',device_id:'device-1',platform,paused,ready:reasons.length===0,reasons,checked_at:new Date(Date.now()-age).toISOString()}}};
    }finally{w.active--;}
   }
   throw new Error('unexpected fixture IPC '+command);
  }};
 },options);
}
const card=(page:Page,platform:string)=>page.getByRole('region',{name:platform,exact:true});
test('two verified platform cards show real reasons and explicit pause/resume semantics at 860x600',async({page})=>{
 await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');
 const openai=card(page,'OpenAI'),claude=card(page,'Claude');
 await expect(openai.getByText('不满足接单条件')).toBeVisible();await expect(openai.getByText('Hive 未看到此平台的 Bee 连接')).toBeVisible();
 await expect(openai.getByText('无法读取 Codex 官方登录')).toBeVisible();await expect(claude.getByText('已手动暂停')).toBeVisible();
 await expect(page.getByText('暂停按当前 Hive 账号和平台保存，换设备后仍保留；不会终止已接请求。')).toBeVisible();
 await claude.getByRole('button',{name:'恢复'}).click();await expect(claude.getByText('不满足接单条件')).toBeVisible();await expect(claude.getByText('尚未配置平台账号或市场未开放')).toBeVisible();
 await openai.getByRole('button',{name:'暂停',exact:true}).click();await expect(openai.getByText('已手动暂停')).toBeVisible();
 expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
 await page.getByRole('region',{name:'平台供给',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-zh-860.png'});
});
test('an uncertain write stops polling and only explicit GET rechecks, without flashing cached success',async({page})=>{
 await fixture(page,{ready:true});await page.goto('/');const openai=card(page,'OpenAI');
 await expect(openai.getByText('满足接单条件（Hive 报告）',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {fail:string}).fail='PUT /api/bee/platforms/openai HTTP 503; result unconfirmed';});
 await openai.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('HTTP 503');
 await expect(openai.getByText('满足接单条件（Hive 报告）',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'恢复'})).toHaveCount(0);
 await page.clock.install();await page.clock.fastForward(12000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
 await page.evaluate(()=>{const w=window as unknown as {fail:string;delay:number};w.fail='';w.delay=500;});await page.getByRole('button',{name:'重新核对平台'}).click();
 await expect(page.getByText('正在核对平台…')).toBeVisible();await expect(openai.getByText('满足接单条件（Hive 报告）',{exact:true})).toHaveCount(0);
 await page.clock.runFor(1100);await expect(openai.getByText('已手动暂停')).toBeVisible();
 expect(await page.evaluate(()=> (window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(1);
});
test('serial polling waits ten seconds after successful completion, never overlaps slow reads, and stops on failure',async({page})=>{
 await fixture(page,{delay:700});await page.clock.install();await page.goto('/');await page.clock.runFor(1600);
 await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 const before=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.runFor(9000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(before);
 await page.evaluate(()=>{(window as unknown as {fail:string}).fail='GET /api/bee/platforms/openai HTTP 502';});await page.clock.runFor(2500);await expect(page.getByRole('alert').first()).toContainText('HTTP 502');
 const failed=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.fastForward(60000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(failed);
 expect(await page.evaluate(()=> (window as unknown as {maxActive:number}).maxActive)).toBe(1);
});
test('expired snapshots never show a current successful state or enable writes',async({page})=>{
 await fixture(page,{age:31000,ready:true});await page.goto('/');const openai=card(page,'OpenAI');
 await expect(openai.getByText('核对已过期，请重新核对')).toBeVisible();await expect(openai.getByText('满足接单条件（Hive 报告）',{exact:true})).toHaveCount(0);await expect(openai.getByRole('button',{name:'暂停',exact:true})).toBeDisabled();
});
test('a running read hides previous success and becomes expired after thirty seconds',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');await expect(card(page,'OpenAI').getByText('满足接单条件（Hive 报告）',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=60000;});await page.clock.runFor(11000);await expect(page.getByText('正在核对平台…')).toBeVisible();
 await expect(card(page,'OpenAI').getByText('满足接单条件（Hive 报告）',{exact:true})).toHaveCount(0);await page.clock.runFor(31000);await expect(card(page,'OpenAI').getByRole('button',{name:'暂停',exact:true})).toBeDisabled();
});
test('leaving overview cancels polling and old results cannot repopulate a new manager instance',async({page})=>{
 await fixture(page);await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();await page.clock.install();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.getByRole('button',{name:'重新核对平台'}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.clock.runFor(1500);const count=await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length);await page.clock.fastForward(20000);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls.length)).toBe(count);
 await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='new instance GET HTTP 503';w.emit('replacement');});
 await page.getByRole('button',{name:'概览',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('new instance GET HTTP 503');await expect(card(page,'Claude').getByText('已手动暂停')).toHaveCount(0);
});
test('English platform controls and reason copy are complete at minimum width',async({page})=>{
 await fixture(page);await page.setViewportSize({width:860,height:600});await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(card(page,'OpenAI').getByText('Hive does not see this platform’s Bee connection')).toBeVisible();await expect(card(page,'Claude').getByRole('button',{name:'Resume',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
 await page.getByRole('region',{name:'Platform supply',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'../.cache/device-pairing/supply-en-860.png'});
});
test('unverified devices never issue supply IPC',async({page})=>{
 await fixture(page,{unbound:true});await page.goto('/');await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();await expect(card(page,'OpenAI')).toHaveCount(0);expect(await page.evaluate(()=> (window as unknown as {calls:unknown[]}).calls)).toEqual([]);
});

test('an old in-flight successful read cannot overwrite replacement-instance failure or continue its next platform',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {delay:number}).delay=1000;});await page.getByRole('button',{name:'重新核对平台'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {calls:unknown[]}).calls.length)).toBe(3);
 await page.evaluate(()=>{const w=window as unknown as {emit:(id:string)=>void;delay:number;fail:string};w.delay=0;w.fail='replacement GET HTTP 503';w.emit('replacement');});await expect(card(page,'OpenAI').getByText('尚未核对')).toBeVisible();await page.clock.runFor(1500);
 await expect(page.getByRole('alert').first()).toContainText('replacement GET HTTP 503');await expect(card(page,'OpenAI').getByText('满足接单条件（Hive 报告）',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {calls:{platform:string}[]}).calls.map(c=>c.platform))).toEqual(['openai','claude','openai','openai','claude']);
 expect(await page.evaluate(()=>(window as unknown as {maxActive:number}).maxActive)).toBe(1);
});

test('a delayed expiry timer cannot authorize a write from a stale rendered button',async({page})=>{
 await fixture(page,{ready:true});await page.clock.install();await page.goto('/');const openai=card(page,'OpenAI');await expect(openai.getByRole('button',{name:'暂停',exact:true})).toBeEnabled();
 await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+31000)));await openai.getByRole('button',{name:'暂停',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {calls:{command:string}[]}).calls.filter(c=>c.command==='supply_set_paused').length)).toBe(0);
 await expect(openai.getByText('核对已过期，请重新核对')).toBeVisible();
});

test('manager replacement invalidates device data while preserving this run’s language and navigation',async({page})=>{
 await fixture(page);await page.goto('/');await expect(card(page,'Claude').getByText('已手动暂停')).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await page.evaluate(()=>(window as unknown as {emit:(id:string)=>void}).emit('replacement'));
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByLabel('Language',{exact:true})).toHaveValue('en');
});
