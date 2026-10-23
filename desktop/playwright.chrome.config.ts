import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Explicit local alternative; CI and the default config keep Playwright Chromium.
export default defineConfig({
  ...base,
  use: { ...base.use, channel: 'chrome' },
});
