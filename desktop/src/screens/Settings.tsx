import * as React from "react";
import { useApp } from "../app/context";
import { useNav } from "../app/nav";
import { PageHeader } from "../app/chrome";
import { useDiagnostics } from "../app/useDiagnostics";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Term } from "../components/ui/term";
import type { Settings, SettingsChange, Theme } from "../lib/bee";
import { maskEmail } from "../lib/format";
import { managesAccounts } from "../lib/model";
import { cn, isMac } from "../lib/utils";
import { NetworkSettings } from "./NetworkSettings";
import { UpdateRow } from "./UpdateRow";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="max-w-[720px]">
      <h2 className="m-0 mb-2 text-xs font-semibold tracking-[.02em] text-muted">{title}</h2>
      <div className="rounded-xl border border-line bg-card">{children}</div>
    </section>
  );
}

/** One setting: its name and a line on what it does, the control on the right. */
export function Row({ title, hint, htmlFor, children, className }: { title: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0", className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer font-medium">
            {title}
          </label>
        ) : (
          <div className="font-medium">{title}</div>
        )}
        {hint && <div className="mt-px text-xs text-muted">{hint}</div>}
      </div>
      {children && <div className="ml-auto flex flex-none items-center gap-2">{children}</div>}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
      {options.map(([key, name]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          onClick={() => onChange(key)}
          className={cn(
            "h-[26px] cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-[12.5px] text-muted disabled:cursor-default",
            value === key && "bg-card font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_1px_var(--line)]",
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { t, snapshot, settings, info, shell, updateSettings, toast } = useApp();
  const { go } = useNav();
  const exportReport = useDiagnostics();
  const overview = snapshot?.overview ?? null;
  const s = t.settings;

  const change = async (next: SettingsChange) => {
    try {
      await updateSettings(next);
    } catch {
      toast(s.saveFailed);
    }
  };

  const toggle = (key: keyof Pick<Settings, "autostart" | "keep_in_tray" | "notify" | "prevent_sleep">, title: string, hint: string, disabled = false) => (
    <Row title={title} hint={hint} htmlFor={`setting-${key}`}>
      <Switch id={`setting-${key}`} checked={Boolean(settings?.[key])} disabled={!settings || disabled} onCheckedChange={(checked) => change({ [key]: checked })} />
    </Row>
  );

  const openLogs = async () => {
    try {
      await shell.openLogs();
    } catch {
      toast(s.openLogsFailed);
    }
  };

  const copyHive = async () => {
    if (!overview?.hive) return;
    await shell.copy(overview.hive);
    toast(s.copied);
  };

  const serviceHow = snapshot?.service === "running" ? s.runByApp : snapshot?.service === "external" ? s.runExternally : s.notRunning;

  return (
    <>
      <PageHeader title={s.title} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-6 pb-6">
        <Group title={s.account}>
          <Row title={maskEmail(overview?.device?.owner_email) || "—"} hint={s.accountHint}>
            {managesAccounts(overview) && overview?.binding === "paired" && (
              <Button variant="secondary" onClick={() => go({ name: "bind", mode: "switch" })}>
                {s.switch}
              </Button>
            )}
          </Row>
          <Row title={s.server} hint={s.serverHint}>
            <span className="rounded-md bg-sunken px-2 py-1 font-mono text-xs text-fg2">{overview?.hive ?? "—"}</span>
            {overview?.hive && (
              <Button variant="secondary" onClick={copyHive}>
                {s.copy}
              </Button>
            )}
          </Row>
        </Group>
        <Group title={s.general}>
          {toggle("autostart", s.autostart, s.autostartHint)}
          {toggle("prevent_sleep", s.preventSleep, s.preventSleepHint)}
          {toggle("keep_in_tray", s.keepInTray(isMac), settings?.tray_available === false ? s.noTray : s.keepInTrayHint, settings?.tray_available === false)}
          {toggle("notify", s.notify, s.notifyHint)}
          <Row title={s.language} htmlFor="setting-language">
            <select
              id="setting-language"
              value={settings?.language ?? "system"}
              disabled={!settings}
              onChange={(e) => change({ language: e.target.value as Settings["language"] })}
              className="h-[30px] rounded-lg border border-line-strong bg-card px-2 text-[13px] text-fg"
            >
              {(["system", "zh", "en"] as const).map((value) => (
                <option key={value} value={value}>
                  {s.languages[value]}
                </option>
              ))}
            </select>
          </Row>
          <Row title={s.theme}>
            <Segmented<Theme>
              label={s.theme}
              value={settings?.theme ?? "system"}
              disabled={!settings}
              options={(["system", "light", "dark"] as const).map((key) => [key, s.themes[key]])}
              onChange={(theme) => change({ theme })}
            />
          </Row>
        </Group>
        <Group title={s.network}>
          <div className="px-4 py-3">
            <NetworkSettings />
          </div>
        </Group>
        <Group title={s.about}>
          <div className="px-4">
            <UpdateRow />
          </div>
          <Row title={s.help}>
            <Button variant="secondary" onClick={exportReport}>
              {s.diagnostics}
            </Button>
            <Button variant="secondary" onClick={openLogs}>
              {s.openLogs}
            </Button>
          </Row>
          <details className="px-4 py-3 text-[12.5px] text-muted">
            <summary className="cursor-pointer">{s.tech}</summary>
            <dl className="mt-2 mb-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>
                <Term help={t.terms.serviceHelp}>{t.terms.service}</Term>
              </dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{s.serviceVersion(overview?.version ?? "—", serviceHow)}</dd>
              <dt>{s.config}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{info?.config ?? "—"}</dd>
              <dt>{s.logs}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{info?.logs ?? "—"}</dd>
              <dt>{s.device}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{overview?.device?.id ?? "—"}</dd>
              <dt>{s.hive}</dt>
              <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere] text-fg">{overview?.hive ?? "—"}</dd>
            </dl>
          </details>
        </Group>
      </div>
    </>
  );
}
