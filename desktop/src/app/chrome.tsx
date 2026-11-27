// The parts around every main page: the sidebar, each page's title row, the
// global banners and the short confirmations at the bottom.
import * as React from "react";
import { useApp } from "./context";
import { PAGES, useNav, type Page } from "./nav";
import { Button } from "../components/ui/button";
import { BeeGlyph, StateIcon } from "../components/ui/bits";
import { Term } from "../components/ui/term";
import { maskEmail } from "../lib/format";
import { accountsOf, cardStatus, globalIssue, managesAccounts, runFromCommandLine } from "../lib/model";
import { cn } from "../lib/utils";
import { useDiagnostics } from "./useDiagnostics";
import { useUpdate } from "./useUpdate";

export type Connection = { tone: "good" | "warn" | "bad"; label: string; hint: string };

/** Whether Bee is connected to TokHive, in the words the sidebar and dashboard use. */
export function useConnection(): Connection {
  const { snapshot, t } = useApp();
  const overview = snapshot?.overview ?? null;
  const issue = snapshot ? globalIssue(snapshot) : "down";
  if (issue === "down" || issue === "occupied" || issue === "replaced" || issue === "invalid" || overview?.connection === "disconnected")
    return { tone: "bad", label: t.header.offline, hint: t.dashboard.offlineHint };
  if (issue === "reconnect" || issue === "starting") return { tone: "warn", label: t.header.connecting, hint: t.dashboard.connectingHint };
  return { tone: "good", label: t.header.connected, hint: t.dashboard.connectedHint };
}

/** How many accounts share, how many there are and how many need the person. */
export function useAccountCounts(): { on: number; all: number; need: number } {
  const { snapshot, syncingSince } = useApp();
  if (!snapshot) return { on: 0, all: 0, need: 0 };
  const accounts = accountsOf(snapshot.overview);
  const states = accounts.map((a) => cardStatus(a, snapshot, syncingSince[a.platform])?.state);
  return {
    all: accounts.length,
    on: states.filter((s) => s === "sharing").length,
    need: states.filter((s) => s === "action" || s === "restricted").length,
  };
}

export const dotTone = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" } as const;

const navIcons: Record<Page, React.ReactNode> = {
  dashboard: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  accounts: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.6 3.5 5.2" />
    </svg>
  ),
  logs: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
    </svg>
  ),
  settings: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
};

