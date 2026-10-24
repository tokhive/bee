# Bee P1 页面验收与接入交接

本记录覆盖 P1 演示页面及已取得的原生证据。任务1–5已完成并独立复核；任务6原生矩阵仍有缺口，整体P1尚未通过。演示页面持续显示“演示数据”，真实业务、资金和发布能力按末尾交接表继续落实。

## 生命周期边界

- `features/lifecycle/lifecycle.ts` 是纯 reducer；退出、更新共享 idle/checking/waiting/unknown/failed/finished 规则。
- 只有 ready + known + 非负安全整数任务数可信。loading/error 携带旧零、unknown 和未确认收据均不能宣称完成；异步结果须匹配当前意图 ID。
- `BeeClient` 演示命令 `lifecycle.wait/check/finish/cancel` 独立于 P0 SystemBridge。等待改变 `snapshot.lifecycle.dispatchStopped`，不改账号 `paused`；取消仅解除临时停止。立即操作必须已知有任务并明确提醒可能中断。
- “完成”明确为演示流程完成；App 不退出，不安装更新。关窗后台、托盘和真实管理进程沿用 P0，不能用页面模拟结果替代。
- 演示客户端在实例内记住请求用途与终态；已取消/完成的旧请求不能覆盖新的意图。当前完成请求只允许无副作用地重放 finish；新的合法意图仍可从零任务、等待、立即或核对入口建立。

## 网页验收矩阵

- Chromium / Firefox / WebKit 三项目完整页面回归；本机 Chrome 备选配置仅含一个 chrome 项目，不把 channel 继承给 Firefox/WebKit。
- 1280×860、1024×768、860×600 均覆盖中英文，固定场景数据保存五页、首次引导、账号抽屉、报价/划转/提现、退出/更新确认和等待、任务未知截图。
- 860×600 额外覆盖浅深主题与 125% / 150% 内容缩放。每页检查整窗无横向裁切、金额不拆行、返回/主操作可滚动到达；弹层检查 Tab、Shift-Tab、Escape、关闭后焦点恢复。CSS zoom 是网页布局压力检查，不冒充原生显示缩放/WebView 验收。
- loading / empty / error 和收益对应读状态另存截图；英文逐页和弹层检查无可见中文漏译。动态时间戳属于本地演示当前时间，不用于逐像素基线匹配。
- 截图通过 Playwright `testInfo.outputPath()` 按 browser + viewport + language + theme + zoom 隔离；旧 Task4 固定 `/tmp` 文件不作为跨浏览器证据。最终保存位置与 SHA256 清单见实施报告。

已归档[三浏览器日志、完整清单与48张代表图](../../docs/desktop/evidence/2026-10-23-p1-browser/README.md)。完整页面回归414项通过后，仅错误实际count文案变动由三浏览器3项专项覆盖；随后 I1 请求终态修补的三浏览器生命周期专项96项通过，typecheck及普通/demo构建通过。保留原始失败，不把这些不同源码范围的结果合成一次最终全套通过。

## 人工视觉比对

基线为 `design/reference/bee-silver.html`（批准 preview 的校验副本），`bee-silver-source.html` 是核对片段，不能作为直接运行的完整 HTML。基线原件和 manifest 均未修改。

人工检查侧栏 178px、工具栏 57px、29px Logo、系统字体与克制字重、浅灰/白内容面、金色点缀、细边线、摘要/列表密度、金额对齐和滚动。网页满窗不复制原型宿主外边框和伪窗口按钮；初始暂停、显式演示说明、连接状态与临时派发解释是必要语义内容，与原型“日常贡献”截图不同。

今日收益改为 12.4，与 `daysAgo=0` 唯一结算一致；累计 382.14 与全部结算 BigInt 求和一致，余额是独立钱包 128.56。概览旧 ¥ 修正为 $，依据批准 preview 的 USD 展示与 Hive 账务统一 USD 规则。这些修补不更新原型基线，不修改提现渠道或资金字段。人工发现英文 150% 金额断行后增加单行断言；摘要与账号行按实际内容宽度自适应列，金额不拆行、账号操作不越出自身容器，极长精确金额保留局部滚动。

独立视觉抽检实际查看33张contact sheet（558幅缩略图）和18张原图，未见主操作遮蔽、金额断位或账号按钮越界；发现的英文额度标签连写和进度条样式差异已由1aca2d3修整。新三浏览器关键最小尺寸专项6项通过，[90张新图清单、6张概览原图及日志](../../docs/desktop/evidence/2026-10-23-p1-quota-visual-fix/README.md)单独归档，保留旧图历史。

## 原生验收状态

