import * as React from "react";
import { useApp } from "../app/context";
import { useNav } from "../app/nav";
import { useDiagnostics } from "../app/useDiagnostics";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Term } from "../components/ui/term";
import type { Settings, SettingsChange } from "../lib/bee";
import { maskEmail } from "../lib/format";
import { managesAccounts } from "../lib/model";
import { isMac } from "../lib/utils";
import { BackButton } from "./Onboarding";
import { NetworkSettings } from "./NetworkSettings";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="m-0 mb-2 text-xs font-semibold tracking-[.04em] text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 border-b border-line py-[9px] text-[13.5px] last:border-b-0">{children}</div>;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SettingsPage() {
  const { t, snapshot, settings, info, shell, updateSettings, toast } = useApp();
  const { go } = useNav();
  const exportReport = useDiagnostics();
  const overview = snapshot?.overview ?? null;

  const change = async (next: SettingsChange) => {
    try {
      await updateSettings(next);
    } catch {
      toast(t.settings.saveFailed);
    }
  };

  const toggle = (key: keyof Pick<Settings, "autostart" | "keep_in_tray" | "notify">, label: string, disabled = false) => (
    <Row>
      <label htmlFor={`setting-${key}`} className="cursor-pointer">
        {label}
      </label>
      <span className="ml-auto flex items-center gap-2">
        <Switch id={`setting-${key}`} checked={Boolean(settings?.[key])} disabled={!settings || disabled} onCheckedChange={(checked) => change({ [key]: checked })} />
      </span>
    </Row>
  );

  const openLogs = async () => {
    try {
      await shell.openLogs();
    } catch {
      toast(t.settings.openLogsFailed);
    }
  };

  const serviceHow =
    snapshot?.service === "running" ? t.settings.runByApp : snapshot?.service === "external" ? t.settings.runExternally : t.settings.notRunning;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 pt-[18px] pb-6">
      <div className="flex max-w-[640px] flex-col gap-5">
        <BackButton onClick={() => go({ name: "home" })}>{t.settings.back}</BackButton>
        <h1 tabIndex={-1} className="outline-none sr-only">{t.settings.title}</h1>
        <Section title={t.settings.account}>
          <Row>
            <span>
              {maskEmail(overview?.device?.owner_email) || "—"}
              {overview?.hive && (
                <>
                  <br />
                  <span className="text-[12.5px] text-muted">{host(overview.hive)}</span>
                </>
              )}
            </span>
            {managesAccounts(overview) && overview?.binding === "paired" && (
              <span className="ml-auto">
                <Button variant="secondary" onClick={() => go({ name: "bind", mode: "switch" })}>
                  {t.settings.switch}
                </Button>
              </span>
            )}
          </Row>
        </Section>
        <Section title={t.settings.general}>
          {toggle("autostart", t.settings.autostart)}
          {toggle("keep_in_tray", t.settings.keepInTray(isMac), settings?.tray_available === false)}
          {settings?.tray_available === false && <p className="m-0 py-1 text-[12.5px] text-muted">{t.settings.noTray}</p>}
          {toggle("notify", t.settings.notify)}
          <Row>
            <label htmlFor="setting-language">{t.settings.language}</label>
            <span className="ml-auto">
              <select
                id="setting-language"
                value={settings?.language ?? "system"}
                disabled={!settings}
                onChange={(e) => change({ language: e.target.value as Settings["language"] })}
                className="rounded-md border border-line bg-page px-2 py-1 text-[13px] text-fg"
              >
                {(["system", "zh", "en"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t.settings.languages[value]}
                  </option>
                ))}
              </select>
            </span>
          </Row>
        </Section>
        <Section title={t.network.title}>
          <NetworkSettings />
        </Section>
        <Section title={t.settings.help}>
          <Row>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={exportReport}>
                {t.settings.diagnostics}
              </Button>
              <Button variant="secondary" onClick={openLogs}>
                {t.settings.openLogs}
              </Button>
            </div>
          </Row>
        </Section>
        <Section title={t.settings.about}>
          <Row>
            <span>{t.settings.version(info?.version ?? "")}</span>
          </Row>
          <details className="text-[12.5px] text-muted">
            <summary className="cursor-pointer">{t.settings.tech}</summary>
            <dl className="mt-2 mb-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>
                <Term help={t.terms.serviceHelp}>{t.terms.service}</Term>
              </dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{t.settings.serviceVersion(overview?.version ?? "—", serviceHow)}</dd>
              <dt>{t.settings.config}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{info?.config ?? "—"}</dd>
              <dt>{t.settings.logs}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{info?.logs ?? "—"}</dd>
              <dt>{t.settings.device}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{overview?.device?.id ?? "—"}</dd>
              <dt>{t.settings.hive}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{overview?.hive ?? "—"}</dd>
            </dl>
          </details>
        </Section>
      </div>
    </div>
  );
}
