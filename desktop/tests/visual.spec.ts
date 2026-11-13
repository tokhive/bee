import { expect, test, type Page, type TestInfo } from '@playwright/test';

type View = { width: number; height: number; lang: 'zh' | 'en'; theme: 'light' | 'dark'; zoom: number };
const views: View[] = [1280, 1024, 860].flatMap(width => (['zh', 'en'] as const).map(lang => ({ width, height: width === 1280 ? 860 : width === 1024 ? 768 : 600, lang, theme: 'light' as const, zoom: 1 })));
for (const lang of ['zh', 'en'] as const) {
  views.push({ width: 860, height: 600, lang, theme: 'dark', zoom: 1 });
  for (const zoom of [1.25, 1.5]) views.push({ width: 860, height: 600, lang, theme: 'light', zoom });
}
const names = {
  zh: { pages: ['概览','AI 账号','收益','诊断','设置'], details: '查看详情', back: '返回收益', close: '关闭', pricing: '报价设置', transfer: '划转至买家余额', withdrawal: '提现', exit: '退出演示', update: '更新演示', waitExit: '等待后退出', waitUpdate: '等待后更新' },
  en: { pages: ['Overview','AI accounts','Earnings','Diagnostics','Settings'], details: 'View details', back: 'Back to earnings', close: 'Close', pricing: 'Pricing settings', transfer: 'Transfer to buyer balance', withdrawal: 'Withdraw', exit: 'Exit demo', update: 'Update demo', waitExit: 'Wait then exit', waitUpdate: 'Wait then update' },
};
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no window-wide horizontal clipping`).toBe(true);
  await expect(page.locator('.demo-badge')).toBeVisible();
  if (await page.locator('html').getAttribute('lang') === 'en') expect(await page.locator('body').innerText(), `${name}: English visible copy`).not.toMatch(/[\u4e00-\u9fff]/);
  for (const amount of await page.locator('.amount').all()) expect(await amount.evaluate(el => el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) + 1), `${name}: monetary digits remain on one line`).toBe(true);
  for (const row of await page.locator('.account-row').all()) expect(await row.evaluate(el => [...el.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)), `${name}: account actions stay inside their row`).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}
async function keyboardDialog(page: Page, cancel: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const buttons = dialog.getByRole('button');
  const count = await buttons.count();
  await buttons.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(buttons.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(buttons.first()).toBeFocused();
  for (let i = 0; i < count; i++) await page.keyboard.press('Tab');
  await expect(buttons.first()).toBeFocused();
  await expect(dialog.getByRole('button', { name: cancel, exact: true })).toBeEnabled();
}
for (const view of views) {
  const label = `${view.width}x${view.height}-${view.lang}-${view.theme}-${view.zoom}`;
  test(`silver ${label}: pages, secondary flows, lifecycle, keyboard`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.emulateMedia({ colorScheme: view.theme, reducedMotion: 'reduce' });
    await page.addInitScript(({ lang, theme, zoom }) => {
      Object.defineProperty(navigator, 'language', { configurable: true, get: () => lang === 'zh' ? 'zh-CN' : 'en-US' });
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = String(zoom); });
    }, view);
    const n = names[view.lang];
    await page.goto('/?scene=ready');
    await expect(page.getByRole('heading', { name: n.pages[0], exact: true })).toBeVisible();
    if (view.zoom === 1) expect(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width)).toBe(178);
    for (const [index, name] of n.pages.entries()) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await capture(page, info, `page-${index}`);
      if (index === 1) {
        const details = page.getByRole('button', { name: n.details, exact: true }).first();
        await details.click();
        await keyboardDialog(page, n.close);
        await capture(page, info, 'account-sheet');
        await page.keyboard.press('Escape');
        await expect(details).toBeFocused();
      }
      if (index === 2) {
        for (const [name, button] of [['pricing',n.pricing],['transfer',n.transfer],['withdrawal',n.withdrawal]]) {
          await page.getByRole('button', { name: button, exact: true }).click();
          const back = page.getByRole('button', { name: n.back, exact: true });
          await back.scrollIntoViewIfNeeded();
          await expect(back).toBeInViewport();
          const submit = page.locator('.finance-form button').last();
          if (await submit.count()) { await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport(); }
          await capture(page, info, name);
          await back.click();
        }
      }
    }
    for (const [purpose, button, wait] of [['exit',n.exit,n.waitExit],['update',n.update,n.waitUpdate]]) {
      await page.goto('/?scene=active-tasks');
      const trigger = page.getByRole('button', { name: button, exact: true });
      await trigger.click();
      await keyboardDialog(page, view.lang === 'zh' ? '取消' : 'Cancel');
      await capture(page, info, purpose);
      await page.getByRole('button', { name: wait, exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(view.lang === 'zh' ? '已临时停止' : 'temporarily stopped');
      await capture(page, info, `${purpose}-waiting`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await page.goto('/?scene=unknown-tasks');
    await page.getByRole('button', { name: n.exit, exact: true }).click();
    await capture(page, info, 'exit-unknown');
    await page.keyboard.press('Escape');
    await page.goto('/?scene=onboarding');
    await capture(page, info, 'onboarding');
    // All visible English UI is translated; user data, IDs and public URLs are excluded by this fixture.
    if (view.lang === 'en') expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  });
}

for (const scene of ['loading', 'empty', 'error', 'earnings-loading', 'earnings-empty', 'earnings-error']) {
  test(`silver read state ${scene}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`/?scene=${scene}`);
    if (scene.startsWith('earnings-')) await page.getByRole('navigation').getByRole('button', { name: '收益', exact: true }).click();
    await capture(page, info, scene);
  });
}
