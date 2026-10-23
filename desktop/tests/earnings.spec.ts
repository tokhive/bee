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
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
  await expect(page.getByRole('dialog')).toHaveCount(0);
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

test('dispatch reject且没有snapshot pending时，原提交守门跨重进和刷新保留，missing核对不能解除', async ({
  page,
}) => {
  await page.route(
    '**/src/features/earnings/EarningsPage.tsx',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source).toContain('client.dispatch(command)');
      const body = source.replace(
        'client.dispatch(command)',
        '(window.task4Commands = [...(window.task4Commands || []), command], command.type === "transferEarnings" ? Promise.reject(new Error("injected dispatch rejection without snapshot pending")) : client.dispatch(command))',
      );
      await route.fulfill({ response, body });
    },
  );
  await earnings(page);
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await page.getByLabel('划转金额', { exact: true }).fill('1.000000001');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认划转', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'injected dispatch rejection',
  );
  await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '全部收益', exact: true }),
  ).toBeDisabled();
  const original = await page.getByTestId('pending-transfer').textContent();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { task4Commands: Record<string, string>[] })
        .task4Commands,
  );
  expect(commands).toHaveLength(1);
  const originalCommand = commands[0];
  await page.getByRole('button', { name: '返回收益' }).click();
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await expect(page.getByTestId('pending-transfer')).toHaveText(original!);
  await page.getByRole('button', { name: '刷新原操作', exact: true }).click();
  await page.getByRole('button', { name: '核对原操作', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('record=missing');
  await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
  const checked = await page.evaluate(() =>
    (
      window as unknown as { task4Commands: Record<string, string>[] }
    ).task4Commands.filter((c) => c.type === 'checkTransfer'),
  );
  expect(checked[0]).toEqual({ ...originalCommand, type: 'checkTransfer' });
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
  await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '核对划转', exact: true }),
  ).toHaveCount(0);
});

test('目标余额恰好15/9上界可入账，超1最小单位拒绝且源目标流水存储均不变，重放不二次累加', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createDemoClient } = await import(
      /* @vite-ignore */ String('/src/client/demo.ts')
    );
    const max = '999999999999999.999999999';
    async function setup(buyer: string) {
      const map = new Map<string, string>();
      const storage = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          map.set(k, v);
        },
      } as Storage;
      const seed = createDemoClient('ready', storage);
      const identity = (await seed.snapshot()).finance.value.identity;
      await seed.dispatch({
        type: 'transferEarnings',
        requestId: 'seed',
        amount: '1',
        ...identity,
      });
      const [key, raw] = [...map.entries()][0];
      const saved = JSON.parse(raw);
      saved.balance = max;
      saved.finance.buyerBalance = buyer;
      saved.finance.transfers = [];
      delete saved.finance.pendingTransfer;
      map.set(key, JSON.stringify(saved));
      return { client: createDemoClient('ready', storage), map, identity };
    }
    const exact = await setup('999999999999999.999999998');
    const command = {
      type: 'transferEarnings',
      requestId: 'boundary',
      amount: '0.000000001',
      ...exact.identity,
    };
    const accepted = await exact.client.dispatch(command);
    const once = await exact.client.snapshot();
    const replay = await exact.client.dispatch(command);
    const twice = await exact.client.snapshot();
    const overflow = await setup(max);
    const before = await overflow.client.snapshot();
    const rawBefore = [...overflow.map.entries()];
    const rejected = await overflow.client.dispatch({
      ...command,
      ...overflow.identity,
    });
    const after = await overflow.client.snapshot();
    const rawAfter = [...overflow.map.entries()];
    const maximum = await setup('0');
    const full = await maximum.client.dispatch({
      ...command,
      ...maximum.identity,
      amount: max,
    });
    const fullState = await maximum.client.snapshot();
    return {
      accepted,
      replay,
      once,
      twice,
      rejected,
      before,
      after,
      rawBefore,
      rawAfter,
      full,
      fullState,
    };
  });
  expect(r.accepted.kind).toBe('confirmed');
  expect(r.replay).toEqual(r.accepted);
  expect(r.once).toEqual(r.twice);
  expect(r.once.finance.value.buyerBalance).toBe('999999999999999.999999999');
  expect(r.rejected.kind).toBe('failed');
  expect(r.rejected.error.message).toContain('1000000000000000');
  expect(r.rejected.error.message).toContain('999999999999999.999999999');
  expect(r.after).toEqual(r.before);
  expect(r.rawAfter).toEqual(r.rawBefore);
  expect(r.full.kind).toBe('confirmed');
  expect(r.fullState.earnings.value.balance).toBe('0');
  expect(r.fullState.finance.value.buyerBalance).toBe(
    '999999999999999.999999999',
  );
});

