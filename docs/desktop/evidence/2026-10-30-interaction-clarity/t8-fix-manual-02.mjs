const fs = await import('node:fs/promises');
const root = '/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.superpowers/sdd';
const task = await taskSpace(40), page = task.page('p1');
await page.click('loc=role:button[name="重新检查系统状态"]', {label:'read current system registration'});
await page.waitForFunction(()=>document.querySelector('[data-settings-section=notifications]')?.textContent.includes('AUTOSTART_QUERY_FAILED'));
const state = await page.evaluate(()=>{
 const section=document.querySelector('[data-settings-section=notifications]'),input=document.querySelectorAll('.ns-check input')[1];
 return {checked:input.checked,disabled:input.disabled,registration:document.querySelectorAll('.ns-os-status')[1].textContent,text:section.textContent,alerts:section.querySelectorAll('[role=alert]').length,calls:window.calls.filter(c=>c.command.startsWith('autostart_')),focus:document.activeElement?.textContent,overflow:document.documentElement.scrollWidth>innerWidth};
});
if(!state.checked||!state.disabled||state.alerts!==2||state.text.includes('不一致')||state.calls.filter(c=>c.command==='autostart_set').length!==1)throw new Error('manual null/error read violated the unknown-write boundary: '+JSON.stringify(state));
await fs.writeFile(root+'/t8-fix-manual-02.json',JSON.stringify({utc:new Date().toISOString(),space:40,page:'p1',state},null,2));
await page.screenshot({path:root+'/t8-fix-manual-02-null-error-read-zh-dark-860.png'});
console.log(state);
console.log(await page.snapshot());
