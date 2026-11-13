import { expect, test } from '@playwright/test';
import type { Account } from '../src/client/types';

async function accounts(page: import('@playwright/test').Page, scene = 'ready') {
  await page.goto(`/?scene=${scene}`);
  await page.getByRole('navigation').getByRole('button', { name: 'AI 账号', exact: true }).click();
}
test('双入口、检测登录和详情分别表达能力、市场与额度时效', async ({ page }) => {
  await accounts(page, 'empty');
  const openai = page.getByRole('region', { name: 'OpenAI 账号' });
  await expect(openai.getByRole('button', { name: '官方授权接入' })).toBeVisible();
  await openai.getByRole('button', { name: '检测已有登录' }).click();
  await expect(openai).toContainText('dayong@example.com');
  await openai.getByRole('button', { name: '查看详情' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('订阅套餐');
  await expect(sheet).toContainText('账号支持');
  await expect(sheet).toContainText('平台暂未开放');
  await expect(sheet).toContainText('更新时间');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
});
test('官方授权未接通，不伪造接入成功', async ({ page }) => {
  await accounts(page, 'empty');
  const openai = page.getByRole('region', { name: 'OpenAI 账号' });
  await openai.getByRole('button', { name: '官方授权接入' }).click();
  await expect(page.getByRole('status')).toContainText('官方授权尚未接通');
  await expect(openai).toContainText('尚未接入');
});
for (const scene of ['authorization-expired', 'quota-unknown']) {
  test(`${scene} 不伪造额度或可交易状态`, async ({ page }) => {
    await accounts(page, scene);
    await page
      .getByRole('region', { name: 'OpenAI 账号' })
      .getByRole('button', { name: '查看详情' })
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(scene === 'quota-unknown' ? '额度未知' : '授权已失效');
    if (scene === 'authorization-expired') await expect(sheet).not.toContainText('可交易');
  });
}
test('换号明确旧新标识与影响，取消不变、确认保持暂停', async ({ page }) => {
  await accounts(page, 'account-change');
  const openai = page.getByRole('region', { name: 'OpenAI 账号' });
  await openai.getByRole('button', { name: '确认换号' }).click();
  await expect(page.getByRole('dialog')).toContainText('dayong@example.com');
  await expect(page.getByRole('dialog')).toContainText('another@example.com');
  await expect(page.getByRole('dialog')).toContainText('历史收益');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(openai).toContainText('dayong@example.com');
  await openai.getByRole('button', { name: '确认换号' }).click();
  await page.getByRole('button', { name: '确认切换', exact: true }).click();
  await expect(openai).toContainText('another@example.com');
  await expect(openai).toContainText('已暂停');
});
for (const scene of ['removal-pending', 'removal-unknown']) {
  test(`${scene} 保留卡片并停止新任务`, async ({ page }) => {
    await accounts(page, scene);
    const openai = page.getByRole('region', { name: 'OpenAI 账号' });
    await openai.getByRole('button', { name: '移除账号' }).click();
    await expect(page.getByRole('dialog')).toContainText('官方客户端登录和历史收益');
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(openai).toContainText(
      scene === 'removal-pending' ? '移除处理中' : '移除结果未确认',
    );
    await expect(openai).toContainText('dayong@example.com');
    await expect(openai).toContainText('已暂停');
  });
}
test('显式移除记忆、重新接入和收益保留由真实演示适配器保证', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const client = createDemoClient('ready');
    const before = await client.snapshot();
    await client.dispatch({ type: 'removeAccount', platform: 'openai' });
    await client.dispatch({ type: 'detectAccount', platform: 'openai' });
    const detected = await client.snapshot();
    await client.dispatch({ type: 'connectAccount', platform: 'openai' });
    const connected = await client.snapshot();
    return { before, detected, connected };
  });
  expect(result.detected.accounts.value?.some((a: Account) => a.platform === 'openai')).toBe(false);
  expect(
    result.connected.accounts.value?.find((a: Account) => a.platform === 'openai')?.paused,
  ).toBe(true);
  expect(result.connected.process.value?.state).toBe('paused');
  expect(result.connected.earnings).toEqual(result.before.earnings);
});
test('过期授权和未确认移除不能通过检测或恢复绕过，其他平台暂停不变', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const expired = createDemoClient('authorization-expired');
    await expired.dispatch({ type: 'detectAccount', platform: 'openai' });
    const start = await expired.dispatch({
      type: 'startContribution',
      platforms: ['openai'],
    });
    const pending = createDemoClient('removal-unknown');
    await pending.dispatch({ type: 'removeAccount', platform: 'openai' });
    await pending.dispatch({ type: 'connectAccount', platform: 'openai' });
    await pending.dispatch({
      type: 'setPlatformPaused',
      platform: 'openai',
      paused: false,
    });
    const change = createDemoClient('account-change');
    await change.dispatch({ type: 'startContribution', platforms: ['claude'] });
    await change.dispatch({ type: 'confirmAccountChange', platform: 'openai' });
    return {
      start,
      pending: await pending.snapshot(),
      change: await change.snapshot(),
    };
  });
  expect(result.start.kind).toBe('failed');
  expect(
    result.pending.accounts.value?.find((a: Account) => a.platform === 'openai'),
  ).toMatchObject({ state: 'unavailable', paused: true, removal: 'unknown' });
  expect(result.change.accounts.value?.find((a: Account) => a.platform === 'openai')?.paused).toBe(
    true,
  );
  expect(result.change.accounts.value?.find((a: Account) => a.platform === 'claude')?.paused).toBe(
    false,
  );
});

