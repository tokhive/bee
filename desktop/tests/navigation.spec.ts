import { expect, test } from '@playwright/test';

test('银白壳的五页可达，演示标识始终可见且业务操作不发网络请求', async ({ page }) => {
  const businessRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || ['fetch', 'xhr'].includes(request.resourceType()))
      businessRequests.push(request.url());
  });
  await page.goto('/');
  for (const name of ['概览', 'AI 账号', '收益', '诊断', '设置']) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('演示数据', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仅演示');
  await expect(page.getByText('演示贡献中', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停贡献', exact: true }).click();
  await page.getByRole('button', { name: '确认暂停', exact: true }).click();
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
  expect(businessRequests).toEqual([]);
});

test('抽屉与确认弹窗约束焦点，Escape 关闭并恢复焦点', async ({ page }) => {
  await page.goto('/');
  const details = page.getByRole('button', { name: '查看连接详情' });
  await details.click();
  const sheet = page.getByRole('dialog', { name: '连接详情' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(sheet.getByRole('button', { name: '关闭' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: '关闭' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(details).toBeFocused();
  await page.getByRole('button', { name: '开始贡献', exact: true }).click();
  const pause = page.getByRole('button', { name: '暂停贡献', exact: true });
  await pause.click();
  const dialog = page.getByRole('dialog', { name: '暂停演示贡献？' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '确认暂停' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(pause).toBeFocused();
});

test('未知场景拒绝载入，不降级为演示成功', async ({ page }) => {
  await page.goto('/?scene=not-a-scene');
  await expect(page.getByRole('alert')).toContainText('not-a-scene');
  await expect(page.getByText('演示数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献', exact: true })).toHaveCount(0);
});

test('客户端拒绝未知场景、清理订阅，非演示模式保持未接通', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createDemoClient } = await import(/* @vite-ignore */ String('/src/client/demo.ts'));
    const { createBusinessClient } = await import(/* @vite-ignore */ String('/src/client/client.ts'));
    let unknown = '';
    try {
      createDemoClient('invalid-scene');
    } catch (error) {
      unknown = String(error);
    }
    const client = createDemoClient('ready');
    let updates = 0;
    const off = client.subscribe(() => {
      updates++;
    });
    await client.dispatch({ type: 'contribution.start' });
    off();
    off();
    const before = updates;
    await client.dispatch({ type: 'contribution.pause' });
    const live = createBusinessClient('production');
    return {
      unknown,
      before,
      after: updates,
      mode: (await live.snapshot()).mode,
      result: await live.dispatch({ type: 'contribution.start' }),
    };
  });
  expect(result.unknown).toContain('invalid-scene');
  expect(result.before).toBeGreaterThan(0);
  expect(result.after).toBe(result.before);
  expect(result.mode).toBe('unavailable');
  expect(result.result.kind).toBe('unsupported');
});

test('demo stays isolated from real device and supply commands even inside a native shell', async ({ page }) => {
 await page.addInitScript(()=>{
  const runtime=window as unknown as {isTauri:boolean;__TAURI_INTERNALS__:unknown;__TAURI_EVENT_PLUGIN_INTERNALS__:unknown;nativeCalls:string[]};
  runtime.isTauri=true;runtime.nativeCalls=[];
  runtime.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  runtime.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string)=>{
   runtime.nativeCalls.push(command);
   if(command==='bridge_status')return {state:'ready',metadata:{bee_version:'fixture',os:'darwin',arch:'arm64',instance:'fixture'}};
   if(command==='plugin:event|listen')return 1;
   if(command==='plugin:event|unlisten')return;
   throw new Error('Unexpected demo native command: '+command);
  }};
 });
 await page.goto('/');await expect(page.getByText('演示数据',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'开始贡献',exact:true}).click();await expect(page.getByText('演示贡献中',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {nativeCalls:string[]}).nativeCalls.filter(command=>/^(supply_|device_)/.test(command)))).toEqual([]);
 await expect(page.getByRole('region',{name:'平台供给',exact:true})).toHaveCount(0);
});
