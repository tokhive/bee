const fs = await import('node:fs/promises');
const root = '/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/.superpowers/sdd';
const task = await taskSpace(40), page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.goto('http://127.0.0.1:1421/tests/fixtures/bee-preview/app.html?scene=stopped&locale=zh&theme=dark&long');
await page.waitForFunction(()=>window.__beePreviewReady===true);
await page.click('loc=role:button[name="设置"]', {label:'open system settings'});
await page.click('loc=role:tab[name="通知与启动"]', {label:'inspect notification startup settings'});
await page.waitForFunction(()=>document.querySelectorAll('.ns-os-status')[1]?.textContent.includes('未登记'));
const before = await page.evaluate(()=>({checked:document.querySelectorAll('.ns-check input')[1].checked,disabled:document.querySelectorAll('.ns-check input')[1].disabled,registration:document.querySelectorAll('.ns-os-status')[1].textContent,calls:window.calls.filter(c=>c.command.startsWith('autostart_'))}));
await page.evaluate(()=>{
 const w=window,invoke=w.__TAURI_INTERNALS__.invoke;w.t8FixReadMode='failure';w.t8FixSetStarted=false;
 w.__TAURI_INTERNALS__.invoke=async(command,args)=>{
  const value=await invoke(command,args);
  if(command==='autostart_set'){w.t8FixSetStarted=true;throw {code:'IPC_TIMEOUT',message:'autostart accepted; receipt lost: enabled=true'};}
  if(command==='autostart_status'&&w.t8FixSetStarted){
   if(w.t8FixReadMode==='trusted')return {desired:true,registered:true,error:null};
   return {desired:false,registered:null,error:{code:'AUTOSTART_QUERY_FAILED',message:'autostart query failed: kind=PermissionDenied os_code=13'}};
  }
  return value;
 };
});
await page.click('loc=css:.ns-check input >> nth=1', {label:'choose startup preference'});
await page.waitForFunction(()=>document.querySelectorAll('.ns-check input')[1]?.disabled&&document.querySelector('[data-settings-section=notifications]')?.textContent.includes('IPC_TIMEOUT'));
const after = await page.evaluate(()=>({checked:document.querySelectorAll('.ns-check input')[1].checked,disabled:document.querySelectorAll('.ns-check input')[1].disabled,text:document.querySelector('[data-settings-section=notifications]').textContent,calls:window.calls.filter(c=>c.command.startsWith('autostart_')),viewport:{width:innerWidth,height:innerHeight}}));
await fs.writeFile(root+'/t8-fix-manual-01.json',JSON.stringify({utc:new Date().toISOString(),space:40,page:'p1',mode:'formal NativeApp with simulated IPC; no real OS registration',before,after},null,2));
await page.screenshot({path:root+'/t8-fix-manual-01-unknown-write-zh-dark-860.png'});
console.log({before,after});
console.log(await page.snapshot());
