// Local manual preview of the production native settings page. All IPC is a
// fixture: this server cannot download, install, sign in, or contribute.
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {accountFixture, installAccountFixture} from '../tests/fixtures/native-accounts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const initial = {
  operation_id:'fixture-update', revision:2, state:'verified', current_version:'0.1.0', target_version:'0.2.0',
  checked_at:'2026-10-28T00:00:00Z', downloaded_bytes:200, total_bytes:200,
  release_notes:'预览示例：改进桌面更新与安装确认。\n此页面使用模拟接口，不会实际下载或安装。', error:null,
};
const fixture = {runtimeEnabled:true, accounts:{openai:accountFixture('openai'), claude:accountFixture('claude')}};
const server = await createServer({root, configFile:`${root}vite.config.ts`, server:{host:'127.0.0.1', port:1434, strictPort:true},
  plugins:[{name:'native-update-preview', configureServer(vite) {
    vite.middlewares.use((request,response,next) => {
      if (new URL(request.url,'http://127.0.0.1:1434').pathname !== '/__s3-updater-preview') return next();
      const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bee 更新布局预览</title></head><body>
      <div id="root"></div><aside style="position:fixed;bottom:8px;right:12px;z-index:20;padding:6px 10px;border:1px solid #d9cba8;border-radius:6px;background:#fff9eb;color:#76560d;font:11px sans-serif">布局预览 · 模拟接口 · 刷新重置</aside>
      <script>(${installAccountFixture.toString()})(${JSON.stringify(fixture)});window.updateSnapshot=${JSON.stringify(initial)};const previewInvoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(command,args)=>{const value=await previewInvoke(command,args);if(command==='bridge_status'&&value.metadata)value.metadata.bee_version='0.1.0';return value;};
      let previewSettingsOpened=false;const previewObserver=new MutationObserver(()=>{if(!previewSettingsOpened){const hive=[...document.querySelectorAll('button')].find(b=>b.textContent==='打开 Hive 控制台');if(!hive||hive.disabled)return;const settings=[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置');if(!settings)return;previewSettingsOpened=true;settings.click();}const about=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='关于');if(about){previewObserver.disconnect();about.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));requestAnimationFrame(()=>document.querySelector('.ns-about')?.scrollIntoView({block:'end'}));}});previewObserver.observe(document.getElementById('root'),{childList:true,subtree:true,attributes:true});</script>
      <script type="module" src="/src/main.tsx"></script></body></html>`;
      vite.transformIndexHtml(request.url,html).then(output => {
        response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');response.end(output);
      }).catch(next);
    });
  }}],
});
await server.listen();
console.log('Bee 更新布局预览：http://127.0.0.1:1434/__s3-updater-preview');
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await server.close();process.exit(0);});
