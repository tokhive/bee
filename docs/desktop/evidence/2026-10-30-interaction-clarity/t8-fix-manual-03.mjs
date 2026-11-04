const fs = await import('node:fs/promises');
const root = '/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.superpowers/sdd';
const task = await taskSpace(40), page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.click('loc=role:button[name="概览"]', {label:'leave pending startup settings'});
await page.click('loc=role:button[name="设置"]', {label:'return to startup settings'});
await page.click('loc=role:tab[name="通用"]', {label:'open language preference'});
await page.selectOption('#ns-language','en');
await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Settings');
await page.click('loc=role:tab[name="Notifications and startup"]', {label:'return to startup state'});
await page.evaluate(()=>{
 const w=window,invoke=w.__TAURI_INTERNALS__.invoke;
 w.__TAURI_INTERNALS__.invoke=async(command,args)=>{const value=await invoke(command,args);if(command==='preferences_read')value.preferences.language='en';return value;};
});
await page.click('loc=role:button[name="Recheck system status"]', {label:'read registration without writing'});
await page.waitForFunction(()=>document.querySelector('[data-settings-section=notifications]')?.querySelectorAll('[role=alert]').length===2);
const state = await page.evaluate(()=>{
 const section=document.querySelector('[data-settings-section=notifications]'),input=document.querySelectorAll('.ns-check input')[1];
 return {checked:input.checked,disabled:input.disabled,registration:document.querySelectorAll('.ns-os-status')[1].textContent,text:section.textContent,alerts:section.querySelectorAll('[role=alert]').length,calls:window.calls.filter(c=>c.command.startsWith('autostart_')),viewport:{width:innerWidth,height:innerHeight},focus:document.activeElement?.textContent,overflow:document.documentElement.scrollWidth>innerWidth};
});
if(!state.checked||!state.disabled||state.alerts!==2||state.text.includes('differs')||state.calls.filter(c=>c.command==='autostart_set').length!==1)throw new Error('manual navigation/language read replayed or lost unknown write: '+JSON.stringify(state));
const path=root+'/t8-fix-manual-03-failed-read-en-dark-860.png';
await page.screenshot({path});
const bytes=await fs.readFile(path),imageSize={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
await fs.writeFile(root+'/t8-fix-manual-03.json',JSON.stringify({utc:new Date().toISOString(),space:40,page:'p1',state,screenshot:{path,imageSize}},null,2));
console.log({state,imageSize});
console.log(await page.snapshot());
