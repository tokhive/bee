import * as React from "react";
import type { Account, PlatformId } from "../lib/bee";

export type BindMode = "onboarding" | "switch" | "rebind";
export type AddStep = "platform" | "method" | "import" | "confirm";

export type Screen =
  | { name: "welcome" }
  | { name: "bind"; mode: BindMode }
  | { name: "wait"; mode: BindMode; hive?: string }
  | { name: "done" }
  | { name: "home" }
  | { name: "settings" }
  | { name: "add"; step: AddStep; platform?: PlatformId; replacing?: Account };

export type Nav = { screen: Screen; go: (screen: Screen) => void; onboarding: boolean; finishOnboarding: () => void };

export const NavContext = React.createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = React.useContext(NavContext);
  if (!nav) throw new Error("useNav outside App");
  return nav;
}
