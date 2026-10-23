import { expect, test, type Page } from '@playwright/test';
async function earnings(page: Page, scene = 'ready') {
  await page.goto(`/?scene=${scene}`);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '收益', exact: true })
    .click();
}
test('收益平台筛选、统计范围、分页与删号历史保持全局余额', async ({ page }) => {
  await earnings(page);
  await expect(page.getByRole('heading', { name: '收益与结算' })).toBeVisible();
  const balance = await page.getByTestId('earnings-balance').textContent();
  await page.getByLabel('平台筛选').selectOption('openai');
  await expect(page.getByTestId('earnings-balance')).toHaveText(balance!);
  await page.getByRole('button', { name: '近 30 天', exact: true }).click();
  await expect(page.getByTestId('range-total')).toContainText('240');
  await expect(page.getByTestId('platform-totals')).toContainText('240');
  await page.getByRole('button', { name: '下一页流水' }).click();
  await expect(page.getByTestId('ledger-page')).toHaveText('2 / 2');
  const history = await page.evaluate(async () => {
    const { createDemoClient } = await import(
      /* @vite-ignore */ String('/src/client/demo.ts')
    );
    const c = createDemoClient('ready');
    const before = (await c.snapshot()).finance;
    await c.dispatch({ type: 'removeAccount', platform: 'openai' });
    return { before, after: (await c.snapshot()).finance };
  });
  expect(history.after).toEqual(history.before);
  await page.screenshot({
    path: '/tmp/bee-task4-earnings.png',
    fullPage: true,
  });
});
test('提现空与已填均保留输入、余额与流水，全部操作无非静态请求', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/*', (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (
      u.origin === 'http://127.0.0.1:1420' &&
      ['document', 'script', 'stylesheet', 'image', 'font', 'other'].includes(
        r.resourceType(),
      ) &&
      r.method() === 'GET'
    )
      return route.continue();
    requests.push(`${r.method()} ${r.url()}`);
    return route.abort();
  });
  await earnings(page);
  const balance = await page.getByTestId('earnings-balance').textContent();
  await page.getByRole('button', { name: '提现', exact: true }).click();
  await expect(page.getByText('暂未开放', { exact: true })).toBeVisible();
  for (const value of ['', '999.000000001']) {
    await page.getByLabel('提现金额').fill(value);
    await page.getByRole('button', { name: '提交提现' }).click();
    await expect(page.getByRole('alert')).toHaveText('暂不支持提现');
    await expect(page.getByLabel('提现金额')).toHaveValue(value);
    if (value)
      await page.screenshot({
        path: '/tmp/bee-task4-withdrawal.png',
        fullPage: true,
      });
  }
  await page.getByRole('button', { name: '返回收益' }).click();
  await expect(page.getByTestId('earnings-balance')).toHaveText(balance!);
  await page.getByRole('button', { name: '划转记录', exact: true }).click();
  await expect(page.getByText('暂无划转记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '报价设置', exact: true }).click();
  await page.getByLabel('自定义报价系数', { exact: true }).check();
  await page.getByLabel('报价系数', { exact: true }).fill('0.2');
  await page.getByRole('button', { name: '保存报价', exact: true }).click();
  await expect(page.getByTestId('active-quote')).toContainText('0.2');
  await page.getByRole('button', { name: '返回收益' }).click();
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await page.getByLabel('划转金额', { exact: true }).fill('1');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认划转', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('演示划转已完成');
  expect(requests).toEqual([]);
});
test('划转格式与余额校验、清旧错、确认取消不扣款、成功精确扣款', async ({
  page,
}) => {
  await earnings(page);
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  const input = page.getByLabel('划转金额', { exact: true });
  for (const v of [
    '0',
    '-1',
    '1e3',
    '1000000000000000',
    '1.0000000001',
    '128.560000001',
  ]) {
    await input.fill(v);
    await page.getByRole('button', { name: '核对划转', exact: true }).click();
    await expect(page.getByRole('alert')).not.toBeEmpty();
    await input.fill('0.000000001');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不可撤回');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page.getByTestId('transfer-available')).toContainText('128.56');
  await input.fill('999');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page.getByRole('button', { name: '全部收益', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await input.fill('0.000000001');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认划转', exact: true })
    .click();
  await expect(page.getByTestId('transfer-available')).toContainText(
    '128.559999999',
  );
});
test('演示幂等隔离、重放、不足余额、pending核对保持原标识和参数', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createDemoClient } = await import(
      /* @vite-ignore */ String('/src/client/demo.ts')
    );
    const c = createDemoClient('ready');
    const identity = (await c.snapshot()).finance.value.identity;
    const op = {
      type: 'transferEarnings',
      requestId: 'test-one',
      amount: '0.000000001',
      ...identity,
    };
    const first = await c.dispatch(op);
    const one = await c.snapshot();
    const replay = await c.dispatch(op);
    const two = await c.snapshot();
    const conflict = await c.dispatch({ ...op, amount: '1' });
    const user = await c.dispatch({ ...op, user: 'other' });
    const hive = await c.dispatch({ ...op, hive: 'other' });
    const tooMuch = await c.dispatch({
      ...op,
      requestId: 'too-much',
      amount: '128.56',
    });
    const pending = createDemoClient('transfer-pending');
    const id = (await pending.snapshot()).finance.value.identity;
    const pendingOp = {
      type: 'transferEarnings',
      requestId: 'original',
      amount: '1',
      ...id,
    };
    const p = await pending.dispatch(pendingOp);
    await pending.dispatch({ type: 'refresh' });
    const blocked = await pending.dispatch({ ...pendingOp, requestId: 'new' });
    const check = await pending.dispatch({
      ...pendingOp,
      type: 'checkTransfer',
    });
    return {
      first,
      replay,
      one: one.earnings,
      two: two.earnings,
      conflict,
      user,
      hive,
      tooMuch,
      p,
      blocked,
      check,
      state: (await pending.snapshot()).finance.value.pendingTransfer,
    };
  });
  expect(r.first.kind).toBe('confirmed');
  expect(r.replay).toEqual(r.first);
  expect(r.one).toEqual(r.two);
  for (const v of [r.conflict, r.user, r.hive, r.tooMuch, r.blocked])
    expect(v.kind).toBe('failed');
  expect(r.p.kind).toBe('pending');
  expect(r.check.operationId).toBe('original');
  expect(r.state).toMatchObject({ requestId: 'original', amount: '1' });
});
for (const scene of ['transfer-pending', 'transfer-unknown'])
  test(`${scene} 禁止新操作，刷新核对仍保留原操作`, async ({ page }) => {
    await earnings(page, scene);
    await page
      .getByRole('button', { name: '划转至买家余额', exact: true })
      .click();
    await page.getByLabel('划转金额', { exact: true }).fill('1');
    await page.getByRole('button', { name: '核对划转', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '确认划转', exact: true })
      .click();
    await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
    const id = await page.getByTestId('pending-transfer').textContent();
    await page.getByRole('button', { name: '刷新原操作', exact: true }).click();
    await expect(page.getByTestId('pending-transfer')).toHaveText(id!);
    await page.getByRole('button', { name: '核对原操作', exact: true }).click();
    await expect(page.getByTestId('pending-transfer')).toHaveText(id!);
  });
