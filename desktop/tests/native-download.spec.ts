import { expect, test, type Page } from '@playwright/test';

interface DownloadFixture {
  urls: string[];
  listeners(): number;
  callbacks(): number;
  subscribedBeforeClick: boolean[];
  finish(index: number, success: unknown): void;
}

async function nativeDownloads(page: Page, registrationError = '') {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: '诊断', exact: true }).click();
  // Replace only the native transport and anchor activation. Real report generation,
  // subscription, correlation, cleanup and page presentation remain under test.
  await page.evaluate(({ registrationError }) => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const subscriptions = new Map<number, string>();
    let next = 0;
    const fixture: DownloadFixture = {
      urls: [], subscribedBeforeClick: [],
      listeners: () => subscriptions.size,
      callbacks: () => callbacks.size,
      finish(index, success) {
        for (const [id, event] of subscriptions) {
          if (event === 'bee://download-finished') callbacks.get(id)?.({ event, payload: { url: fixture.urls[index], success } });
        }
      },
    };
    Object.assign(window, {
      isTauri: true,
      beeDownloadQA: fixture,
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++next, callback); return next; },
        unregisterCallback(id: number) { callbacks.delete(id); },
        async invoke(command: string, args: { handler: number; eventId: number; event: string }) {
          if (command === 'plugin:event|listen') {
            if (registrationError) throw new Error(registrationError);
            subscriptions.set(args.handler, args.event); return args.handler;
          }
          if (command === 'plugin:event|unlisten') { subscriptions.delete(args.eventId); return; }
          throw new Error(`unexpected native download fixture command=${command}`);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(_event: string, id: number) { callbacks.delete(id); } },
    });
    HTMLAnchorElement.prototype.click = function () {
      fixture.urls.push(this.href);
      fixture.subscribedBeforeClick.push([...subscriptions.values()].includes('bee://download-finished'));
    };
  }, { registrationError });
}

const fixtureState = (page: Page) => page.evaluate(() => {
  const f = (window as unknown as { beeDownloadQA: DownloadFixture }).beeDownloadQA;
  return { count: f.urls.length, listeners: f.listeners(), callbacks: f.callbacks(), subscribedBeforeClick: f.subscribedBeforeClick };
});
async function finish(page: Page, index: number, success: unknown) {
  if (index !== 99) await expect.poll(async () => (await fixtureState(page)).count).toBeGreaterThan(index);
  await page.evaluate(({ index, success }) => {
    (window as unknown as { beeDownloadQA: DownloadFixture }).beeDownloadQA.finish(index, success);
  }, { index, success });
}

test('原生导出等待匹配回执，成功后才确认交付并清理监听', async ({ page }) => {
  await nativeDownloads(page);
  const button = page.getByRole('button', { name: '导出脱敏报告', exact: true });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('正在等待报告下载结果');
  expect((await fixtureState(page)).subscribedBeforeClick).toEqual([true]);
  await finish(page, 99, true);
  await finish(page, 0, 'true');
  await expect(button).toBeDisabled();
  await finish(page, 0, true);
  await expect(page.getByRole('status')).toHaveText('脱敏报告已下载。');
  await expect(button).toBeEnabled();
  await expect.poll(async () => (await fixtureState(page)).listeners).toBe(0);
  expect((await fixtureState(page)).callbacks).toBe(0);
});

test('原生下载失败显示实际回执，重试隔离旧结果且不泄露URL', async ({ page }) => {
  await nativeDownloads(page);
  const button = page.getByRole('button', { name: '导出脱敏报告', exact: true });
  await button.click();
  await finish(page, 0, false);
  await expect(page.getByRole('status')).toContainText('原生报告下载失败');
  await expect(page.getByRole('status')).toContainText('success=false');
  await expect(page.getByRole('status')).toContainText('未确认完成');
  await expect(page.getByRole('status')).not.toContainText('blob:');
  await expect(button).toBeEnabled();
  await button.click();
  await finish(page, 0, true);
  await expect(button).toBeDisabled();
  await finish(page, 1, true);
  await expect(page.getByRole('status')).toHaveText('脱敏报告已下载。');
  await expect.poll(async () => (await fixtureState(page)).listeners).toBe(0);
});

test('下载监听注册失败时不发起下载，保留底层错误并可重试', async ({ page }) => {
  await nativeDownloads(page, 'download-listen-denied: E42');
  const button = page.getByRole('button', { name: '导出脱敏报告', exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await button.click();
    await expect(page.getByRole('status')).toContainText('download-listen-denied: E42');
    await expect(page.getByRole('status')).toContainText('未确认完成');
    await expect(button).toBeEnabled();
    const state = await fixtureState(page);
    expect(state.count).toBe(0);
    expect(state.callbacks).toBe(0);
  }
});

test('30秒未收到原生回执显示未确认，迟到结果不改写页面', async ({ page }) => {
  await nativeDownloads(page);
  await page.clock.install();
  const button = page.getByRole('button', { name: '导出脱敏报告', exact: true });
  await button.click();
  await expect.poll(async () => (await fixtureState(page)).count).toBe(1);
  await page.clock.runFor(30_001);
  await expect(page.getByRole('status')).toContainText('报告下载结果未确认');
  await expect(page.getByRole('status')).toContainText('waitedMs=30000');
  await expect(button).toBeEnabled();
  await finish(page, 0, true);
  await expect(page.getByRole('status')).toContainText('报告下载结果未确认');
  await expect.poll(async () => (await fixtureState(page)).listeners).toBe(0);
});

test('原生失败和成功反馈完整翻译为英文', async ({ page }) => {
  await nativeDownloads(page);
  await page.getByRole('navigation').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await page.getByRole('navigation').getByRole('button', { name: 'Diagnostics', exact: true }).click();
  const button = page.getByRole('button', { name: 'Export sanitized report', exact: true });
  const status = page.locator('.diagnostics-page').getByRole('status');
  await button.click();
  await finish(page, 0, false);
  await expect(status).toContainText('success=false');
  await expect(status).not.toContainText(/[\u4e00-\u9fff]/);
  await button.click();
  await finish(page, 1, true);
  await expect(status).toHaveText('Sanitized report downloaded.');
});
