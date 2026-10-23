import { expect, test } from '@playwright/test';

const cases = [
  ['0', '0'],
  ['10', '10'],
  ['100', '100'],
  ['999999999999999', '999999999999999'],
  ['999999999999999.999999999', '999999999999999.999999999'],
  ['0.000000001', '0.000000001'],
  ['0.000000000', '0'],
  ['10.000000000', '10'],
  ['100.100000000', '100.1'],
  ['100.123456780', '100.12345678'],
] as const;

for (const [amount, expected] of cases) {
  test(`金额 ${amount} 精确显示为 ${expected}，仅移除小数尾零`, async ({ page }) => {
    // Substitute data at the client boundary; exercise all three rendered metrics.
    // These strings deliberately include values that Number cannot preserve.
    await page.route('**/src/client/demo.ts', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      for (const fixture of ['128.560000000', '6.820000000', '382.140000000']) {
        expect(body).toContain(fixture);
        body = body.replaceAll(fixture, amount);
      }
      await route.fulfill({ response, body });
    });
    await page.goto('/');
    await expect(page.getByRole('region', { name: '收益摘要' }).locator('.amount')).toHaveText([
      `¥${expected}`,
      `¥${expected}`,
      `¥${expected}`,
    ]);
  });
}
