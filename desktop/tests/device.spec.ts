import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const runtime=window as unknown as {isTauri:boolean;__TAURI_INTERNALS__:unknown;deviceStage:string;deviceCalls:string[]};
  (window as unknown as {__TAURI_EVENT_PLUGIN_INTERNALS__:unknown}).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  runtime.isTauri=true;runtime.deviceStage='unbound';runtime.deviceCalls=[];
  let callback=1;const callbacks=new Map<number,(value:unknown)=>void>();
  runtime.__TAURI_INTERNALS__={transformCallback:(fn:(value:unknown)=>void)=>{const id=callback++;callbacks.set(id,fn);return id;},unregisterCallback:()=>{},invoke:async(command:string,args?:{handler:number})=>{
   runtime.deviceCalls.push(command);
   if(command==='plugin:event|listen') {if(location.search.includes('stale-status'))setTimeout(()=>callbacks.get(args!.handler)?.({payload:{state:'ready',metadata:{bee_version:'fixture',os:'darwin',arch:'arm64',instance:'fixture'}}}),20);return 1;}
   if(command==='plugin:event|unlisten')return;
   if(command==='bridge_status'&&location.search.includes('stale-status'))return new Promise((_,reject)=>setTimeout(()=>{(window as unknown as {initialRejected:boolean}).initialRejected=true;reject(new Error('old status read failed'));},100));
   if(command==='bridge_status')return {state:'ready',metadata:{bee_version:'fixture',os:'darwin',arch:'arm64',instance:'fixture'}};
   if(command==='device_begin')runtime.deviceStage='pending';
   if(command==='device_status'||command==='device_begin'||command==='device_open'){
    const delay=(window as unknown as {deviceDelay?:number}).deviceDelay;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(runtime.deviceStage==='error')return {result:{error:{code:'DEVICE_OPERATION_FAILED',message:'GET /api/bee/identity HTTP 503'}}};
    const device=runtime.deviceStage==='unbound'?{state:'unbound'}:runtime.deviceStage==='bound'?{state:'bound',hive:'https://hive.example',name:'My Mac',identity:{id:'device-1',name:'My Mac',owner_id:'owner-1',owner_email:'real@example.test'}}:{state:'pending',hive:'https://hive.example',name:'My Mac',user_code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:new Date(Date.now()+60000).toISOString(),poll_interval_seconds:1};
    return {result:{device}};
   }
   throw new Error('unexpected IPC '+command);
  }};
 });
});
test('normal native build pairs and verifies without demo balances or starting supply',async({page})=>{
 await page.setViewportSize({width:860,height:600});await page.goto('/');
 await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
 await expect(page.getByText('演示数据',{exact:true})).toHaveCount(0);
 await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByLabel('设备名称',{exact:true}).fill('My Mac');
 await page.getByRole('button',{name:'生成配对码'}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await expect(page.getByText('完成网页确认后，请回到 Bee。')).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await expect(page.getByText('real@example.test',{exact:true})).toBeVisible({timeout:10000});
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toBeVisible();
 await page.getByRole('button',{name:'收益',exact:true}).click();
 await expect(page.getByText('真实收益尚未接通。')).toBeVisible();
 expect(await page.evaluate(()=> (window as unknown as {deviceCalls:string[]}).deviceCalls.some(c=>/start|supply|run/.test(c)))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('failed verification blocks success and remains retryable',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByRole('alert')).toContainText('HTTP 503');
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
});

test('retrying a failed bound-device check does not revive cached success',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'重新核对设备'})).toBeEnabled();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='error';});
 await page.getByRole('button',{name:'重新核对设备'}).click();await expect(page.getByRole('alert')).toContainText('HTTP 503');
 await page.evaluate(()=>{(window as unknown as {deviceStage:string;deviceDelay:number}).deviceStage='bound';(window as unknown as {deviceDelay:number}).deviceDelay=500;});
 await page.getByRole('button',{name:'重新核对设备'}).click();
 await expect(page.getByText('正在核对设备…')).toBeVisible();
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toHaveCount(0);
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toBeVisible();
});

test('an old native status rejection cannot overwrite a newer ready event',async({page})=>{
 await page.goto('/?fixture=stale-status');
 await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {initialRejected:boolean}).initialRejected))).toBe(true);
 await expect(page.getByRole('heading',{name:'连接本机设备'})).toBeVisible();
});

test('opening after website confirmation consumes the latest bound result',async({page})=>{
 await page.goto('/');await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.getByRole('button',{name:'生成配对码'}).click();await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {deviceStage:string}).deviceStage='bound';});
 await page.getByRole('button',{name:'打开 Hive 确认网页'}).click();
 await expect(page.getByText('设备已绑定，尚未开始贡献。')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('English device entry and settings have complete translations',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
 await expect(page.getByText('Device binding does not automatically start contribution')).toBeVisible();
 await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'Connect this device'})).toBeVisible();
 expect(await page.evaluate(async()=>[...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
});
