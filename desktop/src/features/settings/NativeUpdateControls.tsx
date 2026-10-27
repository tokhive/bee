import {useCallback, useEffect, useRef, useState} from 'react';
import {Dialog} from 'radix-ui';
import {t} from '../../i18n';
import type {UpdateClient, UpdateInstallRequest, UpdateSnapshot, UpdateState} from '../../system/updater';

const activeStates: readonly UpdateState[] = ['checking','downloading','stopping','installing'];
const labels: Record<UpdateState,string> = {
  idle:'尚未检查更新', checking:'正在检查更新…', current:'当前版本已是最新', available:'发现可用更新',
  downloading:'正在下载并验证更新…', verified:'更新已下载并通过签名验证', stopping:'正在停止 Bee，准备安装…',
  installing:'正在安装更新…', failed:'更新操作失败',
};
function failure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) return `${'code' in cause ? String(cause.code) + ': ' : ''}${String(cause.message)}`;
  return String(cause);
}

/** Mount inside the S2 native settings page; this component never changes runtime or preferences. */
export function NativeUpdateControls({client, pollIntervalMs = 1000}: {client: UpdateClient; pollIntervalMs?: number}) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<UpdateInstallRequest | null>(null);
  const mounted = useRef(false);
  const working = useRef(false);
  const serial = useRef(0);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const run = useCallback(async (operation: () => Promise<UpdateSnapshot>): Promise<boolean> => {
    if (working.current) return false;
    working.current = true;
    const request = ++serial.current;
    setBusy(true); setError('');
    try {
      const next = await operation();
      if (mounted.current && request === serial.current) setSnapshot(next);
      return mounted.current && request === serial.current;
    } catch (cause) {
      if (mounted.current && request === serial.current) setError(failure(cause));
      return false;
    } finally {
      if (mounted.current && request === serial.current) {working.current = false; setBusy(false);}
    }
  }, []);
  useEffect(() => {
    mounted.current = true; working.current = false;
    setSnapshot(undefined); setConfirmation(null);
    void run(() => client.snapshot());
    return () => {mounted.current = false; serial.current++;};
  }, [client, run]);
  useEffect(() => {
    if (!snapshot || busy || error) return;
    // Rust schedules automatic checks. Read-only polling also observes a check
    // started in the background while this page was idle or current.
    const timer = setTimeout(() => void run(() => client.snapshot()), pollIntervalMs);
    return () => clearTimeout(timer);
  }, [snapshot, busy, error, client, pollIntervalMs, run]);
  const active = snapshot && activeStates.includes(snapshot.state);
  const diagnostic = error || (snapshot?.error ? `${snapshot.error.code}: ${snapshot.error.message}` : '');
  const verified = snapshot?.state === 'verified' && !diagnostic && !!snapshot.operation_id && !!snapshot.target_version;
  return <section className="settings-form" aria-label={t('应用更新')} aria-busy={busy}>
    <h2>{t('应用更新')}</h2>
    {snapshot && <>
      <p>{t('当前版本')}：<span>{snapshot.current_version}</span></p>
      {snapshot.target_version && <p>{t('可用版本')}：<span>{snapshot.target_version}</span></p>}
      <p role="status">{t(labels[snapshot.state])}</p>
      {snapshot.checked_at && <p>{t('最后检查时间')}：<time dateTime={snapshot.checked_at}>{snapshot.checked_at}</time></p>}
      {snapshot.state === 'downloading' && <div>
        <progress aria-label={t('更新下载进度')} {...(snapshot.total_bytes !== null && snapshot.total_bytes > 0 ? {max:snapshot.total_bytes,value:snapshot.downloaded_bytes} : {})}/>
        <p>{snapshot.total_bytes === null
          ? t('已接收 {bytes} 字节；总大小未知', {bytes:snapshot.downloaded_bytes})
          : t('已接收 {bytes} / {total} 字节', {bytes:snapshot.downloaded_bytes,total:snapshot.total_bytes})}</p>
        <p className="feature-note">{t('只有签名验证通过后才能安装。')}</p>
      </div>}
      {snapshot.release_notes !== null && <section aria-label={t('发布说明')}>
        <h3>{t('发布说明')}</h3>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{snapshot.release_notes}</p>
      </section>}
    </>}
    {!snapshot && <p role="status">{t('正在读取更新状态…')}</p>}
    {diagnostic && <p role="alert" style={{overflowWrap:'anywhere'}}>{diagnostic}</p>}
    <div className="dialog-actions">
      <button disabled={busy || !!active} onClick={() => void run(() => client.check())}>{t('检查更新')}</button>
      <button disabled={busy} onClick={() => void run(() => client.snapshot())}>{t('刷新更新状态')}</button>
      {snapshot?.state === 'available' && <button disabled={busy || !!diagnostic} onClick={() => void run(() => client.download())}>{t('下载更新')}</button>}
      {verified && <button ref={prepareButton} className="primary" disabled={busy} onClick={() => setConfirmation({operation_id:snapshot.operation_id!,expected_revision:snapshot.revision,confirmed:true})}>{t('准备安装')}</button>}
    </div>
    <p className="feature-note">{t('检查和下载不会退出 Bee。安装需要你确认退出，可能中断正在处理的任务。')}</p>
    <Dialog.Root open={confirmation !== null} onOpenChange={open => {if (!busy && !open) setConfirmation(null);}}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="dialog-content" aria-busy={busy}
          onOpenAutoFocus={event => {event.preventDefault();cancelButton.current?.focus();}}
          onCloseAutoFocus={event => {event.preventDefault();prepareButton.current?.focus();}}>
          <Dialog.Title>{t('退出 Bee 并安装更新？')}</Dialog.Title>
          <Dialog.Description>{t('退出并安装可能中断正在处理的任务。确认后 Bee 将停止并交给安装程序；安装结果将在重新启动后核验。')}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild><button ref={cancelButton} disabled={busy}>{t('取消')}</button></Dialog.Close>
            <button className="primary" disabled={busy || !confirmation} onClick={() => {
              if (!confirmation) return;
              const request = confirmation;
              void run(() => client.install(request)).then(() => {if (mounted.current) setConfirmation(null);});
            }}>{t('退出并安装')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
