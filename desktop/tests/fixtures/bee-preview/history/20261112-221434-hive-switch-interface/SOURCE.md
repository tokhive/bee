# Hive 切换界面交付预览

时间：20261112-221434 Asia/Shanghai。来源：codex/bee-hive-switch-08，基于 3c713be 的 ticket 08 正式 React 页面与模拟 IPC。评审状态：待评审。

完整 Vite e2e 构建，显式 VITE_BEE_DATA_MODE=native，target=esnext，仅供现代浏览器评审。包含 HTML、JS、CSS、图标与 mock；不接真实 Hive、不启动原生 App 或管理进程。以本目录作为 HTTP 根目录，打开 /tests/fixtures/bee-preview/index.html?scene=switch-saved&theme=light&size=narrow。

修改前基线见 ../20261112-215252-before-hive-switch/。历史资源冻结，不随当前源码变化。
