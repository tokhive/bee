import type { Language, QuotaWindow } from "./bee";
import type { Messages } from "./i18n";

/** b.lee@gmail.com → b***@gmail.com. The window never shows a whole address. */
export function maskEmail(email?: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return `${email[0]}***`;
  return `${email[0]}***${email.slice(at)}`;
}

/** max → Max, team_premium → Team Premium. */
export function planLabel(plan?: string): string {
  if (!plan) return "";
  return plan
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** The short account number: the fingerprint's first 8 characters. */
export function shortFingerprint(fingerprint?: string): string {
  return fingerprint ? fingerprint.slice(0, 8) : "";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthDay(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function windowName(window: QuotaWindow, t: Messages): string {
  const s = window.seconds;
  let name = t.quota.windows[s];
  if (!name) name = s % 86400 === 0 ? t.quota.days(s / 86400) : t.quota.hours(Math.round(s / 3600));
  return window.scope ? t.quota.scoped(name, planLabel(window.scope)) : name;
}

/** 16:30 today, 周四 09:00 within a week, 11/30 09:00 later. */
export function resetTime(iso: string | undefined, t: Messages, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = (d.getTime() - now.getTime()) / 86400000;
  if (days > 0 && days < 6.5) return `${t.quota.weekdays[d.getDay()]} ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** Minutes since iso, or null when within 15 minutes (fresh enough to say nothing). */
export function staleMinutes(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now - at) / 60000);
  return minutes > 15 ? minutes : null;
}

export function localize(text: { en: string; zh: string } | undefined, language: Language): string {
  if (!text) return "";
  return language === "zh" ? text.zh || text.en : text.en || text.zh;
}
