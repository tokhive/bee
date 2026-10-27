import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 outputDir:'../.cache/device-pairing/playwright',
 testDir:'./tests',testMatch:['device.spec.ts','supply.spec.ts','native-accounts.spec.ts','native-runtime.spec.ts','native-updater.spec.ts'],fullyParallel:true,retries:0,
 forbidOnly:Boolean(process.env.CI),
 use:{locale:'zh-CN',baseURL:'http://127.0.0.1:1421',trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'npm run dev -- --port 1421',url:'http://127.0.0.1:1421',reuseExistingServer:false,timeout:30000},
});
