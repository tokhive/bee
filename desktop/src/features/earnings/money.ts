/** Hive wallet amounts use 10^9 units, with at most 15 integer digits. */
export const MAX_AMOUNT_UNITS = 999999999999999999999999n;
const pattern = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?$/;
export function validAmount(value: string): boolean {
  return pattern.test(value) && /[1-9]/.test(value);
}
export function amountUnits(value: string): bigint {
  if (!pattern.test(value))
    throw new Error(
      `金额格式检查失败：实际值=${value}；要求最多15位整数、9位小数，无前导零。`,
    );
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
}
export function decimalUnits(value: bigint): string {
  const whole = value / 1000000000n;
  const fraction = (value % 1000000000n)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export function displayAmount(value: string): string {
  const [whole, fraction] = value.split('.');
  const significant = fraction?.replace(/0+$/, '');
  return significant ? `${whole}.${significant}` : whole;
}
export function validFactor(value: string): boolean {
  return validAmount(value) && amountUnits(value) < 10000000000n;
}
