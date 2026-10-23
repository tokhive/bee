import type { DecimalAmount, DesktopSnapshot, ReadState } from '../../client/types';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { DesktopCommand, Platform } from '../../client/types';
import { Check, Zap, CirclePause } from 'lucide-react';
import { StatusView } from '../../components/StatusView';
function DomainView<T>({
  state,
  empty,
  children,
  onRetry,
}: {
  state: ReadState<T>;
  empty?: boolean;
  children: (value: T) => React.ReactNode;
  onRetry: () => void;
}) {
  if (state.status === 'loading')
    return (
      <StatusView kind="loading" title="正在读取…">
        等待当前页面数据。
      </StatusView>
    );
  if (state.status === 'error' && !state.value)
    return (
      <StatusView kind="error" title="读取失败" onRetry={onRetry}>
        {state.error.code}：{state.error.message}
      </StatusView>
    );
  if (empty)
    return (
      <StatusView kind="empty" title="尚未添加 AI 账号">
        请在概览中检测并连接 AI 账号。
      </StatusView>
    );
  return (
    <>
      {state.status === 'error' && (
        <StatusView kind="error" title="旧值 · 刷新失败" onRetry={onRetry}>
          {state.error.code}：{state.error.message} 上次更新：
          {state.updatedAt ?? '未知'}
        </StatusView>
      )}
      {children(state.value!)}
    </>
  );
}
export function AccountList({ snapshot, onRetry }: { snapshot: DesktopSnapshot; onRetry: () => void }) {
  return (
    <DomainView
      state={snapshot.accounts}
      empty={snapshot.accounts.status === 'ready' && snapshot.accounts.value.length === 0}
      onRetry={onRetry}
    >
      {(accounts) => (
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <div className="platform">
                <span className={`platform-mark ${account.platform}`}>
                  {account.platform === 'openai' ? 'O' : '✳'}
                </span>
                <div>
                  <strong>
                    {account.label} <span className="plan">{account.plan}</span>
                  </strong>
                  <small>演示账号 · {account.state === 'available' ? '可用于演示' : '不可用'}</small>
                </div>
              </div>
              <span className="account-condition">
                <Check aria-hidden="true" />
                {account.state === 'available' ? '状态正常' : '待检查'}
              </span>
              <span className="muted">后续开放账号管理</span>
            </div>
          ))}
        </div>
      )}
    </DomainView>
  );
}
function formatAmount(amount: DecimalAmount): string {
  const [integer, fraction] = amount.split('.');
  const significantFraction = fraction?.replace(/0+$/, '');
  return significantFraction ? `${integer}.${significantFraction}` : integer;
}

export function Metrics({ snapshot, onRetry }: { snapshot: DesktopSnapshot; onRetry: () => void }) {
  return (
    <DomainView state={snapshot.earnings} onRetry={onRetry}>
      {(earnings) => (
        <section className="finance" aria-label="收益摘要">
          {[
            ['可用余额', earnings.balance, '收益与资金操作将在后续开放'],
            ['今日收益', earnings.today, '演示统计'],
            ['累计收益', earnings.total, '演示统计'],
          ].map(([label, amount, caption]) => (
            <div key={label}>
              <p>{label}</p>
              <div className="amount">
                <span>¥</span>
                {formatAmount(amount)}
              </div>
              <small>{caption}</small>
            </div>
          ))}
        </section>
      )}
    </DomainView>
  );
}

