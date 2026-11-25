import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The shell's view of Bee, pushed as "bee://state". The real interface comes
// in the next milestone; this page only shows that the shell is wired up.
type Snapshot = {
  service: "starting" | "running" | "external" | "stopped";
  overview: Record<string, unknown> | null;
  platforms: Record<string, { sharing: { state: string; reason?: string } }>;
  tray: "good" | "attention" | "paused" | "off";
  summary: string;
};

const serviceLabels: Record<Snapshot["service"], string> = {
  starting: "正在启动后台服务",
  running: "后台服务运行中",
  external: "后台服务由命令行或系统服务运行",
  stopped: "后台服务没有运行",
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    invoke<Snapshot>("get_state").then(setSnapshot);
    const stop = listen<Snapshot>("bee://state", (event) => setSnapshot(event.payload));
    return () => {
      stop.then((unlisten) => unlisten());
    };
  }, []);
  if (!snapshot) return <main style={styles.page}>正在连接…</main>;
  const overview = snapshot.overview ?? {};
  return (
    <main style={styles.page}>
      <h1 style={{ margin: 0 }}>Bee</h1>
      <p>{serviceLabels[snapshot.service]}</p>
      <p>
        <strong>{snapshot.summary}</strong>
      </p>
      <ul>
        {Object.entries(snapshot.platforms).map(([name, platform]) => (
          <li key={name}>
            {name}: {platform.sharing.state}
            {platform.sharing.reason ? `（${platform.sharing.reason}）` : ""}
          </li>
        ))}
      </ul>
      <details>
        <summary>技术信息</summary>
        <pre style={styles.pre}>{JSON.stringify(overview, null, 2)}</pre>
      </details>
    </main>
  );
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.5 },
  pre: { fontSize: 12, background: "#f4f3ef", padding: 12, overflow: "auto" },
} as const;
