# Bee UI 开发入口、默认检查与真实验收实施计划

> 执行方式：按用户“先解决这三个问题，一项一项做”的授权，在当前会话依次执行，使用 executing-plans；每项验证后推进下一项。

**目标：** 统一正式 UI 的 mock 开发入口，将已有契约和场景测试接入常用检查，并逐条核对真实流程验收。

**架构：** 复用正式 NativeApp、类型化 Client 和已有模拟 IPC；Vite 提供场景预览。测试沿用 Node test runner、Playwright 与既有原生／核心检查，不新增生产依赖或业务接口。

**技术栈：** 沿用 Node 24.x、npm、Vite 8.2.4、TypeScript 7.0.2、React 19.2.8、Playwright 1.63.0；真实能力沿用现有 Tauri/Rust、Go Bee 和 Hive。

## 约束

- 复用 bee-desktop-p0 工作树；保存并尊重正在进行的其他改动。
- UI 预览只使用隔离模拟数据，所有操作留在预览实例内。
- 修正现有测试入口与配置，不为脚本名称、文档文字等低影响改动编写重复测试。
- 对照已有场景和验收台账，不将预览、mock 或历史版本通过等同于当前真实全链路通过。
- 真实账号、设备归属、贡献及系统设置的修改须有明确目标与授权；准备可执行方案后再处理缺失资源。

## 第 1 项：正式 UI 开发入口

文件：desktop/package.json、desktop/README.md、desktop/tests/preview-scenarios.spec.ts。

输入：tests/fixtures/bee-preview/index.html 与正式 NativeApp；输出：dev:ui 命令和一致的开发说明。

- [x] 增加 `dev:ui`：使用现有 Vite 服务并打开 `/tests/fixtures/bee-preview/index.html`。
- [x] README 首先说明正式 UI 的开发步骤、场景选择与 mock 边界，明确旧 demo 的历史用途。
- [x] 将场景选择器测试的临时 `.cache` 页面入口换成已纳入版本管理的正式预览入口。
- [x] 运行现有选择器和代表场景测试，并用浏览器检查正式四页、主题／窄窗切换和场景重置。

## 第 2 项：默认测试与 CI

文件：desktop/package.json、desktop/README.md、.github/workflows/desktop.yml、desktop-hosted-macos.yml、desktop-hosted-linux.yml；按实际运行边界处理 hosted Windows。

输入：现有 tests/*.test.ts、device 和 preview Playwright 配置；输出：常用检查命令覆盖契约、正式页面与预览。

- [ ] 增加 `test:unit` 与 `test:preview`，将全量 TS 单测（含跨语言契约）与正式预览纳入默认 `npm test`。
- [ ] 现有主 CI 和具备浏览器测试的 hosted 流程调用新增检查，保留原有构建与测试覆盖。
- [ ] 验证新增默认检查命令，记录失败与原因；必要修复仅针对本任务暴露的入口／fixture／契约同步问题。
- [ ] 更新 README 的日常检查说明，并检查 CI YAML 与实际命令一致。

## 第 3 项：逐流程真实验收

文件：新增 docs/desktop/ui-development-acceptance.md；关联现有接口、场景、验收报告与运行证据。

输入：当前源码、已有 76 项业务矩阵和真实验证记录；输出：当前可复核的流程验收状态及明确剩余条件。

- [ ] 按首次绑定、账号接入／登录／换号、开始／暂停／停止、异常恢复、设置／诊断、退出／更新登记实际接口、mock 场景、自动测试和真实验收条件。
- [ ] 执行当前可隔离且不会修改用户真实资源的必要联调检查，保留命令、结果和代码范围。
- [ ] 对依赖真实账号、独立设备、系统权限和签名更新的路径，写清测试对象、前置资源、操作和成功判据。
- [ ] 完成必要真实路径验证后才将第 3 项标为完成；资源缺失时保留未完成并给出具体下一步。

## 验证记录

执行后逐项填写实际命令与结果，尚未运行的项目保持未勾选。前两项完成不代表第三项或整套产品验收完成。

第 1 项：Node 24.22.1 下，`BEE_E2E_PORT=28461 npm exec -- playwright test --config playwright.preview.config.ts --grep 'review selector|scene renders formal state.*(device-unbound|running|account-selected|supply-paused)$' --reporter=line`，5/5 通过。`dev:ui -- --port 1473` 实际启动成功；Ego 检查四页导航、深色、860×600 与重置通过。三个修改文件的 `git diff --check` 通过。
