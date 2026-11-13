import { useEffect, useState } from 'react';
import type { BeeClient, DesktopSnapshot } from './types';
export type BeeState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: DesktopSnapshot }
  | { status: 'error'; message: string };
export function useBee(client: BeeClient): BeeState {
  const [result, setResult] = useState<{ client: BeeClient; state: BeeState }>({
    client,
    state: { status: 'loading' },
  });
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = client.subscribe((snapshot) => {
      changed = true;
      if (active) setResult({ client, state: { status: 'ready', snapshot } });
    });
    void client.snapshot().then(
      (snapshot) => {
        if (active && !changed) setResult({ client, state: { status: 'ready', snapshot } });
      },
      (cause: unknown) => {
        if (active && !changed)
          setResult({
            client,
            state: { status: 'error', message: `读取 Bee 页面快照失败：${String(cause)}` },
          });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);
  return result.client === client ? result.state : { status: 'loading' };
}