test('报价边界清旧错，草稿与生效及已接收任务快照独立', async ({ page }) => {
  await earnings(page);
  await page.getByRole('button', { name: '报价设置', exact: true }).click();
  await page.getByLabel('自定义报价系数', { exact: true }).check();
  for (const v of ['0', '10', '-1', '1e0', '1.0000000001']) {
    await page.getByLabel('报价系数', { exact: true }).fill(v);
    await page.getByRole('button', { name: '保存报价', exact: true }).click();
    await expect(page.getByRole('alert')).not.toBeEmpty();
    await page.getByLabel('报价系数', { exact: true }).fill('0.2');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await expect(page.getByTestId('active-quote')).toContainText('平台默认');
  await page.getByRole('button', { name: '保存报价', exact: true }).click();
  await expect(page.getByTestId('active-quote')).toContainText('0.2');
  await expect(page.getByTestId('accepted-quote')).toContainText('0.1');
  await page.screenshot({ path: '/tmp/bee-task4-pricing.png', fullPage: true });
  await page.getByLabel('报价系数', { exact: true }).fill('0');
  await page.getByRole('button', { name: '保存报价', exact: true }).click();
  await page.getByLabel('使用平台默认', { exact: true }).check();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
for (const scene of ['quote-conflict', 'quote-unknown'])
  test(`${scene} 不将草稿冒充已生效`, async ({ page }) => {
    await earnings(page, scene);
    await page.getByRole('button', { name: '报价设置', exact: true }).click();
    await page.getByLabel('自定义报价系数', { exact: true }).check();
    await page.getByLabel('报价系数', { exact: true }).fill('0.3');
    await page.getByRole('button', { name: '保存报价', exact: true }).click();
    await expect(page.getByTestId('active-quote')).not.toContainText('0.3');
    await expect(page.getByRole('alert')).toContainText(
      scene === 'quote-conflict' ? '版本冲突' : '结果未确认',
    );
  });
for (const [scene, text] of [
  ['earnings-loading', '正在读取收益'],
  ['earnings-error', '收益读取失败'],
  ['earnings-empty', '暂无结算记录'],
])
  test(`${scene} 明确读状态`, async ({ page }) => {
    await earnings(page, scene);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  });
test('页面重载恢复原pending标识且演示session不保存登录或凭证', async ({
  page,
}) => {
  await earnings(page, 'transfer-pending');
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await page.getByLabel('划转金额', { exact: true }).fill('1.000000001');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认划转', exact: true })
    .click();
  const original = await page.getByTestId('pending-transfer').textContent();
  const saved = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([k]) =>
      k.startsWith('bee.demo.finance.'),
    ),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0][0]).toContain('demo-user');
  expect(saved[0][1]).not.toMatch(/loggedIn|password|token|credential/i);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '收益', exact: true })
    .click();
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await expect(page.getByTestId('pending-transfer')).toHaveText(original!);
  await expect(page.getByLabel('划转金额', { exact: true })).toHaveValue(
    '1.000000001',
  );
});
test('并发同标识重放仅扣一次，原版本过期拒绝，存储失败不产生资金操作，损坏会话阻止写入', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createDemoClient } = await import(
      /* @vite-ignore */ String('/src/client/demo.ts')
    );
    const c = createDemoClient('ready');
    const identity = (await c.snapshot()).finance.value.identity;
    const op = {
      type: 'transferEarnings',
      requestId: 'concurrent',
      amount: '1',
      ...identity,
    };
    const pair = await Promise.all([c.dispatch(op), c.dispatch(op)]);
    const state = await c.snapshot();
    const stale = await c.dispatch({
      type: 'saveQuote',
      mode: 'custom',
      factor: '0.5',
      originalVersion: 0,
    });
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as Storage;
    const persisted = createDemoClient('ready', storage);
    await persisted.dispatch({ ...op, requestId: 'saved' });
    const [key, raw] = [...store.entries()][0];
    const saved = JSON.parse(raw);
    delete saved.finance.acceptedQuote;
    store.set(key, JSON.stringify(saved));
    const broken = createDemoClient('ready', storage);
    const corrupt = await broken.snapshot();
    const blocked = await broken.dispatch({ ...op, requestId: 'broken' });
    const failing = createDemoClient('ready', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    } as unknown as Storage);
    const before = await failing.snapshot();
    const rejected = await failing.dispatch(op);
    const after = await failing.snapshot();
    return {
      pair,
      state,
      stale,
      corrupt,
      blocked,
      rejected,
      before: before.earnings,
      after: after.earnings,
    };
  });
  expect(r.pair[0]).toEqual(r.pair[1]);
  expect(r.state.earnings.value.balance).toBe('127.56');
  expect(r.state.finance.value.transfers).toHaveLength(1);
  expect(r.stale.kind).toBe('failed');
  expect(r.rejected.kind).toBe('failed');
  expect(r.before).toEqual(r.after);
  expect(r.corrupt.finance.status).toBe('error');
  expect(r.corrupt.finance.error.message).toContain('acceptedQuote');
  expect(r.blocked.kind).toBe('failed');
});

test('主资金按钮悬停保留可读的深色底与浅色字', async ({ page }) => {
  await earnings(page);
  await page.getByRole('button', { name: '提现', exact: true }).click();
  const button = page.getByRole('button', { name: '提交提现', exact: true });
  const normal = await button.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await button.hover();
  expect(
    await button.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(normal);
});
