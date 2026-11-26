// What the window knows about Bee: the shell's snapshot (pushed as
// "bee://state") and the answers of Bee's local control interface.

export type ServiceState = "starting" | "running" | "external" | "stopped";

export type Problem = { code: string; message: string };

export type PairingStatus = "" | "pending" | "completed" | "expired" | "cancelled" | "failed";

export type Pairing = {
  status: PairingStatus;
  user_code?: string;
  verification_url?: string;
  expires_at?: string;
  waiting_for_old_device?: boolean;
  problem?: Problem;
};

export type PlatformId = "claude" | "openai";

export type Account = {
  id: string;
  platform: PlatformId;
  source: "local" | "import";
  email?: string;
  plan?: string;
  fingerprint?: string;
  added_at?: string;
};

export type Overview = {
  version: string;
  pid: number;
  mode: "cli" | "desktop";
  hive: string;
  binding: "unpaired" | "paired" | "replaced" | "invalid";
  device: { id: string; name: string; owner_email: string } | null;
  pairing?: Pairing;
  connection: "connecting" | "connected" | "disconnected";
  problem?: Problem;
  sources: { name: string; platform?: string }[];
  accounts?: Account[];
};

/** The one conclusion Bee draws for a platform. */
export type SharingState = "sharing" | "syncing" | "paused" | "waiting" | "action" | "restricted" | "offline";

export type QuotaWindow = {
  scope?: string;
  seconds: number;
  used_percent: number | null;
  reset_at?: string;
};

export type PlatformState = {
  sharing: { state: SharingState; reason?: string };
  supply: { platform: string; paused: boolean; ready: boolean; reasons: string[] };
  capabilities: {
    status: string;
    plan?: string;
    observed_at?: string;
    windows: QuotaWindow[] | null;
  };
};

export type Snapshot = {
  service: ServiceState;
  overview: Overview | null;
  platforms: Record<string, PlatformState>;
  tray: "good" | "attention" | "paused" | "off";
  summary: string;
  /** Set while no Bee answers but another process holds the device configuration. */
  occupied?: { pid: number | null } | null;
};

export type Detection = {
  platform: PlatformId;
  available: boolean;
  email?: string;
  plan?: string;
  fingerprint?: string;
  problem?: Problem;
};

export type Localized = { en: string; zh: string };

export type Explanation = {
  code: string;
  category: string;
  action?: string;
  title: Localized;
  cause: Localized;
  fix: Localized;
  fix_import?: Localized;
};

export type Language = "zh" | "en";

export type Settings = {
  autostart: boolean;
  keep_in_tray: boolean;
  notify: boolean;
  language: "system" | "zh" | "en";
  resolved_language: Language;
  tray_available: boolean;
};

export type SettingsChange = Partial<Pick<Settings, "autostart" | "keep_in_tray" | "notify" | "language">>;

export type AppInfo = { version: string; config: string; logs: string };

/** A failed request: Bee unreachable (status 0) or an error Bee answered with. */
export class BeeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function toBeeError(err: unknown): BeeError {
  if (err instanceof BeeError) return err;
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { status?: number; code: string; message?: string };
    return new BeeError(e.status ?? 0, e.code, e.message ?? "");
  }
  return new BeeError(0, "error", String(err));
}

/** Everything the window asks of the shell. Tests pass a fake. */
export interface Shell {
  getState(): Promise<Snapshot>;
  onState(listener: (snapshot: Snapshot) => void): () => void;
  /** Bee's control interface; only /v1/ paths. Throws BeeError. */
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  getSettings(): Promise<Settings>;
  setSettings(change: SettingsChange): Promise<Settings>;
  appInfo(): Promise<AppInfo>;
  /** Shows the folder that holds Bee's log in the system's file manager. */
  openLogs(): Promise<void>;
  /** Asks the shell to start the background service again now. */
  retryService(): Promise<void>;
  /** Saves Bee's diagnostic report where the person chooses; null if cancelled. */
  exportDiagnostics(): Promise<string | null>;
  /** Quits the app, stopping the app's own Bee. */
  quit(): Promise<void>;
  /** The shell asks the window to confirm quitting (the tray's Quit). */
  onQuitRequest(listener: () => void): () => void;
  openUrl(url: string): Promise<void>;
  pickFile(title: string): Promise<string | null>;
  onFileDrop(listener: (path: string) => void): () => void;
  copy(text: string): Promise<void>;
}
