const fs=await import('node:fs/promises');
const base='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity';
const task=await taskSpace(36),page=task.page('p1');
const records=[];
for(const c of [
 {scene:'device-pending',width:1000,height:700,locale:'en',theme:'dark',long:true,device:true},
 {scene:'recovery-owner',width:860,height:600,locale:'zh',theme:'light',long:true,device:true},
 {scene:'recovery-saving',width:1080,height:840,locale:'en',theme:'dark',long:true,device:true},
]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:c.width,height:c.height,deviceScaleFactor:1,mobile:false});
 await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await page.goto(`http://127.0.0.1:1421/tests/fixtures/bee-preview/app.html?scene=${c.scene}&locale=${c.locale}&theme=${c.theme}${c.long?'&long=1':''}`);
 await page.waitForFunction(()=>window.__beePreviewReady&&!window.__beePreviewError&&document.querySelector('.pairing-phase'),undefined,{timeout:15000});
 await page.evaluate(()=>document.querySelector('.device-pairing').scrollIntoView({block:'start'}));
 const metrics=await page.evaluate(()=>{
  const rgba=v=>v.match(/[\d.]+/g)?.map(Number),back=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor,a=rgba(c);if(a&&a[3]!==0)return c;}return 'rgb(255,255,255)';};
  const lum=c=>{const a=rgba(c).slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
  const measure=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect(),bg=back(e),l=[lum(s.color),lum(bg)].sort((a,b)=>b-a);return {text:e.textContent.trim(),rect:{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom},font:s.fontSize,color:s.color,background:bg,contrast:Math.round((l[0]+.05)/(l[1]+.05)*100)/100,opacity:s.opacity};};
  return {utc:new Date().toISOString(),viewport:[innerWidth,innerHeight],lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,overflow:{document:document.documentElement.scrollWidth>innerWidth,device:document.querySelector('.device-pairing').scrollWidth>document.querySelector('.device-pairing').clientWidth},status:document.querySelector('.app-shell').dataset.desktopStatus,phase:measure(document.querySelector('.pairing-phase')),primary:measure(document.querySelector('.device-transaction-heading button')),note:measure(document.querySelector('.device-note')),url:measure(document.querySelector('.device-url')),writes:window.calls.filter(c=>['device_recovery_prepare','device_recovery_confirm','device_begin','account_action','runtime_start','supply_set_paused'].includes(c.command))};
 });
 const path=`${base}/t6-manual-${c.scene}-${c.width}-${c.locale}-${c.theme}.png`;
 await page.screenshot({path});records.push({case:c,metrics,screenshot:path});
}
await fs.writeFile(`${base}/t6-manual-round1.json`,JSON.stringify({utc:new Date().toISOString(),runtime:process.version,space:36,page:'p1',script:'/tmp/t6-manual-round1.mjs',records},null,2));
console.log(JSON.stringify(records,null,2));
