import { Dialog } from 'radix-ui';
import { t } from '../../i18n/index';
import type { LifecycleAction, LifecycleState } from './lifecycle';
export function ExitDialog({ state, act, cancel, restoreFocus }: {
  state: LifecycleState; act: (action: LifecycleAction, immediate?: boolean) => void; cancel: () => void; restoreFocus: () => void;
}) {
  const purpose = state.purpose === 'exit' ? '退出' : '更新';
  const open = state.status !== 'idle' && state.status !== 'finished' && !(state.status === 'checking' && state.tasks.kind === 'known' && state.tasks.count === 0);
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !state.pending) cancel(); }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content lifecycle-dialog" aria-busy={state.pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <Dialog.Title>{t(state.status === 'unknown' ? '任务状态尚未确认' : state.status === 'waiting' ? '正在等待已有任务' : state.status === 'failed' ? '演示操作未完成' : '仍有任务进行中')}</Dialog.Title>
      <Dialog.Description>{t('仅演示退出与更新，不会关闭 App、安装软件或控制真实供给。')}</Dialog.Description>
      {state.tasks.kind === 'known' && <p>{t('当前任务：')}{state.tasks.count}</p>}
      {state.stopped && <p>{t('已临时停止接收新任务，主动暂停选择保持不变。')}</p>}
      {state.status === 'checking' && <p>{t('立即操作可能中断进行中的任务。')}</p>}
      {state.status === 'unknown' && <p>{t('请核对任务状态后再决定；未知不能当作没有任务。')}</p>}
      {state.message && <p role="alert">{t(state.message)}</p>}
      <div className="dialog-actions">
        <button disabled={state.pending} onClick={cancel}>{t('取消')}</button>
        {state.status === 'checking' && state.tasks.kind === 'known' && state.tasks.count > 0 ? <>
          <button disabled={state.pending} onClick={() => act('finish', true)}>{t(purpose === '退出' ? '立即退出' : '立即更新')}</button>
          <button className="primary" disabled={state.pending} onClick={() => act('wait')}>{t(purpose === '退出' ? '等待后退出' : '等待后更新')}</button>
        </> : <button className="primary" disabled={state.pending} onClick={() => act('check')}>{t(state.pending ? '处理中…' : '核对任务状态')}</button>}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
