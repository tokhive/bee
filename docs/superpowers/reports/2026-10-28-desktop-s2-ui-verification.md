# Bee S2 诊断与设置 UI 验收

日期：2026-10-28，最终更新：2026-10-29。依据：[UI 规格](../specs/2026-10-28-desktop-s2-ui-design.md)、[UI 实施计划](../plans/2026-10-28-desktop-s2-ui.md)。

后续已按用户授权整合 S3 `f754757` 与 S1 `9e349ba`，包括后台控件稳定性和一键构建；见[三分支整合记录](2026-10-29-desktop-s123-integration.md)。本文下述 `3d908fc` 原生包与截图仍绑定当时来源，不改写为新整合版本的原生验收。

## 结论与范围

诊断 C「问题优先」、安全日志及设置 B「分类页签」已完成，并接入 S1 已提交的暖银白 shadcn/ui 公共壳。集成后的明暗、中英、1440×1000／860×600 浏览器检查及本轮 macOS 原生联调均取得实际证据。此结论限定于本轮 UI 计划；[S2 功能验收](../../desktop/experience-validation.md)中通知横幅／点击、拒绝路径、安装路径及 Windows／Linux 等缺项继续保留，不能据此宣布 S2 全部原生平台已验收。

工作根目录：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-s2`；分支：`feat/bee-desktop-s2`；UI 审阅基线：`035589a`。页面提交为 `0e7eafe`、`0134919`，阶段验证为 `c29dec8`，局部修正截至 `77d2eec`；最终实现集成提交为 `3d908fc0f1d3b66e2a3325be1fde96b3c97404dd`。

## S1 集成与重复工作边界

源快照为 S1 `27f536056df6ff26b9e2f8acd86945f8e994ea75`，包含 `dd8ef64` 的官方查询期限、`c9e4064` 的公共壳／概览／账号及 `27f5360` 文档校正。`3d908fc` 使用真实 merge，父提交为 S2 `77d2eec` 和 S1 `27f5360`；不以提交号差异重复实现等价补丁：S1 `b4f9d8c` 对应 S2 `3b788ca`，S1 `636daa4` 对应 S2 `d9e9ca4`。

公共壳、基础组件、概览和账号由 S1 唯一提供；诊断、日志和设置保留 S2 真实客户端。共享入口逐段适配：`useAccounts` 第五参数保留 `autoRead`，第六参数传入 coordinated；runtime／supply 同样复用唯一 `createDesktopState`，未增加快照轮询者。S1 自动来源读取和十秒只读失败恢复得到保留；诊断及日志仍须明确触发，未知写入不自动重发，可证明的修订回退继续停止核对。

集成补齐设备刷新重复读、晚到回执误确认新来源、未知写错误被 busy 渲染过早清除、供给逐平台错误丢失等兼容问题。保留 `runtime.stalled` 门禁、实例／修订隔离和真实下载回执。S1 随后另有未提交的轮询稳定性修复，**不在本次源快照内**；未复制、未重写，待其形成提交后另行集成。S1 和主工作树未写入，两个原有计时文件保持未跟踪；未推送、发布或合并回 S1。

## 已验证行为

- 诊断默认「检查结果」，另有「安全日志」。问题按设备／平台完整展示，未完成及通过项独立折叠；取消、空报告、skipped 不冒充全部正常。
- 进入、切页签或展开证据不启动诊断、不读日志；运行中往返页签只保留一个观察循环。日志筛选、cursor、迟到回包隔离及未读／空列表区别保留。
- 设置为通用、网络与代理、通知与启动、关于，默认网络。切换不重读系统状态、不丢代理草稿；普通主按钮实心，测试描边，重启应用保留危险确认。
- 保存配置与实际生效分开。取消／Escape 零应用命令，明确确认只执行一次 `applySaved(true)`；真实网络测试只证明可达性，不宣称授权或额度。
- 语言／主题沿用修订保存回读；应用版本来自构建清单，Bee 版本来自 bridge。通知意愿与系统权限、自启意愿与系统登记分别显示，查询不申请权限。

## 自动验证

Node 为 `24.22.1`，命令在 `desktop` 执行；Rust／Go 命令从工作根执行。以下为集成实现的最新结果，此后仅更新验收文档及 ignored 证据，正式源码未变。

| 检查 | 实际结果 | 本机完整输出 |
| --- | --- | --- |
| `BEE_DEVICE_TEST_PORT=1433 npx --no-install playwright test --config playwright.device.config.ts` | 87/87 通过，21.7 秒 | [浏览器](../../../.cache/s2-integration-device-final.log) |
| `node --test tests/diagnostic-presentation.test.ts tests/diagnostics.test.ts tests/network.test.ts tests/preferences.test.ts tests/notifications.test.ts tests/desktopState.test.ts tests/accountPresentation.test.ts tests/supply.test.ts` | 60/60 通过 | [Node](../../../.cache/s2-integration-node.log) |
| `cargo +1.94 test --offline --locked --manifest-path desktop/src-tauri/Cargo.toml --lib -- --test-threads=1` | 148 通过，2 个签名包专用用例 ignored；不把 ignored 计为通过 | [Rust](../../../.cache/s2-integration-rust.log) |
| `go test ./agent -run 'Test.*(DesktopAccount\|DesktopNetwork\|DesktopDiagnostic\|Capability)'` | 定向测试通过 | [Go](../../../.cache/s2-integration-go.log) |
| `npm run typecheck`／`npm run build` | 退出 0；原有主 chunk 超过 500 kB 提示保留 | [类型](../../../.cache/s2-integration-typecheck-final.log)、[构建](../../../.cache/s2-integration-build-final.log) |
| 签名后包内真实 Bee 只读 smoke | 14 通过、1 项按 macOS UserConfigDir 隔离限制跳过；HOME 不重定向 | [最终签名二进制结果](../../../.cache/s2-integration-sidecar-final/smoke.json) |
| debug App 构建及 `codesign --verify --deep --strict` | 构建通过，本地 ad-hoc 重签后严格校验通过；未发布／公证 | [构建](../../../.cache/s2-integration-native-build.log)、[签名](../../../.cache/s2-integration-codesign.log) |

浏览器覆盖旧实例、自动来源读取、未知写后只读恢复、每个平台供给失败隔离、诊断分区／取消／未知、手动日志与 cursor、草稿保留、代理保存／应用分离、偏好迟到回包、通知拒绝、自启未知、版本未知及下载成功／失败／未知。ArrowLeft／ArrowRight／Home／End、弹窗 Escape／焦点返回、窄窗无横向溢出和主按钮悬停对比度均有断言。

集成回归保留了失败后再修复的[红](../../../.cache/s2-integration-readback-red.log)／[绿](../../../.cache/s2-integration-readback-green.log)证据。继承的账号 smoke 脚本已消除过期的 capability 数量常量并通过语法检查；该脚本旧有 HOME 重定向路径本轮未执行，不充当原生验收证据。

## 实际视觉对照

使用 ego-browser TaskSpace 19 查看集成后的正式 NativeApp 和参考原型，截图后逐张读图并核对尺寸；TaskSpace 已正常结束。正式源码由 S2 Vite 1435 提供，场景通过已有 IPC fixture 注入，没有新增正式 App 模拟入口。截图目录为 `.cache/s2-ui-verification/integrated/`，以下均为本机验证产物。

| 对象 | 实际截图 |
| --- | --- |
| 最新 shadcn/ui 明暗参考 | [浅色](../../../.cache/s2-ui-verification/integrated/reference-shadcn-light-1440.png)、[深色](../../../.cache/s2-ui-verification/integrated/reference-shadcn-dark-1440.png) |
| 已选布局 | [诊断 C](../../../.cache/s2-ui-verification/integrated/reference-diagnostics-C-light-1440.png)、[设置 B](../../../.cache/s2-ui-verification/integrated/reference-settings-B-light-1440.png) |
| 诊断 | [中文浅色 1440](../../../.cache/s2-ui-verification/integrated/diagnostics-light-1440.png)、[中文浅色 860](../../../.cache/s2-ui-verification/integrated/diagnostics-light-860.png)、[英文深色 1440](../../../.cache/s2-ui-verification/integrated/diagnostics-dark-en-1440.png)、[英文深色 860](../../../.cache/s2-ui-verification/integrated/diagnostics-dark-en-860.png) |
| 日志 | [中文浅色](../../../.cache/s2-ui-verification/integrated/logs-light-1440.png)、[英文深色窄窗](../../../.cache/s2-ui-verification/integrated/logs-dark-en-860.png) |
| 网络 | [中文浅色](../../../.cache/s2-ui-verification/integrated/settings-network-light-1440.png)、[英文深色](../../../.cache/s2-ui-verification/integrated/settings-network-dark-en-1440.png)、[英文深色窄窗](../../../.cache/s2-ui-verification/integrated/settings-network-dark-en-860.png) |
| 其余页签 | [通用](../../../.cache/s2-ui-verification/integrated/settings-general-light-1440.png)、[通知与启动](../../../.cache/s2-ui-verification/integrated/settings-system-light-1440.png)、[关于](../../../.cache/s2-ui-verification/integrated/settings-about-light-1440.png) |
| 危险确认 | [弹窗](../../../.cache/s2-ui-verification/integrated/settings-confirm-light-1440.png) |

公共壳已统一为 178px 侧栏、52px 顶栏、24px 标题、约 29px 内容留白；浅色 side `#f7f6f3`／panel `#f8f7f4`，深色 side `#20201e`／paper `#242421`／panel `#2a2a26`。没有恢复旧原型冷灰 tokens。主次按钮、页签、密度与 C／B 内容位置符合已选参考；每个真实问题单独展示，没有搬入原型的平台合并推断。窄窗纵向排列／滚动，长证据换行，无横向溢出。

