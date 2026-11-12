# Hive 切换界面最终交付预览

时间：2026-11-12 22:26:01 Asia/Shanghai。评审状态：待评审。来源：codex/bee-hive-switch-08，已合并最终集成 2650440（07 为 2e6af0e），本次前端代码见 5528801。

完整 Vite e2e 构建，显式 VITE_BEE_DATA_MODE=native，target=esnext，仅供现代浏览器评审。包含 HTML、JS、CSS、图标与 mock；不接真实 Hive、不启动原生 App 或管理进程。已对齐 observation_last、observation_blocked 与保存 profile 身份等最终 native DTO，并让 bridge／settled mock 事件携带 profile_id。

以本目录作为 HTTP 根目录，打开 /tests/fixtures/bee-preview/index.html?scene=switch-saved&theme=light&size=narrow。修改前基线见 ../20261112-215252-before-hive-switch/。22:14 初版原样保留，最终验证请使用本目录。历史资源冻结，不随当前源码变化。
