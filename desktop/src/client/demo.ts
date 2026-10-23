import { parseScene } from './scenes';
import type { Account, BeeClient, DesktopSnapshot, Platform, ReadState } from './types';

const platforms: Platform[] = ['openai', 'claude'];
const names = { openai: 'OpenAI', claude: 'Claude' };
export function createDemoClient(scene: string): BeeClient {
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
    }),
    accounts: ready(
      fresh || selected === 'empty' || selected === 'configured' ? [] : platforms.map(account),
    ),
    earnings: ready({
      balance: '128.560000000',
      today: '6.820000000',
      total: '382.140000000',
    }),
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
      if (command.type === 'savePreferences') {
        const { hiveAddress = '', proxyAddress = '' } = command.preferences;
        for (const [label, value] of [
          ['Hive', hiveAddress],
          ['代理', proxyAddress],
        ]) {
          if (!value || value === 'Hive 演示连接') continue;
          let url: URL;
          try {
            url = new URL(value);
          } catch {
            return fail(
              'DEMO_INVALID_ADDRESS',
              `${label} 地址解析失败：parse=failed，inputLength=${value.length}；请输入有效 HTTP(S) 地址。`,
            );
          }
          if (!['http:', 'https:'].includes(url.protocol))
            return fail(
              'DEMO_INVALID_ADDRESS',
              `${label} 地址协议检查失败：protocol=${url.protocol}；允许 http:、https:。`,
            );
          if (url.username || url.password)
            return fail(
              'DEMO_INVALID_ADDRESS',
              `${label} 地址凭证检查失败：hasCredentials=true；请移除账号与密码。`,
            );
          if (url.search)
            return fail(
              'DEMO_INVALID_ADDRESS',
              `${label} 地址查询检查失败：hasQuery=true；请移除查询参数。`,
            );
          if (url.hash)
            return fail(
              'DEMO_INVALID_ADDRESS',
              `${label} 地址片段检查失败：hasFragment=true；请移除片段。`,
            );
        }
        if (state.preferences.value?.hiveAddress !== hiveAddress) {
          state.binding = ready({
            state: 'unbound',
            loggedIn: false,
            source: 'new',
          });
          state.connection = ready({
            state: 'disconnected',
            endpointLabel: hiveAddress,
          });
          state.accounts = ready([]);
          state.process = ready({
            state: 'paused',
            owner: state.process.value?.owner,
          });
        }
        state.preferences = ready(command.preferences);
        publish();
        return {
          kind: 'confirmed',
          demo: true,
          message: '仅演示：已保存设置；切换 Hive 后需重新登录和绑定。未修改系统代理。',
        };
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
        state.binding = ready({
          ...state.binding.value!,
          loggedIn: true,
          label: 'Bee 演示账号',
        });
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