export function OverviewPage({
  snapshot,
  busy,
  dispatch,
  onDiagnostics,
  onAccounts,
}: {
  snapshot: DesktopSnapshot;
  busy: boolean;
  dispatch: (command: DesktopCommand) => Promise<void>;
  onDiagnostics: () => void;
  onAccounts: () => void;
}) {
  const [selection, setSelection] = useState<Platform[]>(['openai', 'claude']);
  const accounts = snapshot.accounts.value ?? [];
  const eligible =
    snapshot.binding.status === 'ready' &&
    snapshot.binding.value.state === 'bound' &&
    snapshot.connection.status === 'ready' &&
    snapshot.connection.value.state === 'connected' &&
    snapshot.process.status === 'ready' &&
    snapshot.process.value.owner === 'app' &&
    snapshot.process.value.state !== 'stopped' &&
    snapshot.accounts.status === 'ready';
  const running = snapshot.process.status === 'ready' && snapshot.process.value.state === 'contributing';
  const external = snapshot.process.value?.owner === 'external';
  const chosen = selection.filter((p) =>
    accounts.some((a) => a.platform === p && a.state === 'available'),
  );
  return (
    <>
      {(['binding', 'process'] as const).map(
        (domain) =>
          snapshot[domain].status === 'error' && (
            <StatusView
              key={domain}
              kind="error"
              title={domain === 'process' ? '本机进程读取失败' : '绑定读取失败'}
              onRetry={() => void dispatch({ type: 'refresh' })}
            >
              {snapshot[domain].error.code}：{snapshot[domain].error.message} 上次更新：
              {snapshot[domain].updatedAt ?? '未知'}
            </StatusView>
          ),
      )}
      {external && (
        <StatusView kind="unavailable" title="外部管理的 Bee">
          仅查看；不会复制配置或终止外部进程。
        </StatusView>
      )}
      <section className="running">
        <div className="running-title">
          <span className="emblem">{running ? <Zap /> : <CirclePause />}</span>
          <div>
            <h2>
              {snapshot.process.status !== 'ready'
                ? '进程状态未知'
                : running
                  ? '演示贡献中'
                  : '尚未开始贡献'}
            </h2>
            <p>由你决定何时开始，让闲置的 AI 额度创造价值。</p>
            <div className="health">
              <span>
                本机进程：
                {snapshot.process.status !== 'ready'
                  ? '未知'
                  : !snapshot.process.value.owner
                    ? '归属未知'
                    : external
                      ? '外部管理'
                      : snapshot.process.value.state === 'stopped'
                        ? '未运行'
                        : '运行中'}
              </span>
              <span>
                {snapshot.connection.status !== 'ready'
                  ? 'Hive 状态未知'
                  : snapshot.connection.value.state === 'connected'
                    ? 'Hive 已连接'
                    : 'Hive 连接已断开'}
              </span>
              <span>真实供给未启动</span>
            </div>
          </div>
        </div>
        {running ? (
          <ConfirmDialog
            trigger={<button disabled={busy}>暂停贡献</button>}
            title="暂停演示贡献？"
            description="仅暂停本地演示状态，不会改变真实 Bee 的供给状态。"
            confirmLabel="确认暂停"
            busy={busy}
            onConfirm={() => dispatch({ type: 'setAllPaused', paused: true })}
          />
        ) : (
          <button
            className="primary"
            disabled={busy || !eligible || !chosen.length}
            aria-busy={busy}
            onClick={() => void dispatch({ type: 'startContribution', platforms: chosen })}
          >
            开始贡献
          </button>
        )}
      </section>
      <div className="connection-summary">
        <span>{snapshot.connection.value?.endpointLabel ?? 'Hive 地址未知'}</span>
        <small>上次更新：{snapshot.connection.updatedAt ?? '尚未确认'}</small>
        <div className="inline-actions">
          <button disabled={busy} onClick={() => void dispatch({ type: 'refresh' })}>
            刷新状态
          </button>
          <button onClick={onDiagnostics}>检查连接</button>
        </div>
      </div>
      {snapshot.connection.status === 'error' && (
        <StatusView
          kind="error"
          title="Hive 读取失败"
          onRetry={() => void dispatch({ type: 'refresh' })}
        >
          {snapshot.connection.error.code}：{snapshot.connection.error.message} 上次更新：
          {snapshot.connection.updatedAt ?? '未知'}
        </StatusView>
      )}
      {snapshot.binding.status === 'ready' && snapshot.binding.value.state === 'bound' && (
        <Metrics snapshot={snapshot} onRetry={() => void dispatch({ type: 'refresh' })} />
      )}
      <div className="section-heading">
        <h2>AI 账号</h2>
        <button className="quiet" onClick={onAccounts}>
          管理账号
        </button>
      </div>
      {snapshot.accounts.status !== 'ready' && (
        <StatusView
          kind={snapshot.accounts.status === 'loading' ? 'loading' : 'error'}
          title={snapshot.accounts.status === 'loading' ? '正在读取…' : '读取失败'}
          onRetry={() => void dispatch({ type: 'refresh' })}
        >
          {snapshot.accounts.status === 'error'
            ? `${snapshot.accounts.error.code}：${snapshot.accounts.error.message} 上次更新：${snapshot.accounts.updatedAt ?? '未知'}`
            : '账号状态未确认，不能开始贡献。'}
        </StatusView>
      )}
      {snapshot.accounts.status === 'ready' && !accounts.length && (
        <StatusView kind="empty" title="尚未添加 AI 账号">
          请先绑定本机，再检测平台登录。
        </StatusView>
      )}
      <div className="account-list">
        {(['openai', 'claude'] as Platform[]).map((platform) => {
          const account = accounts.find((a) => a.platform === platform);
          const name = platform === 'openai' ? 'OpenAI' : 'Claude';
          const active = eligible && account?.state === 'available' && !account.paused;
          const condition =
            snapshot.accounts.status !== 'ready'
              ? '账号状态未确认'
              : !account
                ? '尚未接入'
                : account.state !== 'available'
                  ? '授权不可用'
                  : !eligible
                    ? '接单条件未确认'
                    : active
                      ? '贡献中'
                      : '已暂停';
          return (
            <section className="account-row" role="region" aria-label={`${name} 供给`} key={platform}>
              <div className="platform">
                <span className={`platform-mark ${platform}`}>{platform === 'openai' ? 'O' : '✳'}</span>
                <div>
                  <strong>
                    {name}
                    {account && <span className="plan">{account.plan}</span>}
                  </strong>
                  <small>{condition}</small>
                  {account?.feedback && <small className="platform-feedback">{account.feedback}</small>}
                </div>
              </div>
              <div>
                {account?.quota && account.state === 'available' ? (
                  <>
                    <span className="muted">{account.quota.window}剩余额度</span>
                    <strong className="quota-value">{account.quota.remaining}%</strong>
                    <meter
                      min={0}
                      max={100}
                      value={account.quota.remaining}
                      aria-label={`${name} 剩余额度`}
                    />
                    <small>{account.quota.resetsAt}</small>
                  </>
                ) : (
                  <span className="muted">额度尚未确认</span>
                )}
              </div>
              <div className="platform-actions">
                <label>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${name}`}
                    checked={selection.includes(platform)}
                    disabled={busy || !account || account.state !== 'available'}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? [...selection, platform]
                          : selection.filter((p) => p !== platform),
                      )
                    }
                  />
                  选择平台
                </label>
                {account ? (
                  <button
                    disabled={busy || !eligible}
                    onClick={() =>
                      void dispatch({
                        type: 'setPlatformPaused',
                        platform,
                        paused: !account.paused,
                      })
                    }
                  >
                    {account.paused ? '恢复' : '暂停'} {name}
                  </button>
                ) : (
                  snapshot.binding.value?.state === 'bound' && (
                    <button
                      disabled={busy || !eligible}
                      onClick={() => void dispatch({ type: 'detectAccount', platform })}
                    >
                      连接 {name}
                    </button>
                  )
                )}
              </div>
            </section>
          );
        })}
      </div>
      <button
        className="quiet"
        disabled={busy || !eligible}
        onClick={() => void dispatch({ type: 'setAllPaused', paused: false })}
      >
        恢复全部就绪平台
      </button>
    </>
  );
}
