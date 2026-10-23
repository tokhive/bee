import type { ReactNode } from 'react';
export function StatusView({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'error' | 'unavailable';
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <section
      className="status-view"
      aria-busy={kind === 'loading'}
      role={kind === 'error' || kind === 'unavailable' ? 'alert' : undefined}
    >
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {onRetry && <button onClick={onRetry}>重新读取</button>}
    </section>
  );
}
