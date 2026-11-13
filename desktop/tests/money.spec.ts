import { expect, test } from '@playwright/test';
test('金额按 Hive 的 15/9 位规则校验并以独立手算证明精度', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const m = await import(
      /* @vite-ignore */ String('/src/features/earnings/money.ts')
    ).catch(() => null);
    if (!m) return null;
    return {
      invalid: [
        '',
        '0',
        '0.000000000',
        '-1',
        '1e3',
        '01',
        '.1',
        '1.',
        '1000000000000000',
        '1.0000000001',
      ].map((v) => m.validAmount(v)),
      minimum: m.validAmount('0.000000001'),
      maximum: m.validAmount('999999999999999.999999999'),
      units: ['10.000000001', '999999999999999.999999999'].map((v) =>
        String(m.amountUnits(v)),
      ),
      sum: String(m.amountUnits('0.1') + m.amountUnits('0.2')),
      zero: String(m.amountUnits('0')),
      maximumUnits: String(m.MAX_AMOUNT_UNITS),
    };
  });
  expect(result, '金额工具必须存在').not.toBeNull();
  if (!result) return;
  expect(result.invalid).toEqual(Array(10).fill(false));
  expect(result.minimum).toBe(true);
  expect(result.maximum).toBe(true);
  expect(result.units).toEqual(['10000000001', '999999999999999999999999']);
  expect(result.sum).toBe('300000000');
  expect(result.zero).toBe('0');
  expect(result.maximumUnits).toBe('999999999999999999999999');
});
