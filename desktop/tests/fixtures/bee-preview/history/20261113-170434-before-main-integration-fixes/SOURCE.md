# main 集成修复前预览

时间：2026-11-13 17:04:34 Asia/Shanghai。来源：集成分支基线 `da313bce709d090e61d6f295cb56e8cbdd96dd16` 的正式前端与模拟预览，捕获于本轮前端修复之前。当时已修改的 Rust 入口及测试文件不进入此浏览器包。

状态：修改前基线，保留已知的重复读取和场景覆盖问题。已通过独立静态服务打开运行中场景，确认资源可加载。

## 运行

以此目录为独立网站根目录：

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `http://127.0.0.1:1492/tests/fixtures/bee-preview/index.html?scene=running&theme=dark&size=narrow`。保留 scene/theme/size/locale 参数；不可直接使用 file://。HTML、JavaScript、CSS、图片和模拟数据均已冻结，不依赖当前工作版资源。

构建采用 Node 24.22.1、Vite 8.2.4、React 插件，`configFile:false`、`mode:e2e`、`DEV=true`、`VITE_BEE_DATA_MODE=native`、`target:esnext`；三个入口为根 index.html、预览 index.html 和 app.html。平台常量为 darwin/arm64。这是浏览器模拟环境，不是原生 App 或真实 Hive 验收。
