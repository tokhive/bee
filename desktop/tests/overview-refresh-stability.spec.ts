import {test,expect,type Page} from '@playwright/test';

async function scene(page:Page,id:string,locale='zh',width=1200){
 await page.setViewportSize({width,height:600});
 await page.clock.install();
 await page.goto(`/tests/fixtures/bee-preview/app.html?scene=${id}&locale=${locale}&theme=${locale==='en'?'dark':'light'}`);
 await page.waitForFunction(()=>Boolean((window as any).__beePreviewReady));
}
async function hold(page:Page,command:string,platform?:string){
 await page.evaluate(({command,platform})=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.refreshHeld=false;
  w.__TAURI_INTERNALS__.invoke=async(name:string,args:any)=>{
   if(name==='startup_recheck')w.manualRechecks=(w.manualRechecks??0)+1;
   if(name===command&&(!platform||args?.platform===platform)){
    w.refreshHeld=true;await new Promise<void>(resolve=>w.releaseRefresh=resolve);
    w.__TAURI_INTERNALS__.invoke=invoke;
    if(w.failRefresh){
     if(command==='account_snapshot'||command==='supply_status')throw {code:'http_rejected',message:`GET ${command} fixture HTTP 503`,details:{check:command==='account_snapshot'?'account_read':'supply_read',observed_at:new Date().toISOString(),evidence:{http_status:'503',failure_kind:'http_rejected'}}};
     throw new Error(`GET ${command} fixture HTTP 503`);
    }
   }
   return invoke(name,args);
  };
 },{command,platform});
}
async function settled(page:Page){
 await expect.poll(()=>page.evaluate(()=>!document.querySelector('.device-section-heading button:disabled'))).toBe(true);
 // The final platform read is the end of the coordinated read, after React publishes it.
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command==='runtime_snapshot').length)).toBeGreaterThan(0);
}
async function position(page:Page){
 return page.evaluate(()=>{
  const main=document.querySelector('main')!;
  const boxes=[...document.querySelectorAll('.native-runtime-summary,.native-runtime-row button,.native-device-summary,.device-section-heading button,.native-account-row,.native-account-row-actions button')].map(el=>{
   const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  });
  return {boxes,scrollTop:main.scrollTop,scrollHeight:main.scrollHeight};
 });
}
async function focusAndScroll(page:Page){
 await page.locator('.device-section-heading button').evaluate((el:HTMLButtonElement)=>{
  el.focus({preventScroll:true});document.querySelector('main')!.scrollTop=87;
 });
}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
async function noWrites(page:Page){
 for(const name of ['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','supply_set_paused'])expect(await calls(page,name),name).toHaveLength(0);
}

