import { createDemoClient } from './demo';
import type { BeeClient, DesktopSnapshot } from './types';

/** Business data is independent of the native SystemBridge. No adapter is wired yet. */
export function createBusinessClient(mode: string | undefined, scene = 'ready'): BeeClient {
  if (mode === 'demo') return createDemoClient(scene, typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const error = {
    code: 'BUSINESS_ADAPTER_UNAVAILABLE',
    message: '业务服务未接通：当前构建尚未配置真实 Bee/Hive 业务适配器。',
  };
  const unavailable = { status: 'error' as const, updatedAt: null, error };
  const state: DesktopSnapshot = {
    mode: 'unavailable',
    binding: unavailable,
    process: unavailable,
    connection: unavailable,
    accounts: unavailable,
    earnings: unavailable,
    finance: unavailable,
    tasks: unavailable,
    preferences: unavailable,
  };
  return {
    async snapshot() {
      return structuredClone(state);
    },
    async dispatch() {
      return { kind: 'unsupported', message: error.message };
    },
    subscribe() {
      return () => {};
    },
  };
}
