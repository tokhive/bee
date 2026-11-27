// A shell for tests: a snapshot the test controls and Bee's control interface
// answered by the test. explanations.json is Bee's real catalog, saved from
// GET /v1/explanations (regenerate it from the mock Bee when the catalog
// changes: curl --unix-socket <dir>/control/bee.sock http://bee/v1/explanations).
import { vi } from "vitest";
import { BeeError, type Account, type Network, type Overview, type PlatformState, type Settings, type Shell, type SharingState, type Snapshot, type UpdateState } from "../lib/bee";
import catalog from "./explanations.json";

export const claude: Account = {
  id: "acc_claude",
  platform: "claude",
  source: "local",
  email: "b.lee@gmail.com",
  plan: "max",
  fingerprint: "3f9a12c0" + "0".repeat(56),
  added_at: "2026-11-20T08:00:00Z",
};

export const codex: Account = {
  id: "acc_codex",
  platform: "openai",
  source: "import",
  email: "c.wu@outlook.com",
  plan: "plus",
  fingerprint: "81d0e7aa" + "0".repeat(56),
  added_at: "2026-11-22T08:00:00Z",
};

export function overview(change: Partial<Overview> = {}): Overview {
  return {
    version: "1.2.3",
    pid: 1,
    mode: "desktop",
    hive: "https://console.tokhive.ai",
    binding: "paired",
    device: { id: "dev_1", name: "Mac", owner_email: "a.chen@gmail.com" },
    connection: "connected",
    sources: [],
    accounts: [claude, codex],
    ...change,
  };
}

const hour = 3600 * 1000;

export function platform(state: SharingState, reason?: string, change: Partial<PlatformState["capabilities"]> = {}, paused = state === "paused"): PlatformState {
  const reset = (h: number) => new Date(Date.now() + h * hour).toISOString();
  return {
    sharing: { state, reason },
    supply: { platform: "claude", paused, ready: state === "sharing", reasons: reason ? [reason] : [] },
    capabilities: {
      status: state === "syncing" ? "unknown" : "ready",
      observed_at: new Date().toISOString(),
      windows:
        state === "syncing"
          ? []
          : [
              { seconds: 18000, used_percent: 42, reset_at: reset(2) },
              { seconds: 604800, used_percent: 18, reset_at: reset(50) },
            ],
      ...change,
    },
  };
}

export function snapshot(change: Partial<Snapshot> = {}): Snapshot {
  return {
    service: "running",
    overview: overview(),
    platforms: { claude: platform("sharing"), openai: platform("sharing") },
    tray: "good",
    summary: "",
    ...change,
  };
}

export const noProxy: Network = { connect_proxy: "", active_proxy: "", source: "", editable: true, env_override: false, restart_required: false };

type Handler = (method: string, path: string, body: unknown) => unknown;

export type FakeShell = Shell & {
  push: (next: Snapshot) => void;
  requestQuit: () => void;
  /** The shell reports a change of the app's update. */
  pushUpdate: (state: UpdateState) => void;
  drop: (path: string) => void;
  calls: { method: string; path: string; body: unknown }[];
  answer: (handler: Handler) => void;
};

/** A request the fake answers with Bee's error. */
export function refuse(status: number, code: string): never {
  throw new BeeError(status, code, code);
}

export function fakeShell(first: Snapshot, settings: Partial<Settings> = {}): FakeShell {
  const states = new Set<(s: Snapshot) => void>();
  const quits = new Set<() => void>();
  const updates = new Set<(state: UpdateState) => void>();
  let update: UpdateState = { state: "idle" };
  const drops = new Set<(p: string) => void>();
  let handler: Handler = () => ({});
  let current: Settings = { autostart: true, keep_in_tray: true, notify: true, language: "zh", resolved_language: "zh", tray_available: true, ...settings };
  const calls: FakeShell["calls"] = [];
  const shell: FakeShell = {
    calls,
    getState: vi.fn(async () => first),
    onState: (listener) => {
      states.add(listener);
      return () => states.delete(listener);
    },
    request: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/v1/explanations") return catalog;
      // A test that answers nothing about it sees a Bee with no proxy.
      const answered = handler(method, path, body);
      if (method === "GET" && path === "/v1/network" && typeof (answered as Partial<Network> | undefined)?.connect_proxy !== "string") return noProxy;
      return answered;
    }) as Shell["request"],
    getSettings: vi.fn(async () => current),
    setSettings: vi.fn(async (change) => {
      current = { ...current, ...change };
      if (change.language && change.language !== "system") current.resolved_language = change.language;
      return current;
    }),
    appInfo: vi.fn(async () => ({ version: "1.0.0", config: "/home/a/.config/tokhive/bee.json", logs: "/home/a/Library/Logs/ai.tokhive.bee" })),
    openLogs: vi.fn(async () => {}),
    retryService: vi.fn(async () => {}),
    restartService: vi.fn(async () => true),
    exportDiagnostics: vi.fn(async () => "/tmp/bee-diagnostics.json"),
    updateStatus: vi.fn(async () => update),
    onUpdate: (listener) => {
      updates.add(listener);
      return () => updates.delete(listener);
    },
    checkUpdate: vi.fn(async () => update),
    installUpdate: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    onQuitRequest: (listener) => {
      quits.add(listener);
      return () => quits.delete(listener);
    },
    openUrl: vi.fn(async () => {}),
    pickFile: vi.fn(async () => null),
    onFileDrop: (listener) => {
      drops.add(listener);
      return () => drops.delete(listener);
    },
    copy: vi.fn(async () => {}),
    push: (next) => states.forEach((listener) => listener(next)),
    requestQuit: () => quits.forEach((listener) => listener()),
    pushUpdate: (next) => {
      update = next;
      updates.forEach((listener) => listener(next));
    },
    drop: (path) => drops.forEach((listener) => listener(path)),
    answer: (next) => {
      handler = next;
    },
  };
  return shell;
}
