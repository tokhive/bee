# 桌面功能合并后的正式组件预览

时间：2026-11-13 18:08:20 Asia/Shanghai。来源：集成分支基线 8d155e0 + 首次启动分支 5f1ba7d，含冲突解决及首次 Hive 创建衔接修复。相对基线的前端／模拟源码差异见 SOURCE.patch，SHA-256：`9670321adb0d5c97135f6d27b241169008c11b062a5dd6d7726a4e460e472518`。

修改前正式组件复用 20261113-171854-main-integration-fixes；首次向导来源的历史记录随分支合并保留。本版为待评审的合并交付快照，不新增视觉设计，也未将静态概览设计移植到正式组件。

Node 24.22.1、Vite 8.2.4 构建，e2e/native 模式、DEV=true、darwin/arm64 平台常量，根 index、预览 index 与 app 三入口完整冻结。以本目录作为 HTTP 根目录：

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `/tests/fixtures/bee-preview/index.html?scene=switch-first-launch&theme=dark&size=narrow`。资源不依赖当前开发源码；支持 scene/theme/size/locale 参数。

已用 ego-browser 独立验证：首次空 Hive 显示向导、生成一次配对请求、模拟批准后显示绑定完成、点击进入概览、打开和 Escape 关闭 Hive 列表、焦点返回原按钮，零意外切换写入。截图见仓库 docs/desktop/evidence/2026-11-13-combined-integration/first-hive-pairing.png。模拟环境不代替真实 Hive／账号或原生 App 验收。
