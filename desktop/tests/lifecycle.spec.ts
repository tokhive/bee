import { expect, test } from '@playwright/test';

for (const cold of [true, false]) {
  test(`${cold ? '冷启动' : '后台'}回跳只显示收到，保持尚未开始贡献`, async ({ page }) => {
    await page.addInitScript(({ cold }) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      let receipt: number | undefined;
      let next = 0;
      Object.assign(window, {
        isTauri: true,
        __beeLoginReturn() { if (!receipt) return false; callbacks.get(receipt)?.({ payload: true }); return true; },
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void) { callbacks.set(++next, callback); return next; },
          unregisterCallback(id: number) { callbacks.delete(id); },
          async invoke(command: string, args: { handler?: number; event?: string; method?: string }) {
            if (command === 'login_return_received') return cold;
            if (command === 'bridge_status') return { state: 'ready', metadata: { bee_version: 'fixture', os: 'darwin', arch: 'arm64', instance: 'owned' } };
            if (command === 'plugin:event|listen') { if (args.event === 'bee://login-return') receipt = args.handler; return args.handler; }
            if (command === 'plugin:event|unlisten') return;
            throw new Error(`unexpected fixture IPC command=${command}`);
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(_event: string, id: number) { callbacks.delete(id); } },
      });
    }, { cold });
    await page.goto('/');
    if (!cold) {
      await expect(page.getByText('已收到登录返回', { exact: true })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __beeLoginReturn(): boolean }).__beeLoginReturn())).toBe(true);
    }
    await expect(page.getByText('已收到登录返回', { exact: true })).toBeVisible();
    await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
    await expect(page.getByText('已登录', { exact: true })).toHaveCount(0);
  });
}