fixture 视觉操作审计中 `runtime_start`、`network_apply_saved`、`notification_enable`、`autostart_set` 均为零。之前局部 UI 发现并修复的悬停对比度、摘要间距、英文保存提示、英文日志列宽与 Proxy disabled 文案均已保留在本次集成回归中。

## 本轮 macOS 真实主窗口联调

使用 `desktop/src-tauri/target/debug/bundle/macos/Bee S2 Dev.app`，本地 debug/ad-hoc。包对应实现 `3d908fc`，Bee 显示 `dev+3d908fc0f1d3-dirty`；dirty 来自当时未提交的验收文档，后续没有正式源码改动。重签后 Bee SHA256 为 `a3bfa5a20d1bca5a2265e2db086e83119bad78357b088efa2249460e06cf6db0`，与最终 smoke 一致；主程序 hash、源提交及签名记录见 [artifact.json](../../../.cache/s2-native-ui/artifact.json)。

S1 与 S2 应用标识相同，按单实例顺序切换：先确认另一会话结束和贡献未运行，再正常退出 S1、启动 S2。首轮主 PID 47774、owned Bee 47833、bridge instance `f3af87ec4a1f016b785f093c8e673b87`；它们属于本次包，没有把旧探针或 S1 窗口当作 S2。联调结束后正常退出 S2，确认 owned 主子均消失，并恢复原 S1 包窗口；没有改写 S1 源码、包或未提交修复。

