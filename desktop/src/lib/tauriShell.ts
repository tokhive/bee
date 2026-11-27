// The shell as the Tauri app provides it: commands and events of the Rust
// shell, plus the dialog and opener plugins.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toBeeError, type Shell, type Snapshot, type UpdateState } from "./bee";

function subscribe(start: () => Promise<UnlistenFn>): () => void {
  let stopped = false;
  let stop: UnlistenFn | undefined;
  start().then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export const tauriShell: Shell = {
  getState: () => invoke<Snapshot>("get_state"),
  onState: (listener) => subscribe(() => listen<Snapshot>("bee://state", (event) => listener(event.payload))),
  async request<T>(method: string, path: string, body?: unknown) {
    try {
      return await invoke<T>("bee_request", { method, path, body: body ?? null });
    } catch (err) {
      throw toBeeError(err);
    }
  },
  getSettings: () => invoke("get_settings"),
  setSettings: (change) => invoke("set_settings", { change }),
  appInfo: () => invoke("app_info"),
  async openLogs() {
    try {
      await invoke("open_logs");
    } catch (err) {
      throw toBeeError(err);
    }
  },
  retryService: () => invoke("retry_service"),
  restartService: () => invoke<boolean>("restart_service"),
  async exportDiagnostics() {
    try {
      return await invoke<string | null>("export_diagnostics");
    } catch (err) {
      throw toBeeError(err);
    }
  },
  updateStatus: () => invoke<UpdateState>("update_status"),
  onUpdate: (listener) => subscribe(() => listen<UpdateState>("bee://update", (event) => listener(event.payload))),
  checkUpdate: () => invoke<UpdateState>("check_update"),
  installUpdate: () => invoke("install_update"),
  quit: () => invoke("quit_app"),
  onQuitRequest: (listener) => subscribe(() => listen("bee://quit-requested", () => listener())),
  openUrl: (url) => openUrl(url),
  async pickFile(title) {
    const picked = await open({ title, multiple: false, directory: false });
    return typeof picked === "string" ? picked : null;
  },
  onFileDrop: (listener) =>
    subscribe(() =>
      getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) listener(event.payload.paths[0]);
      }),
    ),
  copy: copyText,
};
