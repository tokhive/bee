import { useReducer, useRef } from 'react';
import type { BeeClient, DesktopSnapshot, OperationResult } from '../../client/types';
import { t } from '../../i18n/index';
import { ExitDialog } from './ExitDialog';
import { UpdateDialog } from './UpdateDialog';
import { currentTasks, initialLifecycle, reduceLifecycle, type LifecycleAction, type LifecyclePurpose } from './lifecycle';
export function LifecycleControls({ client, snapshot }: { client: BeeClient; snapshot: DesktopSnapshot }) {
  const [state, send] = useReducer(reduceLifecycle, initialLifecycle);
  const sequence = useRef(0);
  const running = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const perform = async (action: LifecycleAction, id: number, purpose: LifecyclePurpose, immediate = false) => {
    if (running.current) return;
    running.current = true;
    send({ type: 'pending', id });
    const requestId = `demo-lifecycle-${id}`;
    try {
      const result = await client.dispatch({ type: `lifecycle.${action}`, requestId, purpose, immediate });
      const fresh = await client.snapshot();
      if (sequence.current !== id) return;
      // A fresh known zero is necessary, but never sufficient without a confirmed receipt.
      const tasks = currentTasks(fresh.tasks);
      if (action === 'check' && result.kind === 'confirmed' && result.demo && tasks.kind === 'known' && tasks.count === 0) {
        const finished = await client.dispatch({ type: 'lifecycle.finish', requestId, purpose, immediate: false });
        if (sequence.current === id) send({ type: 'result', id, action: 'finish', result: finished, tasks: (await client.snapshot()).tasks });
      } else send({ type: 'result', id, action, immediate, result, tasks: fresh.tasks });
    } catch (cause) {
      const result: OperationResult = { kind: 'unknown', operationId: requestId, message: `演示生命周期结果未确认：action=${action}；${String(cause)}` };
      if (sequence.current === id) send({ type: 'result', id, action, result, tasks: snapshot.tasks });
    } finally { running.current = false; }
  };
  const start = (purpose: LifecyclePurpose, button: HTMLButtonElement) => {
    if (running.current || !['idle', 'finished'].includes(state.status)) return;
    trigger.current = button;
    const id = ++sequence.current;
    send({ type: 'start', id, purpose, tasks: snapshot.tasks });
    const tasks = currentTasks(snapshot.tasks);
    if (tasks.kind === 'known' && tasks.count === 0) void perform('finish', id, purpose);
  };
  const props = { state, act: (action: LifecycleAction, immediate?: boolean) => { void perform(action, state.id, state.purpose, immediate); }, cancel: () => { void perform('cancel', state.id, state.purpose); }, restoreFocus: () => trigger.current?.focus() };
  return <section className="lifecycle-controls" aria-label={t('演示生命周期')}>
    <div className="inline-actions"><button disabled={state.pending} onClick={e => start('exit', e.currentTarget)}>{t('退出演示')}</button><button disabled={state.pending} onClick={e => start('update', e.currentTarget)}>{t('更新演示')}</button></div>
    <p className="feature-note" data-testid="lifecycle-status" aria-live="polite">{state.status === 'finished' ? t(state.purpose === 'exit' ? '演示退出流程已完成；App 仍在运行。' : '演示更新流程已完成；未安装软件。') : t('关窗继续后台运行；这里仅预览退出和更新流程。')}</p>
    {state.purpose === 'exit' ? <ExitDialog {...props} /> : <UpdateDialog {...props} />}
  </section>;
}
