const fs=await import('node:fs/promises');
const base='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0';
console.log({at:new Date().toISOString(),cancelReceipt:await fs.readFile(base+'/.cache/interaction-clarity-web-v2/cancel-verified','utf8')});
const t=await taskSpace(40),p=t.page('p1');
await p.click('loc=role:button[name="Verify device"]',{label:'inspect original pairing after cancel'});await p.waitForSelector('loc=role:dialog[name="Confirm Bee Replacement"]');
await p.click('loc=role:button[name="Confirm replacement"]',{label:'confirm real desktop replacement'});await p.waitForFunction(()=>!document.querySelector('[role=dialog]'));
console.log({at:new Date().toISOString(),url:await p.url(),confirmationClicked:true});console.log(await p.snapshot());
