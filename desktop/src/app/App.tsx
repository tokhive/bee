import * as React from "react";
import type { Shell } from "../lib/bee";
import { NavContext, type Nav, type Screen } from "./nav";
import { AppProvider, useApp } from "./context";
import { Banner, Sidebar, Toast } from "./chrome";
import { QuitDialog } from "./QuitDialog";
import { Welcome, Bind, Wait, Done } from "../screens/Onboarding";
import { Dashboard } from "../screens/Dashboard";
import { Home } from "../screens/Home";
import { Logs } from "../screens/Logs";
import { AddAccount } from "../screens/AddAccount";
import { SettingsPage } from "../screens/Settings";
import { BeeGlyph } from "../components/ui/bits";
import { applyTheme } from "../lib/theme";

export function App({ shell }: { shell: Shell }) {
  return (
    <AppProvider shell={shell}>
      <Window />
    </AppProvider>
  );
}

function Window() {
  const { snapshot, t, toastText, explanationsReady, settings, shell } = useApp();
  const [screen, setScreen] = React.useState<Screen>({ name: "dashboard" });
  const [onboarding, setOnboarding] = React.useState(false);
  const binding = snapshot?.overview?.binding;
  const mainRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings]);

  // A new page moves keyboard focus to its heading, unless one of its
  // controls already took it.
  React.useEffect(() => {
    const main = mainRef.current;
    if (!main || main.contains(document.activeElement)) return;
    main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [screen]);

  // An unlinked desktop Bee starts the guided setup; a linked one goes home.
  React.useEffect(() => {
    if (binding === "unpaired" && !onboarding) {
      setOnboarding(true);
      setScreen({ name: "welcome" });
    }
  }, [binding, onboarding]);

  // The app menu's page items (⌘1–⌘4, ⌘,) open a page, outside the setup.
  React.useEffect(
    () =>
      shell.onMenu((action) => {
        if (action === "refresh" || onboarding) return;
        setScreen({ name: action } as Screen);
      }),
    [shell, onboarding],
  );

  const nav: Nav = {
    screen,
    go: setScreen,
    onboarding,
    finishOnboarding: () => {
      setOnboarding(false);
      setScreen({ name: "dashboard" });
    },
  };

  // Wait for Bee's words too, when Bee answered, so no card shows a general
  // sentence before its own.
  if (!snapshot || (snapshot.service === "starting" && !snapshot.overview) || (snapshot.overview && !explanationsReady)) {
    return (
      <main data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <BeeGlyph size={44} />
        <div>
          <span className="spinner mr-1.5" aria-hidden="true" />
          {t.loading}
        </div>
      </main>
    );
  }

  const flow = screen.name === "welcome" || screen.name === "bind" || screen.name === "wait" || screen.name === "done" || (screen.name === "add" && onboarding);
  return (
    <NavContext.Provider value={nav}>
      <div className="relative flex h-full bg-page">
        {flow ? (
          <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Room for the window's traffic lights; dragging here moves the window. */}
            <div data-tauri-drag-region className="h-11 flex-none" />
            {renderScreen(screen)}
          </main>
        ) : (
          <>
            <Sidebar />
            <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Banner />
              {renderScreen(screen)}
            </main>
          </>
        )}
        <QuitDialog />
        <Toast text={toastText} />
      </div>
    </NavContext.Provider>
  );
}

function renderScreen(screen: Screen) {
  switch (screen.name) {
    case "welcome":
      return <Welcome />;
    case "bind":
      return <Bind mode={screen.mode} />;
    case "wait":
      return <Wait mode={screen.mode} hive={screen.hive} />;
    case "done":
      return <Done />;
    case "settings":
      return <SettingsPage />;
    case "logs":
      return <Logs />;
    case "accounts":
      return <Home />;
    case "add":
      return <AddAccount key={screen.replacing?.id ?? "add"} initialStep={screen.step} platform={screen.platform} replacing={screen.replacing} />;
    default:
      return <Dashboard />;
  }
}
