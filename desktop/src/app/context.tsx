// Everything the screens share: the shell, Bee's snapshot, the app's settings,
// the words to use and Bee's explanations of reason codes.
import * as React from "react";
import type { AppInfo, Explanation, Language, Settings, SettingsChange, Shell, Snapshot } from "../lib/bee";
import { localize } from "../lib/format";
import { messages, type Messages } from "../lib/i18n";
import { accountsOf } from "../lib/model";

/** Bee's explanation in the window's language; `both` is the cause and the fix as one passage. */
export type Explained = { known: boolean; title: string; cause: string; fix: string; both: string; category: string; action?: string };

type AppValue = {
  shell: Shell;
  snapshot: Snapshot | null;
  settings: Settings | null;
  info: AppInfo | null;
  language: Language;
  t: Messages;
  explain: (code: string | undefined, imported?: boolean) => Explained;
  updateSettings: (change: SettingsChange) => Promise<void>;
  toast: (text: string) => void;
  toastText: string | null;
  /** When each platform was first seen syncing, for the "taking long" hint. */
  syncingSince: Record<string, number>;
  /** When the connection to TokHive was last seen dropping. */
  disconnectedSince: number | null;
  /**
   * Whether Bee's explanations have been read (or could not be), so a card
   * never shows a general sentence for a moment before its real words.
   */
  explanationsReady: boolean;
};

const AppContext = React.createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = React.useContext(AppContext);
  if (!value) throw new Error("useApp outside AppProvider");
  return value;
}

export function AppProvider({ shell, children }: { shell: Shell; children: React.ReactNode }) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const [catalog, setCatalog] = React.useState<Record<string, Explanation>>({});
  const [explanationsReady, setExplanationsReady] = React.useState(false);
  const [toastText, setToastText] = React.useState<string | null>(null);
  const [syncingSince, setSyncingSince] = React.useState<Record<string, number>>({});
  const [disconnectedSince, setDisconnectedSince] = React.useState<number | null>(null);
  const toastTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    let live = true;
    const stop = shell.onState((next) => live && setSnapshot(next));
    shell.getState().then((first) => live && setSnapshot((current) => current ?? first));
    shell.getSettings().then((s) => live && setSettings(s));
    shell.appInfo().then((i) => live && setInfo(i)).catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [shell]);

  const reachable = Boolean(snapshot?.overview);
  const catalogEmpty = Object.keys(catalog).length === 0;
  React.useEffect(() => {
    if (!reachable || !catalogEmpty) return;
    shell
      .request<{ explanations: Explanation[] }>("GET", "/v1/explanations")
      .then((answer) => {
        const byCode: Record<string, Explanation> = {};
        for (const entry of answer.explanations ?? []) byCode[entry.code] = entry;
        setCatalog(byCode);
      })
      .catch(() => {})
      .finally(() => setExplanationsReady(true));
    // Do not hold the window back for long if Bee is slow to answer.
    const giveUp = window.setTimeout(() => setExplanationsReady(true), 3000);
    return () => window.clearTimeout(giveUp);
  }, [shell, reachable, catalogEmpty]);

  // Track how long accounts sync and how long TokHive has been unreachable.
  React.useEffect(() => {
    if (!snapshot) return;
    const now = Date.now();
    setSyncingSince((previous) => {
      const next: Record<string, number> = {};
      for (const account of accountsOf(snapshot.overview)) {
        const state = snapshot.platforms[account.platform]?.sharing.state ?? "syncing";
        if (state === "syncing") next[account.platform] = previous[account.platform] ?? now;
      }
      return next;
    });
    const overview = snapshot.overview;
    const dropped = overview?.binding === "paired" && overview.connection !== "connected";
    setDisconnectedSince((since) => (dropped ? (since ?? now) : null));
  }, [snapshot]);

  const language: Language = settings?.resolved_language ?? (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
  const t = messages[language];

  React.useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const explain = React.useCallback(
    (code: string | undefined, imported = false): Explained => {
      const entry = code ? catalog[code] : undefined;
      if (!entry) return { known: false, title: t.errors.generic, cause: t.errors.generic, fix: t.errors.tryAgain, both: t.errors.tryAgain, category: "error" };
      const cause = localize(entry.cause, language);
      const fix = localize(imported && entry.fix_import ? entry.fix_import : entry.fix, language);
      return {
        known: true,
        title: localize(entry.title, language),
        cause,
        fix,
        // Chinese sentences run on; English ones need a space between.
        both: language === "zh" ? `${cause}${fix}` : `${cause} ${fix}`,
        category: entry.category,
        action: entry.action,
      };
    },
    [catalog, language, t],
  );

  const toast = React.useCallback((text: string) => {
    setToastText(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 2400);
  }, []);

  const updateSettings = React.useCallback(
    async (change: SettingsChange) => {
      setSettings(await shell.setSettings(change));
    },
    [shell],
  );

  const value: AppValue = { shell, snapshot, settings, info, language, t, explain, updateSettings, toast, toastText, syncingSince, disconnectedSince, explanationsReady };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
