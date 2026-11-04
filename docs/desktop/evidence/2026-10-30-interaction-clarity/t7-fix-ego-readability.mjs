const task=await taskSpace(39),page=task.page('p1'),fs=await import('node:fs/promises');
const root='/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity',facts=[];
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
for(const [width,height] of [[1080,840],[1000,700],[860,600]])for(const locale of ['zh','en'])for(const theme of ['light','dark']){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await page.goto(`http://127.0.0.1:1421/tests/fixtures/bee-preview/app.html?scene=account-error&locale=zh&theme=${theme}&long`);await page.waitForFunction(()=>window.__beePreviewReady===true);
 if(locale==='en'){await page.click("loc=role:button[name='设置']");await page.click("loc=role:tab[name='通用']");await page.selectOption("loc=role:combobox[name='语言']",'en');await page.click("loc=role:button[name='AI accounts']");}
 await page.click(`button[aria-label='OpenAI ${locale==='en'?'details':'详情'}']`);
 await page.evaluate(locale=>{window.accounts.openai.candidate.error.message='file_read permission_denied=true; check=file_read; '+(locale==='en'?'The official client cannot read this long nested credential source path. ':'官方客户端无法读取此较长嵌套位置中的凭证来源。').repeat(8);},locale);
 await page.fill('.account-source input','/tmp/t7-fix-long-source-check/'.repeat(8));await page.press('.account-source input','Enter');
 await page.waitForFunction(()=>window.calls.some(c=>c.command==='account_detect'&&c.args.request?.directory?.includes('t7-fix-long-source')));
 await page.keyboard.press('Escape');
 const selector='.native-account-row[data-account-platform=openai] .native-account-copy .problem-notice';
 await page.click(`${selector} details summary`);
 await page.screenshot({path:`${root}/t7-fix-error-row-${width}-${locale}-${theme}.png`});
 const state=await page.evaluate(async()=>{const row=document.querySelector('.native-account-row[data-account-platform=openai]'),notice=row.querySelector('.problem-notice'),button=notice.querySelector('button'),summary=notice.querySelector('summary'),paragraph=notice.querySelector('p');const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return {overflow:document.documentElement.scrollWidth>innerWidth,noticeOverflow:notice.scrollWidth>notice.clientWidth,paragraph:box(paragraph),button:box(button),summary:box(summary),buttonText:button.textContent,summaryText:summary.textContent,detailText:notice.querySelector('pre').textContent,primaryActions:box(row.querySelector('.native-account-row-actions')),automaticWrites:window.calls.filter(c=>['account_action','authorize_start','authorize_cancel','supply_set_paused','runtime_start'].includes(c.command)).length,missing:[...(await import('/src/i18n/index.ts')).missingTranslations]};});
 await page.click(`${selector}>button`);await page.waitForSelector('.detail-sheet .account-source input',{state:'visible'});
 state.sourceFocused=await page.evaluate(()=>document.activeElement===document.querySelector('.detail-sheet .account-source input'));
 await page.screenshot({path:`${root}/t7-fix-error-target-${width}-${locale}-${theme}.png`});
 facts.push({width,height,locale,theme,...state});
}
await fs.writeFile(`${root}/t7-fix-readability.json`,JSON.stringify({utc:new Date().toISOString(),space:39,page:'p1',facts},null,2));console.log(facts.map(({detailText,...f})=>f));console.log(await page.snapshot());
