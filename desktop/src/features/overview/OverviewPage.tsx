import { t } from '../../i18n/index';
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
      <StatusView kind="loading" title={t("正在读取…")}>{t("等待当前页面数据。")}</StatusView>
    );
  if (state.status === 'error' && !state.value)
    return (
      <StatusView kind="error" title={t("读取失败")} onRetry={onRetry}>
        {t(state.error.code)}：{t(state.error.message)}
      </StatusView>
    );
  if (empty)
    return (
      <StatusView kind="empty" title={t("尚未添加 AI 账号")}>{t("请在概览中检测并连接 AI 账号。")}</StatusView>
    );
  return (
    <>
      {state.status === 'error' && (
        <StatusView kind="error" title={t("旧值 · 刷新失败")} onRetry={onRetry}>
          {t(state.error.code)}：{t(state.error.message)}{t(" 上次更新：")}{t(state.updatedAt ?? '未知')}
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
                  {t(account.platform === 'openai' ? 'O' : '✳')}
                </span>
                <div>
                  <strong>
                    {account.label} <span className="plan">{account.plan}</span>
                  </strong>
                  <small>{t("演示账号 · ")}{t(account.state === 'available' ? '可用于演示' : '不可用')}</small>
                </div>
              </div>
              <span className="account-condition">
                <Check aria-hidden="true" />
                {t(account.state === 'available' ? '状态正常' : '待检查')}
              </span>
              <span className="muted">{t("后续开放账号管理")}</span>
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
        <section className="finance" aria-label={t("收益摘要")}>
          {[
            ['可用余额', earnings.balance, '收益与资金操作将在后续开放'],
            ['今日收益', earnings.today, '演示统计'],
            ['累计收益', earnings.total, '演示统计'],
          ].map(([label, amount, caption]) => (
            <div key={label}>
              <p>{t(label)}</p>
              <div className="amount">
                <span>$</span>
                {formatAmount(amount)}
              </div>
              <small>{t(caption)}</small>
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
  const started =
    snapshot.binding.status === 'ready' && snapshot.binding.value.onboardingComplete === true;
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
              title={t(domain === 'process' ? '本机进程读取失败' : '绑定读取失败')}
              onRetry={() => void dispatch({ type: 'refresh' })}
            >
              {t(snapshot[domain].error.code)}：{t(snapshot[domain].error.message)}{t(" 上次更新：")}{t(snapshot[domain].updatedAt ?? '未知')}
            </StatusView>
          ),
      )}
      {external && (
        <StatusView kind="unavailable" title={t("外部管理的 Bee")}>{t("仅查看；不会复制配置或终止外部进程。")}</StatusView>
      )}
      <section className="running">
        <div className="running-title">
          <span className="emblem">{running ? <Zap /> : <CirclePause />}</span>
          <div>
            <h2>
              {t(snapshot.process.status !== 'ready'
                ? '进程状态未知'
                : running
                  ? '演示贡献中'
                  : '尚未开始贡献')}
            </h2>
            <p>{t("由你决定何时开始，让闲置的 AI 额度创造价值。")}</p>
            <div className="health">
              <span>{t("本机进程：")}{t(snapshot.process.status !== 'ready'
                  ? '未知'
                  : !snapshot.process.value.owner
                    ? '归属未知'
                    : external
                      ? '外部管理'
                      : snapshot.process.value.state === 'stopped'
                        ? '未运行'
                        : '运行中')}
              </span>
              <span>
                {t(snapshot.connection.status !== 'ready'
                  ? 'Hive 状态未知'
                  : snapshot.connection.value.state === 'connected'
                    ? 'Hive 已连接'
                    : 'Hive 连接已断开')}
              </span>
              <span>{t("真实供给未启动")}</span>
            </div>
          </div>
        </div>
        {running ? (
          <ConfirmDialog
            trigger={<button disabled={busy}>{t("暂停贡献")}</button>}
            title={t("暂停演示贡献？")}
            description={t("仅暂停本地演示状态，不会改变真实 Bee 的供给状态。")}
            confirmLabel={t("确认暂停")}
            busy={busy}
            onConfirm={() => dispatch({ type: 'setAllPaused', paused: true })}
          />
        ) : (
          <button
            className="primary"
            disabled={busy || !eligible || !chosen.length}
            aria-busy={busy}
            onClick={() => void dispatch({ type: 'startContribution', platforms: chosen })}
          >{t("开始贡献")}</button>
        )}
      </section>
      <div className="connection-summary">
        <span>{snapshot.connection.value?.endpointLabel === 'Hive 演示连接' ? t('Hive 演示连接') : snapshot.connection.value?.endpointLabel ?? t('Hive 地址未知')}</span>
        <small>{t("上次更新：")}{t(snapshot.connection.updatedAt ?? '尚未确认')}</small>
        <div className="inline-actions">
          <button disabled={busy} onClick={() => void dispatch({ type: 'refresh' })}>{t("刷新状态")}</button>
          <button onClick={onDiagnostics}>{t("检查连接")}</button>
        </div>
      </div>
      {snapshot.connection.status === 'error' && (
        <StatusView
          kind="error"
          title={t("Hive 读取失败")}
          onRetry={() => void dispatch({ type: 'refresh' })}
        >
          {t(snapshot.connection.error.code)}：{t(snapshot.connection.error.message)}{t(" 上次更新：")}{t(snapshot.connection.updatedAt ?? '未知')}
        </StatusView>
      )}
      {snapshot.binding.status === 'ready' && snapshot.binding.value.state === 'bound' && (
        <Metrics snapshot={snapshot} onRetry={() => void dispatch({ type: 'refresh' })} />
      )}
      <div className="section-heading">
        <h2>{t("AI 账号")}</h2>
        <button className="quiet" onClick={onAccounts}>{t("管理账号")}</button>
      </div>
      {snapshot.accounts.status !== 'ready' && (
        <StatusView
          kind={snapshot.accounts.status === 'loading' ? 'loading' : 'error'}
          title={t(snapshot.accounts.status === 'loading' ? '正在读取…' : '读取失败')}
          onRetry={() => void dispatch({ type: 'refresh' })}
        >
          {t(snapshot.accounts.status === 'error'
            ? `${snapshot.accounts.error.code}：${snapshot.accounts.error.message} 上次更新：${snapshot.accounts.updatedAt ?? '未知'}`
            : '账号状态未确认，不能开始贡献。')}
        </StatusView>
      )}
      {snapshot.accounts.status === 'ready' && !accounts.length && (
        <StatusView kind="empty" title={t("尚未添加 AI 账号")}>{t("请先绑定本机，再检测平台登录。")}</StatusView>
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
            <section className="account-row" role="region" aria-label={t(`${name} 供给`)} key={platform}>
              <div className="platform">
                <span className={`platform-mark ${platform}`}>{t(platform === 'openai' ? 'O' : '✳')}</span>
                <div>
                  <strong>
                    {t(name)}
                    {account && <span className="plan">{account.plan}</span>}
                  </strong>
                  <small>{t(condition)}</small>
                  {account?.feedback && <small className="platform-feedback">{t(account.feedback)}</small>}
                </div>
              </div>
              <div>
                {account?.quota && account.state === 'available' ? (
                  <>
                    <span className="muted">{t(account.quota.window)}{t("剩余额度")}</span>
                    <strong className="quota-value">{t(account.quota.remaining)}%</strong>
                    <meter
                      min={0}
                      max={100}
                      value={account.quota.remaining}
                      aria-label={t(`${name} 剩余额度`)}
                    />
                    <small>{t(account.quota.resetsAt)}</small>
                  </>
                ) : (
                  <span className="muted">{t("额度尚未确认")}</span>
                )}
              </div>
              <div className="platform-actions">
                <label>
                  <input
                    type="checkbox"
                    aria-label={t(`选择 ${name}`)}
                    checked={selection.includes(platform)}
                    disabled={busy || !account || account.state !== 'available'}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? [...selection, platform]
                          : selection.filter((p) => p !== platform),
                      )
                    }
                  />{t("选择平台")}</label>
                {account ? (
                  <button
                    disabled={busy || !eligible || (account.paused && !started)}
                    onClick={() =>
                      void dispatch({
                        type: 'setPlatformPaused',
                        platform,
                        paused: !account.paused,
                      })
                    }
                  >
                    {t(account.paused ? '恢复' : '暂停')} {t(name)}
                  </button>
                ) : (
                  snapshot.binding.value?.state === 'bound' && (
                    <button
                      disabled={busy || !eligible}
                      onClick={() => void dispatch({ type: 'detectAccount', platform })}
                    >{t("连接 ")}{t(name)}
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
        disabled={busy || !eligible || !started}
        onClick={() => void dispatch({ type: 'setAllPaused', paused: false })}
      >{t("恢复全部就绪平台")}</button>
    </>
  );
}
