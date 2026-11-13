import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'openai-completion.spec.ts',fullyParallel:true,workers:2,retries:0,
 outputDir:'../.cache/openai-completion/playwright',
 use:{channel:process.env.BEE_TEST_BROWSER_CHANNEL,locale:'zh-CN',baseURL:'http://127.0.0.1:1424',trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:[{command:'npm run dev -- --port 1424',url:'http://127.0.0.1:1424',reuseExistingServer:false,timeout:30000},{command:'python3 -m http.server 1497 --bind 127.0.0.1 --directory ../docs/preview',url:'http://127.0.0.1:1497',reuseExistingServer:false,timeout:30000}],
});