| 操作 | 真实结果和证据 |
| --- | --- |
| 进诊断／运行／取消／重跑 | 初始尚未运行；明确运行后可取消，显示已取消；重跑完成 16 项：fail 2、warning 1、pass 3、skipped 10。当前贡献未运行、OpenAI 登录来源缺失／账号未确认如实展示；没有开始贡献。[完成](../../../.cache/s2-native-ui/diagnostics-completed.json)、[取消](../../../.cache/s2-native-ui/diagnostics-cancelled.json) |
| 安全日志 | 切换后仍须明确刷新；实际读到诊断、安全运行及取消事件。[日志](../../../.cache/s2-native-ui/logs-loaded.json) |
| 导出检查＋日志 | macOS 首次 Downloads 目录确认使 WebKit 等待超过 30 秒；按已授权导出范围允许目录访问后，UI 正确显示结果未确认，实际文件已生成。独立读回 7442 字节、16 checks／21 logs；未把超时改写成成功。[系统目录确认](../../../.cache/s2-native-ui/export-download-permission.json)、[未确认](../../../.cache/s2-native-ui/export-after-permission.json) |
| 导出仅检查 | 先核对首文件，再明确导出仅检查；真实匹配回执后显示“脱敏报告已下载。”。独立读回 3675 字节、16 checks／0 logs。[回执与 hash](../../../.cache/s2-native-ui/export-verification.json)、[窗口回执](../../../.cache/s2-native-ui/export-completed.json) |
| 空代理只读测试 | 两个官方 HTTPS 端点实际 HTTP 401，显示可达但不证明授权／额度；本机代理项 skipped。[直接连接结果](../../../.cache/s2-native-ui/network-test-direct.json) |
| 非空代理只读测试 | 原有本机工具没有可用监听；临时在 `127.0.0.1:56859` 启动只允许两固定目标的 HTTP CONNECT 透传服务。原生输入只作未保存草稿；三次真实上游 CONNECT 成功，两个真实 HTTPS 端点均经 local_proxy 返回 HTTP 401，没有伪造应答。已保存／当前生效代理仍为空，未保存或应用代理，未重启贡献。[核对](../../../.cache/s2-native-ui/network-proxy-verification.json)、[UI](../../../.cache/s2-native-ui/network-proxy-tested.json) |
| 语言／主题保存及重开 | 原值 system／system；保存 en／light 后，磁盘 revision 2，并正常退出重开，界面仍为 English／Light。随后通过原控件恢复 system／system，revision 4；系统登记、通知意愿及代理未改。[重开回读](../../../.cache/s2-native-ui/preferences-after-reopen.json)、[恢复](../../../.cache/s2-native-ui/preferences-restored-disk.json) |
| 系统状态／关于／退出 | 仅查询到主 App 通知尚未允许、自启未登记，未申请或发送通知。主 App 与独立 probe 标识不同，不混用其权限。关于显示 App 0.1.0 和当前 Bee 构建；正常退出确认 owned 进程消失。[系统状态](../../../.cache/s2-native-ui/system-readonly.json)、[关于](../../../.cache/s2-native-ui/about.json)、[退出](../../../.cache/s2-native-ui/final-exit.json) |

