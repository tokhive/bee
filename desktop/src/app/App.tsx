import * as React from "react";
import type { Shell } from "../lib/bee";
import { NavContext, type Nav, type Screen } from "./nav";
import { AppProvider, useApp } from "./context";
import { Banner, Header, Toast } from "./chrome";
import { QuitDialog } from "./QuitDialog";
import { Welcome, Bind, Wait, Done } from "../screens/Onboarding";
import { Home } from "../screens/Home";
import { AddAccount } from "../screens/AddAccount";
import { SettingsPage } from "../screens/Settings";
import { BeeGlyph } from "../components/ui/bits";

export function App({ shell }: { shell: Shell }) {
  return (
    <AppProvider shell={shell}>
      <Window />
    </AppProvider>
  );
}

function Window() {
  const { snapshot, t, toastText } = useApp();
  const [screen, setScreen] = React.useState<Screen>({ name: "home" });
  const [onboarding, setOnboarding] = React.useState(false);
  const binding = snapshot?.overview?.binding;
  const mainRef = React.useRef<HTMLElement>(null);

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

  const nav: Nav = {
    screen,
    go: setScreen,
    onboarding,
    finishOnboarding: () => {
      setOnboarding(false);
      setScreen({ name: "home" });
    },
  };

  if (!snapshot || (snapshot.service === "starting" && !snapshot.overview)) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <BeeGlyph size={40} />
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
      <div className="relative flex h-full flex-col bg-page">
        {flow ? (
          <main ref={mainRef} className="flex min-h-0 flex-1 flex-col">{renderScreen(screen)}</main>
        ) : (
          <>
            <Header />
            <Banner />
            <main ref={mainRef} className="flex min-h-0 flex-1 flex-col">{renderScreen(screen)}</main>
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
    case "add":
      return <AddAccount key={screen.replacing?.id ?? "add"} initialStep={screen.step} platform={screen.platform} replacing={screen.replacing} />;
    default:
      return <Home />;
  }
}
