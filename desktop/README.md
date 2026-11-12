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

### 账户目标交互（mock）

场景选择器中的“账户目标交互（mock）”用于验证已确认的新交互：服务自动准备，平台分别暂停／恢复；接入保留最新接单选择，无历史选择时默认允许，主动重新登录和确认换号后保持暂停。每个账号突出一条状态，原因默认折叠，同因去重、独立条件保留。

直接打开 `accounts-auto-*` 链接时，默认只显示“接入账号”“暂停与恢复”“故障恢复”三个验收项目，隐藏场景选择器和外部事件配置。每项从固定起点开始，可以“重新开始这一项”。顶部“接下来”根据账号当前进度说明操作及预期结果：先在应用内开始登录，再点击出现的“模拟登录成功”；权限被拒绝时可点击“模拟权限恢复”，随后在凭证读取设置中明确保存并重新核验；即使目录不变，也可保存原设置。无需先配置外部事件即可完成这两条流程。重新登录的快捷成功按钮沿用原账号；成功提示用“完成”收起，不产生业务写。开发调试时在 URL 添加 `&debug=1`，恢复 7 个场景及“更多模拟条件”，用于检查不同身份和失败结果。

从[候选接入](http://127.0.0.1:1420/tests/fixtures/bee-preview/index.html?scene=accounts-auto-candidate&theme=light&size=narrow)连续操作，或使用 `accounts-auto-empty`、`accounts-auto-running`、`accounts-auto-paused`、`accounts-auto-error`、`accounts-auto-change`、`accounts-auto-stale` 检查对应起点。错误场景包含“读取权限不足＋手动暂停”；展开原因后可进入读取设置，修复权限后仍需明确恢复接单。

开发调试模式中的“更多模拟条件”默认折叠，仅列出账号相关事件，支持当前登录成功（原账号／不同账号）、失败，以及同账号后台刷新、服务准备失败、同会话模拟重启、报告过期／恢复、写入回执丢失。登录取消和准备重试使用页面按钮。先操作页面产生登录事务，再设置对应登录结果；回执丢失控制需在下一次写入前设置。不满足前置条件的操作会禁用并显示下一步；应用成功后收起面板，切换事件或参数会清除旧提示。其它页面的通用预览入口仍保留原有场景和事件。

`accounts-auto-*` 是前端模拟场景；正常原生入口接入 Go 自动维护、平台登录隔离与持久恢复，行为和接口见[原生自动服务](../docs/desktop/native-auto-service.md)。模拟重启只验证当前会话中的暂停选择，不证明真实磁盘持久化。详见[规格](../docs/desktop/auto-service-design.md)与[验收记录](../docs/desktop/evidence/2026-11-04-account-ui-review/auto-service-validation.md)。

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

## 当前原生行为与文档

首次启动在可信确认未配置且无未完成事务后，显示“连接 Hive → 绑定设备”向导；绑定前不显示主导航。完成后由用户选择进入账号页或概览，再次启动已绑定设备直接进入概览。读取故障与未完成事务沿原阶段恢复，不能当作新设备。见[设备配对说明](../docs/desktop/device-pairing.md)与[首次向导验收](../docs/desktop/evidence/2026-11-12-first-launch/validation.md)。

已绑定设备在启动核验后可连接 Hive；“设备在线”“贡献运行”“平台可接单”分别表示不同事实。明确接入后原生服务自动维护；接入／主动登录／换号和解除暂停由用户操作，首次接入、主动登录及换号后保持暂停。普通查询超时保留管理进程和原请求，原请求结束后按资源退避核对，写操作不自动重放。

macOS 原生“编辑”菜单随应用语言切换，提供撤销、重做、剪切、复制、粘贴和全选，以及对应的系统快捷键。修改原生菜单后需重建并重启 App；在真实窗口的输入框内验证，浏览器预览不能覆盖 macOS 菜单对快捷键的处理。

- [产品范围](../docs/desktop/product.md)、[架构与接口分层](../docs/desktop/architecture.md)。
- [设备配对](../docs/desktop/device-pairing.md)、[AI 账号](../docs/desktop/ai-accounts.md)、[供给控制](../docs/desktop/supply-control.md)。
- [桥接契约](../docs/desktop/bridge-protocol.md)、[发布与更新](../docs/desktop/release.md)、[当前验收状态](../docs/desktop/acceptance.md)。

## 启动受阻与恢复

启动时先连接后台并只读核对上次会话、未决操作和原运行意图；满足安全条件才恢复。暂停选择保持，结果未知的操作只核对。状态区展示实际阶段，明确失败后停止加载；支持核对、受控重连／重试和本地启动诊断导出。

旧会话未确认安全退出时，新版保留管理能力并明确阻塞，不自动删除保护文件或接管未知任务。已实现 Hive 旧代请求隔离与持久退役证明，并提供[配套补丁](../docs/desktop/integrations/hive-session-retirement/README.md)。补丁尚未部署，真实账号未恢复；Hive 不支持时页面明确要求升级 Hive，未排空时可继续原恢复。启动读取失败时账号维护保持受限，恢复后的同一实例重复重试不另发操作。

本轮[验收报告](../docs/desktop/evidence/2026-11-11-startup-recovery/README.md)记录受控通过项、开发包与未完成的隔离原生窗口／其他平台验收。启动新版可能按有效原意图恢复接单；构建不会启动 App，本轮未执行真实账号恢复。

## 开发检查

默认全套仍有待核对的历史回归失败，详见[迁移验证记录](../docs/desktop/evidence/2026-11-11-p0-retirement/README.md)；命令退出非零时不能视为通过。

日常 UI、契约与 mock 回归使用同一个入口。从 Bee 仓库根执行（Node 24.x）：

```sh
npm --prefix desktop ci
npm --prefix desktop exec -- playwright install chromium webkit
npm --prefix desktop test
```

默认前端回归使用 Chromium 和 WebKit，分别覆盖桌面 WebView 的相关引擎行为；Playwright WebKit 不是系统 WKWebView，不能替代真实 Tauri 验收。Firefox 不属于当前桌面运行时，作为可选兼容性检查：先执行 `npm --prefix desktop exec -- playwright install firefox`，再在 `desktop` 目录执行 `BEE_E2E_FIREFOX=1 npm run test:e2e -- --project=firefox`。

Linux 首次准备浏览器时使用 `playwright install --with-deps chromium webkit` 安装所需系统库。`npm test` 依次执行类型检查、全量 TS 单测、工具测试、原有浏览器 E2E、正式页面模拟 IPC 测试和正式场景预览；任一组失败立即退出，尚未执行的组不视为通过。

设计预览只检查主入口 `docs/preview/index.html`，不检查候选稿和历史预览。`test:preview` 是正式 React 页面配合 mock IPC 的功能回归，不是历史设计预览检查。测试截图输出到已忽略的 `desktop/test-results/`，不覆盖已归档证据。

| 单独运行 | 覆盖内容 |
| --- | --- |
| `npm --prefix desktop run typecheck` | TypeScript 类型检查 |
| `npm --prefix desktop run test:unit` | 全部 `tests/*.test.ts`，包含 TS 调用与 Rust 原生命令的契约检查 |
| `npm --prefix desktop run test:tooling` | 构建、打包等工具脚本 |
| `npm --prefix desktop run test:e2e` | Chromium、Firefox、WebKit 上的原有 E2E（含隔离 demo 回归） |
| `npm --prefix desktop run test:device` | 设备／供给／账号单测，以及 Chromium 上正式页面的模拟 IPC 测试 |
| `npm --prefix desktop run test:preview` | Chromium 上正式场景预览入口与场景断言 |

Playwright 自动启动并关闭各自的 Vite 服务。默认端口分别为 1420（E2E）、1421（正式页面）、1471（预览）；端口占用时在 macOS／Linux 可指定：

```sh
BEE_E2E_PORT=28461 BEE_DEVICE_TEST_PORT=28462 npm --prefix desktop test
```

预览也读取 `BEE_E2E_PORT`，因各组按顺序运行，可与 E2E 复用端口。测试拒绝复用已有服务，避免连到错误的数据模式。`overview-refresh-stability.spec.ts` 只由正式页面配置收集。T10 布局专项仍使用独立配置和外部预览服务，不属于这个默认入口。

[主桌面 CI](../.github/workflows/desktop.yml)与 hosted macOS／Linux 的浏览器阶段调用同一 `npm test`，失败时上传日志、截图和 trace。hosted Windows 的构建流程增加全量 TS 单测；它本身不运行浏览器，主桌面 CI 的 Windows 矩阵承担统一浏览器检查。原有 Go／Rust、构建与签名校验继续保留。

原生联调另需 Go 1.27.3、Rust 1.94 及对应系统依赖，满足脚本预检后执行：

```sh
node desktop/scripts/preflight.mjs
node desktop/scripts/prepare-tee.mjs
npm --prefix desktop ci
npm --prefix desktop run build
node desktop/scripts/build-bee.mjs
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop run tauri -- dev
```

构建实际 Bee 后再运行依赖该二进制的 Cargo 测试。安装或构建成功不等于真实 GUI／官方账号／生产签名验收通过。

默认入口中的浏览器检查使用隔离数据或模拟 IPC。通过这些检查不代表真实 Hive、官方登录、原生权限或签名更新已验收；真实路径状态见[验收台账](../docs/desktop/acceptance.md)。

## 原生构建与发布

固定依赖、目标架构、内置 Bee 来源、包签名及更新来源由构建和发布脚本校验。开发包使用 ad-hoc 签名；发布需另外满足平台签名、公证、可信更新及干净安装验证，见[发布说明](../docs/desktop/release.md)。

[桌面 CI](../.github/workflows/desktop.yml)和 hosted 工作流分别记录实际运行环境；不能用交叉编译、模拟 IPC、Xvfb 或不同源码版本的结果代替最终三端系统验收。未完成项目统一列在[验收状态](../docs/desktop/acceptance.md)。
