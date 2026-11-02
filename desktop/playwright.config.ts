import { defineConfig, devices } from '@playwright/test';

const port=Number(process.env.BEE_E2E_PORT??1420);
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/t10-layout-fix.spec.ts', '**/t10-layout-supplement.spec.ts', '**/t10-layout.spec.ts', '**/device.spec.ts', '**/device-recovery.spec.ts', '**/supply.spec.ts', '**/native-accounts.spec.ts', '**/native-runtime.spec.ts', '**/native-experience.spec.ts', '**/account-auto-read.spec.ts', '**/preview-scenarios.spec.ts', '**/native-updater.spec.ts','**/polling-stability.spec.ts','**/recovery-navigation.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { locale: 'zh-CN', baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run dev:e2e -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
