# Bee P1 页面验收与接入交接

本记录覆盖 P1 演示网页层；不代表 P2–P5 真实业务、资金、系统退出或发布能力已接通。演示页面持续显示“演示数据”。

## 生命周期边界

- `features/lifecycle/lifecycle.ts` 是纯 reducer；退出、更新共享 idle/checking/waiting/unknown/failed/finished 规则。
- 只有 ready + known + 非负安全整数任务数可信。loading/error 携带旧零、unknown 和未确认收据均不能宣称完成；异步结果须匹配当前意图 ID。
- `BeeClient` 演示命令 `lifecycle.wait/check/finish/cancel` 独立于 P0 SystemBridge。等待改变 `snapshot.lifecycle.dispatchStopped`，不改账号 `paused`；取消仅解除临时停止。立即操作必须已知有任务并明确提醒可能中断。
- “完成”明确为演示流程完成；App 不退出，不安装更新。关窗后台、托盘和真实管理进程沿用 P0，不能用页面模拟结果替代。

## 网页验收矩阵

- Chromium / Firefox / WebKit 三项目完整页面回归；本机 Chrome 备选配置仅含一个 chrome 项目，不把 channel 继承给 Firefox/WebKit。
- 1280×860、1024×768、860×600 均覆盖中英文，固定场景数据保存五页、首次引导、账号抽屉、报价/划转/提现、退出/更新确认和等待、任务未知截图。
- 860×600 额外覆盖浅深主题与 125% / 150% 内容缩放。每页检查整窗无横向裁切、金额不拆行、返回/主操作可滚动到达；弹层检查 Tab、Shift-Tab、Escape、关闭后焦点恢复。CSS zoom 是网页布局压力检查，不冒充原生显示缩放/WebView 验收。
- loading / empty / error 和收益对应读状态另存截图；英文逐页和弹层检查无可见中文漏译。动态时间戳属于本地演示当前时间，不用于逐像素基线匹配。
- 截图通过 Playwright `testInfo.outputPath()` 按 browser + viewport + language + theme + zoom 隔离；旧 Task4 固定 `/tmp` 文件不作为跨浏览器证据。最终保存位置与 SHA256 清单见实施报告。

## 人工视觉比对

基线为 `design/reference/bee-silver.html`（批准 preview 的校验副本），`bee-silver-source.html` 是核对片段，不能作为直接运行的完整 HTML。基线原件和 manifest 均未修改。

人工检查侧栏 178px、工具栏 57px、29px Logo、系统字体与克制字重、浅灰/白内容面、金色点缀、细边线、摘要/列表密度、金额对齐和滚动。网页满窗不复制原型宿主外边框和伪窗口按钮；初始暂停、显式演示说明、连接状态与临时派发解释是必要语义内容，与原型“日常贡献”截图不同。

今日收益改为 12.4，与 `daysAgo=0` 唯一结算一致；累计 382.14 与全部结算 BigInt 求和一致，余额是独立钱包 128.56。概览旧 ¥ 修正为 $，依据批准 preview 的 USD 展示与 Hive 账务统一 USD 规则。这些修补不更新原型基线，不修改提现渠道或资金字段。人工发现英文 150% 金额断行后增加单行断言；摘要与账号行按实际内容宽度自适应列，金额不拆行、账号操作不越出自身容器，极长精确金额保留局部滚动。

## 原生验收状态

以下由主控在最终 Task6 提交上统一执行并追加证据，目前待主控：

- macOS 演示 `tauri dev` / `tauri build`，真实标题栏、最小窗口、App/DMG、Rust 与 CUA。
- Windows WebView2 / Linux WebKitGTK 对应当前 Task6 包的最小窗口与安装/关窗找回，不能以 Playwright WebKit 替代。
- 历史 Mac 845 包与 hosted Linux 22c5f91 不能作为当前 Task6 包的证据。

## P2–P5 接入交接

| 阶段 | 真实接入点与必须保留的约束 |
| --- | --- |
| P2 登录、绑定与运行管理 | 替换 BeeClient 登录/绑定/供给/任务读取，确认任务可信度与刷新；把临时停派发接到真实调度并与主动暂停分开；真实退出核验管理归属、关窗后台和任务中断/恢复，不能从演示 finished 推断真实退出。 |
| P3 AI 账号、诊断及网络 | 真实官方登录检测/授权、模型/额度、换号/移除及收尾、自检/脱敏日志/导出、代理覆盖与通知去重；接入后仍须首次手动贡献，不存凭证到普通偏好。 |
| P4 收益、报价与资金 | 真实统计/历史、报价版本、Hive/用户同身份划转、幂等标识与未决恢复；15 位整数/9 位小数精度，筛选不改钱包余额，提现仍暂不支持且不扣款。 |
| P5 三端发布验收 | 更新来源/签名/公证/安装/重启、真实更新前任务收尾、版本兼容、三端 WebView/标题栏/缩放/托盘/唤醒；P1 update 没有安装或签名验证。 |
