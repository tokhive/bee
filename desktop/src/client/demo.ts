import { parseScene } from './scenes';
import type { BeeClient, DesktopSnapshot, ReadState } from './types';

export function createDemoClient(scene: string): BeeClient {
  const selected = parseScene(scene);
  const now = new Date().toISOString();
  const ready = <T>(value: T): ReadState<T> => ({ status: 'ready', value, updatedAt: now });
  let state: DesktopSnapshot = {
    mode: 'demo',
    binding: ready({ state: selected === 'onboarding' ? 'unbound' : 'bound', label: 'Bee 演示账号' }),
    process: ready({ state: 'paused' }),
    connection: ready({ state: 'connected', endpointLabel: 'Hive 演示连接' }),
    accounts: ready(
      selected === 'empty' || selected === 'onboarding'
        ? []
        : [
            { id: 'demo-openai', platform: 'openai', label: 'OpenAI', plan: 'Plus', state: 'available' },
            { id: 'demo-claude', platform: 'claude', label: 'Claude', plan: 'Pro', state: 'available' },
          ],
    ),
    earnings: ready({ balance: '128.560000000', today: '6.820000000', total: '382.140000000' }),
    tasks: ready(selected === 'unknown-tasks' ? { kind: 'unknown' } : { kind: 'known', count: 0 }),
    preferences: ready({ theme: 'system', language: 'system' }),
  };
  if (selected === 'loading') state = { ...state, accounts: { status: 'loading', updatedAt: null } };
  if (selected === 'error')
    state = {
      ...state,
      accounts: {
        status: 'error',
        updatedAt: now,
        error: {
          code: 'DEMO_ACCOUNTS_UNAVAILABLE',
          message: '演示账号读取失败：场景 error 模拟账号源不可用。',
        },
      },
    };
  const listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  return {
    async snapshot() {
      return structuredClone(state);
    },
    async dispatch(command) {
      if (command.type === 'snapshot.refresh') {
        // Refresh is deliberately local and does not simulate an upstream success.
        for (const listener of listeners) listener(structuredClone(state));
        return { kind: 'confirmed', demo: true, message: '仅演示：已重新读取当前场景。' };
      }
      if (
        state.binding.status !== 'ready' ||
        state.binding.value.state !== 'bound' ||
        !state.accounts.value?.length
      ) {
        return {
          kind: 'failed',
          error: {
            code: 'DEMO_PREREQUISITE_MISSING',
            message: '演示贡献条件未满足：需要演示绑定与至少一个演示 AI 账号。',
          },
        };
      }
      state = {
        ...state,
        process: {
          status: 'ready',
          updatedAt: new Date().toISOString(),
          value: { state: command.type === 'contribution.start' ? 'contributing' : 'paused' },
        },
      };
      for (const listener of listeners) listener(structuredClone(state));
      return {
        kind: 'confirmed',
        demo: true,
        message:
          command.type === 'contribution.start'
            ? '仅演示：已开始演示贡献，不控制真实供给。'
            : '仅演示：已暂停演示贡献，不控制真实供给。',
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
