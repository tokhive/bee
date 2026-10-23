import { LifecycleControls } from '../features/lifecycle/LifecycleControls';
import { preferenceScope, defaultHive } from '../features/settings/preferences';
import { t, useLanguage } from '../i18n/index';
import { SettingsPage } from '../features/settings/SettingsPage';
import { DiagnosticsPage } from '../features/diagnostics/DiagnosticsPage';
import { useDemoNotifications } from '../features/settings/notifications';
import { useEffect, useRef, useState } from 'react';
import { OverviewPage } from '../features/overview/OverviewPage';
import { EarningsPage } from '../features/earnings/EarningsPage';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import type { BeeClient, DesktopCommand, Page } from '../client/types';
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
  const notifications = useDemoNotifications(data.status === 'ready' ? data.snapshot : undefined);
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
      if (command.type === 'changeHive' && result.kind === 'confirmed') setPage('overview');
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
  const snapshot = data.status === 'ready' ? data.snapshot : undefined;
  useLanguage(snapshot?.preferences.value?.language ?? 'system');
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.preferences.value?.theme ?? 'system';
  }, [snapshot?.preferences.value?.theme]);
  const bound = snapshot?.binding.status === 'ready' && snapshot.binding.value.state === 'bound';
  const debug =
    debugToolsEnabled && snapshot?.mode === 'demo' ? (
      <label className="scene-control">{t("演示场景")}<select
          aria-label={t("演示场景")}
          value={new URLSearchParams(location.search).get('scene') || 'ready'}
          onChange={(event) => {
            const url = new URL(location.href);
            url.searchParams.set('scene', event.target.value);
            location.assign(url.href);
          }}
        >
          {scenes.map((scene) => (
            <option key={scene}>{t(scene)}</option>
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
        <StatusView kind="error" title={t("无法载入演示场景")}>
          {t(initialError)}
        </StatusView>
      ) : data.status === 'loading' ? (
        <StatusView kind="loading" title={t("正在读取 Bee…")} />
      ) : data.status === 'error' ? (
        <StatusView kind="error" title={t("读取失败")}>
          {t(data.message)}
        </StatusView>
      ) : snapshot?.mode === 'unavailable' ? (
        <StatusView kind="unavailable" title={t("业务服务未接通")}>
          {t(snapshot.connection.status === 'error'
            ? snapshot.connection.error.message
            : '等待真实业务适配器接入。')}
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
                  <span>{t("当前任务：")}{t(snapshot.tasks.status === 'ready' && snapshot.tasks.value.kind === 'known'
                      ? snapshot.tasks.value.count
                      : '未知')}
                  </span>
                  <DetailSheet
                    trigger={<button className="quiet">{t("查看连接详情")}</button>}
                    title={t("连接详情")}
                    description={t("业务演示与原生管理进程独立。")}
                  >
                    <dl>
                      <dt>{t("业务连接")}</dt>
                      <dd>{snapshot.connection.value?.endpointLabel === 'Hive 演示连接' ? t('Hive 演示连接') : snapshot.connection.value?.endpointLabel ?? t('未知')}</dd>
                      <dt>{t("原生管理进程")}</dt>
                      <dd>{native.state}</dd>
                      {native.error && (
                        <>
                          <dt>{t("原生检查结果")}</dt>
                          <dd>
                            {t(native.error.code)}：{t(native.error.message)}
                          </dd>
                        </>
                      )}
                      <dt>{t("真实贡献")}</dt>
                      <dd>{t("未由演示操作启动")}</dd>
                    </dl>
                  </DetailSheet>
                </div>
              </>
            )}
            {(page === 'accounts' || page === 'earnings') && !bound && (
              <StatusView kind="empty" title={t("请先完成 Hive 登录与设备绑定")}>{t("请回到概览继续首次接入。")}</StatusView>
            )}
            {page === 'accounts' && bound && (
              <AccountsPage snapshot={snapshot} busy={busy} dispatch={dispatch} />
            )}
            {page === 'earnings' && bound && <EarningsPage snapshot={snapshot} client={client} />}
            {page === 'diagnostics' && <DiagnosticsPage snapshot={snapshot} client={client} />}
            {page === 'settings' && <SettingsPage key={JSON.stringify(preferenceScope(snapshot.preferences.value?.hiveAddress ?? defaultHive, snapshot.binding.status === 'ready' ? snapshot.binding.value : undefined))} snapshot={snapshot} busy={busy} dispatch={dispatch} checkNotifications={notifications.check} notifications={notifications.messages} />}
          </>
        )
      )}
      {snapshot?.mode === 'demo' && <LifecycleControls client={client} snapshot={snapshot} />}
      {message && (
        <p className="operation-message" role="status">
          {t(message)}
        </p>
      )}
    </AppShell>
  );
}
