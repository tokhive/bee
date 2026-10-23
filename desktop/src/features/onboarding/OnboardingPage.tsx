import type { DesktopCommand, DesktopSnapshot, Platform } from '../../client/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
export function OnboardingPage({
  snapshot,
  busy,
  dispatch,
}: {
  snapshot: DesktopSnapshot;
  busy: boolean;
  dispatch: (command: DesktopCommand) => Promise<void>;
}) {
  const binding = snapshot.binding.status === 'ready' ? snapshot.binding.value : undefined;
  const bound = binding?.state === 'bound';
  return (
    <section className="onboarding" aria-label="首次接入引导">
      <div className="section-heading">
        <h2>首次接入</h2>
        <span className="muted">仅本地演示，可随时离开并继续</span>
      </div>
      {binding?.source === 'existing' && <p>已有 Bee 配置</p>}
      <ol className="guide-steps">
        <li>
          <strong>登录 Hive</strong>
          <span>{binding?.loggedIn ? binding.label : '尚未登录'}</span>
          <button
            disabled={busy || binding?.loggedIn}
            onClick={() => void dispatch({ type: 'loginHive' })}
          >
            模拟登录 Hive
          </button>
        </li>
        <li>
          <strong>绑定设备</strong>
          <span>
            {bound
              ? '本机已绑定'
              : binding?.replaceDevice
                ? `已绑定：${binding.replaceDevice}`
                : '尚未绑定本机'}
          </span>
          {binding?.replaceDevice ? (
            <ConfirmDialog
              trigger={<button disabled={busy || !binding?.loggedIn || bound}>绑定本机设备</button>}
              title="替换已绑定设备？"
              description={`将演示绑定从 ${binding.replaceDevice} 替换为本机；不会更改真实绑定。`}
              confirmLabel="确认替换"
              busy={busy}
              onConfirm={() => dispatch({ type: 'bindDevice', replaceConfirmed: true })}
            />
          ) : (
            <button
              disabled={busy || !binding?.loggedIn || bound}
              onClick={() => void dispatch({ type: 'bindDevice' })}
            >
              绑定本机设备
            </button>
          )}
        </li>
        <li>
          <strong>检测 / 连接 AI 账号</strong>
          <span>接入后保持暂停；选择平台后手动开始。</span>
          <div className="inline-actions">
            {(['openai', 'claude'] as Platform[]).map((platform) => (
              <button
                key={platform}
                disabled={busy || !bound}
                onClick={() => void dispatch({ type: 'detectAccount', platform })}
              >
                检测 {platform === 'openai' ? 'OpenAI' : 'Claude'}
              </button>
            ))}
          </div>
        </li>
      </ol>
    </section>
  );
}
