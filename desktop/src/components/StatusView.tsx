import { t } from '../i18n/index';
import type { ReactNode } from 'react';
export function StatusView({
  kind,
  title,
  children,
  onRetry,
  announceError = true,
}: {
  kind: 'loading' | 'empty' | 'error' | 'unavailable';
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  announceError?: boolean;
}) {
  return (
    <section
      className="status-view"
      aria-busy={kind === 'loading'}
      role={announceError && (kind === 'error' || kind === 'unavailable') ? 'alert' : undefined}
    >
      <h3>{t(title)}</h3>
      {children && <div className="status-view-content">{children}</div>}
      {onRetry && <button onClick={onRetry}>{t("重新读取")}</button>}
    </section>
  );
}
