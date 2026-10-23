import { useEffect, useState } from 'react';
import { Check, CirclePause, ShieldCheck, Zap } from 'lucide-react';
import type { BeeClient, DecimalAmount, DesktopCommand, DesktopSnapshot, Page, ReadState } from '../client/types';
import { useBee } from '../client/useBee';
import { debugToolsEnabled, scenes } from '../client/scenes';
import type { BridgeStatus, SystemBridge } from '../system/bridge';
import { AppShell } from '../components/AppShell';
import { StatusView } from '../components/StatusView';
import { DetailSheet } from '../components/DetailSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';

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
  if (state.status === 'error')
    return (
      <StatusView kind="error" title="读取失败" onRetry={onRetry}>
        {state.error.code}：{state.error.message}
      </StatusView>
    );
  if (empty)
    return (
      <StatusView kind="empty" title="尚未添加 AI 账号">
        账号接入功能将在后续开放。
      </StatusView>
    );
  return children(state.value);
}
function AccountList({ snapshot, onRetry }: { snapshot: DesktopSnapshot; onRetry: () => void }) {
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

function Metrics({ snapshot, onRetry }: { snapshot: DesktopSnapshot; onRetry: () => void }) {
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
export function App({
  client,
  systemBridge,
  initialError,
  demoMode = false,
}: {
  client: BeeClient;
  systemBridge: SystemBridge;
  initialError?: string;
  demoMode?: boolean;
}) {
  const data = useBee(client);
  const [page, setPage] = useState<Page>('overview');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [native, setNative] = useState<BridgeStatus>({ state: 'starting' });
  useEffect(() => {
    let active = true;
    let updated = false;
    let dispose: (() => void) | undefined;
    const failed = (cause: unknown) => {
      if (active)
        setNative({
          state: 'failed',
          error: { code: 'NATIVE_STATUS_FAILED', message: `读取原生管理状态失败：${String(cause)}` },
        });
    };
    void systemBridge
      .onStatus((status) => {
        updated = true;
        if (active) setNative(status);
      })
      .then((off) => {
        if (active) dispose = off;
        else off();
      }, failed);
    void systemBridge.status().then((status) => {
      if (active && !updated) setNative(status);
    }, failed);
    return () => {
      active = false;
      dispose?.();
    };
  }, [systemBridge]);
  const dispatch = async (command: DesktopCommand) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await client.dispatch(command);
      setMessage(result.kind === 'failed' ? `${result.error.code}：${result.error.message}` : result.message);
    } catch (cause) {
      setMessage(`执行 ${command.type} 失败：${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => {
    void dispatch({ type: 'snapshot.refresh' });
  };
  const snapshot = data.status === 'ready' ? data.snapshot : undefined;
  const debug =
    debugToolsEnabled && snapshot?.mode === 'demo' ? (
      <label className="scene-control">
        演示场景
        <select
          aria-label="演示场景"
          value={new URLSearchParams(location.search).get('scene') || 'ready'}
          onChange={(event) => {
            const url = new URL(location.href);
            url.searchParams.set('scene', event.target.value);
            location.assign(url.href);
          }}
        >
          {scenes.map((scene) => (
            <option key={scene}>{scene}</option>
          ))}
        </select>
      </label>
    ) : undefined;
  return (
    <AppShell page={page} onNavigate={setPage} demo={demoMode || snapshot?.mode === 'demo'} debug={debug}>
      {initialError ? (
        <StatusView kind="error" title="无法载入演示场景">
          {initialError}
        </StatusView>
      ) : data.status === 'loading' ? (
        <StatusView kind="loading" title="正在读取 Bee…" />
      ) : data.status === 'error' ? (
        <StatusView kind="error" title="读取失败">
          {data.message}
        </StatusView>
      ) : snapshot?.mode === 'unavailable' ? (
        <StatusView kind="unavailable" title="业务服务未接通">
          {snapshot.connection.status === 'error'
            ? snapshot.connection.error.message
            : '等待真实业务适配器接入。'}
        </StatusView>
      ) : (
        snapshot && (
          <>
            {page === 'overview' && (
              <>
                {snapshot.binding.value?.state === 'unbound' && (
                  <StatusView kind="empty" title="欢迎使用 Bee">
                    首次接入引导将在后续开放；此处尚未绑定账号。
                  </StatusView>
                )}
                <section className="running">
                  <div className="running-title">
                    <span className="emblem">
                      {snapshot.process.value?.state === 'contributing' ? (
                        <Zap aria-hidden="true" />
                      ) : (
                        <CirclePause aria-hidden="true" />
                      )}
                    </span>
                    <div>
                      <h2>
                        {snapshot.process.value?.state === 'contributing' ? '演示贡献中' : '尚未开始贡献'}
                      </h2>
                      <p>由你决定何时开始，让闲置的 AI 额度创造价值。</p>
                      <div className="health">
                        <span>
                          <Check aria-hidden="true" />
                          演示连接已准备
                        </span>
                        <span>
                          <ShieldCheck aria-hidden="true" />
                          真实供给未启动
                        </span>
                      </div>
                    </div>
                  </div>
                  {snapshot.process.value?.state === 'contributing' ? (
                    <ConfirmDialog
                      trigger={<button disabled={busy}>暂停贡献</button>}
                      title="暂停演示贡献？"
                      description="仅暂停本地演示状态，不会改变真实 Bee 的供给状态。"
                      confirmLabel="确认暂停"
                      busy={busy}
                      onConfirm={() => dispatch({ type: 'contribution.pause' })}
                    />
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        busy || !snapshot.accounts.value?.length || snapshot.binding.value?.state !== 'bound'
                      }
                      aria-busy={busy}
                      onClick={() => {
                        void dispatch({ type: 'contribution.start' });
                      }}
                    >
                      {busy ? '处理中…' : '开始贡献'}
                    </button>
                  )}
                </section>
                <Metrics snapshot={snapshot} onRetry={refresh} />
                <div className="section-heading">
                  <h2>AI 账号</h2>
                  <button className="quiet" onClick={() => setPage('accounts')}>
                    管理账号
                  </button>
                </div>
                <AccountList snapshot={snapshot} onRetry={refresh} />
                <div className="bottomline">
                  <span>
                    当前任务：{snapshot.tasks.value?.kind === 'known' ? snapshot.tasks.value.count : '未知'}
                  </span>
                  <DetailSheet
                    trigger={<button className="quiet">查看连接详情</button>}
                    title="连接详情"
                    description="业务演示与原生管理进程独立。"
                  >
                    <dl>
                      <dt>业务连接</dt>
                      <dd>{snapshot.connection.value?.endpointLabel ?? '未知'}</dd>
                      <dt>原生管理进程</dt>
                      <dd>{native.state}</dd>
                      {native.error && (
                        <>
                          <dt>原生检查结果</dt>
                          <dd>
                            {native.error.code}：{native.error.message}
                          </dd>
                        </>
                      )}
                      <dt>真实贡献</dt>
                      <dd>未由演示操作启动</dd>
                    </dl>
                  </DetailSheet>
                </div>
              </>
            )}
            {page === 'accounts' && (
              <>
                <AccountList snapshot={snapshot} onRetry={refresh} />
                <p className="feature-note">检测、授权、换号与移除将在后续开放。</p>
              </>
            )}
            {page === 'earnings' && (
              <>
                <Metrics snapshot={snapshot} onRetry={refresh} />
                <StatusView kind="empty" title="收益明细将在后续开放">
                  当前金额为演示数据；报价、划转与提现尚未接入。
                </StatusView>
              </>
            )}
            {page === 'diagnostics' && (
              <>
                <section className="settings-list">
                  <div>
                    <strong>原生管理进程</strong>
                    <span>{native.state}</span>
                  </div>
                  <div>
                    <strong>业务连接</strong>
                    <span>{snapshot.connection.value?.endpointLabel ?? '未知'}</span>
                  </div>
                  <div>
                    <strong>进行中任务</strong>
                    <span>
                      {snapshot.tasks.value?.kind === 'known' ? snapshot.tasks.value.count : '未知'}
                    </span>
                  </div>
                </section>
                <p className="feature-note">自检、日志与脱敏报告将在后续开放。</p>
              </>
            )}
            {page === 'settings' && (
              <>
                <section className="settings-list">
                  <div>
                    <strong>语言</strong>
                    <span>
                      {snapshot.preferences.value?.language === 'system'
                        ? '跟随系统'
                        : snapshot.preferences.value?.language}
                    </span>
                  </div>
                  <div>
                    <strong>外观</strong>
                    <span>
                      {snapshot.preferences.value?.theme === 'system'
                        ? '跟随系统'
                        : snapshot.preferences.value?.theme}
                    </span>
                  </div>
                </section>
                <p className="feature-note">偏好设置与系统设置将在后续开放。</p>
              </>
            )}
          </>
        )
      )}
      {message && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
    </AppShell>
  );
}