实际下载保留在 `/Users/dayong/Downloads/bee-diagnostics.json` 及 `/Users/dayong/Downloads/bee-diagnostics (1).json`。前者 SHA256 为 `b02fd5205d1927349aa8336f615248ab7fca07c284c4b989c9870eae691922e8`，后者为 `54dcedb2e30fa33e34c570fe7e5a429e176e1d2ed34dace3696d374d222e3e89`。未删除用户可见的报告。

真实窗口截图：[诊断深色](../../../.cache/s2-native-ui/diagnostics-dark-zh.png)、[代理深色](../../../.cache/s2-native-ui/network-proxy-dark-zh.png)、[系统状态深色](../../../.cache/s2-native-ui/system-dark-zh.png)、[关于英文浅色](../../../.cache/s2-native-ui/about-light-en.png)。本轮没有反复请求通知权限、切换自启、配对新设备、授权账号或开始贡献。临时代理仅为 ignored 验证工具，联调后已关闭，未进入正式源码或发布包。

## 收尾审查

按 `affected-path-review` 从 UI 输入追到真实输出，而非只检查改动文件；本轮不委派子代理。以下路径结合源码、既有回归和本轮原生证据核对，未发现需要追加正式代码修复的问题。

| 受影响行为 | 已追踪的输入、约束及最终输出 |
| --- | --- |
| S1／S2 共享观察 | `NativeApp` → 唯一 `createDesktopState` → account／runtime／supply hooks；核对第五／第六参数、generation、instance、network revision、平台错误及时间戳，保留单平台失败、未知写隔离和十秒只读恢复，不新增业务快照轮询或自动 PUT |
| 手动诊断与日志 | 页签／按钮 → `DiagnosticsClient` 上下文与请求序号 → Rust 固定命令 → Go 只读 doctor → 固定 schema 校验 → `partitionChecks` → 原检查／证据完整呈现；切页不写入，过滤后的旧日志不覆盖新范围 |
| 实际报告交付 | `include_logs/report_id` → 当前 bridge snapshot／build metadata → Rust 白名单导出 → TS 上限与字段校验 → Blob URL → WebKit Finished／匹配 URL → 成功／失败／30 秒未知；两份文件独立读回，未用点击下载代替交付 |
| 网络与偏好 | 输入草稿 → 固定代理校验／origin 与 expected_revision → 独立保存或明确 `confirmed:true` 应用 → S1 唯一运行接口；本轮原生只读代理测试经过真实 CONNECT／TLS。偏好新修订回读拒绝旧结果，语言主题重开保留，通知查询没有 enable 副作用 |
| 公共外观／危险确认 | S1 tokens／基础按钮 → S2 两页局部样式／Radix Tabs 与 Dialog → 明暗、中英和窄窗；可选 destructive 缺省兼容其它调用方，Escape 取消与焦点返回保留 |

文档交叉检查修正了旧账号使用说明中的首次手动读取、开始时勾选恢复平台、模型列表／内部元数据及未知写永久停止自动刷新的过时描述；现与 S1 已批准规格和当前源码一致。协议文档补齐 OpenAI official／`account_detect` 十分钟例外，普通请求期限不变。没有为说明文档补写新的 S1 逻辑。

一致性检查覆盖会话选择、规格／计划／实现、全部 `useAccounts` 调用方、公共 tokens、IPC 字段和当前／历史证据边界；没有新增配置项或依赖。最终证据自检核对报告全部本地链接、17 张实际尺寸、测试日志、签名后 Bee hash、两份下载文件及临时服务／S2 进程退出，见 [final-evidence-check.json](../../../.cache/s2-native-ui/final-evidence-check.json)。已知功能原生缺项列于下一节，不列为本 UI 计划通过项。

## 保留的验收边界

- 本轮验证了主 App 的诊断、取消、日志、真实下载、网络只读测试和偏好重开；未覆盖代理保存后真实停止／重启贡献，该路径继续引用既有契约与 fixture，真实设备流程仍待单独验收。
- 下载首轮因系统目录确认超时的未知结果被保留；第二轮成功不能抹去首轮事实。权限确认只用于这次 Downloads 写入，与通知权限无关。
- 通知可见横幅／点击、允许回调异常原因、拒绝路径、安装路径自启、关窗找回及 Windows／Linux 真机矩阵仍按 S2 功能记录保留，不以本轮 UI 或 fake OS 结果代替。
- S1 后续未提交的轮询稳定性修复未纳入本次快照，后续只集成其明确提交，不在 S2 重做。

分支与工作树保持，集成没有自动反向合入 S1，也未推送或发布。UI 计划的完成与 S2 全部功能原生验收的完成分别记录。
