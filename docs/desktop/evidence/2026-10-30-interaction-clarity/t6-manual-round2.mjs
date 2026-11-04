const fs=await import('node:fs/promises');
const base='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity';
const task=await taskSpace(36),page=task.page('p1'),records=[];
for(const c of [
 {scene:'recovery-creation-unknown',width:1000,height:700,locale:'en',theme:'light',device:true},
 {scene:'runtime-disconnected',width:860,height:600,locale:'zh',theme:'dark'},
 {scene:'supply-partial',width:1080,height:840,locale:'en',theme:'light'},
 {scene:'supply-paused',width:1000,height:700,locale:'zh',theme:'light'},
 {scene:'recovery-completed',width:1080,height:840,locale:'en',theme:'light',device:true},
]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:c.width,height:c.height,deviceScaleFactor:1,mobile:false});
 await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await page.goto(`http://127.0.0.1:1421/tests/fixtures/bee-preview/app.html?scene=${c.scene}&locale=${c.locale}&theme=${c.theme}`);
 await page.waitForFunction(()=>window.__beePreviewReady&&!window.__beePreviewError&&document.querySelector('.native-account-row'),undefined,{timeout:15000});
 if(c.device)await page.waitForSelector('.pairing-phase');
 if(c.device)await page.evaluate(()=>document.querySelector('.device-pairing').scrollIntoView({block:'start'}));
 const metrics=await page.evaluate(()=>({utc:new Date().toISOString(),viewport:[innerWidth,innerHeight],lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,overflow:document.documentElement.scrollWidth>innerWidth,status:document.querySelector('.app-shell').dataset.desktopStatus,title:document.querySelector('.native-runtime-title h2').textContent,side:document.querySelector('.desktop-side-status').textContent,phase:document.querySelector('.pairing-phase')?.textContent,preparation:!!document.querySelector('.preparation-steps'),buttons:[...document.querySelectorAll('.native-runtime-row button,.device-transaction button')].map(e=>({text:e.textContent,disabled:e.disabled})),writes:window.calls.filter(c=>['device_recovery_prepare','device_recovery_confirm','device_begin','account_action','runtime_start','supply_set_paused'].includes(c.command))}));
 const path=`${base}/t6-manual-${c.scene}-${c.width}-${c.locale}-${c.theme}.png`;await page.screenshot({path});records.push({case:c,metrics,screenshot:path});
}
await fs.writeFile(`${base}/t6-manual-round2.json`,JSON.stringify({utc:new Date().toISOString(),runtime:process.version,space:36,page:'p1',script:'/tmp/t6-manual-round2.mjs',records},null,2));console.log(JSON.stringify(records,null,2));
