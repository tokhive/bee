import { useEffect, useRef, useState } from 'react';
import type { DesktopSnapshot } from '../../client/types';
import { preferenceScope, defaultHive } from './preferences';
export function notificationIssues(snapshot?: DesktopSnapshot): string[] {
  if (!snapshot) return [];
  const accounts = snapshot.accounts.status === 'ready' ? snapshot.accounts.value : [];
  return [
    accounts.some(a => a.authorization === 'expired') && '授权已失效',
    accounts.some(a => a.pendingChange) && '换号待确认',
    snapshot.connection.status === 'ready' && snapshot.connection.value.state === 'disconnected' && snapshot.connection.value.persistentOffline === true && '持续离线（演示场景）',
    accounts.some(a => a.quota?.remaining === 0) && '额度已耗尽',
  ].filter((value): value is string => typeof value === 'string');
}
export function useDemoNotifications(snapshot?: DesktopSnapshot) {
  const scope = preferenceScope(snapshot?.preferences.value?.hiveAddress ?? defaultHive, snapshot?.binding.status === 'ready' ? snapshot.binding.value : undefined);
  const scopeKey = JSON.stringify(scope);
  const enabled = snapshot?.preferences.value?.notifications !== false;
  const seen = useRef(new Map<string, Set<string>>());
  const [messages, setMessages] = useState<{ scope: string; values: string[] }>({ scope: scopeKey, values: [] });
  function check() {
    if (!enabled) { setMessages({ scope: scopeKey, values: [] }); return; }
    const prior = seen.current.get(scopeKey) ?? new Set<string>();
    const fresh = notificationIssues(snapshot).filter(issue => !prior.has(issue));
    fresh.forEach(issue => prior.add(issue)); seen.current.set(scopeKey, prior);
    setMessages(previous => ({ scope: scopeKey, values: [...(previous.scope === scopeKey ? previous.values : []), ...fresh] }));
  }
  const issues = notificationIssues(snapshot).join('|');
  useEffect(() => { check(); }, [scopeKey, enabled, issues]);
  return { check, messages: enabled && messages.scope === scopeKey ? messages.values : [] };
}
