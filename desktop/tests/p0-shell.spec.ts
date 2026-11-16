import { expect, test } from '@playwright/test';

test('最小验证页显示品牌、当前系统和未开始贡献状态', async ({ page }) => {
  await page.goto('/?p0=1');
  await expect(page.getByRole('heading', { name: 'Bee', exact: true })).toBeVisible();
  await expect(page.getByLabel('当前系统')).not.toBeEmpty();
  await expect(page.getByText('尚未开始贡献', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始贡献' })).toHaveCount(0);
});
