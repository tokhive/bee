import type { Binding, Preferences } from '../../client/types';
export const defaultHive = 'Hive 演示连接';
export interface PreferenceScope { hive: string; user: string | null }
export const preferenceScope = (hive: string, binding?: Binding): PreferenceScope => ({
  hive, user: binding?.loggedIn === true && binding.userId ? binding.userId : null,
});
export const defaults = (hive = defaultHive): Preferences => ({ language: 'system', theme: 'system', autoStart: false, notifications: true, hiveAddress: hive, proxyAddress: '' });
export class AddressValidationError extends Error {}
export function validateAddress(value: string, kind: 'Hive' | '代理') {
  if ((!value && kind === '代理') || (value === defaultHive && kind === 'Hive')) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new AddressValidationError(`${kind} 地址解析失败：parse=failed，inputLength=${value.length}`); }
  if (url.username || url.password) throw new AddressValidationError(`${kind} 地址凭证检查失败：hasCredentials=true；请移除账号与密码。`);
  if (url.search) throw new AddressValidationError(`${kind} 地址查询检查失败：hasQuery=true；请移除查询参数。`);
  if (url.hash) throw new AddressValidationError(`${kind} 地址片段检查失败：hasFragment=true；请移除片段。`);
  const allowed = kind === '代理' ? ['http:', 'https:', 'socks5:'] : ['http:', 'https:'];
  if (!allowed.includes(url.protocol)) throw new AddressValidationError(`${kind} 地址协议检查失败：protocol=${url.protocol}；protocolAllowed=false；要求 ${allowed.join(', ')}`);
}
const key = ({ hive, user }: PreferenceScope) => `bee.demo.preferences.v1.${encodeURIComponent(JSON.stringify([hive, user]))}`;
/** Only these ordinary values can cross the persistence boundary. Never persist a snapshot. */
function clean(input: Partial<Preferences>, hive: string): Preferences {
  const value = defaults(hive);
  if (typeof input.hiveAddress === 'string') {
    validateAddress(input.hiveAddress, 'Hive');
    if (input.hiveAddress !== hive) throw new Error('普通偏好范围检查失败：hiveMatches=false');
  }
  if (['system', 'zh', 'en'].includes(input.language ?? '')) value.language = input.language!;
  if (['system', 'light', 'dark'].includes(input.theme ?? '')) value.theme = input.theme!;
  if (typeof input.autoStart === 'boolean') value.autoStart = input.autoStart;
  if (typeof input.notifications === 'boolean') value.notifications = input.notifications;
  if (typeof input.proxyAddress === 'string') value.proxyAddress = input.proxyAddress;
  validateAddress(hive, 'Hive'); validateAddress(value.proxyAddress!, '代理');
  return value;
}
export function loadPreferences(storage: Storage, scope: PreferenceScope): Preferences {
  const raw = storage.getItem(key(scope));
  let parsed: Partial<Preferences> = {};
  if (raw !== null) {
    try { parsed = JSON.parse(raw); } catch { throw new Error(`普通偏好解析失败：parse=failed，inputLength=${raw.length}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('普通偏好结构检查失败：object=false');
  }
  return clean(parsed, scope.hive);
}
export function savePreferences(storage: Storage, scope: PreferenceScope, input: Partial<Preferences>) {
  const value = clean(input, scope.hive);
  storage.setItem(key(scope), JSON.stringify(value));
  return value;
}
// This endpoint selector is not a session: selecting any other Hive always starts anonymous.
const hiveKey = 'bee.demo.selected-hive.v1';
export function selectedHive(storage: Storage) {
  const hive = storage.getItem(hiveKey) ?? defaultHive;
  validateAddress(hive, 'Hive'); return hive;
}
export function selectHive(storage: Storage, hive: string) { validateAddress(hive, 'Hive'); storage.setItem(hiveKey, hive); }
