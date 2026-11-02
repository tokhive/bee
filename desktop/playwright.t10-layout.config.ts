import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['t10-layout.spec.ts','t10-layout-supplement.spec.ts'],fullyParallel:true,retries:0,timeout:50000,use:{locale:'zh-CN',baseURL:'http://127.0.0.1:1519',trace:'retain-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
