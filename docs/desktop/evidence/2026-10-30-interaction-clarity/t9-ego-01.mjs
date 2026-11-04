const fs=await import('node:fs/promises');
const root='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0';
const task=await taskSpace(40);if(task.ownership!=='agent')throw new Error('TaskSpace40 must remain agent owned');const page=task.page('p1');
const fixture=(await fs.readFile(root+'/desktop/tests/fixtures/native-accounts.mjs','utf8')).replaceAll('export function ','function ');
const installed=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:fixture+'\ninstallAccountFixture({runtimeEnabled:true,accounts:{openai:accountFixture("openai"),claude:accountFixture("claude")}});'});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'light'}]});
await page.goto('http://127.0.0.1:1490/');await page.waitForSelector('loc=role:button[name="设置"]');
console.log({spaceId:task.spaceId,initScript:installed.identifier});console.log(await page.snapshot());
