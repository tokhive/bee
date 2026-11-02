const fs=await import('node:fs/promises');
const E='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity';
const task=await taskSpace(42),page=task.page('p1'),result={spaceId:42,layer:'正式 NativeApp＋模拟 IPC；不证明真实包校验、退出、安装或原生恢复',states:[]};
for(const name of ['protocol','integrity'])for(const locale of ['zh','en']){
 const theme=locale==='zh'?'light':'dark',id=name+'-'+locale+'-'+theme;
 if(name!=='protocol'||locale!=='zh')await page.goto('http://127.0.0.1:1519/?'+new URLSearchParams({case:name,locale,theme}));
 await page.waitForFunction(({locale,theme})=>document.documentElement.lang===locale&&document.documentElement.dataset.theme===theme&&document.querySelector('main .problem-notice'),{locale,theme});
 const entry=await page.evaluate(()=>{const n=document.querySelector('main .problem-notice');return {code:window.t10Fix2Failure.code,message:window.t10Fix2Failure.message,summary:n.querySelector('p').textContent,impact:n.querySelectorAll('p')[1].textContent,summaryRect:n.querySelector('p').getBoundingClientRect().toJSON(),impactRect:n.querySelectorAll('p')[1].getBoundingClientRect().toJSON(),width:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,actionButtons:n.querySelectorAll('button').length};});
 if(entry.width!==860||entry.viewport.height!==600||!entry.reducedMotion||entry.actionButtons!==0||entry.summaryRect.top<52||entry.impactRect.bottom>571)throw Error('S05 layout/gate mismatch '+JSON.stringify(entry));
 if(!entry.summary.includes(name==='protocol'?(locale==='zh'?'协议':'protocol'):(locale==='zh'?'完整性':'integrity'))||!entry.impact.includes(locale==='zh'?'原生操作保持受阻':'Native operations remain blocked')||!entry.impact.includes(locale==='zh'?'应用菜单退出 Bee':'Quit Bee from the app menu')||!entry.impact.includes(locale==='zh'?'可信来源':'trusted source'))throw Error('S05 localized recovery copy mismatch '+JSON.stringify(entry));
 await page.screenshot({path:E+'/t10-fix2-ego-'+id+'-entry.png'});
 await page.focus('loc=css:main .problem-notice summary');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('main .problem-notice details').open);
 const expanded=await page.evaluate(()=>{const n=document.querySelector('main .problem-notice'),s=n.querySelector('summary');return {text:n.innerText,focused:document.activeElement===s,focusRect:s.getBoundingClientRect().toJSON(),focusOutline:getComputedStyle(s).outline,detailsOpen:n.querySelector('details').open,calls:window.calls,mainButtonNames:[...document.querySelectorAll('main button')].map(e=>e.textContent.trim())};});
 if(!expanded.focused||!expanded.detailsOpen||!expanded.text.includes(entry.message)||!expanded.text.includes(entry.code)||expanded.text.includes('FAILURE_DETAILS_INVALID')||expanded.mainButtonNames.some(n=>/开始贡献|Start contributing/.test(n)))throw Error('S05 details/gate mismatch '+JSON.stringify(expanded));
 if(expanded.calls.some(c=>['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','authorize_cancel','supply_set_paused','network_apply_saved','preferences_save','runtime_snapshot','account_snapshot','account_detect','device_status','supply_status','startup_recheck'].includes(c.command)))throw Error('S05 native gate allowed a command '+JSON.stringify(expanded.calls));
 await page.screenshot({path:E+'/t10-fix2-ego-'+id+'-details.png'});
 result.states.push({id,entry,expanded});
}
await fs.writeFile(E+'/t10-fix2-ego-result.json',JSON.stringify({...result,observed_at:new Date().toISOString()},null,2));
console.log(JSON.stringify(result));console.log(await page.snapshot());
