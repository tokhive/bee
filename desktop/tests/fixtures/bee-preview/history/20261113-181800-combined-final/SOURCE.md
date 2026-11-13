# 合并后的正式组件最终快照

构建时间：2026-11-13 18:18:09 Asia/Shanghai（目录标识 181800）。基线 8d155e0 + 首次启动分支 5f1ba7d，含冲突解决、空配置首次绑定衔接、账号读取等待与失败证据修复。SOURCE.patch SHA-256：`d46e6ae82e24777bbd77d78dc7555f19db758b26e024814f780da13c53ecb48e`。

修改前复用 20261113-171854-main-integration-fixes；180820 为本轮中间快照，保持原样。本版待评审，未实现静态新版概览。

Node 24.22.1 / Vite 8.2.4，e2e/native、DEV=true、darwin/arm64。HTML、JS、CSS 与模拟数据完整冻结，不依赖当前开发源码。

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `/tests/fixtures/bee-preview/index.html?scene=switch-first-launch`；支持 scene/theme/size/locale。独立 HTTP + ego-browser 验证首次 Hive 表单到配对页、账号读取等待及登录／接入场景。完整状态转换由本轮 Playwright 回归覆盖。此为模拟环境，不替代真实 Hive 与原生 App 验收。
