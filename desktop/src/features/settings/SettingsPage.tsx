import { t } from '../../i18n/index';
import { useEffect, useState } from 'react';
import type { DesktopCommand, DesktopSnapshot } from '../../client/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
export function SettingsPage({ snapshot, busy, dispatch, checkNotifications, notifications }: {
  snapshot: DesktopSnapshot; busy: boolean; dispatch: (command: DesktopCommand) => Promise<void>;
  checkNotifications: () => void; notifications: string[];
}) {
  const saved = snapshot.preferences.value;
  const [p, setDraft] = useState(saved);
  useEffect(() => { if (!busy) setDraft(saved); }, [saved, busy]);
  const [hive, setHive] = useState(p?.hiveAddress ?? '');
  const [proxy, setProxy] = useState(p?.proxyAddress ?? '');
  const set = (preferences: Partial<NonNullable<typeof p>>) => { setDraft({ language: 'system', theme: 'system', ...p, ...preferences }); void dispatch({ type: 'setPreference', preferences }); };
  return <div className="settings-page">
    {snapshot.preferences.status === 'error' && <section><p role="alert">{t(snapshot.preferences.error.message)}</p><button onClick={() => location.reload()}>{t('重新读取')}</button></section>}
    <section className="settings-form" aria-label={t("普通偏好")}>
      <label>{t("语言")}<select aria-label={t("语言")} disabled={busy} value={p?.language ?? 'system'} onChange={e => set({ language: e.target.value as 'system' | 'zh' | 'en' })}>
        <option value="system">{t("跟随系统")}</option><option value="zh">{t("中文")}</option><option value="en">English</option>
      </select></label>
      <label>{t("外观")}<select aria-label={t("外观")} disabled={busy} value={p?.theme ?? 'system'} onChange={e => set({ theme: e.target.value as 'system' | 'light' | 'dark' })}>
        <option value="system">{t("跟随系统")}</option><option value="light">{t("浅色")}</option><option value="dark">{t("深色")}</option>
      </select></label>
      <label className="check-label"><input aria-label={t("开机启动")} disabled={busy} type="checkbox" checked={p?.autoStart ?? false} onChange={e => set({ autoStart: e.target.checked })} />{t("开机启动")}</label>
      <label className="check-label"><input aria-label={t("演示通知")} disabled={busy} type="checkbox" checked={p?.notifications ?? true} onChange={e => set({ notifications: e.target.checked })} />{t("演示通知")}</label>
      <p className="feature-note">{t("只保存本地演示偏好，不会修改开机启动或系统通知权限。")}</p>
      <button disabled={busy} onClick={checkNotifications}>{t("检查演示通知")}</button>
      <ul data-testid="demo-notifications">{notifications.map(message => <li key={message}>{t(message)}{t("（仅演示）")}</li>)}</ul>
    </section>
    <form className="settings-form" onSubmit={e => { e.preventDefault(); void dispatch({ type: 'saveProxy', address: proxy }); }}>
      <label>{t("代理地址")}<input aria-label={t("代理地址")} placeholder={t("关闭（留空）")} value={proxy} onChange={e => setProxy(e.target.value)} /></label>
      <p className="feature-note">{t("支持 HTTP / HTTPS / SOCKS5。此演示仅校验并保存地址；不发送网络请求，不改变系统代理。真实 Bee 代理覆盖范围将在业务接入时核验。")}</p>
      <button disabled={busy} type="submit">{t("保存代理")}</button>
    </form>
    <section className="settings-form">
      <label>{t("Hive 地址")}<input aria-label={t("Hive 地址")} value={hive} onChange={e => setHive(e.target.value)} /></label>
      <ConfirmDialog trigger={<button disabled={busy || hive === p?.hiveAddress}>{t("切换 Hive")}</button>} title={t("切换 Hive？")} description={t("将退出当前演示登录并解除本地绑定，回到所选 Hive 的登录引导；不会迁移账号、资金或未确认操作。")} confirmLabel={t("确认切换 Hive")} busy={busy} onConfirm={() => dispatch({ type: 'changeHive', address: hive })} />
      <p className="feature-note">{t("普通偏好按 Hive 与当前用户隔离；登录前使用未登录空间。账号状态与凭证不会保存到浏览器偏好。")}</p>
    </section>
    <section className="settings-list"><div><strong>{t("版本")}</strong><span>{t("Bee 0.1.0 · 开发版本")}</span></div><div><strong>{t("平台账号状态")}</strong><span>{t(snapshot.accounts.value?.length ?? 0)}{t(" 个演示账号")}</span></div></section>
  </div>;
}
