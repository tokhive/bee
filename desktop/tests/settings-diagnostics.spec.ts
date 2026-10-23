import { expect, test, type Page } from '@playwright/test';
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
test('普通偏好白名单按Hive/当前用户/匿名隔离，不接受带凭据地址', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = await import(/* @vite-ignore */ String('/src/features/settings/preferences.ts'));
    const a = { hive: 'https://a.test', user: 'one' };
    p.savePreferences(localStorage, a, { language: 'en', theme: 'dark', autoStart: true, notifications: false, token: 'SECRET', loggedIn: true });
    const stored = Object.values(localStorage).join('');
    let failure = '';
    try { p.savePreferences(localStorage, a, { proxyAddress: 'socks5://secret:password@localhost:1080' }); } catch(e) { failure = String(e); }
    return { stored, same: p.loadPreferences(localStorage, a), other: p.loadPreferences(localStorage, { ...a, user: 'two' }), anonymous: p.loadPreferences(localStorage, { ...a, user: null }), hive: p.loadPreferences(localStorage, { ...a, hive: 'https://b.test' }), failure };
  });
  expect(result.stored).not.toMatch(/SECRET|token|loggedIn/);
  expect(result.same.theme).toBe('dark');
  for (const item of [result.other, result.anonymous, result.hive]) expect(item.theme).toBe('system');
  expect(result.failure).toContain('hasCredentials=true');
  expect(result.failure).not.toMatch(/secret|password/);
});
test('语言即时覆盖导航/表单/弹窗，系统语言和主题可跟随', async ({ page }) => {
  await page.goto('/?scene=account-change');
  await nav(page, '设置');
  await expect(page.getByLabel('开机启动')).not.toBeChecked();
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Appearance', { exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect(await page.locator('html').evaluate(e => getComputedStyle(e).getPropertyValue('--paper').trim())).toBe('#222426');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.locator('html').evaluate(e => getComputedStyle(e).getPropertyValue('--paper').trim())).toBe('#ffffff');
  await nav(page, 'AI accounts');
  await page.getByRole('region', { name: 'OpenAI account', exact: true }).getByRole('button', { name: 'Confirm account change' }).click();
  await expect(page.getByRole('dialog')).toContainText('Cancel');
  await expect(page.getByRole('dialog')).not.toContainText('取消');
});
test('设置保留普通偏好，切Hive确认后回未登录引导，原资金意图保留', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('bee.demo.transfer-intent.v1.original', 'KEEP'));
  await nav(page, '设置');
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await nav(page, '设置');
  await expect(page.getByLabel('外观', { exact: true })).toHaveValue('dark');
  await page.getByLabel('Hive 地址', { exact: true }).fill('https://other.test');
  await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换 Hive', exact: true }).click();
  await page.getByRole('button', { name: '确认切换 Hive', exact: true }).click();
  await expect(page.getByRole('button', { name: '模拟登录 Hive', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('bee.demo.transfer-intent.v1.original'))).toBe('KEEP');
  await nav(page, '设置');
  await expect(page.getByLabel('外观', { exact: true })).toHaveValue('system');
  await page.reload();
  await expect(page.getByRole('button', { name: '模拟登录 Hive', exact: true })).toBeVisible();
});
test('诊断逐项失败、重试、日志过滤和真实脱敏下载', async ({ page }) => {
  await page.goto('/?scene=diagnostics-partial');
  await nav(page, '诊断');
  await page.getByRole('button', { name: '运行自检', exact: true }).click();
  await expect(page.getByText('代理连通检查失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试自检', exact: true }).click();
  await expect(page.getByText('所有演示检查通过', { exact: true })).toBeVisible();
  await page.getByLabel('日志级别').selectOption('error');
  await expect(page.getByTestId('diagnostic-logs')).not.toContainText('info');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出脱敏报告', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let body = ''; for await (const chunk of stream!) body += chunk.toString();
  expect(body).toContain('Bee');
  expect(body).not.toMatch(/token|Cookie|Authorization|buyer|requestBody|responseBody|SECRET|example.com/i);
});
test('导出失败显示具体失败项，不声称成功', async ({ page }) => {
  await page.goto('/?scene=diagnostics-export-error');
  await nav(page, '诊断');
  await page.getByRole('button', { name: '导出脱敏报告', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '报告文件创建失败' })).toBeVisible();
  await expect(page.getByText('报告已下载', { exact: true })).toHaveCount(0);
});
test('演示通知对同一问题去重，关闭后不再通知，不改系统权限', async ({ page }) => {
  await page.goto('/?scene=authorization-expired');
  await nav(page, '设置');
  await page.getByRole('button', { name: '检查演示通知', exact: true }).click();
  await expect(page.getByTestId('demo-notifications').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '检查演示通知', exact: true }).click();
  await expect(page.getByTestId('demo-notifications').getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('演示通知', { exact: true }).uncheck();
  await page.getByRole('button', { name: '检查演示通知', exact: true }).click();
  await expect(page.getByTestId('demo-notifications').getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText(/不会修改开机启动或系统通知权限/)).toBeVisible();
});