for(const [locale,width] of [['zh',1200],['en',860]] as const){
 for(const [id,command] of [['device-error','device_status'],['recovery-pending','device_recovery_status']] as const){
  test(`saved device context stays still across three ${command} reads (${locale}, ${width})`,async({page})=>{
   await scene(page,id,locale,width);await settled(page);
   await expect(page.locator('.saved-device-context')).toBeVisible();
   await focusAndScroll(page);const before=await position(page);
   expect(before.scrollTop).toBeGreaterThan(0);
   for(let round=0;round<3;round++){
    await hold(page,command);await page.clock.runFor(id==='recovery-pending'?2100:10100);
    await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
    expect(await position(page)).toEqual(before);
    await expect(page.locator('.device-section-heading button')).toBeFocused();
    await expect(page.locator('.device-section-heading button')).toBeEnabled();
    await expect(page.locator('.device-note[role=status]')).toHaveCount(0);
    await page.evaluate(()=>(window as any).releaseRefresh());
    await settled(page);expect(await position(page)).toEqual(before);
   }
   await noWrites(page);
  });
 }
 for(const command of ['account_snapshot','supply_status']){
  test(`valid account facts stay still across three ${command} reads (${locale}, ${width})`,async({page})=>{
   await scene(page,'running',locale,width);await expect(page.locator('[data-account-platform=openai] .native-account-row-actions button')).toBeEnabled();
   await focusAndScroll(page);const before=await position(page);
   for(let round=0;round<3;round++){
    await hold(page,command,'openai');await page.clock.runFor(10100);
    await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
    expect(await position(page)).toEqual(before);await expect(page.locator('.device-section-heading button')).toBeFocused();
    await expect(page.locator('[data-account-platform=openai] .native-account-row-actions button')).toBeEnabled();
    await expect(page.locator('.account-check-status')).toHaveCount(0);
    await expect(page.locator('.device-loading')).toHaveCount(0);
    await page.evaluate(()=>(window as any).releaseRefresh());await settled(page);
    expect(await position(page)).toEqual(before);
   }
   await noWrites(page);
  });
 }
 test(`manual device recheck uses the existing button and keeps confirmed facts (${locale}, ${width})`,async({page})=>{
  await scene(page,'stopped',locale,width);const button=page.locator('.device-section-heading button');await expect(button).toBeEnabled();
  await focusAndScroll(page);const before=await position(page),identity=await page.locator('.device-facts').innerText();
  await hold(page,'device_status');await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
  await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
  await expect(button).toBeDisabled();await expect(button).toHaveAttribute('aria-busy','true');
  await button.evaluate((el:HTMLButtonElement)=>el.click());await page.keyboard.press('Enter');
  expect(await position(page)).toEqual(before);expect(await page.locator('.device-facts').innerText()).toBe(identity);
  await expect(button).toBeFocused();await expect(page.locator('.device-note[role=status]')).toHaveCount(0);
  await expect(button.locator('svg')).toHaveClass(/device-refreshing/);
  if(locale==='en'){
   await page.emulateMedia({reducedMotion:'reduce'});
   expect(await button.locator('svg').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  }
  await page.evaluate(()=>(window as any).releaseRefresh());await expect(button).toBeEnabled();await expect(button).toHaveAttribute('aria-busy','false');
  expect(await position(page)).toEqual(before);expect(await page.evaluate(()=>(window as any).manualRechecks)).toBe(1);await noWrites(page);
 });
}

test('manual recheck joins an in-flight background read once without hiding its failure',async({page})=>{
 await scene(page,'device-error');await settled(page);await hold(page,'device_status');await page.clock.runFor(10100);
 await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 const button=page.locator('.device-section-heading button');await expect(button).toBeEnabled();
 const evidence=page.locator('.native-device-summary .problem-notice');const before=await position(page),copy=await evidence.innerText();
 await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(button).toHaveAttribute('aria-busy','true');
 expect(await evidence.innerText()).toBe(copy);expect(await position(page)).toEqual(before);
 await page.evaluate(()=>(window as any).releaseRefresh());await expect(button).toBeEnabled();expect(await page.evaluate(()=>(window as any).manualRechecks)).toBe(1);await noWrites(page);
});

test('a startup checking event hides stale account actions until its ready readback',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any,callbacks=new Map();let internals:any;
  Object.defineProperty(w,'__TAURI_INTERNALS__',{configurable:true,get:()=>internals,set:value=>{
   internals=new Proxy(value,{get(target,key){
    if(key==='transformCallback')return (callback:any)=>{const id=target[key](callback);callbacks.set(id,callback);return id;};
    if(key!=='invoke')return target[key];const invoke=target[key];
    return (command:string,args:any)=>{
     if(command==='plugin:event|listen'&&args.event==='bee://startup-status')w.startupListener=callbacks.get(args.handler);
     return invoke(command,args);
    };
   }});
  }});
 });
 await scene(page,'stopped');await settled(page);await focusAndScroll(page);const before=await position(page);
 await page.evaluate(()=>{
  const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
   const result=await invoke(command,args);
   if(command==='startup_recheck')w.startupListener({payload:{...result,state:'checking'}});
   return result;
  };
 });
 await hold(page,'device_status');const button=page.locator('.device-section-heading button');await button.evaluate((el:HTMLButtonElement)=>el.click());
 await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 await expect(page.getByRole('heading',{name:'正在启动 Bee…',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'平台账号列表',exact:true})).toHaveCount(0);await noWrites(page);
 await page.evaluate(()=>(window as any).releaseRefresh());await expect(button).toBeEnabled();await expect(page.getByRole('region',{name:'平台账号列表',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'正在启动 Bee…',exact:true})).toHaveCount(0);await noWrites(page);
});

test('device failure keeps the last identity during retry and a successful read confirms it again',async({page})=>{
 await scene(page,'stopped');await settled(page);await expect(page.locator('.device-facts small').first()).toHaveText('设备已绑定。');
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.failRefresh=true;w.releaseRefresh();});
 const failure=page.locator('.native-device-summary .problem-notice');await expect(failure).toContainText('GET device_status fixture HTTP 503');
 await expect(page.locator('.device-facts small').first()).toHaveText('上次确认的设备，当前待核对。');
 await expect(page.locator('.device-facts strong').nth(1)).toHaveText('owner@example.test');await expect(page.getByRole('button',{name:'重试准备',exact:true})).toBeDisabled();
 await hold(page,'device_status');await focusAndScroll(page);const before=await position(page),copy=await failure.innerText();
 const button=page.locator('.device-section-heading button');await button.evaluate((el:HTMLButtonElement)=>el.click());
 await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 expect(await failure.innerText()).toBe(copy);expect(await position(page)).toEqual(before);await expect(page.locator('.device-loading')).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.failRefresh=false;w.releaseRefresh();});
 await expect(button).toBeEnabled();await expect(failure).toHaveCount(0);await expect(page.locator('.device-facts small').first()).toHaveText('设备已绑定。');await expect(page.getByRole('button',{name:'重试准备',exact:true})).toBeEnabled();await noWrites(page);
});

