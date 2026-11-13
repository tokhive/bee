# 原生自动服务预览交付快照

- 时间：2026-11-05 18:13:34 Asia/Shanghai。
- 评审状态：待评审；正式组件使用模拟数据，不代表真实原生业务验收。
- 来源：bee-desktop-ui 共享工作区；本轮对齐默认自动服务，移除日常停止确认场景，准备未知结果从“重试准备”触发，零接入账号等待、明确接入后自动准备。
- 构建：Vite e2e 模式，显式 VITE_BEE_DATA_MODE=native；HTML、JS、CSS、图片、场景和模拟数据全部冻结，不引用当前源码或真实业务 API。
- 变更验证：preview-scenarios.spec.ts 与 preview-runtime.spec.ts 共 67 项通过；包含单次准备提交、未知结果不重放、暂停保留、跨页导航与只读恢复。
- 迁移前 175130 包构建为 demo，未通过原生验证；180951 包为明确标记的迁移前场景重建，本目录为本轮实际交付版本。

以本目录为网站根目录运行 python3 -m http.server 1498 --bind 127.0.0.1，打开 http://127.0.0.1:1498/tests/fixtures/bee-preview/index.html?scene=running&theme=light。支持 scene/theme/size 参数，开发事件工具需 debug=1。

## 构建来源校验

- src/main.tsx: 7c7491d719de4bb9bfc3c3ce15b06125e137c1d3dd5e434da088f124a73026dd
- src/features/accounts/AccountCondition.tsx: a3423e10ba6855db1ef86290d6800060d87c429c6e5457db732cbdb430acd2df
- tests/fixtures/bee-preview/app.mjs: 68aba4556ebc39e0ea55202e1941cbdc759107b0e99ea8089d38245b4b65dc15
- tests/fixtures/bee-preview/fixture.mjs: a72d0cfd7ea7e9f9f37795d0451c64d070a4ab6c0eed67daa28fd35fff3cdf15
- tests/fixtures/bee-preview/scenarios.mjs: 15501270d681aaf36d0c1075ad8f3ce68978333dc9981e8d96827faf7ef3c8c0
- tests/fixtures/native-accounts.mjs: 35a565bd066d10ac902ea6a65b394eb789ddc193f2de690ee98287a243a42c4d
