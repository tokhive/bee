import * as React from "react";
import type { PlatformId } from "../../lib/bee";
import { cn } from "../../lib/utils";
import { ClaudeLogo, GoogleLogo, OpenAILogo } from "./logos";

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

const logos: Record<string, (props: { size?: number }) => React.ReactNode> = { claude: ClaudeLogo, openai: OpenAILogo, google: GoogleLogo };

/** The platform's own mark on a neutral tile. */
export function PlatformMark({ platform, size = 30 }: { platform: PlatformId; size?: number }) {
  const Logo = logos[platform];
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex flex-none items-center justify-center rounded-lg border border-line bg-card text-fg"
    >
      {Logo ? <Logo size={Math.round(size * 0.6)} /> : "•"}
    </span>
  );
}

const MARK = "M50,6 L88.1,28 L88.1,72 L50,94 L11.9,72 L11.9,28 Z M11.9,36.5 h76.2 v9 h-76.2 Z M11.9,54.5 h76.2 v9 h-76.2 Z";

/** The TokHive mark; `fill` defaults to the text colour. */
export function Mark({ size = 18, fill = "currentColor" }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d={MARK} fill={fill} fillRule="evenodd" />
    </svg>
  );
}

/** The app icon: the Volt mark on a Graphite tile. */
export function BeeGlyph({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      className="inline-flex flex-none items-center justify-center bg-[#141517] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
    >
      <Mark size={Math.round(size * 0.62)} fill="#C8F031" />
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <code className="rounded border border-line bg-sunken px-[5px] font-mono text-xs">{children}</code>;
}
