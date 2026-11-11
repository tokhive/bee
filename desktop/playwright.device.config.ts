import { defineConfig, devices } from '@playwright/test';
const port=process.env.BEE_DEVICE_TEST_PORT??process.env.BEE_E2E_PORT??'1421';
export default defineConfig({
 outputDir:'../.cache/device-pairing/playwright',
 testDir:'./tests',testMatch:['device.spec.ts','device-recovery.spec.ts','supply.spec.ts','native-accounts.spec.ts','native-runtime.spec.ts','native-auto-service.spec.ts','compact-account-list.spec.ts','openai-completion.spec.ts','native-experience.spec.ts','account-auto-read.spec.ts','native-updater.spec.ts','polling-stability.spec.ts','overview-refresh-stability.spec.ts','recovery-navigation.spec.ts'],fullyParallel:true,retries:0,
 forbidOnly:Boolean(process.env.CI),
 use:{locale:'zh-CN',baseURL:`http://127.0.0.1:${port}`,trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:`npm run dev -- --port ${port}`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000},
});
