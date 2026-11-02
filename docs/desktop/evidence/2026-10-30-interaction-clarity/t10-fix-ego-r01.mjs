const fs=await import('node:fs/promises');
const E='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity';
const task=await taskSpace(41),page=task.page('p1'),result={spaceId:41,observed_at:new Date().toISOString(),states:[]};
await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
for(const scene of ['runtime-accounts-unconfirmed','runtime-no-accounts']){
 await page.goto('http://127.0.0.1:1519/tests/fixtures/bee-preview/app.html?scene='+scene+'&locale=zh&theme=light');
 await page.waitForFunction(()=>window.__beePreviewReady||window.__beePreviewError);
 await page.waitForFunction(scene=>document.body.innerText.includes(scene==='runtime-accounts-unconfirmed'?'接入数量待确认':'0 个已接入'),scene);
 const facts=await page.evaluate(()=>({scene:window.__beePreviewScene,width:document.documentElement.scrollWidth,body:document.querySelector('main').innerText,start:[...document.querySelectorAll('main button')].filter(e=>e.textContent.trim()==='开始贡献').map(e=>({disabled:e.disabled,describedBy:e.getAttribute('aria-describedby')})),calls:window.calls}));
 if(facts.width!==860||facts.start.length!==1||!facts.start[0].disabled)throw Error('R01 manual precondition failed: '+JSON.stringify(facts));
 if(scene==='runtime-accounts-unconfirmed'&&facts.body.includes('0 个已接入'))throw Error('Unknown account facts rendered zero');
 await page.screenshot({path:E+'/t10-fix-ego-'+scene+'.png'});
 await page.click('loc=role:button[name="AI 账号"]',{label:'打开账号准备入口'});
 await page.waitForFunction(()=>document.querySelector('main h1')?.textContent==='AI 账号');
 const navigation=await page.evaluate(()=>({heading:document.querySelector('main h1')?.textContent,focused:document.activeElement===document.querySelector('main h1'),writes:window.calls.filter(c=>/^(runtime_start|runtime_stop|account_action|authorize_start|supply_set_paused|device_begin)$/.test(c.command))}));
 if(!navigation.focused||navigation.writes.length)throw Error('R01 navigation changed write/focus contract: '+JSON.stringify(navigation));
 result.states.push({facts,navigation});
}
await fs.writeFile(E+'/t10-fix-ego-r01-result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
console.log(await page.snapshot());
