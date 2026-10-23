import { useEffect, useRef, useState } from 'react';
import { OverviewPage, AccountList, Metrics } from '../features/overview/OverviewPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import type { BeeClient, DesktopCommand, Page, Preferences } from '../client/types';
import { useBee } from '../client/useBee';
import { debugToolsEnabled, scenes } from '../client/scenes';
import type { BridgeStatus, SystemBridge } from '../system/bridge';
import { AppShell } from '../components/AppShell';
import { StatusView } from '../components/StatusView';
import { DetailSheet } from '../components/DetailSheet';

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
  const dispatching = useRef(false);
  const [native, setNative] = useState<BridgeStatus>({ state: 'starting' });
  useEffect(() => {
    let active = true;
    let updated = false;
    let dispose: (() => void) | undefined;
    const failed = (cause: unknown) => {
      if (active)
        setNative({
          state: 'failed',
          error: {
            code: 'NATIVE_STATUS_FAILED',
            message: `读取原生管理状态失败：${String(cause)}`,
          },
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
    if (dispatching.current) return;
    dispatching.current = true;
    setBusy(true);
    setMessage('正在处理演示操作…');
    try {
      const result = await client.dispatch(command);
      setMessage(
        result.kind === 'failed' ? `${result.error.code}：${result.error.message}` : result.message,
      );
    } catch (cause) {
      setMessage(`执行 ${command.type} 失败：${String(cause)}`);
    } finally {
      dispatching.current = false;
      setBusy(false);
    }
  };
  const refresh = () => {
    void dispatch({ type: 'refresh' });
  };
  const snapshot = data.status === 'ready' ? data.snapshot : undefined;
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.preferences.value?.theme ?? 'system';
  }, [snapshot?.preferences.value?.theme]);
  const bound = snapshot?.binding.status === 'ready' && snapshot.binding.value.state === 'bound';
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
    <AppShell
      page={page}
      onNavigate={setPage}
      demo={demoMode || snapshot?.mode === 'demo'}
      debug={debug}
    >
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
                {!snapshot.binding.value?.onboardingComplete && (
                  <OnboardingPage snapshot={snapshot} busy={busy} dispatch={dispatch} />
                )}
                <OverviewPage
                  snapshot={snapshot}
                  busy={busy}
                  dispatch={dispatch}
                  onDiagnostics={() => setPage('diagnostics')}
                  onAccounts={() => setPage('accounts')}
                />
                <div className="bottomline">
                  <span>
                    当前任务：
                    {snapshot.tasks.status === 'ready' && snapshot.tasks.value.kind === 'known'
                      ? snapshot.tasks.value.count
                      : '未知'}
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
            {(page === 'accounts' || page === 'earnings') && !bound && (
              <StatusView kind="empty" title="请先完成 Hive 登录与设备绑定">
                请回到概览继续首次接入。
              </StatusView>
            )}
            {page === 'accounts' && bound && (
              <>
                <AccountList snapshot={snapshot} onRetry={refresh} />
                <p className="feature-note">授权、换号与移除将在后续开放；账号检测可在概览操作。</p>
              </>
            )}
            {page === 'earnings' && bound && (
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
              <DemoSettings
                key={snapshot.preferences.updatedAt}
                preferences={snapshot.preferences.value}
                busy={busy}
                save={(preferences) => dispatch({ type: 'savePreferences', preferences })}
              />
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

function DemoSettings({
  preferences,
  busy,
  save,
}: {
  preferences?: Preferences;
  busy: boolean;
  save: (preferences: Preferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Preferences>(
    preferences ?? { theme: 'system', language: 'system' },
  );
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <label>
        Hive 地址
        <input
          value={draft.hiveAddress ?? ''}
          onChange={(e) => setDraft({ ...draft, hiveAddress: e.target.value })}
        />
      </label>
      <label>
        代理地址
        <input
          placeholder="关闭（留空）"
          value={draft.proxyAddress ?? ''}
          onChange={(e) => setDraft({ ...draft, proxyAddress: e.target.value })}
        />
      </label>
      <label>
        外观
        <select
          aria-label="外观"
          value={draft.theme}
          onChange={(e) =>
            setDraft({
              ...draft,
              theme: e.target.value as Preferences['theme'],
            })
          }
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <button disabled={busy} aria-busy={busy} type="submit">
        保存演示设置
      </button>
      <p className="feature-note">
        仅修改本地演示；切换 Hive 会清除演示登录和绑定。完整偏好持久化将在后续开放。
      </p>
    </form>
  );
}
