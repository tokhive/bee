const fs=await import('node:fs/promises');
const E='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity';
const task=await taskSpace(42),page=task.page('p1'),result={spaceId:42,layer:'正式 NativeApp＋模拟 IPC；不证明真实包校验、退出、安装或原生恢复',states:[]};
await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const B='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0';
const fixture=(await fs.readFile(B+'/desktop/tests/fixtures/native-accounts.mjs','utf8')).replaceAll('export ','');
const init=fixture+`
installAccountFixture({runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
const params=new URLSearchParams(location.search),code=params.get('case')==='integrity'?'BUNDLED_BEE_INVALID':'VERSION_MISMATCH';
const message=code==='VERSION_MISMATCH'?'reply protocol=2; required=1':'bundled Bee SHA256 mismatch at /isolated/qa/bee: actual='+'a'.repeat(64)+'; required='+'b'.repeat(64);
const original=window.__TAURI_INTERNALS__.invoke;
window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
 if(command==='bridge_status'){window.calls.push({command,args});return {state:'failed',error:{code,message}};}
 const reply=await original(command,args);
 if(command==='preferences_read'){reply.preferences.language=params.get('locale')==='en'?'en':'zh';reply.preferences.theme=params.get('theme')==='dark'?'dark':'light';}
 return reply;
};
window.t10Fix2Failure={code,message};
`;
console.log(await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:init}));
for(const name of ['protocol','integrity'])for(const locale of ['zh','en']){
 const theme=locale==='zh'?'light':'dark',id=name+'-'+locale+'-'+theme;
 await page.goto('http://127.0.0.1:1519/?'+new URLSearchParams({case:name,locale,theme}));
 await page.waitForFunction(({locale,theme})=>document.documentElement.lang===locale&&document.documentElement.dataset.theme===theme&&document.querySelector('main .problem-notice'),{locale,theme});
 const entry=await page.evaluate(()=>{const n=document.querySelector('main .problem-notice');return {code:window.t10Fix2Failure.code,message:window.t10Fix2Failure.message,summary:n.querySelector('p').textContent,impact:n.querySelectorAll('p')[1].textContent,summaryRect:n.querySelector('p').getBoundingClientRect().toJSON(),impactRect:n.querySelectorAll('p')[1].getBoundingClientRect().toJSON(),width:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,actionButtons:n.querySelectorAll('button').length};});
 if(entry.width!==860||entry.viewport.height!==600||!entry.reducedMotion||entry.actionButtons!==0||entry.summaryRect.top<52||entry.impactRect.bottom>571)throw Error('S05 layout/gate mismatch '+JSON.stringify(entry));
 if(!entry.summary.includes(name==='protocol'?(locale==='zh'?'协议':'protocol'):(locale==='zh'?'完整性':'integrity'))||!entry.impact.includes(locale==='zh'?'原生操作保持受阻':'Native operations remain blocked')||!entry.impact.includes(locale==='zh'?'应用菜单退出 Bee':'Quit Bee from the app menu')||!entry.impact.includes(locale==='zh'?'可信来源':'trusted source'))throw Error('S05 localized recovery copy mismatch '+JSON.stringify(entry));
 await page.screenshot({path:E+'/t10-fix2-ego-v3-'+id+'-entry.png'});
 await page.focus('loc=css:main .problem-notice summary');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('main .problem-notice details').open);
 const expanded=await page.evaluate(()=>{const n=document.querySelector('main .problem-notice'),s=n.querySelector('summary');return {text:n.innerText,focused:document.activeElement===s,focusRect:s.getBoundingClientRect().toJSON(),focusOutline:getComputedStyle(s).outline,detailsOpen:n.querySelector('details').open,calls:window.calls,mainButtonNames:[...document.querySelectorAll('main button')].map(e=>e.textContent.trim())};});
 if(!expanded.focused||!expanded.detailsOpen||!expanded.text.includes(entry.message)||!expanded.text.includes(entry.code)||expanded.text.includes('FAILURE_DETAILS_INVALID')||expanded.mainButtonNames.some(n=>/开始贡献|Start contributing/.test(n)))throw Error('S05 details/gate mismatch '+JSON.stringify(expanded));
 if(expanded.calls.some(c=>['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save','runtime_snapshot','account_snapshot','account_detect','device_status','supply_status','startup_recheck'].includes(c.command)))throw Error('S05 native gate allowed a command '+JSON.stringify(expanded.calls));
 await page.screenshot({path:E+'/t10-fix2-ego-v3-'+id+'-details.png'});
 result.states.push({id,entry,expanded});
}
await fs.writeFile(E+'/t10-fix2-ego-v3-result.json',JSON.stringify({...result,observed_at:new Date().toISOString()},null,2));
console.log(JSON.stringify(result));console.log(await page.snapshot());
