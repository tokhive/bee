import * as React from "react";
import type { PlatformId } from "../../lib/bee";
import { cn } from "../../lib/utils";

type Tone = "info" | "warn" | "bad";

// Icons stand for state only: ⓘ neutral, ⚠ warning, ⛔ error.
const icons: Record<Tone, string> = { info: "ⓘ", warn: "⚠", bad: "⛔" };

const tones: Record<Tone, string> = {
  info: "bg-info-bg text-info",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
};

export function Callout({ tone, children, className, role }: { tone: Tone; children: React.ReactNode; className?: string; role?: string }) {
  return (
    <div role={role} className={cn("flex max-w-[640px] gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px]", tones[tone], className)}>
      <span className="flex-none font-bold" aria-hidden="true">
        {icons[tone]}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StateIcon({ tone }: { tone: Tone }) {
  return <span aria-hidden="true">{icons[tone]}</span>;
}

const marks: Record<PlatformId, string> = { claude: "✳", openai: "◎" };

export function PlatformMark({ platform }: { platform: PlatformId }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[30px] flex-none items-center justify-center rounded-[7px] text-[13px] font-bold",
        platform === "claude" ? "bg-claude-bg text-claude-fg" : "bg-codex-bg text-codex-fg",
      )}
    >
      {marks[platform] ?? "•"}
    </span>
  );
}

export function BeeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" fill="var(--honey)" />
      <path d="M8.2 10.2h7.6M7.6 13.4h8.8" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <code className="rounded border border-line bg-sunken px-[5px] font-mono text-xs">{children}</code>;
}