test('已入账但dispatch reject时保留原意图，核对明确confirmed才解除且不再扣款', async ({
  page,
}) => {
  await page.route(
    '**/src/features/earnings/EarningsPage.tsx',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source).toContain('client.dispatch(command)');
      await route.fulfill({
        response,
        body: source.replace(
          'client.dispatch(command)',
          'client.dispatch(command).then(result => { if (command.type === "transferEarnings") throw new Error("lost accepted response"); return result; })',
        ),
      });
    },
  );
  await earnings(page);
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await page.getByLabel('划转金额', { exact: true }).fill('1');
  await page.getByRole('button', { name: '核对划转', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认划转', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('lost accepted response');
  await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
  await expect(page.getByTestId('transfer-available')).toContainText('127.56');
  await page.getByRole('button', { name: '返回收益' }).click();
  await page
    .getByRole('button', { name: '划转至买家余额', exact: true })
    .click();
  await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对原操作', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('演示划转已完成');
  await expect(page.getByLabel('划转金额', { exact: true })).toBeEnabled();
  await expect(page.getByTestId('transfer-available')).toContainText('127.56');
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith('bee.demo.transfer-intent.'),
      ),
    ),
  ).toEqual([]);
});

for (const fault of ['read', 'write', 'corrupt'])
  test(`演示意图${fault}故障fail-closed且不调用划转`, async ({ page }) => {
    await earnings(page);
    await page.evaluate((fault) => {
      const prefix = 'bee.demo.transfer-intent.';
      if (fault === 'corrupt')
        sessionStorage.setItem(
          `${prefix}v1.ready.Hive%20%E6%BC%94%E7%A4%BA%E8%BF%9E%E6%8E%A5.demo-user`,
          'not-json',
        );
      if (fault === 'read') {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k) {
          if (k.startsWith(prefix))
            throw new Error('injected intent read fault');
          return original.call(this, k);
        };
      }
      if (fault === 'write') {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k.startsWith(prefix))
            throw new Error('injected intent write fault');
          return original.call(this, k, v);
        };
      }
    }, fault);
    await page
      .getByRole('button', { name: '划转至买家余额', exact: true })
      .click();
    if (fault === 'write') {
      await page.getByLabel('划转金额', { exact: true }).fill('1');
      await page.getByRole('button', { name: '核对划转', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '确认划转', exact: true })
        .click();
    }
    await expect(page.getByRole('alert')).toContainText(
      fault === 'write' ? '意图保存失败' : '意图读取失败',
    );
    await expect(page.getByLabel('划转金额', { exact: true })).toBeDisabled();
    await expect(page.getByTestId('transfer-available')).toContainText(
      '128.56',
    );
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith('bee.demo.finance.'),
        ),
      ),
    ).toEqual([]);
  });

test('意图模块只接受原完整身份与参数，missing/generic failed/unknown不清除，明确演示原子拒绝可解除', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createTransferIntentStore } = await import(
      /* @vite-ignore */ String('/src/features/earnings/transferIntent.ts')
    );
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    } as Storage;
    const identity = { hive: 'demo-hive', user: 'demo-user' };
    const op = {
      ...identity,
      requestId: 'original-guard',
      amount: '1.000000001',
    };
    const store = createTransferIntentStore(identity, storage, 'ready');
    store.begin(op);
    const retained = [];
    for (const [phase, result] of [
      [
        'check',
        {
          kind: 'failed',
          error: { code: 'DEMO_TRANSFER_NOT_FOUND', message: 'record=missing' },
        },
      ],
      [
        'submit',
        { kind: 'failed', error: { code: 'GENERIC', message: 'unknown' } },
      ],
      [
        'submit',
        { kind: 'unknown', operationId: op.requestId, message: 'unknown' },
      ],
    ]) {
      store.settle(op, result, phase);
      retained.push(store.read());
    }
    const conflicts = [];
    for (const changed of [
      { ...op, requestId: 'new' },
      { ...op, amount: '2' },
      { ...op, user: 'other' },
      { ...op, hive: 'other' },
    ]) {
      try {
        store.begin(changed);
        conflicts.push(false);
      } catch {
        conflicts.push(true);
      }
    }
    store.settle(
      op,
      {
        kind: 'failed',
        error: {
          code: 'DEMO_TRANSFER_BALANCE',
          message: 'rejected before commit',
        },
      },
      'submit',
    );
    return { retained, conflicts, after: store.read(), op };
  });
  expect(r.retained).toEqual([r.op, r.op, r.op]);
  expect(r.conflicts).toEqual([true, true, true, true]);
  expect(r.after).toBeUndefined();
});

test('明确confirmed但意图删除失败时继续守门，原记录完整保留供再次核对', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createTransferIntentStore } = await import(
      /* @vite-ignore */ String('/src/features/earnings/transferIntent.ts')
    );
    const map = new Map<string, string>();
    let failRemove = true;
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        if (failRemove) throw new Error('injected removal fault');
        map.delete(k);
      },
    } as Storage;
    const op = {
      hive: 'hive',
      user: 'user',
      requestId: 'original',
      amount: '1',
    };
    const store = createTransferIntentStore(op, storage, 'ready');
    store.begin(op);
    let error = '';
    try {
      store.settle(
        op,
        { kind: 'confirmed', demo: true, message: 'confirmed' },
        'check',
      );
    } catch (cause) {
      error = String(cause);
    }
    const retained = store.read();
    failRemove = false;
    store.settle(
      op,
      { kind: 'confirmed', demo: true, message: 'confirmed' },
      'check',
    );
    return { error, retained, after: store.read(), op };
  });
  expect(result.error).toContain('injected removal fault');
  expect(result.retained).toEqual(result.op);
  expect(result.after).toBeUndefined();
});
