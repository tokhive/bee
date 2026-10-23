import type { DesktopSnapshot, Platform } from '../../client/types';
import { StatusView } from '../../components/StatusView';
import { AccountActions, type AccountDispatch } from './AccountActions';
import { AccountDetails } from './AccountDetails';
export function AccountsPage({
  snapshot,
  busy,
  dispatch,
}: {
  snapshot: DesktopSnapshot;
  busy: boolean;
  dispatch: AccountDispatch;
}) {
  const state = snapshot.accounts;
  if (state.status === 'loading') return <StatusView kind="loading" title="正在读取 AI 账号…" />;
  if (state.status === 'error')
    return (
      <StatusView
        kind="error"
        title="账号读取失败"
        onRetry={() => void dispatch({ type: 'refresh' })}
      >
        {state.error.code}：{state.error.message}
      </StatusView>
    );
  return (
    <>
      <p className="accounts-intro">
        检测已有官方登录，或通过官方授权接入。接入与换号后保持暂停，由你决定何时贡献。
      </p>
      <div className="accounts-grid">
        {(['openai', 'claude'] as Platform[]).map((platform) => {
          const account = state.value.find((a) => a.platform === platform);
          const label = platform === 'openai' ? 'OpenAI' : 'Claude';
          return (
            <section className="account-card" aria-label={`${label} 账号`} key={platform}>
              <header className="section-heading">
                <div className="platform">
                  <span className={`platform-mark ${platform}`}>
                    {platform === 'openai' ? 'O' : '✳'}
                  </span>
                  <h2>{label}</h2>
                </div>
                <span className="muted">{account ? `订阅套餐 ${account.plan}` : '尚未接入'}</span>
              </header>
              {account && (
                <>
                  <p className="account-identifier">{account.identifier}</p>
                  <p className="account-state">
                    {account.authorization === 'expired'
                      ? '授权已失效'
                      : account.removal === 'pending'
                        ? '移除处理中'
                        : account.removal === 'unknown'
                          ? '移除结果未确认'
                          : '已接入'}{' '}
                    · {account.paused ? '已暂停' : '贡献中'}
                  </p>
                  <p className="muted">
                    {account.quota
                      ? `${account.quota.window} · 剩余 ${account.quota.remaining}% · ${account.quota.resetsAt}`
                      : '额度未知'}
                  </p>
                  <AccountDetails account={account} />
                </>
              )}
              <AccountActions
                platform={platform}
                account={account}
                busy={busy}
                dispatch={dispatch}
              />
            </section>
          );
        })}
      </div>
      <p className="feature-note">演示接入不会读取或修改官方客户端；官方授权尚未接通。</p>
    </>
  );
}