test('任务未知时移除保留卡片和未确认提示', async ({ page }) => {
  await accounts(page, 'unknown-tasks');
  const openai = page.getByRole('region', { name: 'OpenAI 账号' });
  await openai.getByRole('button', { name: '移除账号' }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(openai).toContainText('移除结果未确认');
  await expect(openai).toContainText('dayong@example.com');
  await expect(openai).toContainText('已暂停');
});

for (const [scene, expected] of [
  ['ready', 'confirmed'],
  ['active-tasks', 'pending'],
  ['unknown-tasks', 'unknown'],
  ['tasks-loading', 'unknown'],
  ['tasks-error', 'unknown'],
  ['removal-pending', 'pending'],
  ['removal-unknown', 'unknown'],
] as const) {
  test(`移除收尾守门 ${scene} 返回 ${expected}，重试不能越过未决状态`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (scene) => {
      const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
      const client = createDemoClient(scene);
      const before = await client.snapshot();
      await client.dispatch({ type: 'startContribution', platforms: ['openai'] });
      const removed = await client.dispatch({ type: 'removeAccount', platform: 'openai' });
      const after = await client.snapshot();
      if (after.accounts.value?.some((a: Account) => a.platform === 'openai')) {
        for (const type of [
          'refresh',
          'detectAccount',
          'connectAccount',
          'removeAccount',
        ] as const) {
          await client.dispatch(type === 'refresh' ? { type } : { type, platform: 'openai' });
        }
        await client.dispatch({ type: 'setPlatformPaused', platform: 'openai', paused: false });
      }
      return { before, removed, after, retried: await client.snapshot() };
    }, scene);
    expect(result.removed.kind).toBe(expected);
    expect(result.after.earnings).toEqual(result.before.earnings);
    if (expected === 'confirmed') {
      expect(
        result.after.accounts.value?.find((a: Account) => a.platform === 'openai'),
      ).toBeUndefined();
    } else {
      const retained = { paused: true, state: 'unavailable', removal: expected };
      expect(
        result.after.accounts.value?.find((a: Account) => a.platform === 'openai'),
      ).toMatchObject(retained);
      expect(
        result.retried.accounts.value?.find((a: Account) => a.platform === 'openai'),
      ).toMatchObject(retained);
      expect(result.retried.earnings).toEqual(result.before.earnings);
    }
  });
}
