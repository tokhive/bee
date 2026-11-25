/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockBridge } from "./scripts/mock-bridge";

// Tauri expects a fixed port and does not need the screen cleared.
export default defineConfig({
  plugins: [react(), tailwindcss(), mockBridge()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    css: false,
    globals: true,
  },
});
