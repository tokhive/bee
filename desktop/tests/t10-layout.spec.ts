import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const cases=JSON.parse(readFileSync(new URL('./fixtures/t10-layout-cases.json',import.meta.url),'utf8')) as {id:string;scene:string;scope:string;expectation:string;layer:string;viewport:{width:number;height:number};locale:string;theme:string}[];
async function capture(page:Page,info:TestInfo,c:typeof cases[number],long=false){
 await page.setViewportSize(c.viewport);await page.emulateMedia({reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene:c.scene,locale:c.locale,theme:c.theme,...long?{long:'1'}:{}}));
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
 if(c.id==='R01'){
  expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
  await expect(page.getByRole('button',{name:c.locale==='en'?'Start contribution':'开始贡献',exact:true})).toBeDisabled();
  await expect(page.getByRole('region',{name:c.locale==='en'?'Contribution runtime':'贡献运行',exact:true})).toContainText(c.locale==='en'?'Connect at least one AI account first.':'请先接入至少一个 AI 账号。');
  await expect(page.getByRole('button',{name:c.locale==='en'?'Prepare accounts':'前往准备账号',exact:true})).toBeVisible();
 }
 if(c.scene==='diagnostics-export-unknown')await expect(page.locator('body')).toContainText(c.locale==='en'?'Report download result unconfirmed':'报告下载结果未确认',{timeout:35000});
 if(c.scene==='check-expired')await expect(page.locator('.account-check-status')).toHaveCount(1);
 if(c.scene==='diagnostics-read-failed')await expect(page.locator('body')).toContainText('报告读取已暂停');
 const metrics=await page.evaluate(()=>{
  const rect=(e:Element)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},main:document.querySelector('main')?rect(document.querySelector('main')!):null,heading:document.querySelector('main h1')?.textContent,theme:document.documentElement.dataset.theme,text:document.querySelector('main')?.textContent,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({name:e.getAttribute('aria-labelledby'),...rect(e)})),actions:[...document.querySelectorAll('main button')].map(e=>({text:e.textContent,disabled:(e as HTMLButtonElement).disabled,...rect(e)})),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,calls:(window as any).calls,scene:(window as any).__beePreviewScene};
 });
 expect(errors).toEqual([]);expect(metrics.scene).toBe(c.scene);expect(metrics.document.width).toBeLessThanOrEqual(c.viewport.width);expect(metrics.reducedMotion).toBe(true);await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
 for(const d of metrics.dialogs){expect(d.x).toBeGreaterThanOrEqual(0);expect(d.right).toBeLessThanOrEqual(c.viewport.width+1);expect(d.y).toBeGreaterThanOrEqual(0);expect(d.bottom).toBeLessThanOrEqual(c.viewport.height+1);}
 const screenshot=info.outputPath(c.id+'.png');await page.screenshot({path:screenshot,fullPage:true});
 writeFileSync(info.outputPath(c.id+'.json'),JSON.stringify({...c,long,actual:metrics,screenshot,observed_at:new Date().toISOString(),pageErrors:errors},null,2));
}
for(const c of cases)test(c.id+' '+c.scope,async({page},info)=>capture(page,info,c));
for(const viewport of [{width:860,height:600},{width:1000,height:700},{width:1512,height:833}])for(const locale of ['zh','en'])for(const theme of ['light','dark'])test(`representative ${viewport.width} ${locale} ${theme}`,async({page},info)=>{
 const scene=viewport.width===860?'confirm-change':viewport.width===1000?'device-error':'running';
 await capture(page,info,{id:`matrix-${viewport.width}-${locale}-${theme}`,scene,scope:'三尺寸×中英×明暗长内容',expectation:'主页面和模态框无横向溢出',layer:'正式组件＋模拟IPC',viewport,locale,theme},true);
 if(scene==='confirm-change'){const dialogs=page.getByRole('dialog');await page.keyboard.press('Escape');await expect(dialogs).toHaveCount(1);await page.keyboard.press('Escape');await expect(dialogs).toHaveCount(0);await expect(page.getByRole('button',{name:locale==='en'?'OpenAI details':'OpenAI 详情',exact:true})).toBeFocused();}
});
