// The parts around every main page: the status bar, the global banners and
// the short confirmations at the bottom.
import * as React from "react";
import { useApp } from "./context";
import { useNav } from "./nav";
import { Button } from "../components/ui/button";
import { BeeGlyph, StateIcon } from "../components/ui/bits";
import { Term } from "../components/ui/term";
import { maskEmail } from "../lib/format";
import { globalIssue, managesAccounts, runFromCommandLine } from "../lib/model";
import { cn } from "../lib/utils";
import { useDiagnostics } from "./useDiagnostics";

export function Header() {
  const { snapshot, t, shell } = useApp();
  const { go } = useNav();
  const overview = snapshot?.overview ?? null;
  const issue = snapshot ? globalIssue(snapshot) : "down";
  let connection: [string, string];
  if (issue === "down" || issue === "occupied" || issue === "replaced" || issue === "invalid" || overview?.connection === "disconnected") connection = ["bg-bad", t.header.offline];
  else if (issue === "reconnect" || issue === "starting") connection = ["bg-warn", t.header.connecting];
  else connection = ["bg-good", t.header.connected];
  const owner = maskEmail(overview?.device?.owner_email);
  return (
    <header className="flex flex-none items-center gap-3.5 border-b border-line px-5 py-3">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-display text-[17px] font-bold"
        onClick={() => go({ name: "home" })}
        aria-label={t.header.home}
      >
        <BeeGlyph /> {t.appName}
      </button>
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
        {owner && <span>{owner} ·</span>}
        <span className="inline-flex items-center gap-[5px]">
          <i className={cn("inline-block size-[7px] rounded-full", connection[0])} aria-hidden="true" />
          {connection[1]}
        </span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        {overview?.hive && (
          <button
            type="button"
            className="cursor-pointer border-0 border-b border-line-strong bg-transparent p-0 text-[12.5px] text-fg"
            onClick={() => shell.openUrl(`${overview.hive.replace(/\/$/, "")}/earnings`)}
          >
            {t.header.earnings}
          </button>
        )}
        <button
          type="button"
          className="inline-flex size-[30px] cursor-pointer items-center justify-center rounded-md border border-line bg-page hover:bg-sunken"
          aria-label={t.header.settings}
          title={t.header.settings}
          onClick={() => go({ name: "settings" })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function BannerRow({ tone, children, actions }: { tone: "warn" | "bad" | "info"; children: React.ReactNode; actions?: React.ReactNode }) {
  const tones = { warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex flex-none items-center gap-2.5 border-b border-line px-5 py-[9px] text-[13px]", tones[tone])}>
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
