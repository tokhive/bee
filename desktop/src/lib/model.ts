// What the window shows, derived from the shell's snapshot.
import type { Account, Overview, PlatformId, SharingState, Snapshot } from "./bee";
import type { Messages } from "./i18n";

/** Platforms in the order the home page groups them. */
export const PLATFORMS: PlatformId[] = ["claude", "openai"];

/** How long "syncing" may last before the person is asked to look. */
export const STUCK_SYNCING_MS = 10 * 60 * 1000;

/** A problem that hides every account's conclusion behind one banner. */
export type GlobalIssue = "starting" | "down" | "occupied" | "replaced" | "invalid" | "reconnect";

export function globalIssue(snapshot: Snapshot): GlobalIssue | null {
  const overview = snapshot.overview;
  // An older Bee that serves no control interface holds the configuration, so
  // the app's own cannot start: say that, not just that nothing runs.
  if (snapshot.service === "stopped" && snapshot.occupied) return "occupied";
  if (snapshot.service === "stopped" || (!overview && snapshot.service !== "starting")) return "down";
  if (!overview) return "starting";
  if (overview.binding === "replaced") return "replaced";
  if (overview.binding === "invalid") return "invalid";
  if (overview.binding === "paired" && overview.connection !== "connected") return "reconnect";
  return null;
}

/** A Bee started from the command line or a system service, not by this app. */
export function runFromCommandLine(snapshot: Snapshot): boolean {
  return snapshot.service === "external" && snapshot.overview?.mode === "cli";
}

/** Whether accounts can be added and removed here: only a desktop-mode Bee manages them. */
export function managesAccounts(overview: Overview | null): boolean {
  return overview?.mode === "desktop";
}

/**
 * The accounts to show. A desktop-mode Bee lists them; one run from the
 * command line only names its sources, which then stand in for accounts.
 */
export function accountsOf(overview: Overview | null): Account[] {
  if (!overview) return [];
  if (overview.accounts) return overview.accounts;
  return overview.sources
    .filter((s): s is { name: string; platform: PlatformId } => s.platform === "claude" || s.platform === "openai")
    .map((s) => ({ id: "", platform: s.platform, source: "local" as const }));
}

/** An account's conclusion, or null while a global issue hides it. */
export type CardStatus = { state: SharingState; reason?: string; stuck?: boolean };

export function cardStatus(account: Account, snapshot: Snapshot, syncingSince?: number, now = Date.now()): CardStatus | null {
  if (globalIssue(snapshot)) return null;
  const platform = snapshot.platforms[account.platform];
  // Not read from Hive yet: a new account is syncing.
  const status: CardStatus = platform ? { state: platform.sharing.state, reason: platform.sharing.reason } : { state: "syncing" };
  if (status.state === "syncing" && syncingSince !== undefined && now - syncingSince > STUCK_SYNCING_MS) {
    return { state: "action", reason: status.reason, stuck: true };
  }
  return status;
}

export function summaryText(states: SharingState[], t: Messages): string {
  const n = states.length;
  if (!n) return t.summary.none;
  const count = (...want: SharingState[]) => states.filter((s) => want.includes(s)).length;
  const need = count("action", "restricted");
  if (need) return t.summary.need(need);
  if (count("paused") === n) return t.summary.allPaused;
  if (count("sharing") === n) return n === 1 ? t.summary.oneSharing : t.summary.allSharing(n);
  const parts: string[] = [];
  if (count("sharing")) parts.push(t.summary.parts.sharing(count("sharing")));
  if (count("syncing")) parts.push(t.summary.parts.syncing(count("syncing")));
  if (count("waiting", "offline")) parts.push(t.summary.parts.waiting(count("waiting", "offline")));
  if (count("paused")) parts.push(t.summary.parts.paused(count("paused")));
  return parts.join(t.summary.join);
}

export type Tone = "good" | "warn" | "bad" | "idle";

export const stateTone: Record<SharingState, Tone> = {
  sharing: "good",
  syncing: "idle",
  paused: "idle",
  waiting: "warn",
  offline: "warn",
  action: "bad",
  restricted: "bad",
};