test('系统默认英文、五页与二级页和动态错误无漏译，业务值不变', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const translated = async () => {
    const copy = await page.locator('body').innerText();
    expect(copy).not.toMatch(/[\u4e00-\u9fff]/);
    const attributes = await page.locator('[aria-label], [title], [placeholder]').evaluateAll(nodes => nodes.flatMap(n => ['aria-label', 'title', 'placeholder'].map(a => n.getAttribute(a) ?? '')).join(' '));
    expect(attributes).not.toMatch(/[\u4e00-\u9fff]/);
  };
  await page.goto('/?scene=account-change');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await translated();
  await nav(page, 'AI accounts');
  await translated();
  const account = page.getByRole('region', { name: 'OpenAI account', exact: true });
  await account.getByRole('button', { name: 'View details' }).click();
  await translated();
  await expect(page.getByRole('dialog')).toContainText('dayong@example.com');
  await page.keyboard.press('Escape');
  await account.getByRole('button', { name: 'Confirm account change' }).click();
  await translated();
  await page.keyboard.press('Escape');
  await nav(page, 'Earnings');
  await translated();
  await page.getByRole('button', { name: 'Pricing settings', exact: true }).click();
  await page.getByLabel('Custom pricing factor', { exact: true }).check();
  await page.getByRole('textbox', { name: 'Pricing factor', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await translated();
  await expect(page.getByRole('alert')).toContainText('10');
  await page.getByRole('button', { name: 'Back to earnings' }).click();
  await page.getByRole('button', { name: 'Transfer to buyer balance', exact: true }).click();
  await translated();
  await page.getByLabel('Transfer amount', { exact: true }).fill('1.25');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await translated();
  await expect(page.getByRole('dialog')).toContainText('1.25');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to earnings' }).click();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await translated();
  await nav(page, 'Diagnostics');
  await page.getByRole('button', { name: 'Run self-check', exact: true }).click();
  await expect(page.getByText('All demo checks passed', { exact: true })).toBeVisible();
  await translated();
  await nav(page, 'Settings');
  await page.getByLabel('Proxy address', { exact: true }).fill('http://secret:password@localhost');
  await page.getByRole('button', { name: 'Save proxy', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('hasCredentials=true');
  await expect(page.getByRole('status')).not.toContainText('secret');
  await translated();
  expect(await page.evaluate(async () => [...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  await context.close();
});

test('报告白名单拒绝自由正文和伪装敏感字段，失败存储不静默成功', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { generateReport } = await import(/* @vite-ignore */ String('/src/features/diagnostics/report.ts'));
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const report = generateReport({ checks: [{ id: 'process', passed: true, token: 'SECRET', buyer: 'buyer@example.com' }, { id: 'Authorization', passed: true }], logs: [{ level: 'info', code: 'CHECK_STARTED', Cookie: 'SECRET', requestBody: 'secret', responseBody: 'secret', message: 'SECRET' }, { level: 'error', code: 'Cookie=SECRET' }] });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new Error('QuotaExceededError: test storage full'); };
    let failure;
    try { const client = createDemoClient('ready'); failure = await client.dispatch({ type: 'setPreference', preferences: { theme: 'dark' } }); }
    finally { Storage.prototype.setItem = original; }
    return { report, failure };
  });
  expect(result.report).not.toMatch(/token|Cookie|Authorization|buyer|requestBody|responseBody|SECRET|example.com/i);
  expect(result.failure.kind).toBe('failed');
  expect(result.failure.error.message).toContain('QuotaExceededError');
});

test('匿名身份与名为anonymous的真实用户、带点复合scope均不可碰撞', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = await import(/* @vite-ignore */ String('/src/features/settings/preferences.ts'));
    const anonymous = p.preferenceScope('https://same.test', { loggedIn: false, state: 'unbound' });
    const user = p.preferenceScope('https://same.test', { loggedIn: true, userId: 'anonymous', state: 'bound' });
    p.savePreferences(localStorage, user, { theme: 'dark' });
    const anonymousTheme = p.loadPreferences(localStorage, anonymous).theme;
    const a = { hive: 'https://hive.a', user: 'b.c' }, b = { hive: 'https://hive.a.b', user: 'c' };
    p.savePreferences(localStorage, a, { language: 'en' });
    const otherLanguage = p.loadPreferences(localStorage, b).language;
    p.savePreferences(localStorage, b, { theme: 'light' });
    return { anonymousTheme, otherLanguage, original: p.loadPreferences(localStorage, a) };
  });
  expect.soft(result.anonymousTheme).toBe('system');
  expect.soft(result.otherLanguage).toBe('system');
  expect(result.original.language).toBe('en');
  expect(result.original.theme).toBe('system');
});

