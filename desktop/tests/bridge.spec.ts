import { expect, test } from '@playwright/test';

test('普通浏览器明确显示没有原生能力并保留重新检查', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('NATIVE_UNAVAILABLE');
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(page.getByRole('alert')).toContainText('NATIVE_UNAVAILABLE');
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
});

for (const failed of [false, true]) {
  test(`Tauri 调用替身验证${failed ? '子进程故障' : '管理握手和存活'}呈现`, async ({ page }) => {
    await page.addInitScript(({ failed }) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      let next = 0;
      const state = failed
        ? { state: 'failed', error: { code: 'CHILD_EXITED', message: 'owned Bee exited: status=9' } }
        : { state: 'ready', metadata: { bee_version: 'fixture', os: 'darwin', arch: 'arm64', instance: 'owned' } };
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void) { callbacks.set(++next, callback); return next; },
          unregisterCallback(id: number) { callbacks.delete(id); },
          async invoke(command: string, args: { handler?: number; method?: string }) {
            if (command === 'login_return_received') return false;
            if (command === 'bridge_status') return state;
            if (command === 'bridge_request' && args.method === 'ping' && !failed) return { protocol: 1, id: 'shell-2', instance: 'owned', result: { alive: true } };
            if (command === 'plugin:event|listen') return args.handler;
            if (command === 'plugin:event|unlisten') return;
            throw new Error(`unexpected fixture IPC command=${command}`);
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(_event: string, id: number) { callbacks.delete(id); } },
      });
    }, { failed });
    await page.goto('/');
    if (failed) {
      await expect(page.getByRole('alert')).toContainText('status=9');
      await expect(page.getByRole('button', { name: '重新检查' })).toBeEnabled();
    } else {
      await expect(page.getByLabel('管理进程')).toContainText('管理协议已就绪');
      await page.getByRole('button', { name: '检查存活' }).click();
      await expect(page.getByRole('status')).toHaveText('管理进程响应正常');
      await expect(page.getByText('fixture', { exact: true })).toBeVisible();
    }
    await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始贡献' })).toHaveCount(0);
  });
}
