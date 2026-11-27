// Development only: a stand-in for the Rust shell when the window runs in an
// ordinary browser (`BEE_DEV_CONFIG=... npm run dev`). It reads Bee through
// the dev server's /__bee bridge and keeps settings in localStorage, so the
// window can be worked on against the mock Bee without building the app.
import { BeeError, type Overview, type PlatformState, type Settings, type Shell, type Snapshot, type UpdateState } from "./bee";
import { copyText } from "./tauriShell";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/__bee${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json().catch(() => null);
  if (!res.ok) {
    const status = value?.error?.code === "unreachable" ? 0 : res.status;
    throw new BeeError(status, value?.error?.code ?? "error", value?.error?.message ?? "");
  }
  return value as T;
}

async function read(): Promise<Snapshot> {
  try {
    const overview = await call<Overview>("GET", "/v1/overview");
    const platforms: Record<string, PlatformState> = {};
    if (overview.binding === "paired" && overview.connection === "connected") {
      for (const source of overview.sources) {
        if (!source.platform) continue;
        try {
          platforms[source.platform] = await call("GET", `/v1/platforms/${source.platform}`);
        } catch {
          // Missing until Hive answers, as in the shell.
        }
      }
    }
    // A Bee run from the command line is one the app did not start.
    return { service: overview.mode === "cli" ? "external" : "running", overview, platforms, tray: "good", summary: "" };
  } catch {
    return { service: "stopped", overview: null, platforms: {}, tray: "off", summary: "" };
  }
}

const listeners = new Set<(snapshot: Snapshot) => void>();
let timer: number | undefined;
async function refresh() {
  const snapshot = await read();
  listeners.forEach((listener) => listener(snapshot));
}

function loadSettings(): Settings {
  const saved = JSON.parse(localStorage.getItem("bee-dev-settings") ?? "{}");
  const settings = { autostart: true, keep_in_tray: true, notify: true, language: "system", ...saved };
  const system = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  return { ...settings, resolved_language: settings.language === "system" ? system : settings.language, tray_available: true };
}

// A pretend update, so the About section can be worked on: a check finds
// 9.9.9 and installing it counts up to a restart that never comes.
let update: UpdateState = { state: "idle" };
const updateListeners = new Set<(state: UpdateState) => void>();
function setUpdate(next: UpdateState) {
  update = next;
  updateListeners.forEach((listener) => listener(next));
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const devShell: Shell = {
  getState: read,
  onState(listener) {
    listeners.add(listener);
    if (timer === undefined) timer = window.setInterval(refresh, 2000);
    return () => listeners.delete(listener);
  },
  async request<T>(method: string, path: string, body?: unknown) {
    try {
      return await call<T>(method, path, body);
    } finally {
      setTimeout(refresh, 150);
    }
  },
  async getSettings() {
    return loadSettings();
  },
  async setSettings(change) {
    const { resolved_language: _r, tray_available: _t, ...current } = loadSettings();
    localStorage.setItem("bee-dev-settings", JSON.stringify({ ...current, ...change }));
    return loadSettings();
  },
  async appInfo() {
    return { version: "0.0.0-dev", config: "(browser preview)", logs: "(browser preview)" };
  },
  async openLogs() {
    window.alert("open_logs");
  },
  async retryService() {
    await refresh();
  },
  async restartService() {
    await refresh();
    return true;
  },
  async exportDiagnostics() {
    const report = await call<unknown>("GET", "/v1/diagnostics");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    link.download = "bee-diagnostics.json";
    link.click();
    return "bee-diagnostics.json";
  },
  async updateStatus() {
    return update;
  },
  onUpdate(listener) {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
  },
  async checkUpdate() {
    setUpdate({ state: "checking" });
    await pause(600);
    setUpdate({ state: "available", version: "9.9.9", notes: "Fixes and improvements." });
    return update;
  },
  async installUpdate() {
    const total = 12_000_000;
    for (let downloaded = 0; downloaded <= total; downloaded += 1_500_000) {
      setUpdate({ state: "downloading", version: "9.9.9", downloaded, total });
      await pause(200);
    }
    setUpdate({ state: "restarting", version: "9.9.9" });
  },
  async quit() {
    window.alert("quit_app");
  },
  onQuitRequest() {
    return () => {};
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener");
  },
  async pickFile(title) {
    return window.prompt(title, "/tmp/auth.json");
  },
  onFileDrop() {
    return () => {};
  },
  copy: copyText,
};
