import { t } from '../../i18n/index';
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
    <section className="onboarding" aria-label={t("首次接入引导")}>
      <div className="section-heading">
        <h2>{t("首次接入")}</h2>
        <span className="muted">{t("仅本地演示，可随时离开并继续")}</span>
      </div>
      {binding?.source === 'existing' && <p>{t("已有 Bee 配置")}</p>}
      <ol className="guide-steps">
        <li>
          <strong>{t("登录 Hive")}</strong>
          <span>{binding?.loggedIn ? (binding.label === 'Bee 演示账号' ? t('Bee 演示账号') : binding.label) : t('尚未登录')}</span>
          <button
            disabled={busy || binding?.loggedIn}
            onClick={() => void dispatch({ type: 'loginHive' })}
          >{t("模拟登录 Hive")}</button>
        </li>
        <li>
          <strong>{t("绑定设备")}</strong>
          <span>
            {bound ? t('本机已绑定') : binding?.replaceDevice ? t('已绑定：{device}', { device: binding.replaceDevice === '旧演示设备' ? t('旧演示设备') : binding.replaceDevice }) : t('尚未绑定本机')}
          </span>
          {binding?.replaceDevice ? (
            <ConfirmDialog
              trigger={<button disabled={busy || !binding?.loggedIn || bound}>{t("绑定本机设备")}</button>}
              title={t("替换已绑定设备？")}
              description={t("将演示绑定从 {device} 替换为本机；不会更改真实绑定。", { device: binding.replaceDevice === "旧演示设备" ? t("旧演示设备") : binding.replaceDevice })}
              confirmLabel={t("确认替换")}
              busy={busy}
              onConfirm={() => dispatch({ type: 'bindDevice', replaceConfirmed: true })}
            />
          ) : (
            <button
              disabled={busy || !binding?.loggedIn || bound}
              onClick={() => void dispatch({ type: 'bindDevice' })}
            >{t("绑定本机设备")}</button>
          )}
        </li>
        <li>
          <strong>{t("检测 / 连接 AI 账号")}</strong>
          <span>{t("接入后保持暂停；选择平台后手动开始。")}</span>
          <div className="inline-actions">
            {(['openai', 'claude'] as Platform[]).map((platform) => (
              <button
                key={platform}
                disabled={busy || !bound}
                onClick={() => void dispatch({ type: 'detectAccount', platform })}
              >{t("检测 ")}{t(platform === 'openai' ? 'OpenAI' : 'Claude')}
              </button>
            ))}
          </div>
        </li>
      </ol>
    </section>
  );
}