test('切Hive刷新后登录与绑定的资金身份来自当前Hive和Binding', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    let client = createDemoClient('ready');
    await client.dispatch({ type: 'changeHive', address: 'https://new.test' });
    client = createDemoClient('ready');
    const before = await client.snapshot();
    await client.dispatch({ type: 'loginHive' });
    await client.dispatch({ type: 'bindDevice' });
    const after = await client.snapshot();
    return { before: before.binding.value, hive: after.preferences.value.hiveAddress, identity: after.finance.value.identity, userId: after.binding.value.userId };
  });
  expect(result.before.loggedIn).toBe(false);
  expect(result.identity.hive).toBe(result.hive);
  expect(result.identity.user).toBe(result.userId);
});

test('英文错误插值和连接标签保留中文用户输入原值', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage(); await page.goto('/');
  await nav(page, 'Earnings');
  await page.getByRole('button', { name: 'Pricing settings', exact: true }).click();
  await page.getByLabel('Custom pricing factor', { exact: true }).check();
  await page.getByRole('textbox', { name: 'Pricing factor', exact: true }).fill('收益');
  await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await expect.soft(page.getByRole('alert')).toContainText('“收益”');
  await nav(page, 'Settings');
  await page.getByLabel('Hive address', { exact: true }).fill('https://hive.test/收益');
  await page.getByRole('button', { name: 'Switch Hive', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Hive switch', exact: true }).click();
  await expect(page.getByText('https://hive.test/收益', { exact: true })).toBeVisible();
  await context.close();
});

test('系统语言事件、显式浅深主题、可见焦点与代理校验均保持演示范围', async ({ page }) => {
  await page.goto('/'); await nav(page, '设置');
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.locator('html').evaluate(e => getComputedStyle(e).getPropertyValue('--paper').trim())).toBe('#222426');
  await page.getByLabel('外观', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await page.locator('html').evaluate(e => getComputedStyle(e).getPropertyValue('--paper').trim())).toBe('#ffffff');
  await page.getByLabel('语言', { exact: true }).focus();
  await page.keyboard.press('Tab');
  const outline = await page.locator(':focus').evaluate(e => getComputedStyle(e).outlineWidth);
  expect(outline).toBe('2px');
  await page.getByLabel('代理地址', { exact: true }).fill('socks5://localhost:1080');
  await page.getByRole('button', { name: '保存代理', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('未修改系统代理');
  await page.reload(); await nav(page, '设置');
  await expect(page.getByLabel('代理地址', { exact: true })).toHaveValue('socks5://localhost:1080');
  await page.evaluate(() => { Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' }); window.dispatchEvent(new Event('languagechange')); });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Language', { exact: true }).selectOption('zh');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});

test('通知四类问题均去重，普通短暂离线不伪称持续离线', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const { notificationIssues } = await import(/* @vite-ignore */ String('/src/features/settings/notifications.ts'));
    const onboarding = await createDemoClient('onboarding').snapshot();
    const transient = notificationIssues(onboarding);
    const state = await createDemoClient('ready').snapshot();
    state.accounts.value[0].authorization = 'expired'; state.accounts.value[0].pendingChange = { identifier: 'different' }; state.accounts.value[0].quota.remaining = 0;
    state.connection.value.state = 'disconnected'; state.connection.value.persistentOffline = true;
    return { transient, issues: notificationIssues(state) };
  });
  expect(result.transient).toEqual([]);
  expect(new Set(result.issues).size).toBe(4);
});

