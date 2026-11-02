import {throwBridgeError} from './failures.ts';
import type { DeviceInvoke } from './device';
export type SupplyPlatform = 'openai' | 'claude';
export interface SupplyBinding { hive: string; deviceId: string }
export interface SupplyView { hive: string; device_id: string; platform: SupplyPlatform; paused: boolean; ready: boolean; reasons: string[]; checked_at: string }
export interface SupplyClient {
 status(platform: SupplyPlatform): Promise<SupplyView>;
 setPaused(platform: SupplyPlatform, paused: boolean): Promise<SupplyView>;
}
export type SupplyFactory = (binding: SupplyBinding) => SupplyClient;
export const supplyReasons = [
 'account_not_registered','market_not_open','supply_not_enabled','supply_device_restricted','account_not_admitted',
 'manually_paused','banned','device_draining','offline','not_configured','model_unavailable',
 'authorization_unavailable','capabilities_unknown','rate_limited','quota_unknown','quota_exhausted',
 'plan_not_configured','concurrency_full','codex_source_unavailable','codex_confirmation_required',
 'codex_authorization_rejected','claude_source_unavailable','claude_confirmation_required','claude_authorization_rejected',
];
function record(value: unknown): value is Record<string, unknown> {
 return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function kind(value: unknown): string { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }
function invalid(evidence: string): never { throw new Error(`SUPPLY_REPLY_INVALID: ${evidence}`); }
function exact(value: Record<string, unknown>, fields: string[], at: string) {
 if (Object.keys(value).some(key => !fields.includes(key))) invalid(`${at} contains an unknown field; required=${fields.join(',')}`);
 for (const field of fields) if (!(field in value)) invalid(`${at}.${field} missing; required=present`);
}
export function decodeSupplyReply(reply: unknown, binding: SupplyBinding, platform: SupplyPlatform, paused?: boolean, now = Date.now()): SupplyView {
 if (platform !== 'openai' && platform !== 'claude') return invalid('expected platform rejected; required=openai,claude');
 if (!record(reply)) return invalid(`reply actual_type=${kind(reply)}; required=object`);
 if (!record(reply.result)) return invalid(`result actual_type=${kind(reply.result)}; required=object`);
 const { result } = reply;
 if ('error' in result) {
  exact(result, ['error'], 'result');
  throwBridgeError(result.error,'SUPPLY_REPLY_INVALID');
 }
 exact(result, ['supply'], 'result');
 const view = result.supply;
 if (!record(view)) return invalid(`supply actual_type=${kind(view)}; required=object`);
 exact(view, ['hive','device_id','platform','paused','ready','reasons','checked_at'], 'supply');
 for (const field of ['hive','device_id','platform','checked_at']) {
  if (typeof view[field] !== 'string') return invalid(`supply.${field} actual_type=${kind(view[field])}; required=string`);
  if (!view[field]) return invalid(`supply.${field} is empty; required=nonempty string`);
 }
 if (view.hive !== binding.hive) return invalid('supply.hive mismatch; required=current verified Hive');
 if (view.device_id !== binding.deviceId) return invalid('supply.device_id mismatch; required=current verified device');
 if (view.platform !== platform) return invalid(`supply.platform mismatch; required=${platform}`);
 for (const field of ['paused','ready']) if (typeof view[field] !== 'boolean') return invalid(`supply.${field} actual_type=${kind(view[field])}; required=boolean`);
 if (paused !== undefined && view.paused !== paused) return invalid(`supply.paused=${view.paused}; required=${paused}`);
 if (!Array.isArray(view.reasons)) return invalid(`supply.reasons actual_type=${kind(view.reasons)}; required=string array`);
 const reasons = view.reasons as unknown[];
 const seen = new Set<string>();
 for (const [index, reason] of reasons.entries()) {
  if (typeof reason !== 'string' || !supplyReasons.includes(reason)) return invalid(`supply.reasons[${index}] unrecognized; required=known reason`);
  if ((platform === 'openai' && reason.startsWith('claude_')) || (platform === 'claude' && reason.startsWith('codex_'))) return invalid(`supply.reasons[${index}] platform mismatch; required=${platform}`);
  if (seen.has(reason)) return invalid(`supply.reasons[${index}] duplicate; required=unique reasons`);
  seen.add(reason);
 }
 if (view.ready !== (reasons.length === 0)) return invalid(`supply.ready=${view.ready}, reasons_count=${reasons.length}; required=ready iff no reasons`);
 if (view.paused !== seen.has('manually_paused')) return invalid(`supply.paused=${view.paused}, manually_paused_present=${seen.has('manually_paused')}; required=equal`);
 const timestamp = view.checked_at as string;
 const parsed = Date.parse(timestamp);
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,19) !== timestamp.slice(0,19)) return invalid('supply.checked_at malformed; required=valid UTC RFC3339 timestamp');
 if (parsed > now) return invalid(`supply.checked_at is in the future; delta_ms=${parsed-now}; required=not later than now`);
 return view as unknown as SupplyView;
}
// Preserve same-platform ordering across remounts and replacement clients without blocking the other platform.
const queues = new WeakMap<DeviceInvoke, Partial<Record<SupplyPlatform,Promise<unknown>>>>();
export function createSupplyClient(invoke: DeviceInvoke, binding: SupplyBinding): SupplyClient {
 async function request(platform: SupplyPlatform, paused?: boolean) {
  if (platform !== 'openai' && platform !== 'claude') return invalid('request platform rejected; required=openai,claude');
  if (paused !== undefined && typeof paused !== 'boolean') return invalid(`request paused actual_type=${kind(paused)}; required=boolean`);
  const transportQueues=queues.get(invoke)??{};queues.set(invoke,transportQueues);
  const operation = (transportQueues[platform] ?? Promise.resolve()).then(async () => {
   const reply = paused === undefined ? await invoke('supply_status', {platform}) : await invoke('supply_set_paused', {platform,paused});
   return decodeSupplyReply(reply, binding, platform, paused);
  });
  transportQueues[platform]=operation.catch(() => {});
  return operation;
 }
 return {status: platform => request(platform), setPaused: async (platform,paused) => {
  if(typeof paused !== 'boolean') return invalid(`request paused actual_type=${kind(paused)}; required=boolean`);
  return request(platform,paused);
 }};
}
