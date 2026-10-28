import {useCallback, useEffect, useRef, useState} from 'react';
import {Dialog} from 'radix-ui';
import {t} from '../../i18n';
import './native-update.css';
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
export function NativeUpdateControls({client, currentVersion, platform, pollIntervalMs = 1000}: {client: UpdateClient; currentVersion?: string; platform?: string; pollIntervalMs?: number}) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<UpdateInstallRequest | null>(null);
  const mounted = useRef(false);
  const working = useRef(false);
  const serial = useRef(0);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const attemptedInstall = useRef<string | undefined>(undefined);
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
  const receipt = snapshot ? `${snapshot.operation_id}:${snapshot.revision}` : '';
  const installable = verified && attemptedInstall.current !== receipt;
  const action = error ? '重新读取更新状态' : installable ? '安装更新…' : verified ? '重新检查更新' : snapshot?.state === 'available' ? '下载更新' : '检查更新';
  return <section className="native-update" aria-label={t('应用更新')}>
    <div className="nu-version-row">
      <div><h3>Bee {snapshot?.current_version ?? currentVersion ?? '…'}</h3><div className="nu-platform">{platform ?? t('当前安装版本')}</div></div>
      <button ref={prepareButton} className={installable ? 'primary' : undefined} disabled={busy || (!error && !!active) || (!snapshot && !error)} onClick={() => {
        if (error) {void run(() => client.snapshot());return;}
        if (installable) {setConfirmation({operation_id:snapshot.operation_id!,expected_revision:snapshot.revision,confirmed:true});return;}
        void run(() => snapshot?.state === 'available' ? client.download() : client.check());
      }}>{t(action)}</button>
    </div>
    <div className="nu-state-row" aria-live="polite">
      <span className={`nu-status-dot${snapshot?.state === 'current' || verified ? ' nu-status-good' : ''}`} aria-hidden="true"/>
      <span><span>{error ? t('无法读取更新状态') : snapshot ? t(labels[snapshot.state]) : t('正在读取更新状态…')}</span>{snapshot?.target_version && <span className="nu-target"> · {snapshot.target_version}</span>}</span>
    </div>
    {snapshot?.state === 'downloading' && <div className="nu-progress">
      <progress aria-label={t('更新下载进度')} {...(snapshot.total_bytes !== null && snapshot.total_bytes > 0 ? {max:snapshot.total_bytes,value:snapshot.downloaded_bytes} : {})}/>
      <span>{snapshot.total_bytes === null
        ? t('已接收 {bytes} 字节；总大小未知', {bytes:snapshot.downloaded_bytes})
        : t('已接收 {bytes} / {total} 字节', {bytes:snapshot.downloaded_bytes,total:snapshot.total_bytes})}</span>
      <span>{t('只有签名验证通过后才能安装。')}</span>
    </div>}
    {snapshot?.checked_at && <div className="nu-checked">{t('最后检查时间')}：<time dateTime={snapshot.checked_at}>{new Date(snapshot.checked_at).toLocaleString()}</time></div>}
    {snapshot?.release_notes && <details className="nu-details" aria-label={t('发布说明')}>
      <summary>{t('发布说明')}</summary><p>{snapshot.release_notes}</p>
    </details>}
    {diagnostic && <div className="nu-error" role="alert"><details className="nu-details" aria-label={t('错误详情')}>
      <summary>{t('错误详情')}</summary><p>{diagnostic}</p>
    </details></div>}
    <div className="nu-note">{t('检查和下载不会退出 Bee。安装需要你确认退出，可能中断正在处理的任务。')}</div>
    <Dialog.Root open={confirmation !== null} onOpenChange={open => {if (!busy && !open) setConfirmation(null);}}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay"/>
        <Dialog.Content className="dialog-content nu-install-dialog" aria-busy={busy}
          onOpenAutoFocus={event => {event.preventDefault();cancelButton.current?.focus();}}
          onCloseAutoFocus={event => {event.preventDefault();prepareButton.current?.focus();}}>
          <Dialog.Title>{t('退出 Bee 并安装更新？')}</Dialog.Title>
          <Dialog.Description>{t('退出并安装可能中断正在处理的任务。确认后 Bee 将停止并交给安装程序；安装结果将在重新启动后核验。')}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild><button ref={cancelButton} disabled={busy}>{t('取消')}</button></Dialog.Close>
            <button className="primary" disabled={busy || !confirmation} onClick={() => {
              if (!confirmation) return;
              const request = confirmation;
              attemptedInstall.current = `${request.operation_id}:${request.expected_revision}`;
              void run(() => client.install(request)).then(() => {if (mounted.current) setConfirmation(null);});
            }}>{t('退出并安装')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
