import {defineConfig, devices} from '@playwright/test';
const port=Number(process.env.BEE_E2E_PORT??1471);
export default defineConfig({
 testDir:'./tests',testMatch:['preview-scenarios.spec.ts','preview-settings.spec.ts','preview-accounts.spec.ts','preview-runtime.spec.ts','preview-network.spec.ts','preview-device.spec.ts'],
 outputDir:'../.cache/bee-preview/playwright',fullyParallel:true,workers:4,retries:0,
 forbidOnly:Boolean(process.env.CI),
 use:{locale:'zh-CN',baseURL:`http://127.0.0.1:${port}`,trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:`npm run dev -- --port ${port}`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000},
});