test('真实下载API失败保留错误证据并允许重试，不假称文件已交付', async ({ page }) => {
  await page.goto('/'); await nav(page, '诊断');
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('blob-create-denied: test'); }; });
  await page.getByRole('button', { name: '导出脱敏报告', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('blob-create-denied');
  await expect(page.getByRole('status')).toContainText('未确认完成');
  await expect(page.getByRole('button', { name: '导出脱敏报告', exact: true })).toBeEnabled();
});

test('损坏偏好或不安全的已选Hive读取失败时不借用旧登录，不回显秘密', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const { savePreferences, defaultHive } = await import(/* @vite-ignore */ String('/src/features/settings/preferences.ts'));
    savePreferences(localStorage, { hive: defaultHive, user: 'demo-user' }, { theme: 'dark' });
    const key = Object.keys(localStorage).find(k => k.startsWith('bee.demo.preferences.'))!;
    localStorage.setItem(key, '{"token":"SECRET"');
    const corrupt = await createDemoClient('ready').snapshot();
    localStorage.removeItem(key);
    localStorage.setItem('bee.demo.selected-hive.v1', 'https://secret:password@hive.test');
    const unsafe = await createDemoClient('ready').snapshot();
    return { corrupt, unsafe };
  });
  for (const state of [result.corrupt, result.unsafe]) {
    expect.soft(state.binding.value.loggedIn).toBe(false);
    expect.soft(state.accounts.value).toEqual([]);
    expect(state.preferences.status).toBe('error');
    expect(state.preferences.error.message).not.toMatch(/SECRET|secret|password/);
  }
});

test('英文异步失败/未确认/空/加载场景及弹层无漏译', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const check = async () => { expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/); };
  for (const scene of ['onboarding', 'configured', 'loading', 'empty', 'error', 'offline', 'unknown', 'tasks-error', 'earnings-error', 'earnings-loading']) {
    await page.goto(`/?scene=${scene}`);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await check();
    if (scene === 'configured') { await page.getByRole('button', { name: 'Bind this device', exact: true }).click(); await check(); await page.keyboard.press('Escape'); }
    if (['loading', 'error', 'empty'].includes(scene)) { await nav(page, 'AI accounts'); await check(); }
    if (scene.startsWith('earnings-')) { await nav(page, 'Earnings'); await check(); }
  }
  for (const scene of ['pending', 'unknown-result', 'operation-error']) {
    await page.goto(`/?scene=${scene}`);
    await page.getByRole('button', { name: 'Simulate login to Hive', exact: true }).click();
    await expect(page.getByRole('status')).not.toContainText('Processing demo action'); await check();
  }
  for (const scene of ['quote-conflict', 'quote-unknown']) {
    await page.goto(`/?scene=${scene}`); await nav(page, 'Earnings');
    await page.getByRole('button', { name: 'Pricing settings', exact: true }).click();
    await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible(); await check();
  }
  await page.goto('/?scene=transfer-unknown'); await nav(page, 'Earnings');
  await page.getByRole('button', { name: 'Transfer to buyer balance', exact: true }).click();
  await page.getByLabel('Transfer amount', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm transfer', exact: true }).click();
  await expect(page.getByText('Result unconfirmed', { exact: false }).first()).toBeVisible(); await check();
  expect(await page.evaluate(async () => [...(await import(/* @vite-ignore */ String('/src/i18n/index.ts'))).missingTranslations])).toEqual([]);
  await context.close();
});

