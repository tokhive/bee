import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { tauriShell } from "./lib/tauriShell";
import { devShell } from "./lib/devShell";
import "./index.css";

// In the app the Rust shell answers; in a plain browser during development a
// stand-in reads the mock Bee through the dev server.
const inTauri = "__TAURI_INTERNALS__" in window;
const shell = inTauri || !import.meta.env.DEV ? tauriShell : devShell;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App shell={shell} />
  </StrictMode>,
);
