import type {DesktopPresentation} from '../presentation/desktopStatus';
import { t } from '../i18n/index';
import {useEffect,useRef,type ReactNode} from 'react';
import { Monitor } from 'lucide-react';
import { navigation,navigationSelector,validNavigationTarget,type NavigationRequest } from '../app/navigation';
import type { Page } from '../client/types';
import logo from '../assets/app-icon-dark.svg';
export function AppShell({
  page,
  onNavigate,
  demo, autoService=false,
  deviceMode = false,
  deviceName, hive, connected = false,
  children,
  debug,
  navigationRequest,desktopStatus,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  demo: boolean;
  autoService?:boolean;
  deviceMode?: boolean;
  deviceName?: string; hive?: string; connected?: boolean;
  children: ReactNode;
  debug?: ReactNode;
  navigationRequest?:NavigationRequest;desktopStatus?:DesktopPresentation;
}) {
  const main=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!deviceMode)return;
    const container=main.current;if(!container)return;
    const target=navigationRequest?.target??{page};
    if(target.page!==page||!validNavigationTarget(target))return;
    const selector=navigationSelector(target);if(!selector)return;
    const focus=()=>{
      const element=document.querySelector<HTMLElement>(selector);if(!element)return false;
      for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
      element.tabIndex=element.tabIndex<0?-1:element.tabIndex;
      element.focus({preventScroll:true});element.scrollIntoView({block:'start',behavior:'instant'});
      if(!target.section)container.scrollTop=0;
      return true;
    };
    if(focus())return;
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});observer.observe(document.body,{subtree:true,childList:true});return()=>observer.disconnect();
  },[page,navigationRequest?.sequence,deviceMode]);
  const current = navigation.find((item) => item.id === page) ?? navigation[0];
  return (
    <div data-desktop-status={desktopStatus?.kind} className={`app-shell${deviceMode ? ' native-shell' : ''}`}>
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
            <span className={`dot ${(desktopStatus?desktopStatus.severity==='success':connected) ? '' : 'muted-dot'}`} />{hive ? new URL(hive).host : t(deviceMode ? '尚未连接 Hive' : '尚未接通真实供给')}<p className={desktopStatus?'desktop-side-status':undefined} data-severity={desktopStatus?.severity}>{desktopStatus?t(`desktop.status.${desktopStatus.kind}`):t(connected ? 'Hive 已连接' : 'Hive 未连接')}</p>
          </div>
          <div className="identity">
            <span className="avatar"><Monitor aria-hidden="true" /></span>
            <div>{deviceName || t("Bee 桌面端")}<small>{t(demo ? '本地演示空间' : deviceMode ? '设备与平台控制' : '等待业务接入')}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="toolbar">
          <div className="toolbar-right">
            <span className="device">
              <Monitor aria-hidden="true" />{t("本机设备")}</span>
            {demo && <span className="demo-badge">{t("演示数据")}</span>}
          </div>
        </header>
        <main ref={main}>
          <div className="page-heading">
            <div>
              <h1 tabIndex={-1}>{t(current.label)}</h1>
              {!(deviceMode && page === 'overview') && <p>{t(autoService&&page==='accounts'?'接入本机账号，管理平台接单。':current.description)}</p>}
            </div>
            {debug}
          </div>
          {children}
        </main>
        <footer>{demo ? t('Bee · 开发版本') : 'Bee'}<span>{t(demo ? '演示操作不会影响真实账号或资金' : autoService ? '自动维护账号 · 按平台管理接单' : deviceMode ? '设备绑定不自动开始贡献' : '真实业务未接通')}</span>
        </footer>
      </div>
    </div>
  );
}
