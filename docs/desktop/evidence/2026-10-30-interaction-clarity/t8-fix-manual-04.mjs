const fs = await import('node:fs/promises');
const root = '/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.superpowers/sdd';
const task = await taskSpace(40), page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.evaluate(()=>{window.t8FixReadMode='trusted';});
await page.click('loc=role:button[name="Recheck system status"]', {label:'confirm current registration read'});
await page.waitForFunction(()=>!document.querySelectorAll('.ns-check input')[1]?.disabled&&document.querySelector('[data-settings-section=notifications]')?.querySelectorAll('[role=alert]').length===0);
await page.keyboard.press('Shift+Tab');
const state = await page.evaluate(()=>{
 const section=document.querySelector('[data-settings-section=notifications]'),input=document.querySelectorAll('.ns-check input')[1],rect=input.getBoundingClientRect();
 return {checked:input.checked,disabled:input.disabled,registration:document.querySelectorAll('.ns-os-status')[1].textContent,text:section.textContent,alerts:section.querySelectorAll('[role=alert]').length,calls:window.calls.filter(c=>c.command.startsWith('autostart_')),viewport:{width:innerWidth,height:innerHeight},keyboardFocusOnStartup:document.activeElement===input,focusVisible:rect.top>=52&&rect.bottom<innerHeight-29,overflow:document.documentElement.scrollWidth>innerWidth};
});
if(!state.checked||state.disabled||state.alerts!==0||!state.keyboardFocusOnStartup||state.text.includes('unconfirmed')||state.calls.filter(c=>c.command==='autostart_set').length!==1)throw new Error('manual trusted read failed to resolve without replay: '+JSON.stringify(state));
const path=root+'/t8-fix-manual-04-trusted-result-en-dark-860.png';
await page.screenshot({path});
const bytes=await fs.readFile(path),imageSize={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
await fs.writeFile(root+'/t8-fix-manual-04.json',JSON.stringify({utc:new Date().toISOString(),space:40,page:'p1',state,screenshot:{path,imageSize}},null,2));
console.log({state,imageSize});
console.log(await page.snapshot());