test('浅深主题正文/次要文字/金色标签与焦点均具有足够对比', async ({ page }) => {
  await page.goto('/'); await nav(page, '设置');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('外观', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const ratios = await page.locator('html').evaluate(root => {
      const css = getComputedStyle(root);
      const luminance = (hex: string) => {
        const color = hex.trim().replace('#', '');
        const channels = [0, 2, 4].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return channels.reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      };
      const ratio = (a: string, b: string) => { const x = luminance(css.getPropertyValue(a)), y = luminance(css.getPropertyValue(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      return { text: ratio('--ink', '--paper'), muted: ratio('--muted', '--paper'), badge: ratio('--accent-ink', '--accent-soft'), focus: ratio('--accent', '--paper') };
    });
    expect(ratios.text).toBeGreaterThanOrEqual(4.5);
    expect(ratios.muted).toBeGreaterThanOrEqual(4.5);
    expect(ratios.badge).toBeGreaterThanOrEqual(4.5);
    expect(ratios.focus).toBeGreaterThanOrEqual(3);
  }
});

for (const fault of ['corrupt', 'read-error']) {
  test(`审查I1：非默认Hive登录偏好${fault}失败不提交身份或跨scope写入，可原位重试`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (fault) => {
      const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
      const hive = 'https://scope-review.test';
      const key = `bee.demo.preferences.v1.${encodeURIComponent(JSON.stringify([hive, 'demo-user']))}`;
      const client = createDemoClient('ready');
      await client.dispatch({ type: 'changeHive', address: hive });
      localStorage.setItem(key, '{broken');
      const beforeStorage = JSON.stringify({ ...localStorage });
      const beforeSession = JSON.stringify({ ...sessionStorage });
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function(k) { if (fault === 'read-error' && k === key) throw new Error('test user scope read unavailable'); return get.call(this, k); };
      let login;
      try { login = await client.dispatch({ type: 'loginHive' }); }
      finally { Storage.prototype.getItem = get; }
      const failed = await client.snapshot();
      const theme = await client.dispatch({ type: 'setPreference', preferences: { theme: 'dark' } });
      const proxy = await client.dispatch({ type: 'saveProxy', address: 'socks5://proxy.test' });
      const afterStorage = JSON.stringify({ ...localStorage });
      const afterSession = JSON.stringify({ ...sessionStorage });
      localStorage.removeItem(key);
      const retry = await client.dispatch({ type: 'loginHive' });
      await client.dispatch({ type: 'setPreference', preferences: { theme: 'dark' } });
      return { login, failed, theme, proxy, beforeStorage, afterStorage, beforeSession, afterSession, retry, restored: await client.snapshot(), saved: JSON.parse(localStorage.getItem(key)!) };
    }, fault);
    expect.soft(result.login.kind).toBe('failed');
    expect.soft(result.failed.binding.value.loggedIn).toBe(false);
    expect.soft(result.failed.preferences.value.hiveAddress).toBe('https://scope-review.test');
    expect.soft(result.failed.finance.value.identity.hive).toBe('https://scope-review.test');
    expect.soft(result.theme.kind).toBe('failed');
    expect.soft(result.proxy.kind).toBe('failed');
    expect.soft(result.afterStorage).toBe(result.beforeStorage);
    expect.soft(result.afterSession).toBe(result.beforeSession);
    expect(result.retry.kind).toBe('confirmed');
    expect(result.restored.finance.value.identity).toEqual({ hive: 'https://scope-review.test', user: 'demo-user' });
    expect(result.saved.theme).toBe('dark');
  });
}

test('审查I2：英文公共弹层只翻译一次，保留匹配词典的中文业务值', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { default: React } = await import(/* @vite-ignore */ String('/node_modules/.vite/deps/react.js'));
    const { default: { createRoot } } = await import(/* @vite-ignore */ String('/node_modules/.vite/deps/react-dom_client.js'));
    const { useLanguage } = await import(/* @vite-ignore */ String('/src/i18n/index.ts'));
    const { AccountActions } = await import(/* @vite-ignore */ String('/src/features/accounts/AccountActions.tsx'));
    const { AccountDetails } = await import(/* @vite-ignore */ String('/src/features/accounts/AccountDetails.tsx'));
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const snapshot = await createDemoClient('ready').snapshot();
    const account = { ...snapshot.accounts.value[0], label: '收益', identifier: '收益', pendingChange: { identifier: '账号' } };
    function Harness() { useLanguage('en'); return React.createElement(React.Fragment, null, React.createElement(AccountActions, { platform: account.platform, account, busy: false, dispatch: async () => {} }), React.createElement(AccountDetails, { account })); }
    createRoot(document.getElementById('root')!).render(React.createElement(Harness));
  });
  await page.getByRole('button', { name: 'Confirm account change', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('收益');
  await expect(page.getByRole('dialog')).toContainText('账号');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toContainText('收益');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
});
