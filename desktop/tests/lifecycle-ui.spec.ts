import { expect, test } from '@playwright/test';

for (const purpose of ['退出', '更新']) {
  test(`${purpose}：无任务直接完成演示，不弹有任务确认`, async ({ page }) => {
    await page.goto('/?scene=ready');
    await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
    await expect(page.getByTestId('lifecycle-status')).toContainText(`演示${purpose}流程已完成`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test(`${purpose}：等待临时停止派发，取消保持主动暂停`, async ({ page }) => {
    await page.goto('/?scene=active-tasks');
    await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('立即操作可能中断进行中的任务');
    await dialog.getByRole('button', { name: `等待后${purpose}`, exact: true }).click();
    await expect(dialog).toContainText('已临时停止接收新任务');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: `${purpose}演示`, exact: true })).toBeFocused();
    await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
    await dialog.getByRole('button', { name: `等待后${purpose}`, exact: true }).click();
    await dialog.getByRole('button', { name: '核对任务状态', exact: true }).click();
    await expect(page.getByTestId('lifecycle-status')).toContainText(`演示${purpose}流程已完成`);
  });
  for (const scene of ['unknown-tasks', 'tasks-loading', 'tasks-error'])
    test(`${purpose}：${scene} 不将未知或旧零当作完成`, async ({ page }) => {
      await page.goto(`/?scene=${scene}`);
      await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('任务状态尚未确认');
      await expect(dialog.getByRole('button', { name: `立即${purpose}`, exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '核对任务状态', exact: true }).click();
      if (scene !== 'unknown-tasks') {
        await expect(dialog).toContainText('任务状态尚未确认');
        await expect(page.getByTestId('lifecycle-status')).not.toContainText('流程已完成');
      } else await expect(page.getByTestId('lifecycle-status')).toContainText('流程已完成');
    });
}

test('纯reducer拒绝陈旧结果及所有非confirmed结果', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { reduceLifecycle, initialLifecycle } = await import(/* @vite-ignore */ String('/src/features/lifecycle/lifecycle.ts'));
    const tasks = { status: 'ready', updatedAt: 'now', value: { kind: 'known', count: 2 } };
    const begun = reduceLifecycle(initialLifecycle, { type: 'start', id: 1, purpose: 'exit', tasks });
    const next = reduceLifecycle(begun, { type: 'start', id: 2, purpose: 'update', tasks });
    const stale = reduceLifecycle(next, { type: 'result', id: 1, action: 'finish', result: { kind: 'confirmed', demo: true }, tasks });
    return { stale, next, states: ['pending', 'unknown', 'failed', 'unsupported'].map(kind => reduceLifecycle(begun, { type: 'result', id: 1, action: 'finish', result: kind === 'failed' ? { kind, error: { code: 'TEST', message: 'failure' } } : { kind, message: kind }, tasks }).status) };
  });
  expect(result.stale).toEqual(result.next);
  expect(result.states).not.toContain('finished');
});

test('演示客户端临时停止不改主动选择，旧意图不能取消新意图或真实退出', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const c = createDemoClient('active-tasks');
    await c.dispatch({ type: 'setPlatformPaused', platform: 'openai', paused: false });
    const before = await c.snapshot();
    await c.dispatch({ type: 'lifecycle.wait', requestId: 'first', purpose: 'exit' });
    const waiting = await c.snapshot();
    await c.dispatch({ type: 'setPlatformPaused', platform: 'openai', paused: true });
    await c.dispatch({ type: 'lifecycle.cancel', requestId: 'first', purpose: 'exit' });
    const cancelled = await c.snapshot();
    await c.dispatch({ type: 'lifecycle.wait', requestId: 'second', purpose: 'update' });
    const stale = await c.dispatch({ type: 'lifecycle.cancel', requestId: 'first', purpose: 'exit' });
    return { before, waiting, cancelled, stale, final: await c.snapshot() };
  });
  expect(r.waiting.accounts).toEqual(r.before.accounts);
  expect(r.waiting.lifecycle.dispatchStopped).toBe(true);
  expect(r.cancelled.accounts.value.every((a: { paused: boolean }) => a.paused)).toBe(true);
  expect(r.cancelled.lifecycle.dispatchStopped).toBe(false);
  expect(r.stale.kind).toBe('failed');
  expect(r.final.lifecycle.dispatchStopped).toBe(true);
});

