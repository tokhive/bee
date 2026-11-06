# 迁移前预览场景重建

- 时间：2026-11-05 18:09:51 Asia/Shanghai。
- 评审状态：待评审；重建版本。
- 来源：commit 36f533834c7797569c91cda55b762aa63df2d4e6 的 app.mjs、scenarios.mjs、fixture.mjs，补入当前原生契约必填 legacy_stop=null；其他生产 UI 和模拟基础设施使用构建时共享工作区。
- 本目录不是修改前完整原始工作区快照。原 20261105-175130-before-native-preview 使用 demo 构建模式，未通过原生预览验证；保留原件不覆盖。本重建显式设置 VITE_BEE_DATA_MODE=native。
- 保留旧开始/停止场景，因此旧确认场景与当前默认自动服务 UI 存在已知不匹配；其修复后版本见本轮交付包。
- 本目录冻结 HTML、JS、CSS、图片、场景和模拟数据，不引用当前源码。

运行：以本目录为网站根目录执行 python3 -m http.server 1498 --bind 127.0.0.1，打开 http://127.0.0.1:1498/tests/fixtures/bee-preview/index.html?scene=running&theme=light。支持 scene/theme/size 参数。
