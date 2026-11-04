# Bee 桌面客户端

## UI 开发入口：正式页面与 mock

开发概览、AI 账号、诊断和设置四页时，从 Bee 仓库根执行：

```sh
npm --prefix desktop ci
npm --prefix desktop run dev:ui
```

使用 Node 24.x。命令启动 Vite 并打开 [正式场景预览](http://127.0.0.1:1420/tests/fixtures/bee-preview/index.html)。浏览器未自动打开时，手动访问该地址；端口已占用时可添加 `-- --port 1426`，并使用输出的新端口。

预览加载当前源码中的正式 `NativeApp`、页面组件、状态协调器和类型化 Client，由模拟 IPC 提供数据。选择场景后可操作四页、账号详情和确认框，也可切换明暗主题、860×600 窄窗并重置场景。操作只影响当前预览，不连接真实 Hive、不读取真实账号凭据、不启动贡献或安装更新。

同一场景内切页、切换外观或窗口尺寸会保留操作进度；切换场景、刷新和“重置场景”创建新会话。外观与正式设置页共用偏好，语言、主题和修订可回读。预览上方“模拟外部条件”可选择通知权限、自启注册、账号来源、当前登录结果、设备网络、贡献回执、代理故障、诊断结果、当前配对批准和设备凭据撤销；选择结果后点击“应用模拟条件”，再在正式页面继续操作或核对。控制只作用于当前会话和当前操作，旧登录或配对结果不会应用到新事务。

开发时按下面的入口定位修改：

| 内容 | 位置 |
| --- | --- |
| 正式页面、组件和呈现逻辑 | `src/features/`、`src/components/`、`src/presentation/` |
| 客户端契约和共享状态 | `src/system/` |
| 场景目录和状态模拟 | `tests/fixtures/bee-preview/scenarios.mjs`、`fixture.mjs` |
| 共同事件入口及网络／设备会话 | `tests/fixtures/bee-preview/control.mjs`、`network-session.mjs`、`device-session.mjs` |
| 共用原生命令替身 | `tests/fixtures/native-accounts.mjs` |
| 场景断言和业务验收映射 | `tests/preview-scenarios.spec.ts`、`tests/fixtures/t10-layout-cases.json` |

字段或操作变化时，同步维护真实 Client、模拟响应和对应契约／场景断言。场景预览只能验证受模拟条件覆盖的 UI 行为；真实登录、设备归属、连接恢复及系统操作按实际环境另行验收。

`dev:demo` 和 `build:demo` 保留历史五页演示及其回归测试用途，包含已移出当前产品范围的收益页面。当前 UI 开发使用 `dev:ui`。普通 `dev` 供 Tauri 和测试启动 Vite，在浏览器直接打开根路径不会自动获得正式 mock。

## 一键构建 macOS App

在当前源码 checkout 的仓库根目录执行：

```sh
make app
```

此命令按顺序检查工具链、准备固定 TEE 依赖、按锁文件安装前端依赖、重建当前 revision 的内置 Bee，再编译正式前端和 Tauri 原生开发包；任一步失败立即停止。要求 Node 24、Go 1.27.3、Rust 1.94.0 和 Xcode。优先使用本机 NVM 或项目缓存中已有的 Node 24.22.1，也可用 `make app APP_NODE_BIN=/path/to/node24/bin` 指定；其他安装方式使用 PATH 并由预检校验。Cargo 默认使用 `~/.cargo`，显式设置的 `CARGO_HOME` 优先；不自动选用 `.cache/cargo-home` 中可能过期的离线快照。默认缺少依赖时允许联网下载；显式指定的 Cargo 配置仍按其自身设置执行，不自动安装工具链。

产物为 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`，使用本机 ad-hoc 签名。构建命令不会启动或退出 App；先在旧 Bee 中按 ⌘Q 完全退出，再打开新包：

```sh
open "desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app"
```

`make build` 继续只编译 CLI；本命令不使用演示模式，也不执行登录、接入或贡献操作。当前设计、分层接口和验收缺口见[文档总入口](../docs/desktop/README.md)。

## 当前行为与文档

已绑定设备在启动核验后可连接 Hive；“设备在线”“贡献运行”“平台可接单”分别表示不同事实。开始贡献、接入／换号、解除暂停由用户明确操作。普通查询超时保留管理进程和原请求，原请求结束后按资源退避核对，写操作不自动重放。

macOS 原生“编辑”菜单随应用语言切换，提供撤销、重做、剪切、复制、粘贴和全选，以及对应的系统快捷键。修改原生菜单后需重建并重启 App；在真实窗口的输入框内验证，浏览器预览不能覆盖 macOS 菜单对快捷键的处理。

- [产品范围](../docs/desktop/product.md)、[架构与接口分层](../docs/desktop/architecture.md)。
- [设备配对](../docs/desktop/device-pairing.md)、[AI 账号](../docs/desktop/ai-accounts.md)、[供给控制](../docs/desktop/supply-control.md)。
- [桥接契约](../docs/desktop/bridge-protocol.md)、[发布与更新](../docs/desktop/release.md)、[当前验收状态](../docs/desktop/acceptance.md)。

## 开发检查

Node 24.x、Go 1.27.3、Rust 1.94 工具链及对应系统原生依赖须满足脚本预检。从 Bee 仓库根执行：

```sh
node desktop/scripts/preflight.mjs
node desktop/scripts/prepare-tee.mjs
npm --prefix desktop ci
npm --prefix desktop run test:tooling
npm --prefix desktop run test:bridge
npm --prefix desktop run test:device
npm --prefix desktop run build
node desktop/scripts/build-bee.mjs
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop run tauri -- dev
```

构建实际 Bee 后再运行依赖该二进制的 Cargo 测试。安装或构建成功不等于真实 GUI／官方账号／生产签名验收通过。

完整 TS 单测与正式场景检查目前需单独运行；进入 `desktop/` 后执行：

```sh
node --test tests/*.test.ts
npm exec -- playwright test --config playwright.preview.config.ts
```

需要先安装对应 Playwright 浏览器。`playwright.device.config.ts` 覆盖正式原生页面的模拟 IPC 测试，`playwright.preview.config.ts` 覆盖正式场景入口。默认 `test:e2e` 不包含这两套完整范围；统一默认检查及 CI 仍是[开发工作流计划](../docs/superpowers/plans/2026-11-03-ui-development-workflow.md)中的未完成项。

## 原生构建与发布

固定依赖、目标架构、内置 Bee 来源、包签名及更新来源由构建和发布脚本校验。开发包使用 ad-hoc 签名；发布需另外满足平台签名、公证、可信更新及干净安装验证，见[发布说明](../docs/desktop/release.md)。

[桌面 CI](../.github/workflows/desktop.yml)和 hosted 工作流分别记录实际运行环境；不能用交叉编译、模拟 IPC、Xvfb 或不同源码版本的结果代替最终三端系统验收。未完成项目统一列在[验收状态](../docs/desktop/acceptance.md)。
