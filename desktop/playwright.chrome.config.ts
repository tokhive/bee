import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Explicit local alternative; CI and the default config keep Playwright Chromium.
export default defineConfig({
  ...base,
  projects: [{ name: 'chrome', use: { ...base.projects![0].use, channel: 'chrome' } }],
});