test('first device read stays in startup checking and confirmed overview never returns to a skeleton during refresh',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;let internals:any;
  Object.defineProperty(w,'__TAURI_INTERNALS__',{configurable:true,get:()=>internals,set:value=>{
   internals=new Proxy(value,{set(target,key,next){target[key]=next;return true;},get(target,key){
    if(key!=='invoke')return target[key];const invoke=target[key];
    return async(command:string,args:any)=>{
     if(command==='device_status'&&!w.initialDeviceHeld){w.initialDeviceHeld=true;await new Promise<void>(resolve=>w.releaseInitialDevice=resolve);}
     return invoke(command,args);
    };
   }});
  }});
 });
 await scene(page,'running');await expect.poll(()=>page.evaluate(()=>(window as any).initialDeviceHeld)).toBe(true);
 const skeleton=page.locator('.device-loading');await expect(skeleton).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'正在检查设备…',exact:true})).toBeVisible();await expect(page.getByRole('navigation')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'平台账号列表',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).releaseInitialDevice());await expect(page.locator('.device-facts strong').first()).toHaveText('Bee Desktop');
 await expect(skeleton).toHaveCount(0);await focusAndScroll(page);const before=await position(page);
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 await expect(skeleton).toHaveCount(0);await expect(page.locator('.device-facts strong').first()).toHaveText('Bee Desktop');expect(await position(page)).toEqual(before);await page.evaluate(()=>(window as any).releaseRefresh());await noWrites(page);
});

for(const command of ['account_snapshot','supply_status'])test(`${command} failure and historical facts persist during retry, then recover`,async({page})=>{
 await scene(page,'running');const card=page.locator('[data-account-platform=openai]');await expect(card.locator('.native-account-row-actions button')).toBeEnabled();
 await hold(page,command,'openai');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.failRefresh=true;w.releaseRefresh();});
 await card.locator('.account-conditions>summary').click();await card.locator('.account-condition-evidence>summary').click();await expect(card.locator('.account-condition-evidence pre')).toContainText(`GET ${command} fixture HTTP 503`);
 await expect(card.locator('.native-account-fingerprint')).toContainText('bbbbbbbbbbbbbbbb');await expect(card.locator('.quota-value').first()).toContainText('3');
 await expect(card.locator('.native-account-row-actions button')).toBeDisabled();
 const failure=await card.locator('.account-condition-evidence').innerText();
 await hold(page,command,'openai');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 expect(await card.locator('.account-condition-evidence').innerText()).toBe(failure);await expect(card.locator('.native-account-fingerprint')).toContainText('bbbbbbbbbbbbbbbb');await expect(card.locator('.native-account-row-actions button')).toBeDisabled();
 if(command==='account_snapshot'){await expect(card.locator('.native-account-condition')).toContainText('状态待更新');await expect(card.locator('.quota-history')).toContainText(['上次确认的额度；当前待核对。','上次额度观测']);await expect(card.locator('.quota-history time')).toHaveCount(1);}
 await page.evaluate(()=>{const w=window as any;w.failRefresh=false;w.releaseRefresh();});
 await expect(card.locator('.account-condition-evidence')).toHaveCount(0);await expect(card.locator('.native-account-row-actions button')).toBeEnabled();await noWrites(page);
});

test('expiry during a slow refresh still blocks supply writes and marks quota history',async({page})=>{
 await scene(page,'running');const card=page.locator('[data-account-platform=openai]');await expect(card.locator('.native-account-row-actions button')).toBeEnabled();
 await page.evaluate(()=>{const account=(window as any).accounts.openai;account.revision++;account.capabilities[0].valid_until=new Date(Date.now()+15000).toISOString();});
 await page.clock.runFor(10100);await expect.poll(async()=>(await calls(page,'account_snapshot')).filter((c:any)=>c.args.platform==='openai').length).toBeGreaterThan(1);
 await hold(page,'device_status');await page.clock.runFor(10100);await expect.poll(()=>page.evaluate(()=>(window as any).refreshHeld)).toBe(true);
 await page.clock.runFor(30100);await expect(card.locator('.native-account-row-actions button')).toBeDisabled();
 await expect(card.locator('.quota-history')).toContainText(['历史数据，已过期','上次额度观测']);
 await expect(card.locator('.quota-value').first()).toContainText('3');await noWrites(page);await page.evaluate(()=>(window as any).releaseRefresh());
});
