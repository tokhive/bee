import {defineConfig,devices} from '@playwright/test';
const port=process.env.BEE_FIRST_LAUNCH_TEST_PORT??'1431';
export default defineConfig({
 testDir:'./tests',testMatch:['first-launch-wizard.spec.ts','first-launch-integration.spec.ts'],outputDir:'../.cache/first-launch/playwright',
 fullyParallel:true,retries:0,forbidOnly:Boolean(process.env.CI),
 use:{locale:'zh-CN',baseURL:`http://127.0.0.1:${port}`,trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:`npm run dev -- --port ${port}`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000},
});
