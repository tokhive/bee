import { expect, test } from '@playwright/test';
import type { Account } from '../src/client/types';

test('首次接入可中断继续，只接入所选平台，绑定检测不会自动贡献', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url());
  });
  await page.goto('/?scene=onboarding');
  await expect(page.getByRole('heading', { name: '首次接入' })).toBeVisible();
  await page.getByRole('button', { name: '模拟登录 Hive', exact: true }).click();
  await page.getByRole('button', { name: '绑定本机设备', exact: true }).click();
  await page.getByRole('button', { name: '检测 OpenAI', exact: true }).click();
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(page.getByText('本机已绑定', { exact: true })).toBeVisible();
  await page.getByLabel('选择 OpenAI').check();
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
  await expect(page.getByRole('region', { name: 'Claude 供给' })).toContainText('尚未接入');
  expect(requests).toEqual([]);
});

test('未登录能修改 Hive/代理/外观，账号与收益受接入门槛保护', async ({ page }) => {
  await page.goto('/?scene=onboarding');
  for (const name of ['AI 账号', '收益']) {
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    await expect(page.getByText('请先完成 Hive 登录与设备绑定')).toBeVisible();
    await expect(page.getByText('128.56', { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('Hive 地址').fill('https://demo.example');
  await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '确认切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('代理地址').fill('http://127.0.0.1:7890');
  await page.getByRole('button', { name: '保存代理', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仅演示');
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(page.getByText('https://demo.example', { exact: true })).toBeVisible();
  await expect(page.getByText(/dayong@example|another@example/)).toHaveCount(0);
});

test('已有配置仍需确认绑定，替换设备需明确确认', async ({ page }) => {
  await page.goto('/?scene=configured');
  await expect(page.getByText('已有 Bee 配置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '绑定本机设备', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '替换已绑定设备？' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('本机已绑定', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '绑定本机设备', exact: true }).click();
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByText('本机已绑定', { exact: true })).toBeVisible();
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
});

test('外部 Bee 只读且不会默认接管', async ({ page }) => {
  await page.goto('/?scene=external');
  await expect(page.getByText('外部管理的 Bee', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
  await expect(page.getByText('仅查看；不会复制配置或终止外部进程。')).toBeVisible();
});

test('离线与未知状态不显示就绪，旧收益保留时间与处理入口', async ({ page }) => {
  await page.goto('/?scene=offline');
  await expect(page.getByText('Hive 连接已断开', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: '收益摘要' })).toContainText('128.56');
  await expect(page.getByText(/上次更新：/).first()).toBeVisible();
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '诊断', exact: true })).toBeVisible();
  await page.goto('/?scene=unknown');
  await expect(page.getByText('Hive 状态未知', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
});

test('全部暂停逐平台反馈部分失败，单平台可恢复且刷新保留主动暂停', async ({ page }) => {
  await page.goto('/?scene=partial');
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  await page.getByRole('button', { name: '暂停贡献', exact: true }).click();
  await page.getByRole('button', { name: '确认暂停', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('已暂停');
  await expect(page.getByRole('region', { name: 'Claude 供给' })).toContainText('暂停失败');
  await page.getByRole('button', { name: '恢复 OpenAI', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
  await page.getByRole('button', { name: '暂停 OpenAI', exact: true }).click();
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('已暂停');
});

test('命令验证实际前置条件，并覆盖 pending/unknown/failed 结果', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const fresh = createDemoClient('onboarding');
    const denied = await fresh.dispatch({
      type: 'startContribution',
      platforms: ['openai'],
    });
    const unknown = createDemoClient('unknown');
    const refused = await unknown.dispatch({
      type: 'startContribution',
      platforms: ['openai'],
    });
    return { denied, refused };
  });
  expect(result.denied.kind).toBe('failed');
  expect(JSON.stringify(result.denied)).toContain('unbound');
  expect(result.refused.kind).toBe('failed');
  expect(JSON.stringify(result.refused)).toContain('loading');
  for (const [scene, expected] of [
    ['pending', '处理中'],
    ['unknown-result', '结果未确认'],
    ['operation-error', '登录失败'],
  ]) {
    await page.goto('/?scene=' + scene);
    await page.getByRole('button', { name: '模拟登录 Hive', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(expected);
    await expect(page.getByRole('button', { name: '绑定本机设备', exact: true })).toBeDisabled();
  }
});

test('明确选择的平台才开始贡献，未选平台保持暂停', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 Claude').uncheck();
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
  await expect(page.getByRole('region', { name: 'Claude 供给' })).toContainText('已暂停');
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('82%');
  await expect(page.getByRole('region', { name: 'Claude 供给' })).toContainText('48 分钟后重置');
});

test('本机进程读取失败保留证据、时间和处理入口，不采用旧进程值作为就绪', async ({ page }) => {
  await page.route('**/src/client/demo.ts', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'const listeners = new Set',
      `state.process = {status:'error', updatedAt:'2026-10-22T12:00:00Z', value:{state:'paused',owner:'app'}, error:{code:'PROCESS_UNCONFIRMED',message:'本机进程检查失败：管理状态读取超时。'}}; const listeners = new Set`,
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('PROCESS_UNCONFIRMED');
  await expect(page.getByRole('alert')).toContainText('2026-10-22T12:00:00Z');
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeVisible();
});

test('本机进程已停止时不能贡献', async ({ page }) => {
  await page.route('**/src/client/demo.ts', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'const listeners = new Set',
      `state.process = ready({state:'stopped',owner:'app'}); const listeners = new Set`,
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.getByText('本机进程：未运行', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    return createDemoClient('ready').dispatch({ type: 'startContribution', platforms: ['openai'] });
  });
  expect(result.kind).toBe('failed');
  expect(JSON.stringify(result)).toContain('stopped');
});

test('切换 Hive 不会把外部 Bee 归属改为 App，也不把未知归属当作就绪', async ({ page }) => {
  await page.goto('/?scene=external');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('Hive 地址').fill('https://demo.example');
  await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '确认切换 Hive', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仅演示');
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(page.getByText('外部管理的 Bee', { exact: true })).toBeVisible();
  await page.route('**/src/client/demo.ts', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'const listeners = new Set',
      `state.process = ready({state:'paused'}); const listeners = new Set`,
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
});

test('无效设置保留输入和当前绑定，不泄露地址中的凭证', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('Hive 地址').fill('https://user:secret@example.com');
  await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '确认切换 Hive', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('DEMO_INVALID_ADDRESS');
  await expect(page.getByRole('status')).not.toContainText('secret');
  await expect(page.getByLabel('Hive 地址')).toHaveValue('https://user:secret@example.com');
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeEnabled();
});

test('审查 I1：首次开始前恢复不可绕过选择，明确开始后引导结束并允许正常恢复', async ({ page }) => {
  await page.goto('/?scene=onboarding');
  await page.getByRole('button', { name: '模拟登录 Hive', exact: true }).click();
  await page.getByRole('button', { name: '绑定本机设备', exact: true }).click();
  await page.getByRole('button', { name: '检测 OpenAI', exact: true }).click();
  await page.getByLabel('选择 OpenAI').uncheck();
  await expect(page.getByRole('button', { name: '恢复 OpenAI', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '恢复全部就绪平台', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toBeDisabled();
  await page.getByLabel('选择 OpenAI').check();
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  await expect(page.getByRole('heading', { name: '首次接入' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
  await page.getByRole('button', { name: '暂停 OpenAI', exact: true }).click();
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('已暂停');
  await page.getByRole('button', { name: '恢复 OpenAI', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
  await page.getByRole('button', { name: '暂停 OpenAI', exact: true }).click();
  await page.getByRole('button', { name: '恢复全部就绪平台', exact: true }).click();
  await expect(page.getByRole('region', { name: 'OpenAI 供给' })).toContainText('贡献中');
});

test('审查 M1：partial 暂停失败反馈保留的实际暂停状态', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const client = createDemoClient('partial');
    await client.dispatch({ type: 'setPlatformPaused', platform: 'claude', paused: true });
    const paused = (await client.snapshot()).accounts.value?.find((a: Account) => a.platform === 'claude');
    await client.dispatch({ type: 'startContribution', platforms: ['claude'] });
    await client.dispatch({ type: 'setAllPaused', paused: true });
    const active = (await client.snapshot()).accounts.value?.find((a: Account) => a.platform === 'claude');
    return { paused, active };
  });
  expect(result.paused?.paused).toBe(true);
  expect(result.paused?.feedback).toContain('当前已暂停');
  expect(result.paused?.feedback).not.toContain('仍贡献中');
  expect(result.active?.paused).toBe(false);
  expect(result.active?.feedback).toContain('当前仍贡献中');
});

test('审查 M2：地址失败区分协议凭证查询片段与解析，不回显秘密并保留输入', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const [input, evidence] of [
    ['ftp://example.com', 'protocol=ftp:'],
    ['https://user:secret@example.com', 'hasCredentials=true'],
    ['https://example.com?token=secret', 'hasQuery=true'],
    ['https://example.com#secret', 'hasFragment=true'],
    ['secret invalid address', 'parse=failed'],
  ]) {
    await page.getByLabel('Hive 地址').fill(input);
    await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
    await page.getByRole('button', { name: '确认切换 Hive', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(evidence);
    await expect(page.getByRole('status')).not.toContainText('secret');
    await expect(page.getByLabel('Hive 地址')).toHaveValue(input);
  }
});

test('审查 I1：客户端拒绝首次开始前的单平台及全部恢复', async ({ page }) => {
  await page.goto('/');
  const guarded = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const client = createDemoClient('onboarding');
    await client.dispatch({ type: 'loginHive' });
    await client.dispatch({ type: 'bindDevice' });
    await client.dispatch({ type: 'detectAccount', platform: 'openai' });
    const single = await client.dispatch({
      type: 'setPlatformPaused',
      platform: 'openai',
      paused: false,
    });
    const all = await client.dispatch({ type: 'setAllPaused', paused: false });
    return { single, all, state: await client.snapshot() };
  });
  expect(guarded.single.kind).toBe('failed');
  expect(guarded.all.kind).toBe('failed');
  expect(JSON.stringify(guarded.single)).toContain('onboardingComplete=false');
  expect(guarded.state.accounts.value?.[0].paused).toBe(true);
  expect(guarded.state.binding.value?.onboardingComplete).toBe(false);
});
