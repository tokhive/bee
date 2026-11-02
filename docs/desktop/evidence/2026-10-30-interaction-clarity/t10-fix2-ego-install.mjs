const fs=await import('node:fs/promises');
const B='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0';
const task=await taskSpace(42),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
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
await page.goto('http://127.0.0.1:1519/?case=protocol&locale=zh&theme=light');
await page.waitForFunction(()=>document.querySelector('main .problem-notice')?.textContent.includes('VERSION_MISMATCH'));
console.log(await page.snapshot());
