import { AddressValidationError, defaultHive, defaults, loadPreferences, savePreferences, selectedHive, selectHive, preferenceScope, validateAddress } from '../features/settings/preferences';
import { sanitizedDiagnostics } from '../features/diagnostics/report';
import { initialFinance, demoFinance } from './demoFinance';
import { parseScene } from './scenes';
import type { Account, BeeClient, DesktopSnapshot, Platform, ReadState } from './types';

const platforms: Platform[] = ['openai', 'claude'];
const names = { openai: 'OpenAI', claude: 'Claude' };
export function createDemoClient(scene: string, storage?: Storage): BeeClient {
  const selected = parseScene(scene);
  const now = new Date().toISOString();
  const ready = <T>(value: T): ReadState<T> => ({
    status: 'ready',
    value,
    updatedAt: new Date().toISOString(),
  });
  const fresh = ['onboarding', 'pending', 'unknown-result', 'operation-error'].includes(selected);
  const account = (platform: Platform): Account => ({
    id: `demo-${platform}`,
    platform,
    label: names[platform],
    plan: platform === 'openai' ? 'Plus' : 'Pro',
    state: selected === 'authorization-expired' ? 'unavailable' : 'available',
    paused: true,
    identifier: 'dayong@example.com',
    authorization: selected === 'authorization-expired' ? 'expired' : 'valid',
    source: 'existing-login',
    updatedAt: now,
    models: (platform === 'openai' ? ['GPT-5', 'GPT-4.1'] : ['Claude Sonnet', 'Claude Opus']).map(
      (name, index) => ({
        name,
        supported: selected !== 'authorization-expired',
        marketOpen: index === 0,
      }),
    ),
    pendingChange:
      selected === 'account-change' ? { identifier: 'another@example.com' } : undefined,
    quota:
      selected === 'quota-unknown'
        ? undefined
        : {
            remaining: platform === 'openai' ? 82 : 46,
            window: '5 小时',
            resetsAt: platform === 'openai' ? '2 小时后重置' : '48 分钟后重置',
          },
  });
  let state: DesktopSnapshot = {
    mode: 'demo',
    binding: ready({
      state: fresh || selected === 'configured' ? 'unbound' : 'bound',
      loggedIn: !fresh,
      userId: fresh ? undefined : 'demo-user',
      onboardingComplete: !fresh && selected !== 'configured',
      label: fresh ? undefined : 'Bee 演示账号',
      source: selected === 'configured' ? 'existing' : 'new',
      replaceDevice: selected === 'configured' ? '旧演示设备' : undefined,
    }),
    process: ready({
      state: 'paused',
      owner: selected === 'external' ? 'external' : 'app',
    }),
    connection: ready({
      state:
        fresh || selected === 'configured' || selected === 'offline' ? 'disconnected' : 'connected',
      endpointLabel: 'Hive 演示连接',
      persistentOffline: selected === 'offline',
    }),
    accounts: ready(
      fresh || selected === 'empty' || selected === 'configured' ? [] : platforms.map(account),
    ),
    earnings: ready({
      balance: '128.560000000',
      today: '6.820000000',
      total: '382.140000000',
    }),
    finance: ready(initialFinance(undefined, undefined, selected === 'earnings-empty')),
    tasks: ready(
      selected === 'unknown-tasks'
        ? { kind: 'unknown' }
        : { kind: 'known', count: selected === 'active-tasks' ? 2 : 0 },
    ),
    preferences: ready({
      theme: 'system',
      language: 'system',
      hiveAddress: 'Hive 演示连接',
      proxyAddress: '',
    }),
  };
  let preferenceStorage: Storage | undefined;
  let preferenceFailure: string | undefined;
  try {
    preferenceStorage = typeof localStorage === 'undefined' ? undefined : localStorage;
    const hive = preferenceStorage ? selectedHive(preferenceStorage) : defaultHive;
    // An endpoint choice never restores a login. Fixture login exists only for the initial Hive.
    if (preferenceStorage && preferenceStorage.getItem('bee.demo.selected-hive.v1') !== null) {
      state.binding = ready({ state: 'unbound', loggedIn: false, source: 'new' });
      state.accounts = ready([]);
      state.connection = ready({ state: 'disconnected', endpointLabel: hive });
    }
    state.preferences = ready(preferenceStorage ? loadPreferences(preferenceStorage, preferenceScope(hive, state.binding.value)) : defaults(hive));
  } catch (cause) {
    preferenceFailure = `普通偏好读取失败：${String(cause)}；未恢复任何登录状态。`;
    state.preferences = { status: 'error', updatedAt: null, error: { code: 'DEMO_PREFERENCES_READ', message: preferenceFailure } };
    state.binding = ready({ state: 'unbound', loggedIn: false, source: 'new' });
    state.accounts = ready([]);
    state.connection = { status: 'error', updatedAt: null, error: { code: 'DEMO_PREFERENCES_READ', message: preferenceFailure } };
    state.process = ready({ state: 'paused', owner: state.process.value?.owner });
    state.tasks = ready({ kind: 'unknown' });
  }
  state.diagnostics = ready(sanitizedDiagnostics([], []));
  let diagnosisAttempts = 0;
  state.finance = ready(initialFinance(state.preferences.value?.hiveAddress ?? defaultHive, state.binding.value?.loggedIn ? state.binding.value.userId ?? '' : '', selected === 'earnings-empty'));
  const finance = demoFinance(selected, storage);
  finance.restore(state);
  if (selected === 'earnings-loading')
    state.finance = { status: 'loading', updatedAt: null };
  if (selected === 'earnings-error')
    state.finance = {
      status: 'error',
      updatedAt: null,
      error: {
        code: 'DEMO_EARNINGS_UNAVAILABLE',
        message: '收益读取失败：场景 earnings-error 模拟结算源不可用。',
      },
    };
  // Controlled read states include an old zero to exercise the freshness guard.
  if (selected === 'tasks-loading')
    state.tasks = { status: 'loading', updatedAt: now, value: { kind: 'known', count: 0 } };
  if (selected === 'tasks-error')
    state.tasks = {
      status: 'error',
      updatedAt: now,
      value: { kind: 'known', count: 0 },
      error: {
        code: 'DEMO_TASKS_UNAVAILABLE',
        message: '任务读取失败：场景 tasks-error 模拟当前任务源不可用；旧值 count=0 不代表已收尾。',
      },
    };
  if (selected === 'loading') state.accounts = { status: 'loading', updatedAt: null };
  if (selected === 'unknown') state.connection = { status: 'loading', updatedAt: null };
  if (selected === 'error')
    state.accounts = {
      status: 'error',
      updatedAt: now,
      error: {
        code: 'DEMO_ACCOUNTS_UNAVAILABLE',
        message: '演示账号读取失败：场景 error 模拟账号源不可用。',
      },
    };
  if (selected === 'offline')
    state.earnings = {
      ...state.earnings,
      status: 'error',
      error: {
        code: 'DEMO_HIVE_OFFLINE',
        message: '收益刷新失败：演示 Hive 连接=disconnected；保留上次读取值。',
      },
    };
  const explicitlyRemoved = new Set<Platform>();
  const listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  const publish = () => {
    for (const listener of listeners) listener(structuredClone(state));
  };
  const fail = (code: string, message: string) => ({
    kind: 'failed' as const,
    error: { code, message },
  });
  const prerequisites = () => {
    if (state.binding.status !== 'ready' || state.binding.value.state !== 'bound')
      return `绑定检查失败：读取=${state.binding.status}，绑定=${state.binding.value?.state ?? 'unknown'}。`;
    if (
      state.process.status !== 'ready' ||
      state.process.value.owner !== 'app' ||
      state.process.value.state === 'stopped'
    )
      return `进程归属检查失败：读取=${state.process.status}，归属=${state.process.value?.owner ?? 'unknown'}，进程=${state.process.value?.state ?? 'unknown'}。`;
    if (state.connection.status !== 'ready' || state.connection.value.state !== 'connected')
      return `Hive 连接检查失败：读取=${state.connection.status}，连接=${state.connection.value?.state ?? 'unknown'}。`;
    if (state.accounts.status !== 'ready')
      return `AI 账号检查失败：读取=${state.accounts.status}。`;
    return undefined;
  };
  const updateProcess = () => {
    state.process = ready({
      ...state.process.value!,
      state: state.accounts.value?.some((a) => !a.paused) ? 'contributing' : 'paused',
    });
  };
  return {
    async snapshot() {
      return structuredClone(state);
    },
    async dispatch(command) {
      // A local delay exposes operation progress without contacting any business service.
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (command.type === 'refresh' || command.type === 'snapshot.refresh') {
        publish();
        return {
          kind: 'confirmed',
          demo: true,
          message: '仅演示：已重新读取当前场景；主动暂停选择保持不变。',
        };
      }
      if (preferenceFailure && !(command.type === 'loginHive' && state.preferences.value?.hiveAddress) && command.type !== 'runDiagnostics' && command.type !== 'exportDiagnostics') return fail('DEMO_PREFERENCES_READ', preferenceFailure);
      const financeResult = finance.handle(state, command);
      if (financeResult) {
        publish();
        return financeResult;
      }
      if (command.type === 'runDiagnostics') {
        diagnosisAttempts++;
        const passed = selected !== 'diagnostics-partial' || diagnosisAttempts > 1;
        state.diagnostics = ready(sanitizedDiagnostics([
          { id: 'process', passed: true }, { id: 'connection', passed: true }, { id: 'proxy', passed },
        ], [{ level: 'info', code: 'CHECK_STARTED' }, { level: passed ? 'info' : 'error', code: passed ? 'CHECK_PASSED' : 'PROXY_UNREACHABLE' }]));
        publish(); return { kind: 'confirmed', demo: true, message: passed ? '仅演示：所有检查通过。' : '代理连通检查失败：scene=diagnostics-partial，reachable=false；请检查代理后重试。' };
      }
      if (command.type === 'exportDiagnostics') {
        if (selected === 'diagnostics-export-error') return fail('DEMO_REPORT_CREATE', '报告文件创建失败：scene=diagnostics-export-error，fileCreated=false；请重试。');
        return { kind: 'confirmed', demo: true, message: '脱敏报告已准备。' };
      }
      if (['savePreferences', 'setPreference', 'saveProxy', 'changeHive'].includes(command.type)) {
        if (preferenceFailure) return fail('DEMO_PREFERENCES_READ', preferenceFailure);
        try {
          const previous = state.preferences.value ?? defaults();
          const draft = command.type === 'savePreferences' || command.type === 'setPreference'
            ? { ...previous, ...command.preferences }
            : command.type === 'saveProxy' ? { ...previous, proxyAddress: command.address }
            : { ...previous, hiveAddress: 'address' in command ? command.address : previous.hiveAddress };
          const hive = draft.hiveAddress ?? defaultHive;
          validateAddress(hive, 'Hive'); validateAddress(draft.proxyAddress ?? '', '代理');
          const changed = hive !== previous.hiveAddress;
          if (changed) {
            // Read target anonymous preferences before committing the selected endpoint.
            const target = preferenceStorage ? loadPreferences(preferenceStorage, { hive, user: null }) : defaults(hive);
            if (preferenceStorage) selectHive(preferenceStorage, hive);
            state.binding = ready({ state: 'unbound', loggedIn: false, source: 'new' });
            state.connection = ready({ state: 'disconnected', endpointLabel: hive });
            state.accounts = ready([]);
            state.process = ready({ state: 'paused', owner: state.process.value?.owner });
            state.tasks = ready({ kind: 'known', count: 0 });
            state.preferences = ready(target);
            state.finance = ready(initialFinance(hive, ''));
            state.earnings = ready({ balance: '128.560000000', today: '6.820000000', total: '382.140000000' });
            explicitlyRemoved.clear();
            finance.restore(state);
          } else {
            state.preferences = ready(preferenceStorage ? savePreferences(preferenceStorage, preferenceScope(hive, state.binding.value), draft) : draft);
          }
          publish();
          return { kind: 'confirmed', demo: true, message: '仅演示：已保存设置；切换 Hive 后需重新登录和绑定。未修改系统代理、开机启动或系统通知权限。' };
        } catch (cause) { return fail(cause instanceof AddressValidationError ? 'DEMO_INVALID_ADDRESS' : 'DEMO_PREFERENCES_WRITE', `普通偏好保存失败：${String(cause)}；设置未确认。`); }
      }
      if (command.type === 'loginHive') {
        if (selected === 'pending')
          return {
            kind: 'pending',
            message: '仅演示：登录处理中，请刷新状态；尚未确认登录。',
            operationId: 'demo-login',
          };
        if (selected === 'unknown-result')
          return {
            kind: 'unknown',
            message: '仅演示：登录结果未确认，请刷新状态；不会推断登录成功。',
            operationId: 'demo-login',
          };
        if (selected === 'operation-error')
          return fail(
            'DEMO_LOGIN_FAILED',
            '登录失败：场景 operation-error 模拟 Hive 登录不可用；请重试。',
          );
        // Resolve the target user's preferences before committing any login/finance identity.
        // On failure retain the verified anonymous Hive scope and permit login retry only.
        const currentHive = state.preferences.value?.hiveAddress;
        if (!currentHive) return fail('DEMO_PREFERENCES_READ', preferenceFailure ?? 'Hive 偏好检查失败：currentHiveKnown=false；请重新读取。');
        const nextBinding = { ...state.binding.value!, loggedIn: true, userId: 'demo-user', label: 'Bee 演示账号' };
        let userPreferences;
        try {
          userPreferences = preferenceStorage ? loadPreferences(preferenceStorage, preferenceScope(currentHive, nextBinding)) : defaults(currentHive);
        } catch (cause) {
          preferenceFailure = `用户偏好读取失败：${String(cause)}；登录未确认，请重试登录。`;
          return fail('DEMO_PREFERENCES_READ', preferenceFailure);
        }
        preferenceFailure = undefined;
        state.binding = ready(nextBinding);
        state.preferences = ready(userPreferences);
        if (state.finance.value?.identity.hive !== currentHive || state.finance.value?.identity.user !== nextBinding.userId) {
          state.finance = ready(initialFinance(currentHive, nextBinding.userId));
          finance.restore(state);
        }
      } else if (command.type === 'bindDevice') {
        if (state.binding.status !== 'ready' || !state.binding.value.loggedIn)
          return fail(
            'DEMO_LOGIN_REQUIRED',
            `绑定检查失败：读取=${state.binding.status}，已登录=${state.binding.value?.loggedIn ?? false}。`,
          );
        if (state.binding.value.replaceDevice && !command.replaceConfirmed)
          return fail(
            'DEMO_REPLACEMENT_CONFIRMATION_REQUIRED',
            `设备替换未确认：当前绑定=${state.binding.value.replaceDevice}。`,
          );
        state.binding = ready({
          ...state.binding.value,
          state: 'bound',
          replaceDevice: undefined,
        });
        state.connection = ready({
          state: 'connected',
          endpointLabel: state.preferences.value?.hiveAddress ?? 'Hive 演示连接',
        });
      } else if (
        [
          'detectAccount',
          'connectAccount',
          'authorizeAccount',
          'confirmAccountChange',
          'removeAccount',
        ].includes(command.type) &&
        'platform' in command
      ) {
        const invalid = prerequisites();
        if (invalid) return fail('DEMO_PREREQUISITE_MISSING', invalid);
        const platform = command.platform;
        const existing = state.accounts.value!.find((a) => a.platform === platform);
        if (command.type === 'authorizeAccount')
          return {
            kind: 'unsupported',
            message: '官方授权尚未接通：仅演示入口，未打开官方客户端或写入授权。',
          };
        if (command.type === 'removeAccount') {
          if (!existing)
            return fail(
              'DEMO_ACCOUNT_MISSING',
              `移除检查失败：platform=${platform}，account=missing。`,
            );
          explicitlyRemoved.add(platform);
          // TaskState is global: only a fresh, known zero proves every platform has drained.
          // Preserve an unresolved upstream result across retries; refresh cannot confirm it.
          const removal =
            existing.removal ??
            (selected === 'removal-unknown'
              ? 'unknown'
              : selected === 'removal-pending'
                ? 'pending'
                : state.tasks.status !== 'ready' || state.tasks.value.kind !== 'known'
                  ? 'unknown'
                  : state.tasks.value.count > 0
                    ? 'pending'
                    : state.tasks.value.count === 0
                      ? undefined
                      : 'unknown');
          if (removal) {
            state.accounts = ready(
              state.accounts.value!.map((a) =>
                a.platform === platform ? { ...a, paused: true, state: 'unavailable', removal } : a,
              ),
            );
            updateProcess();
            publish();
            return {
              kind: removal,
              message:
                removal === 'pending'
                  ? '仅演示：移除处理中，已停止新任务，等待收尾；卡片保留。'
                  : '仅演示：移除结果未确认，已停止新任务；请刷新状态，卡片保留。',
              operationId: `demo-remove-${platform}`,
            };
          }
          state.accounts = ready(state.accounts.value!.filter((a) => a.platform !== platform));
          updateProcess();
        } else if (command.type === 'confirmAccountChange') {
          if (!existing?.pendingChange)
            return fail(
              'DEMO_CHANGE_MISSING',
              `换号检查失败：platform=${platform}，pendingChange=missing。`,
            );
          if (existing.removal)
            return fail(
              'DEMO_REMOVAL_UNRESOLVED',
              `换号检查失败：platform=${platform}，removal=${existing.removal}。`,
            );
          state.accounts = ready(
            state.accounts.value!.map((a) =>
              a.platform === platform
                ? {
                    ...account(platform),
                    identifier: existing.pendingChange!.identifier,
                    pendingChange: undefined,
                    paused: true,
                  }
                : a,
            ),
          );
          updateProcess();
        } else {
          if (existing) {
            // Detection never repairs an expired authorization or resolves an uncertain removal.
          } else if (command.type === 'connectAccount' || !explicitlyRemoved.has(platform)) {
            explicitlyRemoved.delete(platform);
            state.accounts = ready([...state.accounts.value!, account(platform)]);
          } else {
            return {
              kind: 'confirmed',
              demo: true,
              message: '仅演示：检测到官方登录；已记住移除选择，请明确接入账号。',
            };
          }
        }
      } else {
        const invalid = prerequisites();
        if (invalid) return fail('DEMO_PREREQUISITE_MISSING', invalid);
        const start = command.type === 'startContribution' || command.type === 'contribution.start';
        const chosen = command.type === 'startContribution' ? command.platforms : platforms;
        if (
          start &&
          (!chosen.length ||
            chosen.some(
              (p) =>
                !state.accounts.value!.some((a) => a.platform === p && a.state === 'available'),
            ))
        )
          return fail(
            'DEMO_ACCOUNT_NOT_READY',
            `平台选择检查失败：选择=${chosen.join(',') || 'none'}，可用=${
              state.accounts
                .value!.filter((a) => a.state === 'available')
                .map((a) => a.platform)
                .join(',') || 'none'
            }。`,
          );
        const paused = start
          ? false
          : command.type === 'contribution.pause'
            ? true
            : 'paused' in command
              ? command.paused
              : true;
        if (!start && !paused && state.binding.value?.onboardingComplete !== true)
          return fail(
            'DEMO_FIRST_START_REQUIRED',
            `首次开始检查失败：onboardingComplete=${state.binding.value?.onboardingComplete ?? 'unknown'}；请先选择平台并使用“开始贡献”。`,
          );
        state.accounts = ready(
          state.accounts.value!.map((a) => {
            const target =
              command.type === 'setPlatformPaused'
                ? a.platform === command.platform
                : chosen.includes(a.platform);
            if (!target) return a;
            if (!paused && a.state !== 'available')
              return {
                ...a,
                feedback: `${names[a.platform]} 恢复失败：账号=${a.state}；请重新检测。`,
              };
            if (selected === 'partial' && paused && a.platform === 'claude')
              return {
                ...a,
                feedback: `Claude 暂停失败：场景 partial 模拟平台拒绝；${a.paused === true ? '当前已暂停' : a.paused === false ? '当前仍贡献中' : '当前暂停状态未知'}，请重试。`,
              };
            return {
              ...a,
              paused,
              feedback: `${names[a.platform]} ${paused ? '已暂停' : '贡献中'}（仅演示）`,
            };
          }),
        );
        if (start)
          state.binding = ready({
            ...state.binding.value!,
            onboardingComplete: true,
          });
        updateProcess();
      }
      publish();
      return {
        kind: 'confirmed',
        demo: true,
        message: '仅演示：操作已完成，请查看每个平台的结果；不会控制真实供给。',
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
