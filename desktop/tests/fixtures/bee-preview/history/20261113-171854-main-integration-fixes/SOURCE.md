# main 集成修复后预览

时间：2026-11-13 17:18:54 Asia/Shanghai。来源：集成分支 `codex/bee-desktop-main-integration`，基线 `da313bce709d090e61d6f295cb56e8cbdd96dd16` 加本轮前端及模拟预览修复。源码差异见 SOURCE.patch，SHA-256：`12c7166cde42d685746d188dc58cc5408cbdb3ebbc6de5b7f4001a9614c9701a`。

状态：待评审，本轮正式组件交付快照。启动先确认 Hive 作用域；进程事件触发权威作用域重读；保留同实例启动重试；桥失败预设不再被切换模拟覆盖；自动导航等待初始设备身份已渲染。

已用 ego-browser 在独立静态服务检查深色 860×600 运行场景、暂停接单、打开及 Escape 关闭 Hive 列表（焦点返回原按钮，无切换写入），并确认失败场景显示 exit=17。开发版更新下载场景落在“关于”页且显示下载进度。

## 运行

以此目录为独立网站根目录：

```sh
python3 -m http.server 1492 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `http://127.0.0.1:1492/tests/fixtures/bee-preview/index.html?scene=running&theme=dark&size=narrow`。保留 scene/theme/size/locale 参数；不可直接使用 file://。HTML、JavaScript、CSS、图片和模拟数据均已冻结，不依赖当前工作版资源。

构建采用 Node 24.22.1、Vite 8.2.4、React 插件，`configFile:false`、`mode:e2e`、`DEV=true`、`VITE_BEE_DATA_MODE=native`、`target:esnext`；三个入口为根 index.html、预览 index.html 和 app.html。平台常量为 darwin/arm64。这是浏览器模拟环境，不是原生 App 或真实 Hive 验收。