for (const purpose of ['退出', '更新']) {
  test(`${purpose}立即操作明确中断风险且仅完成演示`, async ({ page }) => {
    const unsafe: string[] = [];
    await page.addInitScript(() => { Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: { invoke: (cmd: string) => { throw new Error(`Unexpected native invocation: ${cmd}`); } } }); });
    page.on('request', r => { if (['fetch','xhr'].includes(r.resourceType())) unsafe.push(r.url()); });
    await page.goto('/?scene=active-tasks');
    await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('可能中断');
    await page.getByRole('button', { name: `立即${purpose}`, exact: true }).click();
    await expect(page.getByTestId('lifecycle-status')).toContainText('流程已完成');
    expect(unsafe).toEqual([]);
  });
  for (const scene of ['lifecycle-unknown', 'lifecycle-pending', 'lifecycle-failed'])
    test(`${purpose} ${scene}不冒充完成并可取消`, async ({ page }) => {
      await page.goto(`/?scene=${scene}`);
      await page.getByRole('button', { name: `${purpose}演示`, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('生命周期');
      await expect(page.getByTestId('lifecycle-status')).not.toContainText('流程已完成');
      await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

test('今日与累计摘要精确等于同场景结算，概览和收益一致', async ({ page }) => {
  await page.goto('/?scene=ready');
  const amounts = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const { amountUnits, decimalUnits } = await import(/* @vite-ignore */ String('/src/features/earnings/money.ts'));
    const s = await createDemoClient('ready').snapshot();
    const rows = s.finance.value.settlements;
    return { today: amountUnits(s.earnings.value.today).toString(), total: amountUnits(s.earnings.value.total).toString(), expectedToday: rows.filter((r: { daysAgo: number }) => r.daysAgo === 0).reduce((sum: bigint, r: { amount: string }) => sum + amountUnits(r.amount), 0n).toString(), expectedTotal: rows.reduce((sum: bigint, r: { amount: string }) => sum + amountUnits(r.amount), 0n).toString() };
  });
  expect(amounts.today).toBe(amounts.expectedToday);
  expect(amounts.total).toBe(amounts.expectedTotal);
  await expect(page.getByRole('region', { name: '收益摘要' }).locator('.amount').nth(1)).toContainText('12.4');
  await page.getByRole('navigation').getByRole('button', { name: '收益', exact: true }).click();
  await expect(page.getByRole('region', { name: '钱包与收益' }).locator('.amount').nth(1)).toContainText('12.4');
});

test('confirmed收尾若回读任务未知或旧零仍然fail-closed', async ({ page }) => {
  await page.goto('/');
  const statuses = await page.evaluate(async () => {
    const { reduceLifecycle, initialLifecycle } = await import(/* @vite-ignore */ String('/src/features/lifecycle/lifecycle.ts'));
    const known = { status: 'ready', updatedAt: 'now', value: { kind: 'known', count: 0 } };
    const state = reduceLifecycle(initialLifecycle, { type: 'start', id: 1, purpose: 'exit', tasks: known });
    return [{ status: 'ready', updatedAt: 'now', value: { kind: 'unknown' } }, { status: 'loading', updatedAt: 'old', value: { kind: 'known', count: 0 } }].map(tasks => reduceLifecycle(state, { type: 'result', id: 1, action: 'finish', result: { kind: 'confirmed', demo: true, message: 'receipt' }, tasks }).status);
  });
  expect(statuses).toEqual(['unknown', 'unknown']);
});

test('核对零任务后等待完成回执期间保持处理中，不暴露无效取消按钮', async ({ page }) => {
  await page.route('**/src/client/demo.ts', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'async dispatch(command) {';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `${marker} if(command.type === 'lifecycle.finish') { window.task6Finishing = true; await new Promise(resolve => setTimeout(resolve, 800)); }`) });
  });
  await page.goto('/?scene=active-tasks');
  await page.getByRole('button', { name: '退出演示', exact: true }).click();
  await page.getByRole('button', { name: '等待后退出', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('已临时停止');
  await page.getByRole('button', { name: '核对任务状态', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { task6Finishing?: boolean }).task6Finishing);
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await expect(page.getByTestId('lifecycle-status')).toContainText('流程已完成');
});
