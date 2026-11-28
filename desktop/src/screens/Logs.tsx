// Bee's log as the app keeps it (bee.log), newest at the bottom: filtered by
// level, searched, and followed while the view stays at the end.
import * as React from "react";
import { useApp } from "../app/context";
import { PageHeader } from "../app/chrome";
import { useDiagnostics } from "../app/useDiagnostics";
import { Button } from "../components/ui/button";
import type { LogTail } from "../lib/bee";
import { cn } from "../lib/utils";

/** How many lines the page reads and shows. */
export const LOG_LINES = 2000;
const POLL_MS = 1500;

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR" | "";
type Filter = "ALL" | "INFO" | "WARN" | "ERROR";
const rank: Record<Level, number> = { "": 1, DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export type LogLine = { time: string; full: string; level: Level; message: string; rest: string; raw: string };

/** Reads one line of Bee's slog text output; anything else is kept whole. */
export function parseLine(raw: string): LogLine {
  const time = /(?:^|\s)time=(\S+)/.exec(raw)?.[1] ?? "";
  const level = (/(?:^|\s)level=(\S+)/.exec(raw)?.[1] ?? "").toUpperCase();
  const msg = /(?:^|\s)msg=("(?:[^"\\]|\\.)*"|\S+)/.exec(raw);
  if (!msg) return { time: "", full: "", level: "", message: raw, rest: "", raw };
  let message = msg[1];
  if (message.startsWith('"')) {
    try {
      message = JSON.parse(message);
    } catch {
      message = message.slice(1, -1);
    }
  }
  const rest = raw
    .slice(msg.index + msg[0].length)
    .trim()
    .replace(/(^|\s)service=\S+/, "")
    .trim();
  const at = new Date(time);
  const clock = Number.isNaN(at.getTime()) ? time : at.toLocaleTimeString([], { hour12: false });
  return { time: clock, full: time, level: (["DEBUG", "INFO", "WARN", "ERROR"].includes(level) ? level : "") as Level, message, rest, raw };
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(query, from); at >= 0; at = lower.indexOf(query, from)) {
    parts.push(text.slice(from, at), <mark key={at} className="rounded-sm bg-accent-soft text-inherit shadow-[0_0_0_1px_var(--line-strong)]">{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

const levelTone: Record<Level, string> = { "": "text-faint", DEBUG: "text-faint", INFO: "text-muted", WARN: "text-warn", ERROR: "text-bad" };

export function Logs() {
  const { t, shell } = useApp();
  const exportReport = useDiagnostics();
  const [tail, setTail] = React.useState<LogTail | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [query, setQuery] = React.useState("");
  const [follow, setFollow] = React.useState(true);
  const box = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const l = t.logs;

  React.useEffect(() => {
    let live = true;
    const read = () =>
      shell
        .readLog(LOG_LINES)
        .then((next) => {
          if (!live) return;
          setTail(next);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [shell]);

  // ⌘F / Ctrl+F searches the log.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const lines = React.useMemo(() => (tail?.lines ?? []).map(parseLine), [tail]);
  const shown = lines.filter((line) => (filter === "ALL" || rank[line.level] >= rank[filter]) && (!q || line.raw.toLowerCase().includes(q)));

  // Stay at the end while following.
  React.useLayoutEffect(() => {
    const el = box.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow, tail]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  };

  const toLatest = () => {
    setFollow(true);
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const openFolder = () => shell.openLogs().catch(() => {});
  const filters: Filter[] = ["ALL", "INFO", "WARN", "ERROR"];

  return (
    <>
      <PageHeader title={l.title} meta="bee.log">
        <Button variant="secondary" onClick={openFolder}>
          {t.settings.openLogs}
        </Button>
        <Button variant="secondary" onClick={exportReport}>
          {t.settings.diagnostics}
        </Button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-5">
        {tail && !tail.own ? (
          <p className="m-0 rounded-xl border border-line bg-card p-4 text-[13px] text-muted">{l.external}</p>
        ) : (
          <>
            <div className="mb-2.5 flex flex-none items-center gap-2">
              <div role="radiogroup" aria-label={l.level} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
                {filters.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "h-[26px] cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-[12.5px] text-muted",
                      filter === key && "bg-card font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_1px_var(--line)]",
                    )}
                  >
                    {l.levels[key]}
                  </button>
                ))}
              </div>
              <label className="flex h-[30px] max-w-[320px] flex-1 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-muted">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  ref={search}
                  type="search"
                  aria-label={l.search}
                  placeholder={l.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-fg outline-none"
                />
                <kbd className="rounded border border-line px-1 font-sans text-[11px] text-faint">⌘F</kbd>
              </label>
              <span className="ml-auto text-xs text-muted">{l.count(shown.length)}</span>
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                ref={box}
                onScroll={onScroll}
                role="log"
                aria-label={l.title}
                tabIndex={0}
                className="h-full overflow-auto rounded-xl border border-line bg-card py-2 font-mono text-xs leading-[1.7]"
              >
                {failed && !tail ? (
                  <p className="m-0 px-3.5 text-muted">{l.failed}</p>
                ) : !lines.length ? (
                  <p className="m-0 px-3.5 text-muted">{tail ? l.empty : ""}</p>
                ) : !shown.length ? (
                  <p className="m-0 px-3.5 text-muted">{l.noMatch}</p>
                ) : (
                  shown.map((line, i) => (
                    <div key={i} className={cn("grid grid-cols-[68px_48px_minmax(0,1fr)] gap-2.5 px-3.5 hover:bg-sunken", line.level === "ERROR" && "bg-bad-bg/60")}>
                      <span className="text-faint" title={line.full}>
                        {line.time}
                      </span>
                      <span className={cn("font-semibold", levelTone[line.level])}>{line.level}</span>
                      <span className="break-words whitespace-pre-wrap text-fg">
                        <Highlight text={line.message} query={q} /> {line.rest && <span className="text-faint"><Highlight text={line.rest} query={q} /></span>}
                      </span>
                    </div>
                  ))
                )}
              </div>
              {!follow && (
                <Button className="absolute right-4 bottom-3 shadow-pop" onClick={toLatest}>
                  ↓ {l.latest}
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-none justify-between gap-3 text-xs text-muted">
              <span className="truncate">{tail ? l.shown(tail.path, LOG_LINES) : ""}</span>
              <span className="flex-none">{follow ? `● ${l.following}` : l.paused}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
