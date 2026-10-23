import { t } from '../i18n/index';
import type { ReactNode } from 'react';
import { ChevronRight, Monitor } from 'lucide-react';
import { navigation } from '../app/navigation';
import type { Page } from '../client/types';
import logo from '../assets/app-icon-dark.svg';
export function AppShell({
  page,
  onNavigate,
  demo,
  children,
  debug,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  demo: boolean;
  children: ReactNode;
  debug?: ReactNode;
}) {
  const current = navigation.find((item) => item.id === page)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" />
          <span>Bee</span>
        </div>
        <nav aria-label={t("主导航")}>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-current={id === page ? 'page' : undefined} onClick={() => onNavigate(id)}>
              <Icon aria-hidden="true" />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note">
            <span className="dot muted-dot" />{t("尚未接通真实供给")}<p>{t("关窗后可从托盘找回")}</p>
          </div>
          <div className="identity">
            <span className="avatar">B</span>
            <div>{t("Bee 桌面端")}<small>{t(demo ? '本地演示空间' : '等待业务接入')}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="toolbar">
          <div className="breadcrumb">
            <span>{t("工作空间")}</span>
            <ChevronRight aria-hidden="true" />
            <span>{t(current.label)}</span>
          </div>
          <div className="toolbar-right">
            <span className="device">
              <Monitor aria-hidden="true" />{t("本机设备")}</span>
            {demo && <span className="demo-badge">{t("演示数据")}</span>}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>{t(current.label)}</h1>
              <p>{t(current.description)}</p>
            </div>
            {debug}
          </div>
          {children}
        </main>
        <footer>{t("Bee · 开发版本")}<span>{t(demo ? '演示操作不会影响真实账号或资金' : '真实业务未接通')}</span>
        </footer>
      </div>
    </div>
  );
}