/** The left column: the pages, then who is linked and whether Bee is connected. */
export function Sidebar() {
  const { snapshot, t, shell, settings, updateSettings } = useApp();
  const { screen, go } = useNav();
  const collapsed = Boolean(settings?.sidebar_collapsed);
  const updateReady = useUpdate(shell).state === "available";
  const connection = useConnection();
  const counts = useAccountCounts();
  const owner = maskEmail(snapshot?.overview?.device?.owner_email);
  const current = screen.name === "add" ? "accounts" : screen.name;

  const extra = (page: Page): React.ReactNode => {
    if (page === "accounts" && counts.need) return <i className="ml-auto size-[7px] flex-none rounded-full bg-bad" aria-hidden="true" />;
    if (page === "accounts" && counts.all && !collapsed)
      return (
        <span className="ml-auto text-[11.5px] font-medium text-muted tabular-nums" aria-hidden="true">
          {counts.on}/{counts.all}
        </span>
      );
    if (page === "settings" && updateReady) return <i className="ml-auto size-[7px] flex-none rounded-full bg-info" aria-hidden="true" />;
    return null;
  };
  // What the marks beside a page say, for a screen reader.
  const described = (page: Page): string | undefined => {
    if (page === "accounts" && counts.need) return t.nav.needsAttention;
    if (page === "accounts" && counts.all) return t.nav.sharingCount(counts.on, counts.all);
    if (page === "settings" && updateReady) return t.update.badge;
    return undefined;
  };

  return (
    <nav aria-label={t.nav.label} className={cn("flex min-h-0 flex-none flex-col border-r border-line bg-side transition-[width] duration-150", collapsed ? "w-16" : "w-[220px]")}>
      {/* Room for the window's traffic lights; dragging here moves the window. */}
      <div data-tauri-drag-region className="h-11 flex-none" />
      <div data-tauri-drag-region className={cn("flex flex-none items-center gap-2.5 pb-3.5", collapsed ? "justify-center" : "px-4")}>
        <BeeGlyph size={28} />
        {!collapsed && <span className="text-[17px] font-semibold tracking-[.01em]">{t.appName}</span>}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 px-2.5 py-1">
        {PAGES.map((page) => {
          const active = current === page;
          return (
            <li key={page}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                aria-description={described(page)}
                title={page === "settings" && updateReady ? `${t.nav[page]} · ${t.update.badge}` : collapsed ? t.nav[page] : undefined}
                onClick={() => go({ name: page })}
                className={cn(
                  "relative flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-fg2 hover:bg-hover",
                  collapsed && "justify-center px-0",
                  active && "bg-card font-semibold text-fg shadow-[0_0_0_1px_var(--line)] before:absolute before:top-[9px] before:bottom-[9px] before:-left-2.5 before:w-[3px] before:rounded-r before:bg-volt before:content-['']",
                )}
              >
                {navIcons[page]}
                {collapsed ? <span className="sr-only">{t.nav[page]}</span> : <span>{t.nav[page]}</span>}
                {collapsed ? <span className="absolute top-1.5 right-1.5 flex">{extra(page)}</span> : extra(page)}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={cn("mt-auto flex flex-col gap-0.5 border-t border-line py-3 text-xs", collapsed ? "items-center px-2" : "px-4")}>
        <div className="flex items-center gap-1.5 font-medium text-fg2" title={collapsed ? connection.label : undefined}>
          <i className={cn("inline-block size-[7px] flex-none rounded-full", dotTone[connection.tone])} aria-hidden="true" />
          {collapsed ? <span className="sr-only">{connection.label}</span> : connection.label}
        </div>
        {owner && !collapsed && <div className="truncate text-muted">{owner}</div>}
        <button
          type="button"
          onClick={() => updateSettings({ sidebar_collapsed: !collapsed }).catch(() => {})}
          className="mt-1.5 flex cursor-pointer items-center gap-1.5 self-start rounded-md border-0 bg-transparent p-1 text-muted hover:bg-hover"
          aria-label={collapsed ? t.nav.expand : t.nav.collapse}
          title={collapsed ? t.nav.expand : t.nav.collapse}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M9 4v16" />
          </svg>
          {!collapsed && <span>{t.nav.collapse}</span>}
        </button>
      </div>
    </nav>
  );
}

/** A page's title row, with the page's own actions on the right. */
export function PageHeader({ title, meta, children }: { title: string; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div data-tauri-drag-region className="flex flex-none items-center gap-3 px-6 pt-5 pb-3.5">
      <h1 tabIndex={-1} className="m-0 text-xl font-semibold tracking-[-.01em] outline-none">
        {title}
      </h1>
      {meta && <span className="text-xs text-muted">{meta}</span>}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

function BannerRow({ tone, children, actions }: { tone: "warn" | "bad" | "info"; children: React.ReactNode; actions?: React.ReactNode }) {
  const tones = { warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex flex-none items-center gap-2.5 border-b border-line px-6 py-[9px] text-[13px]", tones[tone])}>
      <StateIcon tone={tone} />
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}

function useMinutesSince(since: number | null): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.floor((now - since) / 60000);
}

export function Banner() {
  const { snapshot, t, shell, toast, disconnectedSince } = useApp();
  const { go } = useNav();
  const exportReport = useDiagnostics();
  const minutes = useMinutesSince(disconnectedSince);
  if (!snapshot) return null;
  const issue = globalIssue(snapshot);
  const rows: React.ReactNode[] = [];
  if (issue === "down") {
    rows.push(
      <BannerRow
        key="down"
        tone="bad"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                toast(t.banner.starting);
                shell.retryService();
              }}
            >
              {t.banner.retry}
            </Button>
            <Button variant="secondary" onClick={exportReport}>
              {t.banner.diagnostics}
            </Button>
          </>
        }
      >
        {t.banner.downBefore}
        <Term help={t.terms.serviceHelp}>{t.terms.service}</Term>
        {t.banner.downAfter}
      </BannerRow>,
    );
  }
  if (issue === "occupied") {
    const pid = snapshot.occupied?.pid ?? null;
    rows.push(
      <BannerRow
        key="occupied"
        tone="bad"
        actions={
          pid && (
            <Button
              variant="secondary"
              onClick={async () => {
                await shell.copy(`kill ${pid}`);
                toast(t.banner.stopCopied);
              }}
            >
              {t.banner.copyStop}
            </Button>
          )
        }
      >
        {t.banner.occupied(pid)}
      </BannerRow>,
    );
  }
  if (issue === "replaced" || issue === "invalid") {
    rows.push(
      <BannerRow
        key="binding"
        tone="bad"
        actions={managesAccounts(snapshot.overview) && <Button onClick={() => go({ name: "bind", mode: "rebind" })}>{t.banner.rebind}</Button>}
      >
        {issue === "replaced" ? t.banner.replaced : t.banner.invalid}
      </BannerRow>,
    );
  }
  if (issue === "reconnect") {
    rows.push(
      <BannerRow key="reconnect" tone="warn">
        {t.banner.reconnecting}
        {minutes >= 1 && ` ${t.banner.disconnectedFor(minutes)}`}
        {minutes >= 2 && ` ${t.banner.checkNetwork}`}
      </BannerRow>,
    );
  }
  if (runFromCommandLine(snapshot)) {
    rows.push(
      <BannerRow key="cli" tone="info">
        {t.banner.cli}
      </BannerRow>,
    );
  }
  return <>{rows}</>;
}

export function Toast({ text }: { text: string | null }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-[18px] left-1/2 z-[60] -translate-x-1/2">
      {text && <div className="rounded-lg bg-fg px-3.5 py-2 text-[13px] whitespace-nowrap text-page shadow-pop">{text}</div>}
    </div>
  );
}
