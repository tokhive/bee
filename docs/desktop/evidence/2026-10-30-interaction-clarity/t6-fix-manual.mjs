const fs=await import('node:fs/promises'),task=await taskSpace(36),page=task.page('p1');
const base='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity',records=[];
for(const [locale,theme] of [['zh','light'],['en','dark']]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
 await page.goto(`http://127.0.0.1:1421/tests/fixtures/bee-preview/app.html?scene=recovery-completed&locale=${locale}&theme=${theme}`);
 await page.waitForSelector('.pairing-phase');
 const before=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],phase:document.querySelector('.pairing-phase').textContent,nextStep:document.querySelector('.preparation-steps')?.textContent,devicePreparationButtons:[...document.querySelectorAll('.device-pairing button')].map(b=>b.textContent)}));
 await page.evaluate(()=>{const w=window,a=w.accounts.openai;a.revision++;a.selection={state:'selected',fingerprint:'b'.repeat(64),observed_at:new Date().toISOString(),error:null};const invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command,args)=>{const reply=await invoke(command,args);if(command==='runtime_snapshot'){Object.assign(reply.result.runtime,{local:'running',run_id:'a'.repeat(32),connection:'connected',revision:100});}return reply;};});
 await page.click(`loc=role:button[name='${locale==='zh'?'重新核对设备':'Verify device again'}']`);
 await page.waitForFunction(()=>!document.querySelector('.preparation-steps')&&document.querySelector('.native-runtime-title h2')?.textContent!== (document.documentElement.lang==='en'?'No AI accounts connected':'尚未接入 AI 账号'));
 await page.screenshot({path:`${base}/t6-fix-history-running-860-${locale}-${theme}.png`});
 const running=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],locale:document.documentElement.lang,theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,runtime:document.querySelector('.native-runtime-title h2').textContent,phase:document.querySelector('.pairing-phase').textContent,nextStep:!!document.querySelector('.preparation-steps'),devicePreparationButtons:[...document.querySelectorAll('.device-pairing button')].map(b=>b.textContent),writes:window.calls.filter(c=>['device_recovery_prepare','device_recovery_confirm','runtime_start','account_action','supply_set_paused'].includes(c.command))}));
 await page.evaluate(()=>{const w=window,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command,args)=>command==='device_status'?{result:{error:{code:'device_replaced',message:'GET identity HTTP 401 device_replaced; current recovered identity revoked'}}}:invoke(command,args);});
 await page.click(`loc=role:button[name='${locale==='zh'?'重新核对设备':'Verify device again'}']`);
 await page.waitForSelector(`loc=role:button[name='${locale==='zh'?'重新绑定设备':'Rebind this device'}']`);
 await page.click(`loc=role:button[name='${locale==='zh'?'重新绑定设备':'Rebind this device'}']`);
 await page.screenshot({path:`${base}/t6-fix-repeat-confirm-860-${locale}-${theme}.png`});
 await page.keyboard.press('Escape');
 const cancelled=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],focused:document.activeElement.textContent,dialog:!!document.querySelector('[role=dialog]'),writes:window.calls.filter(c=>['device_recovery_prepare','device_recovery_confirm'].includes(c.command))}));
 records.push({locale,theme,utc:new Date().toISOString(),before,running,cancelled});
}
await fs.writeFile(base+'/t6-fix-manual.json',JSON.stringify({utc:new Date().toISOString(),runtime:process.version,space:36,page:'p1',records},null,2));console.log(JSON.stringify(records,null,2));