| 来源 | 实际验收 | 边界 |
| --- | --- | --- |
| [b94 Mac15 arm64](../../docs/desktop/evidence/2026-10-23-p1-native-mac-b94/README.md) | App/DMG、签名、Rust41/41；860×600中英浅深五页、抽屉焦点、演示划转/提现、真实管理ready及菜单退出 | 导出当时RED，保留原始记录；不是其它系统验收 |
| [2681 Mac15 arm64](../../docs/desktop/evidence/2026-10-23-p1-native-mac-2681edc/README.md) | 英文完整回执/Off placeholder原图独立复验、signed2/2、两份脱敏文件实际交付、DMG复制副本启动退出 | 首次授权来源未证明，拒绝/取消未测；旧用户Bee70292缺失原因未知，不能声称全程保留 |
| [87 Mac15 arm64](../../docs/desktop/evidence/2026-10-23-p1-native-mac-87b28a2/README.md) | 新source App/DMG、签名/minos、Rust42/42、最小窗native ready；真实菜单退出保留独立空闲Bee管理夹具 | 托盘工具超时，隐藏可见转换未证；开发ad-hoc包，非Mac13/公证/生产签名 |
| [2681 hosted三端](../../docs/desktop/evidence/2026-10-23-p1-native-remote-2681edc/README.md) | WinServer2022 Rust30/NSIS；Ubuntu22x64/22arm/24arm各browser489、Rust35和AppImage窗口观测及来源核对 | MacIntel模拟时钟fixture失败；24x64 Firefox通道关闭488/489、原因未知；ARM extract各1 zombie |
| [87 hosted最终证据](../../docs/desktop/evidence/2026-10-23-p1-native-remote-87b28a2/README.md) | Server2022 Rust31/NSIS字节及来源已核；Ubuntu22x64/22arm/24arm各browser489/Rust36、AppImage及六模式1000×700末图 | MacIntel WebKit账号485/489、四例30s超时，原生后续全跳过、根因未知；24x64依赖下载达90分钟取消；22x64/24arm extract各1 zombie |
| [Linux860×600补证](../../docs/desktop/evidence/2026-10-23-p1-linux-minimum-window/README.md) | 审好9工具分别运行2681/87 Ubuntu24 ARM包，resize后完整十秒、最终尺寸/owned存活核对及非空末图；工具34/34 | 保留UTF-8与mode0644失败；双来源Docker Xvfb，无WM/FUSE，不证明真实标题栏、native ready、托盘或安装 |
| [本机WebKit休眠调查](../../docs/desktop/evidence/2026-10-24-p1-mac-webkit-diagnostic/INDEX.md) | 两次长停顿与系统睡眠直接重叠；原30s/retries0/断言不变，同5例/5workers在无Sleep记录的复测中5/5、3.7s | 原失败仍保留；仅本机arm64单次样本，不能关闭Intel原因或代替原生验收 |
| [9 Linux四环境](../../docs/desktop/evidence/2026-10-24-p1-native-remote-9ca837d/README.md) | Ubuntu22/24 x64/arm64各Go7/browser489/Rust36；八artifact与四包来源已核，extract/FUSE八次860×600、≥10s及非空末图 | 22ARM FUSE及24ARM两模式各1 PID1 WebKit zombie；仅客户端几何/启动，非WM标题栏、ready、托盘或安装；9主动取消的Mac/Win不算通过 |
| [关窗找回补验尝试](../../docs/desktop/evidence/2026-10-24-p1-mac-close-reopen-attempt/README.md) | 87包签名/字节一致，本次测试父子进程已精确回收 | CUA无法取得Bee/Finder窗口，Dock超时；关窗找回未执行，当前工具失败原因未定 |

87模拟窗口发现测试已改为可控时钟、独立审查Approved，生产预算未放宽。9ca837d最小窗工具34/34并独立Approved，Linux run39941148651四行与八次smoke已完成包/source/provenance/geometry及下载字节核对。Mac演示dev入口曾实际编译/启动，但CUA不能绑定未打包binary；已用打包App完成的真实WebView操作按原时点保留。10月24日新尝试未取得窗口，不将它写成dev或关窗找回通过。网页CSS缩放和Playwright WebKit仍不能替代系统WebView/显示缩放。

未验收项目：Mac13双架构、Win10/11官方来源/GUI、干净用户与Applications拖拽安装、托盘/无托盘及关窗找回可见状态、原生125%/150%显示、Downloads拒绝/取消与下载原生完成/失败反馈。当前有文件交付证据，UI“已发起下载”不能当作原生Finished事件反馈。

## 本机查看与快速验收

从实施检出根目录执行 `open "desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app"`。当前本机包绑定87b28a2；DMG留在 `.cache/qa/p1-native-local-87b28a2/packages/`。它是开发演示包，不会开始真实贡献或划转真实资金。

1. 五页能切换，860×600下内容可滚动、主要操作可达；连接详情显示真实native manager ready，同时保留“演示数据/真实供给未启动”。
2. AI账号打开详情，Tab/Shift-Tab不越出抽屉，Escape关闭并恢复触发器焦点；英文设置保存回执完整、代理空值为Off (leave blank)。
3. 演示划转1.234567891后余额128.56→127.325432109、24.6→25.834567891；提现只显示暂不支持，不扣款。它们均是演示状态。
4. 诊断运行后导出报告，检查JSON仅有product/mode/checks/logs白名单；首次系统授权、拒绝/取消与真实失败反馈仍按上述缺口单列，不靠提示判断文件交付。
5. 页面“退出演示/更新演示”仅完成预览；真实系统菜单“退出”才结束App及其owned管理进程。托盘和关窗找回仍需独立证明。

## P2–P5 接入交接

| 阶段 | 真实接入点与必须保留的约束 |
| --- | --- |
| P2 登录、绑定与运行管理 | 替换 BeeClient 登录/绑定/供给/任务读取，确认任务可信度与刷新；把临时停派发接到真实调度并与主动暂停分开；真实退出核验管理归属、关窗后台和任务中断/恢复，不能从演示 finished 推断真实退出。 |
| P3 AI 账号、诊断及网络 | 真实官方登录检测/授权、模型/额度、换号/移除及收尾、自检/脱敏日志/导出、代理覆盖与通知去重；接入后仍须首次手动贡献，不存凭证到普通偏好。 |
| P4 收益、报价与资金 | 真实统计/历史、报价版本、Hive/用户同身份划转、幂等标识与未决恢复；15 位整数/9 位小数精度，筛选不改钱包余额，提现仍暂不支持且不扣款。 |
| P5 三端发布验收 | 更新来源/签名/公证/安装/重启、真实更新前任务收尾、版本兼容、三端 WebView/标题栏/缩放/托盘/唤醒；P1 update 没有安装或签名验证。 |
