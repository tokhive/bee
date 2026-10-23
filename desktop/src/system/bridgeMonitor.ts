import type { BridgeError, BridgeStatus, SystemBridge, Unlisten } from './bridge.ts';

export interface BridgeView { status: BridgeStatus; failure?: BridgeError; checking: boolean; alive: boolean }

export function createBridgeMonitor(bridge: SystemBridge, notify: (view: BridgeView) => void) {
  let view: BridgeView = { status: { state: 'starting' }, checking: false, alive: false };
  let active = true;
  let started = false;
  let revision = 0;
  let unlisten: Unlisten | undefined;
  const publish = (patch: Partial<BridgeView>) => {
    if (!active) return;
    view = { ...view, ...patch };
    notify(view);
  };
  const update = (status: BridgeStatus) => {
    revision++;
    publish({ status, alive: false, failure: undefined });
  };
  return {
    async start() {
      if (started || !active) return;
      started = true;
      const before = revision;
      try {
        unlisten = await bridge.onStatus(update);
        if (!active) { unlisten(); unlisten = undefined; return; }
        const query = revision;
        const status = await bridge.status();
        if (active && query === revision) update(status);
      } catch (cause) { if (active && before === revision) publish({ failure: bridgeFailure(cause) }); }
    },
    async check() {
      if (!active || view.checking) return;
      publish({ checking: true, failure: undefined, alive: false });
      let query = revision;
      try {
        const current = await bridge.status();
        if (!active || query !== revision) return;
        update(current);
        query = revision;
        if (current.state === 'ready') {
          await bridge.ping();
          if (active && query === revision && view.status.state === 'ready') publish({ alive: true });
        }
      } catch (cause) {
        const failure = bridgeFailure(cause);
        if (!active || query !== revision) return;
        publish({ failure });
        try {
          const current = await bridge.status();
          if (active && query === revision) { update(current); publish({ failure }); }
        } catch (statusCause) {
          if (active && query === revision) publish({ failure: { code: failure.code, message: `${failure.message}；重新读取管理状态失败：${bridgeFailure(statusCause).message}` } });
        }
      } finally { publish({ checking: false }); }
    },
    dispose() {
      if (!active) return;
      active = false; revision++;
      unlisten?.(); unlisten = undefined;
    },
  };
}

function bridgeFailure(cause: unknown): BridgeError {
  if (typeof cause === 'object' && cause !== null && 'code' in cause && 'message' in cause
    && typeof cause.code === 'string' && typeof cause.message === 'string') return { code: cause.code, message: cause.message };
  return { code: 'NATIVE_CALL_FAILED', message: `桌面桥调用失败：${String(cause)}` };
}
