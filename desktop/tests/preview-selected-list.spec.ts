import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
test.beforeEach(async({page})=>{
 await page.route('**/approved-preview/**',async route=>route.fulfill({contentType:'text/html; charset=utf-8',body:await readFile(resolve(import.meta.dirname,'../../docs/preview',new URL(route.request().url()).pathname.split('/approved-preview/')[1]))}));
});
for(const [scene,platform] of [['paused','OpenAI'],['ready','OpenAI'],['read-failed-allowed','OpenAI'],['claude-paused','Claude'],['add-list','OpenAI']]){
 test(`${scene} keeps only added accounts and restores its state after cancelling addition`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`/approved-preview/index.html?scene=${scene}&theme=light&size=narrow`);
  const app=page.frameLocator('#screen');
  await expect(app.locator('.account')).toHaveCount(1);
  await expect(app.locator('.account')).toHaveAttribute('data-platform',platform);
  const before=await app.locator('.account').innerText();
  await app.getByRole('button',{name:'添加账号',exact:true}).click();
  await expect(app.getByRole('heading',{name:'添加另一个平台'})).toBeFocused();
  await expect(app.locator(`[data-add="${platform.toLowerCase()}"]`)).toBeDisabled();
  await expect(app.locator('.count')).toHaveText('1 个已接入');
  await app.getByRole('button',{name:'取消添加',exact:true}).click();
  await expect(app.locator('.account')).toHaveCount(1);
  await expect(app.locator('.account')).toHaveText(before,{useInnerText:true});
  await expect(app.getByRole('button',{name:'添加账号',exact:true})).toBeFocused();
  expect(errors).toEqual([]);
 });
}
test('adding Claude from a paused OpenAI list retains OpenAI and allows returning before login',async({page})=>{
 await page.goto('/approved-preview/index.html?scene=paused&theme=light&size=narrow');const app=page.frameLocator('#screen');
 await app.getByRole('button',{name:'添加账号',exact:true}).click();
 await app.locator('[data-add="claude"]').click();
 await expect(app.locator('[data-platform="Claude"]')).toBeVisible();
 await expect(app.locator('[data-platform="OpenAI"]')).toContainText('已暂停');
 await app.getByRole('button',{name:'取消添加',exact:true}).click();
 await expect(app.locator('.account')).toHaveCount(1);
 await expect(app.locator('[data-platform="OpenAI"]')).toContainText('已暂停');
});
test('current onboarding stays visible and both selected platforms remain in overview scenarios',async({page})=>{
 for(const scene of ['onboarding','claude-onboarding','first-preparing']){
  await page.goto(`/approved-preview/index.html?scene=${scene}&theme=light&size=narrow`);
  await expect(page.frameLocator('#screen').locator('.account')).toHaveCount(1);
 }
 await page.goto('/approved-preview/index.html?scene=device-service&theme=light&size=narrow&page=accounts');
 const app=page.frameLocator('#screen');await page.locator('#page').selectOption('accounts');await expect(app.locator('.account')).toHaveCount(2);
 await app.getByRole('button',{name:'添加账号',exact:true}).click();
 await expect(app.locator('[data-add="openai"]')).toBeDisabled();await expect(app.locator('[data-add="claude"]')).toBeDisabled();
});

test('reset preserves the original scene and size after navigating into addition',async({page})=>{
 await page.goto('/approved-preview/index.html?scene=paused&theme=light&size=narrow');const app=page.frameLocator('#screen');
 await app.getByRole('button',{name:'添加账号',exact:true}).press('Enter');
 await expect(app.getByRole('heading',{name:'添加另一个平台'})).toBeFocused();
 await page.locator('#size').selectOption('wide');
 await expect(app.getByRole('heading',{name:'添加另一个平台'})).toBeVisible();
 await page.getByRole('button',{name:'重置场景',exact:true}).click();
 await expect(app.locator('.account')).toHaveCount(1);await expect(app.locator('.account')).toContainText('已暂停');
 await expect(page.locator('#scene')).toHaveValue('paused');await expect(page.locator('#size')).toHaveValue('wide');
});
test('in-progress account work is not replaced by another addition',async({page})=>{
 for(const scene of ['first-preparing','claude-first-preparing','add-preparing']){
  await page.goto(`/approved-preview/index.html?scene=${scene}&theme=light&size=narrow`);
  const app=page.frameLocator('#screen');await expect(app.getByRole('button',{name:'添加账号',exact:true})).toBeDisabled();
  await expect(app.locator('.account').first()).toContainText('正在准备');
 }
});

test('completion re-enables adding another platform without reloading the list',async({page})=>{
 await page.clock.install();await page.goto('/approved-preview/index.html?scene=add-confirm&theme=light&size=narrow');
 const app=page.frameLocator('#screen');await app.getByRole('button',{name:'确认接入',exact:true}).click();
 await page.clock.runFor(1100);await expect(app.getByRole('button',{name:'添加账号',exact:true})).toBeDisabled();
 await page.clock.runFor(2000);await expect(app.getByRole('button',{name:'添加账号',exact:true})).toBeEnabled();
});
test('Claude login cannot be abandoned through the idle addition return action',async({page})=>{
 await page.clock.install();await page.goto('/approved-preview/index.html?scene=paused&theme=light&size=narrow');const app=page.frameLocator('#screen');
 await app.getByRole('button',{name:'添加账号',exact:true}).click();await app.locator('[data-add="claude"]').click();
 await app.locator('[data-platform="Claude"]').getByRole('button',{name:'登录 Claude',exact:true}).click();
 await app.getByRole('dialog',{name:'登录 Claude',exact:true}).getByRole('button',{name:'开始官方登录',exact:true}).click();
 await expect(app.getByRole('button',{name:'取消添加',exact:true})).toHaveCount(0);
 await expect(app.locator('[data-platform="OpenAI"]')).toContainText('已暂停');
});
