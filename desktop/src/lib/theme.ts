// The colour mode. The stylesheet follows the system unless <html> carries
// data-theme; the choice is also kept in local storage so the next start
// paints in it before the shell has answered with the settings.
import type { Theme } from "./bee";

const KEY = "bee-theme";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage may be unavailable; the settings still apply this time.
  }
}

/** Applies the last chosen mode, before the first render. */
export function applySavedTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch {
    // Nothing saved yet.
  }
}
